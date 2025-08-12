// app/api/postvalidation/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// ---- Import the route under test AFTER mocks ----
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager'; // ---- Helpers ----

// ---- Mocks (must be declared before importing the route) ----
vi.mock('@/config/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/config/connectionmanager').catch(() => ({}) as any);

  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance()) ||
    actual?.default ||
    actual;

  const instance = (candidate && typeof candidate.executeQuery === 'function' && typeof candidate.closeConnection === 'function' && candidate) || {
    executeQuery: vi.fn(async () => []),
    closeConnection: vi.fn(async () => {})
  };

  const getInstance = vi.fn(() => instance);

  return {
    ...actual,
    default: { ...(actual?.default ?? {}), getInstance },
    getInstance
  };
});

// Logger (not asserted here, but keeps calls safe)
vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

// ---- Helpers ----
function makeRequest(url: string) {
  const req: any = new Request(url);
  // next/server’s NextRequest has .nextUrl; we stub it with a real URL for searchParams
  req.nextUrl = new URL(url);
  return req as any;
}

describe('GET /api/postvalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws if schema is missing', async () => {
    const req = makeRequest('http://localhost/api/postvalidation'); // no ?schema=
    await expect(GET(req)).rejects.toThrow(/no schema variable provided/i);
  });

  it('404 when no queries found; closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const req = makeRequest('http://localhost/api/postvalidation?schema=myschema');
    const res = await GET(req);

    expect(res.status).toBe(HTTPResponses.NOT_FOUND);
    const body = await res.json();
    expect(body).toEqual({ message: 'No queries found' });

    expect(exec).toHaveBeenCalledTimes(1);
    const [sql] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/FROM myschema\.postvalidationqueries\b/i);
    expect(String(sql)).toMatch(/IsEnabled IS TRUE/i);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('200 with mapped results; closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([
      { QueryID: 1, QueryName: 'Q1', Description: 'Desc 1' },
      { QueryID: 2, QueryName: 'Q2', Description: 'Desc 2' }
    ]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const req = makeRequest('http://localhost/api/postvalidation?schema=myschema');
    const res = await GET(req);

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body).toEqual([
      { queryID: 1, queryName: 'Q1', queryDescription: 'Desc 1' },
      { queryID: 2, queryName: 'Q2', queryDescription: 'Desc 2' }
    ]);

    expect(exec).toHaveBeenCalledTimes(1);
    const [sql] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/SELECT QueryID, QueryName, Description FROM myschema\.postvalidationqueries/i);
    expect(String(sql)).toMatch(/IsEnabled IS TRUE/i);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('propagates DB errors and still closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('boom'));
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const req = makeRequest('http://localhost/api/postvalidation?schema=myschema');
    await expect(GET(req)).rejects.toThrow(/boom/i);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
