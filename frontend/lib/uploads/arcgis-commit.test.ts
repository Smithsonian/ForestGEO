import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
import { UploadMode } from '@/config/uploadmodes';
import { UploadSessionOwnershipError } from '@/config/uploadsessiontracker';
import { ArcgisCommitSupersededError, ArcgisImportSessionError, ARCGIS_COMMIT_CLAIM_KIND, type ArcgisCommitUnitSnapshot } from '@/lib/arcgis/import-session';
import { BatchIDContainsSubBatchSeparatorError, deriveArcgisCommitBatchID, SUB_BATCH_SEPARATOR } from '@/lib/uploads/batch-family';
import {
  CENSUS_REPLACEMENT_COMPLETED_EVENT,
  CENSUS_REPLACEMENT_STARTED_EVENT,
  CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS
} from '@/lib/uploads/stage-measurements';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  guard: vi.fn(),
  markReplacement: vi.fn(),
  ensureTables: vi.fn(),
  ensureMarker: vi.fn(),
  ensureSourceFormat: vi.fn(),
  clearStaged: vi.fn(),
  clearFamily: vi.fn(),
  measurementWindow: vi.fn(),
  legacyWindow: vi.fn(),
  metricsWindow: vi.fn(),
  stageWindow: vi.fn(),
  finalize: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));
vi.mock('@/ailogger', () => ({ default: mocks.logger }));
vi.mock('@/lib/arcgis/import-session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/arcgis/import-session')>()),
  claimArcgisImportCommitAttempt: mocks.claim,
  lockArcgisImportSessionForCommitUnit: mocks.guard,
  markArcgisImportCensusReplacementCompleted: mocks.markReplacement,
  ensureArcgisImportTables: mocks.ensureTables
}));
vi.mock('@/lib/ingestion/temporary-measurements', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/ingestion/temporary-measurements')>()),
  ensureTemporaryMeasurementsSourceFormatColumn: mocks.ensureSourceFormat,
  deleteStagedRowsForFileWindow: mocks.clearStaged,
  deleteBatchFamilyRowsWindow: mocks.clearFamily,
  deleteCensusReplacementChunk: mocks.measurementWindow,
  deleteCensusReplacementLegacyFailuresWindow: mocks.legacyWindow,
  deleteCensusReplacementMetricsWindow: mocks.metricsWindow
}));
vi.mock('@/lib/uploads/upload-session-replacement-marker', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/uploads/upload-session-replacement-marker')>()),
  ensureUploadSessionReplacementMarkerColumn: mocks.ensureMarker
}));
vi.mock('@/lib/uploads/arcgis-commit-staging', () => ({ stageArcgisImportWindow: mocks.stageWindow }));
vi.mock('@/lib/uploads/arcgis-commit-finalize', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/uploads/arcgis-commit-finalize')>()),
  finalizeArcgisCommit: mocks.finalize
}));

import {
  ARCGIS_COMMIT_COMPLETED_EVENT,
  ARCGIS_COMMIT_FAILED_EVENT,
  ARCGIS_STAGING_WINDOW_ROWS,
  commitArcgisImport,
  type CommitArcgisImportParams
} from '@/lib/uploads/arcgis-commit';

const IMPORT_SESSION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890';
const DERIVED_BATCH = deriveArcgisCommitBatchID(IMPORT_SESSION_ID);
const CALLER_BATCH = 'm9x7k2a-8fh3k9d2x5p';
const REFERENCE_ROW_COUNT = 2 * ARCGIS_STAGING_WINDOW_ROWS + 7;
const REFERENCE_MEASUREMENT_PAGES = [
  { cursor: 0, deletedRows: 1_000, lastCoreMeasurementID: 1_000 },
  { cursor: 1_000, deletedRows: 1_000, lastCoreMeasurementID: 2_000 },
  { cursor: 2_000, deletedRows: 500, lastCoreMeasurementID: 2_500 },
  { cursor: 0, deletedRows: 0, lastCoreMeasurementID: 0 }
];
const REFERENCE_METRICS_ROWS = 3;
const UNIT = {
  CLAIM: 'claim',
  GUARD: 'guard',
  CLEAR_STAGED: 'clearStaged',
  CLEAR_FAMILY: 'clearFamily',
  STAGE: 'stage',
  MEASUREMENT: 'measurementWindow',
  LEGACY: 'legacyWindow',
  METRICS: 'metricsWindow',
  MARKER: 'markReplacement',
  FINALIZE: 'finalize'
} as const;

interface RecordedTransaction {
  id: string;
  timeoutMs: number | undefined;
  outcome: 'open' | 'committed' | 'rolled_back';
  calls: string[];
}

function createUnitHarness(rowCount: number) {
  const transactions: RecordedTransaction[] = [];
  const state = { cursor: 0, committedRowCount: 0, marker: false, committed: false };
  const record = (transactionID: string, call: string) => transactions.find(transaction => transaction.id === transactionID)!.calls.push(call);
  const snapshot = (): ArcgisCommitUnitSnapshot => ({
    commitCompleted: state.committed,
    rowCount,
    stagingNextRowIndex: state.cursor,
    committedRowCount: state.committedRowCount,
    censusReplacementCompleted: state.marker,
    fileName: 'arcgis.xlsx'
  });
  const manager = {
    withTransaction: async <T>(fn: (tx: { id: string; query: () => never }) => Promise<T>, options?: { timeoutMs?: number }) => {
      const transaction: RecordedTransaction = { id: `unit-tx-${transactions.length + 1}`, timeoutMs: options?.timeoutMs, outcome: 'open', calls: [] };
      transactions.push(transaction);
      try {
        const result = await fn({
          id: transaction.id,
          query: () => {
            throw new Error('orchestrator must not query directly');
          }
        });
        transaction.outcome = 'committed';
        return result;
      } catch (error) {
        transaction.outcome = 'rolled_back';
        throw error;
      }
    },
    executeQuery: vi.fn(async () => {
      throw new Error('orchestrator must not issue SQL outside a unit function');
    })
  };
  let measurementPage = 0;
  mocks.claim.mockImplementation(async (_cm, input, transactionID: string) => {
    record(transactionID, UNIT.CLAIM);
    return { kind: ARCGIS_COMMIT_CLAIM_KIND.CLAIMED, batchID: DERIVED_BATCH, previousUploadSessionID: null, fileName: 'arcgis.xlsx', rowCount };
  });
  mocks.guard.mockImplementation(async (_cm, _attempt, transactionID: string) => (record(transactionID, UNIT.GUARD), snapshot()));
  mocks.clearStaged.mockImplementation(async (...args: unknown[]) => (record(args.at(-1) as string, UNIT.CLEAR_STAGED), 0));
  mocks.clearFamily.mockImplementation(async (...args: unknown[]) => (record(args.at(-1) as string, UNIT.CLEAR_FAMILY), 0));
  mocks.stageWindow.mockImplementation(async (_cm, _attempt, current: ArcgisCommitUnitSnapshot, windowRows: number, transactionID: string) => {
    record(transactionID, UNIT.STAGE);
    const sourceRows = Math.min(windowRows, rowCount - current.stagingNextRowIndex);
    state.cursor += sourceRows;
    state.committedRowCount += sourceRows;
    return { sourceRows, insertedRows: sourceRows, failureRows: 0, nextRowIndex: state.cursor };
  });
  mocks.measurementWindow.mockImplementation(async (_cm, _schema, _batch, _plot, _census, cursor: number, _changedBy, transactionID: string) => {
    record(transactionID, UNIT.MEASUREMENT);
    const page = REFERENCE_MEASUREMENT_PAGES[measurementPage++];
    expect(cursor, `measurement window ${measurementPage} cursor`).toBe(page.cursor);
    return { deletedRows: page.deletedRows, lastCoreMeasurementID: page.lastCoreMeasurementID };
  });
  mocks.legacyWindow.mockImplementation(
    async (...args: unknown[]) => (record(args.at(-1) as string, UNIT.LEGACY), { deletedRows: 0, legacyTableMissing: true })
  );
  mocks.metricsWindow.mockImplementation(async (...args: unknown[]) => (record(args.at(-1) as string, UNIT.METRICS), REFERENCE_METRICS_ROWS));
  mocks.markReplacement.mockImplementation(async (_cm, _attempt, transactionID: string) => {
    record(transactionID, UNIT.MARKER);
    state.marker = true;
  });
  mocks.finalize.mockImplementation(async (_cm, _attempt, current: ArcgisCommitUnitSnapshot, transactionID: string) => {
    record(transactionID, UNIT.FINALIZE);
    state.committed = true;
    return { committedRowCount: current.committedRowCount, droppedRowCount: current.rowCount - current.committedRowCount };
  });
  const render = () =>
    transactions.map(transaction => `${transaction.id} ${transaction.outcome} ${transaction.timeoutMs} [${transaction.calls.join(', ')}]`).join('\n');
  return { manager, transactions, state, render };
}

function params(overrides: Partial<CommitArcgisImportParams> = {}): CommitArcgisImportParams {
  return {
    schema: 'forestgeo_testing',
    plotID: 22,
    censusID: 6,
    importSessionId: IMPORT_SESSION_ID,
    fileName: 'arcgis.xlsx',
    batchID: CALLER_BATCH,
    uploadMode: UploadMode.CLEAN_REUPLOAD,
    userId: 'arcgis-owner@example.com',
    uploadSessionID: 'upload-session-B',
    ...overrides
  };
}

const REFERENCE_SEQUENCE = [
  [UNIT.CLAIM],
  [UNIT.GUARD, UNIT.CLEAR_STAGED],
  [UNIT.GUARD, UNIT.CLEAR_FAMILY],
  [UNIT.GUARD, UNIT.STAGE],
  [UNIT.GUARD, UNIT.STAGE],
  [UNIT.GUARD, UNIT.STAGE],
  [UNIT.GUARD, UNIT.MEASUREMENT],
  [UNIT.GUARD, UNIT.MEASUREMENT],
  [UNIT.GUARD, UNIT.MEASUREMENT],
  [UNIT.GUARD, UNIT.MEASUREMENT],
  [UNIT.GUARD, UNIT.LEGACY],
  [UNIT.GUARD, UNIT.METRICS],
  [UNIT.GUARD, UNIT.MARKER],
  [UNIT.GUARD, UNIT.FINALIZE]
];

beforeEach(() => {
  vi.clearAllMocks();
  for (const ensure of [mocks.ensureTables, mocks.ensureMarker, mocks.ensureSourceFormat]) ensure.mockResolvedValue(undefined);
});

describe('commitArcgisImport — the reference sequence (AU1, AC 2, AC 3, AC 18)', () => {
  it('runs C, S0, F0, S×3, R (A×4, B, C, D), F as 14 separately committed, guarded transactions', async () => {
    const harness = createUnitHarness(REFERENCE_ROW_COUNT);
    const result = await commitArcgisImport(harness.manager as never, params());
    console.log(`[AU1] result=${JSON.stringify(result)}\n${harness.render()}`);
    expect(harness.transactions.map(transaction => transaction.calls)).toEqual(REFERENCE_SEQUENCE);
    expect(harness.transactions.every(transaction => transaction.outcome === 'committed')).toBe(true);
    expect(harness.transactions.every(transaction => transaction.timeoutMs === CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS)).toBe(true);
    expect(result).toEqual({ rowCount: REFERENCE_ROW_COUNT, fileName: 'arcgis.xlsx', alreadyCommitted: false, batchID: DERIVED_BATCH });
    const completed = mocks.logger.info.mock.calls.filter(([event]) => event === ARCGIS_COMMIT_COMPLETED_EVENT);
    expect(completed).toHaveLength(1);
    expect(completed[0][1]).toMatchObject({
      importSessionId: IMPORT_SESSION_ID,
      batchID: DERIVED_BATCH,
      claim: ARCGIS_COMMIT_CLAIM_KIND.CLAIMED,
      stagedRows: REFERENCE_ROW_COUNT,
      droppedRows: 0,
      leftoverStagedRowsCleared: 0,
      leftoverFamilyRowsCleared: 0,
      stagingWindowCount: 3
    });
    for (const event of [CENSUS_REPLACEMENT_STARTED_EVENT, CENSUS_REPLACEMENT_COMPLETED_EVENT]) {
      expect(mocks.logger.info.mock.calls.find(([name]) => name === event)?.[1]).toMatchObject({ importSessionId: IMPORT_SESSION_ID, batchID: DERIVED_BATCH });
    }
  });

  it('REVISIONS skips the census replacement entirely', async () => {
    const harness = createUnitHarness(REFERENCE_ROW_COUNT);
    await commitArcgisImport(harness.manager as never, params({ uploadMode: UploadMode.REVISIONS }));
    expect(harness.transactions.map(transaction => transaction.calls)).toEqual([...REFERENCE_SEQUENCE.slice(0, 6), [UNIT.GUARD, UNIT.FINALIZE]]);
  });
});

describe('commitArcgisImport — claim outcomes (AU2, AU3, D28)', () => {
  it.each([HTTPResponses.NOT_FOUND, HTTPResponses.FORBIDDEN, HTTPResponses.CONFLICT, HTTPResponses.UNPROCESSABLE_ENTITY, HTTPResponses.INVALID_REQUEST])(
    'a claim rejected with %s runs no unit and rethrows the same error',
    async status => {
      const harness = createUnitHarness(REFERENCE_ROW_COUNT);
      const rejection = new ArcgisImportSessionError(`claim refused ${status}`, status);
      mocks.claim.mockRejectedValueOnce(rejection);
      await expect(commitArcgisImport(harness.manager as never, params())).rejects.toBe(rejection);
      expect(harness.transactions.map(transaction => transaction.outcome)).toEqual(['rolled_back']);
      for (const unit of [mocks.guard, mocks.clearStaged, mocks.clearFamily, mocks.stageWindow, mocks.measurementWindow, mocks.finalize])
        expect(unit).not.toHaveBeenCalled();
    }
  );

  it('passes requestBatchID null when the caller sends no batch, and returns the claim batch either way', async () => {
    const harness = createUnitHarness(REFERENCE_ROW_COUNT);
    const result = await commitArcgisImport(harness.manager as never, params({ batchID: undefined }));
    expect(mocks.claim.mock.calls[0][1]).toMatchObject({ requestBatchID: null, uploadMode: UploadMode.CLEAN_REUPLOAD });
    expect(result.batchID).toBe(DERIVED_BATCH);
  });

  it('an already-committed claim returns the stored batch with no further transaction', async () => {
    const harness = createUnitHarness(REFERENCE_ROW_COUNT);
    mocks.claim.mockImplementationOnce(async () => ({
      kind: ARCGIS_COMMIT_CLAIM_KIND.ALREADY_COMMITTED,
      batchID: DERIVED_BATCH,
      previousUploadSessionID: null,
      fileName: 'arcgis.xlsx',
      rowCount: 10_006
    }));
    const result = await commitArcgisImport(harness.manager as never, params());
    expect(harness.transactions).toHaveLength(1);
    expect(result).toEqual({ rowCount: 10_006, fileName: 'arcgis.xlsx', alreadyCommitted: true, batchID: DERIVED_BATCH });
  });
});

describe('commitArcgisImport — every unit refuses on its guard (AU4, AC 12)', () => {
  const UNIT_TRANSACTION_ORDINAL = { S0: 2, F0: 3, STAGING: 4, R_A: 7, R_D: 13, F: 14 } as const;
  const WORK_BY_UNIT = {
    S0: mocks.clearStaged,
    F0: mocks.clearFamily,
    STAGING: mocks.stageWindow,
    R_A: mocks.measurementWindow,
    R_D: mocks.markReplacement,
    F: mocks.finalize
  } as const;
  const guardFailures = () => [
    new ArcgisImportSessionError('expired', HTTPResponses.NOT_FOUND),
    new ArcgisImportSessionError('other batch', HTTPResponses.CONFLICT),
    new ArcgisCommitSupersededError(IMPORT_SESSION_ID, 'attempt-old', 'attempt-new'),
    new UploadSessionOwnershipError('session abandoned')
  ];

  for (const unitName of Object.keys(UNIT_TRANSACTION_ORDINAL) as Array<keyof typeof UNIT_TRANSACTION_ORDINAL>) {
    it.each(guardFailures().map(error => [error.name, error] as const))(
      `${unitName}: a guard throwing %s stops the run with that error and no work`,
      async (_name, guardError) => {
        const harness = createUnitHarness(REFERENCE_ROW_COUNT);
        const target = UNIT_TRANSACTION_ORDINAL[unitName];
        const passThrough = mocks.guard.getMockImplementation()!;
        mocks.guard.mockImplementation(async (cm, attempt, transactionID: string) => {
          const snapshot = await passThrough(cm, attempt, transactionID);
          if (transactionID === `unit-tx-${target}`) throw guardError;
          return snapshot;
        });
        const workCallsBefore = WORK_BY_UNIT[unitName].mock.calls.length;
        await expect(commitArcgisImport(harness.manager as never, params())).rejects.toBe(guardError);
        console.log(`[AU4] ${unitName} ${guardError.name}\n${harness.render()}`);
        expect(harness.transactions).toHaveLength(target);
        expect(harness.transactions[target - 1]).toMatchObject({ outcome: 'rolled_back', calls: [UNIT.GUARD] });
        expect(WORK_BY_UNIT[unitName].mock.calls.length, `no ${unitName} work after its guard refused`).toBe(workCallsBefore);
      }
    );

    it(`${unitName}: a guard reporting commitCompleted ends the run with no further work`, async () => {
      const harness = createUnitHarness(REFERENCE_ROW_COUNT);
      const target = UNIT_TRANSACTION_ORDINAL[unitName];
      const passThrough = mocks.guard.getMockImplementation()!;
      mocks.guard.mockImplementation(async (cm, attempt, transactionID: string) => {
        if (Number(transactionID.split('-').at(-1)) >= target) harness.state.committed = true;
        return passThrough(cm, attempt, transactionID);
      });
      const result = await commitArcgisImport(harness.manager as never, params());
      console.log(`[AU4] ${unitName} commitCompleted\n${harness.render()}`);
      expect(result.alreadyCommitted).toBe(true);
      expect(harness.transactions.slice(target - 1).every(transaction => transaction.calls.every(call => call === UNIT.GUARD))).toBe(true);
    });
  }
});

describe('commitArcgisImport — failure context (AU9, AC 18)', () => {
  it('logs upload.arcgis_commit.failed once with the unit, window and last durable cursor, and rethrows the same object', async () => {
    const harness = createUnitHarness(REFERENCE_ROW_COUNT);
    const dbError = Object.assign(new Error('Lock wait timeout exceeded; try restarting transaction'), { code: 'ER_LOCK_WAIT_TIMEOUT' });
    const stageThrough = mocks.stageWindow.getMockImplementation()!;
    mocks.stageWindow.mockImplementation(async (cm, attempt, current: ArcgisCommitUnitSnapshot, windowRows: number, transactionID: string) => {
      if (current.stagingNextRowIndex === ARCGIS_STAGING_WINDOW_ROWS) throw dbError;
      return stageThrough(cm, attempt, current, windowRows, transactionID);
    });
    mocks.claim.mockImplementationOnce(async (_cm, _input, transactionID: string) => {
      harness.transactions.find(transaction => transaction.id === transactionID)!.calls.push(UNIT.CLAIM);
      return {
        kind: ARCGIS_COMMIT_CLAIM_KIND.TAKEN_OVER,
        batchID: DERIVED_BATCH,
        previousUploadSessionID: 'upload-session-A',
        fileName: 'arcgis.xlsx',
        rowCount: REFERENCE_ROW_COUNT
      };
    });
    await expect(commitArcgisImport(harness.manager as never, params())).rejects.toBe(dbError);
    const failed = mocks.logger.error.mock.calls.filter(([event]) => event === ARCGIS_COMMIT_FAILED_EVENT);
    console.log(`[AU9] failed events=${JSON.stringify(failed.map(([, , context]) => context))}`);
    expect(failed).toHaveLength(1);
    expect(failed[0][1]).toBe(dbError);
    expect(failed[0][2]).toMatchObject({
      unit: 'staging_window',
      phase: 'window 2',
      lastDurableCursor: ARCGIS_STAGING_WINDOW_ROWS,
      attemptID: expect.any(String),
      claim: ARCGIS_COMMIT_CLAIM_KIND.TAKEN_OVER,
      previousUploadSessionID: 'upload-session-A',
      errorName: 'Error',
      errorMessage: dbError.message,
      importSessionId: IMPORT_SESSION_ID,
      batchID: DERIVED_BATCH
    });
  });

  it('names the replacement transaction that failed, so a later window is distinguishable from the first, and rethrows the same object', async () => {
    const harness = createUnitHarness(REFERENCE_ROW_COUNT);
    const dbError = Object.assign(new Error('Deadlock found when trying to get lock'), { code: 'ER_LOCK_DEADLOCK' });
    const SECOND_REPLACEMENT_TRANSACTION = 2;
    const measurementThrough = mocks.measurementWindow.getMockImplementation()!;
    let measurementWindowsSeen = 0;
    mocks.measurementWindow.mockImplementation(async (...args: unknown[]) => {
      measurementWindowsSeen += 1;
      if (measurementWindowsSeen === SECOND_REPLACEMENT_TRANSACTION) throw dbError;
      return measurementThrough(...args);
    });
    await expect(commitArcgisImport(harness.manager as never, params())).rejects.toBe(dbError);
    const failed = mocks.logger.error.mock.calls.filter(([event]) => event === ARCGIS_COMMIT_FAILED_EVENT);
    console.log(`[AU9] failed events=${JSON.stringify(failed.map(([, , context]) => context))}\n${harness.render()}`);
    expect(failed).toHaveLength(1);
    expect(failed[0][1]).toBe(dbError);
    expect(failed[0][2]).toMatchObject({
      unit: 'replacement',
      phase: `replacement transaction ${SECOND_REPLACEMENT_TRANSACTION}`,
      errorName: 'Error',
      errorMessage: dbError.message
    });
  });
});

const TEST_SCHEMA = 'forestgeo_testing';

function commitParams(batchID: string): CommitArcgisImportParams {
  return {
    schema: TEST_SCHEMA,
    plotID: 22,
    censusID: 6,
    importSessionId: 'import-session-1',
    fileName: 'arcgis.xlsx',
    batchID,
    uploadMode: UploadMode.REVISIONS,
    userId: 'user-1',
    uploadSessionID: 'upload-session-1'
  };
}

describe('commitArcgisImport batch ID validation', () => {
  it('rejects a batch ID containing the sub-batch separator before touching the database', async () => {
    const separatorBatchID = `arc-1${SUB_BATCH_SEPARATOR}001`;
    const connectionManager = { executeQuery: vi.fn(), beginTransaction: vi.fn() };

    const commit = commitArcgisImport(connectionManager as never, commitParams(separatorBatchID));

    await expect(commit).rejects.toSatisfy((error: unknown) => {
      console.log(`[arcgis-batch-id-separator] rejected with ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      return (
        error instanceof ArcgisImportSessionError &&
        error.status === HTTPResponses.INVALID_REQUEST &&
        error.message === new BatchIDContainsSubBatchSeparatorError(separatorBatchID).message
      );
    });
    expect(connectionManager.executeQuery).not.toHaveBeenCalled();
    expect(connectionManager.beginTransaction).not.toHaveBeenCalled();
  });
});
