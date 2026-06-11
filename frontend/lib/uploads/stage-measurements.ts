/**
 * Measurement staging — the single mechanism for landing one chunk of a
 * measurements upload in `temporarymeasurements`.
 *
 * Both the synchronous upload route (app/api/sqlpacketload/route.ts) and the
 * background upload worker call stageMeasurementChunk; neither owns any staging
 * internals of its own. Header resolution, value transforms, and row validation
 * are NOT implemented here — they live in lib/column-mapping and are invoked via
 * resolveMeasurementChunk.
 *
 * The caller owns the surrounding transaction (begin/commit/rollback/retry):
 * stageMeasurementChunk only issues statements against the provided
 * transactionID.
 */

import crypto from 'crypto';
import moment from 'moment/moment';
import { format } from 'mysql2/promise';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import { FileRow, FormType, RequiredTableHeadersByFormType, SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { insertIngestionFailureRows } from '@/config/measurementerrors';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { ColumnMapping } from '@/lib/column-mapping/types';
import { resolveMeasurementChunk } from '@/lib/column-mapping/measurement-rows';
import {
  buildDroppedMeasurementFailureReason,
  cleanupPreviousFileUploads,
  cleanupStaleMeasurementBatchesForFile,
  ensureTemporaryMeasurementsSourceFormatColumn,
  findDroppedMeasurementCandidates,
  insertTemporaryMeasurementsInBatches,
  type DroppedMeasurementRow
} from '@/lib/ingestion/temporary-measurements';

const CHANGELOG_TABLE_NAME = 'file_upload';
const MEASUREMENTS_FORM_TYPE = 'measurements';

/**
 * Thrown when the chunk-level header resolution plan does not match the parsed
 * column count. Callers map this to their own error surface (the upload route
 * returns 422 UNPROCESSABLE_ENTITY; the worker fails the file).
 */
export class MeasurementChunkResolutionError extends Error {
  readonly fileName: string;
  readonly batchID: string;

  constructor(fileName: string, batchID: string) {
    super(`Header plan misalignment for the uploaded file ${fileName} (batch ${batchID})`);
    this.name = 'MeasurementChunkResolutionError';
    this.fileName = fileName;
    this.batchID = batchID;
  }
}

export interface StageMeasurementChunkParams {
  schema: string;
  fileName: string;
  batchID: string;
  plotID: number;
  censusID: number;
  uploadMode: UploadMode;
  sourceFormat: SourceFormat;
  rawRows: Record<string, string>[];
  csvHeaders: string[];
  delimiter: string;
  storedMapping?: ColumnMapping;
  uploadSessionID: string | null; // null for worker-driven jobs
  transactionID: string; // caller owns the transaction
  /**
   * Pre-keyed rows for callers that bypass server-side header resolution
   * (legacy fileRowSet uploads and REVISIONS uploads, whose rows are already
   * canonical-keyed). When set, rawRows/csvHeaders/storedMapping are ignored
   * and no resolution runs.
   */
  preKeyedRows?: FileRow[];
  /** Recorded as unifiedchangelog.ChangedBy for the file-upload tracking row. */
  changedBy?: string;
  /**
   * Invoked with the resolution's parse rejects as soon as resolution finishes,
   * BEFORE any database writes — so callers can surface partial failures even
   * when a later statement throws and the transaction rolls back.
   */
  onInvalidRows?: (invalidRows: FileRow[]) => void;
}

export interface StageMeasurementChunkResult {
  insertedCount: number;
  invalidRows: FileRow[]; // parse rejects for later recording
  droppedCount: number;
  /** Rows the chunk attempted to insert (post-resolution). */
  expectedCount: number;
  /** The resolved (or pre-keyed) rows that were staged — callers use these for content hashing. */
  stagedRows: FileRow[];
}

function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildUploadId(schema: string, plotID: number, censusID: number, fileID: string, batchID: string, purpose: string = 'upload'): string {
  return crypto.createHash('sha256').update([schema, plotID, censusID, fileID, batchID, purpose].join('#')).digest('hex').slice(0, 40);
}

function buildIngestionFailurePayload(droppedRows: DroppedMeasurementRow[], plotID: number, censusID: number, fileName: string, batchID: string) {
  return droppedRows.map(row => ({
    plotID,
    censusID,
    tag: row.tag,
    stemTag: row.stemtag || null,
    spCode: row.spcode,
    quadrat: row.quadrat,
    x: toNullableNumber(row.lx),
    y: toNullableNumber(row.ly),
    dbh: toNullableNumber(row.dbh),
    hom: toNullableNumber(row.hom),
    date: row.date ? moment(row.date).format('YYYY-MM-DD') : null,
    codes: row.codes || null,
    comments: null,
    fileID: fileName,
    batchID,
    sourceRowIndex: row.sourceRowIndex,
    failureReason: row.failureReason || 'Unknown error during insert'
  }));
}

export async function stageMeasurementChunk(connectionManager: ConnectionManager, params: StageMeasurementChunkParams): Promise<StageMeasurementChunkResult> {
  const {
    schema,
    fileName,
    batchID,
    plotID,
    censusID,
    uploadMode,
    sourceFormat,
    rawRows,
    csvHeaders,
    delimiter,
    storedMapping,
    uploadSessionID,
    transactionID
  } = params;

  let chunkRows: FileRow[];
  const invalidRows: FileRow[] = [];

  if (params.preKeyedRows) {
    chunkRows = params.preKeyedRows;
  } else {
    // SERVER-RESOLUTION STAGE (#6): the server is authoritative over CSV header
    // resolution. Rows are re-keyed/validated via the shared lib/column-mapping
    // pipeline rather than trusting client-computed keys.
    const requiredHeaders = RequiredTableHeadersByFormType[FormType.measurements] ?? [];
    const resolved = resolveMeasurementChunk(rawRows, csvHeaders.length, {
      formType: FormType.measurements,
      uploadMode: 'other',
      delimiter,
      requiredHeaders,
      csvHeaders,
      storedMapping
    });
    if (resolved.columnCountMismatch) {
      throw new MeasurementChunkResolutionError(fileName, batchID);
    }
    chunkRows = resolved.validRows;
    invalidRows.push(...resolved.invalidRows);
  }

  params.onInvalidRows?.(invalidRows);

  await ensureTemporaryMeasurementsSourceFormatColumn(connectionManager, schema);

  // Count rows BEFORE insert so we can measure the delta (important when
  // multiple chunks share a single BatchID under batch consolidation).
  const expectedRowCount = chunkRows.length;
  const countSQL = format(`SELECT COUNT(*) as count FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?`, [schema]);
  const preInsertResult = await connectionManager.executeQuery(countSQL, [fileName, batchID], transactionID);
  const preInsertCount = preInsertResult[0]?.count || 0;

  // A retry of the same file should not inherit stale batches that were left
  // behind by an earlier interrupted upload for the same plot/census.
  if (preInsertCount === 0) {
    if (uploadMode === UploadMode.CLEAN_REUPLOAD) {
      // Clean up data from any previous uploads for this census.
      // Clean re-upload is census replacement, not filename replacement.
      await cleanupPreviousFileUploads(connectionManager, schema, fileName, batchID, plotID, censusID, transactionID);
    }

    await cleanupStaleMeasurementBatchesForFile(connectionManager, schema, fileName, batchID, plotID, censusID, transactionID);
  }

  await insertTemporaryMeasurementsInBatches(
    connectionManager,
    schema,
    chunkRows,
    fileName,
    batchID,
    uploadSessionID,
    sourceFormat,
    plotID,
    censusID,
    transactionID
  );

  // CRITICAL FIX: Verify expected vs actual row count to detect silent data loss from INSERT IGNORE
  const postInsertResult = await connectionManager.executeQuery(countSQL, [fileName, batchID], transactionID);
  const postInsertCount = postInsertResult[0]?.count || 0;
  const actualInsertedCount = postInsertCount - preInsertCount;

  // Check for discrepancy - this would indicate INSERT IGNORE silently dropped rows
  const droppedRowCount = expectedRowCount - actualInsertedCount;

  if (droppedRowCount > 0) {
    ailogger.error(
      `DATA INTEGRITY WARNING: Expected ${expectedRowCount} rows but only ${actualInsertedCount} were inserted for ${fileName}-${batchID}. ` +
        `${droppedRowCount} row(s) were silently dropped by INSERT IGNORE (likely duplicates). This indicates potential data loss!`
    );

    const droppedCandidates = await findDroppedMeasurementCandidates(connectionManager, schema, fileName, batchID, plotID, censusID, chunkRows, transactionID);
    const droppedRows: DroppedMeasurementRow[] = droppedCandidates.map(candidate => {
      const row = chunkRows[candidate.rowOrdinal - 1];
      return Object.assign({}, row, {
        failureReason: buildDroppedMeasurementFailureReason(row, candidate.existingBatch),
        sourceRowIndex: candidate.rowOrdinal
      }) as DroppedMeasurementRow;
    });

    if (droppedRows.length !== droppedRowCount) {
      ailogger.warn(
        `Dropped-row batch detection identified ${droppedRows.length} of ${droppedRowCount} dropped row(s) for ${fileName}-${batchID}. ` +
          `Persisted unresolved ingestion errors may be incomplete for this chunk.`
      );
    }

    // Persist dropped rows as unresolved ingestion errors in coremeasurements.
    if (droppedRows.length > 0) {
      try {
        await insertIngestionFailureRows(
          connectionManager,
          schema,
          buildIngestionFailurePayload(droppedRows, plotID, censusID, fileName, batchID),
          transactionID
        );
        ailogger.info(`Persisted ${droppedRows.length} dropped rows as unresolved ingestion errors for ${fileName}-${batchID}`);
      } catch (failedInsertError: any) {
        ailogger.error(`Failed to persist dropped rows as unresolved ingestion errors (attempt 1): ${failedInsertError.message}`);

        // Retry once before giving up
        try {
          await insertIngestionFailureRows(
            connectionManager,
            schema,
            buildIngestionFailurePayload(droppedRows, plotID, censusID, fileName, batchID),
            transactionID
          );
          ailogger.info(`Retry successful: persisted ${droppedRows.length} dropped rows as unresolved ingestion errors for ${fileName}-${batchID}`);
        } catch (retryError: any) {
          ailogger.error(`Failed to persist dropped rows as unresolved ingestion errors (attempt 2): ${retryError.message}`);

          // Critical: log to uploadintegrityalerts so data loss is not silent.
          try {
            const alertUploadId = buildUploadId(schema, plotID, censusID, fileName, batchID, 'failed-insert-to-unresolved-coremeasurements');
            const alertSQL = format(
              `INSERT INTO ??.uploadintegrityalerts
               (uploadId, fileID, batchID, plotID, censusID, type, message, severity,
                sourceRecords, processedRecords, failedRecords, missingRecords)
               VALUES (?, ?, ?, ?, ?, 'FAILED_INSERT_TO_UNRESOLVED_COREMEASUREMENTS', ?, 'critical', ?, ?, ?, ?)`,
              [schema]
            );
            const alertMessage = JSON.stringify({
              error: retryError.message,
              droppedRowCount: droppedRows.length,
              timestamp: new Date().toISOString(),
              note: 'These rows were dropped during upload and could not be persisted as unresolved ingestion errors'
            });
            await connectionManager.executeQuery(
              alertSQL,
              [alertUploadId, fileName, batchID, plotID, censusID, alertMessage, expectedRowCount, actualInsertedCount, droppedRows.length, 0],
              transactionID
            );
            ailogger.error(`Logged failed insert to uploadintegrityalerts for ${fileName}-${batchID}`);
          } catch (alertError: any) {
            ailogger.error(`CRITICAL: Failed to log data loss to uploadintegrityalerts: ${alertError.message}. Dropped rows: ${droppedRows.length}`);
          }
        }
      }
    }
  } else {
    ailogger.info(`Successfully inserted ${actualInsertedCount} rows for ${fileName}-${batchID} (expected: ${expectedRowCount}, no data loss detected)`);
  }

  // Track file upload in unifiedchangelog (single row per file, not per batch)
  try {
    // Check if we've already logged this file upload - use format() for schema
    const existingEntrySQL = format(
      `SELECT ChangeID, NewRowState FROM ??.unifiedchangelog
       WHERE TableName = '${CHANGELOG_TABLE_NAME}' AND RecordID = ? AND CensusID = ?
       ORDER BY ChangeID DESC LIMIT 1`,
      [schema]
    );
    const existingEntry = await connectionManager.executeQuery(existingEntrySQL, [fileName, censusID], transactionID);

    if (existingEntry.length === 0) {
      // First batch for this file - insert new entry
      const uploadMetadata = JSON.stringify({
        fileName,
        formType: MEASUREMENTS_FORM_TYPE,
        sourceFormat,
        uploadMode,
        rowCount: actualInsertedCount,
        droppedCount: droppedRowCount,
        batchCount: 1
      });
      const insertChangelogSQL = format(
        `INSERT INTO ??.unifiedchangelog
        (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
        VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
        [schema]
      );
      await connectionManager.executeQuery(
        insertChangelogSQL,
        [CHANGELOG_TABLE_NAME, fileName, 'INSERT', uploadMetadata, params.changedBy, plotID, censusID],
        transactionID
      );
    } else {
      // Subsequent batch - update the existing entry with accumulated count
      // Handle both string and already-parsed object (MySQL driver may auto-parse JSON columns)
      const metadata = typeof existingEntry[0].NewRowState === 'string' ? JSON.parse(existingEntry[0].NewRowState) : existingEntry[0].NewRowState;
      metadata.sourceFormat = sourceFormat;
      metadata.uploadMode = uploadMode;
      metadata.rowCount = (metadata.rowCount || 0) + actualInsertedCount;
      metadata.droppedCount = (metadata.droppedCount || 0) + droppedRowCount;
      metadata.batchCount = (metadata.batchCount || 1) + 1;
      const updateChangelogSQL = format(`UPDATE ??.unifiedchangelog SET NewRowState = ?, ChangeTimestamp = NOW() WHERE ChangeID = ?`, [schema]);
      await connectionManager.executeQuery(updateChangelogSQL, [JSON.stringify(metadata), existingEntry[0].ChangeID], transactionID);
    }
  } catch (logError: any) {
    // Log but don't fail the upload if changelog tracking fails
    ailogger.error('Failed to log file upload to changelog', logError);
  }

  return {
    insertedCount: actualInsertedCount,
    invalidRows,
    droppedCount: droppedRowCount,
    expectedCount: expectedRowCount,
    stagedRows: chunkRows
  };
}

export async function countStagedRows(
  connectionManager: ConnectionManager,
  schema: string,
  fileName: string,
  batchID: string,
  plotID: number,
  censusID: number
): Promise<number> {
  const countSQL = safeFormatQuery(
    schema,
    `SELECT COUNT(*) as count FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ? AND PlotID = ? AND CensusID = ?`
  );
  const rows = await connectionManager.executeQuery(countSQL, [fileName, batchID, plotID, censusID]);
  return Number(rows?.[0]?.count ?? 0);
}
