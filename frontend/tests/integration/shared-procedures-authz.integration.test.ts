import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Task 3 authz regression suite for the two streaming validation routes:
 *   - POST /api/validations/procedures/shared-dbh
 *   - POST /api/validations/procedures/shared-cross-census-location
 *
 * Both must authenticate (auth()) and authorize the body `schema`
 * (assertSchemaAccess) BEFORE any DB work. A non-member schema for a non-admin
 * session must be rejected with 403 and must NOT invoke the downstream
 * validation function. An admin session must pass the gate and reach the
 * streaming path (200).
 */

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

// A schema the non-admin session is a member of, and a DIFFERENT one it POSTs.
const MEMBER_SCHEMA = 'forestgeo_panama';
const FOREIGN_SCHEMA = 'forestgeo_serc';

const ADMIN_EMAIL = 'admin@forestgeo.test';
const ATTACKER_EMAIL = 'attacker@forestgeo.test';
const MEMBER_EMAIL = 'member@forestgeo.test';

// Default session is a 'global' admin so the route's auth() gate and
// assertSchemaAccess pass; individual tests override with mockResolvedValueOnce
// to exercise the non-admin denial path. Mocking @/auth also keeps the real
// next-auth module (whose lib/env.js imports the extensionless `next/server`
// subpath) from being loaded by Node's native ESM resolver, which cannot resolve it.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: ADMIN_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

// Stub the downstream validation functions so the authorized path is
// deterministic (no real DB) and so we can assert the 403 path never reaches
// them — proving the authz gate short-circuits before any DB work.
const validationSpies = vi.hoisted(() => ({
  runCombinedDBHValidations: vi.fn(async () => ({ totalProcessed: 0, errors: [] })),
  runCombinedCrossCensusLocationValidations: vi.fn(async () => ({ totalProcessed: 0, errors: [] }))
}));

vi.mock('@/components/processors/processorhelperfunctions', () => ({
  runCombinedDBHValidations: validationSpies.runCombinedDBHValidations,
  runCombinedCrossCensusLocationValidations: validationSpies.runCombinedCrossCensusLocationValidations
}));

interface StreamingRouteCase {
  name: string;
  routePath: string;
  validationSpy: ReturnType<typeof vi.fn>;
}

const ROUTE_CASES: StreamingRouteCase[] = [
  {
    name: 'shared-dbh',
    routePath: '@/app/api/validations/procedures/shared-dbh/route',
    validationSpy: validationSpies.runCombinedDBHValidations
  },
  {
    name: 'shared-cross-census-location',
    routePath: '@/app/api/validations/procedures/shared-cross-census-location/route',
    validationSpy: validationSpies.runCombinedCrossCensusLocationValidations
  }
];

function buildRequest(routeName: string, schema: string): NextRequest {
  return new NextRequest(`http://localhost/api/validations/procedures/${routeName}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schema, p_CensusID: 1, p_PlotID: 1 })
  });
}

describe.each(ROUTE_CASES)('POST /api/validations/procedures/$name authz gate', ({ name, routePath, validationSpy }) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies a schema outside the non-admin user site scope with 403 and never runs the validation', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: ATTACKER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { POST } = await import(routePath);
    const res = await POST(buildRequest(name, FOREIGN_SCHEMA));

    expect(res.status).toBe(HTTP_FORBIDDEN);
    // The authz gate must short-circuit BEFORE any DB work is scheduled.
    expect(validationSpy).not.toHaveBeenCalled();
  });

  it('allows an admin session to reach the streaming path (admin-bypass branch)', async () => {
    const { POST } = await import(routePath);
    const res = await POST(buildRequest(name, FOREIGN_SCHEMA));

    expect(res.status).toBe(HTTP_OK);
    // Drain the stream so the wrapped operation completes.
    await res.text();
    expect(validationSpy).toHaveBeenCalledWith(FOREIGN_SCHEMA, { p_CensusID: 1, p_PlotID: 1 });
  });

  it('allows a non-admin member of the requested schema to reach the streaming path (member branch)', async () => {
    // Guards against a future regression that over-restricts legitimate members:
    // this exercises hasSchemaAccess, NOT the admin bypass.
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: MEMBER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { POST } = await import(routePath);
    const res = await POST(buildRequest(name, MEMBER_SCHEMA));

    expect(res.status).not.toBe(HTTP_FORBIDDEN);
    expect(res.status).toBe(HTTP_OK);
    // Drain the stream so the wrapped operation completes.
    await res.text();
    expect(validationSpy).toHaveBeenCalledWith(MEMBER_SCHEMA, { p_CensusID: 1, p_PlotID: 1 });
  });
});
