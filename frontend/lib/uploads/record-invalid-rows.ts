/**
 * Invalid-row recording and retry cleanup for the upload pipeline.
 *
 * Both the synchronous batchedupload route and the async upload worker need to:
 *   (a) persist parse-reject rows into coremeasurements (StemGUID=NULL), and
 *   (b) delete previously-recorded parse rejects when retrying a crashed job so
 *       retries don't accumulate duplicate failure rows.
 *
 * recordInvalidRows    — maps raw FileRows to IngestionFailureRowInput and delegates
 *                        to insertIngestionFailureRows. Used by the worker.
 * recordFailedMeasurementRows — thin passthrough for already-shaped FailedMeasurementsRDS
 *                        rows. Used by the batchedupload HTTP route.
 * deleteUnresolvedRowsForBatch — scoped DELETE for retry cleanup.
 */

import moment from 'moment/moment';
import ConnectionManager from '@/config/connectionmanager';
import { insertIngestionFailureRows, toFiniteNumber } from '@/config/measurementerrors';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { FileRow } from '@/config/macros/formdetails';
import { FailedMeasurementsRDS } from '@/config/sqlrdsdefinitions/core';

export interface InvalidRowContext {
  schema: string;
  plotID: number;
  censusID: number;
  fileName: string;
  batchID: string;
  /**
   * Row-index offset for chunked callers.
   *
   * insertPreparedIngestionFailureRowsBulk selects inserted rows back by
   * (UploadBatchID, SourceRowIndex), so chunked callers MUST pass a running
   * offset or error-log rows mislink. Defaults to 0.
   *
   * Example: if a file is split into two chunks of 100 rows each, the first
   * call passes sourceRowIndexOffset=0 (rows indexed 1–100) and the second
   * passes sourceRowIndexOffset=100 (rows indexed 101–200).
   *
   * COLLISION HAZARD: coremeasurements enforces
   * UNIQUE ux_cm_uploadbatch_rowindex (UploadBatchID, SourceRowIndex), and
   * bulkingestionprocess writes its rows (both ingested and failed) under the
   * same batch keyed by temporarymeasurements.id. Callers recording rejects
   * for a batch the procedure also writes MUST keep their indices out of the
   * positive auto-increment range (the async worker uses a negative offset),
   * or the ON DUPLICATE KEY UPDATE silently rewrites a procedure-owned row.
   */
  sourceRowIndexOffset?: number;
}

/**
 * Records parse-reject FileRows into coremeasurements with StemGUID=NULL.
 *
 * Mirrors the mapping that the old async worker (insertInvalidMeasurementRows,
 * git e01cdb33) used before it was removed: lx→x, ly→y; date formatted as
 * YYYY-MM-DD via moment when present; failureReason defaulting to
 * "Unknown parse error" when absent.
 *
 * Returns the count of rows recorded (0 when rows is empty).
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
    dbh: toFiniteNumber(row.dbh),
    hom: toFiniteNumber(row.hom),
    date: row.date ? moment(row.date).format('YYYY-MM-DD') : null,
    codes: row.codes || null,
    comments: row.comments || null,
    failureReason: row.failureReason ? String(row.failureReason) : 'Unknown parse error',
    fileID: ctx.fileName,
    batchID: ctx.batchID,
    sourceRowIndex: idx + 1 + offset
  }));

  const insertedIDs = await insertIngestionFailureRows(connectionManager, ctx.schema, inputs, transactionID);
  return insertedIDs.length;
}

/**
 * Records already-shaped FailedMeasurementsRDS rows into coremeasurements.
 *
 * Used by the batchedupload HTTP route, which receives rows pre-mapped from
 * the client. Delegates directly to insertIngestionFailureRows without any
 * additional field mapping.
 *
 * Returns the count of rows recorded (0 when rows is empty).
 */
export async function recordFailedMeasurementRows(
  connectionManager: ConnectionManager,
  schema: string,
  rows: FailedMeasurementsRDS[],
  fileID: string,
  batchID: string,
  plotID: number,
  censusID: number,
  transactionID?: string
): Promise<number> {
  if (rows.length === 0) return 0;

  const inputs = rows.map((row, idx) => ({
    plotID,
    censusID,
    tag: row.tag ?? null,
    stemTag: row.stemTag ?? null,
    spCode: row.spCode ?? null,
    quadrat: row.quadrat ?? null,
    x: row.x ?? null,
    y: row.y ?? null,
    dbh: row.dbh ?? null,
    hom: row.hom ?? null,
    date: row.date ?? null,
    codes: row.codes ?? null,
    comments: row.description ?? null,
    failureReason: row.failureReasons ?? 'Unknown error',
    fileID: (row as any).fileID ?? fileID,
    batchID: (row as any).batchID ?? batchID,
    sourceRowIndex: idx + 1
  }));

  const insertedIDs = await insertIngestionFailureRows(connectionManager, schema, inputs, transactionID);
  return insertedIDs.length;
}

/**
 * Deletes coremeasurements rows that were recorded as parse-rejects for a
 * specific file+batch+census combination (identified by StemGUID IS NULL).
 *
 * Called before retrying a crashed upload job to prevent duplicate failure rows
 * accumulating across retry attempts.
 *
 * PRECONDITION — never call this for a batch whose uploadmetrics row is
 * status='completed'. Under the same (UploadFileID, UploadBatchID), completed
 * batches hold BOTH the worker-recorded parse rejects AND the failure rows the
 * bulkingestionprocess stored procedure recorded during ingestion — all with
 * StemGUID NULL and indistinguishable here. Deleting them would permanently
 * destroy the procedure's recorded failures: the idempotent re-run of a
 * completed batch skips ingestion entirely and never regenerates them. Callers
 * must probe uploadmetrics first and skip completed batches.
 *
 * Returns the count of rows deleted.
 */
export async function deleteUnresolvedRowsForBatch(
  connectionManager: ConnectionManager,
  schema: string,
  fileID: string,
  batchID: string,
  censusID: number,
  transactionID?: string
): Promise<number> {
  const deleteSQL = safeFormatQuery(
    schema,
    `DELETE FROM ??.coremeasurements
     WHERE UploadFileID = ?
       AND UploadBatchID = ?
       AND CensusID = ?
       AND StemGUID IS NULL`
  );

  const result: any = await connectionManager.executeQuery(deleteSQL, [fileID, batchID, censusID], transactionID);
  return result?.affectedRows ?? 0;
}
