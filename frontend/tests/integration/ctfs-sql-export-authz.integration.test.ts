import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
const OUT_OF_SCOPE_SCHEMA = 'forestgeo_panama';
const INVALID_SCHEMA = 'foo;DROP';
const STUB_SQL = '-- generated ctfs export sql --';

// Mock the DB + export helpers so the guard's short-circuit is provable (getConn
// spy must NOT be called on a denial) and the authorized 200 path is
// deterministic. isValidSchema and userCanExportSchema are left REAL so the
// guard and the export-role gate exercise their true logic.
const mocks = vi.hoisted(() => ({
  getConn: vi.fn(),
  connQuery: vi.fn(),
  connBeginTransaction: vi.fn(),
  connCommit: vi.fn(),
  connRollback: vi.fn(),
  connDestroy: vi.fn(),
  connRelease: vi.fn(),
  checkFinishedCensus: vi.fn(),
  selectMeasurements: vi.fn(),
  renderArtifact: vi.fn()
}));

// Default session is a 'global' admin so the guard's per-site gate AND the
// export-role gate pass; the out-of-scope test overrides with a field-crew
// session scoped to a different schema to exercise the guard's 403 denial.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: { email: AUTH_USER_EMAIL, userStatus: 'global', sites: [] }
  }))
}));

vi.mock('@/lib/db/primitives', () => ({
  getConn: mocks.getConn
}));

vi.mock('@/lib/ctfs-export', () => ({
  checkFinishedCensus: mocks.checkFinishedCensus,
  selectMeasurements: mocks.selectMeasurements,
  renderArtifact: mocks.renderArtifact
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

describe('GET /api/export/ctfs-sql/[schema]/[plotID]/[censusID] authz', () => {
  let connection: Connection;
  let testData: TestData;
  let schema: string;
  let plotID: number;
  let censusID: number;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    schema = setup.config.database;
    plotID = testData.plots[0].plotID;
    censusID = testData.census[0].censusID;
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection);
  });

  beforeEach(() => {
    mocks.getConn.mockReset();
    mocks.connQuery.mockReset();
    mocks.connBeginTransaction.mockReset();
    mocks.connCommit.mockReset();
    mocks.connRollback.mockReset();
    mocks.connDestroy.mockReset();
    mocks.connRelease.mockReset();
    mocks.checkFinishedCensus.mockReset();
    mocks.selectMeasurements.mockReset();
    mocks.renderArtifact.mockReset();

    mocks.getConn.mockResolvedValue({
      query: mocks.connQuery,
      beginTransaction: mocks.connBeginTransaction,
      commit: mocks.connCommit,
      rollback: mocks.connRollback,
      destroy: mocks.connDestroy,
      release: mocks.connRelease
    });
    mocks.connQuery.mockResolvedValue([[{ PlotCensusNumber: '2025A' }]]);
    mocks.connBeginTransaction.mockResolvedValue(undefined);
    mocks.connCommit.mockResolvedValue(undefined);
    mocks.connRollback.mockResolvedValue(undefined);
    mocks.connDestroy.mockReturnValue(undefined);
    mocks.checkFinishedCensus.mockResolvedValue({ ok: true, count: 1, totalActiveCount: 1 });
    mocks.selectMeasurements.mockResolvedValue({ measurementRows: [], attributeRows: [] });
    mocks.renderArtifact.mockReturnValue({ sql: STUB_SQL, procedureName: 'proc', lockName: 'lock' });
  });

  function makeRequest() {
    return new NextRequest(`http://localhost/api/export/ctfs-sql/${schema}/${plotID}/${censusID}?destinationPlotID=1`);
  }

  function makeContext(overrideSchema: string) {
    return {
      params: Promise.resolve({ schema: overrideSchema, plotID: String(plotID), censusID: String(censusID) })
    } as any;
  }

  it('denies an out-of-scope schema with 403 and does no database work', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: OUT_OF_SCOPE_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/export/ctfs-sql/[schema]/[plotID]/[censusID]/route');
    const res = await GET(makeRequest(), makeContext(schema));

    expect(res.status).toBe(HTTP_FORBIDDEN);
    expect(mocks.getConn).not.toHaveBeenCalled();
    expect(mocks.checkFinishedCensus).not.toHaveBeenCalled();
  });

  it('rejects a structurally invalid schema with 400 and does no database work', async () => {
    const { GET } = await import('@/app/api/export/ctfs-sql/[schema]/[plotID]/[censusID]/route');
    const res = await GET(makeRequest(), makeContext(INVALID_SCHEMA));

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    expect(mocks.getConn).not.toHaveBeenCalled();
  });

  it('returns 200 with the rendered SQL artifact for an authorized member request', async () => {
    const { GET } = await import('@/app/api/export/ctfs-sql/[schema]/[plotID]/[censusID]/route');
    const res = await GET(makeRequest(), makeContext(schema));

    expect(res.status).toBe(HTTP_OK);
    expect(res.headers.get('Content-Type')).toMatch(/application\/sql/i);
    expect(await res.text()).toBe(STUB_SQL);
    expect(mocks.getConn).toHaveBeenCalledTimes(1);
    expect(mocks.connRelease).toHaveBeenCalledTimes(1);
  });
});
