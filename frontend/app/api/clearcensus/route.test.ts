import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock('@/auth', () => ({ auth: authMock }));

// ---- Mock SQL security utilities ----
vi.mock('@/lib/db/sqlsecurity', () => ({
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
vi.mock('@/lib/db/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/lib/db/connectionmanager').catch(() => ({}) as any);

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
    typeof candidate.closeConnection === 'function' &&
    candidate) || {
    beginTransaction: vi.fn(async () => 'tx-test'),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    executeQuery: vi.fn(async () => {}),
    closeConnection: vi.fn(async () => {})
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
  const parsedUrl = new URL(url);
  const body = Object.fromEntries(parsedUrl.searchParams.entries());
  const req: any = new Request(parsedUrl.origin + parsedUrl.pathname, { method: 'POST', body: JSON.stringify(body) });
  req.nextUrl = new URL(url); // Next.js reads request.nextUrl.searchParams
  return req as any;
}

// ---- Import handler AFTER mocks ----
import { POST } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';

describe('POST /api/clearcensus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'admin-user', userStatus: 'global' } });
  });

  it('401 when no session and does not call ConnectionManager', async () => {
    authMock.mockResolvedValueOnce(null);
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction');

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.UNAUTHORIZED);
    expect(begin).not.toHaveBeenCalled();
  });

  it('403 when non-admin session and does not call ConnectionManager', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'user', userStatus: 'field crew' } });
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction');

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.FORBIDDEN);
    expect(begin).not.toHaveBeenCalled();
  });

  it('400 when schema, censusID, or type is missing', async () => {
    // missing all
    let res = await POST(makeRequest('http://localhost/api/clearcensus'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(await res.text()).toMatch(/Missing required parameters/i);

    // missing censusID and type
    res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(await res.text()).toMatch(/Missing required parameters/i);

    // missing schema and type
    res = await POST(makeRequest('http://localhost/api/clearcensus?censusID=7'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(await res.text()).toMatch(/Missing required parameters/i);

    // missing type
    res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=7'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(await res.text()).toMatch(/Missing required parameters/i);
  });

  it('200 on success: locks the plot, re-checks latest census, calls proc, and commits', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-1');
    const acquireLock = vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(true);
    const exec = vi
      .spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([{ PlotID: 1 }])
      .mockResolvedValueOnce([{ PlotID: 1, PlotCensusNumber: 2, MaxPlotCensusNumber: 2 }])
      .mockResolvedValueOnce({});
    const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
    const rollback = vi.spyOn(cm, 'rollbackTransaction');
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body).toEqual({ message: 'Census cleared successfully' });

    expect(begin).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(3);

    // The target scope is resolved first, then an advisory lock serializes all
    // clears for that plot even though the stored procedure starts its own tx.
    expect(begin.mock.invocationCallOrder[0]).toBeLessThan(exec.mock.invocationCallOrder[0]);
    const [scopeSql, , scopeTx] = exec.mock.calls[0];
    expect(String(scopeSql)).toMatch(/SELECT PlotID FROM myschema\.census/i);
    expect(scopeTx).toBe('tx-1');
    expect(acquireLock).toHaveBeenCalledWith('clear-census:myschema:1', 'tx-1', 0);

    // The latest guard is evaluated only after the plot lock is held.
    const [guardSql, , guardTx] = exec.mock.calls[1];
    expect(String(guardSql)).toMatch(/MAX\(PlotCensusNumber\)/i);
    expect(String(guardSql)).toMatch(/FOR UPDATE/i);
    expect(guardTx).toBe('tx-1');
    expect(acquireLock.mock.invocationCallOrder[0]).toBeLessThan(exec.mock.invocationCallOrder[1]);

    const [sql, params, callTx] = exec.mock.calls[2];
    // format() replaces placeholders, so we get the formatted SQL
    expect(String(sql)).toMatch(/^CALL myschema\.clearcensusmsmts\((12|\?)\);?$/i);
    expect(params).toEqual([]);
    expect(callTx).toBe('tx-1');

    expect(commit).toHaveBeenCalledWith('tx-1');
    expect(rollback).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('500 on DB error: rolls back with transaction id and returns error text', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-err');
    vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(true);
    const exec = vi
      .spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([{ PlotID: 1 }])
      .mockResolvedValueOnce([{ PlotID: 1, PlotCensusNumber: 2, MaxPlotCensusNumber: 2 }])
      .mockRejectedValueOnce(new Error('boom'));
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction');
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=99&type=full'));

    expect(begin).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(3);
    expect(rollback).toHaveBeenCalledWith('tx-err');
    expect(commit).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);

    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    const text = await res.text();
    expect(text).toMatch(/boom/i);
  });

  it('builds stored procedure name using `type` param (smoke check)', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-2');
    vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(true);
    const exec = vi
      .spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([{ PlotID: 1 }])
      .mockResolvedValueOnce([{ PlotID: 1, PlotCensusNumber: 5, MaxPlotCensusNumber: 5 }])
      .mockResolvedValueOnce({});
    vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);

    await POST(makeRequest('http://localhost/api/clearcensus?schema=s1&censusID=5&type=attributes'));

    const [sql] = exec.mock.calls[2];
    // format() replaces placeholders, so we get the formatted SQL
    expect(String(sql)).toMatch(/^CALL s1\.clearcensusattributes\((5|\?)\);?$/i);
  });

  it('400 when invalid type is provided', async () => {
    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=5&type=invalid'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    const text = await res.text();
    expect(text).toMatch(/Invalid census type/i);
  });

  it('400 when censusID is not a strict positive integer', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction');

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12abc&type=msmts'));

    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(begin).not.toHaveBeenCalled();
  });

  it('409 when the requested census is not the latest for its plot; rolls back after the locked guard without calling the procedure', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-409');
    const acquireLock = vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(true);
    const exec = vi
      .spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([{ PlotID: 1 }])
      .mockResolvedValueOnce([{ PlotID: 1, PlotCensusNumber: 1, MaxPlotCensusNumber: 2 }]);
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction');

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.CONFLICT);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[1][2]).toBe('tx-409');
    expect(acquireLock).toHaveBeenCalledWith('clear-census:myschema:1', 'tx-409', 0);
    expect(rollback).toHaveBeenCalledWith('tx-409');
    expect(commit).not.toHaveBeenCalled();
  });

  it('404 when the census does not exist; rolls back the guard transaction without calling the procedure', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-404');
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([]);
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction');

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.NOT_FOUND);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith('tx-404');
    expect(commit).not.toHaveBeenCalled();
  });

  it('409 when another clear holds the plot lock; it never runs the latest-census check or procedure', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-locked');
    const acquireLock = vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(false);
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([{ PlotID: 4 }]);
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction');

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.CONFLICT);
    expect(acquireLock).toHaveBeenCalledWith('clear-census:myschema:4', 'tx-locked', 0);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith('tx-locked');
    expect(commit).not.toHaveBeenCalled();
  });
});
