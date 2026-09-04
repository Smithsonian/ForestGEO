import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { withRouteAuthz, fromQuery, fromPath, fromPathSegment, fromBody } from '@/lib/route-authz';
import type { RouteKey } from '@/lib/route-policy';
// Globally mocked in tests/mocks/db-mocks.ts; these cases drive it per test.
import { findSchemaQuarantine } from '@/lib/schema-quarantine';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_INTERNAL_SERVER_ERROR = 500;

const ADMIN_ROLE = 'global';
const NON_ADMIN_ROLE = 'field crew';

const SCHEMA_QUARANTINED_CODE = 'SCHEMA_QUARANTINED';
const SCHEMA_GATE_UNAVAILABLE_CODE = 'SCHEMA_GATE_UNAVAILABLE';
const QUARANTINED_SCHEMA = 'forestgeo_serc';
const quarantineRecord = { schemaName: QUARANTINED_SCHEMA, quarantinedAt: new Date('2026-09-02T18:04:11Z'), reason: 'DRIFT', runRef: null };
const quarantinedRequest = () => new NextRequest(`http://localhost/api/validations/validationlist?schema=${QUARANTINED_SCHEMA}`);

const makeHandler = () => vi.fn(async () => new Response('ok', { status: HTTP_OK }));
const emptyCtx = { params: Promise.resolve({}) };

describe('withRouteAuthz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies a site-scoped schema outside the session sites with 403', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { userStatus: NON_ADMIN_ROLE, sites: [{ schemaName: 'forestgeo_panama' }] } } as any);
    const handler = makeHandler();
    const wrapped = withRouteAuthz('validations/validationlist', handler, { schema: fromQuery('schema') });
    const req = new NextRequest('http://localhost/api/validations/validationlist?schema=forestgeo_serc');
    const res = await wrapped(req, emptyCtx);
    expect(res.status).toBe(HTTP_FORBIDDEN);
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows a site-scoped schema inside the session sites', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { userStatus: NON_ADMIN_ROLE, sites: [{ schemaName: 'forestgeo_serc' }] } } as any);
    const handler = makeHandler();
    const wrapped = withRouteAuthz('validations/validationlist', handler, { schema: fromQuery('schema') });
    const req = new NextRequest('http://localhost/api/validations/validationlist?schema=forestgeo_serc');
    const res = await wrapped(req, emptyCtx);
    expect(res.status).toBe(HTTP_OK);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('allows an admin session on an admin route', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { userStatus: ADMIN_ROLE, sites: [] } } as any);
    const handler = makeHandler();
    const wrapped = withRouteAuthz('structure/[schema]', handler);
    const req = new NextRequest('http://localhost/api/structure/forestgeo_serc');
    const res = await wrapped(req, { params: Promise.resolve({ schema: 'forestgeo_serc' }) });
    expect(res.status).toBe(HTTP_OK);
  });

  it('rejects a non-admin session on an admin route with 403', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { userStatus: NON_ADMIN_ROLE, sites: [] } } as any);
    const handler = makeHandler();
    const wrapped = withRouteAuthz('structure/[schema]', handler);
    const req = new NextRequest('http://localhost/api/structure/forestgeo_serc');
    const res = await wrapped(req, { params: Promise.resolve({ schema: 'forestgeo_serc' }) });
    expect(res.status).toBe(HTTP_FORBIDDEN);
    expect(handler).not.toHaveBeenCalled();
  });

  it('fails closed (400) when a site-scoped resolver yields no schema', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { userStatus: ADMIN_ROLE, sites: [] } } as any);
    const handler = makeHandler();
    const wrapped = withRouteAuthz('validations/validationlist', handler, { schema: fromQuery('schema') });
    const req = new NextRequest('http://localhost/api/validations/validationlist');
    const res = await wrapped(req, emptyCtx);
    expect(res.status).toBe(HTTP_BAD_REQUEST);
    expect(handler).not.toHaveBeenCalled();
  });

  it('fails closed (500) for an unknown route key', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { userStatus: ADMIN_ROLE, sites: [] } } as any);
    const handler = makeHandler();
    // Cast: `keyof typeof ROUTE_POLICIES` makes a literal typo a compile error, but a
    // deleted/forced key can still reach the runtime — this exercises that fail-closed path.
    const wrapped = withRouteAuthz('does/not/exist' as RouteKey, handler);
    const req = new NextRequest('http://localhost/api/does/not/exist');
    const res = await wrapped(req, emptyCtx);
    expect(res.status).toBe(HTTP_INTERNAL_SERVER_ERROR);
    expect(handler).not.toHaveBeenCalled();
  });

  it('runs a public-policy handler without ever calling auth()', async () => {
    const handler = makeHandler();
    const wrapped = withRouteAuthz('health', handler);
    const req = new NextRequest('http://localhost/api/health');
    const res = await wrapped(req, emptyCtx);
    expect(res.status).toBe(HTTP_OK);
    expect(handler).toHaveBeenCalledOnce();
    expect(auth).not.toHaveBeenCalled();
  });

  it('returns 503 when the session reports permissions unavailable on an authed path', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { userStatus: ADMIN_ROLE, sites: [], permissionsUnavailable: true } } as any);
    const handler = makeHandler();
    const wrapped = withRouteAuthz('structure/[schema]', handler);
    const req = new NextRequest('http://localhost/api/structure/forestgeo_serc');
    const res = await wrapped(req, { params: Promise.resolve({ schema: 'forestgeo_serc' }) });
    expect(res.status).toBe(HTTP_SERVICE_UNAVAILABLE);
    expect(handler).not.toHaveBeenCalled();
  });

  it('resolves the schema from a path param (fromPath) and allows a member session', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { userStatus: NON_ADMIN_ROLE, sites: [{ schemaName: 'forestgeo_serc' }] } } as any);
    const handler = makeHandler();
    const wrapped = withRouteAuthz('dashboardmetrics/all/[schema]/[plotID]/[censusID]', handler, { schema: fromPath('schema') });
    const req = new NextRequest('http://localhost/api/dashboardmetrics/all/forestgeo_serc/1/2');
    const res = await wrapped(req, { params: Promise.resolve({ schema: 'forestgeo_serc', plotID: '1', censusID: '2' }) });
    expect(res.status).toBe(HTTP_OK);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('denies a fromPath schema outside the session sites with 403', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { userStatus: NON_ADMIN_ROLE, sites: [{ schemaName: 'forestgeo_panama' }] } } as any);
    const handler = makeHandler();
    const wrapped = withRouteAuthz('dashboardmetrics/all/[schema]/[plotID]/[censusID]', handler, { schema: fromPath('schema') });
    const req = new NextRequest('http://localhost/api/dashboardmetrics/all/forestgeo_serc/1/2');
    const res = await wrapped(req, { params: Promise.resolve({ schema: 'forestgeo_serc', plotID: '1', censusID: '2' }) });
    expect(res.status).toBe(HTTP_FORBIDDEN);
    expect(handler).not.toHaveBeenCalled();
  });

  it('resolves the schema from a catch-all path segment and allows a member session', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { userStatus: NON_ADMIN_ROLE, sites: [{ schemaName: 'forestgeo_serc' }] } } as any);
    const handler = makeHandler();
    const wrapped = withRouteAuthz('formdownload/[dataType]/[[...slugs]]', handler, { schema: fromPathSegment('slugs', 0) });
    const req = new NextRequest('http://localhost/api/formdownload/attributes/forestgeo_serc/1/2');
    const res = await wrapped(req, { params: Promise.resolve({ dataType: 'attributes', slugs: ['forestgeo_serc', '1', '2'] }) });
    expect(res.status).toBe(HTTP_OK);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('fails closed (500) for a site-scoped route with no schema resolver configured', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { userStatus: NON_ADMIN_ROLE, sites: [{ schemaName: 'forestgeo_serc' }] } } as any);
    const handler = makeHandler();
    const wrapped = withRouteAuthz('validations/validationlist', handler);
    const req = new NextRequest('http://localhost/api/validations/validationlist?schema=forestgeo_serc');
    const res = await wrapped(req, emptyCtx);
    expect(res.status).toBe(HTTP_INTERNAL_SERVER_ERROR);
    expect(handler).not.toHaveBeenCalled();
  });

  it('leaves the request body readable by the handler after fromBody resolves the schema', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { userStatus: NON_ADMIN_ROLE, sites: [{ schemaName: 'forestgeo_serc' }] } } as any);
    const handler = vi.fn(async (request: NextRequest) => {
      const body = await request.json();
      return Response.json({ echoedGridType: body.gridType });
    });
    const wrapped = withRouteAuthz('bulkcrud', handler, { schema: fromBody('schema') });
    const req = new NextRequest('http://localhost/api/bulkcrud', {
      method: 'POST',
      body: JSON.stringify({ schema: 'forestgeo_serc', gridType: 'stems' }),
      headers: { 'content-type': 'application/json' }
    });
    const res = await wrapped(req, emptyCtx);
    expect(res.status).toBe(HTTP_OK);
    expect(handler).toHaveBeenCalledOnce();
    const payload = await res.json();
    expect(payload.echoedGridType).toBe('stems');
  });
  it('refuses a member session on a quarantined schema with 503 SCHEMA_QUARANTINED', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { userStatus: NON_ADMIN_ROLE, sites: [{ schemaName: QUARANTINED_SCHEMA }] } } as any);
    vi.mocked(findSchemaQuarantine).mockResolvedValueOnce(quarantineRecord);
    const handler = makeHandler();
    const wrapped = withRouteAuthz('validations/validationlist', handler, { schema: fromQuery('schema') });

    const res = await wrapped(quarantinedRequest(), emptyCtx);
    const body = await res.json();
    console.log(`[quarantined route] status=${res.status} body=${JSON.stringify(body)}`);

    expect(res.status).toBe(HTTP_SERVICE_UNAVAILABLE);
    expect(body.code).toBe(SCHEMA_QUARANTINED_CODE);
    expect(handler).not.toHaveBeenCalled();
  });

  it('still returns 403 for a non-member on a quarantined schema (quarantine is checked after authz)', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { userStatus: NON_ADMIN_ROLE, sites: [{ schemaName: 'forestgeo_panama' }] } } as any);
    const wrapped = withRouteAuthz('validations/validationlist', makeHandler(), { schema: fromQuery('schema') });

    const res = await wrapped(quarantinedRequest(), emptyCtx);

    expect(res.status).toBe(HTTP_FORBIDDEN);
    expect(findSchemaQuarantine).not.toHaveBeenCalled();
  });

  it('does not exempt admins from quarantine on a site-scoped route', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { userStatus: ADMIN_ROLE, sites: [] } } as any);
    vi.mocked(findSchemaQuarantine).mockResolvedValueOnce(quarantineRecord);
    const handler = makeHandler();
    const wrapped = withRouteAuthz('validations/validationlist', handler, { schema: fromQuery('schema') });

    const res = await wrapped(quarantinedRequest(), emptyCtx);

    expect(res.status).toBe(HTTP_SERVICE_UNAVAILABLE);
    expect(handler).not.toHaveBeenCalled();
  });

  it('fails closed with 503 SCHEMA_GATE_UNAVAILABLE when the lookup throws', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { userStatus: NON_ADMIN_ROLE, sites: [{ schemaName: QUARANTINED_SCHEMA }] } } as any);
    vi.mocked(findSchemaQuarantine).mockRejectedValueOnce(new Error('catalog unreachable'));
    const handler = makeHandler();
    const wrapped = withRouteAuthz('validations/validationlist', handler, { schema: fromQuery('schema') });

    const res = await wrapped(quarantinedRequest(), emptyCtx);

    expect(res.status).toBe(HTTP_SERVICE_UNAVAILABLE);
    expect((await res.json()).code).toBe(SCHEMA_GATE_UNAVAILABLE_CODE);
    expect(handler).not.toHaveBeenCalled();
  });
});
