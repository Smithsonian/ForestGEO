import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Per-site authorization regression suite for
 * GET /api/changelog/overview/[changelogType]/[[...options]].
 *
 * This route is "cookie-primary with an ungated query fallback":
 *   PRIMARY  — validateContextualValues(request, { requireSchema }) resolves the
 *              schema from query/cookie context and (by default) authorizes it
 *              against the caller's site membership, returning 403 for a
 *              non-member.
 *   FALLBACK — when validateContextualValues fails, the handler falls back to
 *              the raw `?schema=` query param plus the [[...options]] path
 *              segments (plotID, plotCensusNumber) and proceeds.
 *
 * The historical HOLE: a request carrying `?schema=FOREIGN` makes
 * validateContextualValues fail (it denies the non-member), but the fallback
 * then re-reads the SAME raw `schemaParam` and ran the changelog SELECT WITHOUT
 * a membership check. The fallback is the only gate for the foreign-schema
 * case, which is why the route was unprotected.
 *
 * These tests pin:
 *   - FALLBACK non-member → 403 and NO SQL (the whole point), and
 *   - a schema member reaches the SELECT via the primary path (200).
 *
 * If the inline auth()+assertSchemaAccess fallback gate were removed, the first
 * test would see the SELECT run (executeQuery called) and FAIL.
 */

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

const MEMBER_SCHEMA = 'forestgeo_panama';
const FOREIGN_SCHEMA = 'forestgeo_serc';
const CHANGELOG_TYPE = 'unifiedchangelog';
const PLOT_ID = '1';
const PCN = '1';

const ATTACKER_EMAIL = 'attacker@forestgeo.test';
const MEMBER_EMAIL = 'member@forestgeo.test';

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: { email: 'admin@forestgeo.test', userStatus: 'global', sites: [] }
  }))
}));

vi.mock('@/ailogger', () => ({
  default: { info: () => undefined, warn: () => undefined, error: () => undefined }
}));

// Every cookie resolves to undefined so the schema must come from `?schema=`.
vi.mock('@/app/actions/cookiemanager', () => ({
  getCookie: vi.fn(async () => undefined)
}));

const dbSpies = vi.hoisted(() => ({
  executeQuery: vi.fn(async () => []),
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
  const url = new URL(`http://localhost/api/changelog/overview/${CHANGELOG_TYPE}/${PLOT_ID}/${PCN}`);
  url.searchParams.set('schema', schema);
  return new NextRequest(url, { method: 'GET' });
}

function routeParams() {
  return { params: Promise.resolve({ changelogType: CHANGELOG_TYPE, options: [PLOT_ID, PCN] }) };
}

describe('GET /api/changelog/overview authz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('FALLBACK: denies a non-member requesting a foreign schema with 403 and runs NO SQL', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValue({
      user: { email: ATTACKER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/changelog/overview/[changelogType]/[[...options]]/route');
    const res = await GET(buildRequest(FOREIGN_SCHEMA), routeParams());

    expect(res.status).toBe(HTTP_FORBIDDEN);
    expect(dbSpies.executeQuery).not.toHaveBeenCalled();
  });

  it('PRIMARY: allows a schema member to reach the changelog SELECT (200)', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValue({
      user: { email: MEMBER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/changelog/overview/[changelogType]/[[...options]]/route');
    const res = await GET(buildRequest(MEMBER_SCHEMA), routeParams());

    expect(res.status).toBe(HTTP_OK);
    expect(dbSpies.executeQuery).toHaveBeenCalledTimes(1);
    // The schema reached SQL only as a safeFormatQuery-escaped identifier.
    const [sql] = dbSpies.executeQuery.mock.calls[0] as unknown as [string];
    expect(sql).toContain('`forestgeo_panama`.unifiedchangelog');
  });
});
