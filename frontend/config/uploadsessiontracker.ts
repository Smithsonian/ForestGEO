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
      INDEX idx_state (state),
      INDEX idx_heartbeat (last_heartbeat),
      INDEX idx_plot_census (plot_id, census_id),
      INDEX idx_idempotency (idempotency_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `;

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    await runQuery(conn, createTableSQL);
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
        existing.state === UploadSessionState.UPLOADING ||
        existing.state === UploadSessionState.UPLOADED ||
        existing.state === UploadSessionState.PROCESSING
      ) {
        ailogger.info(`[UploadSessionTracker] Returning existing in-progress session for idempotency key: ${idempotencyKey}`);
        return existing;
      }
      // If session failed or was abandoned, allow new attempt
      ailogger.info(`[UploadSessionTracker] Previous session ${existing.sessionId} was ${existing.state}, creating new session`);
    }
  }

  // Check for any active sessions for the same plot/census
  const activeSessions = await findActiveSessionsForPlotCensus(schema, plotId, censusId);
  if (activeSessions.length > 0) {
    const activeSession = activeSessions[0];
    // Check if session is truly active (has recent heartbeat)
    const heartbeatAge = Date.now() - new Date(activeSession.lastHeartbeat).getTime();
    if (heartbeatAge < SESSION_TIMEOUTS.HEARTBEAT_TIMEOUT) {
      throw new Error(`Another upload is in progress for Plot ${plotId}, Census ${censusId}. Session: ${activeSession.sessionId}`);
    } else {
      // Session appears stale, mark as abandoned
      ailogger.warn(`[UploadSessionTracker] Marking stale session ${activeSession.sessionId} as abandoned`);
      await updateSessionState(schema, activeSession.sessionId, UploadSessionState.ABANDONED, 'Stale session detected - no heartbeat');
    }
  }

  const insertSQL = `
    INSERT INTO ${schema}.upload_sessions (
      session_id, schema_name, plot_id, census_id, user_id, state, file_id,
      total_chunks, uploaded_chunks, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `;

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
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
    WHERE plot_id = ? AND census_id = ? AND state IN ('initialized', 'uploading', 'uploaded', 'processing', 'collapsing')
    ORDER BY created_at DESC
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
  let conn: PoolConnection | null = null;
  let temporaryDeleted = 0;
  let failedDeleted = 0;

  try {
    conn = await getConn();

    // Start transaction for cleanup
    await runQuery(conn, 'START TRANSACTION');

    // Delete from temporarymeasurements
    if (session.fileId) {
      const deleteTempSQL = `DELETE FROM ${schema}.temporarymeasurements WHERE FileID = ?`;
      const tempResult = await runQuery(conn, deleteTempSQL, [session.fileId]);
      temporaryDeleted = (tempResult as any).affectedRows || 0;
    }

    // Note: We don't automatically delete failed measurements (coremeasurements with
    // StemGUID=NULL + measurement_error_log) as those might be legitimate failures
    // the user wants to review. We only clean up temporary data.

    // Mark session as cleaned up
    const updateSQL = `
      UPDATE ${schema}.upload_sessions
      SET state = 'cleaned_up', error_message = CONCAT(COALESCE(error_message, ''), ' | Cleanup: deleted ', ?, ' temp rows')
      WHERE session_id = ?
    `;
    await runQuery(conn, updateSQL, [temporaryDeleted, session.sessionId]);

    await runQuery(conn, 'COMMIT');

    ailogger.info(`[UploadSessionTracker] Cleaned up session ${session.sessionId}: ${temporaryDeleted} temporary rows deleted`);

    return { temporaryDeleted, failedDeleted };
  } catch (error: unknown) {
    if (conn) {
      await runQuery(conn, 'ROLLBACK').catch(() => {});
    }
    ailogger.error(`[UploadSessionTracker] Failed to cleanup session ${session.sessionId}:`, error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    if (conn) conn.release();
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
