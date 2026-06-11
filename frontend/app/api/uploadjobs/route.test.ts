import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireSession: vi.fn(() => null),
  getSessionUserId: vi.fn(() => 'mason@example.com'),
  getSessionUserIds: vi.fn(() => ['mason@example.com', 'Mason']),
  isValidSchema: vi.fn(() => true),
  assertCanEditMeasurementScope: vi.fn(async () => undefined),
  getPoolMonitorInstance: vi.fn(() => ({ pool: 'catalog-pool' })),
  createUploadBackgroundJob: vi.fn(),
  listBackgroundJobs: vi.fn(),
  isAsyncUploadEnabledFor: vi.fn(() => true),
  runJobIfClaimable: vi.fn(async () => undefined),
  loggerError: vi.fn()
}));

vi.mock('@/auth', () => ({
  auth: mocks.auth
}));

vi.mock('@/lib/auth-helpers', () => ({
  requireSession: mocks.requireSession,
  getSessionUserId: mocks.getSessionUserId,
  getSessionUserIds: mocks.getSessionUserIds
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

vi.mock('@/lib/background-jobs/feature-gate', () => ({
  isAsyncUploadEnabledFor: mocks.isAsyncUploadEnabledFor
}));

vi.mock('@/lib/background-jobs/worker', () => ({
  runJobIfClaimable: mocks.runJobIfClaimable
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

const VALID_COLUMN_MAPPING = {
  version: 1,
  format: 'csv',
  fields: [{ canonicalField: 'tag', sourceColumns: ['Tag'] }]
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

function makeCreateRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/uploadjobs', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as any;
}

describe('POST /api/uploadjobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(session);
    mocks.createUploadBackgroundJob.mockResolvedValue({
      jobID: 42,
      status: 'queued',
      phase: 'queued'
    });
  });

  it('creates a job, kicks the worker, and returns 202 with accepted: true', async () => {
    const response = await POST(
      makeCreateRequest(
        makeCreateBody({
          payload: {
            selectedDelimiters: { 'measurements.csv': ',' },
            columnMappings: { 'measurements.csv': VALID_COLUMN_MAPPING }
          }
        })
      )
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ accepted: true, job: { jobID: 42 } });
    expect(body).not.toHaveProperty('enqueued');
    expect(mocks.assertCanEditMeasurementScope).toHaveBeenCalledWith(expect.anything(), session, {
      schema: 'forestgeo_testing',
      plotID: 1,
      censusID: 2
    });
    expect(mocks.isAsyncUploadEnabledFor).toHaveBeenCalledWith({
      schema: 'forestgeo_testing',
      formType: 'measurements',
      userIds: ['mason@example.com', 'Mason']
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
    expect(mocks.runJobIfClaimable).toHaveBeenCalledWith(42);
  });

  it('rejects invalid schemas before creating a job', async () => {
    mocks.isValidSchema.mockReturnValueOnce(false);

    const response = await POST(makeCreateRequest(makeCreateBody({ schema: 'bad-schema' })));

    expect(response.status).toBe(400);
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.runJobIfClaimable).not.toHaveBeenCalled();
  });

  it('rejects an unknown formType with a field-level issue', async () => {
    const response = await POST(makeCreateRequest(makeCreateBody({ formType: 'bogus' })));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Validation failed');
    expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'formType' })]));
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });

  it('rejects an unknown sourceFormat with a field-level issue', async () => {
    const response = await POST(makeCreateRequest(makeCreateBody({ sourceFormat: 'xlsx' })));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'sourceFormat' })]));
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });

  it('rejects an unrecognized uploadMode', async () => {
    const response = await POST(makeCreateRequest(makeCreateBody({ uploadMode: 'overwrite_everything' })));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'uploadMode' })]));
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });

  it('rejects a malformed column mapping value with the offending file in the field path', async () => {
    const response = await POST(
      makeCreateRequest(
        makeCreateBody({
          payload: { columnMappings: { 'measurements.csv': { version: 2, fields: 'not-an-array' } } }
        })
      )
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'payload.columnMappings.measurements.csv' })]));
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });

  it('rejects an unsupported delimiter selection', async () => {
    const response = await POST(
      makeCreateRequest(
        makeCreateBody({
          payload: { selectedDelimiters: { 'measurements.csv': '##' } }
        })
      )
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'payload.selectedDelimiters.measurements.csv' })]));
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });

  it('rejects a formType/sourceFormat combination the worker does not support', async () => {
    const response = await POST(makeCreateRequest(makeCreateBody({ formType: 'species', sourceFormat: 'csv' })));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('Async uploads only support measurements');
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.runJobIfClaimable).not.toHaveBeenCalled();
  });

  it('rejects job creation when the async upload feature gate is disabled', async () => {
    mocks.isAsyncUploadEnabledFor.mockReturnValueOnce(false);

    const response = await POST(makeCreateRequest(makeCreateBody()));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Async uploads are not enabled for this form/site/user' });
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.runJobIfClaimable).not.toHaveBeenCalled();
  });

  it('rejects arcgis_xlsx jobs that are missing the pre-flight import session', async () => {
    const response = await POST(
      makeCreateRequest(
        makeCreateBody({
          sourceFormat: 'arcgis_xlsx',
          payload: { arcgisImportSession: null }
        })
      )
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'payload.arcgisImportSession' })]));
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });

  it('accepts arcgis_xlsx jobs that carry a complete pre-flight import session', async () => {
    const response = await POST(
      makeCreateRequest(
        makeCreateBody({
          sourceFormat: 'arcgis_xlsx',
          payload: {
            arcgisImportSession: { importSessionId: 'import-1', fileName: 'survey.xlsx', rowCount: 100 }
          }
        })
      )
    );

    expect(response.status).toBe(202);
    expect(mocks.runJobIfClaimable).toHaveBeenCalledWith(42);
  });
});

describe('GET /api/uploadjobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(session);
    mocks.listBackgroundJobs.mockResolvedValue([{ jobID: 42, status: 'queued' }]);
  });

  it('lists active jobs for the authenticated user and optional scope', async () => {
    const request = new Request('http://localhost/api/uploadjobs?schema=forestgeo_testing&plotID=1&censusID=2') as any;

    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ jobs: [{ jobID: 42, status: 'queued' }] });
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
