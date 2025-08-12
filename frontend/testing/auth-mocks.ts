// test/auth-mocks.ts
import { beforeEach, vi } from 'vitest';
import { RouteHandler } from '@/testing/supportstruts';

// ------------------------------------
// 1) Mock Microsoft Entra ID provider
// ------------------------------------
vi.mock('@auth/core/providers/microsoft-entra-id', () => {
  // The real provider is a function that returns a provider config object.
  const MicrosoftEntraID = (opts?: any) => ({ id: 'microsoft-entra-id', type: 'oauth', options: opts ?? {} });
  return { default: MicrosoftEntraID };
});

// ------------------------------------
// 2) Mock MapperFactory used by auth.ts
//    Only need 'sites' -> mapData(..)
// ------------------------------------
vi.mock('@/config/datamapper', () => {
  const sitesMapper = {
    mapData: (rows: any[]) => rows.map((row, i) => ({ id: i + 1, ...row })),
    demapData: vi.fn()
  };
  const MapperFactory = {
    getMapper: vi.fn((type: string) => {
      if (type === 'sites') return sitesMapper;
      // keep it obvious if something unexpected is requested
      throw new Error(`Mapper mock does not support type: ${type}`);
    })
  };
  return { default: MapperFactory };
});

// ------------------------------------
// 3) Mock cookie manager (server action)
// ------------------------------------
const submitCookie = vi.fn(async (_name: string, _val: string) => {});
vi.mock('@/app/actions/cookiemanager', () => ({
  submitCookie
}));

// ------------------------------------
// 4) Fetch queue for session callback
// ------------------------------------
type Queued = () => Promise<Response>;
const fetchQueue: Queued[] = [];
function pushFetchOk(json: any, init: Partial<Response> = {}) {
  fetchQueue.push(
    async () =>
      new Response(JSON.stringify(json), {
        status: init.status ?? 200,
        headers: new Headers({ 'content-type': 'application/json', ...((init.headers as unknown as Record<string, string>) ?? {}) })
      })
  );
}
function pushFetchFail(status = 500, body: any = { error: 'fail' }) {
  fetchQueue.push(async () => new Response(JSON.stringify(body), { status, headers: new Headers({ 'content-type': 'application/json' }) }));
}
const fetchMock = vi.fn(async (..._args: any[]) => {
  const next = fetchQueue.shift();
  if (!next) throw new Error('No queued fetch response. Use pushFetchOk/pushFetchFail in your test.');
  return next();
});

// provide a global fetch for Node test env
// (Vitest 1.x supports vi.stubGlobal)
if (!(globalThis as any).fetch) {
  vi.stubGlobal('fetch', fetchMock);
} else {
  // in case another setup installed it, still spy on it
  (globalThis as any).fetch = fetchMock;
}

// ------------------------------------
// 5) Mock next-auth itself
//    - capture the config passed to NextAuth()
//    - return testable handles
// ------------------------------------
type AnyObj = Record<string, any>;
let lastConfig: AnyObj | null = null;

const handlers = {
  GET: vi.fn(),
  POST: vi.fn()
};

const authFn = vi.fn(async (..._args: any[]) => ({}));
const signIn = vi.fn(async (..._args: any[]) => ({}));
const signOut = vi.fn(async (..._args: any[]) => ({}));

function NextAuth(config: AnyObj) {
  lastConfig = config;
  return { auth: authFn, handlers, signIn, signOut };
}

vi.mock('next-auth', () => ({
  default: NextAuth
}));

// ------------------------------------
// 6) Env vars needed by auth.ts
// ------------------------------------
process.env.AUTH_SECRET ??= 'test_secret';
process.env.AUTH_FUNCTIONS_POLL_URL ??= 'https://example.test/auth/user';

// ------------------------------------
// 7) Per-test hygiene + helper exports
// ------------------------------------
function subrouteFrom(req: Request, ctx?: { params?: { nextauth?: string[] } }): string | undefined {
  const fromCtx = ctx?.params?.nextauth?.[0];
  if (fromCtx) return fromCtx;
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  return parts[parts.length - 1];
}

function installDefaultHandlers() {
  (handlers.GET as any).mockImplementation(async (req: Request, ctx?: { params?: { nextauth?: string[] } }) => {
    const sub = subrouteFrom(req, ctx);

    if (sub === 'session') {
      try {
        // ✅ Pass values that match NextAuth v5's shape closely enough for your code:
        await lastConfig?.callbacks?.session?.({
          session: { user: { email: 'x@y.z' } } as any,
          token: {} as any,
          user: undefined,
          trigger: 'get', // <-- important for some implementations
          // request isn't always used, but some code inspects it:
          request: { headers: new Headers(), body: null } as any
        });
      } catch {
        // swallow; the route returns 200 either way in this mock
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    // default no-op for other subroutes
    return new Response(null, { status: 200 });
  });

  (handlers.POST as any).mockImplementation(async (req: Request, ctx?: { params?: { nextauth?: string[] } }) => {
    const sub = subrouteFrom(req, ctx);

    // minimal realism for /signin: return a normal 200 (or 302 if you prefer)
    if (sub === 'signin') {
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 200 });
  });
}

beforeEach(() => {
  authFn.mockClear();
  (handlers.GET as any).mockReset();
  (handlers.POST as any).mockReset();
  signIn.mockClear();
  signOut.mockClear();
  submitCookie.mockClear();
  fetchMock.mockClear();
  fetchQueue.length = 0;

  installDefaultHandlers(); // re-install defaults every test
});

type SessionOkPayload = {
  userStatus: string;
  allowedSites: Array<Record<string, any>>;
  allSites: Array<Record<string, any>>;
};

function makeSessionOkPayload(overrides: Partial<SessionOkPayload> = {}): SessionOkPayload {
  return {
    userStatus: overrides.userStatus ?? 'active',
    // shape can be anything; your sites mapper just maps row objects
    allowedSites: overrides.allowedSites ?? [{ siteName: 'Alpha' }, { siteName: 'Beta' }],
    allSites: overrides.allSites ?? [{ siteName: 'Alpha' }, { siteName: 'Beta' }, { siteName: 'Gamma' }]
  };
}

export const __auth = {
  getConfig: () => lastConfig,
  pushFetchOk,
  pushFetchFail,
  submitCookie,
  makeSessionOkPayload, // <-- export it
  spies: { authFn, handlers, signIn, signOut, fetchMock }
};
