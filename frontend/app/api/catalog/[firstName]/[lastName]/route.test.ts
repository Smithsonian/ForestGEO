import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// -----------------------------------------------------------
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger'; // Helpers

// ---- Install mocks/wrappers BEFORE importing the route ----

// Wrap ConnectionManager so getInstance() is guaranteed while preserving your setup singleton
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

// Logger spy
vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

// -----------------------------------------------------------

// Helpers
function makeParams(firstName?: string, lastName?: string) {
  return { params: Promise.resolve({ firstName: firstName as any, lastName: lastName as any }) } as any;
}
function makeRequest(url = 'http://localhost/api') {
  const req: any = new Request(url);
  // For error path, the handler calls request.nextUrl.toJSON()
  req.nextUrl = { toJSON: () => url };
  return req as any;
}

describe('GET /api/catalog/[firstName]/[lastName]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws if firstName or lastName missing (pre-try/catch)', async () => {
    const req = makeRequest();
    // Missing lastName
    await expect(GET(req, makeParams('Ada', undefined as any))).rejects.toThrow(/no first or last name provided/i);
    // Missing firstName
    await expect(GET(req, makeParams(undefined as any, 'Lovelace'))).rejects.toThrow(/no first or last name provided/i);
  });

  it('200 when user exists and returns the UserID', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([{ UserID: 123 }]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const req = makeRequest('http://localhost/api/catalog/Ada/Lovelace');
    const res = await GET(req, makeParams('Ada', 'Lovelace'));

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body).toBe(123);

    // SQL + params sanity
    expect(exec).toHaveBeenCalledTimes(1);
    const [sql, params] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/SELECT\s+UserID\s+FROM\s+catalog\.users/i);
    expect(params).toEqual(['Ada', 'Lovelace']);

    // ensure connection closed
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('500 and logs when user not found', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([]); // no rows
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const req = makeRequest('http://localhost/api/catalog/Grace/Hopper');
    const res = await GET(req, makeParams('Grace', 'Hopper'));

    expect(exec).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);

    const body = await res.json();
    expect(body.error).toMatch(/User not found/i);

    // logger called with message and endpoint
    const logErr = (ailogger as any).error as ReturnType<typeof vi.fn>;
    expect(logErr).toHaveBeenCalled();
    const [msg, errMessage, meta] = logErr.mock.calls[0];
    expect(String(msg)).toMatch(/Error in GET request/i);
    expect(String(errMessage)).toMatch(/User not found/i);
    expect(meta).toMatchObject({ endpoint: expect.stringContaining('/api/catalog/Grace/Hopper') });

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('500 and logs when DB error occurs', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('boom'));
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const req = makeRequest('http://localhost/api/catalog/Marie/Curie');
    const res = await GET(req, makeParams('Marie', 'Curie'));

    expect(exec).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);

    const body = await res.json();
    expect(body.error).toMatch(/boom/i);

    const logErr = (ailogger as any).error as ReturnType<typeof vi.fn>;
    expect(logErr).toHaveBeenCalled();
    const [msg, errMessage, meta] = logErr.mock.calls[0];
    expect(String(msg)).toMatch(/Error in GET request/i);
    expect(String(errMessage)).toMatch(/boom/i);
    expect(meta).toMatchObject({ endpoint: expect.stringContaining('/api/catalog/Marie/Curie') });

    expect(close).toHaveBeenCalledTimes(1);
  });
});
