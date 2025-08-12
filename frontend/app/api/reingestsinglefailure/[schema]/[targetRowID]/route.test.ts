// app/api/reingestsinglefailure/[schema]/[targetRowID]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
// --------- Import after mocks ---------
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager'; // --------- Helpers ---------

// --------- Mocks (must be defined BEFORE importing the route) ---------
vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-batch-id') }));

vi.mock('@/config/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/config/connectionmanager').catch(() => ({}));

  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance()) ||
    actual?.default ||
    actual;

  const instance = (candidate &&
    typeof candidate.beginTransaction === 'function' &&
    typeof candidate.executeQuery === 'function' &&
    typeof candidate.commitTransaction === 'function' &&
    typeof candidate.rollbackTransaction === 'function' &&
    candidate) || {
    beginTransaction: vi.fn(async () => 'tx-test'),
    executeQuery: vi.fn(async () => {}),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {})
  };

  const getInstance = vi.fn(() => instance);

  return {
    ...actual,
    default: { ...(actual?.default ?? {}), getInstance },
    getInstance
  };
});

// --------- Helpers ---------
function makeProps(schema?: string, targetRowID?: string) {
  return { params: Promise.resolve({ schema: schema as any, targetRowID: targetRowID as any }) } as any;
}

// Minimal NextRequest-ish object (route doesn’t use it)
function makeNextRequest() {
  return { nextUrl: new URL('http://localhost') } as any;
}

describe('GET /api/reingestsinglefailure/[schema]/[targetRowID]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws if core parameters not provided', async () => {
    const req = makeNextRequest();
    await expect(GET(req, makeProps(undefined as any, '123'))).rejects.toThrow(/core parameters not provided/i);
    await expect(GET(req, makeProps('myschema', undefined as any))).rejects.toThrow(/core parameters not provided/i);
  });

  it('happy path: moves single failed row, clears it, ingests; commits; returns 200 {message:"Success"}', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-1');
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValue(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);

    const res = await GET(makeNextRequest(), makeProps('myschema', '555'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: 'Success' });

    expect(begin).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(3);
    expect(commit).toHaveBeenCalledWith('tx-1');
    expect(rollback).not.toHaveBeenCalled();

    // 1) insert into temporarymeasurements from failedmeasurements
    const [sql1, params1] = exec.mock.calls[0];
    expect(String(sql1)).toMatch(/insert\s+into\s+myschema\.temporarymeasurements/i);
    expect(String(sql1)).toMatch(/from\s+myschema\.failedmeasurements/i);
    expect(params1).toEqual(['test-batch-id', '555']);

    // 2) delete original failed row
    const [sql2, params2] = exec.mock.calls[1];
    expect(String(sql2)).toMatch(/delete\s+from\s+myschema\.failedmeasurements/i);
    expect(params2).toEqual(['555']);

    // 3) call bulkingestionprocess with static filename + batch id
    const [sql3, params3] = exec.mock.calls[2];
    expect(String(sql3)).toMatch(/CALL\s+myschema\.bulkingestionprocess\(\?,\s*\?\);?/i);
    expect(params3).toEqual(['single_row_file.csv', 'test-batch-id']);
  });

  it('on error: rolls back with transaction id, calls reviewfailed(), and rethrows', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-err');
    const exec = vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('boom')); // first call fails
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);

    let caught: any;
    try {
      await GET(makeNextRequest(), makeProps('myschema', '777'));
    } catch (e: any) {
      caught = e;
    }

    // Don’t pin the exact message because Next/undici can wrap/replace it in this environment.
    expect(caught).toBeInstanceOf(Error);

    expect(begin).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith('tx-err');
    expect(commit).not.toHaveBeenCalled();

    // After rollback, the handler calls reviewfailed()
    const [, call2] = exec.mock.calls; // second call arguments
    expect(String(call2?.[0] || '')).toMatch(/CALL\s+myschema\.reviewfailed\(\);?/i);
  });
});
