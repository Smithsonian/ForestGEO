import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// ===== import the handler AFTER mocks =====
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager';

// ===== hoisted spies/fixtures used by mocks =====
const { listBlobsIterable, getContainerClientMock, loggerInfo, loggerError } = vi.hoisted(() => {
  // helper to build an async iterable for listBlobsFlat
  function* _syncGen<T>(items: T[]) {
    for (const i of items) yield i as any;
  }
  const listBlobsIterable = (items: any[]) => ({
    async *[Symbol.asyncIterator]() {
      yield* _syncGen(items);
    }
  });

  return {
    listBlobsIterable,
    getContainerClientMock: vi.fn(),
    loggerInfo: vi.fn(),
    loggerError: vi.fn()
  };
});

// ===== Mocks (must be before importing the route) =====

// Wrap ConnectionManager so getInstance() always returns a usable instance
vi.mock('@/config/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/config/connectionmanager').catch(() => ({}) as any);

  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance()) ||
    actual?.default ||
    actual;

  const instance = (candidate && typeof candidate.executeQuery === 'function' && candidate) || {
    executeQuery: vi.fn(async () => []),
    beginTransaction: vi.fn(async () => 'tx'), // not used, harmless
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

// Azure Storage client
vi.mock('@/config/macros/azurestorage', () => ({
  getContainerClient: getContainerClientMock
}));

// Logger
vi.mock('@/ailogger', () => ({
  default: { info: loggerInfo, error: loggerError, warn: vi.fn() }
}));

// ===== helpers =====
function makeProps(metric?: string, schema?: string, plotIDParam?: string, censusIDParam?: string, plot?: string) {
  return {
    params: Promise.resolve({
      metric: metric as any,
      schema: schema as any,
      plotIDParam: plotIDParam as any,
      censusIDParam: censusIDParam as any
    }),
    request: makeRequest(plot)
  } as any;
}

function makeRequest(plot?: string) {
  const url = new URL('http://localhost/api');
  if (plot) url.searchParams.set('plot', plot);
  const req: any = new Request(url.toString(), { method: 'GET' });
  req.nextUrl = url;
  return req as any;
}

// convenience to call GET with (metric, schema, plotID, censusID, plotName)
async function callGET(metric: string, schema: string, plotID: string, censusID: string, plotName: string) {
  const props = { params: Promise.resolve({ metric, schema, plotIDParam: plotID, censusIDParam: censusID }) } as any;
  const req = makeRequest(plotName);
  // route signature is (request, props)
  return GET(req, props);
}

describe('GET /api/dashboardmetrics/[metric]/[schema]/[plotIDParam]/[censusIDParam]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when missing core slugs (including plot search param)', async () => {
    // missing plot name (?plot=)
    const res1 = await callGET('CountTrees', 's1', '1', '2', '');
    expect(res1.status).toBe(HTTPResponses.BAD_REQUEST);
    const body1 = await res1.json();
    expect(body1.error).toMatch(/Plot name.*required/i);

    // missing metric
    const props = { params: Promise.resolve({ metric: undefined as any, schema: 's1', plotIDParam: '1', censusIDParam: '2' }) } as any;
    const res2 = await GET(makeRequest('PlotX'), props);
    expect(res2.status).toBe(HTTPResponses.BAD_REQUEST);
    const body2 = await res2.json();
    expect(body2.error).toMatch(/Metric.*required/i);
  });

  it('CountActiveUsers: returns 200 and proper JSON; builds expected SQL + params', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([{ PersonnelCount: 5 }]);

    const res = await callGET('CountActiveUsers', 'myschema', '42', '7', 'MyPlot');

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body).toEqual({ CountActiveUsers: 5 });

    expect(exec).toHaveBeenCalledTimes(1);
    const [sql, params] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/FROM myschema\.personnel p/i);
    expect(String(sql)).toMatch(/JOIN myschema\.censusactivepersonnel cap/i);
    expect(String(sql)).toMatch(/WHERE c\.CensusID = \? AND c\.PlotID = \?/i);
    expect(params).toEqual([7, 42]);
  });

  it('ProgressTachometer: returns expected aggregate fields and 200', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([
      {
        total_quadrats: 16,
        populated_quadrats: 12,
        populated_pct: 75.0,
        unpopulated_quadrats: 'Q13;Q14;Q15;Q16'
      }
    ]);

    const res = await callGET('ProgressTachometer', 'myschema', '3', '9', 'PlotZ');

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body).toEqual({
      TotalQuadrats: 16,
      PopulatedQuadrats: 12,
      PopulatedPercent: 75.0,
      UnpopulatedQuadrats: 'Q13;Q14;Q15;Q16'
    });

    const [sql, params] = (exec as any).mock.calls[0];
    expect(String(sql)).toMatch(/WITH measured_quads AS/i);
    expect(String(sql)).toMatch(/FROM myschema\.quadrats q/i);
    expect(params).toEqual([9, 3, 3]); // censusID, plotID, plotID
  });

  it('FilesUploaded: lists blobs, maps metadata, returns 200', async () => {
    // Arrange container with two blobs
    getContainerClientMock.mockResolvedValueOnce({
      listBlobsFlat: () =>
        listBlobsIterable([
          {
            name: 'file1.csv',
            metadata: { user: 'alice', FormType: 'trees', FileErrorState: JSON.stringify([{ row: 1, msg: 'oops' }]) },
            properties: { lastModified: new Date('2025-08-01T12:00:00Z') }
          },
          {
            name: 'file2.csv',
            metadata: { user: 'bob', FormType: 'stems' }, // no error state
            properties: { lastModified: new Date('2025-08-02T12:00:00Z') }
          }
        ])
    });

    const res = await callGET('FilesUploaded', 'myschema', '1', '2', 'MyPlot');

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body).toHaveProperty('FilesUploaded');
    expect(Array.isArray(body.FilesUploaded)).toBe(true);
    expect(body.FilesUploaded).toHaveLength(2);

    // First blob mapped
    expect(body.FilesUploaded[0]).toMatchObject({
      key: 1,
      name: 'file1.csv',
      user: 'alice',
      formType: 'trees',
      fileErrors: [{ row: 1, msg: 'oops' }]
      // date present, but don't assert equality on Date serialization
    });

    // Second blob mapped (no FileErrorState => empty string)
    expect(body.FilesUploaded[1]).toMatchObject({
      key: 2,
      name: 'file2.csv',
      user: 'bob',
      formType: 'stems',
      fileErrors: ''
    });

    // Called correct container name "<plot>-<censusID>"
    expect(getContainerClientMock).toHaveBeenCalledWith('MyPlot-2');
  });

  it('CountTrees: 200 and proper JSON; SQL + params sanity', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([{ CountTrees: 123 }]);

    const res = await callGET('CountTrees', 'myschema', '11', '22', 'P1');

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body).toEqual({ CountTrees: 123 });

    const [sql, params] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/FROM myschema\.trees t JOIN myschema\.census c/i);
    expect(String(sql)).toMatch(/WHERE t\.CensusID = \? AND c\.PlotID = \?/i);
    expect(params).toEqual([22, 11]);
  });

  it('CountStems: 200 and proper JSON; SQL + params sanity', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([{ CountStems: 456 }]);

    const res = await callGET('CountStems', 'myschema', '8', '99', 'P2');

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body).toEqual({ CountStems: 456 });

    const [sql, params] = exec.mock.calls[0];
    expect(String(sql)).toMatch(/FROM myschema\.stems st JOIN myschema\.census c/i);
    expect(String(sql)).toMatch(/WHERE st\.CensusID = \? AND c\.PlotID = \?/i);
    expect(params).toEqual([99, 8]);
  });

  it('unknown metric: returns 200 with empty object', async () => {
    const res = await callGET('TotallyUnknown', 'sch', '1', '2', 'PlotA');
    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body).toEqual({});
  });

  it('on DB error: returns 500 (INTERNAL_SERVER_ERROR)', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'executeQuery').mockRejectedValueOnce(new Error('boom'));

    const res = await callGET('CountTrees', 'sch', '5', '6', 'PlotX');
    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    const body = await res.json();
    expect(body.error).toMatch(/Failed to retrieve metrics/i);
  });
});
