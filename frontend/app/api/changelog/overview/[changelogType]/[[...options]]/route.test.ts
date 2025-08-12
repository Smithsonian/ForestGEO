import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// ========== Import the module under test AFTER mocks ==========
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager'; // ========== Helpers ==========

// ========== Hoisted spies (used by mocks below) ==========
const { mapDataSpy, getMapperSpy } = vi.hoisted(() => {
  const mapDataSpy = vi.fn((rows: any[]) => rows.map(r => ({ ...r, mapped: true })));
  const getMapperSpy = vi.fn(() => ({ mapData: mapDataSpy }));
  return { mapDataSpy, getMapperSpy };
});

// ========== Mocks (must come BEFORE importing the route) ==========

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

// MapperFactory mock (uses hoisted spies)
vi.mock('@/config/datamapper', () => ({
  default: { getMapper: getMapperSpy }
}));

// Logger (optional here; mocked to avoid real logging)
vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

// ========== Helpers ==========
function makeProps(changelogType?: string, options?: string[]) {
  return { params: Promise.resolve({ changelogType: changelogType as any, options }) } as any;
}
function makeRequest(url: string) {
  const req: any = new Request(url);
  // The handler reads request.nextUrl.searchParams.get('schema')
  req.nextUrl = new URL(url);
  return req as any;
}

// ========== Tests ==========
describe('GET /api/changelog/overview/[changelogType]/[[...options]]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws if schema missing', async () => {
    const req = makeRequest('http://localhost/api'); // no ?schema=
    await expect(GET(req, makeProps('unifiedchangelog', ['1', '2']))).rejects.toThrow(/schema not found/i);
  });

  it('throws if changelogType missing', async () => {
    const req = makeRequest('http://localhost/api?schema=myschema');
    await expect(GET(req, makeProps(undefined as any, ['1', '2']))).rejects.toThrow(/changelogType not provided/i);
  });

  it('throws if options missing', async () => {
    const req = makeRequest('http://localhost/api?schema=myschema');
    await expect(GET(req, makeProps('unifiedchangelog', undefined as any))).rejects.toThrow(/options not provided/i);
  });

  it('throws if options length !== 2', async () => {
    const req = makeRequest('http://localhost/api?schema=myschema');
    await expect(GET(req, makeProps('unifiedchangelog', ['1']))).rejects.toThrow(/Missing plot id or census id/i);
  });

  it('unifiedchangelog: 200 with mapped results; builds expected SQL; closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([
      { ChangeID: 1, PlotID: 42, CensusID: 7 },
      { ChangeID: 2, PlotID: null, CensusID: null }
    ]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const req = makeRequest('http://localhost/api?schema=myschema');
    const res = await GET(req, makeProps('unifiedchangelog', ['42', '7']));

    expect(res.status).toBe(HTTPResponses.OK);

    const body = await res.json();
    expect(body).toEqual([
      { ChangeID: 1, PlotID: 42, CensusID: 7, mapped: true },
      { ChangeID: 2, PlotID: null, CensusID: null, mapped: true }
    ]);

    // SQL + params sanity
    expect(exec).toHaveBeenCalledTimes(1);
    const [sql, params] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/SELECT \* FROM myschema\.unifiedchangelog/i);
    expect(String(sql)).toMatch(/WHERE \(PlotID = \? OR PlotID IS NULL\)/i);
    expect(String(sql)).toMatch(/ORDER BY ChangeTimestamp DESC\s+LIMIT 5;?/i);
    expect(params).toEqual([42, 42, 7]); // plotID, plotID, pcn

    // mapper used
    expect(getMapperSpy).toHaveBeenCalledWith('unifiedchangelog');
    expect(mapDataSpy).toHaveBeenCalled();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('unifiedchangelog: 200 with empty body when no rows; mapper not called; closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const req = makeRequest('http://localhost/api?schema=myschema');
    const res = await GET(req, makeProps('unifiedchangelog', ['10', '3']));

    expect(res.status).toBe(HTTPResponses.OK);
    // When NextResponse is created with `null` body, text() is empty
    const text = await res.text();
    expect(text).toBe('');

    expect(getMapperSpy).not.toHaveBeenCalled();
    expect(mapDataSpy).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('validationchangelog: 200 with mapped results; uses correct table; closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([{ RunID: 1 }, { RunID: 2 }]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const req = makeRequest('http://localhost/api?schema=myschema');
    const res = await GET(req, makeProps('validationchangelog', ['42', '7']));

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body).toEqual([
      { RunID: 1, mapped: true },
      { RunID: 2, mapped: true }
    ]);

    const [sql, params] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/FROM myschema\.validationchangelog/i);
    expect(String(sql)).toMatch(/ORDER BY RunDateTime DESC LIMIT 5;?/i);
    // The route still passes params array even if not used in the SQL
    expect(params).toEqual([42, 42, 7]);

    expect(getMapperSpy).toHaveBeenCalledWith('validationchangelog');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('propagates SQL errors (rejects) and still closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('boom'));
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const req = makeRequest('http://localhost/api?schema=myschema');
    await expect(GET(req, makeProps('unifiedchangelog', ['1', '2']))).rejects.toThrow(/SQL query failed: boom/i);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
