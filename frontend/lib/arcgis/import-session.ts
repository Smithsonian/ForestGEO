import crypto from 'crypto';
import { format } from 'mysql2/promise';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { UploadMode } from '@/config/uploadmodes';
import { UploadSessionState } from '@/config/uploadsessiontracker';
import { measurementFileIDValidationError } from '@/lib/uploads/file-names';
import { deriveArcgisCommitBatchID, SubBatchOrdinalOverflowError, subBatchIDForRowOrdinal } from '@/lib/uploads/batch-family';
import { lockActiveUploadSessionForCensus } from '@/lib/uploads/upload-session-replacement-marker';
import type { FileRow } from '@/config/macros/formdetails';
import type { ArcgisImportReference, TransformResult, TransformSummary, TransformWarning } from './types';

export class ArcgisImportSessionError extends Error {
  status: HTTPResponses;

  constructor(message: string, status: HTTPResponses = HTTPResponses.INVALID_REQUEST) {
    super(message);
    this.name = 'ArcgisImportSessionError';
    this.status = status;
  }
}

export const ARCGIS_IMPORT_SESSION_STATE = {
  PREFLIGHT: 'preflight',
  COMMITTING: 'committing',
  COMMITTED: 'committed'
} as const;
export type ArcgisImportSessionState = (typeof ARCGIS_IMPORT_SESSION_STATE)[keyof typeof ARCGIS_IMPORT_SESSION_STATE];

/** A newer attempt claimed this import (#561); the older attempt stops at its next unit without writing. */
export class ArcgisCommitSupersededError extends ArcgisImportSessionError {
  readonly importSessionId: string;
  readonly attemptID: string;
  readonly currentAttemptID: string | null;

  constructor(importSessionId: string, attemptID: string, currentAttemptID: string | null) {
    super(
      `ArcGIS import ${importSessionId} was claimed by a newer commit attempt (${currentAttemptID ?? 'none'}); attempt ${attemptID} stopped without writing.`,
      HTTPResponses.CONFLICT
    );
    this.name = 'ArcgisCommitSupersededError';
    this.importSessionId = importSessionId;
    this.attemptID = attemptID;
    this.currentAttemptID = currentAttemptID;
  }
}

export interface ArcgisStagingAccountingDetail {
  importSessionId: string;
  firstRowIndex: number;
  sourceRows: number;
  insertedRows: number;
  droppedCandidates: number;
  persistedFailureRows: number;
}

/** A staging window whose inserted plus recorded rows do not account for every source row (#561, F2); the window rolls back. */
export class ArcgisStagingAccountingError extends ArcgisImportSessionError {
  readonly detail: ArcgisStagingAccountingDetail;

  constructor(detail: ArcgisStagingAccountingDetail) {
    super(
      `ArcGIS import ${detail.importSessionId}: the staging window at row ${detail.firstRowIndex} accounted for ` +
        `${detail.insertedRows + detail.persistedFailureRows} of its source rows (n=${detail.sourceRows}, k=${detail.insertedRows}, ` +
        `candidates=${detail.droppedCandidates}, persisted=${detail.persistedFailureRows}); the window was rolled back. Re-run the workbook pre-flight step.`,
      HTTPResponses.UNPROCESSABLE_ENTITY
    );
    this.name = 'ArcgisStagingAccountingError';
    this.detail = detail;
  }
}

/** A state the commit's own locks rule out (#561). Not an ArcgisImportSessionError: the route answers 500 and the worker retries, which restarts. */
export class ArcgisImportSessionInvariantError extends Error {
  constructor(importSessionId: string, detail: string) {
    super(`ArcGIS import ${importSessionId}: ${detail}`);
    this.name = 'ArcgisImportSessionInvariantError';
  }
}

export const ARCGIS_COMMIT_CLAIM_KIND = {
  ALREADY_COMMITTED: 'already_committed',
  CLAIMED: 'claimed',
  RESTARTED: 'restarted',
  TAKEN_OVER: 'taken_over'
} as const;
export type ArcgisCommitClaimKind = (typeof ARCGIS_COMMIT_CLAIM_KIND)[keyof typeof ARCGIS_COMMIT_CLAIM_KIND];

export interface ArcgisCommitClaimInput {
  schema: string;
  importSessionId: string;
  plotID: number;
  censusID: number;
  userId: string;
  fileName: string;
  /** Consulted only to replay a session committed before #561 (NULL mode); ignored otherwise (D28). */
  requestBatchID: string | null;
  uploadMode: UploadMode;
  uploadSessionID: string;
  attemptID: string;
}

export interface ArcgisCommitClaim {
  kind: ArcgisCommitClaimKind;
  batchID: string;
  previousUploadSessionID: string | null;
  fileName: string;
  rowCount: number;
}

interface CreateArcgisImportSessionInput {
  schema: string;
  plotID: number;
  censusID: number;
  userId: string;
  fileName: string;
  result: TransformResult;
}

interface ArcgisSessionScope {
  userId: string;
  plotID: number;
  censusID: number;
  fileName: string;
}

interface ArcgisSessionRow {
  import_session_id?: string;
  user_id: string;
  plot_id: number;
  census_id: number;
  file_id: string;
  row_count?: number;
  summary_json?: unknown;
  warnings_json?: unknown;
  state: string;
  committed_file_id?: string | null;
  committed_batch_id?: string | null;
  committed_upload_session_id?: string | null;
  committed_row_count?: number | null;
  committed_at?: Date | string | null;
  committed_upload_mode?: string | null;
  commit_attempt_id?: string | null;
  census_replacement_completed_at?: Date | string | null;
  staging_next_row_index?: number;
}

const STAGED_ROW_BATCH_SIZE = 1000;
const ARCGIS_SESSION_CLEANUP_MAX_AGE_SECONDS = 24 * 60 * 60;
const verifiedArcgisImportSchemas = new Set<string>();

export interface LoadedArcgisImportSession {
  rows: FileRow[];
  rowCount: number;
  fileName: string;
  summary: TransformSummary;
  warnings: TransformWarning[];
}

export type ClaimedArcgisImportSession =
  | (LoadedArcgisImportSession & { alreadyCommitted: false })
  | {
      alreadyCommitted: true;
      rowCount: number;
      fileName: string;
      committedBatchID: string;
      committedUploadSessionID: string | null;
    };

export function assertUploadableArcgisSession(session: ArcgisSessionRow | null, scope: ArcgisSessionScope): asserts session is ArcgisSessionRow {
  if (!session) {
    throw new ArcgisImportSessionError('ArcGIS import session was not found. Re-run the workbook pre-flight step.', HTTPResponses.NOT_FOUND);
  }
  if (session.user_id !== scope.userId) {
    throw new ArcgisImportSessionError('ArcGIS import session does not belong to the authenticated user.', HTTPResponses.FORBIDDEN);
  }
  if (Number(session.plot_id) !== scope.plotID || Number(session.census_id) !== scope.censusID) {
    throw new ArcgisImportSessionError('ArcGIS import session scope does not match the requested plot/census.', HTTPResponses.CONFLICT);
  }
  if (session.file_id !== scope.fileName) {
    throw new ArcgisImportSessionError('ArcGIS import session file does not match the requested file.', HTTPResponses.CONFLICT);
  }
  if (session.state !== ARCGIS_IMPORT_SESSION_STATE.PREFLIGHT) {
    throw new ArcgisImportSessionError(`ArcGIS import session is not uploadable from state "${session.state}".`, HTTPResponses.CONFLICT);
  }
}

function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}

export async function ensureArcgisImportTables(schema: string): Promise<void> {
  if (verifiedArcgisImportSchemas.has(schema)) return;

  const connectionManager = ConnectionManager.getInstance();
  await connectionManager.executeQuery(
    format(
      `CREATE TABLE IF NOT EXISTS ??.arcgis_import_sessions (
        import_session_id VARCHAR(64) NOT NULL PRIMARY KEY,
        plot_id INT NOT NULL,
        census_id INT NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        file_id VARCHAR(255) NOT NULL,
        row_count INT NOT NULL,
        warning_count INT NOT NULL,
        summary_json JSON NOT NULL,
        warnings_json JSON NOT NULL,
        state VARCHAR(32) NOT NULL DEFAULT 'preflight',
        committed_file_id VARCHAR(255) NULL,
        committed_batch_id VARCHAR(64) NULL,
        committed_upload_session_id VARCHAR(64) NULL,
        committed_row_count INT NULL,
        committed_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        committed_upload_mode VARCHAR(32) NULL DEFAULT NULL,
        commit_attempt_id VARCHAR(64) NULL DEFAULT NULL,
        census_replacement_completed_at TIMESTAMP NULL DEFAULT NULL,
        staging_next_row_index INT NOT NULL DEFAULT 0,
        KEY idx_arcgis_import_scope (plot_id, census_id, user_id, state),
        KEY idx_arcgis_import_committed_batch (committed_batch_id),
        KEY idx_arcgis_import_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      [schema]
    )
  );

  await connectionManager.executeQuery(
    format(
      `CREATE TABLE IF NOT EXISTS ??.arcgis_import_rows (
        import_session_id VARCHAR(64) NOT NULL,
        row_index INT NOT NULL,
        row_json JSON NOT NULL,
        PRIMARY KEY (import_session_id, row_index),
        CONSTRAINT fk_arcgis_import_rows_session
          FOREIGN KEY (import_session_id)
          REFERENCES ??.arcgis_import_sessions(import_session_id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      [schema, schema]
    )
  );

  verifiedArcgisImportSchemas.add(schema);
}

export async function createArcgisImportSession(input: CreateArcgisImportSessionInput): Promise<ArcgisImportReference> {
  await ensureArcgisImportTables(input.schema);

  const connectionManager = ConnectionManager.getInstance();
  const importSessionId = crypto.randomUUID();
  const rowCount = input.result.rows.length;

  await connectionManager.withTransaction(async tx => {
    const transactionID = tx.id;
    const deletePreviousSQL = format(
      `DELETE FROM ??.arcgis_import_sessions
       WHERE plot_id = ?
         AND census_id = ?
         AND user_id = ?
         AND state IN ('${ARCGIS_IMPORT_SESSION_STATE.PREFLIGHT}', '${ARCGIS_IMPORT_SESSION_STATE.COMMITTED}')`,
      [input.schema]
    );
    await connectionManager.executeQuery(deletePreviousSQL, [input.plotID, input.censusID, input.userId], transactionID);

    const insertSessionSQL = format(
      `INSERT INTO ??.arcgis_import_sessions
        (import_session_id, plot_id, census_id, user_id, file_id, row_count, warning_count, summary_json, warnings_json, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '${ARCGIS_IMPORT_SESSION_STATE.PREFLIGHT}')`,
      [input.schema]
    );
    await connectionManager.executeQuery(
      insertSessionSQL,
      [
        importSessionId,
        input.plotID,
        input.censusID,
        input.userId,
        input.fileName,
        rowCount,
        input.result.warnings.length,
        JSON.stringify(input.result.summary),
        JSON.stringify(input.result.warnings)
      ],
      transactionID
    );

    const insertRowsSQLPrefix = format(`INSERT INTO ??.arcgis_import_rows (import_session_id, row_index, row_json) VALUES `, [input.schema]);
    for (let start = 0; start < input.result.rows.length; start += STAGED_ROW_BATCH_SIZE) {
      const slice = input.result.rows.slice(start, start + STAGED_ROW_BATCH_SIZE);
      const placeholders = slice.map(() => `(?, ?, ?)`).join(', ');
      const values = slice.flatMap((row, index) => [importSessionId, start + index, JSON.stringify(row)]);
      await connectionManager.executeQuery(`${insertRowsSQLPrefix}${placeholders}`, values, transactionID);
    }
  });

  return { importSessionId, fileName: input.fileName, rowCount };
}

function defaultSummary(rowCount: number): TransformSummary {
  return {
    treesTransformed: 0,
    stemsJoined: 0,
    blankQuadratCount: 0,
    tagMismatchCount: 0,
    orphanStemsEmitted: 0,
    duplicateTreeTags: 0,
    duplicateGlobalIds: 0,
    missingRequired: 0,
    totalRows: rowCount
  };
}

async function loadArcgisSessionRow(
  connectionManager: ConnectionManager,
  schema: string,
  importSessionId: string,
  transactionID?: string,
  forUpdate: boolean = false
): Promise<ArcgisSessionRow | null> {
  const sessionSQL = safeFormatQuery(
    schema,
    `SELECT import_session_id, plot_id, census_id, user_id, file_id, row_count, summary_json, warnings_json, state,
            committed_file_id, committed_batch_id, committed_upload_session_id, committed_row_count, committed_at,
            committed_upload_mode, commit_attempt_id, census_replacement_completed_at, staging_next_row_index
     FROM ??.arcgis_import_sessions WHERE import_session_id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`
  );
  const sessionRows = await connectionManager.executeQuery(sessionSQL, [importSessionId], transactionID);
  return Array.isArray(sessionRows) ? ((sessionRows[0] as ArcgisSessionRow | undefined) ?? null) : null;
}

async function loadArcgisSessionRows(
  connectionManager: ConnectionManager,
  schema: string,
  importSessionId: string,
  transactionID?: string
): Promise<FileRow[]> {
  const rowsSQL = format(`SELECT row_json FROM ??.arcgis_import_rows WHERE import_session_id = ? ORDER BY row_index ASC`, [schema]);
  const rowRecords = await connectionManager.executeQuery(rowsSQL, [importSessionId], transactionID);
  return (Array.isArray(rowRecords) ? rowRecords : []).map((row: { row_json: unknown }) => parseJsonColumn<FileRow>(row.row_json, {} as FileRow));
}

function toLoadedSession(session: ArcgisSessionRow, rows: FileRow[]): LoadedArcgisImportSession {
  const rowCount = Number(session.row_count) || 0;
  return {
    rows,
    rowCount,
    fileName: session.file_id,
    summary: parseJsonColumn<TransformSummary>(session.summary_json, defaultSummary(rowCount)),
    warnings: parseJsonColumn<TransformWarning[]>(session.warnings_json, [])
  };
}

export async function loadStagedArcgisSession(input: {
  schema: string;
  importSessionId: string;
  plotID: number;
  censusID: number;
  userId: string;
  fileName: string;
}): Promise<LoadedArcgisImportSession> {
  await ensureArcgisImportTables(input.schema);
  const connectionManager = ConnectionManager.getInstance();
  const session = await loadArcgisSessionRow(connectionManager, input.schema, input.importSessionId);
  assertUploadableArcgisSession(session, {
    userId: input.userId,
    plotID: input.plotID,
    censusID: input.censusID,
    fileName: input.fileName
  });

  return toLoadedSession(session, await loadArcgisSessionRows(connectionManager, input.schema, input.importSessionId));
}

export async function claimArcgisImportSessionForCommit(
  input: {
    schema: string;
    importSessionId: string;
    plotID: number;
    censusID: number;
    userId: string;
    fileName: string;
    batchID: string;
    uploadSessionID: string | null;
  },
  transactionID: string
): Promise<ClaimedArcgisImportSession> {
  await ensureArcgisImportTables(input.schema);
  const connectionManager = ConnectionManager.getInstance();
  const session = await loadArcgisSessionRow(connectionManager, input.schema, input.importSessionId, transactionID, true);

  if (!session) {
    throw new ArcgisImportSessionError('ArcGIS import session was not found. Re-run the workbook pre-flight step.', HTTPResponses.NOT_FOUND);
  }
  if (session.user_id !== input.userId) {
    throw new ArcgisImportSessionError('ArcGIS import session does not belong to the authenticated user.', HTTPResponses.FORBIDDEN);
  }
  if (Number(session.plot_id) !== input.plotID || Number(session.census_id) !== input.censusID) {
    throw new ArcgisImportSessionError('ArcGIS import session scope does not match the requested plot/census.', HTTPResponses.CONFLICT);
  }
  if (session.file_id !== input.fileName) {
    throw new ArcgisImportSessionError('ArcGIS import session file does not match the requested file.', HTTPResponses.CONFLICT);
  }

  if (session.state === 'committed') {
    if (session.committed_batch_id === input.batchID) {
      return {
        alreadyCommitted: true,
        rowCount: Number(session.committed_row_count ?? session.row_count) || 0,
        fileName: session.committed_file_id || session.file_id,
        committedBatchID: session.committed_batch_id,
        committedUploadSessionID: session.committed_upload_session_id ?? null
      };
    }
    throw new ArcgisImportSessionError(
      `ArcGIS import session has already been committed to batch "${session.committed_batch_id || 'unknown'}". Re-run pre-flight before committing again.`,
      HTTPResponses.CONFLICT
    );
  }

  if (session.state !== 'preflight') {
    throw new ArcgisImportSessionError(`ArcGIS import session is not uploadable from state "${session.state}".`, HTTPResponses.CONFLICT);
  }

  // Reserve this preflight session for the in-flight commit: the row is already held under
  // SELECT ... FOR UPDATE, so this CAS on state = 'preflight' just claims it (affectedRows must be 1)
  // and records the batch/upload-session it is being committed to. State stays 'preflight' until
  // markArcgisImportSessionCommitted flips it to 'committed' at the end of the same transaction;
  // committed_row_count/committed_at are finalized there. If the transaction rolls back, these
  // committed_* writes revert with it, so no other request ever observes a half-committed preflight row.
  const claimSQL = format(
    `UPDATE ??.arcgis_import_sessions
     SET committed_file_id = file_id,
         committed_batch_id = ?,
         committed_upload_session_id = ?,
         committed_row_count = NULL,
         committed_at = NULL
     WHERE import_session_id = ? AND state = 'preflight'`,
    [input.schema]
  );
  const result = await connectionManager.executeQuery(claimSQL, [input.batchID, input.uploadSessionID, input.importSessionId], transactionID);
  if (Number((result as { affectedRows?: number })?.affectedRows ?? 0) !== 1) {
    throw new ArcgisImportSessionError('ArcGIS import session could not be claimed for commit. Retry the upload.', HTTPResponses.CONFLICT);
  }

  const rows = await loadArcgisSessionRows(connectionManager, input.schema, input.importSessionId, transactionID);
  return { ...toLoadedSession(session, rows), alreadyCommitted: false };
}

const IMPORT_ROWS_MISSING_MESSAGE = 'ArcGIS import rows are missing. Re-run the workbook pre-flight step.';
const EMPTY_IMPORT_MESSAGE = 'ArcGIS import session contains no rows';

function assertClaimScope(session: ArcgisSessionRow | null, input: ArcgisCommitClaimInput): asserts session is ArcgisSessionRow {
  if (!session) throw new ArcgisImportSessionError('ArcGIS import session was not found. Re-run the workbook pre-flight step.', HTTPResponses.NOT_FOUND);
  if (session.user_id !== input.userId)
    throw new ArcgisImportSessionError('ArcGIS import session does not belong to the authenticated user.', HTTPResponses.FORBIDDEN);
  if (Number(session.plot_id) !== input.plotID || Number(session.census_id) !== input.censusID) {
    throw new ArcgisImportSessionError('ArcGIS import session scope does not match the requested plot/census.', HTTPResponses.CONFLICT);
  }
  if (session.file_id !== input.fileName)
    throw new ArcgisImportSessionError('ArcGIS import session file does not match the requested file.', HTTPResponses.CONFLICT);
}

function replayCommittedSession(session: ArcgisSessionRow, input: ArcgisCommitClaimInput): ArcgisCommitClaim {
  const storedBatchID = session.committed_batch_id ?? '';
  const replay: ArcgisCommitClaim = {
    kind: ARCGIS_COMMIT_CLAIM_KIND.ALREADY_COMMITTED,
    batchID: storedBatchID,
    previousUploadSessionID: null,
    fileName: session.committed_file_id || session.file_id,
    rowCount: Number(session.committed_row_count ?? session.row_count) || 0
  };
  const recordedMode = session.committed_upload_mode ?? null;
  if (recordedMode !== null) {
    if (recordedMode === input.uploadMode) return replay;
    throw new ArcgisImportSessionError(
      `ArcGIS import session was committed as ${recordedMode}; re-run pre-flight to commit it as ${input.uploadMode}.`,
      HTTPResponses.CONFLICT
    );
  }
  // Committed before #561 stored modes: the batch was the client's, so the old replay rule still decides.
  if (input.requestBatchID !== null && input.requestBatchID === storedBatchID) return replay;
  throw new ArcgisImportSessionError(
    `ArcGIS import session has already been committed to batch "${storedBatchID || 'unknown'}". Re-run pre-flight before committing again.`,
    HTTPResponses.CONFLICT
  );
}

function assertResumableCommittingSession(session: ArcgisSessionRow, input: ArcgisCommitClaimInput, derivedBatchID: string): void {
  if (session.committed_upload_mode !== input.uploadMode) {
    throw new ArcgisImportSessionError(
      `ArcGIS import ${input.importSessionId} was claimed as ${session.committed_upload_mode}; retry with the same mode or re-run pre-flight.`,
      HTTPResponses.CONFLICT
    );
  }
  if (session.committed_batch_id !== derivedBatchID) {
    throw new ArcgisImportSessionInvariantError(
      input.importSessionId,
      `committing under batch ${session.committed_batch_id}, not the derived ${derivedBatchID}`
    );
  }
}

async function assertImportRowsWhole(
  connectionManager: ConnectionManager,
  input: ArcgisCommitClaimInput,
  rowCount: number,
  transactionID: string
): Promise<void> {
  if (rowCount <= 0) throw new ArcgisImportSessionError(EMPTY_IMPORT_MESSAGE, HTTPResponses.UNPROCESSABLE_ENTITY);
  const rangeSQL = safeFormatQuery(
    input.schema,
    `SELECT MIN(row_index) AS firstRowIndex, MAX(row_index) AS lastRowIndex FROM ??.arcgis_import_rows WHERE import_session_id = ?`
  );
  const rows = await connectionManager.executeQuery(rangeSQL, [input.importSessionId], transactionID);
  const range = Array.isArray(rows) ? (rows[0] as { firstRowIndex: number | null; lastRowIndex: number | null } | undefined) : undefined;
  if (Number(range?.firstRowIndex) !== 0 || Number(range?.lastRowIndex) !== rowCount - 1 || range?.firstRowIndex === null) {
    throw new ArcgisImportSessionError(IMPORT_ROWS_MISSING_MESSAGE, HTTPResponses.UNPROCESSABLE_ENTITY);
  }
}

function assertFreshClaimInputs(fileName: string, derivedBatchID: string, rowCount: number): void {
  const fileIDError = measurementFileIDValidationError(fileName);
  if (fileIDError) throw new ArcgisImportSessionError(fileIDError, HTTPResponses.INVALID_REQUEST);
  try {
    subBatchIDForRowOrdinal(derivedBatchID, rowCount - 1);
  } catch (error: unknown) {
    if (error instanceof SubBatchOrdinalOverflowError) throw new ArcgisImportSessionError(error.message, HTTPResponses.INVALID_REQUEST);
    throw error;
  }
}

async function lockPreviousUploadSession(
  connectionManager: ConnectionManager,
  schema: string,
  uploadSessionID: string,
  transactionID: string
): Promise<string | null> {
  const lockSQL = safeFormatQuery(schema, `SELECT state FROM ??.upload_sessions WHERE session_id = ? FOR UPDATE`);
  const rows = await connectionManager.executeQuery(lockSQL, [uploadSessionID], transactionID);
  return Array.isArray(rows) && rows.length === 1 ? String(rows[0].state) : null;
}

async function assertNoOtherCommittingImport(connectionManager: ConnectionManager, input: ArcgisCommitClaimInput, transactionID: string): Promise<void> {
  const probeSQL = safeFormatQuery(
    input.schema,
    `SELECT import_session_id FROM ??.arcgis_import_sessions WHERE state = ? AND committed_upload_session_id = ? AND import_session_id <> ? LIMIT 1`
  );
  const rows = await connectionManager.executeQuery(
    probeSQL,
    [ARCGIS_IMPORT_SESSION_STATE.COMMITTING, input.uploadSessionID, input.importSessionId],
    transactionID
  );
  if (Array.isArray(rows) && rows.length > 0) {
    throw new ArcgisImportSessionError(
      `Upload session ${input.uploadSessionID} is already committing ArcGIS import ${rows[0].import_session_id}; finish or abandon that upload first.`,
      HTTPResponses.CONFLICT
    );
  }
}

async function failAbandonedPredecessor(
  connectionManager: ConnectionManager,
  input: ArcgisCommitClaimInput,
  previousUploadSessionID: string,
  transactionID: string
): Promise<void> {
  const failSQL = safeFormatQuery(input.schema, `UPDATE ??.upload_sessions SET state = ?, error_message = ? WHERE session_id = ? AND state = ?`);
  await connectionManager.executeQuery(
    failSQL,
    [
      UploadSessionState.FAILED,
      `ArcGIS import ${input.importSessionId} was taken over by upload session ${input.uploadSessionID}`,
      previousUploadSessionID,
      UploadSessionState.ABANDONED
    ],
    transactionID
  );
}

async function writeCommitClaim(
  connectionManager: ConnectionManager,
  input: ArcgisCommitClaimInput,
  derivedBatchID: string,
  transactionID: string
): Promise<void> {
  const claimSQL = safeFormatQuery(
    input.schema,
    `UPDATE ??.arcgis_import_sessions
        SET state = ?, committed_file_id = file_id, committed_batch_id = ?, committed_upload_mode = ?,
            committed_upload_session_id = ?, commit_attempt_id = ?, committed_row_count = 0, committed_at = NULL, staging_next_row_index = 0, census_replacement_completed_at = NULL
      WHERE import_session_id = ?
        AND (state = ? OR (state = ? AND committed_batch_id = ? AND committed_upload_mode = ?))`
  );
  const result = await connectionManager.executeQuery(
    claimSQL,
    [
      ARCGIS_IMPORT_SESSION_STATE.COMMITTING,
      derivedBatchID,
      input.uploadMode,
      input.uploadSessionID,
      input.attemptID,
      input.importSessionId,
      ARCGIS_IMPORT_SESSION_STATE.PREFLIGHT,
      ARCGIS_IMPORT_SESSION_STATE.COMMITTING,
      derivedBatchID,
      input.uploadMode
    ],
    transactionID
  );
  if (Number((result as { affectedRows?: number })?.affectedRows ?? 0) !== 1) {
    throw new ArcgisImportSessionError('ArcGIS import session could not be claimed for commit. Retry the upload.', HTTPResponses.CONFLICT);
  }
}

/**
 * Unit C of an ArcGIS commit (#561), in its own transaction. Locks the import row, then (on a takeover) the previous
 * upload session's row, then the caller's; checks everything before writing anything, so a rejected claim leaves the
 * census, the staging table and the session exactly as they were (#504). The claim COMMITS on its own: from here the
 * import is `committing`, owned by `attemptID`, and every retry restarts from row 0 (spec §3).
 */
export async function claimArcgisImportCommitAttempt(
  connectionManager: ConnectionManager,
  input: ArcgisCommitClaimInput,
  transactionID: string
): Promise<ArcgisCommitClaim> {
  const session = await loadArcgisSessionRow(connectionManager, input.schema, input.importSessionId, transactionID, true);
  assertClaimScope(session, input);
  if (session.state === ARCGIS_IMPORT_SESSION_STATE.COMMITTED) return replayCommittedSession(session, input);

  const derivedBatchID = deriveArcgisCommitBatchID(input.importSessionId);
  const isFreshClaim = session.state === ARCGIS_IMPORT_SESSION_STATE.PREFLIGHT;
  if (session.state === ARCGIS_IMPORT_SESSION_STATE.COMMITTING) assertResumableCommittingSession(session, input, derivedBatchID);
  else if (!isFreshClaim) throw new ArcgisImportSessionError(`ArcGIS import session is not uploadable from state "${session.state}".`, HTTPResponses.CONFLICT);

  const rowCount = Number(session.row_count) || 0;
  await assertImportRowsWhole(connectionManager, input, rowCount, transactionID);
  if (isFreshClaim) assertFreshClaimInputs(session.file_id, derivedBatchID, rowCount);

  const previousUploadSessionID =
    !isFreshClaim && session.committed_upload_session_id && session.committed_upload_session_id !== input.uploadSessionID
      ? session.committed_upload_session_id
      : null;
  const previousSessionState = previousUploadSessionID
    ? await lockPreviousUploadSession(connectionManager, input.schema, previousUploadSessionID, transactionID)
    : null;
  await lockActiveUploadSessionForCensus(
    connectionManager,
    { schema: input.schema, plotID: input.plotID, censusID: input.censusID, uploadSessionID: input.uploadSessionID },
    transactionID
  );
  await assertNoOtherCommittingImport(connectionManager, input, transactionID);

  if (previousUploadSessionID && previousSessionState === UploadSessionState.ABANDONED) {
    await failAbandonedPredecessor(connectionManager, input, previousUploadSessionID, transactionID);
  }
  await writeCommitClaim(connectionManager, input, derivedBatchID, transactionID);

  return {
    kind: isFreshClaim ? ARCGIS_COMMIT_CLAIM_KIND.CLAIMED : previousUploadSessionID ? ARCGIS_COMMIT_CLAIM_KIND.TAKEN_OVER : ARCGIS_COMMIT_CLAIM_KIND.RESTARTED,
    batchID: derivedBatchID,
    previousUploadSessionID,
    fileName: session.file_id,
    rowCount
  };
}

export async function markArcgisImportSessionCommitted(
  input: {
    schema: string;
    importSessionId: string;
    insertedRowCount: number;
  },
  transactionID: string
): Promise<void> {
  const connectionManager = ConnectionManager.getInstance();
  const updateSQL = format(
    `UPDATE ??.arcgis_import_sessions
     SET state = 'committed',
         committed_row_count = ?,
         committed_at = NOW()
     WHERE import_session_id = ? AND state = 'preflight'`,
    [input.schema]
  );
  const result = await connectionManager.executeQuery(updateSQL, [input.insertedRowCount, input.importSessionId], transactionID);
  if (Number((result as { affectedRows?: number })?.affectedRows ?? 0) !== 1) {
    throw new ArcgisImportSessionError('ArcGIS import session could not be marked committed.', HTTPResponses.CONFLICT);
  }
}

export async function cleanupStaleArcgisImportSessions(schema: string, maxAgeSeconds: number = ARCGIS_SESSION_CLEANUP_MAX_AGE_SECONDS): Promise<number> {
  await ensureArcgisImportTables(schema);
  const connectionManager = ConnectionManager.getInstance();
  const deleteSQL = format(
    `DELETE FROM ??.arcgis_import_sessions
     WHERE state IN ('${ARCGIS_IMPORT_SESSION_STATE.PREFLIGHT}', '${ARCGIS_IMPORT_SESSION_STATE.COMMITTED}')
       AND updated_at < DATE_SUB(NOW(), INTERVAL ? SECOND)`,
    [schema]
  );
  const result = await connectionManager.executeQuery(deleteSQL, [maxAgeSeconds]);
  return Number((result as { affectedRows?: number })?.affectedRows ?? 0);
}
