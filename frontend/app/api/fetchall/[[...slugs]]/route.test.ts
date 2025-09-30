// app/api/fetchall/[[...slugs]]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// ========== Import route AFTER mocks ==========
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager'; // ========== Helpers ==========

// ========== Hoisted spies/fixtures used by mocks ==========
const { getCookieMock, mapDataSpy, getMapperSpy, loggerErr } = vi.hoisted(() => ({
  getCookieMock: vi.fn(),
  mapDataSpy: vi.fn((rows: any[]) => rows.map(r => ({ ...r, mapped: true }))),
  getMapperSpy: vi.fn((_name: string) => ({ mapData: (rows: any[]) => (mapDataSpy as any)(rows) })),
  loggerErr: vi.fn()
}));

// ========== Mocks (must be BEFORE importing the route) ==========

// Ensure ConnectionManager.getInstance() returns the shared mock instance
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

// MapperFactory -> return our spy
vi.mock('@/config/datamapper', () => ({
  default: { getMapper: getMapperSpy }
}));

// Cookies
vi.mock('@/app/actions/cookiemanager', () => ({
  getCookie: getCookieMock
}));

// Logger
vi.mock('@/ailogger', () => ({
  default: { error: loggerErr, info: vi.fn(), warn: vi.fn() }
}));

// ========== Helpers ==========
function makeRequest(schema?: string) {
  const url = new URL('http://localhost/api/fetchall');
  if (schema) url.searchParams.set('schema', schema);
  const req: any = new Request(url.toString(), { method: 'GET' });
  req.nextUrl = url; // Next.js handler reads request.nextUrl
  return req as any;
}
function makeProps(slugs?: string[]) {
  return { params: Promise.resolve({ slugs }) } as any;
}

// Small cookie setup helper
function primeCookies({
  censusList = [{ plotCensusNumber: 7, dateRanges: [{ censusID: 7 }] }],
  plotID = '42',
  censusID = '7'
}: {
  censusList?: any[];
  plotID?: string;
  censusID?: string;
} = {}) {
  getCookieMock.mockImplementation(async (name: string) => {
    switch (name) {
      case 'censusList':
        return JSON.stringify(censusList);
      case 'plotID':
        return plotID;
      case 'censusID':
        return censusID;
      default:
        return undefined;
    }
  });
}

describe('GET /api/fetchall/[[...slugs]]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // sensible cookie defaults for tests that rely on stored values
    primeCookies();
  });

  it('returns 400 error when schema missing/undefined', async () => {
    // No ?schema
    const res1 = await GET(makeRequest(undefined), makeProps(['trees', '1', '1']));
    expect(res1.status).toBe(HTTPResponses.BAD_REQUEST);
    const body1 = await res1.json();
    expect(body1.error).toMatch(/schema.*selection/i);

    // schema=undefined
    const req = makeRequest('undefined');
    const res2 = await GET(req, makeProps(['trees', '1', '1']));
    expect(res2.status).toBe(HTTPResponses.BAD_REQUEST);
    const body2 = await res2.json();
    expect(body2.error).toMatch(/schema.*selection/i);

    // closeConnection is not called when validation fails early
  });

  it('returns 400 error when slugs are missing/incomplete', async () => {
    const close = vi.spyOn((ConnectionManager as any).getInstance(), 'closeConnection').mockResolvedValue(undefined);
    const req = makeRequest('myschema');
    const res = await GET(req, makeProps(undefined as any));
    expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
    const body = await res.json();
    expect(body.error).toMatch(/Data type not specified/i);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('stems: uses stored plotID/census from cookies and returns mapped results', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([{ StemGUID: 1 }, { StemGUID: 2 }]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const req = makeRequest('myschema');
    const res = await GET(req, makeProps(['stems', '999', '999'])); // provided slugs are ignored in favor of cookies

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body).toEqual([
      { StemGUID: 1, mapped: true },
      { StemGUID: 2, mapped: true }
    ]);

    // SQL + params sanity: uses stored 42,7
    expect(exec).toHaveBeenCalledTimes(1);
    const [sql, params] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/FROM myschema\.stems st\s+JOIN myschema\.census c/i);
    expect(String(sql)).toMatch(/c\.PlotID = \? AND c\.PlotCensusNumber = \?/i);
    expect(params).toEqual([42, 7]);

    expect(getMapperSpy).toHaveBeenCalledWith('stems');
    expect(mapDataSpy).toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('trees: mirrors stems path and mapping', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([{ TreeID: 9 }]);
    const req = makeRequest('myschema');

    const res = await GET(req, makeProps(['trees', '1', '2']));
    expect(res.status).toBe(HTTPResponses.OK);
    expect(await res.json()).toEqual([{ TreeID: 9, mapped: true }]);

    const [sql] = (cm.executeQuery as any).mock.calls[0];
    expect(String(sql)).toMatch(/FROM myschema\.trees st\s+JOIN myschema\.census c/i);
  });

  it('plots: selects plots with quadrat count; maps results; closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([{ PlotID: 1, NumQuadrats: 16 }]);
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const req = makeRequest('myschema');
    const res = await GET(req, makeProps(['plots', '1', '2']));

    expect(res.status).toBe(HTTPResponses.OK);
    expect(await res.json()).toEqual([{ PlotID: 1, NumQuadrats: 16, mapped: true }]);

    const [sql] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/SELECT p\.\*, COUNT\(q\.QuadratID\) AS NumQuadrats\s+FROM myschema\.plots p/i);
    expect(String(sql)).toMatch(/LEFT JOIN myschema\.quadrats q/i);
    expect(String(sql)).toMatch(/GROUP BY p\.PlotID/i);

    expect(getMapperSpy).toHaveBeenCalledWith('plots');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('personnel: passes stored PCN/plotID as params; maps results', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([{ PersonnelID: 5, CensusActive: 1 }]);

    const req = makeRequest('myschema');
    const res = await GET(req, makeProps(['personnel', '123', '321']));

    expect(res.status).toBe(HTTPResponses.OK);
    expect(await res.json()).toEqual([{ PersonnelID: 5, CensusActive: 1, mapped: true }]);

    const [sql, params] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/FROM myschema\.personnel p;?$/i);
    expect(params).toEqual([7, 42]); // storedPCN, storedPlotID
  });

  it('census: runs UPDATE then SELECT by stored PlotID; maps results', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery');
    // First call: UPDATE (no rows asserted)
    exec.mockResolvedValueOnce(undefined as any);
    // Second call: SELECT
    exec.mockResolvedValueOnce([{ CensusID: 11, StartDate: '2024-01-01', EndDate: '2024-12-31' }]);

    const req = makeRequest('myschema');
    const res = await GET(req, makeProps(['census', '0', '0']));

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body).toEqual([{ CensusID: 11, StartDate: '2024-01-01', EndDate: '2024-12-31', mapped: true }]);

    expect(exec).toHaveBeenCalledTimes(2);
    const [sql1] = exec.mock.calls[0];
    const [sql2, params2] = exec.mock.calls[1];
    expect(String(sql1)).toMatch(/^UPDATE myschema\.census c/i);
    expect(String(sql2)).toMatch(/^SELECT \* FROM myschema\.census WHERE PlotID = \?/i);
    expect(params2).toEqual([42]);
  });

  it('default branch: generic SELECT * FROM schema.table; maps results', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([{ A: 1 }, { A: 2 }]);

    const req = makeRequest('myschema');
    const res = await GET(req, makeProps(['randomtable', '1', '2']));

    expect(res.status).toBe(HTTPResponses.OK);
    expect(await res.json()).toEqual([
      { A: 1, mapped: true },
      { A: 2, mapped: true }
    ]);

    expect(getMapperSpy).toHaveBeenCalledWith('randomtable');
  });

  it('on DB error: logs via ailogger.error and returns 500 error; always closes connection', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('kaboom'));
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const req = makeRequest('myschema');
    const res = await GET(req, makeProps(['plots', '1', '2']));

    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    const body = await res.json();
    expect(body.error).toBe('kaboom');
    expect(loggerErr).toHaveBeenCalled(); // ailogger.error('Error:', error)
    expect(close).toHaveBeenCalledTimes(1);
  });
});
