/**
 * Invalid-row recording and retry cleanup for the upload pipeline.
 *
 * recordInvalidRows — maps raw FileRows to IngestionFailureRowInput and records
 * them (audited) for the async worker.
 * recordFailedMeasurementRows — same audited recording for already-shaped
 * FailedMeasurementsRDS rows, used by the batchedupload HTTP route.
 * deleteUnresolvedRowsForBatchFamily — family-scoped, audited DELETE for retry
 * cleanup.
 *
 * All three accept an OPTIONAL transactionID: when supplied, the write/delete
 * and its audit run inside it and the caller commits/rolls back; when omitted,
 * withOwnOrCallerTransaction opens one of its own and commits/rolls it back.
 * Data and audit always commit or roll back together.
 */

import moment from 'moment/moment';
import ConnectionManager from '@/lib/db/connectionmanager';
import { normalizeFailureDescription, toFiniteNumber } from '@/config/measurementerrors';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { FileRow } from '@/config/macros/formdetails';
import { FailedMeasurementsRDS } from '@/lib/db/definitions/core';
import { buildSubBatchPattern, LIKE_ESCAPE_CLAUSE } from '@/lib/uploads/batch-family';
import { recordAuditedIngestionFailureRows } from '@/lib/changelog/ingestion-failure-audit';
import { deleteCoreMeasurementsInBoundedChunksWithAudit } from '@/lib/ingestion/temporary-measurements';
import { transactionExecutorFor, type BulkIngestionExecutor } from '@/lib/ingestion/bulk-ingestion-call';

/** Thrown by deleteUnresolvedRowsForBatchFamily when an omitted `plotID` cannot be resolved because no census row exists for `censusID`. */
export class MissingCensusPlotIDError extends Error {
  constructor(schema: string, censusID: number) {
    super(
      `deleteUnresolvedRowsForBatchFamily: no census row found for CensusID=${censusID} in schema "${schema}" — cannot resolve PlotID for the delete's audit trail.`
    );
    this.name = 'MissingCensusPlotIDError';
  }
}

/** Resolves `plotID` from the census row, inside the active transaction, when a caller does not already know it. Never derived from client input. */
async function resolvePlotIDFromCensus(tx: Pick<BulkIngestionExecutor, 'query'>, schema: string, censusID: number): Promise<number> {
  const sql = safeFormatQuery(schema, 'SELECT PlotID FROM ??.census WHERE CensusID = ? LIMIT 1');
  const rows = await tx.query<Array<{ PlotID: number }>>(sql, [censusID]);
  const plotID = Array.isArray(rows) && rows.length > 0 ? rows[0]?.PlotID : undefined;
  if (plotID == null) {
    throw new MissingCensusPlotIDError(schema, censusID);
  }
  return Number(plotID);
}

/**
 * Runs `fn` inside `transactionID` if supplied; otherwise opens a transaction,
 * runs `fn`, and commits on success or rolls back (then rethrows) on failure.
 * A rollback failure is attached as `rollbackError` rather than hiding the
 * original error.
 */
async function withOwnOrCallerTransaction<T>(
  connectionManager: ConnectionManager,
  transactionID: string | undefined,
  fn: (activeTransactionID: string) => Promise<T>
): Promise<T> {
  if (transactionID) return fn(transactionID);

  const ownedTransactionID = await connectionManager.beginTransaction();
  try {
    const result = await fn(ownedTransactionID);
    await connectionManager.commitTransaction(ownedTransactionID);
    return result;
  } catch (error: unknown) {
    try {
      await connectionManager.rollbackTransaction(ownedTransactionID);
    } catch (rollbackError: unknown) {
      if (error instanceof Error) {
        (error as Error & { rollbackError?: unknown }).rollbackError = rollbackError;
      }
    }
    throw error;
  }
}

export interface InvalidRowContext {
  schema: string;
  plotID: number;
  censusID: number;
  fileName: string;
  batchID: string;
  /**
   * Row-index offset for chunked callers (default 0): rows are indexed
   * `idx + 1 + offset`, so a second chunk passes the first chunk's row count
   * as its offset to keep indices non-overlapping.
   *
   * COLLISION HAZARD: coremeasurements enforces
   * UNIQUE ux_cm_uploadbatch_rowindex (UploadBatchID, SourceRowIndex), and
   * bulkingestionprocess writes its own rows under the same batch keyed by
   * temporarymeasurements.id. A caller recording rejects for a batch the
   * procedure also writes MUST keep its indices out of the positive
   * auto-increment range (the async worker uses a negative offset), or the
   * ON DUPLICATE KEY UPDATE silently rewrites a procedure-owned row.
   */
  sourceRowIndexOffset?: number;
  /**
   * `unifiedchangelog.ChangedBy` for this write's audit row(s). Omitted/`null`
   * records an unattributed write. MUST be server-resolved identity (e.g. the
   * worker's `job.createdBy`), never a client-supplied field.
   */
  changedBy?: string | null;
}

/**
 * Records parse-reject FileRows into coremeasurements with StemGUID=NULL.
 * Mirrors the old worker's mapping (lx→x, ly→y; date→YYYY-MM-DD;
 * failureReason passed through as-is — the persistence choke point owns the
 * fallback policy). Returns the count of rows recorded (0 when rows is empty).
 */
export async function recordInvalidRows(
  connectionManager: ConnectionManager,
  ctx: InvalidRowContext,
  rows: FileRow[],
  transactionID?: string
): Promise<number> {
  if (rows.length === 0) return 0;

  const offset = ctx.sourceRowIndexOffset ?? 0;
  const inputs = rows.map((row, idx) => ({
    plotID: ctx.plotID,
    censusID: ctx.censusID,
    tag: row.tag || null,
    stemTag: row.stemtag || null,
    spCode: row.spcode || null,
    quadrat: row.quadrat || null,
    x: toFiniteNumber(row.lx),
    y: toFiniteNumber(row.ly),
    plotX: toFiniteNumber(row.px),
    plotY: toFiniteNumber(row.py),
    dbh: toFiniteNumber(row.dbh),
    hom: toFiniteNumber(row.hom),
    date: row.date ? moment(row.date).format('YYYY-MM-DD') : null,
    codes: row.codes || null,
    comments: row.comments || null,
    failureReason: row.failureReason ? String(row.failureReason) : null,
    fileID: ctx.fileName,
    batchID: ctx.batchID,
    sourceRowIndex: idx + 1 + offset
  }));

  const { measurementIDs } = await withOwnOrCallerTransaction(connectionManager, transactionID, activeTransactionID =>
    recordAuditedIngestionFailureRows({
      connectionManager,
      schema: ctx.schema,
      rows: inputs,
      transactionID: activeTransactionID,
      changedBy: ctx.changedBy ?? null,
      plotID: ctx.plotID,
      censusID: ctx.censusID
    })
  );
  return measurementIDs.length;
}

/**
 * Records already-shaped FailedMeasurementsRDS rows (the batchedupload HTTP
 * route's wire shape) into coremeasurements. `changedBy` must be the
 * authenticated session's identity, never a client body field. `fileID`/
 * `batchID` are likewise server-owned — a client-supplied override on an
 * individual row is never read here. Returns the count of rows recorded.
 */
export async function recordFailedMeasurementRows(
  connectionManager: ConnectionManager,
  schema: string,
  rows: FailedMeasurementsRDS[],
  fileID: string,
  batchID: string,
  plotID: number,
  censusID: number,
  transactionID?: string,
  changedBy: string | null = null
): Promise<number> {
  if (rows.length === 0) return 0;

  const inputs = rows.map((row, idx) => ({
    plotID,
    censusID,
    tag: row.tag ?? null,
    stemTag: row.stemTag ?? null,
    spCode: row.spCode ?? null,
    quadrat: row.quadrat ?? null,
    // Rejected CSV values can still be strings at runtime despite the DTO type;
    // normalize exactly as the worker path does, including preserving zero.
    x: toFiniteNumber(row.x),
    y: toFiniteNumber(row.y),
    plotX: toFiniteNumber(row.plotX),
    plotY: toFiniteNumber(row.plotY),
    dbh: toFiniteNumber(row.dbh),
    hom: toFiniteNumber(row.hom),
    date: row.date ?? null,
    codes: row.codes ?? null,
    comments: row.comments ?? null,
    failureReason:
      row.failureReasons == null ? null : typeof row.failureReasons === 'string' ? row.failureReasons : normalizeFailureDescription(row.failureReasons),
    fileID,
    batchID,
    sourceRowIndex: idx + 1
  }));

  const { measurementIDs } = await withOwnOrCallerTransaction(connectionManager, transactionID, activeTransactionID =>
    recordAuditedIngestionFailureRows({
      connectionManager,
      schema,
      rows: inputs,
      transactionID: activeTransactionID,
      changedBy,
      plotID,
      censusID
    })
  );
  return measurementIDs.length;
}

/**
 * Deletes coremeasurements parse-reject rows (StemGUID IS NULL) for a
 * file+batch+census, auditing each removed row before deleting it. Called
 * before retrying a crashed upload job so retries don't accumulate
 * duplicate failure rows.
 *
 * PRECONDITION — never delete rows belonging to a batch (or sub-batch) whose
 * uploadmetrics row is status='completed': those rows are indistinguishable
 * from worker-recorded rejects but are the bulkingestionprocess's own
 * recorded failures, which an idempotent re-run never regenerates. Callers
 * must pass the family's completed batch/sub-batch IDs as `preserveBatchIDs`.
 *
 * Scope is the whole batch FAMILY — the original BatchID and any
 * `<batchID>__subNNN` a prior split created — so a retry can't leave
 * sub-batch rows stranded alongside the re-run's rows.
 *
 * `changedBy` attributes the DELETE audit row(s); omitted/`null` records an
 * unattributed cleanup. `plotID`, if omitted, is resolved from the census row
 * (see resolvePlotIDFromCensus). Neither is ever accepted from client input.
 *
 * Returns the count of rows deleted.
 */
export async function deleteUnresolvedRowsForBatchFamily(
  connectionManager: ConnectionManager,
  schema: string,
  fileID: string,
  batchID: string,
  censusID: number,
  transactionID?: string,
  preserveBatchIDs: string[] = [],
  changedBy: string | null = null,
  plotID?: number
): Promise<number> {
  const preserveClause = preserveBatchIDs.length > 0 ? `AND UploadBatchID NOT IN (${preserveBatchIDs.map(() => '?').join(', ')})` : '';
  const whereSQL = `UploadFileID = ?
       AND CensusID = ?
       AND StemGUID IS NULL
       AND (UploadBatchID = ? OR UploadBatchID LIKE ? ${LIKE_ESCAPE_CLAUSE})
       ${preserveClause}`;
  const whereParams = [fileID, censusID, batchID, buildSubBatchPattern(batchID), ...preserveBatchIDs];

  return withOwnOrCallerTransaction(connectionManager, transactionID, async activeTransactionID => {
    const resolvedPlotID = plotID ?? (await resolvePlotIDFromCensus(transactionExecutorFor(connectionManager, activeTransactionID), schema, censusID));
    return deleteCoreMeasurementsInBoundedChunksWithAudit(
      connectionManager,
      schema,
      whereSQL,
      whereParams,
      changedBy,
      resolvedPlotID,
      censusID,
      activeTransactionID
    );
  });
}
