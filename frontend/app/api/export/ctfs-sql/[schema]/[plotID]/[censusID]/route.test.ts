/**
 * Unit tests for GET /api/export/ctfs-sql/[schema]/[plotID]/[censusID]
 *
 * All tests mock heavy dependencies (auth, ConnectionManager, ctfs-export,
 * ailogger) so the suite runs without a live database. Tests are verbose so
 * that failures surface the actual values returned by each branch.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';

// ---------------------------------------------------------------------------
// Hoisted mock state — must be declared before any vi.mock() call so that the
// factory closures can reference them without capturing stale values.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  // auth / session
  auth: vi.fn(),
  isValidSchema: vi.fn(() => true),

  // raw connection returned by getConn()
  connQuery: vi.fn(),
  connRelease: vi.fn(),

  // ctfs-export module
  checkFinishedCensus: vi.fn(),
  selectMeasurements: vi.fn(),
  renderArtifact: vi.fn(),

  // ailogger
  loggerInfo: vi.fn(),
  loggerError: vi.fn()
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/auth', () => ({ auth: mocks.auth }));

vi.mock('@/config/utils/sqlsecurity', () => ({
  isValidSchema: mocks.isValidSchema,
  // The route now uses safeFormatQuery for the census probe. The mock returns
  // the query verbatim — backticks aren't relevant since conn.query is itself
  // mocked.
  safeFormatQuery: (_schema: string, query: string) => query.replace(/\?\?/g, '`mocked_schema`')
}));

vi.mock('@/lib/db/primitives', () => ({
  getConn: vi.fn(async () => ({
    query: mocks.connQuery,
    release: mocks.connRelease
  }))
}));

vi.mock('@/lib/ctfs-export', () => ({
  checkFinishedCensus: mocks.checkFinishedCensus,
  selectMeasurements: mocks.selectMeasurements,
  renderArtifact: mocks.renderArtifact
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: mocks.loggerInfo,
    error: mocks.loggerError
  }
}));

// Import the route AFTER all mocks are in place.
import { GET } from './route';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const VALID_SCHEMA = 'forestgeo_testing';
const VALID_PLOT_ID = '7';
const VALID_CENSUS_ID = '42';
const VALID_DEST_PLOT_ID = '1';

function makeUrl(overrides: Record<string, string | undefined> = {}): URL {
  const url = new URL(`http://localhost/api/export/ctfs-sql/${VALID_SCHEMA}/${VALID_PLOT_ID}/${VALID_CENSUS_ID}`);
  // Default: destinationPlotID present
  url.searchParams.set('destinationPlotID', VALID_DEST_PLOT_ID);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

function makeRequest(url: URL = makeUrl()): NextRequest {
  return { nextUrl: url } as unknown as NextRequest;
}

type RouteProps = { params: Promise<{ schema: string; plotID: string; censusID: string }> };

function makeProps(schema = VALID_SCHEMA, plotID = VALID_PLOT_ID, censusID = VALID_CENSUS_ID): RouteProps {
  return { params: Promise.resolve({ schema, plotID, censusID }) };
}

// Minimal session shape that satisfies requireSession + getSessionUserId.
const AUTHED_SESSION = {
  user: {
    email: 'researcher@example.com',
    name: 'Researcher',
    userStatus: 'lead technician',
    sites: [{ schemaName: VALID_SCHEMA }],
    allsites: [{ schemaName: VALID_SCHEMA }]
  }
};

// Default happy-path ctfs-export responses.
const STUB_MEASUREMENT_ROWS = [{ TempMeasurementID: 1, TreeTag: 'T001' }] as any[];
const STUB_ATTRIBUTE_ROWS = [{ TempMeasurementID: 1, Code: 'R' }] as any[];
const STUB_RENDER_RESULT = {
  sql: '-- generated sql --',
  procedureName: 'csv_to_sql_v2_load_1_census2025_abcd1234',
  lockName: 'ctfs-export:1:census2025'
};

// NextRequest is not available in vitest node environment — import the type only.
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('GET /api/export/ctfs-sql/:schema/:plotID/:censusID', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: authenticated, valid schema, census found.
    mocks.auth.mockResolvedValue(AUTHED_SESSION);
    mocks.isValidSchema.mockReturnValue(true);
    mocks.checkFinishedCensus.mockResolvedValue({ ok: true, count: 3 });
    mocks.selectMeasurements.mockResolvedValue({
      measurementRows: STUB_MEASUREMENT_ROWS,
      attributeRows: STUB_ATTRIBUTE_ROWS
    });
    mocks.connQuery.mockResolvedValue([[{ PlotCensusNumber: '2025A' }]]);
    mocks.renderArtifact.mockReturnValue(STUB_RENDER_RESULT);
    mocks.connRelease.mockReturnValue(undefined);
  });

  // -------------------------------------------------------------------------
  // Auth checks
  // -------------------------------------------------------------------------

  it('returns 401 when session is null (unauthenticated)', async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(HTTPResponses.UNAUTHORIZED);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('returns 401 when session has no user object', async () => {
    mocks.auth.mockResolvedValue({});

    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(HTTPResponses.UNAUTHORIZED);
  });

  it('returns 400 when schema fails isValidSchema', async () => {
    mocks.isValidSchema.mockReturnValue(false);

    const res = await GET(makeRequest(), makeProps('invalid_schema'));

    expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
    const body = await res.json();
    expect(body.error).toMatch(/invalid schema/i);
  });

  it('returns 403 when a non-admin session lacks access to the requested schema', async () => {
    mocks.auth.mockResolvedValue({
      user: {
        email: 'outsider@example.com',
        name: 'Outsider',
        userStatus: 'lead technician',
        sites: [{ schemaName: 'forestgeo_other' }],
        allsites: [{ schemaName: 'forestgeo_other' }]
      }
    });

    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(HTTPResponses.FORBIDDEN);
    const body = await res.json();
    expect(body.error).toMatch(/forbidden/i);
    expect(mocks.connQuery).not.toHaveBeenCalled();
    expect(mocks.connRelease).not.toHaveBeenCalled();
  });

  it('returns 403 when a field crew session has schema access but not export authority', async () => {
    mocks.auth.mockResolvedValue({
      user: {
        email: 'field@example.com',
        name: 'Field User',
        userStatus: 'field crew',
        sites: [{ schemaName: VALID_SCHEMA }],
        allsites: [{ schemaName: VALID_SCHEMA }]
      }
    });

    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(HTTPResponses.FORBIDDEN);
    expect(mocks.connQuery).not.toHaveBeenCalled();
    expect(mocks.connRelease).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Route param validation
  // -------------------------------------------------------------------------

  it('returns 400 when plotID is not an integer', async () => {
    const res = await GET(makeRequest(), makeProps(VALID_SCHEMA, 'notAnInt', VALID_CENSUS_ID));

    expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
    const body = await res.json();
    expect(body.error).toMatch(/plotID and censusID must be integers/i);
  });

  it('returns 400 when censusID is not an integer', async () => {
    const res = await GET(makeRequest(), makeProps(VALID_SCHEMA, VALID_PLOT_ID, '3.14'));

    expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
    const body = await res.json();
    expect(body.error).toMatch(/plotID and censusID must be integers/i);
  });

  // -------------------------------------------------------------------------
  // Query param: destinationPlotID
  // -------------------------------------------------------------------------

  it('returns 400 when destinationPlotID is missing', async () => {
    const url = makeUrl({ destinationPlotID: undefined });
    const res = await GET(makeRequest(url), makeProps());

    expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
    const body = await res.json();
    expect(body.error).toMatch(/destinationPlotID/i);
  });

  it('returns 400 when destinationPlotID is a float string', async () => {
    const url = makeUrl({ destinationPlotID: '1.5' });
    const res = await GET(makeRequest(url), makeProps());

    expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
    const body = await res.json();
    expect(body.error).toMatch(/destinationPlotID must be a non-negative integer/i);
  });

  it('returns 400 when destinationPlotID is negative', async () => {
    const url = makeUrl({ destinationPlotID: '-1' });
    const res = await GET(makeRequest(url), makeProps());

    expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
    const body = await res.json();
    expect(body.error).toMatch(/destinationPlotID must be a non-negative integer/i);
  });

  it('accepts destinationPlotID = 0 (allowed: non-negative includes zero)', async () => {
    const url = makeUrl({ destinationPlotID: '0' });
    const res = await GET(makeRequest(url), makeProps());

    // Zero is a valid non-negative integer per spec — should proceed to success.
    expect(res.status).toBe(HTTPResponses.OK);
  });

  // -------------------------------------------------------------------------
  // Reload permission checks
  // -------------------------------------------------------------------------

  it('returns 403 when allowReload=true and user cannot reload', async () => {
    const url = makeUrl({ allowReload: 'true' });
    const res = await GET(makeRequest(url), makeProps());

    expect(res.status).toBe(HTTPResponses.FORBIDDEN);
    const body = await res.json();
    expect(body.error).toMatch(/reload export requires elevated permission/i);
  });

  it('returns 403 when reloadDryRun=true and user cannot reload', async () => {
    const url = makeUrl({ reloadDryRun: 'true' });
    const res = await GET(makeRequest(url), makeProps());

    expect(res.status).toBe(HTTPResponses.FORBIDDEN);
    const body = await res.json();
    expect(body.error).toMatch(/reload export requires elevated permission/i);
  });

  it('allows admin users to generate allowReload artifacts', async () => {
    mocks.auth.mockResolvedValue({
      user: {
        email: 'admin@example.com',
        name: 'Admin',
        userStatus: 'db admin',
        sites: [],
        allsites: []
      }
    });
    const url = makeUrl({ allowReload: 'true' });

    const res = await GET(makeRequest(url), makeProps());

    expect(res.status).toBe(HTTPResponses.OK);
    expect(mocks.renderArtifact).toHaveBeenCalledWith(expect.objectContaining({ allowReload: true, reloadDryRun: false }));
  });

  // -------------------------------------------------------------------------
  // Precondition failure
  // -------------------------------------------------------------------------

  it('returns 400 with structured reasons when checkFinishedCensus returns ok: false', async () => {
    const reasons = [
      {
        kind: 'not-validated',
        message: '2 rows not yet validated',
        coreMeasurementIds: [10, 11]
      }
    ];
    mocks.checkFinishedCensus.mockResolvedValue({ ok: false, reasons });

    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
    const body = await res.json();
    expect(body.error).toMatch(/census is not finished/i);
    expect(body.reasons).toEqual(reasons);
    // Connection must still be released even on early returns from the try block.
    expect(mocks.connRelease).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Census row not found
  // -------------------------------------------------------------------------

  it('returns 404 when the census row is not found in the DB', async () => {
    // conn.query returns an empty rows array.
    mocks.connQuery.mockResolvedValue([[]]);

    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(HTTPResponses.NOT_FOUND);
    const body = await res.json();
    expect(body.error).toMatch(/census not found/i);
    expect(mocks.checkFinishedCensus).not.toHaveBeenCalled();
    expect(mocks.connRelease).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('returns 200 with application/sql body and Content-Disposition on success', async () => {
    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(HTTPResponses.OK);
    expect(res.headers.get('Content-Type')).toMatch(/application\/sql/i);
    const disposition = res.headers.get('Content-Disposition') ?? '';
    expect(disposition).toMatch(/^attachment; filename=ctfs-export-1-2025A-\d+\.sql$/);
    const body = await res.text();
    expect(body).toBe(STUB_RENDER_RESULT.sql);
  });

  it('sanitizes PlotCensusNumber before placing it in the download filename', async () => {
    mocks.connQuery.mockResolvedValue([[{ PlotCensusNumber: '2025 A/pilot' }]]);

    const res = await GET(makeRequest(), makeProps());

    const disposition = res.headers.get('Content-Disposition') ?? '';
    expect(disposition).toMatch(/^attachment; filename=ctfs-export-1-2025-A-pilot-\d+\.sql$/);
    expect(mocks.renderArtifact).toHaveBeenCalledWith(expect.objectContaining({ plotCensusNumber: '2025 A/pilot' }));
  });

  it('calls checkFinishedCensus with the parsed plotId and censusId', async () => {
    await GET(makeRequest(), makeProps());

    expect(mocks.checkFinishedCensus).toHaveBeenCalledWith(expect.objectContaining({ query: mocks.connQuery, release: mocks.connRelease }), {
      schema: VALID_SCHEMA,
      plotId: 7,
      censusId: 42
    });
  });

  it('resolves PlotCensusNumber using the parsed plotId and censusId pair', async () => {
    await GET(makeRequest(), makeProps());

    expect(mocks.connQuery).toHaveBeenCalledWith(expect.stringMatching(/WHERE PlotID = \? AND CensusID = \? AND IsActive = 1/), [7, 42]);
  });

  it('calls selectMeasurements with the parsed plotId and censusId', async () => {
    await GET(makeRequest(), makeProps());

    expect(mocks.selectMeasurements).toHaveBeenCalledWith(expect.objectContaining({ query: mocks.connQuery, release: mocks.connRelease }), {
      schema: VALID_SCHEMA,
      plotId: 7,
      censusId: 42
    });
  });

  it('calls renderArtifact with all inputs including generatedAt: Date', async () => {
    const before = Date.now();
    await GET(makeRequest(), makeProps());
    const after = Date.now();

    const call = mocks.renderArtifact.mock.calls[0][0];
    expect(call.schema).toBe(VALID_SCHEMA);
    expect(call.appPlotId).toBe(7);
    expect(call.destinationPlotId).toBe(1);
    expect(call.appCensusId).toBe(42);
    expect(call.plotCensusNumber).toBe('2025A');
    expect(call.allowReload).toBe(false);
    expect(call.reloadDryRun).toBe(false);
    expect(call.measurementRows).toEqual(STUB_MEASUREMENT_ROWS);
    expect(call.attributeRows).toEqual(STUB_ATTRIBUTE_ROWS);
    expect(call.generatedAt).toBeInstanceOf(Date);
    expect(call.generatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(call.generatedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('logs audit info via ailogger.info on success', async () => {
    await GET(makeRequest(), makeProps());

    expect(mocks.loggerInfo).toHaveBeenCalledTimes(1);
    const [message, meta] = mocks.loggerInfo.mock.calls[0];
    expect(message).toMatch(/ctfs-sql export generated/i);
    expect(meta.userId).toBe('researcher@example.com');
    expect(meta.schema).toBe(VALID_SCHEMA);
    expect(meta.appPlotId).toBe(7);
    expect(meta.destinationPlotId).toBe(1);
    expect(meta.appCensusId).toBe(42);
    expect(meta.plotCensusNumber).toBe('2025A');
    expect(meta.measurementCount).toBe(1);
    expect(meta.attributeCount).toBe(1);
    expect(meta.allowReload).toBe(false);
    expect(meta.reloadDryRun).toBe(false);
    expect(meta.procedureName).toBe(STUB_RENDER_RESULT.procedureName);
    expect(meta.lockName).toBe(STUB_RENDER_RESULT.lockName);
    expect(meta.filename).toMatch(/^ctfs-export-1-2025A-\d+\.sql$/);
  });

  it('releases the connection on success', async () => {
    await GET(makeRequest(), makeProps());

    expect(mocks.connRelease).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Unexpected error / 500 path
  // -------------------------------------------------------------------------

  it('returns 500 and logs ailogger.error when an unexpected error is thrown', async () => {
    mocks.selectMeasurements.mockRejectedValue(new Error('DB exploded'));

    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    const body = await res.json();
    expect(body.error).toMatch(/DB exploded/i);

    expect(mocks.loggerError).toHaveBeenCalledTimes(1);
    const [message, meta] = mocks.loggerError.mock.calls[0];
    expect(message).toMatch(/ctfs-sql export failed/i);
    expect(meta.message).toMatch(/DB exploded/i);

    // Connection must still be released even when an error escapes.
    expect(mocks.connRelease).toHaveBeenCalledTimes(1);
  });

  it('returns 500 with non-Error thrown objects', async () => {
    mocks.renderArtifact.mockImplementation(() => {
      throw 'a plain string error';
    });

    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    const body = await res.json();
    expect(body.error).toBe('a plain string error');
  });
});
