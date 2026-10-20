import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Per-site authorization regression suite for
 * GET /api/setupbulkfailure/[fileID]/[batchID].
 *
 * Phase-3 posture: this route previously authorized via an upload-session TOKEN
 * (`requireUploadSessionOwnership`) plus `validateSchemaOrThrow` — neither of
 * which proves the AUTHENTICATED USER is a member of the target schema. We layer
 * an explicit user→schema membership gate (`withRouteAuthz` + `fromQuery('schema')`)
 * ON TOP of the retained token + schema-shape checks.
 *
 * Contract pinned here:
 *   - a non-admin session outside the requested schema gets 403, and the
 *     membership gate short-circuits BEFORE the token check and before any SQL.
 *     The token is mocked to "would-pass" so a 403 proves the MEMBERSHIP gate.
 *   - an authorized member WITH a valid (mocked) token reaches the failure-transfer
 *     path (200).
 */

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

const MEMBER_SCHEMA = 'forestgeo_panama';
const FOREIGN_SCHEMA = 'forestgeo_serc';

const ADMIN_EMAIL = 'admin@forestgeo.test';
const ATTACKER_EMAIL = 'attacker@forestgeo.test';
const MEMBER_EMAIL = 'member@forestgeo.test';

const TEST_FILE_ID = 'file.csv';
const TEST_BATCH_ID = 'batch-1';
const TEST_SESSION_ID = 'session-1';
const TEST_PLOT_ID = 22;
const TEST_CENSUS_ID = 6;

function familyRow(batchID: string, rowCount: number) {
  return { BatchID: batchID, PlotID: TEST_PLOT_ID, CensusID: TEST_CENSUS_ID, rowCount, plotCount: 1, censusCount: 1 };
}
const EXACT_ONLY_FAMILY = [familyRow(TEST_BATCH_ID, 3)];

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: ADMIN_EMAIL, userStatus: 'global', sites: [] } }))
}));

vi.mock('@/ailogger', () => ({
  default: { info: () => undefined, warn: () => undefined, error: () => undefined }
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

vi.mock('@/config/uploadsessiontracker', () => ({
  requireUploadSessionOwnership: requireUploadSessionOwnershipMock,
  UploadSessionOwnershipError: MockUploadSessionOwnershipError,
  UploadSessionState: { PROCESSING: 'processing', COLLAPSING: 'collapsing' }
}));

const transferSpies = vi.hoisted(() => ({
  moveTemporaryBatchToFailedMeasurements: vi.fn(async () => 3)
}));

vi.mock('@/lib/batchfailuretransfer', () => ({
  moveTemporaryBatchToFailedMeasurements: transferSpies.moveTemporaryBatchToFailedMeasurements
}));

const dbSpies = vi.hoisted(() => ({
  executeQuery: vi.fn(async () => EXACT_ONLY_FAMILY),
  closeConnection: vi.fn(async () => undefined)
}));

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      executeQuery: dbSpies.executeQuery,
      closeConnection: dbSpies.closeConnection
    })
  }
}));

function buildRequest(schema: string, reason?: string): NextRequest {
  const reasonParam = reason === undefined ? '' : `&reason=${encodeURIComponent(reason)}`;
  return new NextRequest(`http://localhost/api/setupbulkfailure/${TEST_FILE_ID}/${TEST_BATCH_ID}?schema=${schema}${reasonParam}`, {
    method: 'GET',
    headers: { 'x-upload-session-id': TEST_SESSION_ID }
  });
}

function makeContext() {
  return { params: Promise.resolve({ fileID: TEST_FILE_ID, batchID: TEST_BATCH_ID }) } as any;
}

describe('GET /api/setupbulkfailure/[fileID]/[batchID] authz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUploadSessionOwnershipMock.mockResolvedValue(undefined);
    dbSpies.executeQuery.mockResolvedValue(EXACT_ONLY_FAMILY);
    transferSpies.moveTemporaryBatchToFailedMeasurements.mockResolvedValue(3);
  });

  it('denies a non-admin user outside the schema scope with 403 BEFORE the token check or any SQL', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: ATTACKER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/setupbulkfailure/[fileID]/[batchID]/route');
    const res = await GET(buildRequest(FOREIGN_SCHEMA), makeContext());

    expect(res.status).toBe(HTTP_FORBIDDEN);
    expect(requireUploadSessionOwnershipMock).not.toHaveBeenCalled();
    expect(dbSpies.executeQuery).not.toHaveBeenCalled();
    expect(transferSpies.moveTemporaryBatchToFailedMeasurements).not.toHaveBeenCalled();
  });

  it('allows a non-admin member with a valid token to reach the failure-transfer path (200)', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: MEMBER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/setupbulkfailure/[fileID]/[batchID]/route');
    const res = await GET(buildRequest(MEMBER_SCHEMA), makeContext());

    expect(res.status).toBe(HTTP_OK);
    // Retained token check ran, and the failure transfer executed for a member.
    expect(requireUploadSessionOwnershipMock).toHaveBeenCalledTimes(1);
    // The route always declares this call site's kind explicitly — a required
    // param proves *a* kind was passed, but the exact-args check below proves
    // it's the *correct* one ('sql_exception' for this system-failure path).
    expect(transferSpies.moveTemporaryBatchToFailedMeasurements).toHaveBeenCalledWith(
      expect.anything(),
      MEMBER_SCHEMA,
      TEST_FILE_ID,
      TEST_BATCH_ID,
      'Batch moved after max attempts',
      'sql_exception',
      undefined,
      expect.objectContaining({ plotID: TEST_PLOT_ID, censusID: TEST_CENSUS_ID, changedBy: expect.any(String) })
    );
  });
});

/**
 * This route is the one failure-transfer boundary whose kind is not known by
 * its caller: the browser sends whatever killed its setupbulkprocedure request
 * as free text. Hardcoding 'sql_exception' here is what recorded 106,227 clean
 * Harvard Forest rows as if each carried an ingestion SQL error after an Azure
 * front-end timeout.
 */
describe('GET /api/setupbulkfailure/[fileID]/[batchID] failure-kind classification', () => {
  const INTERRUPTION_REASON = 'Server error 504: 504.0 GatewayTimeout';
  const GENUINE_SQL_REASON = 'Server error 500: Duplicate entry for key uq_coremeasurements';

  beforeEach(() => {
    vi.clearAllMocks();
    requireUploadSessionOwnershipMock.mockResolvedValue(undefined);
    dbSpies.executeQuery.mockResolvedValue(EXACT_ONLY_FAMILY);
    transferSpies.moveTemporaryBatchToFailedMeasurements.mockResolvedValue(3);
  });

  it('records a front-end timeout as interrupted_upload, not as a per-row ingestion error', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: MEMBER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/setupbulkfailure/[fileID]/[batchID]/route');
    const res = await GET(buildRequest(MEMBER_SCHEMA, INTERRUPTION_REASON), makeContext());

    expect(res.status).toBe(HTTP_OK);
    expect(transferSpies.moveTemporaryBatchToFailedMeasurements).toHaveBeenCalledWith(
      expect.anything(),
      MEMBER_SCHEMA,
      TEST_FILE_ID,
      TEST_BATCH_ID,
      INTERRUPTION_REASON,
      'interrupted_upload',
      undefined,
      expect.objectContaining({ plotID: TEST_PLOT_ID, censusID: TEST_CENSUS_ID, changedBy: expect.any(String) })
    );
  });

  it('keeps a genuine server-side failure as sql_exception', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: MEMBER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/setupbulkfailure/[fileID]/[batchID]/route');
    const res = await GET(buildRequest(MEMBER_SCHEMA, GENUINE_SQL_REASON), makeContext());

    expect(res.status).toBe(HTTP_OK);
    expect(transferSpies.moveTemporaryBatchToFailedMeasurements).toHaveBeenCalledWith(
      expect.anything(),
      MEMBER_SCHEMA,
      TEST_FILE_ID,
      TEST_BATCH_ID,
      GENUINE_SQL_REASON,
      'sql_exception',
      undefined,
      expect.objectContaining({ plotID: TEST_PLOT_ID, censusID: TEST_CENSUS_ID, changedBy: expect.any(String) })
    );
  });

  it('moves every discovered family member in its own transaction, with the same kind and no rediscovery', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: MEMBER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);
    const mixedFamily = [familyRow(TEST_BATCH_ID, 1), familyRow(`${TEST_BATCH_ID}__sub001`, 4), familyRow(`${TEST_BATCH_ID}__sub002`, 2)];
    dbSpies.executeQuery.mockResolvedValueOnce(mixedFamily);

    const { GET } = await import('@/app/api/setupbulkfailure/[fileID]/[batchID]/route');
    const res = await GET(buildRequest(MEMBER_SCHEMA, INTERRUPTION_REASON), makeContext());

    const movedBatchIDs = transferSpies.moveTemporaryBatchToFailedMeasurements.mock.calls.map(call => (call as unknown[])[3]);
    console.log('[mixed-family] status=', res.status, 'route queries=', dbSpies.executeQuery.mock.calls.length, 'moved members=', movedBatchIDs);
    expect(res.status).toBe(HTTP_OK);
    expect(dbSpies.executeQuery).toHaveBeenCalledTimes(1);
    expect(movedBatchIDs).toEqual(mixedFamily.map(row => row.BatchID));
    for (const row of mixedFamily) {
      expect(transferSpies.moveTemporaryBatchToFailedMeasurements).toHaveBeenCalledWith(
        expect.anything(),
        MEMBER_SCHEMA,
        TEST_FILE_ID,
        row.BatchID,
        INTERRUPTION_REASON,
        'interrupted_upload',
        undefined,
        expect.objectContaining({ plotID: TEST_PLOT_ID, censusID: TEST_CENSUS_ID, changedBy: expect.any(String) })
      );
    }
  });
});
