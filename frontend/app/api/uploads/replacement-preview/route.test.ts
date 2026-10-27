import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { GET } from './route';

vi.mock('@/ailogger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn()
  }
}));

// GET is wrapped by withRouteAuthz, whose Handler type requires a RouteContext
// second argument even though this route has no dynamic segments and never
// reads context.params.
const EMPTY_CONTEXT = { params: Promise.resolve({}) };
function callGet(request: any) {
  return GET(request, EMPTY_CONTEXT);
}

const mocks = vi.hoisted(() => {
  class MockScopeAccessError extends Error {
    constructor(message = 'plot/census scope is not available') {
      super(message);
      this.name = 'ScopeAccessError';
    }
  }

  return {
    auth: vi.fn(),
    assertCanEditMeasurementScope: vi.fn(),
    executeQuery: vi.fn(),
    closeConnection: vi.fn(async () => undefined),
    MockScopeAccessError
  };
});

vi.mock('@/auth', () => ({
  auth: mocks.auth
}));

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      executeQuery: mocks.executeQuery,
      closeConnection: mocks.closeConnection
    })
  }
}));

vi.mock('@/config/editplan/scopeguard', () => ({
  assertCanEditMeasurementScope: mocks.assertCanEditMeasurementScope,
  ScopeAccessError: mocks.MockScopeAccessError
}));

const AUTHORIZED_SCHEMA = 'forestgeo_testing';
const PLOT_ID = 22;
const CENSUS_ID = 32;

const session = {
  user: {
    email: 'mason@example.com',
    name: 'Mason',
    userStatus: 'field crew',
    sites: [{ schemaName: AUTHORIZED_SCHEMA }]
  }
};

function makeRequest(query: string) {
  const url = new URL(`http://localhost/api/uploads/replacement-preview${query}`);
  const req = new Request(url.toString()) as any;
  req.nextUrl = url; // withRouteAuthz's fromQuery resolver reads request.nextUrl
  return req;
}

describe('GET /api/uploads/replacement-preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(session);
    mocks.assertCanEditMeasurementScope.mockResolvedValue({ plotCensusNumber: 1 });
    mocks.executeQuery.mockResolvedValue([{ existingRowCount: 20 }]);
    mocks.closeConnection.mockResolvedValue(undefined);
  });

  it('returns 401 when the request is unauthenticated', async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
    expect(response.status).toBe(HTTPResponses.UNAUTHORIZED);
    expect(mocks.assertCanEditMeasurementScope).not.toHaveBeenCalled();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when schema is missing', async () => {
    const response = await callGet(makeRequest(`?plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
    expect(response.status).toBe(HTTPResponses.BAD_REQUEST);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_SCHEMA' });
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when schema is not a valid schema name', async () => {
    const response = await callGet(makeRequest(`?schema=not a schema&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
    expect(response.status).toBe(HTTPResponses.BAD_REQUEST);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('returns 403 for a schema outside the caller session scope', async () => {
    const response = await callGet(makeRequest(`?schema=forestgeo_other&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
    expect(response.status).toBe(HTTPResponses.FORBIDDEN);
    expect(mocks.assertCanEditMeasurementScope).not.toHaveBeenCalled();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when plotID is missing', async () => {
    const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&censusID=${CENSUS_ID}`));
    expect(response.status).toBe(HTTPResponses.BAD_REQUEST);
    expect(mocks.assertCanEditMeasurementScope).not.toHaveBeenCalled();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when censusID is missing', async () => {
    const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}`));
    expect(response.status).toBe(HTTPResponses.BAD_REQUEST);
    expect(mocks.assertCanEditMeasurementScope).not.toHaveBeenCalled();
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it.each([['0'], ['-1'], ['1.5'], ['abc'], ['']])('returns 400 for a non-positive-integer plotID (%s)', async rawPlotID => {
    const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${rawPlotID}&censusID=${CENSUS_ID}`));
    expect(response.status).toBe(HTTPResponses.BAD_REQUEST);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it.each([['0'], ['-1'], ['1.5'], ['abc'], ['']])('returns 400 for a non-positive-integer censusID (%s)', async rawCensusID => {
    const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${rawCensusID}`));
    expect(response.status).toBe(HTTPResponses.BAD_REQUEST);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('returns 403 when the scope access guard rejects the requested plot/census', async () => {
    mocks.assertCanEditMeasurementScope.mockRejectedValue(new mocks.MockScopeAccessError());
    const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
    expect(response.status).toBe(HTTPResponses.FORBIDDEN);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
    expect(mocks.closeConnection).toHaveBeenCalled();
  });

  it('returns 200 with existingRowCount on the happy path', async () => {
    mocks.executeQuery.mockResolvedValue([{ existingRowCount: 20 }]);
    const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));

    expect(response.status).toBe(HTTPResponses.OK);
    await expect(response.json()).resolves.toEqual({ existingRowCount: 20 });
    expect(mocks.assertCanEditMeasurementScope).toHaveBeenCalledWith(expect.any(Object), session, {
      schema: AUTHORIZED_SCHEMA,
      plotID: PLOT_ID,
      censusID: CENSUS_ID
    });
    expect(mocks.closeConnection).toHaveBeenCalled();
  });

  it('returns existingRowCount 0 when the census has no measurements', async () => {
    mocks.executeQuery.mockResolvedValue([{ existingRowCount: 0 }]);
    const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
    expect(response.status).toBe(HTTPResponses.OK);
    await expect(response.json()).resolves.toEqual({ existingRowCount: 0 });
  });

  it('counts by CensusID only, matching the Clean Re-Upload cleanup scope exactly (no PlotID filter, no IsActive/IsValidated filter)', async () => {
    await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));

    expect(mocks.executeQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.executeQuery.mock.calls[0];
    expect(sql).toMatch(/coremeasurements/i);
    expect(sql).toMatch(/WHERE\s+CensusID\s*=\s*\?/i);
    expect(sql).not.toMatch(/PlotID/i);
    expect(sql).not.toMatch(/IsActive/i);
    expect(sql).not.toMatch(/IsValidated/i);
    expect(params).toEqual([CENSUS_ID]);
  });

  it('sets Cache-Control: no-store on the happy-path response so the count is always read fresh', async () => {
    const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  // ---------------------------------------------------------------------
  // Fail-closed existingRowCount normalization (issue #504 review finding).
  // A malformed/missing COUNT(*) result must never be reported as 0 — that
  // would authorize an unchecked Clean Re-Upload census replacement as
  // "nothing to replace". Every case below must hit the generic error path,
  // not `existingRowCount: 0`.
  // ---------------------------------------------------------------------
  describe('fail-closed existingRowCount normalization', () => {
    async function expectGenericErrorResponse(response: Response): Promise<void> {
      expect(response.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
      const body = await response.json();
      expect(body).not.toHaveProperty('existingRowCount');
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
      // The generic message must not leak internals: no SQL, table, or schema name.
      expect(body.error).not.toMatch(/coremeasurements/i);
      expect(body.error).not.toMatch(/SELECT/i);
      expect(body.error).not.toMatch(new RegExp(AUTHORIZED_SCHEMA, 'i'));
    }

    it('fails closed when the query returns no rows at all', async () => {
      mocks.executeQuery.mockResolvedValue([]);
      const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
      await expectGenericErrorResponse(response);
    });

    it('fails closed when existingRowCount is null, and logs the real detail server-side', async () => {
      mocks.executeQuery.mockResolvedValue([{ existingRowCount: null }]);
      const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
      await expectGenericErrorResponse(response);
      // The specific malformed value is logged server-side even though the
      // client only sees the generic message asserted above.
      expect(ailogger.error).toHaveBeenCalledWith(expect.stringContaining('null'));
    });

    it('fails closed when existingRowCount is undefined', async () => {
      mocks.executeQuery.mockResolvedValue([{ existingRowCount: undefined }]);
      const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
      await expectGenericErrorResponse(response);
    });

    it('fails closed when existingRowCount is negative', async () => {
      mocks.executeQuery.mockResolvedValue([{ existingRowCount: -1 }]);
      const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
      await expectGenericErrorResponse(response);
    });

    it('fails closed when existingRowCount is fractional', async () => {
      mocks.executeQuery.mockResolvedValue([{ existingRowCount: 4.5 }]);
      const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
      await expectGenericErrorResponse(response);
    });

    it('fails closed when existingRowCount is a non-numeric string', async () => {
      mocks.executeQuery.mockResolvedValue([{ existingRowCount: 'abc' }]);
      const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
      await expectGenericErrorResponse(response);
    });

    it('fails closed when existingRowCount exceeds Number.MAX_SAFE_INTEGER', async () => {
      mocks.executeQuery.mockResolvedValue([{ existingRowCount: Number.MAX_SAFE_INTEGER + 2 }]);
      const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
      await expectGenericErrorResponse(response);
    });

    // Values Number() coerces into a plausible-looking count (0 or 1) without
    // ever being an actual COUNT(*) result. Each must be rejected by the
    // runtime type check BEFORE Number() ever runs, not accepted as 0/1.
    it.each([
      ['false (boolean)', false],
      ['true (boolean)', true],
      ["'' (empty string)", ''],
      ["'   ' (whitespace-only string)", '   '],
      ['[] (empty array, Number([]) === 0)', []],
      ["['0'] (array, Number(['0']) === 0)", ['0']],
      ['{} (plain object)', {}]
    ])('fails closed when existingRowCount is %s', async (_label, rawExistingRowCount) => {
      mocks.executeQuery.mockResolvedValue([{ existingRowCount: rawExistingRowCount }]);
      const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
      await expectGenericErrorResponse(response);
    });

    it('fails closed when the first query result row is null, instead of throwing reading .existingRowCount off it', async () => {
      mocks.executeQuery.mockResolvedValue([null]);
      const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
      await expectGenericErrorResponse(response);
    });

    it('normalizes a valid numeric string ("42") from COUNT(*) to the number 42, not an error', async () => {
      mocks.executeQuery.mockResolvedValue([{ existingRowCount: '42' }]);
      const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
      expect(response.status).toBe(HTTPResponses.OK);
      await expect(response.json()).resolves.toEqual({ existingRowCount: 42 });
    });

    it('normalizes a valid numeric string ("0") from COUNT(*) to the number 0, not an error', async () => {
      mocks.executeQuery.mockResolvedValue([{ existingRowCount: '0' }]);
      const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
      expect(response.status).toBe(HTTPResponses.OK);
      await expect(response.json()).resolves.toEqual({ existingRowCount: 0 });
    });

    it('sets Cache-Control: no-store on the error response too', async () => {
      mocks.executeQuery.mockResolvedValue([{ existingRowCount: null }]);
      const response = await callGet(makeRequest(`?schema=${AUTHORIZED_SCHEMA}&plotID=${PLOT_ID}&censusID=${CENSUS_ID}`));
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    });
  });
});
