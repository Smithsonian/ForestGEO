// frontend/app/api/formatrunquery/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// After mocks, import the route
import { POST } from './route';
import ConnectionManager from '@/config/connectionmanager'; // --- Helpers ---

// --- Mocks (placed BEFORE importing the route) ---

// ConnectionManager: keep your shared singleton shape but guarantee getInstance()
vi.mock('@/config/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/config/connectionmanager').catch(() => ({}) as any);

  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance()) ||
    actual?.default ||
    actual;

  const instance = (candidate && typeof candidate.executeQuery === 'function' && candidate) || {
    executeQuery: vi.fn(async () => [])
  };

  const getInstance = vi.fn(() => instance);

  return {
    ...actual,
    default: { ...(actual?.default ?? {}), getInstance },
    getInstance
  };
});

// Make mysql2/promise.format deterministic so we can assert exactly what was executed
vi.mock('mysql2/promise', () => {
  const format = (sql: string, params?: any[]) => `FORMATTED_SQL:${sql}::PARAMS:${JSON.stringify(params ?? [])}`;
  return { format };
});

// --- Helpers ---
function makeRequest(body: any) {
  return new Request('http://localhost/api/formatrunquery', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }) as any;
}

describe('POST /api/formatrunquery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats the query with params, executes it, and returns 200 with JSON', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([{ ok: true, rows: 2 }]);

    const req = makeRequest({
      query: 'SELECT * FROM mytable WHERE a=? AND b IN (?)',
      params: [1, [2, 3]]
    });

    const res = await POST(req);

    expect(res.status).toBe(HTTPResponses.OK);
    expect(res.headers.get('content-type')?.toLowerCase()).toContain('application/json');

    // ensure we executed the formatted string
    expect(exec).toHaveBeenCalledTimes(1);
    const [formatted] = exec.mock.calls[0];
    expect(formatted).toBe('FORMATTED_SQL:SELECT * FROM mytable WHERE a=? AND b IN (?)::PARAMS:[1,[2,3]]');

    const body = await res.json();
    expect(body).toEqual([{ ok: true, rows: 2 }]);
  });

  it('works when params are omitted (undefined) and still formats deterministically', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([{ id: 1 }]);

    const req = makeRequest({
      query: 'SELECT 1 AS x'
      // no params provided
    });

    const res = await POST(req);

    expect(res.status).toBe(HTTPResponses.OK);
    const [formatted] = exec.mock.calls[0];
    expect(formatted).toBe('FORMATTED_SQL:SELECT 1 AS x::PARAMS:[]');

    expect(await res.json()).toEqual([{ id: 1 }]);
  });

  it('propagates DB errors (rejects) when executeQuery fails', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('boom'));

    await expect(
      POST(
        makeRequest({
          query: 'SELECT * FROM t WHERE x=?',
          params: [9]
        })
      )
    ).rejects.toThrow(/boom/i);
  });
});
