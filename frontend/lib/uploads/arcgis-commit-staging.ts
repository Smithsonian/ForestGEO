/**
 * Unit S of an ArcGIS commit (#561): one window of the import's rows, staged in the caller's transaction together
 * with that window's dropped-row failures and the cursor move. Either every source row of the window is accounted
 * for (inserted, or recorded as an audited failure) and the cursor moves, or the window rolls back
 * (ArcgisStagingAccountingError). Staging runs before the census replacement, so this error always comes before an
 * attempt deletes anything from the census.
 */
import moment from 'moment';
import ConnectionManager from '@/lib/db/connectionmanager';
import { SourceFormat, type FileRow } from '@/config/macros/formdetails';
import { recordAuditedIngestionFailureRows } from '@/lib/changelog/ingestion-failure-audit';
import {
  advanceArcgisImportStagingCursor,
  ArcgisImportSessionInvariantError,
  ArcgisStagingAccountingError,
  loadArcgisImportRowWindow,
  type ArcgisCommitAttempt,
  type ArcgisCommitUnitSnapshot
} from '@/lib/arcgis/import-session';
import {
  buildDroppedMeasurementFailureReason,
  findDroppedMeasurementCandidates,
  insertTemporaryMeasurementsInBatches
} from '@/lib/ingestion/temporary-measurements';
import { subBatchIDForRowOrdinal } from '@/lib/uploads/batch-family';

const ARCGIS_COMMIT_INSERT_FAILURE_FALLBACK = 'Unknown error during insert';
const MEASUREMENT_DATE_FORMAT = 'YYYY-MM-DD';

export interface ArcgisStagingWindowResult {
  sourceRows: number;
  insertedRows: number;
  failureRows: number;
  nextRowIndex: number;
}

interface DroppedWindowRowsOutcome {
  candidates: number;
  persisted: number;
}

function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function recordDroppedWindowRows(
  connectionManager: ConnectionManager,
  attempt: ArcgisCommitAttempt,
  fileName: string,
  firstRowIndex: number,
  rows: FileRow[],
  rowBatchIDs: string[],
  transactionID: string
): Promise<DroppedWindowRowsOutcome> {
  const candidates = await findDroppedMeasurementCandidates(
    connectionManager,
    attempt.schema,
    fileName,
    rowBatchIDs,
    attempt.plotID,
    attempt.censusID,
    rows,
    transactionID
  );
  if (candidates.length === 0) return { candidates: 0, persisted: 0 };
  const audit = await recordAuditedIngestionFailureRows({
    connectionManager,
    schema: attempt.schema,
    rows: candidates.map(candidate => {
      const row = rows[candidate.rowOrdinal - 1];
      return {
        plotID: attempt.plotID,
        censusID: attempt.censusID,
        tag: row.tag,
        stemTag: row.stemtag || null,
        spCode: row.spcode,
        quadrat: row.quadrat,
        x: toNullableNumber(row.lx),
        y: toNullableNumber(row.ly),
        dbh: toNullableNumber(row.dbh),
        hom: toNullableNumber(row.hom),
        date: row.date ? moment(row.date).format(MEASUREMENT_DATE_FORMAT) : null,
        codes: row.codes || null,
        comments: null,
        fileID: fileName,
        batchID: attempt.batchID,
        sourceRowIndex: firstRowIndex + candidate.rowOrdinal,
        failureReason: buildDroppedMeasurementFailureReason(row, candidate.existingBatch) || ARCGIS_COMMIT_INSERT_FAILURE_FALLBACK
      };
    }),
    transactionID,
    changedBy: attempt.changedBy,
    plotID: attempt.plotID,
    censusID: attempt.censusID
  });
  return { candidates: candidates.length, persisted: audit.insertedCount + audit.updatedCount + audit.unchangedCount };
}

export async function stageArcgisImportWindow(
  connectionManager: ConnectionManager,
  attempt: ArcgisCommitAttempt,
  snapshot: ArcgisCommitUnitSnapshot,
  windowRows: number,
  transactionID: string
): Promise<ArcgisStagingWindowResult> {
  const firstRowIndex = snapshot.stagingNextRowIndex;
  const sourceRows = Math.min(windowRows, snapshot.rowCount - firstRowIndex);
  if (sourceRows <= 0) {
    throw new ArcgisImportSessionInvariantError(attempt.importSessionId, `staging window requested at cursor ${firstRowIndex} of ${snapshot.rowCount}`);
  }

  const rows = await loadArcgisImportRowWindow(connectionManager, attempt.schema, attempt.importSessionId, firstRowIndex, sourceRows, transactionID);
  const rowBatchIDs = rows.map((_, offset) => subBatchIDForRowOrdinal(attempt.batchID, firstRowIndex + offset));
  const insertedRows = await insertTemporaryMeasurementsInBatches(
    connectionManager,
    attempt.schema,
    rows,
    snapshot.fileName,
    rowBatchIDs,
    attempt.uploadSessionID,
    SourceFormat.arcgis_xlsx,
    attempt.plotID,
    attempt.censusID,
    transactionID
  );
  const dropped =
    insertedRows < sourceRows
      ? await recordDroppedWindowRows(connectionManager, attempt, snapshot.fileName, firstRowIndex, rows, rowBatchIDs, transactionID)
      : { candidates: 0, persisted: 0 };

  if (insertedRows + dropped.persisted !== sourceRows) {
    throw new ArcgisStagingAccountingError({
      importSessionId: attempt.importSessionId,
      firstRowIndex,
      sourceRows,
      insertedRows,
      droppedCandidates: dropped.candidates,
      persistedFailureRows: dropped.persisted
    });
  }
  const nextRowIndex = firstRowIndex + sourceRows;
  await advanceArcgisImportStagingCursor(connectionManager, attempt, { fromRowIndex: firstRowIndex, toRowIndex: nextRowIndex, insertedRows }, transactionID);
  return { sourceRows, insertedRows, failureRows: dropped.persisted, nextRowIndex };
}
