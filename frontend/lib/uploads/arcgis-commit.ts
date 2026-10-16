/**
 * ArcGIS commit orchestration — the single mechanism for committing a
 * pre-flighted ArcGIS import session into `temporarymeasurements`.
 *
 * Both the HTTP commit route (app/api/arcgis/commit/route.ts) and the
 * background upload worker call commitArcgisImport; neither owns any commit
 * internals of its own. The caller owns authentication, scope, and
 * upload-session-ownership checks; this function owns the commit transaction
 * (claim -> staging insert -> dropped-row persistence -> changelog ->
 * mark-committed) and is idempotent for same-batch retries via the
 * alreadyCommitted path of claimArcgisImportSessionForCommit.
 */

import moment from 'moment';
import ailogger from '@/ailogger';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { FormType, SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import {
  ArcgisImportSessionError,
  claimArcgisImportSessionForCommit,
  ensureArcgisImportTables,
  markArcgisImportSessionCommitted
} from '@/lib/arcgis/import-session';
import {
  buildDroppedMeasurementFailureReason,
  cleanupPreviousFileUploads,
  cleanupStaleMeasurementBatchesForFile,
  ensureTemporaryMeasurementsSourceFormatColumn,
  findDroppedMeasurementCandidates,
  insertTemporaryMeasurementsInBatches,
  type DroppedMeasurementRow
} from '@/lib/ingestion/temporary-measurements';
import { buildFileUploadChangelogRecordID, measurementFileIDValidationError, mergeFileUploadChunkIntoMetadata } from '@/lib/uploads/file-names';
import { recordAuditedIngestionFailureRows } from '@/lib/changelog/ingestion-failure-audit';
import {
  BatchIDContainsSubBatchSeparatorError,
  MAX_ORIGINAL_BATCH_ID_LENGTH,
  OriginalBatchIDTooLongError,
  SUB_BATCH_SEPARATOR,
  SubBatchOrdinalOverflowError,
  subBatchIDForRowOrdinal
} from '@/lib/uploads/batch-family';

const ARCGIS_COMMIT_INSERT_FAILURE_FALLBACK = 'Unknown error during insert';
const CHANGELOG_TABLE_NAME = 'file_upload';

export interface CommitArcgisImportParams {
  schema: string;
  plotID: number;
  censusID: number;
  importSessionId: string;
  fileName: string;
  batchID: string;
  uploadMode: UploadMode;
  userId: string;
  uploadSessionID: string;
}

export interface CommitArcgisImportResult {
  rowCount: number;
  fileName: string;
  alreadyCommitted: boolean;
}

function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Stages each row under its final sub-batch, so setup has nothing to split. The
 * batch ID length is checked before the transaction; a session with more rows
 * than the sub-batch suffix can name is only knowable once it is claimed.
 */
function assignArcgisRowBatchIDs(batchID: string, rowCount: number): string[] {
  try {
    return Array.from({ length: rowCount }, (_, rowOrdinal) => subBatchIDForRowOrdinal(batchID, rowOrdinal));
  } catch (error: unknown) {
    if (error instanceof SubBatchOrdinalOverflowError) {
      throw new ArcgisImportSessionError(error.message, HTTPResponses.INVALID_REQUEST);
    }
    throw error;
  }
}

export async function commitArcgisImport(connectionManager: ConnectionManager, params: CommitArcgisImportParams): Promise<CommitArcgisImportResult> {
  const { schema, plotID, censusID, importSessionId, batchID, uploadMode, userId, uploadSessionID } = params;

  if (batchID.length > MAX_ORIGINAL_BATCH_ID_LENGTH) {
    throw new ArcgisImportSessionError(new OriginalBatchIDTooLongError(batchID).message, HTTPResponses.INVALID_REQUEST);
  }

  if (batchID.includes(SUB_BATCH_SEPARATOR)) {
    throw new ArcgisImportSessionError(new BatchIDContainsSubBatchSeparatorError(batchID).message, HTTPResponses.INVALID_REQUEST);
  }

  await ensureArcgisImportTables(schema);
  await ensureTemporaryMeasurementsSourceFormatColumn(connectionManager, schema);

  let insertedCount = 0;
  let fileName = params.fileName;
  let alreadyCommitted = false;
  await connectionManager.withTransaction(async tx => {
    const transactionID = tx.id;
    const staged = await claimArcgisImportSessionForCommit(
      {
        schema,
        importSessionId,
        plotID,
        censusID,
        userId,
        fileName: params.fileName,
        batchID,
        uploadSessionID
      },
      transactionID
    );
    fileName = staged.fileName;
    if (staged.alreadyCommitted) {
      insertedCount = staged.rowCount;
      alreadyCommitted = true;
      return;
    }

    // The committed name comes from the stored session, not params.fileName, and
    // arcgis_import_sessions.file_id is varchar(255) — wider than the FileID
    // chain this row set is about to enter. Re-check at the write boundary so a
    // session captured before the length contract existed fails with a readable
    // error instead of ER_DATA_TOO_LONG mid-transaction.
    const fileIDError = measurementFileIDValidationError(fileName);
    if (fileIDError) {
      throw new ArcgisImportSessionError(fileIDError, HTTPResponses.INVALID_REQUEST);
    }

    if (staged.rows.length === 0) {
      throw new ArcgisImportSessionError('ArcGIS import session contains no rows', HTTPResponses.UNPROCESSABLE_ENTITY);
    }

    const rowBatchIDs = assignArcgisRowBatchIDs(batchID, staged.rows.length);

    if (uploadMode === UploadMode.CLEAN_REUPLOAD) {
      await cleanupPreviousFileUploads(connectionManager, schema, fileName, batchID, plotID, censusID, userId, transactionID);
    }
    await cleanupStaleMeasurementBatchesForFile(connectionManager, schema, fileName, batchID, plotID, censusID, transactionID);

    insertedCount = await insertTemporaryMeasurementsInBatches(
      connectionManager,
      schema,
      staged.rows,
      fileName,
      rowBatchIDs,
      uploadSessionID,
      SourceFormat.arcgis_xlsx,
      plotID,
      censusID,
      transactionID
    );

    const droppedRowCount = staged.rows.length - insertedCount;
    if (droppedRowCount > 0) {
      ailogger.error(
        `DATA INTEGRITY WARNING: Expected ${staged.rows.length} ArcGIS rows but only ${insertedCount} were inserted for ${fileName}-${batchID}. ` +
          `${droppedRowCount} row(s) were silently dropped by INSERT IGNORE (likely duplicates). This indicates potential data loss!`
      );

      const droppedCandidates = await findDroppedMeasurementCandidates(
        connectionManager,
        schema,
        fileName,
        rowBatchIDs,
        plotID,
        censusID,
        staged.rows,
        transactionID
      );
      const droppedRows: DroppedMeasurementRow[] = droppedCandidates.map(candidate => {
        const row = staged.rows[candidate.rowOrdinal - 1];
        return Object.assign({}, row, {
          failureReason: buildDroppedMeasurementFailureReason(row, candidate.existingBatch),
          sourceRowIndex: candidate.rowOrdinal
        }) as DroppedMeasurementRow;
      });

      if (droppedRows.length !== droppedRowCount) {
        ailogger.warn(
          `Dropped-row batch detection identified ${droppedRows.length} of ${droppedRowCount} dropped ArcGIS row(s) for ${fileName}-${batchID}. ` +
            `Persisted unresolved ingestion errors may be incomplete for this commit.`
        );
      }

      if (droppedRows.length > 0) {
        // Unlike the CSV sqlpacketload path, which wraps failure-row persistence in a retry-once-then-uploadintegrityalerts
        // best-effort fallback, this commit deliberately persists dropped rows inside the same transaction as the staging
        // insert so the commit is all-or-nothing: if failure-row persistence (or its audit) throws, the entire commit rolls
        // back rather than leaving a half-committed batch. Do not "restore parity" with a best-effort fallback here — that
        // would weaken atomicity. recordAuditedIngestionFailureRows (#507) bounds its before/after audit to exactly these
        // rows' (fileID, batchID, SourceRowIndex) keys, never the whole batch scope.
        const droppedRowAuditResult = await recordAuditedIngestionFailureRows({
          connectionManager,
          schema,
          rows: droppedRows.map(row => ({
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
            failureReason: row.failureReason || ARCGIS_COMMIT_INSERT_FAILURE_FALLBACK
          })),
          transactionID,
          changedBy: userId,
          plotID,
          censusID
        });
        ailogger.info(
          `Persisted ${droppedRows.length} dropped ArcGIS rows as unresolved ingestion errors for ${fileName}-${batchID} ` +
            `(audited: ${droppedRowAuditResult.insertedCount} inserted, ${droppedRowAuditResult.updatedCount} updated, ` +
            `${droppedRowAuditResult.unchangedCount} unchanged)`
        );
      }
    }

    // Mirror the CSV measurements path (POST /api/sqlpacketload): record a single
    // file_upload row in unifiedchangelog so the ArcGIS commit surfaces in the
    // upload-history UI with the same provenance shape (sourceFormat tags it as
    // arcgis_xlsx). Unlike the CSV path, this write stays inside the commit
    // transaction with no best-effort try/catch fallback: the commit is
    // all-or-nothing, so if changelog tracking fails the staging insert rolls
    // back too rather than leaving an upload invisible in history.
    //
    // RecordID is keyed by upload ATTEMPT (uploadSessionID), not by fileName
    // alone — see buildFileUploadChangelogRecordID's doc comment (#507). ArcGIS
    // commits always carry a non-null uploadSessionID, so there is no fallback
    // branch here.
    const fileUploadRecordID = buildFileUploadChangelogRecordID(fileName, uploadSessionID);
    // FOR UPDATE: serializes this read-merge-write against any concurrent
    // writer of the SAME RecordID under the existing per-commit transaction
    // (same reasoning as the CSV path's identical lock).
    const existingEntrySQL = safeFormatQuery(
      schema,
      `SELECT ChangeID, NewRowState FROM ??.unifiedchangelog
       WHERE TableName = '${CHANGELOG_TABLE_NAME}' AND RecordID = ? AND CensusID = ?
       ORDER BY ChangeID DESC LIMIT 1
       FOR UPDATE`
    );
    const existingEntry = await connectionManager.executeQuery(existingEntrySQL, [fileUploadRecordID, censusID], transactionID);

    if (existingEntry.length === 0) {
      const uploadMetadata: Record<string, unknown> = {
        fileName,
        uploadSessionID,
        formType: FormType.measurements,
        sourceFormat: SourceFormat.arcgis_xlsx,
        uploadMode
      };
      mergeFileUploadChunkIntoMetadata(uploadMetadata, batchID, { rowCount: insertedCount, droppedCount: droppedRowCount });
      const insertChangelogSQL = safeFormatQuery(
        schema,
        `INSERT INTO ??.unifiedchangelog
        (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
        VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`
      );
      await connectionManager.executeQuery(
        insertChangelogSQL,
        [CHANGELOG_TABLE_NAME, fileUploadRecordID, 'INSERT', JSON.stringify(uploadMetadata), userId, plotID, censusID],
        transactionID
      );
    } else {
      // Keyed by batchID (#507), same as the CSV path — see
      // mergeFileUploadChunkIntoMetadata's doc comment. A retry that reaches
      // this branch under the SAME batchID (claimArcgisImportSessionForCommit
      // normally short-circuits that case via alreadyCommitted, so this is
      // belt-and-suspenders) replaces its own contribution rather than adding to it.
      const metadata = typeof existingEntry[0].NewRowState === 'string' ? JSON.parse(existingEntry[0].NewRowState) : existingEntry[0].NewRowState;
      metadata.sourceFormat = SourceFormat.arcgis_xlsx;
      metadata.uploadMode = uploadMode;
      mergeFileUploadChunkIntoMetadata(metadata, batchID, { rowCount: insertedCount, droppedCount: droppedRowCount });
      const updateChangelogSQL = safeFormatQuery(schema, `UPDATE ??.unifiedchangelog SET NewRowState = ?, ChangeTimestamp = NOW() WHERE ChangeID = ?`);
      await connectionManager.executeQuery(updateChangelogSQL, [JSON.stringify(metadata), existingEntry[0].ChangeID], transactionID);
    }

    await markArcgisImportSessionCommitted({ schema, importSessionId, insertedRowCount: insertedCount }, transactionID);
  });

  return { rowCount: insertedCount, fileName, alreadyCommitted };
}
