import { beforeEach, describe, expect, it, vi } from 'vitest';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { SourceFormat, type FileRow } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { ArcgisImportSessionError, ArcgisStagingAccountingError, type ArcgisCommitAttempt, type ArcgisCommitUnitSnapshot } from '@/lib/arcgis/import-session';
import { deriveArcgisCommitBatchID, subBatchIDForRowOrdinal } from '@/lib/uploads/batch-family';

const mocks = vi.hoisted(() => ({
  loadWindow: vi.fn(),
  advanceCursor: vi.fn(),
  insert: vi.fn(),
  findDropped: vi.fn(),
  recordFailures: vi.fn()
}));
vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/arcgis/import-session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/arcgis/import-session')>()),
  loadArcgisImportRowWindow: mocks.loadWindow,
  advanceArcgisImportStagingCursor: mocks.advanceCursor
}));
vi.mock('@/lib/ingestion/temporary-measurements', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/ingestion/temporary-measurements')>()),
  insertTemporaryMeasurementsInBatches: mocks.insert,
  findDroppedMeasurementCandidates: mocks.findDropped
}));
vi.mock('@/lib/changelog/ingestion-failure-audit', () => ({ recordAuditedIngestionFailureRows: mocks.recordFailures }));

import { stageArcgisImportWindow } from './arcgis-commit-staging';

const IMPORT_SESSION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890';
const BATCH = deriveArcgisCommitBatchID(IMPORT_SESSION_ID);
const WINDOW_ROWS = 5_000;
const ROW_COUNT = 2 * WINDOW_ROWS + 7;
const SECOND_WINDOW_START = WINDOW_ROWS;
const TX = 'staging-tx';
const ATTEMPT: ArcgisCommitAttempt = {
  schema: 'forestgeo_testing',
  importSessionId: IMPORT_SESSION_ID,
  plotID: 22,
  censusID: 6,
  batchID: BATCH,
  uploadMode: UploadMode.CLEAN_REUPLOAD,
  uploadSessionID: 'upload-session-B',
  attemptID: 'attempt-2',
  changedBy: 'arcgis-owner@example.com'
};
const snapshotAt = (cursor: number): ArcgisCommitUnitSnapshot => ({
  commitCompleted: false,
  rowCount: ROW_COUNT,
  stagingNextRowIndex: cursor,
  committedRowCount: cursor,
  censusReplacementCompleted: false,
  fileName: 'arcgis.xlsx'
});
const windowRows = (count: number): FileRow[] =>
  Array.from(
    { length: count },
    (_, index) =>
      ({ tag: `T${index}`, stemtag: '1', spcode: 'ACERRU', quadrat: 'Q01', lx: '1', ly: '2', dbh: '10', hom: '1.3', date: '2026-06-01', codes: 'A' }) as FileRow
  );
const manager = {} as ConnectionManager;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadWindow.mockImplementation(async (_cm, _schema, _id, _first, limit: number) => windowRows(limit));
  mocks.insert.mockImplementation(async (_cm, _schema, rows: FileRow[]) => rows.length);
  mocks.findDropped.mockResolvedValue([]);
  mocks.recordFailures.mockResolvedValue({ measurementIDs: [], insertedCount: 0, updatedCount: 0, unchangedCount: 0 });
  mocks.advanceCursor.mockResolvedValue(undefined);
});

describe('stageArcgisImportWindow', () => {
  it('stages the window under its global sub-batch ids and moves the cursor by the window (AU5)', async () => {
    const result = await stageArcgisImportWindow(manager, ATTEMPT, snapshotAt(SECOND_WINDOW_START), WINDOW_ROWS, TX);
    const [, , rows, fileName, rowBatchIDs, sessionID, sourceFormat, plotID, censusID, transactionID] = mocks.insert.mock.calls[0];
    console.log(`[AU5] result=${JSON.stringify(result)} first id=${rowBatchIDs[0]} last id=${rowBatchIDs.at(-1)}`);
    expect(rows).toHaveLength(WINDOW_ROWS);
    expect(rowBatchIDs[0]).toBe(subBatchIDForRowOrdinal(BATCH, SECOND_WINDOW_START));
    expect(rowBatchIDs.at(-1)).toBe(subBatchIDForRowOrdinal(BATCH, SECOND_WINDOW_START + WINDOW_ROWS - 1));
    expect([fileName, sessionID, sourceFormat, plotID, censusID, transactionID]).toEqual([
      'arcgis.xlsx',
      ATTEMPT.uploadSessionID,
      SourceFormat.arcgis_xlsx,
      22,
      6,
      TX
    ]);
    expect(mocks.advanceCursor).toHaveBeenCalledWith(
      manager,
      ATTEMPT,
      { fromRowIndex: SECOND_WINDOW_START, toRowIndex: 2 * WINDOW_ROWS, insertedRows: WINDOW_ROWS },
      TX
    );
    expect(result).toEqual({ sourceRows: WINDOW_ROWS, insertedRows: WINDOW_ROWS, failureRows: 0, nextRowIndex: 2 * WINDOW_ROWS });
  });

  it('the last, short window loads only the remaining rows', async () => {
    const result = await stageArcgisImportWindow(manager, ATTEMPT, snapshotAt(2 * WINDOW_ROWS), WINDOW_ROWS, TX);
    expect(mocks.loadWindow.mock.calls[0][4]).toBe(7);
    expect(result.nextRowIndex).toBe(ROW_COUNT);
  });

  it('a row load short by one is a 422 before any insert (AU5)', async () => {
    mocks.loadWindow.mockRejectedValueOnce(
      new ArcgisImportSessionError('ArcGIS import rows are missing. Re-run the workbook pre-flight step.', HTTPResponses.UNPROCESSABLE_ENTITY)
    );
    await expect(stageArcgisImportWindow(manager, ATTEMPT, snapshotAt(0), WINDOW_ROWS, TX)).rejects.toMatchObject({
      status: HTTPResponses.UNPROCESSABLE_ENTITY
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.advanceCursor).not.toHaveBeenCalled();
  });

  it('records a dropped row at its GLOBAL source row index under the root batch (AU8)', async () => {
    const LOCAL_ORDINAL = 3;
    mocks.insert.mockResolvedValueOnce(WINDOW_ROWS - 1);
    mocks.findDropped.mockResolvedValueOnce([{ rowOrdinal: LOCAL_ORDINAL, existingBatch: null }]);
    mocks.recordFailures.mockResolvedValueOnce({ measurementIDs: [91], insertedCount: 1, updatedCount: 0, unchangedCount: 0 });
    const result = await stageArcgisImportWindow(manager, ATTEMPT, snapshotAt(SECOND_WINDOW_START), WINDOW_ROWS, TX);
    const recorded = mocks.recordFailures.mock.calls[0][0];
    console.log(`[AU8] recorded=${JSON.stringify(recorded.rows)} result=${JSON.stringify(result)}`);
    expect(recorded.rows).toHaveLength(1);
    expect(recorded.rows[0]).toMatchObject({
      sourceRowIndex: SECOND_WINDOW_START + LOCAL_ORDINAL,
      batchID: BATCH,
      fileID: 'arcgis.xlsx',
      tag: `T${LOCAL_ORDINAL - 1}`
    });
    expect(recorded).toMatchObject({ transactionID: TX, changedBy: ATTEMPT.changedBy, plotID: 22, censusID: 6 });
    expect(mocks.findDropped.mock.calls[0][6], 'detection runs over the window rows only').toHaveLength(WINDOW_ROWS);
    expect(result).toEqual({ sourceRows: WINDOW_ROWS, insertedRows: WINDOW_ROWS - 1, failureRows: 1, nextRowIndex: 2 * WINDOW_ROWS });
  });

  it.each([
    ['one row undetected', WINDOW_ROWS - 2, [{ rowOrdinal: 9, existingBatch: null }], { insertedCount: 1, updatedCount: 0, unchangedCount: 0 }, 1, 1],
    [
      'two candidates, one persisted',
      WINDOW_ROWS - 2,
      [
        { rowOrdinal: 9, existingBatch: null },
        { rowOrdinal: 12, existingBatch: null }
      ],
      { insertedCount: 1, updatedCount: 0, unchangedCount: 0 },
      2,
      1
    ]
  ])(
    'refuses a window whose rows are not all accounted for: %s (AU6)',
    async (_label, inserted, candidates, persisted, expectedCandidates, expectedPersisted) => {
      mocks.insert.mockResolvedValueOnce(inserted);
      mocks.findDropped.mockResolvedValueOnce(candidates);
      mocks.recordFailures.mockResolvedValueOnce({ measurementIDs: [], ...persisted });
      let thrown: unknown;
      try {
        await stageArcgisImportWindow(manager, ATTEMPT, snapshotAt(0), WINDOW_ROWS, TX);
      } catch (error) {
        thrown = error;
      }
      console.log(`[AU6] ${thrown instanceof Error ? thrown.message : String(thrown)}`);
      expect(thrown).toBeInstanceOf(ArcgisStagingAccountingError);
      expect((thrown as ArcgisStagingAccountingError).detail).toEqual({
        importSessionId: IMPORT_SESSION_ID,
        firstRowIndex: 0,
        sourceRows: WINDOW_ROWS,
        insertedRows: inserted,
        droppedCandidates: expectedCandidates,
        persistedFailureRows: expectedPersisted
      });
      expect((thrown as Error).message).toContain(`n=${WINDOW_ROWS}, k=${inserted}, candidates=${expectedCandidates}, persisted=${expectedPersisted}`);
      expect(mocks.advanceCursor).not.toHaveBeenCalled();
    }
  );
});
