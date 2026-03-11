/**
 * Upload Session Tracker
 *
 * This module provides server-side session tracking for upload operations to handle:
 * - Client disconnection detection
 * - Orphaned data cleanup
 * - Idempotent retry support
 * - Session state persistence
 *
 * Sessions are stored in the database to survive server restarts and enable
 * cross-instance coordination in clustered deployments.
 */

import { PoolConnection } from 'mysql2/promise';
import { getConn, runQuery } from '@/components/processors/processormacros';
import ailogger from '@/ailogger';
import ConnectionManager from './connectionmanager';
import { moveTemporaryBatchToFailedMeasurements } from '@/lib/batchfailuretransfer';

/**
 * Upload session states
 */
export enum UploadSessionState {
  INITIALIZED = 'initialized', // Session created, upload not started
  UPLOADING = 'uploading', // Chunks being uploaded to temporarymeasurements
  UPLOADED = 'uploaded', // All chunks uploaded, ready for processing
  PROCESSING = 'processing', // bulkingestionprocess running
  COLLAPSING = 'collapsing', // bulkingestioncollapser running
  COMPLETED = 'completed', // Successfully finished
  FAILED = 'failed', // Processing failed (recoverable via reingestion)
  ABANDONED = 'abandoned', // Client disconnected, cleanup needed
  CLEANED_UP = 'cleaned_up' // Orphaned data has been cleaned
}

/**
 * Upload session data structure
 */
export interface UploadSession {
  sessionId: string;
  schema: string;
  plotId: number;
  censusId: number;
  userId: string;
  state: UploadSessionState;
  fileId: string;
  totalChunks: number;
  uploadedChunks: number;
  processedBatches: number;
  totalBatches: number;
  lastHeartbeat: Date;
  createdAt: Date;
  updatedAt: Date;
  errorMessage?: string;
  idempotencyKey?: string;
}

/**
 * Session timeout thresholds (in milliseconds)
 */
export const SESSION_TIMEOUTS = {
  HEARTBEAT_INTERVAL: 30000, // Client should send heartbeat every 30 seconds
  HEARTBEAT_TIMEOUT: 90000, // Session considered stale if no heartbeat for 90 seconds
  UPLOAD_TIMEOUT: 600000, // 10 minutes max for upload phase
  PROCESSING_TIMEOUT: 900000, // 15 minutes max for processing phase
  CLEANUP_GRACE_PERIOD: 300000 // 5 minutes grace before cleanup
};

export const ACTIVE_UPLOAD_SESSION_STATES = [
  UploadSessionState.INITIALIZED,
  UploadSessionState.UPLOADING,
  UploadSessionState.UPLOADED,
  UploadSessionState.PROCESSING,
  UploadSessionState.COLLAPSING
] as const;

const ACTIVE_UPLOAD_SESSION_STATE_LIST = ACTIVE_UPLOAD_SESSION_STATES.map(state => `'${state}'`).join(', ');
const ACTIVE_SCOPE_KEY_INDEX_NAME = 'uq_upload_sessions_active_scope';
const ACTIVE_SCOPE_KEY_COLUMN_NAME = 'active_scope_key';

export class UploadSessionOwnershipError extends Error {
  status: number;

  constructor(message: string, status: number = 409) {
    super(message);
    this.name = 'UploadSessionOwnershipError';
    this.status = status;
  }
}

export interface RequireUploadSessionOwnershipOptions {
  schema: string;
  sessionId: string | null | undefined;
  censusId: number;
  plotId?: number;
  allowedStates: readonly UploadSessionState[];
  contextLabel: string;
}

function isUploadSessionActiveState(state: UploadSessionState): boolean {
  return (ACTIVE_UPLOAD_SESSION_STATES as readonly UploadSessionState[]).includes(state);
}

export function isUploadSessionStale(session: Pick<UploadSession, 'lastHeartbeat' | 'state'>): boolean {
  if (!isUploadSessionActiveState(session.state)) {
    return false;
  }

  return Date.now() - new Date(session.lastHeartbeat).getTime() >= SESSION_TIMEOUTS.HEARTBEAT_TIMEOUT;
}

function getStaleSessionReason(contextLabel: string): string {
  return `Upload session expired before ${contextLabel} - heartbeat timeout`;
}

function isActiveScopeDuplicateKeyError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const mysqlError = error as Error & { code?: string; errno?: number; sqlMessage?: string };
  return (
    mysqlError.code === 'ER_DUP_ENTRY' &&
    (error.message.includes(ACTIVE_SCOPE_KEY_INDEX_NAME) || mysqlError.sqlMessage?.includes(ACTIVE_SCOPE_KEY_INDEX_NAME) === true)
  );
}

async function hasColumn(conn: PoolConnection, schema: string, table: string, column: string): Promise<boolean> {
  const results = await runQuery(
    conn,
    `
      SELECT COUNT(*) AS count
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
    `,
    [schema, table, column]
  );
  return Array.isArray(results) && Number((results[0] as { count?: number }).count ?? 0) > 0;
}

async function hasIndex(conn: PoolConnection, schema: string, table: string, indexName: string): Promise<boolean> {
  const results = await runQuery(
    conn,
    `
      SELECT COUNT(*) AS count
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?
    `,
    [schema, table, indexName]
  );
  return Array.isArray(results) && Number((results[0] as { count?: number }).count ?? 0) > 0;
}

async function abandonDuplicateActiveScopeSessions(conn: PoolConnection, schema: string): Promise<void> {
  await runQuery(
    conn,
    `
      WITH ranked_sessions AS (
        SELECT
          session_id,
          ROW_NUMBER() OVER (
            PARTITION BY schema_name, plot_id, census_id
            ORDER BY last_heartbeat DESC, updated_at DESC, created_at DESC, session_id DESC
          ) AS row_num
        FROM ${schema}.upload_sessions
        WHERE state IN (${ACTIVE_UPLOAD_SESSION_STATE_LIST})
      )
      UPDATE ${schema}.upload_sessions target
      INNER JOIN ranked_sessions ranked
        ON ranked.session_id = target.session_id
      SET target.state = '${UploadSessionState.ABANDONED}',
          target.error_message = CONCAT_WS(' | ', NULLIF(target.error_message, ''), 'Superseded while enforcing active scope lock')
      WHERE ranked.row_num > 1
    `
  );
}

// Cache which schemas have already had the scope lock verified in this process lifetime.
// This avoids running information_schema queries and potential DDL on every session creation.
const verifiedScopeLockSchemas = new Set<string>();

async function ensureUploadSessionScopeLock(conn: PoolConnection, schema: string): Promise<void> {
  if (verifiedScopeLockSchemas.has(schema)) {
    return;
  }

  const hasActiveScopeKey = await hasColumn(conn, schema, 'upload_sessions', ACTIVE_SCOPE_KEY_COLUMN_NAME);
  if (!hasActiveScopeKey) {
    await runQuery(
      conn,
      `
        ALTER TABLE ${schema}.upload_sessions
        ADD COLUMN ${ACTIVE_SCOPE_KEY_COLUMN_NAME} VARCHAR(255)
        GENERATED ALWAYS AS (
          CASE
            WHEN state IN (${ACTIVE_UPLOAD_SESSION_STATE_LIST}) THEN CONCAT_WS('#', schema_name, plot_id, census_id)
            ELSE NULL
          END
        ) STORED
      `
    );
  }

  await abandonDuplicateActiveScopeSessions(conn, schema);

  const hasActiveScopeIndex = await hasIndex(conn, schema, 'upload_sessions', ACTIVE_SCOPE_KEY_INDEX_NAME);
  if (!hasActiveScopeIndex) {
    await runQuery(conn, `ALTER TABLE ${schema}.upload_sessions ADD UNIQUE INDEX ${ACTIVE_SCOPE_KEY_INDEX_NAME} (${ACTIVE_SCOPE_KEY_COLUMN_NAME})`);
  }

  verifiedScopeLockSchemas.add(schema);
}

async function abandonStaleSessionsForScope(schema: string, plotId: number, censusId: number, contextLabel: string): Promise<void> {
  const activeSessions = await findActiveSessionsForPlotCensus(schema, plotId, censusId);
  for (const activeSession of activeSessions) {
    if (!isUploadSessionStale(activeSession)) {
      continue;
    }

    ailogger.warn(`[UploadSessionTracker] Marking stale session ${activeSession.sessionId} as abandoned before ${contextLabel}`);
    await updateSessionState(schema, activeSession.sessionId, UploadSessionState.ABANDONED, getStaleSessionReason(contextLabel));
  }
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `upload_${timestamp}_${random}`;
}

/**
 * Generate an idempotency key based on upload parameters
 */
export function generateIdempotencyKey(schema: string, plotId: number, censusId: number, fileHash: string): string {
  return `${schema}_${plotId}_${censusId}_${fileHash}`;
}

/**
 * Create the upload_sessions table if it doesn't exist
 */
export async function ensureUploadSessionsTable(schema: string): Promise<void> {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS ${schema}.upload_sessions (
      session_id VARCHAR(64) PRIMARY KEY,
      schema_name VARCHAR(64) NOT NULL,
      plot_id INT NOT NULL,
      census_id INT NOT NULL,
      user_id VARCHAR(255) NOT NULL,
      state ENUM('initialized', 'uploading', 'uploaded', 'processing', 'collapsing', 'completed', 'failed', 'abandoned', 'cleaned_up') NOT NULL DEFAULT 'initialized',
      file_id VARCHAR(255),
      total_chunks INT DEFAULT 0,
      uploaded_chunks INT DEFAULT 0,
      processed_batches INT DEFAULT 0,
      total_batches INT DEFAULT 0,
      last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      error_message TEXT,
      idempotency_key VARCHAR(255),
      active_scope_key VARCHAR(255)
        GENERATED ALWAYS AS (
          CASE
            WHEN state IN (${ACTIVE_UPLOAD_SESSION_STATE_LIST}) THEN CONCAT_WS('#', schema_name, plot_id, census_id)
            ELSE NULL
          END
        ) STORED,
      INDEX idx_state (state),
      INDEX idx_heartbeat (last_heartbeat),
      INDEX idx_plot_census (plot_id, census_id),
      INDEX idx_idempotency (idempotency_key),
      UNIQUE INDEX ${ACTIVE_SCOPE_KEY_INDEX_NAME} (${ACTIVE_SCOPE_KEY_COLUMN_NAME})
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `;

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    await runQuery(conn, createTableSQL);
    await ensureUploadSessionScopeLock(conn, schema);
    ailogger.info(`[UploadSessionTracker] Ensured upload_sessions table exists in ${schema}`);
  } catch (error: unknown) {
    ailogger.error('[UploadSessionTracker] Failed to create upload_sessions table:', error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Create a new upload session
 */
export async function createUploadSession(
  schema: string,
  plotId: number,
  censusId: number,
  userId: string,
  fileId: string,
  totalChunks: number,
  idempotencyKey?: string
): Promise<UploadSession> {
  const sessionId = generateSessionId();

  // Check for existing session with same idempotency key
  if (idempotencyKey) {
    const existing = await findSessionByIdempotencyKey(schema, idempotencyKey);
    if (existing) {
      // If session completed successfully, return it (idempotent)
      if (existing.state === UploadSessionState.COMPLETED) {
        ailogger.info(`[UploadSessionTracker] Returning existing completed session for idempotency key: ${idempotencyKey}`);
        return existing;
      }
      // If session is in progress, return it to allow resume
      if (
        existing.state === UploadSessionState.INITIALIZED ||
        existing.state === UploadSessionState.UPLOADING ||
        existing.state === UploadSessionState.UPLOADED ||
        existing.state === UploadSessionState.PROCESSING ||
        existing.state === UploadSessionState.COLLAPSING
      ) {
        ailogger.info(`[UploadSessionTracker] Returning existing in-progress session for idempotency key: ${idempotencyKey}`);
        return existing;
      }
      // If session failed or was abandoned, allow new attempt
      ailogger.info(`[UploadSessionTracker] Previous session ${existing.sessionId} was ${existing.state}, creating new session`);
    }
  }

  await abandonStaleSessionsForScope(schema, plotId, censusId, `session creation for plot ${plotId}, census ${censusId}`);

  const insertSQL = `
    INSERT INTO ${schema}.upload_sessions (
      session_id, schema_name, plot_id, census_id, user_id, state, file_id,
      total_chunks, uploaded_chunks, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `;

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    await ensureUploadSessionScopeLock(conn, schema);
    await runQuery(conn, insertSQL, [sessionId, schema, plotId, censusId, userId, UploadSessionState.INITIALIZED, fileId, totalChunks, idempotencyKey || null]);

    ailogger.info(`[UploadSessionTracker] Created session ${sessionId} for plot ${plotId}, census ${censusId}`);

    return {
      sessionId,
      schema,
      plotId,
      censusId,
      userId,
      state: UploadSessionState.INITIALIZED,
      fileId,
      totalChunks,
      uploadedChunks: 0,
      processedBatches: 0,
      totalBatches: 0,
      lastHeartbeat: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      idempotencyKey
    };
  } catch (error: unknown) {
    if (isActiveScopeDuplicateKeyError(error)) {
      const activeSessions = await findActiveSessionsForPlotCensus(schema, plotId, censusId);
      const activeSession = activeSessions[0];

      if (activeSession) {
        if (idempotencyKey && activeSession.idempotencyKey === idempotencyKey) {
          ailogger.info(`[UploadSessionTracker] Returning existing active session ${activeSession.sessionId} for idempotency key: ${idempotencyKey}`);
          return activeSession;
        }

        if (isUploadSessionStale(activeSession)) {
          if (!conn) {
            throw error;
          }
          await updateSessionState(
            schema,
            activeSession.sessionId,
            UploadSessionState.ABANDONED,
            getStaleSessionReason(`session creation retry for plot ${plotId}, census ${censusId}`)
          );
          await runQuery(conn, insertSQL, [
            sessionId,
            schema,
            plotId,
            censusId,
            userId,
            UploadSessionState.INITIALIZED,
            fileId,
            totalChunks,
            idempotencyKey || null
          ]);

          ailogger.info(`[UploadSessionTracker] Created session ${sessionId} after reclaiming stale scope lock for plot ${plotId}, census ${censusId}`);
          return {
            sessionId,
            schema,
            plotId,
            censusId,
            userId,
            state: UploadSessionState.INITIALIZED,
            fileId,
            totalChunks,
            uploadedChunks: 0,
            processedBatches: 0,
            totalBatches: 0,
            lastHeartbeat: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
            idempotencyKey
          };
        }

        throw new UploadSessionOwnershipError(
          `Another upload is in progress for Plot ${plotId}, Census ${censusId}. Session: ${activeSession.sessionId}`
        );
      }
    }

    throw error;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Update session state
 */
export async function updateSessionState(schema: string, sessionId: string, state: UploadSessionState, errorMessage?: string): Promise<void> {
  const updateSQL = `
    UPDATE ${schema}.upload_sessions
    SET state = ?, error_message = ?, last_heartbeat = CURRENT_TIMESTAMP
    WHERE session_id = ?
  `;

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    await runQuery(conn, updateSQL, [state, errorMessage || null, sessionId]);
    ailogger.info(`[UploadSessionTracker] Updated session ${sessionId} to state: ${state}`);
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Update session progress (chunk/batch counts)
 */
export async function updateSessionProgress(
  schema: string,
  sessionId: string,
  updates: {
    uploadedChunks?: number;
    processedBatches?: number;
    totalBatches?: number;
    state?: UploadSessionState;
  }
): Promise<void> {
  const setClauses: string[] = ['last_heartbeat = CURRENT_TIMESTAMP'];
  const values: any[] = [];

  if (updates.uploadedChunks !== undefined) {
    setClauses.push('uploaded_chunks = ?');
    values.push(updates.uploadedChunks);
  }
  if (updates.processedBatches !== undefined) {
    setClauses.push('processed_batches = ?');
    values.push(updates.processedBatches);
  }
  if (updates.totalBatches !== undefined) {
    setClauses.push('total_batches = ?');
    values.push(updates.totalBatches);
  }
  if (updates.state !== undefined) {
    setClauses.push('state = ?');
    values.push(updates.state);
  }

  values.push(sessionId);

  const updateSQL = `UPDATE ${schema}.upload_sessions SET ${setClauses.join(', ')} WHERE session_id = ?`;

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    await runQuery(conn, updateSQL, values);
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Send heartbeat for a session
 */
export async function sendHeartbeat(schema: string, sessionId: string): Promise<boolean> {
  const updateSQL = `
    UPDATE ${schema}.upload_sessions
    SET last_heartbeat = CURRENT_TIMESTAMP
    WHERE session_id = ? AND state NOT IN ('completed', 'failed', 'abandoned', 'cleaned_up')
  `;

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const result = await runQuery(conn, updateSQL, [sessionId]);
    return (result as any).affectedRows > 0;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Get session by ID
 */
export async function getSession(schema: string, sessionId: string): Promise<UploadSession | null> {
  const selectSQL = `
    SELECT session_id, schema_name, plot_id, census_id, user_id, state, file_id,
           total_chunks, uploaded_chunks, processed_batches, total_batches,
           last_heartbeat, created_at, updated_at, error_message, idempotency_key
    FROM ${schema}.upload_sessions
    WHERE session_id = ?
  `;

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const results = await runQuery(conn, selectSQL, [sessionId]);
    if (!Array.isArray(results) || results.length === 0) return null;

    const row = results[0] as any;
    return mapRowToSession(row);
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Find session by idempotency key
 */
export async function findSessionByIdempotencyKey(schema: string, idempotencyKey: string): Promise<UploadSession | null> {
  const selectSQL = `
    SELECT session_id, schema_name, plot_id, census_id, user_id, state, file_id,
           total_chunks, uploaded_chunks, processed_batches, total_batches,
           last_heartbeat, created_at, updated_at, error_message, idempotency_key
    FROM ${schema}.upload_sessions
    WHERE idempotency_key = ?
    ORDER BY created_at DESC
    LIMIT 1
  `;

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const results = await runQuery(conn, selectSQL, [idempotencyKey]);
    if (!Array.isArray(results) || results.length === 0) return null;

    return mapRowToSession(results[0] as any);
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Find active sessions for a plot/census
 */
export async function findActiveSessionsForPlotCensus(schema: string, plotId: number, censusId: number): Promise<UploadSession[]> {
  const selectSQL = `
    SELECT session_id, schema_name, plot_id, census_id, user_id, state, file_id,
           total_chunks, uploaded_chunks, processed_batches, total_batches,
           last_heartbeat, created_at, updated_at, error_message, idempotency_key
    FROM ${schema}.upload_sessions
    WHERE plot_id = ? AND census_id = ? AND state IN (${ACTIVE_UPLOAD_SESSION_STATE_LIST})
    ORDER BY last_heartbeat DESC, updated_at DESC, created_at DESC
  `;

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const results = await runQuery(conn, selectSQL, [plotId, censusId]);
    if (!Array.isArray(results)) return [];

    return results.map((row: any) => mapRowToSession(row));
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Find stale/abandoned sessions that need cleanup
 */
export async function findStaleSessions(schema: string): Promise<UploadSession[]> {
  const selectSQL = `
    SELECT session_id, schema_name, plot_id, census_id, user_id, state, file_id,
           total_chunks, uploaded_chunks, processed_batches, total_batches,
           last_heartbeat, created_at, updated_at, error_message, idempotency_key
    FROM ${schema}.upload_sessions
    WHERE state IN ('initialized', 'uploading', 'uploaded', 'processing', 'collapsing')
      AND last_heartbeat < DATE_SUB(NOW(), INTERVAL ? SECOND)
    ORDER BY last_heartbeat ASC
  `;

  const timeoutSeconds = Math.floor(SESSION_TIMEOUTS.HEARTBEAT_TIMEOUT / 1000);

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const results = await runQuery(conn, selectSQL, [timeoutSeconds]);
    if (!Array.isArray(results)) return [];

    return results.map((row: any) => mapRowToSession(row));
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Find abandoned sessions that need data cleanup
 */
export async function findAbandonedSessionsNeedingCleanup(schema: string): Promise<UploadSession[]> {
  const selectSQL = `
    SELECT session_id, schema_name, plot_id, census_id, user_id, state, file_id,
           total_chunks, uploaded_chunks, processed_batches, total_batches,
           last_heartbeat, created_at, updated_at, error_message, idempotency_key
    FROM ${schema}.upload_sessions
    WHERE state = 'abandoned'
      AND updated_at < DATE_SUB(NOW(), INTERVAL ? SECOND)
    ORDER BY updated_at ASC
  `;

  const gracePeriodSeconds = Math.floor(SESSION_TIMEOUTS.CLEANUP_GRACE_PERIOD / 1000);

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const results = await runQuery(conn, selectSQL, [gracePeriodSeconds]);
    if (!Array.isArray(results)) return [];

    return results.map((row: any) => mapRowToSession(row));
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Clean up orphaned data for a session
 */
export async function cleanupOrphanedData(schema: string, session: UploadSession): Promise<{ temporaryDeleted: number; failedDeleted: number }> {
  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | null = null;
  let temporaryDeleted = 0;
  let failedDeleted = 0;
  let cleanupNote = 'Cleanup: deleted 0 temp rows';

  try {
    transactionID = await connectionManager.beginTransaction();

    // Move orphaned temporarymeasurements for the whole scope once no other active scope owner exists.
    if (session.fileId) {
      const overlappingActiveSessionsSQL = `
        SELECT session_id
        FROM ${schema}.upload_sessions
        WHERE plot_id = ?
          AND census_id = ?
          AND session_id <> ?
          AND state IN (${ACTIVE_UPLOAD_SESSION_STATE_LIST})
          AND last_heartbeat >= DATE_SUB(NOW(), INTERVAL ? SECOND)
        ORDER BY updated_at DESC
        LIMIT 1
      `;
      const heartbeatTimeoutSeconds = Math.floor(SESSION_TIMEOUTS.HEARTBEAT_TIMEOUT / 1000);
      const overlappingSessions = await connectionManager.executeQuery(
        overlappingActiveSessionsSQL,
        [session.plotId, session.censusId, session.sessionId, heartbeatTimeoutSeconds],
        transactionID ?? undefined
      );

      if (Array.isArray(overlappingSessions) && overlappingSessions.length > 0) {
        const newerSessionId = (overlappingSessions[0] as { session_id?: string }).session_id ?? 'unknown';
        cleanupNote = `Cleanup skipped: active session ${newerSessionId} still owns plot ${session.plotId}, census ${session.censusId}`;
        ailogger.warn(
          `[UploadSessionTracker] Skipping temporarymeasurement cleanup for session ${session.sessionId} because active session ${newerSessionId} still owns plot ${session.plotId}, census ${session.censusId}`
        );
      } else {
        const selectBatchSQL = `
          SELECT DISTINCT FileID, BatchID
          FROM ${schema}.temporarymeasurements
          WHERE PlotID = ?
            AND CensusID = ?
          ORDER BY FileID, BatchID
        `;
        const batchRows = await connectionManager.executeQuery(selectBatchSQL, [session.plotId, session.censusId], transactionID ?? undefined);
        const batches = Array.isArray(batchRows)
          ? batchRows
              .map((row: any) => ({ fileId: row.FileID as string | null, batchId: row.BatchID as string | null }))
              .filter((row): row is { fileId: string; batchId: string } => Boolean(row.fileId) && Boolean(row.batchId))
          : [];

        for (const { fileId, batchId } of batches) {
          const movedRows = await moveTemporaryBatchToFailedMeasurements(
            connectionManager,
            schema,
            fileId,
            batchId,
            'Upload session cleaned up after abandonment',
            transactionID ?? undefined
          );
          temporaryDeleted += movedRows;
          failedDeleted += movedRows;
        }

        cleanupNote = failedDeleted > 0 ? `Cleanup: moved ${failedDeleted} temp rows to unresolved failures` : `Cleanup: deleted ${temporaryDeleted} temp rows`;
      }
    }

    // Mark session as cleaned up
    const updateSQL = `
      UPDATE ${schema}.upload_sessions
      SET state = 'cleaned_up', error_message = CONCAT(COALESCE(error_message, ''), ' | ', ?)
      WHERE session_id = ?
    `;
    await connectionManager.executeQuery(updateSQL, [cleanupNote, session.sessionId], transactionID ?? undefined);
    await connectionManager.commitTransaction(transactionID!);

    ailogger.info(`[UploadSessionTracker] Cleaned up session ${session.sessionId}: ${temporaryDeleted} temporary rows deleted`);

    return { temporaryDeleted, failedDeleted };
  } catch (error: unknown) {
    if (transactionID) {
      await connectionManager.rollbackTransaction(transactionID);
    }
    ailogger.error(`[UploadSessionTracker] Failed to cleanup session ${session.sessionId}:`, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Run cleanup for all stale and abandoned sessions
 */
export async function runSessionCleanup(schema: string): Promise<{
  staleMarked: number;
  cleanedUp: number;
  totalTempDeleted: number;
}> {
  let staleMarked = 0;
  let cleanedUp = 0;
  let totalTempDeleted = 0;

  // First, mark stale sessions as abandoned
  const staleSessions = await findStaleSessions(schema);
  for (const session of staleSessions) {
    try {
      await updateSessionState(schema, session.sessionId, UploadSessionState.ABANDONED, 'Session timed out - no heartbeat received');
      staleMarked++;
    } catch (error: unknown) {
      ailogger.error(
        `[UploadSessionTracker] Failed to mark session ${session.sessionId} as abandoned:`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Then, cleanup abandoned sessions past grace period
  const abandonedSessions = await findAbandonedSessionsNeedingCleanup(schema);
  for (const session of abandonedSessions) {
    try {
      const result = await cleanupOrphanedData(schema, session);
      cleanedUp++;
      totalTempDeleted += result.temporaryDeleted;
    } catch (error: unknown) {
      ailogger.error(`[UploadSessionTracker] Failed to cleanup session ${session.sessionId}:`, error instanceof Error ? error : new Error(String(error)));
    }
  }

  if (staleMarked > 0 || cleanedUp > 0) {
    ailogger.info(
      `[UploadSessionTracker] Cleanup complete: ${staleMarked} sessions marked abandoned, ${cleanedUp} sessions cleaned up, ${totalTempDeleted} temp rows deleted`
    );
  }

  return { staleMarked, cleanedUp, totalTempDeleted };
}

/**
 * Delete old completed/cleaned sessions (housekeeping)
 */
export async function purgeOldSessions(schema: string, maxAgeDays: number = 30): Promise<number> {
  const deleteSQL = `
    DELETE FROM ${schema}.upload_sessions
    WHERE state IN ('completed', 'cleaned_up')
      AND updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)
  `;

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const result = await runQuery(conn, deleteSQL, [maxAgeDays]);
    const deleted = (result as any).affectedRows || 0;
    if (deleted > 0) {
      ailogger.info(`[UploadSessionTracker] Purged ${deleted} old sessions`);
    }
    return deleted;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Helper to map database row to UploadSession object
 */
function mapRowToSession(row: any): UploadSession {
  return {
    sessionId: row.session_id,
    schema: row.schema_name,
    plotId: row.plot_id,
    censusId: row.census_id,
    userId: row.user_id,
    state: row.state as UploadSessionState,
    fileId: row.file_id,
    totalChunks: row.total_chunks,
    uploadedChunks: row.uploaded_chunks,
    processedBatches: row.processed_batches,
    totalBatches: row.total_batches,
    lastHeartbeat: new Date(row.last_heartbeat),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    errorMessage: row.error_message,
    idempotencyKey: row.idempotency_key
  };
}

export async function requireUploadSessionOwnership(options: RequireUploadSessionOwnershipOptions): Promise<UploadSession> {
  const { schema, sessionId, censusId, plotId, allowedStates, contextLabel } = options;

  if (!sessionId) {
    throw new UploadSessionOwnershipError(`Upload session is required for ${contextLabel}`);
  }

  const session = await getSession(schema, sessionId);
  if (!session) {
    throw new UploadSessionOwnershipError(`Upload session ${sessionId} was not found for ${contextLabel}`);
  }

  if (plotId !== undefined && session.plotId !== plotId) {
    throw new UploadSessionOwnershipError(
      `Upload session ${sessionId} does not own plot ${plotId} for ${contextLabel} (session plot: ${session.plotId})`
    );
  }

  if (session.censusId !== censusId) {
    throw new UploadSessionOwnershipError(
      `Upload session ${sessionId} does not own census ${censusId} for ${contextLabel} (session census: ${session.censusId})`
    );
  }

  if (isUploadSessionStale(session)) {
    await updateSessionState(schema, session.sessionId, UploadSessionState.ABANDONED, getStaleSessionReason(contextLabel));
    throw new UploadSessionOwnershipError(`Upload session ${sessionId} expired before ${contextLabel}`);
  }

  if (!allowedStates.includes(session.state)) {
    throw new UploadSessionOwnershipError(
      `Upload session ${sessionId} is in state ${session.state}, not one of: ${allowedStates.join(', ')}`
    );
  }

  return session;
}
