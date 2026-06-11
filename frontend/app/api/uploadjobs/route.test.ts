import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireSession: vi.fn(() => null),
  getSessionUserId: vi.fn(() => 'mason@example.com'),
  isValidSchema: vi.fn(() => true),
  assertCanEditMeasurementScope: vi.fn(async () => undefined),
  getPoolMonitorInstance: vi.fn(() => ({ pool: 'catalog-pool' })),
  createUploadBackgroundJob: vi.fn(),
  listBackgroundJobs: vi.fn(),
  loggerError: vi.fn()
}));

vi.mock('@/auth', () => ({
  auth: mocks.auth
}));

vi.mock('@/lib/auth-helpers', () => ({
  requireSession: mocks.requireSession,
  getSessionUserId: mocks.getSessionUserId
}));

vi.mock('@/config/utils/sqlsecurity', () => ({
  isValidSchema: mocks.isValidSchema
}));

vi.mock('@/config/editplan/scopeguard', () => ({
  assertCanEditMeasurementScope: mocks.assertCanEditMeasurementScope,
  ScopeAccessError: class ScopeAccessError extends Error {}
}));

vi.mock('@/config/connectionmanager', () => ({
  default: {
    getInstance: () => ({})
  }
}));

vi.mock('@/config/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: mocks.getPoolMonitorInstance
}));

vi.mock('@/lib/background-jobs/repository', () => ({
  createUploadBackgroundJob: mocks.createUploadBackgroundJob,
  listBackgroundJobs: mocks.listBackgroundJobs
}));

vi.mock('@/ailogger', () => ({
  default: {
    error: mocks.loggerError
  }
}));

const session = {
  user: {
    email: 'mason@example.com',
    name: 'Mason',
    userStatus: 'field crew',
    sites: [{ schemaName: 'forestgeo_testing' }]
  }
};

function makeCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'forestgeo_testing',
    plotID: 1,
    censusID: 2,
    uploadMode: 'clean_reupload',
    sourceFormat: 'csv',
    formType: 'measurements',
    idempotencyKey: 'upload-job-1',
    files: [
      {
        fileName: 'measurements.csv',
        blobContainer: 'forestgeo-testing-storage',
        blobName: 'uploads/job-1/measurements.csv',
        contentType: 'text/csv',
        byteSize: 128,
        expectedRows: 12
      }
    ],
    ...overrides
  };
}

describe('POST /api/uploadjobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(session);
    mocks.createUploadBackgroundJob.mockResolvedValue({
      jobID: 42,
      status: 'created',
      phase: 'blob_received'
    });
  });

  it('creates a job and returns 201 with enqueued: false', async () => {
    const request = new Request('http://localhost/api/uploadjobs', {
      method: 'POST',
      body: JSON.stringify(makeCreateBody())
    }) as any;

    const response = await POST(request);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      enqueued: false,
      job: { jobID: 42 }
    });
    expect(mocks.assertCanEditMeasurementScope).toHaveBeenCalledWith(expect.anything(), session, {
      schema: 'forestgeo_testing',
      plotID: 1,
      censusID: 2
    });
    expect(mocks.createUploadBackgroundJob).toHaveBeenCalledWith(
      'catalog-pool',
      expect.objectContaining({
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2,
        files: [expect.objectContaining({ fileName: 'measurements.csv' })]
      }),
      'mason@example.com'
    );
  });

  it('rejects invalid schemas before creating a job', async () => {
    mocks.isValidSchema.mockReturnValueOnce(false);

    const request = new Request('http://localhost/api/uploadjobs', {
      method: 'POST',
      body: JSON.stringify(makeCreateBody({ schema: 'bad-schema' }))
    }) as any;

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });
});

describe('GET /api/uploadjobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(session);
    mocks.listBackgroundJobs.mockResolvedValue([{ jobID: 42, status: 'created' }]);
  });

  it('lists active jobs for the authenticated user and optional scope', async () => {
    const request = new Request('http://localhost/api/uploadjobs?schema=forestgeo_testing&plotID=1&censusID=2') as any;

    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ jobs: [{ jobID: 42, status: 'created' }] });
    expect(mocks.listBackgroundJobs).toHaveBeenCalledWith('catalog-pool', {
      userID: 'mason@example.com',
      includeAllUsers: false,
      activeOnly: true,
      schema: 'forestgeo_testing',
      plotID: 1,
      censusID: 2,
      limit: undefined
    });
  });

  it('allows privileged users to request all users', async () => {
    mocks.auth.mockResolvedValueOnce({ user: { ...session.user, userStatus: 'global' } });
    const request = new Request('http://localhost/api/uploadjobs?allUsers=true&activeOnly=false&limit=5') as any;

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.listBackgroundJobs).toHaveBeenCalledWith('catalog-pool', expect.objectContaining({ includeAllUsers: true, activeOnly: false, limit: 5 }));
  });
});
