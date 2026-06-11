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
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { FormType, SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { insertIngestionFailureRows } from '@/config/measurementerrors';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
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

export async function commitArcgisImport(connectionManager: ConnectionManager, params: CommitArcgisImportParams): Promise<CommitArcgisImportResult> {
  const { schema, plotID, censusID, importSessionId, batchID, uploadMode, userId, uploadSessionID } = params;

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

    if (staged.rows.length === 0) {
      throw new ArcgisImportSessionError('ArcGIS import session contains no rows', HTTPResponses.UNPROCESSABLE_ENTITY);
    }

    const countSQL = safeFormatQuery(schema, `SELECT COUNT(*) as count FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?`);
    const preInsertResult = await connectionManager.executeQuery(countSQL, [fileName, batchID], transactionID);
    const preInsertCount = preInsertResult[0]?.count || 0;

    if (uploadMode === UploadMode.CLEAN_REUPLOAD) {
      await cleanupPreviousFileUploads(connectionManager, schema, fileName, batchID, plotID, censusID, transactionID);
    }
    await cleanupStaleMeasurementBatchesForFile(connectionManager, schema, fileName, batchID, plotID, censusID, transactionID);

    await insertTemporaryMeasurementsInBatches(
      connectionManager,
      schema,
      staged.rows,
      fileName,
      batchID,
      uploadSessionID,
      SourceFormat.arcgis_xlsx,
      plotID,
      censusID,
      transactionID
    );

    const postInsertResult = await connectionManager.executeQuery(countSQL, [fileName, batchID], transactionID);
    const postInsertCount = postInsertResult[0]?.count || 0;
    insertedCount = postInsertCount - preInsertCount;

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
        batchID,
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
        // insert so the commit is all-or-nothing: if failure-row persistence throws, the entire commit rolls back rather than
        // leaving a half-committed batch. Do not "restore parity" with a best-effort fallback here — that would weaken atomicity.
        await insertIngestionFailureRows(
          connectionManager,
          schema,
          droppedRows.map(row => ({
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
          transactionID
        );
        ailogger.info(`Persisted ${droppedRows.length} dropped ArcGIS rows as unresolved ingestion errors for ${fileName}-${batchID}`);
      }
    }

    // Mirror the CSV measurements path (POST /api/sqlpacketload): record a single
    // file_upload row in unifiedchangelog so the ArcGIS commit surfaces in the
    // upload-history UI with the same provenance shape (sourceFormat tags it as
    // arcgis_xlsx). Unlike the CSV path, this write stays inside the commit
    // transaction with no best-effort try/catch fallback: the commit is
    // all-or-nothing, so if changelog tracking fails the staging insert rolls
    // back too rather than leaving an upload invisible in history.
    const existingEntrySQL = safeFormatQuery(
      schema,
      `SELECT ChangeID, NewRowState FROM ??.unifiedchangelog
       WHERE TableName = '${CHANGELOG_TABLE_NAME}' AND RecordID = ? AND CensusID = ?
       ORDER BY ChangeID DESC LIMIT 1`
    );
    const existingEntry = await connectionManager.executeQuery(existingEntrySQL, [fileName, censusID], transactionID);

    if (existingEntry.length === 0) {
      const uploadMetadata = JSON.stringify({
        fileName,
        formType: FormType.measurements,
        sourceFormat: SourceFormat.arcgis_xlsx,
        uploadMode,
        rowCount: insertedCount,
        droppedCount: droppedRowCount,
        batchCount: 1
      });
      const insertChangelogSQL = safeFormatQuery(
        schema,
        `INSERT INTO ??.unifiedchangelog
        (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
        VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`
      );
      await connectionManager.executeQuery(
        insertChangelogSQL,
        [CHANGELOG_TABLE_NAME, fileName, 'INSERT', uploadMetadata, userId, plotID, censusID],
        transactionID
      );
    } else {
      const metadata = typeof existingEntry[0].NewRowState === 'string' ? JSON.parse(existingEntry[0].NewRowState) : existingEntry[0].NewRowState;
      metadata.sourceFormat = SourceFormat.arcgis_xlsx;
      metadata.uploadMode = uploadMode;
      metadata.rowCount = (metadata.rowCount || 0) + insertedCount;
      metadata.droppedCount = (metadata.droppedCount || 0) + droppedRowCount;
      metadata.batchCount = (metadata.batchCount || 1) + 1;
      const updateChangelogSQL = safeFormatQuery(schema, `UPDATE ??.unifiedchangelog SET NewRowState = ?, ChangeTimestamp = NOW() WHERE ChangeID = ?`);
      await connectionManager.executeQuery(updateChangelogSQL, [JSON.stringify(metadata), existingEntry[0].ChangeID], transactionID);
    }

    await markArcgisImportSessionCommitted({ schema, importSessionId, insertedRowCount: insertedCount }, transactionID);
  });

  return { rowCount: insertedCount, fileName, alreadyCommitted };
}
