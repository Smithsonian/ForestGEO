import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormType, SourceFormat } from '@/config/macros/formdetails';

const mocks = vi.hoisted(() => ({
  getBackgroundJob: vi.fn(),
  claim: vi.fn(),
  setStatus: vi.fn(),
  assignBatch: vi.fn(),
  updateFile: vi.fn(),
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
  countStaged: vi.fn(),
  ingest: vi.fn(),
  collapse: vi.fn(),
  validations: vi.fn(),
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
vi.mock('@/config/macros/azurestorage', () => ({ assertBlobStorageReady: vi.fn(), getContainerClient: vi.fn() }));
vi.mock('@/ailogger', () => ({ default: mocks.logger }));
vi.mock('@/lib/background-jobs/repository', () => ({
  getBackgroundJob: mocks.getBackgroundJob,
  claimBackgroundJobForWorker: mocks.claim,
  setBackgroundJobStatus: mocks.setStatus,
  assignFileBatchID: mocks.assignBatch,
  updateBackgroundJobFileStatus: mocks.updateFile,
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
vi.mock('@/lib/uploads/stage-measurements', () => ({ stageMeasurementChunk: mocks.stage, countStagedRows: mocks.countStaged }));
vi.mock('@/lib/uploads/ingest-batch', () => ({ ingestBatch: mocks.ingest, IngestBatchAbortedError: class extends Error {} }));
vi.mock('@/lib/uploads/record-invalid-rows', () => ({ recordInvalidRows: vi.fn(), deleteUnresolvedRowsForBatchFamily: vi.fn() }));
vi.mock('@/lib/uploads/collapse-census', () => ({ collapseCensus: mocks.collapse }));
vi.mock('@/lib/uploads/validation-orchestrator', () => ({ runCensusValidations: mocks.validations }));

import { runJobIfClaimable } from './worker';

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
  assignedRows: 19,
  operation: 'assign_interval' as const
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
    await runJobIfClaimable(72, { assertBlobStorageReady: vi.fn(), fetchFileText: mocks.fetch });
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(mocks.recordDiagnostic).toHaveBeenCalledOnce();
    expect(mocks.recordDiagnostic.mock.calls[0][2]).toMatchObject({
      assignedRows: 19,
      operation: 'assign_interval'
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

    await runJobIfClaimable(72, { assertBlobStorageReady: vi.fn(), fetchFileText: mocks.fetch });

    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(mocks.retry.mock.calls[0][3]).toBe(timeout);
    expect(mocks.retry.mock.calls[0][5].failureContext).toMatchObject({ code: 'SETUP_CALLBACK_TIMEOUT', step: 'discovery' });
  });
});
