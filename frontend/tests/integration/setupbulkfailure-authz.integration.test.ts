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
  moveTemporaryBatchToFailedMeasurements: vi.fn(async () => 3),
  moveTemporarySubBatchesToFailedMeasurements: vi.fn(async () => 0)
}));

vi.mock('@/lib/batchfailuretransfer', () => ({
  moveTemporaryBatchToFailedMeasurements: transferSpies.moveTemporaryBatchToFailedMeasurements,
  moveTemporarySubBatchesToFailedMeasurements: transferSpies.moveTemporarySubBatchesToFailedMeasurements
}));

const dbSpies = vi.hoisted(() => ({
  executeQuery: vi.fn(async () => [{ PlotID: 22, CensusID: 6 }]),
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

function buildRequest(schema: string): NextRequest {
  return new NextRequest(`http://localhost/api/setupbulkfailure/${TEST_FILE_ID}/${TEST_BATCH_ID}?schema=${schema}`, {
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
    dbSpies.executeQuery.mockResolvedValue([{ PlotID: 22, CensusID: 6 }]);
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
    expect(transferSpies.moveTemporaryBatchToFailedMeasurements).toHaveBeenCalledTimes(1);
  });
});
