import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Per-site authorization regression suite for
 * GET /api/resettableview/[gridType]/[plotID]/[censusID].
 *
 * This route is "cookie-primary with an ungated query fallback":
 *   PRIMARY  — validateContextualValues(request, { requireSchema/Plot/Census })
 *              resolves schema + plot + census from query/cookie context and
 *              (by default) authorizes the schema against the caller's site
 *              membership, returning 403 for a non-member.
 *   FALLBACK — when validateContextualValues fails, the handler falls back to
 *              the raw `?schema=` query param plus the [plotID]/[censusID] path
 *              params and proceeds.
 *
 * The historical HOLE: any request carrying `?schema=FOREIGN` makes
 * validateContextualValues fail (it denies the non-member), but the fallback
 * then re-reads the SAME raw `?schema=` and ran the reset SQL WITHOUT a
 * membership check. Because the path always supplies plotID/censusID, the
 * fallback is the ONLY gate for the foreign-schema case — there is no separate
 * "primary 403" to observe, which is precisely why the route was unprotected.
 *
 * These tests pin:
 *   - FALLBACK non-member → 403 and NO transaction/SQL (the whole point), and
 *   - a schema member reaches the reset SQL both via the primary path AND via
 *     the fallback (legitimate cookie-primary flow preserved).
 *
 * If the inline auth()+assertSchemaAccess fallback gate were removed, the first
 * test would see 200 + executeQuery calls and FAIL.
 */

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

const MEMBER_SCHEMA = 'forestgeo_panama';
const FOREIGN_SCHEMA = 'forestgeo_serc';
const GRID_TYPE = 'alltaxonomiesview';
const PLOT_ID = '1';
const CENSUS_ID = '1';

const ATTACKER_EMAIL = 'attacker@forestgeo.test';
const MEMBER_EMAIL = 'member@forestgeo.test';

// Default session is a 'global' admin. Mocking @/auth also keeps the real
// next-auth module (whose lib/env.js imports the extensionless `next/server`
// subpath, unresolvable by Node's native ESM loader) from loading.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: { email: 'admin@forestgeo.test', userStatus: 'global', sites: [] }
  }))
}));

vi.mock('@/ailogger', () => ({
  default: { info: () => undefined, warn: () => undefined, error: () => undefined }
}));

// getCookie drives the context resolution inside validateContextualValues.
// Returning undefined for every cookie means schema must come from `?schema=`
// and, when plotID/censusID cookies are absent, the primary validation fails on
// the missing plot/census — forcing the fallback branch.
const cookieValues = vi.hoisted(() => ({ store: {} as Record<string, string | undefined> }));
vi.mock('@/app/actions/cookiemanager', () => ({
  getCookie: vi.fn(async (name: string) => cookieValues.store[name])
}));

const dbSpies = vi.hoisted(() => ({
  beginTransaction: vi.fn(async () => 'tx-resettableview'),
  executeQuery: vi.fn(async () => []),
  commitTransaction: vi.fn(async () => undefined),
  rollbackTransaction: vi.fn(async () => undefined),
  closeConnection: vi.fn(async () => undefined)
}));

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      beginTransaction: dbSpies.beginTransaction,
      executeQuery: dbSpies.executeQuery,
      commitTransaction: dbSpies.commitTransaction,
      rollbackTransaction: dbSpies.rollbackTransaction,
      closeConnection: dbSpies.closeConnection
    })
  }
}));

function buildRequest(schema: string, extraQuery: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost/api/resettableview/${GRID_TYPE}/${PLOT_ID}/${CENSUS_ID}`);
  url.searchParams.set('schema', schema);
  for (const [k, v] of Object.entries(extraQuery)) url.searchParams.set(k, v);
  return new NextRequest(url, { method: 'GET' });
}

function routeParams() {
  return { params: Promise.resolve({ gridType: GRID_TYPE, plotID: PLOT_ID, censusID: CENSUS_ID }) };
}

describe('GET /api/resettableview authz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieValues.store = {};
  });

  it('FALLBACK: denies a non-member requesting a foreign schema with 403 and runs NO transaction or SQL', async () => {
    // Non-member of FOREIGN_SCHEMA. validateContextualValues denies the schema
    // (success=false); the handler then enters the raw-`?schema=` fallback,
    // where the inline gate must re-deny before any DB work.
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValue({
      user: { email: ATTACKER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/resettableview/[gridType]/[plotID]/[censusID]/route');
    const res = await GET(buildRequest(FOREIGN_SCHEMA), routeParams());

    expect(res.status).toBe(HTTP_FORBIDDEN);
    expect(dbSpies.beginTransaction).not.toHaveBeenCalled();
    expect(dbSpies.executeQuery).not.toHaveBeenCalled();
  });

  it('PRIMARY: allows a schema member with full context to run the reset (200)', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValue({
      user: { email: MEMBER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/resettableview/[gridType]/[plotID]/[censusID]/route');
    // plotID/censusID supplied as query params so the primary validation succeeds.
    const res = await GET(buildRequest(MEMBER_SCHEMA, { plotID: PLOT_ID, censusID: CENSUS_ID }), routeParams());

    expect(res.status).toBe(HTTP_OK);
    expect(dbSpies.beginTransaction).toHaveBeenCalledTimes(1);
    expect(dbSpies.executeQuery).toHaveBeenCalled();
    expect(dbSpies.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('FALLBACK: allows a schema member via the fallback branch (missing plot/census context) — legitimate flow preserved (200)', async () => {
    // No plotID/censusID cookies or query params → primary validation fails on
    // missing plot/census → fallback uses the [plotID]/[censusID] path params.
    // The member clears the inline gate and the reset runs.
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValue({
      user: { email: MEMBER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/resettableview/[gridType]/[plotID]/[censusID]/route');
    const res = await GET(buildRequest(MEMBER_SCHEMA), routeParams());

    expect(res.status).toBe(HTTP_OK);
    expect(dbSpies.beginTransaction).toHaveBeenCalledTimes(1);
    expect(dbSpies.executeQuery).toHaveBeenCalled();
    expect(dbSpies.commitTransaction).toHaveBeenCalledTimes(1);
  });
});
