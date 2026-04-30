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

  it('soft-fails poll URL failures into a 200 session with permissionsUnavailable', async () => {
    const mod = await loadRoute<any>(ROUTE_PATH);
    const { GET } = pickHandlers(mod);
    expect(GET).toBeTypeOf('function');

    __auth.pushFetchFail(503, { error: 'downstream unavailable' });

    const req = new Request('http://localhost/api/auth/session', { method: 'GET' });
    const res = await GET!(req, { params: { nextauth: ['session'] } });

    // The mock route handler calls the session callback internally then always
    // returns 200. The key assertion is that a poll-URL failure does NOT bubble
    // up as a 4xx/5xx — it soft-fails. The callback-level invariant (that the
    // resulting session carries permissionsUnavailable:true) is covered in
    // depth by the 'soft-fails permission fetch' test below.
    expect(__auth.spies.fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('only uses the E2E session shortcut for e2e-credentials tokens', async () => {
    const previousE2EFlag = process.env.NEXT_PUBLIC_E2E_TESTING;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NEXT_PUBLIC_E2E_TESTING = 'true';
    process.env.NODE_ENV = 'development';

    try {
      await loadRoute<any>(ROUTE_PATH);
      const cfg = __auth.getConfig();
      expect(cfg?.callbacks?.session).toBeTypeOf('function');
      expect(cfg?.callbacks?.jwt).toBeTypeOf('function');

      const e2eToken = await cfg.callbacks.jwt({
        token: { email: 'e2e-admin@forestgeo.si.edu' },
        user: { id: 'e2e-test-user', email: 'e2e-admin@forestgeo.si.edu', userStatus: 'global', sites: [], allsites: [] },
        account: { provider: 'e2e-credentials' }
      });

      const e2eSession = await cfg.callbacks.session({
        session: { user: { email: 'e2e-admin@forestgeo.si.edu' } },
        token: e2eToken
      });

      expect(__auth.spies.fetchMock).not.toHaveBeenCalled();
      expect(e2eSession.user.userStatus).toBe('global');

      __auth.pushFetchOk(__auth.makeSessionOkPayload());

      const normalSession = await cfg.callbacks.session({
        session: { user: { email: 'entra-user@forestgeo.si.edu' } },
        token: { email: 'entra-user@forestgeo.si.edu', isE2ETestUser: false }
      });

      expect(__auth.spies.fetchMock).toHaveBeenCalledTimes(1);
      expect(normalSession.user.userStatus).toBe('active');
    } finally {
      if (previousE2EFlag === undefined) {
        delete process.env.NEXT_PUBLIC_E2E_TESTING;
      } else {
        process.env.NEXT_PUBLIC_E2E_TESTING = previousE2EFlag;
      }

      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it('soft-fails permission fetch into a permissions-unavailable session (does not throw)', async () => {
    await loadRoute<any>(ROUTE_PATH);
    const cfg = __auth.getConfig();
    expect(cfg?.callbacks?.session).toBeTypeOf('function');

    __auth.pushFetchFail(503, { error: 'auth function down' });

    const result = await cfg.callbacks.session({
      session: { user: { email: 'transient-failure@example.com' } },
      token: { email: 'transient-failure@example.com', isE2ETestUser: false }
    });

    expect(result.user.email).toBe('transient-failure@example.com');
    expect(result.user.userStatus).toBeUndefined();
    expect(result.user.sites).toEqual([]);
    expect(result.user.allsites).toEqual([]);
    expect(result.user.permissionsUnavailable).toBe(true);
  });

  it('does NOT mark permissionsUnavailable on the success path', async () => {
    await loadRoute<any>(ROUTE_PATH);
    const cfg = __auth.getConfig();

    __auth.pushFetchOk(__auth.makeSessionOkPayload());

    const result = await cfg.callbacks.session({
      session: { user: { email: 'happy@example.com' } },
      token: { email: 'happy@example.com', isE2ETestUser: false }
    });

    expect(result.user.permissionsUnavailable).toBeUndefined();
    expect(result.user.userStatus).toBeDefined();
  });

  it('still throws when JWT has no email (tampered or malformed)', async () => {
    await loadRoute<any>(ROUTE_PATH);
    const cfg = __auth.getConfig();

    await expect(
      cfg.callbacks.session({
        session: { user: {} },
        token: { isE2ETestUser: false }
      })
    ).rejects.toThrow(/email/i);
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
