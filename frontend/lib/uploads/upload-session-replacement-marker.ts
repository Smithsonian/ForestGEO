/**
 * Per-upload-session "this replacement already ran" markers.
 *
 * A CLEAN_REUPLOAD is destructive: it deletes existing rows before writing the
 * incoming ones. The synchronous upload route issues ONE request per file (and
 * retries a request that timed out), so the delete must be owned by exactly one
 * request per upload session — otherwise the second file of the same upload
 * erases the rows the first file just committed.
 *
 * The fact is durable rather than inferred: a timestamp column on
 * `upload_sessions`, written in the SAME transaction as the delete it guards, so
 * the marker and the delete can never disagree — a rollback loses both, a commit
 * keeps both.
 *
 * Two independent markers exist because the two destructive resets are
 * independent: measurements replace a census scope, reference tables replace a
 * whole table.
 */
import { createHash } from 'crypto';
import { format } from 'mysql2/promise';
import ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import ailogger from '@/ailogger';
import { isMissingTableError } from '@/lib/errorhelpers';
import { UploadMode } from '@/config/uploadmodes';

/** Column recording that a session's census replacement (measurements) has run. */
export const CENSUS_REPLACEMENT_MARKER_COLUMN = 'census_replacement_completed_at';

/** Column recording that a session's reference-table replacement (species/attributes/personnel/quadrats) has run. */
export const REFERENCE_REPLACEMENT_MARKER_COLUMN = 'reference_replacement_completed_at';

export type UploadSessionReplacementMarkerColumn = typeof CENSUS_REPLACEMENT_MARKER_COLUMN | typeof REFERENCE_REPLACEMENT_MARKER_COLUMN;

const UPLOAD_SESSIONS_TABLE = 'upload_sessions';

const verifiedMarkerColumns = new Set<string>();

function memoKey(schema: string, markerColumn: UploadSessionReplacementMarkerColumn): string {
  return `${schema}:${markerColumn}`;
}

/**
 * Legacy measurement compatibility for schemas that predate the census marker.
 * Reference uploads use the schema migration and do not call this helper.
 *
 * Runs OUTSIDE the caller's transaction on purpose — ALTER TABLE causes an
 * implicit commit in MySQL, so issuing it on the transaction's connection would
 * silently commit the caller's in-progress work.
 */
export async function ensureUploadSessionReplacementMarkerColumn(
  connectionManager: ConnectionManager,
  schema: string,
  markerColumn: UploadSessionReplacementMarkerColumn
): Promise<void> {
  if (verifiedMarkerColumns.has(memoKey(schema, markerColumn))) return;

  // Both facts in one read: whether the table exists at all, and whether it has
  // the column. upload_sessions is created on demand by ensureUploadSessionsTable,
  // so "no table yet" is a legitimate state, not something to repair here.
  const stateSQL = `
    SELECT
      (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'upload_sessions') AS tableCount,
      (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'upload_sessions' AND COLUMN_NAME = ?) AS columnCount
  `;
  const state = await connectionManager.executeQuery(stateSQL, [schema, schema, markerColumn]);
  const tableExists = Number(state?.[0]?.tableCount ?? 0) > 0;
  const columnExists = Number(state?.[0]?.columnCount ?? 0) > 0;

  if (tableExists && !columnExists) {
    const alterSQL = format(`ALTER TABLE ??.upload_sessions ADD COLUMN ${markerColumn} TIMESTAMP NULL DEFAULT NULL`, [schema]);
    await connectionManager.executeQuery(alterSQL);
  }

  // Only memoize a settled state. A schema without the table yet must be
  // re-checked, or the column would never be added once it appears.
  if (tableExists) verifiedMarkerColumns.add(memoKey(schema, markerColumn));
}

/** Test seam: the per-process memo would otherwise hide a dropped column between suites. */
export function resetUploadSessionReplacementMarkerCacheForTests(): void {
  verifiedMarkerColumns.clear();
}

/** True when this upload session has already performed the replacement `markerColumn` tracks. */
export async function uploadSessionHasCompletedReplacement(
  connectionManager: ConnectionManager,
  schema: string,
  uploadSessionID: string,
  markerColumn: UploadSessionReplacementMarkerColumn,
  transactionID: string
): Promise<boolean> {
  const probeSQL = safeFormatQuery(schema, `SELECT ${markerColumn} FROM ??.upload_sessions WHERE session_id = ? LIMIT 1`);
  try {
    const rows = await connectionManager.executeQuery(probeSQL, [uploadSessionID], transactionID);
    if (markerColumn === REFERENCE_REPLACEMENT_MARKER_COLUMN && (!Array.isArray(rows) || rows.length !== 1)) {
      throw new Error(`Upload session ${uploadSessionID} was not found; reference data was not replaced.`);
    }
    return Array.isArray(rows) && rows.length > 0 && rows[0][markerColumn] !== null;
  } catch (error: unknown) {
    if (markerColumn === REFERENCE_REPLACEMENT_MARKER_COLUMN || !isMissingTableError(error, UPLOAD_SESSIONS_TABLE)) throw error;
    // No session table in this schema: fall back to "has not replaced", which
    // reproduces the pre-marker behaviour (replace on every file) rather than
    // failing the upload outright.
    ailogger.warn(`No upload_sessions table in ${schema}; ${markerColumn} cannot be tracked per session for ${uploadSessionID}.`);
    return false;
  }
}

/** Records that this session's replacement has run. Same transaction as the delete it guards. */
export async function markUploadSessionReplacementCompleted(
  connectionManager: ConnectionManager,
  schema: string,
  uploadSessionID: string,
  markerColumn: UploadSessionReplacementMarkerColumn,
  transactionID: string
): Promise<void> {
  const markSQL = safeFormatQuery(schema, `UPDATE ??.upload_sessions SET ${markerColumn} = CURRENT_TIMESTAMP WHERE session_id = ?`);
  try {
    const result = await connectionManager.executeQuery(markSQL, [uploadSessionID], transactionID);
    if (Number((result as { affectedRows?: number })?.affectedRows ?? 0) === 0) {
      if (markerColumn === REFERENCE_REPLACEMENT_MARKER_COLUMN) {
        throw new Error(`Upload session ${uploadSessionID} was not found; reference replacement could not be recorded.`);
      }
      // The marker lives on the session row, so a session id with no row cannot
      // be marked — and the next file of that "session" would replace again.
      // Never silent: this is the shape of the bug the marker replaced.
      ailogger.warn(
        `Upload session ${uploadSessionID} has no row in ${schema}.upload_sessions; ${markerColumn} could not be recorded, ` +
          `so a later file in the same session will run the same replacement again.`
      );
    }
  } catch (error: unknown) {
    if (markerColumn === REFERENCE_REPLACEMENT_MARKER_COLUMN || !isMissingTableError(error, UPLOAD_SESSIONS_TABLE)) throw error;
  }
}

/**
 * How long a reference-table request waits for another request of the same upload
 * session to commit before refusing. Below the client's 300s request timeout, so
 * the refusal reaches the client instead of the client giving up first.
 */
export const REFERENCE_REPLACEMENT_LOCK_TIMEOUT_MS = 120_000;

const REFERENCE_REPLACEMENT_LOCK_PREFIX = 'upload:reference:';
const LOCK_NAME_DIGEST_LENGTH = 40;

/** Another request of the same upload session is still writing the reference table. */
export class ReferenceReplacementInProgressError extends Error {
  constructor(uploadSessionID: string) {
    super(
      `Another request for upload session ${uploadSessionID} is still writing this table. ` +
        `Retry once it finishes; the table is replaced only once per upload session.`
    );
    this.name = 'ReferenceReplacementInProgressError';
  }
}

/** MySQL GET_LOCK names are capped at 64 characters, so the session scope is hashed. */
export function buildReferenceReplacementLockName(schema: string, uploadSessionID: string): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([schema, uploadSessionID]))
    .digest('hex')
    .slice(0, LOCK_NAME_DIGEST_LENGTH);
  return `${REFERENCE_REPLACEMENT_LOCK_PREFIX}${digest}`;
}

/**
 * Decides whether THIS request owns the destructive reset of a reference table
 * (species, attributes, personnel, quadrats).
 *
 * A CLEAN_REUPLOAD deletes the table's active rows before writing the incoming
 * ones, and the route issues one request per file, so without this the second
 * file of a multi-file upload deletes what the first file committed (#472).
 *
 * The check is serialized per upload session by a named lock held until the
 * caller's transaction ends. Transactions run at READ COMMITTED, so a request that
 * waited on the lock reads the marker the earlier request committed, instead of
 * both reading NULL and both deleting (an overlapping client retry). The marker
 * row itself is not touched here: `recordReferenceTableReplacement` writes it
 * after the rows, so the session row is locked only for the tail of the
 * transaction and heartbeats are not blocked for the length of the upload.
 *
 * Reference uploads require the migrated marker and an existing session. A missing
 * prerequisite fails the transaction; it must never restore per-request deletion.
 */
export async function claimReferenceTableReplacement(
  connectionManager: ConnectionManager,
  schema: string,
  uploadMode: UploadMode,
  uploadSessionID: string | null,
  transactionID: string
): Promise<boolean> {
  if (uploadMode !== UploadMode.CLEAN_REUPLOAD) return false;
  if (!uploadSessionID?.trim()) throw new Error('Upload session is required to replace reference data.');

  const lockAcquired = await connectionManager.acquireApplicationLock(
    buildReferenceReplacementLockName(schema, uploadSessionID),
    transactionID,
    REFERENCE_REPLACEMENT_LOCK_TIMEOUT_MS
  );
  if (!lockAcquired) {
    throw new ReferenceReplacementInProgressError(uploadSessionID);
  }

  const alreadyReplaced = await uploadSessionHasCompletedReplacement(
    connectionManager,
    schema,
    uploadSessionID,
    REFERENCE_REPLACEMENT_MARKER_COLUMN,
    transactionID
  );
  return !alreadyReplaced;
}

/** Records the reset `claimReferenceTableReplacement` granted. Call last, in the same transaction. */
export async function recordReferenceTableReplacement(
  connectionManager: ConnectionManager,
  schema: string,
  uploadSessionID: string | null,
  transactionID: string
): Promise<void> {
  if (!uploadSessionID?.trim()) throw new Error('Upload session is required to record reference replacement.');
  await markUploadSessionReplacementCompleted(connectionManager, schema, uploadSessionID, REFERENCE_REPLACEMENT_MARKER_COLUMN, transactionID);
}
