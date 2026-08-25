import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Per-site authorization regression suite for
 * GET /api/setupbulkprocessor/[schema]/[plotID]/[censusID].
 *
 * Phase-3 posture: the route previously authorized via an upload-session TOKEN
 * (`requireUploadSessionOwnership`) only. We layer an explicit user→schema
 * membership gate (`withRouteAuthz` + `fromPath('schema')`) ON TOP of the
 * retained token check. The schema here is a PATH segment, so `fromPath` is the
 * resolver.
 *
 * Contract pinned here:
 *   - a non-admin session outside the requested schema gets 403, and the
 *     membership gate short-circuits BEFORE the token check and before any SQL.
 *     The token is mocked to "would-pass" so a 403 proves the MEMBERSHIP gate.
 *   - an authorized member WITH a valid (mocked) token reaches the batch-discovery
 *     path (200).
 */

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

const MEMBER_SCHEMA = 'forestgeo_panama';
const FOREIGN_SCHEMA = 'forestgeo_serc';

const ADMIN_EMAIL = 'admin@forestgeo.test';
const ATTACKER_EMAIL = 'attacker@forestgeo.test';
const MEMBER_EMAIL = 'member@forestgeo.test';

const TEST_PLOT_ID = '22';
const TEST_CENSUS_ID = '6';
const TEST_SESSION_ID = 'session-1';

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: ADMIN_EMAIL, userStatus: 'global', sites: [] } }))
}));

vi.mock('@/ailogger', () => ({
  default: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }
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
  UploadSessionState: { UPLOADED: 'uploaded', PROCESSING: 'processing', COLLAPSING: 'collapsing' }
}));

const dbSpies = vi.hoisted(() => ({
  executeQuery: vi.fn(async () => [])
}));

vi.mock('@/lib/db/connectionmanager', () => ({
  default: { getInstance: () => ({ executeQuery: dbSpies.executeQuery }) }
}));

function buildRequest(schema: string): NextRequest {
  return new NextRequest(`http://localhost/api/setupbulkprocessor/${schema}/${TEST_PLOT_ID}/${TEST_CENSUS_ID}`, {
    method: 'GET',
    headers: { 'x-upload-session-id': TEST_SESSION_ID }
  });
}

function makeContext(schema: string) {
  return { params: Promise.resolve({ schema, plotID: TEST_PLOT_ID, censusID: TEST_CENSUS_ID }) } as any;
}

describe('GET /api/setupbulkprocessor/[schema]/[plotID]/[censusID] authz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUploadSessionOwnershipMock.mockResolvedValue(undefined);
    dbSpies.executeQuery.mockResolvedValue([]);
  });

  it('denies a non-admin user outside the schema scope with 403 BEFORE the token check or any SQL', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: ATTACKER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/setupbulkprocessor/[schema]/[plotID]/[censusID]/route');
    const res = await GET(buildRequest(FOREIGN_SCHEMA), makeContext(FOREIGN_SCHEMA));

    expect(res.status).toBe(HTTP_FORBIDDEN);
    expect(requireUploadSessionOwnershipMock).not.toHaveBeenCalled();
    expect(dbSpies.executeQuery).not.toHaveBeenCalled();
  });

  it('allows a non-admin member with a valid token to reach the batch-discovery path (200)', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: MEMBER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/setupbulkprocessor/[schema]/[plotID]/[censusID]/route');
    const res = await GET(buildRequest(MEMBER_SCHEMA), makeContext(MEMBER_SCHEMA));

    expect(res.status).toBe(HTTP_OK);
    // Retained token check ran, and the discovery query executed for a member.
    expect(requireUploadSessionOwnershipMock).toHaveBeenCalledTimes(1);
    expect(dbSpies.executeQuery).toHaveBeenCalledTimes(1);
  });
});
