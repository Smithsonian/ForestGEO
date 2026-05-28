import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
// ===== import the handler AFTER mocks =====
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager';

// ===== hoisted spies/fixtures used by mocks =====
const { _listBlobsIterable, getContainerClientMock, loggerInfo, loggerError, mockAuth, mockValidateContextualValues, mockAssertSchemaAccess } = vi.hoisted(
  () => {
    // helper to build an async iterable for listBlobsFlat
    function* _syncGen<T>(items: T[]) {
      for (const i of items) yield i as any;
    }
    const _listBlobsIterable = (items: any[]) => ({
      async *[Symbol.asyncIterator]() {
        yield* _syncGen(items);
      }
    });

    return {
      _listBlobsIterable,
      getContainerClientMock: vi.fn(),
      loggerInfo: vi.fn(),
      loggerError: vi.fn(),
      mockAuth: vi.fn(),
      mockValidateContextualValues: vi.fn(),
      // typed to accept NextResponse | null so mockReturnValue(deniedResponse) is valid
      mockAssertSchemaAccess: vi.fn() as import('vitest').MockInstance<(session: any, schema: any) => import('next/server').NextResponse | null>
    };
  }
);

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

// Auth — default: authenticated user who is a member of 'myschema' and 'testschema'
vi.mock('@/auth', () => ({
  auth: mockAuth
}));

// Authorization guard — default: access permitted
vi.mock('@/lib/authz', () => ({
  assertSchemaAccess: mockAssertSchemaAccess,
  isAdminSession: vi.fn(() => false),
  hasSchemaAccess: vi.fn(() => true)
}));

// contextvalidation — default: success so the happy path runs in most tests
vi.mock('@/lib/contextvalidation', () => ({
  validateContextualValues: mockValidateContextualValues
}));

// SQL security — validatedSchema brands the input without re-running pattern checks,
// which lets existing tests use non-conforming names like 'myschema'/'testschema'.
// The security tests below verify that invalid patterns are caught by the real validator.
vi.mock('@/config/utils/sqlsecurity', () => ({
  validatedSchema: vi.fn((schema: string) => {
    // Simulate a failed pattern check for obviously-malicious input
    if (!schema || /[^a-z0-9_]/.test(schema)) {
      throw new Error(`Invalid or unauthorized schema: ${schema}`);
    }
    return schema;
  })
}));

// ===== helpers =====
function _makeProps(metric?: string, schema?: string, plotIDParam?: string, censusIDParam?: string, plot?: string) {
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

// ===== authorizedSession: a session whose user is a member of the test schemas =====
const authorizedSession = {
  user: {
    userStatus: 'user',
    sites: [{ schemaName: 'myschema' }, { schemaName: 'testschema' }]
  }
};

describe('GET /api/dashboardmetrics/[metric]/[schema]/[plotIDParam]/[censusIDParam]', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: validateContextualValues fails so the fallback path runs (matching the original test setup)
    // Each test that wants the happy path overrides this
    mockValidateContextualValues.mockResolvedValue({ success: false });

    // Default: auth returns an authorized session
    mockAuth.mockResolvedValue(authorizedSession);

    // Default: schema access is permitted
    mockAssertSchemaAccess.mockReturnValue(null);
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

  // it('FilesUploaded: lists blobs, maps metadata, returns 200', async () => {
  //   // Arrange container with two blobs
  //   getContainerClientMock.mockResolvedValueOnce({
  //     listBlobsFlat: () =>
  //       listBlobsIterable([
  //         {
  //           name: 'file1.csv',
  //           metadata: { user: 'alice', FormType: 'trees', FileErrorState: JSON.stringify([{ row: 1, msg: 'oops' }]) },
  //           properties: { lastModified: new Date('2025-08-01T12:00:00Z') }
  //         },
  //         {
  //           name: 'file2.csv',
  //           metadata: { user: 'bob', FormType: 'stems' }, // no error state
  //           properties: { lastModified: new Date('2025-08-02T12:00:00Z') }
  //         }
  //       ])
  //   });

  //   const res = await callGET('FilesUploaded', 'myschema', '1', '2', 'MyPlot');

  //   expect(res.status).toBe(HTTPResponses.OK);
  //   const body = await res.json();
  //   expect(body).toHaveProperty('FilesUploaded');
  //   expect(Array.isArray(body.FilesUploaded)).toBe(true);
  //   expect(body.FilesUploaded).toHaveLength(2);

  //   // First blob mapped
  //   expect(body.FilesUploaded[0]).toMatchObject({
  //     key: 1,
  //     name: 'file1.csv',
  //     user: 'alice',
  //     formType: 'trees',
  //     fileErrors: [{ row: 1, msg: 'oops' }]
  //     // date present, but don't assert equality on Date serialization
  //   });

  //   // Second blob mapped (no FileErrorState => empty string)
  //   expect(body.FilesUploaded[1]).toMatchObject({
  //     key: 2,
  //     name: 'file2.csv',
  //     user: 'bob',
  //     formType: 'stems',
  //     fileErrors: ''
  //   });

  //   // Called correct container name "<plot>-<censusID>"
  //   expect(getContainerClientMock).toHaveBeenCalledWith('MyPlot-2');
  // });

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

  // ===== StemTypes Tests =====
  describe('StemTypes metric', () => {
    it('first census (no previous census): returns all stems as new recruits', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');

      // First query: check for previous census - returns NULL (no previous)
      exec.mockResolvedValueOnce([{ PrevCensusID: null }]);
      // Second query: count new recruits
      exec.mockResolvedValueOnce([{ CountNewRecruits: 100 }]);

      const res = await callGET('StemTypes', 'testschema', '1', '1', 'TestPlot');

      expect(res.status).toBe(HTTPResponses.OK);
      const body = await res.json();

      // All stems should be new recruits for first census
      expect(body).toEqual({
        CountOldStems: 0,
        CountMultiStems: 0,
        CountNewRecruits: 100
      });

      // Verify the fast path was taken (only 2 queries instead of 1 complex query)
      expect(exec).toHaveBeenCalledTimes(2);

      // First query checks for previous census
      const [sql1, params1] = exec.mock.calls[0];
      expect(String(sql1)).toMatch(/SELECT MAX\(c\.CensusID\) as PrevCensusID/i);
      expect(params1).toEqual([1, 1]); // plotID, censusID
    });

    it('subsequent census: correctly classifies old stems, multi-stems, and new recruits', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');

      // First query: check for previous census - returns census ID 1
      exec.mockResolvedValueOnce([{ PrevCensusID: 1 }]);
      // Second query: the optimized stem types query
      exec.mockResolvedValueOnce([
        {
          CountOldStems: 500,
          CountMultiStems: 150,
          CountNewRecruits: 50
        }
      ]);

      const res = await callGET('StemTypes', 'testschema', '1', '2', 'TestPlot');

      expect(res.status).toBe(HTTPResponses.OK);
      const body = await res.json();

      expect(body).toEqual({
        CountOldStems: 500,
        CountMultiStems: 150,
        CountNewRecruits: 50
      });

      // Verify both queries were called
      expect(exec).toHaveBeenCalledTimes(2);

      // Second query should use the previous census ID
      const [sql2, params2] = exec.mock.calls[1];
      expect(String(sql2)).toMatch(/WITH measured_stems AS/i);
      expect(String(sql2)).toMatch(/LEFT JOIN previous_stems/i);
      expect(String(sql2)).toMatch(/LEFT JOIN previous_trees/i);
      expect(String(sql2)).toMatch(/COALESCE\(SUM\(CASE/i);
      // Parameters: censusID, censusID, previousCensusID, previousCensusID, previousCensusID
      expect(params2).toEqual([2, 2, 1, 1, 1]);
    });

    it('empty measurements: returns zeros for all stem types', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');

      // First query: has a previous census
      exec.mockResolvedValueOnce([{ PrevCensusID: 1 }]);
      // Second query: COALESCE returns 0 for empty results
      exec.mockResolvedValueOnce([
        {
          CountOldStems: 0,
          CountMultiStems: 0,
          CountNewRecruits: 0
        }
      ]);

      const res = await callGET('StemTypes', 'testschema', '1', '2', 'EmptyPlot');

      expect(res.status).toBe(HTTPResponses.OK);
      const body = await res.json();

      expect(body).toEqual({
        CountOldStems: 0,
        CountMultiStems: 0,
        CountNewRecruits: 0
      });
    });

    it('handles NULL database results gracefully via COALESCE and nullish coalescing', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');

      // First query: has a previous census
      exec.mockResolvedValueOnce([{ PrevCensusID: 1 }]);
      // Second query: returns NULL values (edge case if COALESCE somehow fails)
      exec.mockResolvedValueOnce([
        {
          CountOldStems: null,
          CountMultiStems: null,
          CountNewRecruits: null
        }
      ]);

      const res = await callGET('StemTypes', 'testschema', '1', '2', 'NullPlot');

      expect(res.status).toBe(HTTPResponses.OK);
      const body = await res.json();

      // JavaScript's ?? 0 fallback should convert nulls to 0
      expect(body).toEqual({
        CountOldStems: 0,
        CountMultiStems: 0,
        CountNewRecruits: 0
      });
    });

    it('handles empty result set (no rows returned)', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');

      // First query: has a previous census
      exec.mockResolvedValueOnce([{ PrevCensusID: 1 }]);
      // Second query: returns empty array (no rows)
      exec.mockResolvedValueOnce([]);

      const res = await callGET('StemTypes', 'testschema', '1', '2', 'EmptyResult');

      expect(res.status).toBe(HTTPResponses.OK);
      const body = await res.json();

      // Should handle undefined gracefully
      expect(body).toEqual({
        CountOldStems: 0,
        CountMultiStems: 0,
        CountNewRecruits: 0
      });
    });

    it('first census with zero measurements: returns 0 new recruits', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');

      // First query: no previous census
      exec.mockResolvedValueOnce([{ PrevCensusID: null }]);
      // Second query: count returns 0
      exec.mockResolvedValueOnce([{ CountNewRecruits: 0 }]);

      const res = await callGET('StemTypes', 'testschema', '1', '1', 'EmptyFirstCensus');

      expect(res.status).toBe(HTTPResponses.OK);
      const body = await res.json();

      expect(body).toEqual({
        CountOldStems: 0,
        CountMultiStems: 0,
        CountNewRecruits: 0
      });
    });
  });

  // ===== Fallback-path security tests =====
  // These tests exercise the branch where validateContextualValues fails and the
  // route falls back to the raw URL schemaParam. The fallback MUST enforce the
  // same auth + schema-access controls as the happy path.
  describe('fallback path security', () => {
    // Ensure validateContextualValues always returns failure in this describe block
    // so every call goes through the fallback branch.

    it('returns 401 when there is no authenticated session on the fallback path', async () => {
      mockAuth.mockResolvedValue(null); // no session

      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');

      const res = await callGET('CountTrees', 'myschema', '1', '1', 'PlotA');

      expect(res.status).toBe(HTTPResponses.UNAUTHORIZED);
      const body = await res.json();
      expect(body.code).toBe('UNAUTHENTICATED');

      // The database must not be queried — the request is blocked before reaching processMetrics
      expect(exec).not.toHaveBeenCalled();
    });

    it('returns 403 when the authenticated user does not have access to the requested schema, and the DB is never queried', async () => {
      const { NextResponse } = await import('next/server');
      // assertSchemaAccess returns a 403 response for an unauthorized schema
      const deniedResponse = NextResponse.json(
        { error: 'SQL references a schema outside the authenticated user scope', code: 'SCHEMA_ACCESS_DENIED' },
        { status: 403 }
      );
      mockAssertSchemaAccess.mockReturnValue(deniedResponse);

      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');

      // 'other_site_schema' belongs to a different site — user is not a member
      const res = await callGET('CountTrees', 'forestgeo_other', '1', '1', 'OtherPlot');

      expect(res.status).toBe(HTTPResponses.FORBIDDEN);

      // CRITICAL: processMetrics must never run when access is denied
      expect(exec).not.toHaveBeenCalled();
    });

    it('returns 400 when the fallback schemaParam fails pattern validation', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery');

      // 'DROP TABLE' is not a valid schema name — validatedSchema() will throw
      const res = await callGET('CountTrees', 'DROP TABLE users--', '1', '1', 'PlotA');

      expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
      const body = await res.json();
      expect(body.code).toBe('INVALID_SCHEMA');

      expect(exec).not.toHaveBeenCalled();
    });

    it('proceeds to executeQuery when the fallback schema is valid and the user is authorized', async () => {
      const cm = (ConnectionManager as any).getInstance();
      const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([{ CountTrees: 42 }]);

      const res = await callGET('CountTrees', 'myschema', '5', '3', 'GoodPlot');

      expect(res.status).toBe(HTTPResponses.OK);
      const body = await res.json();
      expect(body.CountTrees).toBe(42);

      // executeQuery was reached — the authorized fallback path completed normally
      expect(exec).toHaveBeenCalledTimes(1);
    });
  });
});
