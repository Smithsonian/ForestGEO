/**
 * `/api/cleanup`'s orphaned staged-row step (#561, N2). A staged row is owned while its SessionID is an active upload
 * session or its FileID is an active session's file_id. Worker sessions carry file_id = async-job-<id>, so the old
 * file_id-only rule deleted a running worker job's staging. The DELETE evaluates ownership itself, against committed
 * session state, so nothing listed by the finder can be deleted after it gained an owner.
 *
 * Locking: the DELETE runs in bounded windows, each in its own ConnectionManager transaction (READ COMMITTED). InnoDB reads a
 * subquery's tables without locks at that level only for INSERT/REPLACE/CREATE ... SELECT and UPDATE; this DELETE takes
 * shared locks on the upload_sessions rows its NOT EXISTS reads. That is what makes the ownership check atomic, and it
 * means the statement can wait behind an ArcGIS commit unit holding a session row FOR UPDATE (it proceeds when the
 * unit commits), and can deadlock with a retried commit's S0, which holds the session row and wants the earlier
 * attempt's rows this DELETE has already X-locked. Both sides recover: the cleanup route reports the 1213/1205 in
 * result.errors and continues; the commit unit rolls back and its retry restarts.
 */
import type ConnectionManager from '@/lib/db/connectionmanager';
import { buildInPlaceholders, safeFormatQuery } from '@/lib/db/sqlsecurity';
import { isMissingTableError } from '@/lib/errorhelpers';
import { ACTIVE_UPLOAD_SESSION_STATES } from '@/config/uploadsessiontracker';

/** Rows one orphan-delete transaction removes, so a large backlog never outlives the transaction deadline or holds its row locks. */
export const ORPHAN_DELETE_WINDOW_ROWS = 5000;

export interface OrphanedStagedFile {
  fileId: string;
  rowCount: number;
}

const UNOWNED_STAGED_ROW_PREDICATE = `NOT EXISTS (
    SELECT 1 FROM ??.upload_sessions us
     WHERE us.state IN (${buildInPlaceholders(ACTIVE_UPLOAD_SESSION_STATES.length)})
       AND (us.session_id = tm.SessionID OR us.file_id = tm.FileID)
  )`;

export async function findOrphanedTemporaryMeasurements(connectionManager: ConnectionManager, schema: string): Promise<OrphanedStagedFile[]> {
  const findSQL = safeFormatQuery(
    schema,
    `SELECT tm.FileID AS fileId, COUNT(*) AS rowCount
       FROM ??.temporarymeasurements tm
      WHERE ${UNOWNED_STAGED_ROW_PREDICATE}
      GROUP BY tm.FileID`
  );
  try {
    const rows = await connectionManager.executeQuery(findSQL, [...ACTIVE_UPLOAD_SESSION_STATES]);
    return (Array.isArray(rows) ? rows : []).map((row: { fileId: string; rowCount: number | string }) => ({
      fileId: row.fileId,
      rowCount: Number(row.rowCount)
    }));
  } catch (error: unknown) {
    if (isMissingTableError(error, 'temporarymeasurements') || isMissingTableError(error, 'upload_sessions')) return [];
    throw error;
  }
}

export async function deleteOrphanedTemporaryMeasurements(
  connectionManager: ConnectionManager,
  schema: string,
  fileIds: string[],
  windowRows: number = ORPHAN_DELETE_WINDOW_ROWS
): Promise<number> {
  if (!Number.isSafeInteger(windowRows) || windowRows <= 0) {
    throw new RangeError(`Orphan delete window must be a positive integer; received ${windowRows}`);
  }
  if (fileIds.length === 0) return 0;
  const deleteWindowSQL = safeFormatQuery(
    schema,
    `DELETE FROM ??.temporarymeasurements AS tm
      WHERE tm.FileID IN (${buildInPlaceholders(fileIds.length)})
        AND ${UNOWNED_STAGED_ROW_PREDICATE}
      LIMIT ${windowRows}`
  );
  let deletedRows = 0;
  let windowDeletedRows: number;
  do {
    windowDeletedRows = await connectionManager.withTransaction(async tx => {
      const result = await connectionManager.executeQuery(deleteWindowSQL, [...fileIds, ...ACTIVE_UPLOAD_SESSION_STATES], tx.id);
      return Number((result as { affectedRows?: number })?.affectedRows ?? 0);
    });
    deletedRows += windowDeletedRows;
  } while (windowDeletedRows === windowRows);
  return deletedRows;
}
