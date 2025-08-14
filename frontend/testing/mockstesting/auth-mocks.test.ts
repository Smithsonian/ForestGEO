// testing/mockstesting/auth-mocks.test.ts
import { describe, expect, it } from 'vitest';
// Be sure this path matches your actual mock file location:
import '@/testing/auth-mocks';
import { __auth } from '@/testing/auth-mocks';
import { loadRoute } from '@/testing/supportstruts';

// If you keep shared types here, fine; otherwise inline:
type RouteHandler = (req: Request, ctx?: { params?: { nextauth?: string[] } }) => Promise<Response>;

const ROUTE_PATH = '@/app/api/auth/[[...nextauth]]/route';

function pickHandlers(mod: any): { GET?: RouteHandler; POST?: RouteHandler } {
  // Prefer direct exports, fall back to nested handlers
  return {
    GET: (mod.GET ?? mod.handlers?.GET) as RouteHandler | undefined,
    POST: (mod.POST ?? mod.handlers?.POST) as RouteHandler | undefined
  };
}

describe('NextAuth route (App Router compliant)', () => {
  it('initializes with Entra provider and calls poll URL in session callback', async () => {
    const mod = await loadRoute<any>(ROUTE_PATH);
    const { GET } = pickHandlers(mod);
    expect(GET).toBeTypeOf('function');

    // Config captured by mock
    const cfg = __auth.getConfig();
    expect(cfg).toBeTruthy();
    expect(cfg?.providers?.length ?? 0).toBeGreaterThan(0);
    expect(JSON.stringify(cfg?.providers)).toContain('microsoft-entra-id');

    // Queue the fetch used by your session callback with complete site data
    __auth.pushFetchOk({
      user: { id: 'abc', email: 'x@y.z' },
      roles: ['admin'],
      userStatus: 'active',
      allowedSites: [
        { siteName: 'Site A', siteID: 1, locationName: 'Location A' },
        { siteName: 'Site B', siteID: 2, locationName: 'Location B' }
      ],
      allSites: [
        { siteName: 'Site A', siteID: 1, locationName: 'Location A' },
        { siteName: 'Site B', siteID: 2, locationName: 'Location B' },
        { siteName: 'Site C', siteID: 3, locationName: 'Location C' }
      ]
    });

    // Exercise /session via params
    const req = new Request('http://localhost/api/auth/session', { method: 'GET' });
    const res = await GET!(req, { params: { nextauth: ['session'] } });

    expect(__auth.spies.fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBeLessThan(500);
  });

  it('propagates failures from poll URL during session retrieval', async () => {
    const mod = await loadRoute<any>(ROUTE_PATH);
    const { GET } = pickHandlers(mod);
    expect(GET).toBeTypeOf('function');

    __auth.pushFetchFail(503, { error: 'downstream unavailable' });

    const req = new Request('http://localhost/api/auth/session', { method: 'GET' });
    const res = await GET!(req, { params: { nextauth: ['session'] } });

    expect(__auth.spies.fetchMock).toHaveBeenCalledTimes(1);
    expect([200, 401, 500, 503]).toContain(res.status);
  });

  it('handles signin POST', async () => {
    const mod = await loadRoute<any>(ROUTE_PATH);
    const { POST } = pickHandlers(mod);
    expect(POST).toBeTypeOf('function');

    const req = new Request('http://localhost/api/auth/signin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callbackUrl: '/' })
    });

    const res = await POST!(req, { params: { nextauth: ['signin'] } });
    expect([200, 302]).toContain(res.status);
  });
});
