// app/api/postvalidationbyquery/[schema]/[plotID]/[censusID]/[queryID]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// ---- Import after mocks ----
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager'; // ---- Helpers ----

// ---- Mocks (must be declared before importing the route) ----

// Stable, shared ConnectionManager singleton
vi.mock('@/config/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/config/connectionmanager').catch(() => ({}) as any);

  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance()) ||
    actual?.default ||
    actual;

  const instance = (candidate &&
    typeof candidate.executeQuery === 'function' &&
    typeof candidate.beginTransaction === 'function' &&
    typeof candidate.commitTransaction === 'function' &&
    typeof candidate.rollbackTransaction === 'function' &&
    typeof candidate.closeConnection === 'function' &&
    candidate) || {
    executeQuery: vi.fn(async () => []),
    beginTransaction: vi.fn(async () => 'tx-mock'),
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

// Deterministic moment().format()
vi.mock('moment', () => {
  const mockMoment = vi.fn(() => ({
    format: vi.fn(() => '2025-01-02 03:04:05')
  }));
  // default export must be callable
  (mockMoment as any).default = mockMoment;
  return { default: mockMoment };
});

// Logger (not asserted)
vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

// ---- Helpers ----
function makeProps(schema?: string, plotID?: string, censusID?: string, queryID?: string) {
  return {
    params: Promise.resolve({
      schema: schema as any,
      plotID: plotID as any,
      censusID: censusID as any,
      queryID: queryID as any
    })
  } as any;
}

const dummyReq = new Request('http://localhost/api') as any;

describe('GET /api/postvalidationbyquery/[schema]/[plotID]/[censusID]/[queryID]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('400 when any param is missing/falsy', async () => {
    // missing schema
    let res = await GET(dummyReq, makeProps(undefined as any, '10', '20', '5'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);

    // plotID "0" -> parseInt => 0 (falsy)
    res = await GET(dummyReq, makeProps('myschema', '0', '20', '5'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);

    // censusID missing
    res = await GET(dummyReq, makeProps('myschema', '10', undefined as any, '5'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);

    // queryID missing
    res = await GET(dummyReq, makeProps('myschema', '10', '20', undefined as any));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
  });

  it('404 when QueryID not found; closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi
      .spyOn(cm, 'executeQuery')
      // First call: fetch QueryDefinition -> []
      .mockResolvedValueOnce([]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const res = await GET(dummyReq, makeProps('myschema', '10', '20', '5'));

    expect(res.status).toBe(HTTPResponses.NOT_FOUND);
    expect(exec).toHaveBeenCalledTimes(1);
    const [sql1] = exec.mock.calls[0];
    expect(String(sql1)).toMatch(/FROM myschema\.postvalidationqueries/i);
    expect(String(sql1)).toMatch(/WHERE QueryID = 5/i);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('200 on success: replaces ${schema|currentPlotID|currentCensusID}, runs update with timestamp+result, commits, closes', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-1');
    const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    // 1) get QueryDefinition
    exec.mockResolvedValueOnce([
      {
        QueryDefinition: 'SELECT * FROM ${schema}.some_table WHERE PlotID = ${currentPlotID} AND CensusID = ${currentCensusID}'
      }
    ]);
    // 2) run formatted query -> return rows
    exec.mockResolvedValueOnce([{ RowID: 1 }, { RowID: 2 }]);
    // 3) update LastRunAt/LastRunResult/LastRunStatus
    exec.mockResolvedValueOnce(undefined as any);

    const res = await GET(dummyReq, makeProps('myschema', '10', '20', '5'));
    expect(res.status).toBe(HTTPResponses.OK);

    // Check second exec call received the replaced SQL
    expect(exec).toHaveBeenCalledTimes(3);
    const formattedSQL = exec.mock.calls[1][0] as string;
    expect(formattedSQL).toMatch(/FROM myschema\.some_table/i);
    expect(formattedSQL).toMatch(/PlotID = 10/i);
    expect(formattedSQL).toMatch(/CensusID = 20/i);

    // Update statement (third call) has params [timestamp, JSON(results)]
    const [updateSQL, updateParams] = exec.mock.calls[2];
    expect(String(updateSQL)).toMatch(/UPDATE myschema\.postvalidationqueries/i);
    expect(String(updateSQL)).toMatch(/LastRunStatus = 'success'/i);
    expect(updateParams).toEqual(['2025-01-02 03:04:05', JSON.stringify([{ RowID: 1 }, { RowID: 2 }])]);

    expect(begin).toHaveBeenCalledWith();
    expect(commit).toHaveBeenCalledWith('tx-1');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("200 when query returns empty → marks 'failure', updates LastRunAt/LastRunStatus, rolls back tx, closes", async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-2');
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    // 1) QueryDefinition
    exec.mockResolvedValueOnce([{ QueryDefinition: 'SELECT * FROM ${schema}.t WHERE PlotID = ${currentPlotID} AND CensusID = ${currentCensusID}' }]);
    // 2) formatted query returns empty -> triggers throw "failure"
    exec.mockResolvedValueOnce([]);
    // 3) catch branch does UPDATE failure
    exec.mockResolvedValueOnce(undefined as any);

    const res = await GET(dummyReq, makeProps('myschema', '10', '20', '5'));
    expect(res.status).toBe(HTTPResponses.OK);

    // failure UPDATE call
    expect(exec).toHaveBeenCalledTimes(3);
    const [failureSQL, failureParams] = exec.mock.calls[2];
    expect(String(failureSQL)).toMatch(/UPDATE myschema\.postvalidationqueries/i);
    expect(String(failureSQL)).toMatch(/LastRunStatus = 'failure'/i);
    expect(failureParams).toEqual(['2025-01-02 03:04:05']);

    expect(begin).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith('tx-2');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('500 on unexpected error; rolls back (if tx id present) and closes', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-err');
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    // Fail early: throw when fetching QueryDefinition
    exec.mockRejectedValueOnce(new Error('db down'));

    const res = await GET(dummyReq, makeProps('myschema', '10', '20', '5'));
    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);

    // We never started a transaction yet, so rollback will be called with '' (per implementation),
    // or not called at all before beginTransaction (depending on code path). To be safe, assert called once.
    // In this endpoint, rollback is called in catch with transactionID ?? '' → so it is called.
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
