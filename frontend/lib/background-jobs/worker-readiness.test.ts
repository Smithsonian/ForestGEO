import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormType, SourceFormat } from '@/config/macros/formdetails';

const mocks = vi.hoisted(() => ({
  pool: {},
  getUsablePool: vi.fn(),
  assertBlobStorageReady: vi.fn(),
  getBackgroundJob: vi.fn(),
  claimBackgroundJobForWorker: vi.fn(),
  markBackgroundJobFailed: vi.fn(),
  markBackgroundJobWaitingRetryAsWorker: vi.fn(),
  markBackgroundJobCompleted: vi.fn(),
  setBackgroundJobStatus: vi.fn(),
  updateBackgroundJobFileStatus: vi.fn(),
  assignFileBatchID: vi.fn(),
  heartbeatBackgroundJob: vi.fn(),
  findStaleRunningJobs: vi.fn(),
  finalizeJobAsSystem: vi.fn(),
  findRunnableJobIDs: vi.fn(),
  ensureUploadSessionsTable: vi.fn(),
  findActiveSessionsForPlotCensus: vi.fn(),
  createUploadSession: vi.fn(),
  updateSessionState: vi.fn(),
  sendHeartbeat: vi.fn(),
  arcgisCommit: vi.fn(),
  fetchFileText: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('@/lib/db/poolmonitorsingleton', () => ({ getPoolMonitorInstance: () => ({ getUsablePool: mocks.getUsablePool }) }));
vi.mock('@/lib/db/connectionmanager', () => ({ default: { getInstance: () => ({}) } }));
vi.mock('@/config/macros/azurestorage', () => ({ assertBlobStorageReady: mocks.assertBlobStorageReady, getContainerClient: vi.fn() }));
vi.mock('@/ailogger', () => ({ default: mocks.logger }));
vi.mock('./repository', () => ({
  assignFileBatchID: mocks.assignFileBatchID,
  claimBackgroundJobForWorker: mocks.claimBackgroundJobForWorker,
  getBackgroundJob: mocks.getBackgroundJob,
  heartbeatBackgroundJob: mocks.heartbeatBackgroundJob,
  markBackgroundJobCompleted: mocks.markBackgroundJobCompleted,
  markBackgroundJobFailed: mocks.markBackgroundJobFailed,
  markBackgroundJobWaitingRetryAsWorker: mocks.markBackgroundJobWaitingRetryAsWorker,
  setBackgroundJobStatus: mocks.setBackgroundJobStatus,
  updateBackgroundJobFileStatus: mocks.updateBackgroundJobFileStatus,
  findStaleRunningJobs: mocks.findStaleRunningJobs,
  finalizeJobAsSystem: mocks.finalizeJobAsSystem,
  findRunnableJobIDs: mocks.findRunnableJobIDs
}));
vi.mock('@/config/uploadsessiontracker', () => ({
  createUploadSession: mocks.createUploadSession,
  ensureUploadSessionsTable: mocks.ensureUploadSessionsTable,
  findActiveSessionsForPlotCensus: mocks.findActiveSessionsForPlotCensus,
  isUploadSessionStale: vi.fn(() => false),
  sendHeartbeat: mocks.sendHeartbeat,
  updateSessionState: mocks.updateSessionState,
  UploadSessionOwnershipError: class UploadSessionOwnershipError extends Error {},
  UploadSessionState: { UPLOADING: 'uploading', COMPLETED: 'completed', FAILED: 'failed' }
}));
vi.mock('@/lib/uploads/arcgis-commit', () => ({ commitArcgisImport: mocks.arcgisCommit }));

import { runJobIfClaimable } from './worker';
import { activeJobExecutionCount, sweepOnce } from './sweeper';

type TestJob = {
  jobID: number;
  schemaName: string;
  plotID: number;
  censusID: number;
  formType: string;
  sourceFormat: string;
  status: string;
  retryCount: number;
  maxRetries: number;
  totalRows: number;
  createdBy: string;
  uploadMode: string;
  payload: null;
  files: [];
};

function csvJob(overrides: Partial<TestJob> = {}): TestJob {
  return {
    jobID: 72,
    schemaName: 'forestgeo_readiness_test',
    plotID: 1,
    censusID: 1,
    formType: FormType.measurements,
    sourceFormat: SourceFormat.csv,
    status: 'queued',
    retryCount: 0,
    maxRetries: 3,
    totalRows: 0,
    createdBy: 'readiness-test',
    uploadMode: 'merge',
    payload: null,
    files: [],
    ...overrides
  };
}

function healthyInjectedDeps() {
  return {
    fetchFileText: mocks.fetchFileText,
    assertBlobStorageReady: vi.fn().mockResolvedValue(undefined)
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUsablePool.mockResolvedValue(mocks.pool);
  mocks.getBackgroundJob.mockImplementation(async () => csvJob());
  mocks.claimBackgroundJobForWorker.mockResolvedValue(null);
  mocks.setBackgroundJobStatus.mockResolvedValue(undefined);
  mocks.markBackgroundJobFailed.mockResolvedValue(undefined);
  mocks.markBackgroundJobWaitingRetryAsWorker.mockResolvedValue(undefined);
  mocks.ensureUploadSessionsTable.mockResolvedValue(undefined);
  mocks.findActiveSessionsForPlotCensus.mockResolvedValue([]);
  mocks.createUploadSession.mockResolvedValue({ sessionId: 'readiness-session' });
  mocks.updateSessionState.mockResolvedValue(undefined);
  mocks.findStaleRunningJobs.mockResolvedValue([]);
  mocks.finalizeJobAsSystem.mockResolvedValue(true);
  mocks.findRunnableJobIDs.mockResolvedValue([]);
});

describe('background worker blob readiness gate', () => {
  it('does not claim or mutate a CSV job when readiness rejects', async () => {
    const readiness = vi.fn().mockRejectedValue(new Error('private SDK details'));
    await runJobIfClaimable(72, { fetchFileText: mocks.fetchFileText, assertBlobStorageReady: readiness });

    expect(readiness).toHaveBeenCalledOnce();
    expect(mocks.claimBackgroundJobForWorker).not.toHaveBeenCalled();
    expect(mocks.setBackgroundJobStatus).not.toHaveBeenCalled();
    expect(mocks.markBackgroundJobFailed).not.toHaveBeenCalled();
    expect(mocks.markBackgroundJobWaitingRetryAsWorker).not.toHaveBeenCalled();
  });

  it('claims a CSV job when an injected reader passes readiness', async () => {
    const deps = healthyInjectedDeps();
    await runJobIfClaimable(72, deps);

    expect(deps.assertBlobStorageReady).toHaveBeenCalledOnce();
    expect(mocks.claimBackgroundJobForWorker).toHaveBeenCalledOnce();
  });

  it('skips blob readiness for the ArcGIS pipeline', async () => {
    const candidate = csvJob({ sourceFormat: SourceFormat.arcgis_xlsx });
    mocks.getBackgroundJob.mockResolvedValue(candidate);
    const readiness = vi.fn().mockRejectedValue(new Error('blob unavailable'));

    await runJobIfClaimable(72, { fetchFileText: mocks.fetchFileText, assertBlobStorageReady: readiness });

    expect(readiness).not.toHaveBeenCalled();
    expect(mocks.claimBackgroundJobForWorker).toHaveBeenCalledOnce();
  });

  it('fails closed when a test-injected CSV reader omits the readiness capability', async () => {
    const incompleteDeps = { fetchFileText: mocks.fetchFileText } as unknown as Parameters<typeof runJobIfClaimable>[1];

    await expect(runJobIfClaimable(72, incompleteDeps)).resolves.toBeUndefined();

    expect(mocks.claimBackgroundJobForWorker).not.toHaveBeenCalled();
    expect(mocks.markBackgroundJobWaitingRetryAsWorker).not.toHaveBeenCalled();
    expect(mocks.markBackgroundJobFailed).not.toHaveBeenCalled();
  });

  it('rejects a post-claim pipeline change before running either pipeline', async () => {
    const candidate = csvJob();
    const claimedJob = csvJob({ sourceFormat: SourceFormat.arcgis_xlsx, status: 'running' });
    mocks.getBackgroundJob.mockResolvedValue(candidate);
    mocks.claimBackgroundJobForWorker.mockResolvedValue(claimedJob);
    const deps = healthyInjectedDeps();

    await runJobIfClaimable(72, deps);

    expect(deps.assertBlobStorageReady).toHaveBeenCalledOnce();
    expect(mocks.arcgisCommit).not.toHaveBeenCalled();
    expect(mocks.fetchFileText).not.toHaveBeenCalled();
    expect(mocks.markBackgroundJobFailed).toHaveBeenCalledOnce();
  });

  it('uses the default sweeper dispatch gate while still reconciling stale leases', async () => {
    mocks.findStaleRunningJobs.mockResolvedValue([{ jobID: 90, retryCount: 0, maxRetries: 3 }]);
    mocks.findRunnableJobIDs.mockResolvedValue([90]);
    mocks.assertBlobStorageReady.mockRejectedValue(new Error('storage not configured'));
    mocks.getBackgroundJob.mockResolvedValue(csvJob({ jobID: 90 }));

    const result = await sweepOnce(mocks.pool as never);
    await vi.waitFor(() => expect(activeJobExecutionCount()).toBe(0));

    expect(result.reclaimed).toEqual([90]);
    expect(mocks.finalizeJobAsSystem).toHaveBeenCalledOnce();
    expect(mocks.assertBlobStorageReady).toHaveBeenCalledOnce();
    expect(mocks.claimBackgroundJobForWorker).not.toHaveBeenCalled();
  });
});
