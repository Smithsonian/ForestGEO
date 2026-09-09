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
import { format } from 'mysql2/promise';
import ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import ailogger from '@/ailogger';

/** Column recording that a session's census replacement (measurements) has run. */
export const CENSUS_REPLACEMENT_MARKER_COLUMN = 'census_replacement_completed_at';

/** Column recording that a session's reference-table replacement (species/attributes/personnel) has run. */
export const REFERENCE_REPLACEMENT_MARKER_COLUMN = 'reference_replacement_completed_at';

export type UploadSessionReplacementMarkerColumn = typeof CENSUS_REPLACEMENT_MARKER_COLUMN | typeof REFERENCE_REPLACEMENT_MARKER_COLUMN;

const verifiedMarkerColumns = new Set<string>();

function memoKey(schema: string, markerColumn: UploadSessionReplacementMarkerColumn): string {
  return `${schema}:${markerColumn}`;
}

function isMissingUploadSessionsTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string; sqlMessage?: string };
  const message = `${candidate.message ?? ''} ${candidate.sqlMessage ?? ''}`.toLowerCase();
  return (
    (candidate.code === 'ER_NO_SUCH_TABLE' || message.includes("doesn't exist") || message.includes('does not exist')) && message.includes('upload_sessions')
  );
}

/**
 * Self-heals a live schema whose upload_sessions predates a marker column, the
 * same way SourceFormat is handled for temporarymeasurements: the repair
 * migration is the durable fix, this keeps a not-yet-migrated schema working.
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
    return Array.isArray(rows) && rows.length > 0 && rows[0][markerColumn] !== null;
  } catch (error: unknown) {
    if (!isMissingUploadSessionsTable(error)) throw error;
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
      // The marker lives on the session row, so a session id with no row cannot
      // be marked — and the next file of that "session" would replace again.
      // Never silent: this is the shape of the bug the marker replaced.
      ailogger.warn(
        `Upload session ${uploadSessionID} has no row in ${schema}.upload_sessions; ${markerColumn} could not be recorded, ` +
          `so a later file in the same session will run the same replacement again.`
      );
    }
  } catch (error: unknown) {
    if (!isMissingUploadSessionsTable(error)) throw error;
  }
}
