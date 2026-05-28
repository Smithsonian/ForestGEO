// app/api/batchedupload/[schema]/[[...slugs]]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock, validateContextualValuesMock, validatedSchemaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  validateContextualValuesMock: vi.fn(),
  validatedSchemaMock: vi.fn()
}));

vi.mock('@/auth', () => ({ auth: authMock }));

vi.mock('@/lib/contextvalidation', () => ({
  validateContextualValues: validateContextualValuesMock
}));

vi.mock('@/config/utils/sqlsecurity', () => ({
  validatedSchema: validatedSchemaMock
}));

vi.mock('@/config/connectionmanager', () => {
  const executeQuery = vi.fn();
  const beginTransaction = vi.fn().mockResolvedValue('tx-test');
  const commitTransaction = vi.fn().mockResolvedValue(undefined);
  const rollbackTransaction = vi.fn().mockResolvedValue(undefined);
  const closeConnection = vi.fn().mockResolvedValue(undefined);
  const instance = { executeQuery, beginTransaction, commitTransaction, rollbackTransaction, closeConnection };
  return {
    default: {
      getInstance: () => instance
    }
  };
});

vi.mock('@/config/measurementerrors', () => ({
  insertIngestionFailureRows: vi.fn().mockResolvedValue([1, 2])
}));

vi.mock('@/ailogger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

// Keep mysql2.format deterministic for assertions (optional)
vi.mock('mysql2/promise', () => {
  const format = (sql: string, params: any[]) => `FORMATTED_SQL:${sql}::PARAMS:${JSON.stringify(params)}`;
  return { format };
});

import { POST } from './route';
import ailogger from '@/ailogger';
import connectionmanager from '@/config/connectionmanager';
import { insertIngestionFailureRows } from '@/config/measurementerrors';

function makeRequest(body: unknown) {
  const req = new Request('http://localhost/api', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
  }) as any;
  req.nextUrl = new URL('http://localhost/api');
  return req;
}

function makeParams(schema: string | undefined, slugs?: string[]) {
  return { params: Promise.resolve({ schema: schema as any, slugs }) } as any;
}

const HAPPY_VALUES = { schema: 'forestgeo_testing', plotID: 42, censusID: 7 };

describe('batchedupload POST route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: happy path — validateContextualValues succeeds.
    validateContextualValuesMock.mockResolvedValue({ success: true, values: HAPPY_VALUES });
    validatedSchemaMock.mockImplementation((s: string) => s as any);
    authMock.mockResolvedValue({
      user: { id: 'site-user', userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_testing' }] }
    });
  });

  it('400 when body is empty', async () => {
    const req = makeRequest([]); // empty array -> invalid per route
    const res = await POST(req, makeParams('forestgeo_testing', ['1', '2']));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/No data provided for batch upload/i);
  });

  it('happy path: validateContextualValues succeeds → proceeds, branded schema is forwarded', async () => {
    const payload = [
      { id: 999, failedMeasurementID: 123, treeID: 10, stemGUID: 20, reason: 'bad diameter' },
      { treeID: 11, stemGUID: 21, reason: 'missing height' }
    ];
    const req = makeRequest(payload);
    const res = await POST(req, makeParams('forestgeo_testing', ['42', '7']));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toMatch(/Inserted ingestion error rows/i);
    expect(body.rowCount).toBe(2);

    const insertMock = insertIngestionFailureRows as ReturnType<typeof vi.fn>;
    expect(insertMock).toHaveBeenCalledTimes(1);
    const [connArg, schemaArg, rowsArg] = insertMock.mock.calls[0];
    expect(connArg).toBe(connectionmanager.getInstance());
    expect(schemaArg).toBe('forestgeo_testing');
    expect(rowsArg).toHaveLength(2);
    expect(rowsArg[0]).toMatchObject({ plotID: 42, censusID: 7, sourceRowIndex: 1, failureReason: 'Unknown error' });

    expect(validatedSchemaMock).toHaveBeenCalledWith('forestgeo_testing');
  });

  it('500 and logs on DB error', async () => {
    const insertMock = insertIngestionFailureRows as ReturnType<typeof vi.fn>;
    insertMock.mockRejectedValueOnce(new Error('boom'));

    const payload = [{ treeID: 1, stemGUID: 2, reason: 'oops' }];
    const req = makeRequest(payload);
    const res = await POST(req, makeParams('forestgeo_testing', ['1', '2']));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toMatch(/Database error/i);
    expect(body.error).toMatch(/boom/);

    const logErr = ((ailogger as any).error ?? (ailogger as any).default?.error) as ReturnType<typeof vi.fn>;
    expect(logErr).toHaveBeenCalled();
  });

  describe('fallback path (validateContextualValues fails)', () => {
    const VALIDATION_FAIL_RESPONSE = { status: 400, message: 'context validation failed' };

    beforeEach(() => {
      validateContextualValuesMock.mockResolvedValue({
        success: false,
        response: new Response(JSON.stringify({ message: 'context validation failed' }), { status: 400 })
      });
    });

    it('400 when plotID/censusID URL params are not numeric — no writes reached', async () => {
      const payload = [{ treeID: 1, stemGUID: 1, reason: 'bad' }];
      const req = makeRequest(payload);
      const res = await POST(req, makeParams('forestgeo_testing', ['NaN', '2']));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toMatch(/Invalid plotID or censusID/i);

      const insertMock = insertIngestionFailureRows as ReturnType<typeof vi.fn>;
      expect(insertMock).not.toHaveBeenCalled();
    });

    it('401 when no session — schema from URL is rejected; no writes reached', async () => {
      authMock.mockResolvedValueOnce(null);

      const payload = [{ treeID: 1, stemGUID: 1, reason: 'bad' }];
      const req = makeRequest(payload);
      const res = await POST(req, makeParams('forestgeo_other_site', ['1', '2']));

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBe('UNAUTHENTICATED');

      const insertMock = insertIngestionFailureRows as ReturnType<typeof vi.fn>;
      expect(insertMock).not.toHaveBeenCalled();
    });

    it('403 when authed but schema not in user.sites — no writes reached', async () => {
      authMock.mockResolvedValueOnce({
        user: { id: 'u', userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_testing' }] }
      });

      const payload = [{ treeID: 1, stemGUID: 1, reason: 'bad' }];
      const req = makeRequest(payload);
      const res = await POST(req, makeParams('forestgeo_other_site', ['1', '2']));

      expect(res.status).toBe(403);

      const insertMock = insertIngestionFailureRows as ReturnType<typeof vi.fn>;
      expect(insertMock).not.toHaveBeenCalled();
    });

    it('400 when authed but URL schema fails pattern validation', async () => {
      validatedSchemaMock.mockImplementationOnce(() => {
        throw new Error('Invalid or unauthorized schema: bad-schema!');
      });

      const payload = [{ treeID: 1, stemGUID: 1, reason: 'bad' }];
      const req = makeRequest(payload);
      const res = await POST(req, makeParams('bad-schema!', ['1', '2']));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('INVALID_SCHEMA');

      const insertMock = insertIngestionFailureRows as ReturnType<typeof vi.fn>;
      expect(insertMock).not.toHaveBeenCalled();
    });

    it('proceeds when authed and schema is in user.sites', async () => {
      authMock.mockResolvedValueOnce({
        user: { id: 'u', userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_testing' }] }
      });

      const payload = [{ treeID: 1, stemGUID: 1, reason: 'bad' }];
      const req = makeRequest(payload);
      const res = await POST(req, makeParams('forestgeo_testing', ['1', '2']));

      expect(res.status).toBe(200);

      const insertMock = insertIngestionFailureRows as ReturnType<typeof vi.fn>;
      expect(insertMock).toHaveBeenCalledTimes(1);
      const [, schemaArg] = insertMock.mock.calls[0];
      expect(schemaArg).toBe('forestgeo_testing');
    });

    it('admin bypass: schema not in admin.sites still proceeds', async () => {
      authMock.mockResolvedValueOnce({
        user: { id: 'admin', userStatus: 'global', sites: [] }
      });

      const payload = [{ treeID: 1, stemGUID: 1, reason: 'bad' }];
      const req = makeRequest(payload);
      const res = await POST(req, makeParams('forestgeo_other_site', ['1', '2']));

      expect(res.status).toBe(200);
    });

    it('falls back to validation.response when slugs length != 2', async () => {
      const payload = [{ treeID: 1, stemGUID: 1, reason: 'bad' }];
      const req = makeRequest(payload);
      const res = await POST(req, makeParams('forestgeo_testing', ['1']));

      // Falls back to validation.response (400 from validateContextualValuesMock)
      expect(res.status).toBe(VALIDATION_FAIL_RESPONSE.status);

      const insertMock = insertIngestionFailureRows as ReturnType<typeof vi.fn>;
      expect(insertMock).not.toHaveBeenCalled();
    });
  });
});
