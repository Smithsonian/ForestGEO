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
 *
 * Staging never deletes census rows. A CLEAN_REUPLOAD replaces its census in
 * replaceCensusForCleanReupload, in separately committed transactions that run
 * before the staging transaction opens; a first chunk whose replacement has not
 * completed is refused with CensusReplacementIncompleteError.
 */

import crypto from 'crypto';
import moment from 'moment/moment';
import ConnectionManager from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';
import { FileRow, FormType, RequiredTableHeadersByFormType, SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { UploadSessionOwnershipError } from '@/config/uploadsessiontracker';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { ColumnMapping } from '@/lib/column-mapping/types';
import { resolveMeasurementChunk } from '@/lib/column-mapping/measurement-rows';
import {
  buildDroppedMeasurementFailureReason,
  CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE,
  cleanupStaleMeasurementBatchesForFile,
  deleteCensusReplacementChunk,
  deleteCensusReplacementLegacyFailuresWindow,
  deleteCensusReplacementMetricsWindow,
  ensureTemporaryMeasurementsSourceFormatColumn,
  familyHasStagedRows,
  findDroppedMeasurementCandidates,
  insertTemporaryMeasurementsInBatches,
  isUnsignedIntFieldInvalid,
  nextCensusReplacementCursor,
  type DroppedMeasurementRow
} from '@/lib/ingestion/temporary-measurements';
import { buildFileUploadChangelogRecordID, measurementFileIDValidationError, mergeFileUploadChunkIntoMetadata } from '@/lib/uploads/file-names';
import { recordAuditedIngestionFailureRows } from '@/lib/changelog/ingestion-failure-audit';
import { ChangelogWriteError } from '@/lib/changelog/record-mutation';
import { isEffectivelyEmptyMeasurementInput } from '@/lib/uploads/blank-measurement-input';
import {
  buildSubBatchPattern,
  LIKE_ESCAPE_CLAUSE,
  MAX_ORIGINAL_BATCH_ID_LENGTH,
  OriginalBatchIDTooLongError,
  subBatchIDForRowOrdinal
} from '@/lib/uploads/batch-family';
import {
  CENSUS_REPLACEMENT_MARKER_COLUMN,
  ensureUploadSessionReplacementMarkerColumn,
  lockUploadSessionForCensusReplacement,
  markUploadSessionReplacementCompleted,
  uploadSessionHasCompletedReplacement,
  type CensusReplacementSessionScope
} from '@/lib/uploads/upload-session-replacement-marker';

const CHANGELOG_TABLE_NAME = 'file_upload';
const MEASUREMENTS_FORM_TYPE = 'measurements';

const FILE_UPLOAD_SUMMARY_LOCK_TIMEOUT_MS = 30_000;

/**
 * Serializes the file_upload summary's read-merge-write per (schema,
 * RecordID, CensusID) via MySQL GET_LOCK — the same fix as
 * lib/changelog/ingestion-failure-audit.ts's batch lock, for the same reason:
 * `SELECT ... FOR UPDATE` takes no gap lock on a row that does not exist yet
 * under READ COMMITTED, so two concurrent "first chunk of this attempt"
 * callers could both see no existing summary row and both INSERT one,
 * instead of the second merging into the first. Held until the caller's
 * transaction commits or rolls back (ConnectionManager's
 * cleanupApplicationLocks releases it then); acquireApplicationLock is
 * idempotent for a name this same transaction already holds.
 */
function buildFileUploadSummaryLockName(schema: string, recordID: string, censusID: number): string {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify([schema, recordID, censusID]))
    .digest('hex')
    .slice(0, 40);
  return `file-upload-summary:${digest}`;
}

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

export class InvalidFirstRowOrdinalError extends Error {
  readonly code = 'INVALID_FIRST_ROW_ORDINAL';
  constructor(value: unknown) {
    super(`firstRowOrdinal must be a non-negative integer; received ${typeof value === 'string' ? JSON.stringify(value) : String(value)}`);
    this.name = 'InvalidFirstRowOrdinalError';
  }
}

/** Absent → null (legacy client). Present → a non-negative safe integer or InvalidFirstRowOrdinalError. */
export function parseFirstRowOrdinal(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new InvalidFirstRowOrdinalError(value);
  return value;
}

/** A CLEAN_REUPLOAD's first chunk reached staging before its census replacement finished; staging would append to the old census. */
export class CensusReplacementIncompleteError extends Error {
  readonly fileName: string;
  readonly batchID: string;
  readonly uploadSessionID: string | null;

  constructor(fileName: string, batchID: string, uploadSessionID: string | null) {
    super(
      `Refusing to stage ${fileName} (batch ${batchID}): upload session ${uploadSessionID ?? '(none)'} has not completed the census replacement. ` +
        `Run replaceCensusForCleanReupload before the first staging transaction.`
    );
    this.name = 'CensusReplacementIncompleteError';
    this.fileName = fileName;
    this.batchID = batchID;
    this.uploadSessionID = uploadSessionID;
  }
}

/**
 * Thrown when a chunk's input is structurally empty (see blank-measurement-input.ts)
 * BEFORE any write or the destructive CLEAN_REUPLOAD cleanup. Second line of defense
 * behind the worker's own per-file guard, so every caller gets the same protection even
 * if its own empty-file check is missing. Callers map this to their own error surface
 * (sync route returns 422; the worker never reaches here, having already failed first).
 */
export class EmptyMeasurementUploadError extends Error {
  readonly fileName: string;
  readonly batchID: string;

  constructor(fileName: string, batchID: string) {
    super(
      `Refusing to stage ${fileName} (batch ${batchID}): the input has no data rows (header-only or entirely blank). ` +
        `A Clean Re-Upload must not replace existing census data with an empty file.`
    );
    this.name = 'EmptyMeasurementUploadError';
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
   * 0-based ordinal of this chunk's first raw row in the file. Rows are staged
   * under their final sub-batch (see subBatchIDForRowOrdinal), so setup never
   * rewrites BatchID. null stages under `batchID` unchanged (legacy clients);
   * setup's fallback split handles those rows.
   */
  firstRowOrdinal: number | null;
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
   * Opt this chunk out of the CLEAN_REUPLOAD census replacement, and out of the
   * guard that requires it, even when uploadMode is CLEAN_REUPLOAD. The async
   * upload worker ingests file-by-file, so by the time its second file stages,
   * the first file's batch is already 'completed' in uploadmetrics — replacing
   * the census again would destroy that batch's freshly ingested rows (the
   * replacement deletes every census batch except the current one). The worker
   * therefore runs replaceCensusForCleanReupload only for the job's FIRST file.
   * The synchronous upload route stages all files before any ingestion, so it
   * never sets this.
   */
  suppressCensusReplacementCleanup?: boolean;
  /**
   * Invoked with the resolution's parse rejects as soon as resolution finishes,
   * BEFORE any database writes — so callers can surface partial failures even
   * when a later statement throws and the transaction rolls back.
   */
  onInvalidRows?: (invalidRows: FileRow[]) => void;
  /**
   * This chunk's own identity for the file_upload running-totals merge
   * (mergeFileUploadChunkIntoMetadata, #507). `batchID` can't serve this role
   * since one file's chunks share one batchID. Defaults to `batchID` for
   * callers that stage one chunk per batchID.
   */
  chunkIdentity?: string;
}

export interface StageMeasurementChunkResult {
  insertedCount: number;
  invalidRows: FileRow[]; // parse rejects for later recording
  droppedCount: number;
  /** Rows the chunk attempted to insert (post-resolution). */
  expectedCount: number;
  /** The resolved (or pre-keyed) rows that were staged — callers use these for content hashing. */
  stagedRows: FileRow[];
  /**
   * Header-resolution diagnostics (null on the pre-keyed path, which skips resolution).
   * Surfaced so silently-dropped columns / unparseable inputs are visible to callers
   * instead of vanishing.
   */
  diagnostics: { invalidDateValues: string[]; extraColumnRows: number; ignoredColumnCount: number } | null;
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
    plotX: toNullableNumber(row.px),
    plotY: toNullableNumber(row.py),
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

export type CensusReplacementParams = Omit<StageMeasurementChunkParams, 'transactionID'>;
export type { CensusReplacementSessionScope };

export interface PreparedMeasurementChunk {
  firstRowOrdinal: number | null;
  chunkRows: FileRow[];
  chunkRowOffsets: number[];
  rowBatchIDs: string[];
  invalidRows: FileRow[];
  diagnostics: StageMeasurementChunkResult['diagnostics'];
}

/** Every input check staging makes, with no database access, so a bad file is rejected before anything is deleted (#504). */
export function prepareMeasurementChunkForStaging(params: CensusReplacementParams): PreparedMeasurementChunk {
  const fileIDError = measurementFileIDValidationError(params.fileName);
  if (fileIDError) {
    throw new Error(fileIDError);
  }

  // Structural emptiness guard — before resolution, any write, and the destructive
  // CLEAN_REUPLOAD cleanup below (issue #504). "Empty" is structural (no rows, or every
  // row blank), NOT "zero rows survived validation" — an all-invalid nonempty file must
  // still reach resolution so its failures are recorded normally. preKeyedRows takes
  // precedence here because when set, rawRows is ignored entirely (see JSDoc above).
  const structuralInputRows = params.preKeyedRows ?? params.rawRows;
  if (isEffectivelyEmptyMeasurementInput(structuralInputRows)) {
    throw new EmptyMeasurementUploadError(params.fileName, params.batchID);
  }

  const { fileName, batchID, rawRows, csvHeaders, delimiter, storedMapping } = params;

  const firstRowOrdinal = parseFirstRowOrdinal(params.firstRowOrdinal);
  if (firstRowOrdinal !== null && batchID.length > MAX_ORIGINAL_BATCH_ID_LENGTH) {
    throw new OriginalBatchIDTooLongError(batchID);
  }

  let chunkRows: FileRow[];
  let chunkRowOffsets: number[];
  const invalidRows: FileRow[] = [];
  let diagnostics: StageMeasurementChunkResult['diagnostics'] = null;

  if (params.preKeyedRows) {
    chunkRows = params.preKeyedRows;
    // Pre-keyed rows carry no raw positions. A position is never later than
    // the row's raw ordinal, so no sub-batch can grow past the batch size.
    chunkRowOffsets = chunkRows.map((_, index) => index);
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
    chunkRowOffsets = resolved.validRowSourceIndexes;
    invalidRows.push(...resolved.invalidRows);
    diagnostics = resolved.diagnostics;
    if (diagnostics.ignoredColumnCount > 0) {
      ailogger.warn(`Column mapping for ${fileName}-${batchID} dropped ${diagnostics.ignoredColumnCount} unmatched column(s); they will not be ingested.`);
    }
  }

  const rowBatchIDs =
    firstRowOrdinal === null ? chunkRows.map(() => batchID) : chunkRowOffsets.map(offset => subBatchIDForRowOrdinal(batchID, firstRowOrdinal + offset));

  return { firstRowOrdinal, chunkRows, chunkRowOffsets, rowBatchIDs, invalidRows, diagnostics };
}

export async function stageMeasurementChunk(connectionManager: ConnectionManager, params: StageMeasurementChunkParams): Promise<StageMeasurementChunkResult> {
  const { firstRowOrdinal, chunkRows, chunkRowOffsets, rowBatchIDs, invalidRows, diagnostics } = prepareMeasurementChunkForStaging(params);
  params.onInvalidRows?.(invalidRows);

  const { schema, fileName, batchID, plotID, censusID, uploadMode, sourceFormat, uploadSessionID, transactionID, changedBy } = params;

  await ensureTemporaryMeasurementsSourceFormatColumn(connectionManager, schema);

  // Only the census-replacing path reads the marker, so only it pays for the
  // column check — a revisions or append upload issues no extra statement.
  const mayConsultCensusReplacementMarker = uploadSessionID !== null && uploadMode === UploadMode.CLEAN_REUPLOAD && !params.suppressCensusReplacementCleanup;
  if (mayConsultCensusReplacementMarker) {
    await ensureUploadSessionReplacementMarkerColumn(connectionManager, schema, CENSUS_REPLACEMENT_MARKER_COLUMN);
  }

  const fileUploadAttemptIdentity = uploadSessionID ?? batchID;
  const fileUploadRecordID = buildFileUploadChangelogRecordID(fileName, fileUploadAttemptIdentity);
  // Falls back to batchID only for a caller that genuinely stages one chunk
  // per batchID — see StageMeasurementChunkParams.chunkIdentity's doc comment.
  const chunkIdentity = params.chunkIdentity ?? batchID;

  const summaryLockName = buildFileUploadSummaryLockName(schema, fileUploadRecordID, censusID);
  const summaryLockAcquired = await connectionManager.acquireApplicationLock(summaryLockName, transactionID, FILE_UPLOAD_SUMMARY_LOCK_TIMEOUT_MS);
  if (!summaryLockAcquired) {
    throw new Error(`Failed to acquire the file-upload summary serialization lock for ${fileUploadRecordID} within ${FILE_UPLOAD_SUMMARY_LOCK_TIMEOUT_MS}ms`);
  }

  const expectedRowCount = chunkRows.length;

  // The family probe gates the guard: a chunk of a family that already staged rows
  // belongs to an upload in progress, whose first chunk already passed the guard.
  // Batch IDs are fresh per upload attempt and the worker clears the family before
  // a retry, so only the first chunk to land cleans stale batches of this file.
  if (!(await familyHasStagedRows(connectionManager, schema, fileName, batchID, transactionID))) {
    if (uploadMode === UploadMode.CLEAN_REUPLOAD && !params.suppressCensusReplacementCleanup) {
      const censusReplacementCompleted =
        uploadSessionID !== null &&
        (await uploadSessionHasCompletedReplacement(connectionManager, schema, uploadSessionID, CENSUS_REPLACEMENT_MARKER_COLUMN, transactionID));
      if (!censusReplacementCompleted) throw new CensusReplacementIncompleteError(fileName, batchID, uploadSessionID);
    }
    await cleanupStaleMeasurementBatchesForFile(connectionManager, schema, fileName, batchID, plotID, censusID, transactionID);
  }

  const actualInsertedCount = await insertTemporaryMeasurementsInBatches(
    connectionManager,
    schema,
    chunkRows,
    fileName,
    rowBatchIDs,
    uploadSessionID,
    sourceFormat,
    plotID,
    censusID,
    transactionID
  );

  // A present-but-unparseable PublishedStemID is coerced to NULL at staging so the row still
  // ingests, but the SI-assigned identifier the upload carried is lost. Surface it as a
  // visible warning alert rather than dropping it silently.
  const invalidPublishedStemIdRows = chunkRows
    .map((row, index) => ({ value: row.publishedstemid, sourceRowIndex: index + 1 }))
    .filter(candidate => isUnsignedIntFieldInvalid(candidate.value));

  if (invalidPublishedStemIdRows.length > 0) {
    ailogger.warn(
      `Coerced ${invalidPublishedStemIdRows.length} unparseable PublishedStemID value(s) to NULL for ${fileName}-${batchID}; ` +
        `the SI-assigned identifier was not stored for those rows.`
    );
    try {
      const publishedStemIdAlertSQL = safeFormatQuery(
        schema,
        `INSERT INTO ??.uploadintegrityalerts
         (uploadId, fileID, batchID, plotID, censusID, type, message, severity,
          sourceRecords, processedRecords, failedRecords, missingRecords)
         VALUES (?, ?, ?, ?, ?, 'INVALID_PUBLISHED_STEMID', ?, 'warning', ?, ?, ?, ?)`
      );
      const publishedStemIdAlertMessage = JSON.stringify({
        coercedToNullCount: invalidPublishedStemIdRows.length,
        sample: invalidPublishedStemIdRows.slice(0, 10).map(candidate => ({
          sourceRowIndex: candidate.sourceRowIndex,
          value: `${candidate.value}`
        })),
        note: 'PublishedStemID values that are present but not a positive integer were stored as NULL; the row was still ingested.'
      });
      await connectionManager.executeQuery(
        publishedStemIdAlertSQL,
        [
          buildUploadId(schema, plotID, censusID, fileName, batchID, 'invalid-published-stemid'),
          fileName,
          batchID,
          plotID,
          censusID,
          publishedStemIdAlertMessage,
          expectedRowCount,
          expectedRowCount,
          0,
          0
        ],
        transactionID
      );
    } catch (alertError: unknown) {
      const message = alertError instanceof Error ? alertError.message : String(alertError);
      ailogger.error(`Failed to log INVALID_PUBLISHED_STEMID alert for ${fileName}-${batchID}: ${message}`);
    }
  }

  // Check for discrepancy - this would indicate INSERT IGNORE silently dropped rows
  const droppedRowCount = expectedRowCount - actualInsertedCount;

  if (droppedRowCount > 0) {
    ailogger.error(
      `DATA INTEGRITY WARNING: Expected ${expectedRowCount} rows but only ${actualInsertedCount} were inserted for ${fileName}-${batchID}. ` +
        `${droppedRowCount} row(s) were silently dropped by INSERT IGNORE (likely duplicates). This indicates potential data loss!`
    );

    const droppedCandidates = await findDroppedMeasurementCandidates(
      connectionManager,
      schema,
      fileName,
      rowBatchIDs,
      plotID,
      censusID,
      chunkRows,
      transactionID
    );
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

    // Persist dropped rows as unresolved ingestion errors in coremeasurements,
    // audited bounded to exactly these rows' (fileID, batchID, SourceRowIndex)
    // keys via the shared helper (#507) — never the whole batch scope other
    // chunks of this same upload share. See recordAuditedIngestionFailureRows's
    // doc comment for the retry contract this block implements: a
    // ChangelogWriteError is an audit-infrastructure failure and must roll
    // back this whole transaction immediately, never be treated as a
    // retryable DATA-persistence problem by the best-effort fallback below.
    if (droppedRows.length > 0) {
      const ingestionFailureRows = buildIngestionFailurePayload(droppedRows, plotID, censusID, fileName, batchID);

      try {
        const auditedResult = await recordAuditedIngestionFailureRows({
          connectionManager,
          schema,
          rows: ingestionFailureRows,
          transactionID,
          changedBy: changedBy ?? null,
          plotID,
          censusID
        });
        ailogger.info(
          `Persisted ${droppedRows.length} dropped rows as unresolved ingestion errors for ${fileName}-${batchID} ` +
            `(audited: ${auditedResult.insertedCount} inserted, ${auditedResult.updatedCount} updated, ${auditedResult.unchangedCount} unchanged)`
        );
      } catch (failedInsertError: unknown) {
        if (failedInsertError instanceof ChangelogWriteError) {
          throw failedInsertError;
        }

        const failedInsertMessage = failedInsertError instanceof Error ? failedInsertError.message : String(failedInsertError);
        ailogger.error(`Failed to persist dropped rows as unresolved ingestion errors (attempt 1): ${failedInsertMessage}`);

        // Retry once before giving up
        try {
          const retryAuditedResult = await recordAuditedIngestionFailureRows({
            connectionManager,
            schema,
            rows: ingestionFailureRows,
            transactionID,
            changedBy: changedBy ?? null,
            plotID,
            censusID
          });
          ailogger.info(
            `Retry successful: persisted ${droppedRows.length} dropped rows as unresolved ingestion errors for ${fileName}-${batchID} ` +
              `(audited: ${retryAuditedResult.insertedCount} inserted, ${retryAuditedResult.updatedCount} updated, ${retryAuditedResult.unchangedCount} unchanged)`
          );
        } catch (retryError: unknown) {
          if (retryError instanceof ChangelogWriteError) {
            throw retryError;
          }

          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
          ailogger.error(`Failed to persist dropped rows as unresolved ingestion errors (attempt 2): ${retryMessage}`);

          // Critical: log to uploadintegrityalerts so data loss is not silent.
          try {
            const alertUploadId = buildUploadId(schema, plotID, censusID, fileName, batchID, 'failed-insert-to-unresolved-coremeasurements');
            const alertSQL = safeFormatQuery(
              schema,
              `INSERT INTO ??.uploadintegrityalerts
               (uploadId, fileID, batchID, plotID, censusID, type, message, severity,
                sourceRecords, processedRecords, failedRecords, missingRecords)
               VALUES (?, ?, ?, ?, ?, 'FAILED_INSERT_TO_UNRESOLVED_COREMEASUREMENTS', ?, 'critical', ?, ?, ?, ?)`
            );
            const alertMessage = JSON.stringify({
              error: retryMessage,
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
          } catch (alertError: unknown) {
            const alertErrorMessage = alertError instanceof Error ? alertError.message : String(alertError);
            ailogger.error(`CRITICAL: Failed to log data loss to uploadintegrityalerts: ${alertErrorMessage}. Dropped rows: ${droppedRows.length}`);
          }
        }
      }
    }
  } else {
    ailogger.info(`Successfully inserted ${actualInsertedCount} rows for ${fileName}-${batchID} (expected: ${expectedRowCount}, no data loss detected)`);
  }

  // Track file upload in unifiedchangelog (single row per upload ATTEMPT, not
  // per batch — and NOT per filename: see buildFileUploadChangelogRecordID's
  // doc comment, issue #507. uploadSessionID identifies the attempt when one
  // exists; batchID (the incoming batch family) is the fallback when it does
  // not, which still separates distinct ingestion attempts for the same file.
  try {
    const existingEntrySQL = safeFormatQuery(
      schema,
      `SELECT ChangeID, NewRowState FROM ??.unifiedchangelog
       WHERE TableName = '${CHANGELOG_TABLE_NAME}' AND RecordID = ? AND CensusID = ?
       ORDER BY ChangeID DESC LIMIT 1
       FOR UPDATE`
    );
    const existingEntry = await connectionManager.executeQuery(existingEntrySQL, [fileUploadRecordID, censusID], transactionID);

    if (existingEntry.length === 0) {
      // First chunk for this attempt - insert new entry
      const uploadMetadata: Record<string, unknown> = {
        fileName,
        uploadSessionID,
        formType: MEASUREMENTS_FORM_TYPE,
        sourceFormat,
        uploadMode
      };
      mergeFileUploadChunkIntoMetadata(uploadMetadata, chunkIdentity, { rowCount: actualInsertedCount, droppedCount: droppedRowCount });
      const insertChangelogSQL = safeFormatQuery(
        schema,
        `INSERT INTO ??.unifiedchangelog
        (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
        VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`
      );
      await connectionManager.executeQuery(
        insertChangelogSQL,
        [CHANGELOG_TABLE_NAME, fileUploadRecordID, 'INSERT', JSON.stringify(uploadMetadata), params.changedBy ?? null, plotID, censusID],
        transactionID
      );
    } else {
      // Subsequent chunk - merge this chunk's counts into the accumulated
      // total, keyed by chunkIdentity (#507) — see mergeFileUploadChunkIntoMetadata.
      // Handle both string and already-parsed object (MySQL driver may auto-parse JSON columns)
      const metadata = typeof existingEntry[0].NewRowState === 'string' ? JSON.parse(existingEntry[0].NewRowState) : existingEntry[0].NewRowState;
      metadata.sourceFormat = sourceFormat;
      metadata.uploadMode = uploadMode;
      mergeFileUploadChunkIntoMetadata(metadata, chunkIdentity, { rowCount: actualInsertedCount, droppedCount: droppedRowCount });
      const updateChangelogSQL = safeFormatQuery(schema, `UPDATE ??.unifiedchangelog SET NewRowState = ?, ChangeTimestamp = NOW() WHERE ChangeID = ?`);
      await connectionManager.executeQuery(updateChangelogSQL, [JSON.stringify(metadata), existingEntry[0].ChangeID], transactionID);
    }
  } catch (logError: any) {
    // Propagate (#507): this is the ONLY `unifiedchangelog` record of the
    // upload attempt itself (file_upload), separate from the per-row
    // coremeasurements audit ingestBatch writes later. Swallowing this let
    // the staged rows commit with no Recent Changes trace that the upload
    // ever happened — silently incomplete, not merely best-effort. The
    // caller owns transactionID (see module doc above), so throwing here
    // rolls the WHOLE chunk back, including the temporarymeasurements rows
    // just staged, and the caller's retry starts from a clean, consistent
    // state rather than retrying on top of an already-staged-but-unlogged chunk.
    ailogger.error('Failed to log file upload to changelog', logError);
    throw logError;
  }

  return {
    insertedCount: actualInsertedCount,
    invalidRows,
    droppedCount: droppedRowCount,
    expectedCount: expectedRowCount,
    stagedRows: chunkRows,
    diagnostics
  };
}

/** How far below the stale-transaction reaper's threshold every census-replacement callback must finish. */
export const CENSUS_REPLACEMENT_REAPER_HEADROOM_FACTOR = 4;
/**
 * Callback deadline of every census-replacement transaction: ConnectionManager.DEFAULT_STALE_TRANSACTION_THRESHOLD_MS
 * (240,000) divided by CENSUS_REPLACEMENT_REAPER_HEADROOM_FACTOR. A literal rather than computed when the module loads:
 * suites that mock ConnectionManager have no static, and NaN would pass through withTransaction's `??` as a 1 ms timer.
 * stage-measurements.test.ts asserts the ratio against the real class.
 */
export const CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS = 60_000;

export const CENSUS_REPLACEMENT_STARTED_EVENT = 'upload.census_replacement.started';
export const CENSUS_REPLACEMENT_COMPLETED_EVENT = 'upload.census_replacement.completed';

export type CensusReplacementOutcome = 'not_applicable' | 'already_completed' | 'upload_in_progress' | 'completed_by_peer' | 'replaced';
export interface CensusReplacementResult {
  outcome: CensusReplacementOutcome;
  deletedRows: number;
  windowCount: number;
}
interface CensusReplacementProgress {
  deletedRows: number;
  windowCount: number;
  slowestWindowMs: number;
}
type CensusReplacementUnitResult<T> = { completedByPeer: true } | { completedByPeer: false; value: T };
type CensusReplacementLoopEnd = 'done' | 'completed_by_peer';

const NO_REPLACEMENT_WORK = { deletedRows: 0, windowCount: 0 } as const;

async function runCensusReplacementUnit<T>(
  connectionManager: ConnectionManager,
  scope: CensusReplacementSessionScope,
  progress: CensusReplacementProgress | null,
  work: (transactionID: string) => Promise<T>
): Promise<CensusReplacementUnitResult<T>> {
  const startedAt = Date.now();
  try {
    return await connectionManager.withTransaction<CensusReplacementUnitResult<T>>(
      async tx => {
        const sessionLock = await lockUploadSessionForCensusReplacement(connectionManager, scope, tx.id);
        if (sessionLock === 'marker_already_set') return { completedByPeer: true };
        return { completedByPeer: false, value: await work(tx.id) };
      },
      { timeoutMs: CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS }
    );
  } finally {
    if (progress) progress.slowestWindowMs = Math.max(progress.slowestWindowMs, Date.now() - startedAt);
  }
}

async function deleteMeasurementWindows(
  connectionManager: ConnectionManager,
  params: CensusReplacementParams,
  scope: CensusReplacementSessionScope,
  progress: CensusReplacementProgress
): Promise<CensusReplacementLoopEnd> {
  let cursor: number | null = 0;
  while (cursor !== null) {
    const windowCursor: number = cursor;
    const unit = await runCensusReplacementUnit(connectionManager, scope, progress, transactionID =>
      deleteCensusReplacementChunk(
        connectionManager,
        scope.schema,
        params.batchID,
        scope.plotID,
        scope.censusID,
        windowCursor,
        params.changedBy ?? null,
        transactionID
      )
    );
    if (unit.completedByPeer) return 'completed_by_peer';
    progress.windowCount += 1;
    progress.deletedRows += unit.value.deletedRows;
    cursor = nextCensusReplacementCursor(windowCursor, unit.value);
  }
  return 'done';
}

async function deleteLegacyFailureWindows(
  connectionManager: ConnectionManager,
  params: CensusReplacementParams,
  scope: CensusReplacementSessionScope,
  progress: CensusReplacementProgress
): Promise<CensusReplacementLoopEnd> {
  for (;;) {
    const unit = await runCensusReplacementUnit(connectionManager, scope, progress, transactionID =>
      deleteCensusReplacementLegacyFailuresWindow(connectionManager, scope.schema, params.batchID, scope.censusID, transactionID)
    );
    if (unit.completedByPeer) return 'completed_by_peer';
    if (unit.value.legacyTableMissing || unit.value.deletedRows < CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE) return 'done';
  }
}

async function deleteMetricsWindows(
  connectionManager: ConnectionManager,
  params: CensusReplacementParams,
  scope: CensusReplacementSessionScope,
  progress: CensusReplacementProgress
): Promise<CensusReplacementLoopEnd> {
  for (;;) {
    const unit = await runCensusReplacementUnit(connectionManager, scope, progress, transactionID =>
      deleteCensusReplacementMetricsWindow(connectionManager, scope.schema, params.batchID, scope.plotID, scope.censusID, transactionID)
    );
    if (unit.completedByPeer) return 'completed_by_peer';
    if (unit.value < CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE) return 'done';
  }
}

/** Unit D: the marker, in a transaction of its own, so it is set only after every deleting unit committed. */
export async function completeCensusReplacement(
  connectionManager: ConnectionManager,
  scope: CensusReplacementSessionScope
): Promise<'replaced' | 'completed_by_peer'> {
  const unit = await runCensusReplacementUnit(connectionManager, scope, null, transactionID =>
    markUploadSessionReplacementCompleted(connectionManager, scope.schema, scope.uploadSessionID, CENSUS_REPLACEMENT_MARKER_COLUMN, transactionID)
  );
  return unit.completedByPeer ? 'completed_by_peer' : 'replaced';
}

async function runCensusReplacementUnits(
  connectionManager: ConnectionManager,
  params: CensusReplacementParams,
  scope: CensusReplacementSessionScope,
  progress: CensusReplacementProgress
): Promise<'replaced' | 'completed_by_peer'> {
  if ((await deleteMeasurementWindows(connectionManager, params, scope, progress)) === 'completed_by_peer') return 'completed_by_peer';
  if ((await deleteLegacyFailureWindows(connectionManager, params, scope, progress)) === 'completed_by_peer') return 'completed_by_peer';
  if ((await deleteMetricsWindows(connectionManager, params, scope, progress)) === 'completed_by_peer') return 'completed_by_peer';

  const completionStartedAt = Date.now();
  const completion = await completeCensusReplacement(connectionManager, scope);
  progress.slowestWindowMs = Math.max(progress.slowestWindowMs, Date.now() - completionStartedAt);
  return completion;
}

/**
 * Replaces the census for a CLEAN_REUPLOAD before the caller opens its staging
 * transaction, as separately committed transactions (units A-D, issue #555).
 * The marker is set only by the last one, so an interrupted replacement leaves
 * it unset and the next call resumes with the rows that are left.
 */
export async function replaceCensusForCleanReupload(connectionManager: ConnectionManager, params: CensusReplacementParams): Promise<CensusReplacementResult> {
  if (params.uploadMode !== UploadMode.CLEAN_REUPLOAD || params.suppressCensusReplacementCleanup) return { outcome: 'not_applicable', ...NO_REPLACEMENT_WORK };
  if (params.uploadSessionID === null) throw new UploadSessionOwnershipError('An upload session is required to replace a census.');
  const scope: CensusReplacementSessionScope = {
    schema: params.schema,
    plotID: params.plotID,
    censusID: params.censusID,
    uploadSessionID: params.uploadSessionID
  };

  await ensureUploadSessionReplacementMarkerColumn(connectionManager, scope.schema, CENSUS_REPLACEMENT_MARKER_COLUMN);
  if (await uploadSessionHasCompletedReplacement(connectionManager, scope.schema, scope.uploadSessionID, CENSUS_REPLACEMENT_MARKER_COLUMN)) {
    return { outcome: 'already_completed', ...NO_REPLACEMENT_WORK };
  }
  if (await familyHasStagedRows(connectionManager, scope.schema, params.fileName, params.batchID))
    return { outcome: 'upload_in_progress', ...NO_REPLACEMENT_WORK };

  const prepared = prepareMeasurementChunkForStaging(params);
  params.onInvalidRows?.(prepared.invalidRows);

  const logKeys = { schema: scope.schema, plotID: scope.plotID, censusID: scope.censusID, uploadSessionID: scope.uploadSessionID, batchID: params.batchID };
  ailogger.info(CENSUS_REPLACEMENT_STARTED_EVENT, logKeys);
  const startedAt = Date.now();
  const progress: CensusReplacementProgress = { deletedRows: 0, windowCount: 0, slowestWindowMs: 0 };
  const outcome = await runCensusReplacementUnits(connectionManager, params, scope, progress);
  ailogger.info(CENSUS_REPLACEMENT_COMPLETED_EVENT, { ...logKeys, outcome, ...progress, elapsedMs: Date.now() - startedAt });
  return { outcome, deletedRows: progress.deletedRows, windowCount: progress.windowCount };
}

/** Rows staged for the file under `batchID` or any of its `__subNNN` members, in the given plot/census. */
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
    `SELECT COUNT(*) as count FROM ??.temporarymeasurements
     WHERE FileID = ? AND (BatchID = ? OR BatchID LIKE ? ${LIKE_ESCAPE_CLAUSE}) AND PlotID = ? AND CensusID = ?`
  );
  const rows = await connectionManager.executeQuery(countSQL, [fileName, batchID, buildSubBatchPattern(batchID), plotID, censusID]);
  return Number(rows?.[0]?.count ?? 0);
}
