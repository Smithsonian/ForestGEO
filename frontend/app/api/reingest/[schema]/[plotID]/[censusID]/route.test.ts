import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// ---------- Import after mocks ----------
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager';

// ---------- Mocks (must be BEFORE importing the route) ----------
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
    typeof candidate.closeConnection === 'function' &&
    candidate) || {
    beginTransaction: vi.fn(async () => 'tx-test'),
    executeQuery: vi.fn(async () => []),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    closeConnection: vi.fn(async () => {})
  };

  const getInstance = vi.fn(() => instance);

  return {
    ...actual,
    default: { ...(actual?.default ?? {}), getInstance },
    getInstance
  };
});

// ---------- Helpers ----------
function makeProps(schema?: string, plotID?: string, censusID?: string) {
  return { params: Promise.resolve({ schema: schema as any, plotID: plotID as any, censusID: censusID as any }) } as any;
}

// Minimal NextRequest-ish object (handler doesn't use it anyway)
function makeNextRequest() {
  return { nextUrl: new URL('http://localhost') } as any;
}

describe('GET /api/reingest/[schema]/[plotID]/[censusID]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws if any of schema/plotID/censusID missing', async () => {
    const req = makeNextRequest();
    await expect(GET(req, makeProps(undefined as any, '1', '2'))).rejects.toThrow(/schema or plotID or censusID not provided/i);
    await expect(GET(req, makeProps('myschema', undefined as any, '2'))).rejects.toThrow(/schema or plotID or censusID not provided/i);
    await expect(GET(req, makeProps('myschema', '1', undefined as any))).rejects.toThrow(/schema or plotID or censusID not provided/i);
  });

  it('happy path: truncates temp, shifts rows, deletes failed, calls proc; commits & returns 200', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-1');
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValue(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);

    const res = await GET(makeNextRequest(), makeProps('myschema', '42', '7'));

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body).toMatchObject({ responseMessage: 'Processing procedure executed' });

    expect(begin).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(4);
    expect(commit).toHaveBeenCalledWith('tx-1');
    expect(rollback).not.toHaveBeenCalled();

    // truncate
    const [sql1, params1] = exec.mock.calls[0];
    expect(String(sql1)).toMatch(/^truncate\s+myschema\.temporarymeasurements/i);
    expect(params1).toBeUndefined();

    // shift insert
    const [sql2, params2] = exec.mock.calls[1];
    expect(String(sql2)).toMatch(/INSERT\s+IGNORE\s+INTO\s+myschema\.temporarymeasurements/i);
    expect(String(sql2)).toMatch(/FROM\s+myschema\.failedmeasurements\s+fm/i);
    expect(params2).toEqual(['reingestion.csv', 'test-batch-id', '42', '7']);

    // delete failed
    const [sql3, params3] = exec.mock.calls[2];
    expect(String(sql3)).toMatch(/delete\s+from\s+myschema\.failedmeasurements\s+where\s+PlotID\s*=\s*\?\s+and\s+CensusID\s*=\s*\?/i);
    expect(params3).toEqual(['42', '7']);

    // call proc
    const [sql4, params4] = exec.mock.calls[3];
    expect(String(sql4)).toMatch(/CALL\s+myschema\.bulkingestionprocess\(\?,\s*\?\)/i);
    expect(params4).toEqual(['reingestion.csv', 'test-batch-id']);
  });

  it('on error: rolls back with transaction id and returns 500 JSON { error }', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-err');
    const exec = vi
      .spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce(undefined) // truncate ok
      .mockRejectedValueOnce(new Error('boom')); // fails on shift insert
    const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);

    const res = await GET(makeNextRequest(), makeProps('myschema', '42', '7'));

    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'boom' });

    expect(exec).toHaveBeenCalledTimes(2);
    expect(rollback).toHaveBeenCalledWith('tx-err');
    expect(commit).not.toHaveBeenCalled();
  });
});
