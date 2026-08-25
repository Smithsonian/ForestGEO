import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';
import { GET } from './route';
import { E2E_AUTH_POLL_ALLOWED_SITES, E2E_AUTH_POLL_EMAIL, E2E_AUTH_POLL_USER_STATUS } from './constants';
import { fetchAuthoritativeAuthorization } from '@/config/editplan/authorization';

// The gate must be evaluated per-request so a deploy can never bake an
// "enabled" answer into the module: every case below toggles env and calls
// the SAME imported handler.

const ROUTE_URL = `http://localhost:3000/api/e2e-auth-poll?email=${encodeURIComponent(E2E_AUTH_POLL_EMAIL)}`;

function makeRequest(url = ROUTE_URL) {
  return new Request(url);
}

describe('GET /api/e2e-auth-poll (hard-gated e2e-only stub)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_E2E_TESTING', 'true');
    vi.stubEnv('NODE_ENV', 'development');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('gating (must fail closed)', () => {
    it('404s when NEXT_PUBLIC_E2E_TESTING is unset', async () => {
      vi.stubEnv('NEXT_PUBLIC_E2E_TESTING', '');
      const response = await GET(makeRequest());
      expect(response.status).toBe(HTTPResponses.NOT_FOUND);
    });

    it('404s when NEXT_PUBLIC_E2E_TESTING is anything but the literal "true"', async () => {
      vi.stubEnv('NEXT_PUBLIC_E2E_TESTING', 'TRUE');
      const response = await GET(makeRequest());
      expect(response.status).toBe(HTTPResponses.NOT_FOUND);
    });

    it('404s in a production build even with the e2e flag on', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const response = await GET(makeRequest());
      expect(response.status).toBe(HTTPResponses.NOT_FOUND);
    });

    it('never leaks the poll payload through a gated response', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const body = await (await GET(makeRequest())).json();
      expect(body).not.toHaveProperty('userStatus');
      expect(body).not.toHaveProperty('allowedSites');
    });
  });

  describe('enabled behavior', () => {
    it('serves the poll shape for exactly the seeded e2e admin email', async () => {
      const response = await GET(makeRequest());
      expect(response.status).toBe(HTTPResponses.OK);
      const body = await response.json();
      expect(body.userStatus).toBe(E2E_AUTH_POLL_USER_STATUS);
      expect(body.allowedSites).toEqual(E2E_AUTH_POLL_ALLOWED_SITES);
    });

    it('404s for any other email so an unexpected identity still fails closed to 401 upstream', async () => {
      const response = await GET(makeRequest('http://localhost:3000/api/e2e-auth-poll?email=someone-else%40forestgeo.si.edu'));
      expect(response.status).toBe(HTTPResponses.NOT_FOUND);
    });

    it('404s when the email parameter is missing entirely', async () => {
      const response = await GET(makeRequest('http://localhost:3000/api/e2e-auth-poll'));
      expect(response.status).toBe(HTTPResponses.NOT_FOUND);
    });
  });

  describe('compatibility with the real consumer (authorization.ts is unchanged)', () => {
    it('the stub payload survives the genuine fetchAuthoritativeAuthorization role check', async () => {
      const routeResponse = await GET(makeRequest());
      expect(routeResponse.status).toBe(HTTPResponses.OK);
      const payload = await routeResponse.json();

      vi.stubEnv('AUTH_FUNCTIONS_POLL_URL', 'http://localhost:3000/api/e2e-auth-poll');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload), { status: HTTPResponses.OK }) as any);
      try {
        const snapshot = await fetchAuthoritativeAuthorization(E2E_AUTH_POLL_EMAIL);
        expect(snapshot).not.toBeNull();
        expect(snapshot?.userStatus).toBe(E2E_AUTH_POLL_USER_STATUS);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('the stub allowedSites map to schemaName through the REAL sites mapper (not the test passthrough)', async () => {
      // The global unit setup (tests/mocks/auth-mocks.ts) replaces
      // @/config/datamapper with a passthrough sites mapper, so the flow test
      // above cannot see the mapped schemaName. Pull in the genuine module to
      // prove the wire shape this route serves is what the production
      // GenericMapper('sites') expects — the edit-plan schema-access gate
      // reads site.schemaName off exactly this mapping.
      const actual = await vi.importActual<typeof import('@/config/datamapper')>('@/config/datamapper');
      const realMapperFactory = actual.default;
      const mapped = realMapperFactory.getMapper<any, any>('sites').mapData(E2E_AUTH_POLL_ALLOWED_SITES as any[]);
      expect(mapped).toHaveLength(1);
      expect(mapped[0].schemaName).toBe('forestgeo_testing');
      expect(Number(mapped[0].siteID)).toBe(1);
    });

    it('a gated 404 makes the genuine fetchAuthoritativeAuthorization return null (fails closed, no throw-through)', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const routeResponse = await GET(makeRequest());
      expect(routeResponse.status).toBe(HTTPResponses.NOT_FOUND);

      vi.stubEnv('AUTH_FUNCTIONS_POLL_URL', 'http://localhost:3000/api/e2e-auth-poll');
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify(await routeResponse.json()), { status: HTTPResponses.NOT_FOUND }) as any);
      try {
        const snapshot = await fetchAuthoritativeAuthorization(E2E_AUTH_POLL_EMAIL);
        expect(snapshot).toBeNull();
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });
});
