import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Per-site authorization regression suite for GET /api/setupbulkcollapser/[censusID].
 *
 * Phase-3 posture: this route already authorized via an upload-session TOKEN
 * (`requireUploadSessionOwnership`), which proves the token owns the plot/census
 * but NOT that the AUTHENTICATED USER is a member of the target schema. We layer
 * an explicit user→schema membership gate (`withRouteAuthz` + `fromQuery('schema')`)
 * ON TOP of the retained token check — defense in depth.
 *
 * The security contract these tests pin:
 *   - a non-admin session that is NOT a member of the requested schema gets 403,
 *     and the MEMBERSHIP gate short-circuits BEFORE the token check and before any
 *     SQL. We mock `requireUploadSessionOwnership` to "would-pass" so a 403 proves
 *     the membership gate denied (not the token), AND assert the token check was
 *     never even reached.
 *   - an authorized member WITH a valid (mocked) token reaches the DB path (200).
 */

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

const MEMBER_SCHEMA = 'forestgeo_panama';
const FOREIGN_SCHEMA = 'forestgeo_serc';

const ADMIN_EMAIL = 'admin@forestgeo.test';
const ATTACKER_EMAIL = 'attacker@forestgeo.test';
const MEMBER_EMAIL = 'member@forestgeo.test';

const TEST_CENSUS_ID = '6';
const TEST_SESSION_ID = 'session-1';

// Default session is a 'global' admin so withRouteAuthz passes; individual tests
// override with mockResolvedValueOnce to exercise the non-admin denial path.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: { email: ADMIN_EMAIL, userStatus: 'global', sites: [] }
  }))
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

const dbSpies = vi.hoisted(() => ({
  withTransaction: vi.fn(async (fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<unknown>) =>
    fn({ query: vi.fn(async () => []) })
  ),
  closeConnection: vi.fn(async () => undefined)
}));

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      withTransaction: dbSpies.withTransaction,
      closeConnection: dbSpies.closeConnection
    })
  }
}));

function buildRequest(schema: string): NextRequest {
  const req = new NextRequest(`http://localhost/api/setupbulkcollapser/${TEST_CENSUS_ID}?schema=${schema}`, {
    method: 'GET',
    headers: { 'x-upload-session-id': TEST_SESSION_ID }
  });
  return req;
}

function makeContext() {
  return { params: Promise.resolve({ censusID: TEST_CENSUS_ID }) } as any;
}

describe('GET /api/setupbulkcollapser/[censusID] authz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Token check is mocked to WOULD-PASS so any 403 must originate from the
    // membership gate, not the token.
    requireUploadSessionOwnershipMock.mockResolvedValue(undefined);
  });

  it('denies a non-admin user outside the schema scope with 403 BEFORE the token check or any SQL', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: ATTACKER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/setupbulkcollapser/[censusID]/route');
    const res = await GET(buildRequest(FOREIGN_SCHEMA), makeContext());

    expect(res.status).toBe(HTTP_FORBIDDEN);
    // Membership gate short-circuits: the token check (would-pass) is never reached...
    expect(requireUploadSessionOwnershipMock).not.toHaveBeenCalled();
    // ...and no DB work is scheduled.
    expect(dbSpies.withTransaction).not.toHaveBeenCalled();
  });

  it('allows a non-admin member with a valid token to reach the collapser DB path (200)', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: MEMBER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/setupbulkcollapser/[censusID]/route');
    const res = await GET(buildRequest(MEMBER_SCHEMA), makeContext());

    expect(res.status).toBe(HTTP_OK);
    // Both the retained token check and the collapser transaction ran for a member.
    expect(requireUploadSessionOwnershipMock).toHaveBeenCalledTimes(1);
    expect(dbSpies.withTransaction).toHaveBeenCalledTimes(1);
  });
});
