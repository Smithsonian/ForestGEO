import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
import { MAX_UPLOAD_JOB_REQUEST_BYTES } from '@/lib/background-jobs/route-helpers';

// GET/POST are wrapped by withRouteAuthz, whose Handler type requires a
// RouteContext second argument even though this route never reads
// context.params. These routes have no dynamic segments, so an always-empty
// context is a faithful stand-in for what Next.js would supply.
const EMPTY_CONTEXT = { params: Promise.resolve({}) };
function callPost(request: any) {
  return POST(request, EMPTY_CONTEXT);
}
function callGet(request: any) {
  return GET(request, EMPTY_CONTEXT);
}

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireSession: vi.fn(() => null),
  getSessionUserId: vi.fn(() => 'mason@example.com'),
  getSessionUserIds: vi.fn(() => ['mason@example.com', 'Mason']),
  isValidSchema: vi.fn(() => true),
  assertCanEditMeasurementScope: vi.fn(async () => ({ plotCensusNumber: 2 })),
  getContainerName: vi.fn(() => 'forestgeo-testing-storage'),
  getPoolMonitorInstance: vi.fn(() => ({ pool: 'catalog-pool' })),
  createUploadBackgroundJob: vi.fn(),
  listBackgroundJobs: vi.fn(),
  isAsyncUploadEnabledFor: vi.fn(() => true),
  runJobIfClaimable: vi.fn(async () => undefined),
  executeQuery: vi.fn(),
  loggerError: vi.fn(),
  IdempotencyKeyConflictError: class IdempotencyKeyConflictError extends Error {}
}));

vi.mock('@/auth', () => ({
  auth: mocks.auth
}));

vi.mock('@/lib/auth-helpers', () => ({
  requireSession: mocks.requireSession,
  getSessionUserId: mocks.getSessionUserId,
  getSessionUserIds: mocks.getSessionUserIds
}));

vi.mock('@/lib/db/sqlsecurity', () => ({
  isValidSchema: mocks.isValidSchema
}));

vi.mock('@/config/editplan/scopeguard', () => ({
  assertCanEditMeasurementScope: mocks.assertCanEditMeasurementScope,
  ScopeAccessError: class ScopeAccessError extends Error {}
}));

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({ executeQuery: mocks.executeQuery })
  }
}));

vi.mock('@/lib/db/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: mocks.getPoolMonitorInstance
}));

vi.mock('@/lib/background-jobs/repository', () => ({
  createUploadBackgroundJob: mocks.createUploadBackgroundJob,
  listBackgroundJobs: mocks.listBackgroundJobs
}));

vi.mock('@/lib/background-jobs/errors', () => ({
  IdempotencyKeyConflictError: mocks.IdempotencyKeyConflictError
}));

vi.mock('@/config/macros/containernames', () => ({
  getContainerName: mocks.getContainerName,
  SchemaContainerNameError: class SchemaContainerNameError extends Error {}
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
  fields: [{ canonicalField: 'tag', sourceColumns: ['Tag'], scope: 'both' }]
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

/**
 * The route requires Content-Length. The WHATWG Request constructor does not set
 * it — that header is added by the HTTP transport when a request is actually
 * sent — so these unit-level requests set it themselves, exactly as the browser
 * would for a string body. tests/integration/uploadjobs-content-length.test.ts
 * proves the real transport does supply it.
 */
/** Comfortably past the limit, for the "declared oversize" path. */
const OVERSIZED_CONTENT_LENGTH = MAX_UPLOAD_JOB_REQUEST_BYTES * 2;

function makeCreateRequest(body: Record<string, unknown>) {
  const serialized = JSON.stringify(body);
  const request = new Request('http://localhost/api/uploadjobs', {
    method: 'POST',
    body: serialized
  }) as any;
  request.headers.set('content-length', String(Buffer.byteLength(serialized, 'utf8')));
  return request;
}

function makeListRequest(query: string) {
  const url = new URL(`http://localhost/api/uploadjobs${query}`);
  const req = new Request(url.toString()) as any;
  req.nextUrl = url; // withRouteAuthz's fromQuery resolver reads request.nextUrl
  return req;
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
    const response = await callPost(
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

  it('still returns 202 when the worker kick rejects, and logs the kick failure', async () => {
    mocks.runJobIfClaimable.mockRejectedValueOnce(new Error('claim-time infrastructure outage'));

    const response = await callPost(makeCreateRequest(makeCreateBody()));

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ accepted: true, job: { jobID: 42 } });
    expect(mocks.runJobIfClaimable).toHaveBeenCalledWith(42);
    // The kick is fire-and-forget; the rejection is handled on a microtask
    // after the response is returned.
    await vi.waitFor(() => {
      expect(mocks.loggerError).toHaveBeenCalledWith(expect.stringContaining('Failed to start worker for job 42'), expect.any(Error));
    });
  });

  it('rejects invalid schemas before creating a job', async () => {
    mocks.isValidSchema.mockReturnValueOnce(false);

    const response = await callPost(makeCreateRequest(makeCreateBody({ schema: 'bad-schema' })));

    expect(response.status).toBe(400);
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.runJobIfClaimable).not.toHaveBeenCalled();
  });

  it('rejects a body with no schema field with 400 before any repository or scope call (withRouteAuthz gate)', async () => {
    const response = await callPost(makeCreateRequest(makeCreateBody({ schema: undefined })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_SCHEMA' });
    expect(mocks.assertCanEditMeasurementScope).not.toHaveBeenCalled();
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.runJobIfClaimable).not.toHaveBeenCalled();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects job creation for a schema outside the caller session scope with 403 and zero repository/SQL calls', async () => {
    const response = await callPost(makeCreateRequest(makeCreateBody({ schema: 'forestgeo_other' })));

    expect(response.status).toBe(403);
    expect(mocks.assertCanEditMeasurementScope).not.toHaveBeenCalled();
    expect(mocks.isAsyncUploadEnabledFor).not.toHaveBeenCalled();
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.runJobIfClaimable).not.toHaveBeenCalled();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('reaches job creation for an admin session even when the schema is not in their sites list', async () => {
    // withRouteAuthz calls auth() to gate the request and the handler calls
    // auth() again for its own identity lookups, so the override must persist
    // across both calls rather than being consumed by the wrapper alone.
    mocks.auth.mockResolvedValue({ user: { ...session.user, userStatus: 'global', sites: [] } });

    const response = await callPost(makeCreateRequest(makeCreateBody({ schema: 'forestgeo_other' })));

    expect(response.status).toBe(202);
    expect(mocks.assertCanEditMeasurementScope).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ user: expect.objectContaining({ userStatus: 'global' }) }),
      { schema: 'forestgeo_other', plotID: 1, censusID: 2 }
    );
  });

  it('rejects an unknown formType with a field-level issue', async () => {
    const response = await callPost(makeCreateRequest(makeCreateBody({ formType: 'bogus' })));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Validation failed');
    expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'formType' })]));
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });

  it('rejects an unknown sourceFormat with a field-level issue', async () => {
    const response = await callPost(makeCreateRequest(makeCreateBody({ sourceFormat: 'xlsx' })));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'sourceFormat' })]));
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });

  it('rejects an unrecognized uploadMode', async () => {
    const response = await callPost(makeCreateRequest(makeCreateBody({ uploadMode: 'overwrite_everything' })));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'uploadMode' })]));
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });

  it('rejects a malformed column mapping value with the offending file in the field path', async () => {
    const response = await callPost(
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
    const response = await callPost(
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
    const response = await callPost(makeCreateRequest(makeCreateBody({ formType: 'species', sourceFormat: 'csv' })));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('Async uploads only support measurements');
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.runJobIfClaimable).not.toHaveBeenCalled();
  });

  it('rejects job creation when the async upload feature gate is disabled', async () => {
    mocks.isAsyncUploadEnabledFor.mockReturnValueOnce(false);

    const response = await callPost(makeCreateRequest(makeCreateBody()));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Async uploads are not enabled for this form/site/user' });
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.runJobIfClaimable).not.toHaveBeenCalled();
  });

  it('rejects a client-selected blob container outside the authorized plot/census scope', async () => {
    const response = await callPost(makeCreateRequest(makeCreateBody({ files: [{ ...makeCreateBody().files[0], blobContainer: 'other-site' }] })));

    expect(response.status).toBe(403);
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });

  it('rejects duplicate file names before batch bookkeeping can collide', async () => {
    const file = makeCreateBody().files[0];
    const response = await callPost(makeCreateRequest(makeCreateBody({ files: [file, { ...file, blobName: 'uploads/job-1/copy.csv' }] })));

    expect(response.status).toBe(400);
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });

  it('rejects more than 100 files', async () => {
    const file = makeCreateBody().files[0];
    const files = Array.from({ length: 101 }, (_, index) => ({ ...file, fileName: `file-${index}.csv`, blobName: `uploads/file-${index}.csv` }));
    const response = await callPost(makeCreateRequest(makeCreateBody({ files })));

    expect(response.status).toBe(400);
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });

  it('returns 409 when an idempotency key belongs to a different request', async () => {
    mocks.createUploadBackgroundJob.mockRejectedValueOnce(new mocks.IdempotencyKeyConflictError('conflict'));
    const response = await callPost(makeCreateRequest(makeCreateBody()));

    expect(response.status).toBe(409);
    expect(mocks.runJobIfClaimable).not.toHaveBeenCalled();
  });

  it('rejects arcgis_xlsx jobs that are missing the pre-flight import session', async () => {
    const response = await callPost(
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
    const response = await callPost(
      makeCreateRequest(
        makeCreateBody({
          sourceFormat: 'arcgis_xlsx',
          files: [{ ...makeCreateBody().files[0], fileName: 'survey.xlsx', blobName: 'survey.xlsx', sourceFormat: 'arcgis_xlsx' }],
          payload: {
            arcgisImportSession: { importSessionId: 'import-1', fileName: 'survey.xlsx', rowCount: 100 }
          }
        })
      )
    );

    expect(response.status).toBe(202);
    expect(mocks.runJobIfClaimable).toHaveBeenCalledWith(42);
  });

  // /api/files/upload rewrites the stored file name through sanitizeFileName,
  // and that stored name is what files[].fileName carries. Every later
  // reference — payload map keys, the ArcGIS pre-flight file name — has to be
  // compared in the same canonical form, or a file whose name contains a
  // space (Harvard Forest 2014.csv) can never be queued.
  it('accepts payload maps keyed by the sanitized name the blob upload stored', async () => {
    const response = await callPost(
      makeCreateRequest(
        makeCreateBody({
          files: [{ ...makeCreateBody().files[0], fileName: 'Harvard_Forest_2014.csv', blobName: 'uploads/job-1/Harvard_Forest_2014.csv' }],
          payload: {
            selectedDelimiters: { 'Harvard_Forest_2014.csv': ',' },
            columnMappings: { 'Harvard_Forest_2014.csv': VALID_COLUMN_MAPPING }
          }
        })
      )
    );

    expect(response.status).toBe(202);
    expect(mocks.createUploadBackgroundJob).toHaveBeenCalledWith(
      'catalog-pool',
      expect.objectContaining({
        payload: expect.objectContaining({ selectedDelimiters: { 'Harvard_Forest_2014.csv': ',' } })
      }),
      'mason@example.com'
    );
  });

  it('still rejects payload maps naming a file the job does not carry', async () => {
    const response = await callPost(
      makeCreateRequest(
        makeCreateBody({
          payload: { selectedDelimiters: { 'some-other-file.csv': ',' } }
        })
      )
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'payload.selectedDelimiters.some-other-file.csv', message: expect.stringContaining('unknown file name') })
      ])
    );
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });

  it('accepts an ArcGIS job whose pre-flight file name only differs by blob-name sanitization', async () => {
    const response = await callPost(
      makeCreateRequest(
        makeCreateBody({
          sourceFormat: 'arcgis_xlsx',
          files: [{ ...makeCreateBody().files[0], fileName: 'Harvard_Survey_2014.xlsx', blobName: 'Harvard_Survey_2014.xlsx', sourceFormat: 'arcgis_xlsx' }],
          payload: {
            // The pre-flight session records the raw browser name.
            arcgisImportSession: { importSessionId: 'import-1', fileName: 'Harvard Survey 2014.xlsx', rowCount: 100 }
          }
        })
      )
    );

    expect(response.status).toBe(202);
    expect(mocks.runJobIfClaimable).toHaveBeenCalledWith(42);
  });

  it('rejects an ArcGIS job whose file is not the pre-flight file at all', async () => {
    const response = await callPost(
      makeCreateRequest(
        makeCreateBody({
          sourceFormat: 'arcgis_xlsx',
          files: [{ ...makeCreateBody().files[0], fileName: 'unrelated.xlsx', blobName: 'unrelated.xlsx', sourceFormat: 'arcgis_xlsx' }],
          payload: { arcgisImportSession: { importSessionId: 'import-1', fileName: 'Harvard Survey 2014.xlsx', rowCount: 100 } }
        })
      )
    );

    expect(response.status).toBe(400);
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });

  // census.PlotCensusNumber is nullable. The scope guard reports that rather
  // than denying access (other routes do not need the number), so THIS route —
  // which needs it to name the blob container — must reject it itself, and as
  // a request problem rather than an authorization failure.
  it('rejects a census with no plot census number with 400, not 403', async () => {
    mocks.assertCanEditMeasurementScope.mockResolvedValueOnce({ plotCensusNumber: null } as any);

    const response = await callPost(makeCreateRequest(makeCreateBody()));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('no plot census number') });
    expect(mocks.getContainerName).not.toHaveBeenCalled();
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });

  it('rejects an oversized request before anything reads or parses the body', async () => {
    const request = makeCreateRequest(makeCreateBody());
    request.headers.set('content-length', String(OVERSIZED_CONTENT_LENGTH));
    const jsonSpy = vi.spyOn(request, 'json');

    const response = await callPost(request);

    expect(response.status).toBe(413);
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.assertCanEditMeasurementScope).not.toHaveBeenCalled();
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });

  /**
   * The bound is only a bound if it cannot be skipped. The old check read the
   * header, coerced it with Number(), and passed anything that was not a finite
   * number over the limit: a missing header became Number(null) = 0 and a
   * malformed one became NaN. A chunked / header-less POST therefore skipped the
   * check entirely, and fromBody('schema') still cloned and parsed the whole body
   * to resolve the schema.
   */
  describe('Content-Length is mandatory', () => {
    it.each([
      { label: 'missing', header: null },
      { label: 'empty', header: '' },
      { label: 'non-numeric', header: 'not-a-number' },
      { label: 'fractional', header: '12.5' },
      { label: 'negative', header: '-1' }
    ])('rejects a $label Content-Length with 411, before authz or body parsing', async ({ header }) => {
      const request = makeCreateRequest(makeCreateBody());
      if (header === null) request.headers.delete('content-length');
      else request.headers.set('content-length', header);
      const jsonSpy = vi.spyOn(request, 'json');

      const response = await callPost(request);

      expect(response.status).toBe(411);
      expect(jsonSpy).not.toHaveBeenCalled();
      expect(mocks.auth).not.toHaveBeenCalled();
      expect(mocks.assertCanEditMeasurementScope).not.toHaveBeenCalled();
      expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
    });

    it('accepts a declared length at exactly the limit', async () => {
      const request = makeCreateRequest(makeCreateBody());
      request.headers.set('content-length', String(MAX_UPLOAD_JOB_REQUEST_BYTES));

      const response = await callPost(request);

      expect(response.status).toBe(202);
    });

    it('rejects one byte over the limit', async () => {
      const request = makeCreateRequest(makeCreateBody());
      request.headers.set('content-length', String(MAX_UPLOAD_JOB_REQUEST_BYTES + 1));

      expect((await callPost(request)).status).toBe(413);
    });

    it('accepts a zero-length declaration and lets validation reject the empty body', async () => {
      // 0 is a legitimate declared length, not the "missing header" sentinel it
      // used to be conflated with. It must reach the parser, which rejects it.
      const request = makeCreateRequest(makeCreateBody());
      request.headers.set('content-length', '0');

      expect((await callPost(request)).status).not.toBe(411);
    });
  });

  /**
   * The worker reads columnMappings[file.fileName] and
   * selectedDelimiters[file.fileName] — plain, case-sensitive property access.
   * Validation used to accept a key that matched only case-insensitively, so the
   * lookup then missed and the file processed with default aliasing and auto
   * delimiter detection instead of the mapping the caller supplied. Silently.
   */
  describe('payload keys must match files[].fileName exactly', () => {
    const EXACT_FILE_NAME = 'measurements.csv';
    const CASE_MISMATCHED_FILE_NAME = 'Measurements.CSV';

    it('accepts keys that match exactly', async () => {
      const response = await callPost(
        makeCreateRequest(
          makeCreateBody({
            payload: {
              columnMappings: { [EXACT_FILE_NAME]: VALID_COLUMN_MAPPING },
              selectedDelimiters: { [EXACT_FILE_NAME]: ',' }
            }
          })
        )
      );

      expect(response.status).toBe(202);
    });

    it.each(['columnMappings', 'selectedDelimiters'] as const)('rejects a case-only mismatch in %s before creating the job', async payloadKey => {
      const payload =
        payloadKey === 'columnMappings'
          ? { columnMappings: { [CASE_MISMATCHED_FILE_NAME]: VALID_COLUMN_MAPPING } }
          : { selectedDelimiters: { [CASE_MISMATCHED_FILE_NAME]: ',' } };

      const response = await callPost(makeCreateRequest(makeCreateBody({ payload })));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: `payload.${payloadKey}.${CASE_MISMATCHED_FILE_NAME}`,
            message: expect.stringContaining('differs in case')
          })
        ])
      );
      expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
    });

    it('still reports a genuinely unknown file name as unknown, not as a case problem', async () => {
      const response = await callPost(makeCreateRequest(makeCreateBody({ payload: { selectedDelimiters: { 'some-other-file.csv': ',' } } })));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('unknown file name') })]));
    });
  });

  it('rejects an ArcGIS job with more than one file', async () => {
    const file = makeCreateBody().files[0];
    const response = await callPost(
      makeCreateRequest(
        makeCreateBody({
          sourceFormat: 'arcgis_xlsx',
          files: [
            { ...file, fileName: 'survey.xlsx', blobName: 'survey.xlsx', sourceFormat: 'arcgis_xlsx' },
            { ...file, fileName: 'other.xlsx', blobName: 'other.xlsx', sourceFormat: 'arcgis_xlsx' }
          ],
          payload: { arcgisImportSession: { importSessionId: 'import-1', fileName: 'survey.xlsx', rowCount: 100 } }
        })
      )
    );

    expect(response.status).toBe(400);
    expect(mocks.createUploadBackgroundJob).not.toHaveBeenCalled();
  });
});

describe('GET /api/uploadjobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(session);
    mocks.listBackgroundJobs.mockResolvedValue([{ jobID: 42, status: 'queued' }]);
  });

  it('lists active jobs for the authenticated user and optional scope', async () => {
    const request = makeListRequest('?schema=forestgeo_testing&plotID=1&censusID=2');

    const response = await callGet(request);

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
    // Persist (not "once") the admin override — withRouteAuthz's own auth()
    // call and the handler's auth() call both need the same session.
    mocks.auth.mockResolvedValue({ user: { ...session.user, userStatus: 'global' } });
    const request = makeListRequest('?schema=forestgeo_testing&allUsers=true&activeOnly=false&limit=5');

    const response = await callGet(request);

    expect(response.status).toBe(200);
    expect(mocks.listBackgroundJobs).toHaveBeenCalledWith('catalog-pool', expect.objectContaining({ includeAllUsers: true, activeOnly: false, limit: 5 }));
  });

  it('rejects a list request with a missing schema with 400 before any repository call', async () => {
    const request = makeListRequest('?plotID=1&censusID=2');

    const response = await callGet(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_SCHEMA' });
    expect(mocks.listBackgroundJobs).not.toHaveBeenCalled();
  });

  it('rejects a list request for a schema outside the caller session scope with 403 and zero repository calls', async () => {
    const request = makeListRequest('?schema=forestgeo_other');

    const response = await callGet(request);

    expect(response.status).toBe(403);
    expect(mocks.listBackgroundJobs).not.toHaveBeenCalled();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects malformed numeric filters instead of silently broadening the list', async () => {
    const response = await callGet(makeListRequest('?schema=forestgeo_testing&plotID=not-a-number'));

    expect(response.status).toBe(400);
    expect(mocks.listBackgroundJobs).not.toHaveBeenCalled();
  });

  it('rejects malformed boolean filters', async () => {
    const response = await callGet(makeListRequest('?schema=forestgeo_testing&activeOnly=0'));

    expect(response.status).toBe(400);
    expect(mocks.listBackgroundJobs).not.toHaveBeenCalled();
  });
});
