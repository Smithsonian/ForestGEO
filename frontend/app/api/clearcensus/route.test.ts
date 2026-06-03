import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock('@/auth', () => ({ auth: authMock }));

// ---- Mock SQL security utilities ----
vi.mock('@/config/utils/sqlsecurity', () => ({
  validateSchemaOrThrow: vi.fn(),
  safeFormatQuery: vi.fn((schema, query) => query)
}));

// ---- Mock ailogger ----
vi.mock('@/ailogger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}));

// ---- Mock mysql2/promise format function ----
vi.mock('mysql2/promise', () => ({
  format: vi.fn((sql, params) => {
    // Mock implementation that properly replaces ?? and ? placeholders in order
    let result = sql;
    params.forEach((param: any) => {
      if (result.includes('??')) {
        result = result.replace('??', param);
      } else if (result.includes('?')) {
        result = result.replace('?', param);
      }
    });
    return result;
  })
}));

// ---- Wrap ConnectionManager BEFORE importing the route ----
vi.mock('@/config/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/config/connectionmanager').catch(() => ({}) as any);

  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance()) ||
    actual?.default ||
    actual;

  // Use existing shared mock instance if present; otherwise make a safe stub.
  const instance = (candidate &&
    typeof candidate.beginTransaction === 'function' &&
    typeof candidate.commitTransaction === 'function' &&
    typeof candidate.rollbackTransaction === 'function' &&
    typeof candidate.executeQuery === 'function' &&
    candidate) || {
    beginTransaction: vi.fn(async () => 'tx-test'),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    executeQuery: vi.fn(async () => {})
  };

  const getInstance = vi.fn(() => instance);

  return {
    ...actual,
    default: { ...(actual?.default ?? {}), getInstance },
    getInstance
  };
});

// ---- Helpers ----
function makeRequest(url: string) {
  const req: any = new Request(url, { method: 'GET' });
  req.nextUrl = new URL(url); // Next.js reads request.nextUrl.searchParams
  return req as any;
}

// ---- Import handler AFTER mocks ----
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager';

describe('GET /api/clearcensus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'admin-user', userStatus: 'global' } });
  });

  it('401 when no session and does not call ConnectionManager', async () => {
    authMock.mockResolvedValueOnce(null);
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction');

    const res = await GET(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.UNAUTHORIZED);
    expect(begin).not.toHaveBeenCalled();
  });

  it('403 when non-admin session and does not call ConnectionManager', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'user', userStatus: 'field crew' } });
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction');

    const res = await GET(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.FORBIDDEN);
    expect(begin).not.toHaveBeenCalled();
  });

  it('400 when schema, censusID, or type is missing', async () => {
    // missing all
    let res = await GET(makeRequest('http://localhost/api/clearcensus'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(await res.text()).toMatch(/Missing required parameters/i);

    // missing censusID and type
    res = await GET(makeRequest('http://localhost/api/clearcensus?schema=myschema'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(await res.text()).toMatch(/Missing required parameters/i);

    // missing schema and type
    res = await GET(makeRequest('http://localhost/api/clearcensus?censusID=7'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(await res.text()).toMatch(/Missing required parameters/i);

    // missing type
    res = await GET(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=7'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(await res.text()).toMatch(/Missing required parameters/i);
  });

  it('200 on success: begins tx, calls proc, commits', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-1');
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce({});
    const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
    const rollback = vi.spyOn(cm, 'rollbackTransaction');

    const res = await GET(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body).toEqual({ message: 'Census cleared successfully' });

    expect(begin).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(1);

    const [sql, params] = exec.mock.calls[0];
    // format() replaces placeholders, so we get the formatted SQL
    expect(String(sql)).toMatch(/^CALL myschema\.clearcensusmsmts\((12|\?)\);?$/i);
    expect(params).toEqual([]);

    expect(commit).toHaveBeenCalledWith('tx-1');
    expect(rollback).not.toHaveBeenCalled();
  });

  it('500 on DB error: rolls back with transaction id and returns error text', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-err');
    const exec = vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('boom'));
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction');

    const res = await GET(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=99&type=full'));

    expect(begin).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith('tx-err');
    expect(commit).not.toHaveBeenCalled();

    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    const text = await res.text();
    expect(text).toMatch(/boom/i);
  });

  it('builds stored procedure name using `type` param (smoke check)', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-2');
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce({});
    vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);

    await GET(makeRequest('http://localhost/api/clearcensus?schema=s1&censusID=5&type=attributes'));

    const [sql] = exec.mock.calls[0];
    // format() replaces placeholders, so we get the formatted SQL
    expect(String(sql)).toMatch(/^CALL s1\.clearcensusattributes\((5|\?)\);?$/i);
  });

  it('400 when invalid type is provided', async () => {
    const res = await GET(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=5&type=invalid'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    const text = await res.text();
    expect(text).toMatch(/Invalid census type/i);
  });
});
