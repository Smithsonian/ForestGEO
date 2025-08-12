import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// ---- Import handler AFTER mocks ----
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager'; // ---- Helpers ----

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

describe('GET /api/clearcensus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('503 when schema or censusID is missing', async () => {
    // missing both
    let res = await GET(makeRequest('http://localhost/api/clearcensus'));
    expect(res.status).toBe(HTTPResponses.SERVICE_UNAVAILABLE);
    expect(await res.text()).toMatch(/Missing required parameters/i);

    // missing censusID
    res = await GET(makeRequest('http://localhost/api/clearcensus?schema=myschema'));
    expect(res.status).toBe(HTTPResponses.SERVICE_UNAVAILABLE);
    expect(await res.text()).toMatch(/Missing required parameters/i);

    // missing schema
    res = await GET(makeRequest('http://localhost/api/clearcensus?censusID=7'));
    expect(res.status).toBe(HTTPResponses.SERVICE_UNAVAILABLE);
    expect(await res.text()).toMatch(/Missing required parameters/i);
  });

  it('200 on success: begins tx, calls proc, commits', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-1');
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce({});
    const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
    const rollback = vi.spyOn(cm, 'rollbackTransaction');

    const res = await GET(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=view'));

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body).toEqual({ message: 'Census cleared successfully' });

    expect(begin).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(1);

    const [sql, params] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/^CALL myschema\.clearcensusview\(\?\);?$/i);
    expect(params).toEqual(['12']);

    expect(commit).toHaveBeenCalledWith('tx-1');
    expect(rollback).not.toHaveBeenCalled();
  });

  it('503 on DB error: rolls back with transaction id and returns error text', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-err');
    const exec = vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('boom'));
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction');

    const res = await GET(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=99&type=all'));

    expect(begin).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith('tx-err');
    expect(commit).not.toHaveBeenCalled();

    expect(res.status).toBe(HTTPResponses.SERVICE_UNAVAILABLE);
    const text = await res.text();
    expect(text).toMatch(/boom/i);
  });

  it('builds stored procedure name using `type` param (smoke check)', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-2');
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce({});
    vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);

    await GET(makeRequest('http://localhost/api/clearcensus?schema=s1&censusID=5&type=custom'));

    const [sql] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/^CALL s1\.clearcensuscustom\(\?\);?$/i);
  });
});
