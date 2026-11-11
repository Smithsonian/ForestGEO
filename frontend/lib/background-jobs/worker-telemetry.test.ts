import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormType, SourceFormat } from '@/config/macros/formdetails';

const mocks = vi.hoisted(() => ({
  getBackgroundJob: vi.fn(),
  claim: vi.fn(),
  setStatus: vi.fn(),
  assignBatch: vi.fn(),
  updateFile: vi.fn(),
  updateExpectedRows: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  retry: vi.fn(),
  recordDiagnostic: vi.fn(),
  createSession: vi.fn(),
  updateSession: vi.fn(),
  ensureSessions: vi.fn(),
  activeSessions: vi.fn(),
  begin: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  execute: vi.fn(),
  fetch: vi.fn(),
  stage: vi.fn(),
  replace: vi.fn(),
  countStaged: vi.fn(),
  ingest: vi.fn(),
  collapse: vi.fn(),
  validations: vi.fn(),
  MeasurementChunkResolutionError: class MeasurementChunkResolutionError extends Error {
    constructor(fileName: string, batchID: string) {
      super(`Header resolution misaligned for ${fileName} (batch ${batchID})`);
      this.name = 'MeasurementChunkResolutionError';
    }
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('@/lib/db/poolmonitorsingleton', () => ({ getPoolMonitorInstance: () => ({ getUsablePool: async () => ({}) }) }));
vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      beginTransaction: mocks.begin,
      commitTransaction: mocks.commit,
      rollbackTransaction: mocks.rollback,
      executeQuery: mocks.execute
    })
  }
}));
vi.mock('@/config/macros/azurestorage', () => ({ getContainerClient: vi.fn() }));
vi.mock('@/ailogger', () => ({ default: mocks.logger }));
vi.mock('@/lib/background-jobs/repository', () => ({
  getBackgroundJob: mocks.getBackgroundJob,
  claimBackgroundJobForWorker: mocks.claim,
  setBackgroundJobStatus: mocks.setStatus,
  assignFileBatchID: mocks.assignBatch,
  updateBackgroundJobFileStatus: mocks.updateFile,
  updateBackgroundJobFileExpectedRows: mocks.updateExpectedRows,
  markBackgroundJobCompleted: mocks.complete,
  markBackgroundJobFailed: mocks.fail,
  markBackgroundJobWaitingRetryAsWorker: mocks.retry,
  heartbeatBackgroundJob: vi.fn().mockResolvedValue(true),
  recordSetupDiagnostic: mocks.recordDiagnostic
}));
vi.mock('@/config/uploadsessiontracker', () => ({
  ensureUploadSessionsTable: mocks.ensureSessions,
  findActiveSessionsForPlotCensus: mocks.activeSessions,
  createUploadSession: mocks.createSession,
  updateSessionState: mocks.updateSession,
  sendHeartbeat: vi.fn(),
  isUploadSessionStale: vi.fn(() => false),
  UploadSessionOwnershipError: class extends Error {},
  UploadSessionState: {
    UPLOADING: 'uploading',
    UPLOADED: 'uploaded',
    PROCESSING: 'processing',
    COLLAPSING: 'collapsing',
    COMPLETED: 'completed',
    FAILED: 'failed'
  }
}));
vi.mock('@/lib/uploads/stage-measurements', () => ({
  stageMeasurementChunk: mocks.stage,
  replaceCensusForCleanReupload: mocks.replace,
  countStagedRows: mocks.countStaged,
  MeasurementChunkResolutionError: mocks.MeasurementChunkResolutionError
}));
vi.mock('@/lib/uploads/ingest-batch', () => ({
  ingestBatch: mocks.ingest,
  IngestBatchAbortedError: class extends Error {},
  OversizedSubBatchError: class OversizedSubBatchError extends Error {
    readonly code = 'SETUP_OVERSIZED_SUB_BATCH';
  }
}));
vi.mock('@/lib/uploads/record-invalid-rows', () => ({ recordInvalidRows: vi.fn(), deleteUnresolvedRowsForBatchFamily: vi.fn() }));
vi.mock('@/lib/uploads/collapse-census', () => ({ collapseCensus: mocks.collapse }));
vi.mock('@/lib/uploads/validation-orchestrator', () => ({ runCensusValidations: mocks.validations }));

import { runJobIfClaimable } from './worker';
import { NonRetryableJobError } from './errors';
import { OversizedSubBatchError } from '@/lib/uploads/ingest-batch';
import { SETUP_FAILURE_CODES, setupFailureSummary } from '@/lib/uploads/setup-failure';

const file = { jobFileID: 8, fileName: 'sample.csv', status: 'pending', expectedRows: 1, processedRows: 0, failedRows: 0 };
const job = (status: string) => ({
  jobID: 72,
  schemaName: 'forestgeo_telemetry_test',
  plotID: 1,
  censusID: 2,
  formType: FormType.measurements,
  sourceFormat: SourceFormat.csv,
  status,
  retryCount: 0,
  maxRetries: 3,
  totalRows: 1,
  createdBy: 'test',
  uploadMode: 'merge',
  payload: null,
  files: [file]
});
const diagnostic = {
  step: 'discovery',
  outcome: 'failed',
  terminal: true,
  errorCode: 'SETUP_CALLBACK_TIMEOUT',
  schema: 'forestgeo_telemetry_test',
  plotID: 1,
  censusID: 2,
  fileID: file.fileName,
  batchID: 'batch-8',
  elapsedMs: 2,
  assignedRows: 19
};

beforeEach(() => {
  vi.clearAllMocks();
  let reads = 0;
  mocks.getBackgroundJob.mockImplementation(async () => job(++reads === 1 ? 'queued' : 'running'));
  mocks.claim.mockImplementation(async (_pool: unknown, _jobID: number, workerID: string) => ({ ...job('running'), workerID }));
  mocks.begin.mockResolvedValue('tx');
  mocks.commit.mockResolvedValue(undefined);
  mocks.rollback.mockResolvedValue(undefined);
  mocks.execute.mockImplementation(async (sql: string) => {
    if (sql.includes('uploadmetrics')) return [{ completedCount: 0, unfinishedCount: 0, failedTotal: 0 }];
    if (sql.includes('temporarymeasurements')) return [];
    return [];
  });
  mocks.assignBatch.mockResolvedValue('batch-8');
  mocks.replace.mockResolvedValue({ outcome: 'not_applicable', deletedRows: 0, windowCount: 0 });
  mocks.stage.mockResolvedValue({ insertedCount: 1, expectedCount: 1, droppedCount: 0, invalidRows: [] });
  mocks.countStaged.mockResolvedValue(1);
  mocks.ingest.mockImplementation(async (_cm: unknown, params: { onSetupProgress: (d: typeof diagnostic) => void }) => {
    params.onSetupProgress(diagnostic);
    return { subBatchResults: [], processedSubBatches: 1, totalRows: 1, recovered: false, noDataFound: false, totalDurationMs: 1, resumedSubBatchCount: 0 };
  });
  mocks.fetch.mockResolvedValue('tag,stemtag,spcode,quadrat,lx,ly,dbh,hom,date,codes\nA,1,ACERRU,Q01,1,2,12,1,2024-01-01,A');
  mocks.createSession.mockResolvedValue({ sessionId: 'session-72' });
  mocks.ensureSessions.mockResolvedValue(undefined);
  mocks.activeSessions.mockResolvedValue([]);
  mocks.updateSession.mockResolvedValue(undefined);
  mocks.setStatus.mockResolvedValue(undefined);
  mocks.updateFile.mockResolvedValue(undefined);
  mocks.updateExpectedRows.mockResolvedValue(undefined);
  mocks.complete.mockResolvedValue(undefined);
  mocks.fail.mockResolvedValue(undefined);
  mocks.collapse.mockResolvedValue(undefined);
  mocks.validations.mockResolvedValue({ conflict: false, failedSteps: 0, errors: [] });
  mocks.recordDiagnostic.mockResolvedValue(undefined);
});

describe('optional setup diagnostic persistence', () => {
  it('does not wait for a deferred diagnostic write before completing ingestion', async () => {
    let finishWrite!: () => void;
    mocks.recordDiagnostic.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finishWrite = resolve;
        })
    );
    await runJobIfClaimable(72, { fetchFileText: mocks.fetch });
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(mocks.recordDiagnostic).toHaveBeenCalledOnce();
    expect(mocks.recordDiagnostic.mock.calls[0][2]).toMatchObject({
      assignedRows: 19,
      step: 'discovery'
    });
    finishWrite();
  });

  it('keeps the original setup timeout when diagnostic persistence rejects', async () => {
    const timeout = Object.assign(new Error('setup callback timed out'), { code: 'SETUP_CALLBACK_TIMEOUT' });
    mocks.recordDiagnostic.mockRejectedValue(new Error('event store unavailable'));
    mocks.ingest.mockImplementation(async (_cm: unknown, params: { onSetupProgress: (d: typeof diagnostic) => void }) => {
      params.onSetupProgress(diagnostic);
      throw timeout;
    });

    await runJobIfClaimable(72, { fetchFileText: mocks.fetch });

    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(mocks.retry.mock.calls[0][3]).toBe(timeout);
    expect(mocks.retry.mock.calls[0][5].failureContext).toMatchObject({ code: 'SETUP_CALLBACK_TIMEOUT', step: 'discovery' });
  });

  it('records step and code for a clean-rollback setup failure that is not a timeout (finding 2)', async () => {
    const deadlock = Object.assign(new Error('Deadlock found when trying to get lock'), { code: 'ER_LOCK_DEADLOCK' });
    mocks.ingest.mockImplementation(async (_cm: unknown, params: { onSetupProgress: (d: typeof diagnostic) => void }) => {
      params.onSetupProgress({ ...diagnostic, step: 'cleanup', errorCode: 'ER_LOCK_DEADLOCK' });
      throw deadlock;
    });

    await runJobIfClaimable(72, { fetchFileText: mocks.fetch });

    const context = mocks.retry.mock.calls[0][5].failureContext;
    console.log('[finding-2] worker failureContext:', context);
    expect(context).toEqual({
      code: 'ER_LOCK_DEADLOCK',
      summary: setupFailureSummary('ER_LOCK_DEADLOCK'),
      step: 'cleanup',
      attemptID: expect.any(String),
      fileID: file.fileName,
      batchID: 'batch-8'
    });
    const persisted = mocks.recordDiagnostic.mock.calls.at(-1)?.[2];
    console.log('[finding-2] persisted setup diagnostic:', persisted);
    expect(persisted).toMatchObject({ step: 'cleanup', code: 'ER_LOCK_DEADLOCK', summary: setupFailureSummary('ER_LOCK_DEADLOCK') });
  });

  it('fails an oversized sub-batch permanently without spending the retry budget', async () => {
    const MockedOversizedSubBatchError = OversizedSubBatchError as unknown as new (message: string) => Error;
    const oversized = new MockedOversizedSubBatchError('Sub-batch batch-8__sub001 of sample.csv holds too many rows');
    mocks.ingest.mockImplementation(async (_cm: unknown, params: { onSetupProgress: (d: typeof diagnostic) => void }) => {
      params.onSetupProgress({ ...diagnostic, step: 'discovery', errorCode: SETUP_FAILURE_CODES.oversizedSubBatch });
      throw oversized;
    });

    await runJobIfClaimable(72, { fetchFileText: mocks.fetch });

    console.log('[oversized] retry calls:', mocks.retry.mock.calls.length, 'fail calls:', mocks.fail.mock.calls.length);
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledOnce();
    expect(mocks.fail.mock.calls[0][5]).toEqual({
      code: SETUP_FAILURE_CODES.oversizedSubBatch,
      summary: setupFailureSummary(SETUP_FAILURE_CODES.oversizedSubBatch),
      step: 'discovery',
      attemptID: expect.any(String),
      fileID: file.fileName,
      batchID: 'batch-8'
    });
  });
});

describe('a header-plan misalignment fails the job without spending the retry budget', () => {
  const failFromReplacement = () => mocks.replace.mockRejectedValue(misalignment());
  const failFromStaging = () => mocks.stage.mockRejectedValue(misalignment());
  const misalignment = () => new mocks.MeasurementChunkResolutionError(file.fileName, 'batch-8');

  it.each([
    ['the census replacement', failFromReplacement, 0],
    ['staging', failFromStaging, 1]
  ])('%s raising MeasurementChunkResolutionError fails the job and is not retried', async (stageName, injectFailure, expectedStageCalls) => {
    injectFailure();

    await runJobIfClaimable(72, { fetchFileText: mocks.fetch });

    const failureCause = mocks.fail.mock.calls[0]?.[3];
    console.log(
      `[chunk-resolution:${stageName}] retry calls=${mocks.retry.mock.calls.length} fail calls=${mocks.fail.mock.calls.length} ` +
        `failed with=${String(failureCause)} replace calls=${mocks.replace.mock.calls.length} stage calls=${mocks.stage.mock.calls.length}`
    );
    expect(mocks.retry, 'a deterministic misalignment must not be retried').not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledOnce();
    expect(failureCause).toBeInstanceOf(NonRetryableJobError);
    expect(failureCause.cause).toBeInstanceOf(mocks.MeasurementChunkResolutionError);
    expect(mocks.stage, 'staging runs only if the census replacement did not refuse').toHaveBeenCalledTimes(expectedStageCalls);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
