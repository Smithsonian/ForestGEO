import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConnectionManager from '@/lib/db/connectionmanager';
import { insertIngestionFailureRows } from '@/config/measurementerrors';
import { resetTemporaryMeasurementsSourceFormatColumnCacheForTests } from '@/lib/ingestion/temporary-measurements';

/**
 * Per-site authorization regression suite for POST /api/sqlpacketload.
 *
 * Phase-3 posture: sqlpacketload accepts a potentially large upload body, so the
 * user→schema membership check is enforced INLINE via `auth()` +
 * `assertSchemaAccess(session, body.schema)` (rather than `withRouteAuthz` +
 * `fromBody`, which would re-parse the whole body). The measurements branch KEEPS
 * `requireUploadSessionOwnership` for plot/census token ownership — this suite pins
 * that the membership check is layered ON TOP of, and BEFORE, that token check.
 *
 * Contract pinned here:
 *   - a non-admin session outside the requested schema gets 403, and the inline
 *     membership check short-circuits BEFORE any DB work and BEFORE the token check.
 *     The token is mocked to "would-pass" so a 403 proves the MEMBERSHIP check.
 *   - an authorized non-admin member WITH a valid (mocked) token reaches the
 *     temporarymeasurements insert path (200).
 */

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

const MEMBER_SCHEMA = 'forestgeo_panama';
const FOREIGN_SCHEMA = 'forestgeo_serc';

const ATTACKER_EMAIL = 'attacker@forestgeo.test';
const MEMBER_EMAIL = 'member@forestgeo.test';

const TEST_SESSION_ID = 'session-1';
const TEST_PLOT_ID = 22;
const TEST_CENSUS_ID = 32;
const TEST_BATCH_ID = 'batch-1';
const TEST_FILE_NAME = 'SERC_census1_2025.csv';

const { getCookieMock, authMock, handleUpsertMock } = vi.hoisted(() => ({
  getCookieMock: vi.fn(),
  authMock: vi.fn(),
  handleUpsertMock: vi.fn()
}));

const { requireUploadSessionOwnershipMock, MockUploadSessionOwnershipError } = vi.hoisted(() => {
  class MockUploadSessionOwnershipError extends Error {
    status: number;
    constructor(message: string, status = 409) {
      super(message);
      this.status = status;
    }
  }
  return { requireUploadSessionOwnershipMock: vi.fn(), MockUploadSessionOwnershipError };
});

vi.mock('@/lib/db/connectionmanager', () => {
  const executeQuery = vi.fn();
  const beginTransaction = vi.fn().mockResolvedValue('tx-test');
  const commitTransaction = vi.fn().mockResolvedValue(undefined);
  const rollbackTransaction = vi.fn().mockResolvedValue(undefined);
  const instance = { executeQuery, beginTransaction, commitTransaction, rollbackTransaction };
  return { default: { getInstance: () => instance } };
});

vi.mock('@/app/actions/cookiemanager', () => ({ getCookie: getCookieMock }));

vi.mock('@/auth', () => ({ auth: authMock }));

vi.mock('@/lib/db/sqlsecurity', () => ({ isValidSchema: vi.fn(() => true) }));

vi.mock('@/config/utils', async importOriginal => {
  const actual = (await importOriginal()) as object;
  return { ...actual, generateShortBatchID: () => 'test-batch-id', handleUpsert: handleUpsertMock };
});

vi.mock('@/config/uploadsessiontracker', () => ({
  requireUploadSessionOwnership: requireUploadSessionOwnershipMock,
  UploadSessionOwnershipError: MockUploadSessionOwnershipError,
  UploadSessionState: { INITIALIZED: 'initialized', UPLOADING: 'uploading' }
}));

vi.mock('@/config/measurementerrors', () => ({ insertIngestionFailureRows: vi.fn().mockResolvedValue([]) }));

vi.mock('@/components/processors/processorhelperfunctions', () => ({ insertOrUpdate: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock('mysql2/promise', () => ({
  format: vi.fn((sql: string, params: any[]) => {
    let result = sql;
    params.forEach(param => {
      if (result.includes('??')) result = result.replace('??', String(param));
      else if (result.includes('?')) result = result.replace('?', String(param));
    });
    return result;
  })
}));

function makeMeasurementRequest(schema: string) {
  const body = {
    schema,
    formType: 'measurements',
    fileName: TEST_FILE_NAME,
    plot: { plotID: TEST_PLOT_ID },
    census: { dateRanges: [{ censusID: TEST_CENSUS_ID }] },
    user: 'Test User',
    batchID: TEST_BATCH_ID,
    fileRowSet: {
      'row-1': {
        tag: '100001',
        stemtag: '1',
        spcode: 'FAGR',
        quadrat: '1011',
        lx: '202',
        ly: '104.5',
        dbh: '3.5',
        hom: '1.30',
        date: '2010-03-17',
        codes: 'LI',
        comments: ''
      }
    }
  };
  const req = new Request('http://localhost/api/sqlpacketload', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-upload-session-id': TEST_SESSION_ID },
    body: JSON.stringify(body)
  }) as any;
  req.json = async () => body;
  req.nextUrl = new URL('http://localhost/api/sqlpacketload');
  return req;
}

describe('POST /api/sqlpacketload authz', () => {
  let mockConnectionManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionManager = ConnectionManager.getInstance();
    vi.mocked(insertIngestionFailureRows).mockResolvedValue([]);
    handleUpsertMock.mockResolvedValue({ id: 1, operation: 'inserted' });
    getCookieMock.mockResolvedValue(undefined);
    // Token check mocked to WOULD-PASS so any 403 must originate from the membership check.
    requireUploadSessionOwnershipMock.mockResolvedValue(undefined);
    resetTemporaryMeasurementsSourceFormatColumnCacheForTests();
    mockConnectionManager.beginTransaction.mockResolvedValue('tx-test');
    mockConnectionManager.commitTransaction.mockResolvedValue(undefined);
    mockConnectionManager.rollbackTransaction.mockResolvedValue(undefined);
  });

  it('denies a non-admin user outside the schema scope with 403 BEFORE any SQL or the token check', async () => {
    authMock.mockResolvedValue({ user: { email: ATTACKER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] } });

    const { POST } = await import('@/app/api/sqlpacketload/route');
    const res = (await POST(makeMeasurementRequest(FOREIGN_SCHEMA)))!;

    expect(res.status).toBe(HTTP_FORBIDDEN);
    // Inline membership check short-circuits before the body branches: no DB work,
    // no transaction, and the retained token check is never reached.
    expect(mockConnectionManager.executeQuery).not.toHaveBeenCalled();
    expect(mockConnectionManager.beginTransaction).not.toHaveBeenCalled();
    expect(requireUploadSessionOwnershipMock).not.toHaveBeenCalled();
  });

  it('allows a non-admin member with a valid token to reach the temporarymeasurements insert path (200)', async () => {
    authMock.mockResolvedValue({ user: { email: MEMBER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] } });

    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ PlotID: TEST_PLOT_ID }])
      .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    const { POST } = await import('@/app/api/sqlpacketload/route');
    const res = (await POST(makeMeasurementRequest(MEMBER_SCHEMA)))!;

    expect(res.status).toBe(HTTP_OK);
    const body = await res.json();
    expect(body.insertedCount).toBe(1);
    // Retained token check ran for the member on the measurements branch.
    expect(requireUploadSessionOwnershipMock).toHaveBeenCalledTimes(1);
  });
});
