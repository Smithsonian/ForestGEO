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
  commitArcgis: vi.fn(),
  ingest: vi.fn(),
  collapse: vi.fn(),
  validations: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('@/lib/db/poolmonitorsingleton', () => ({ getPoolMonitorInstance: () => ({ getUsablePool: async () => ({}), signalActivity: vi.fn() }) }));
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
  stageMeasurementChunk: vi.fn(),
  replaceCensusForCleanReupload: vi.fn(),
  countStagedRows: vi.fn(),
  MeasurementChunkResolutionError: class extends Error {}
}));
vi.mock('@/lib/uploads/arcgis-commit', () => ({ commitArcgisImport: mocks.commitArcgis }));
vi.mock('@/lib/uploads/ingest-batch', () => ({
  ingestBatch: mocks.ingest,
  IngestBatchAbortedError: class extends Error {},
  OversizedSubBatchError: class extends Error {}
}));
vi.mock('@/lib/uploads/record-invalid-rows', () => ({ recordInvalidRows: vi.fn(), deleteUnresolvedRowsForBatchFamily: vi.fn() }));
vi.mock('@/lib/uploads/collapse-census', () => ({ collapseCensus: mocks.collapse }));
vi.mock('@/lib/uploads/validation-orchestrator', () => ({ runCensusValidations: mocks.validations }));

import { runJobIfClaimable } from './worker';
import { WorkerLeaseLostError } from './errors';
import { ArcgisCommitSupersededError } from '@/lib/arcgis/import-session';
import { deriveArcgisCommitBatchID } from '@/lib/uploads/batch-family';
import { UploadSessionState } from '@/config/uploadsessiontracker';

const JOB_ID = 73;
const STALE_WORKER_ID = 'stale-worker';
const ARCGIS_ROW_COUNT = 3;
const IMPORT_SESSION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890';
const DERIVED_BATCH = deriveArcgisCommitBatchID(IMPORT_SESSION_ID);
const PRE_DEPLOY_BATCH = 'mh0q1z2-predeploy0001';
const FIRST_CALL = 0;
const COMMIT_REQUEST_ARGUMENT = 1;
const ASSIGNED_BATCH_ARGUMENT = 2;
const INGEST_PARAMS_ARGUMENT = 1;
const SESSION_STATE_ARGUMENT = 2;
const ARCGIS_FILE = { jobFileID: 9, fileName: 'arcgis.xlsx', status: 'pending', expectedRows: ARCGIS_ROW_COUNT, processedRows: 0, failedRows: 0 };

const arcgisJob = (status: string, importSessionId = IMPORT_SESSION_ID) => ({
  jobID: JOB_ID,
  schemaName: 'forestgeo_lease_test',
  plotID: 1,
  censusID: 2,
  formType: FormType.measurements,
  sourceFormat: SourceFormat.arcgis_xlsx,
  status,
  retryCount: 0,
  maxRetries: 3,
  totalRows: ARCGIS_ROW_COUNT,
  createdBy: 'arcgis-owner@example.com',
  uploadMode: 'clean_reupload',
  payload: { arcgisImportSession: { importSessionId, fileName: ARCGIS_FILE.fileName, rowCount: ARCGIS_ROW_COUNT } },
  files: [ARCGIS_FILE]
});

function useJob(importSessionId = IMPORT_SESSION_ID) {
  let reads = 0;
  mocks.getBackgroundJob.mockImplementation(async () => arcgisJob(++reads === 1 ? 'queued' : 'running', importSessionId));
  mocks.claim.mockImplementation(async (_pool: unknown, _jobID: number, workerID: string) => ({ ...arcgisJob('running', importSessionId), workerID }));
}

function sessionReleases() {
  return mocks.updateSession.mock.calls.filter(
    call => call[SESSION_STATE_ARGUMENT] === UploadSessionState.FAILED || call[SESSION_STATE_ARGUMENT] === UploadSessionState.COMPLETED
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useJob();
  mocks.begin.mockResolvedValue('tx');
  mocks.commit.mockResolvedValue(undefined);
  mocks.rollback.mockResolvedValue(undefined);
  mocks.execute.mockResolvedValue([]);
  mocks.assignBatch.mockImplementation(async (_pool: unknown, _fileID: number, batchID: string) => batchID);
  mocks.commitArcgis.mockResolvedValue({ rowCount: ARCGIS_ROW_COUNT, fileName: ARCGIS_FILE.fileName, alreadyCommitted: false, batchID: DERIVED_BATCH });
  mocks.ingest.mockResolvedValue({
    subBatchResults: [],
    processedSubBatches: 1,
    totalRows: ARCGIS_ROW_COUNT,
    recovered: false,
    noDataFound: false,
    totalDurationMs: 1,
    resumedSubBatchCount: 0
  });
  mocks.createSession.mockResolvedValue({ sessionId: 'session-73' });
  mocks.ensureSessions.mockResolvedValue(undefined);
  mocks.activeSessions.mockResolvedValue([]);
  mocks.updateSession.mockResolvedValue(undefined);
  mocks.setStatus.mockResolvedValue(undefined);
  mocks.updateFile.mockResolvedValue(undefined);
  mocks.updateExpectedRows.mockResolvedValue(undefined);
  mocks.complete.mockResolvedValue(undefined);
  mocks.fail.mockResolvedValue(undefined);
  mocks.retry.mockResolvedValue(undefined);
  mocks.collapse.mockResolvedValue(undefined);
  mocks.validations.mockResolvedValue({ conflict: false, failedSteps: 0, errors: [] });
  mocks.recordDiagnostic.mockResolvedValue(undefined);
});

describe('ArcGIS worker batch (#561 N1)', () => {
  it('assigns the derived batch and ingests the batch the commit returns', async () => {
    await runJobIfClaimable(JOB_ID);

    console.log(
      `[worker] assign=${JSON.stringify(mocks.assignBatch.mock.calls[FIRST_CALL])} commit=${JSON.stringify(mocks.commitArcgis.mock.calls[FIRST_CALL]?.[COMMIT_REQUEST_ARGUMENT])} ingest=${JSON.stringify(mocks.ingest.mock.calls[FIRST_CALL]?.[INGEST_PARAMS_ARGUMENT])}`
    );
    expect(mocks.assignBatch.mock.calls[FIRST_CALL][ASSIGNED_BATCH_ARGUMENT]).toBe(DERIVED_BATCH);
    expect(mocks.commitArcgis.mock.calls[FIRST_CALL][COMMIT_REQUEST_ARGUMENT].batchID).toBe(DERIVED_BATCH);
    expect(mocks.ingest.mock.calls[FIRST_CALL][INGEST_PARAMS_ARGUMENT]).toMatchObject({ batchID: DERIVED_BATCH });
  });

  it('a job assigned a batch before the deploy still commits and ingests the derived batch (the route guard is not on this path)', async () => {
    mocks.assignBatch.mockResolvedValueOnce(PRE_DEPLOY_BATCH);

    await runJobIfClaimable(JOB_ID);

    console.log(
      `[worker] pre-deploy batch commit=${JSON.stringify(mocks.commitArcgis.mock.calls[FIRST_CALL]?.[COMMIT_REQUEST_ARGUMENT])} ingest=${JSON.stringify(mocks.ingest.mock.calls[FIRST_CALL]?.[INGEST_PARAMS_ARGUMENT])}`
    );
    expect(mocks.commitArcgis.mock.calls[FIRST_CALL][COMMIT_REQUEST_ARGUMENT].batchID).toBe(PRE_DEPLOY_BATCH);
    expect(mocks.ingest.mock.calls[FIRST_CALL][INGEST_PARAMS_ARGUMENT]).toMatchObject({ batchID: DERIVED_BATCH });
    expect(mocks.complete).toHaveBeenCalledOnce();
  });

  it('fails the job permanently for a payload import session id that is not a UUID', async () => {
    useJob('not-a-uuid');

    await runJobIfClaimable(JOB_ID);

    console.log(
      `[worker] bad session id: commit calls=${mocks.commitArcgis.mock.calls.length} fail calls=${mocks.fail.mock.calls.length} retry calls=${mocks.retry.mock.calls.length}`
    );
    expect(mocks.commitArcgis).not.toHaveBeenCalled();
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledOnce();
  });
});

describe('a worker that lost its lease never releases the upload session (#561 N3, AU15, AC 22)', () => {
  it('(1) supersession is relinquishment: no job write, no session write', async () => {
    mocks.commitArcgis.mockRejectedValueOnce(new ArcgisCommitSupersededError(IMPORT_SESSION_ID, 'attempt-old', 'attempt-new'));

    await runJobIfClaimable(JOB_ID);

    console.log(`[AU15-1] fail=${mocks.fail.mock.calls.length} retry=${mocks.retry.mock.calls.length} releases=${JSON.stringify(sessionReleases())}`);
    expect(mocks.fail).not.toHaveBeenCalled();
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(sessionReleases()).toEqual([]);
  });

  it('(2) a WorkerLeaseLostError reaching handleRunFailure directly (fenced file-status write after alreadyCommitted)', async () => {
    mocks.commitArcgis.mockResolvedValueOnce({ rowCount: ARCGIS_ROW_COUNT, fileName: ARCGIS_FILE.fileName, alreadyCommitted: true, batchID: DERIVED_BATCH });
    mocks.updateFile.mockRejectedValueOnce(new WorkerLeaseLostError(JOB_ID, STALE_WORKER_ID));

    await runJobIfClaimable(JOB_ID);

    console.log(`[AU15-2] fail=${mocks.fail.mock.calls.length} retry=${mocks.retry.mock.calls.length} releases=${JSON.stringify(sessionReleases())}`);
    expect(mocks.fail).not.toHaveBeenCalled();
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(sessionReleases()).toEqual([]);
  });

  it('(3) a WorkerLeaseLostError from the failure-finalize write', async () => {
    mocks.commitArcgis.mockRejectedValueOnce(new Error('connection reset'));
    mocks.retry.mockRejectedValueOnce(new WorkerLeaseLostError(JOB_ID, STALE_WORKER_ID));

    await runJobIfClaimable(JOB_ID);

    console.log(`[AU15-3] retry calls=${mocks.retry.mock.calls.length} releases=${JSON.stringify(sessionReleases())}`);
    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(sessionReleases()).toEqual([]);
  });

  it('control: an ordinary retryable failure still releases the session as failed', async () => {
    mocks.commitArcgis.mockRejectedValueOnce(new Error('connection reset'));

    await runJobIfClaimable(JOB_ID);

    const releasedStates = sessionReleases().map(call => call[SESSION_STATE_ARGUMENT]);
    console.log(`[AU15-control] retry calls=${mocks.retry.mock.calls.length} released states=${JSON.stringify(releasedStates)}`);
    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(releasedStates).toEqual([UploadSessionState.FAILED]);
  });
});
