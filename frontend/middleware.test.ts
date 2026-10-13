import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { NextRequest } from 'next/server';
import { createRequire } from 'node:module';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';

// Mock NextAuth before importing middleware so the wrapper can be intercepted.
vi.mock('next-auth', () => {
  return {
    default: vi.fn(() => ({
      auth: (handler: any) => handler
    }))
  };
});

vi.mock('@/auth.config', () => ({
  default: { providers: [] }
}));

function makeRequest(pathname: string, authed = false): NextRequest {
  const url = new URL(`http://localhost${pathname}`);
  return {
    nextUrl: Object.assign(url, { clone: () => new URL(url.toString()) }),
    auth: authed ? { user: { email: 'u@example.com' } } : null
  } as unknown as NextRequest;
}

async function withE2EDisabled<T>(fn: () => Promise<T>): Promise<T> {
  const savedE2E = process.env.NEXT_PUBLIC_E2E_TESTING;
  process.env.NEXT_PUBLIC_E2E_TESTING = 'false';
  try {
    return await fn();
  } finally {
    process.env.NEXT_PUBLIC_E2E_TESTING = savedE2E;
  }
}

describe('middleware', () => {
  beforeEach(() => vi.resetModules());

  it('does not import Node-only modules (@/auth, @/ailogger, @/lib/permissionscache, @/config/datamapper)', async () => {
    const middlewarePath = path.resolve(__dirname, 'middleware.ts');
    const fileContents = await fs.readFile(middlewarePath, 'utf8');
    expect(fileContents).not.toMatch(/from '@\/auth'/);
    expect(fileContents).not.toMatch(/from '@\/ailogger'/);
    expect(fileContents).not.toMatch(/from '@\/lib\/permissionscache'/);
    expect(fileContents).not.toMatch(/from '@\/config\/datamapper'/);
  });

  it('lets /api/health through unauthenticated', async () => {
    await withE2EDisabled(async () => {
      const mod = await import('./middleware');
      const req = makeRequest('/api/health', false);
      const res = await mod.default(req as any);
      expect(res?.status).toBe(200);
    });
  });

  it('redirects unauthenticated /dashboard to /login', async () => {
    await withE2EDisabled(async () => {
      const mod = await import('./middleware');
      const req = makeRequest('/dashboard', false);
      const res = await mod.default(req as any);
      expect(res?.headers.get('location')).toContain('/login');
    });
  });

  it('redirects unauthenticated / to /login', async () => {
    await withE2EDisabled(async () => {
      const mod = await import('./middleware');
      const req = makeRequest('/', false);
      const res = await mod.default(req as any);
      expect(res?.headers.get('location')).toContain('/login');
    });
  });

  it('redirects authenticated / to /dashboard', async () => {
    await withE2EDisabled(async () => {
      const mod = await import('./middleware');
      const req = makeRequest('/', true);
      const res = await mod.default(req as any);
      expect(res?.headers.get('location')).toContain('/dashboard');
    });
  });
});

describe('middleware /api/* gating', () => {
  beforeEach(() => vi.resetModules());

  it('returns 401 JSON for unauthenticated /api/cleanup', async () => {
    await withE2EDisabled(async () => {
      const mod = await import('./middleware');
      const req = makeRequest('/api/cleanup', false);
      const res = await mod.default(req as any);
      expect(res?.status).toBe(401);
      expect(res?.headers.get('content-type')).toMatch(/application\/json/);
    });
  });

  it('lets /api/auth/callback through unauthenticated (NextAuth handlers)', async () => {
    await withE2EDisabled(async () => {
      const mod = await import('./middleware');
      const req = makeRequest('/api/auth/callback', false);
      const res = await mod.default(req as any);
      expect(res?.status).toBe(200);
    });
  });

  it('does not treat auth-prefixed APIs as public unless they are /api/auth children', async () => {
    await withE2EDisabled(async () => {
      const mod = await import('./middleware');
      const req = makeRequest('/api/authentication/status', false);
      const res = await mod.default(req as any);
      expect(res?.status).toBe(401);
    });
  });

  it('lets authenticated /api/cleanup through', async () => {
    await withE2EDisabled(async () => {
      const mod = await import('./middleware');
      const req = makeRequest('/api/cleanup', true);
      const res = await mod.default(req as any);
      expect(res?.status).toBe(200);
    });
  });

  it('E2E bypass passes /api/cleanup through even when unauthenticated (ordering invariant)', async () => {
    const savedE2E = process.env.NEXT_PUBLIC_E2E_TESTING;
    const savedNodeEnv = process.env.NODE_ENV;
    process.env.NEXT_PUBLIC_E2E_TESTING = 'true';
    process.env.NODE_ENV = 'development';
    try {
      const mod = await import('./middleware');
      const req = makeRequest('/api/cleanup', false);
      const res = await mod.default(req as any);
      expect(res?.status).toBe(200);
    } finally {
      process.env.NEXT_PUBLIC_E2E_TESTING = savedE2E;
      process.env.NODE_ENV = savedNodeEnv;
    }
  });

  it('lets /api/customsignin through unauthenticated', async () => {
    await withE2EDisabled(async () => {
      const mod = await import('./middleware');
      const req = makeRequest('/api/customsignin', false);
      const res = await mod.default(req as any);
      expect(res?.status).toBe(200);
    });
  });

  it.each(['/api/clearallcookies', '/api/diagnostics/streaming-timeout', '/api/animations/startup.lottie'])(
    'lets public legacy API %s through unauthenticated',
    async pathname => {
      await withE2EDisabled(async () => {
        const mod = await import('./middleware');
        const req = makeRequest(pathname, false);
        const res = await mod.default(req as any);
        expect(res?.status).toBe(200);
      });
    }
  );

  it('keeps catalog user lookup behind API auth', async () => {
    await withE2EDisabled(async () => {
      const mod = await import('./middleware');
      const req = makeRequest('/api/catalog/Ada/Lovelace', false);
      const res = await mod.default(req as any);
      expect(res?.status).toBe(401);
    });
  });
});

// Next clones and buffers every middleware-matched request body against the global 10 MiB
// middlewareClientMaxBodySize, even when middleware rejects (verified 2026-10-12). Upload routes
// authenticate in the handler and bound their own bodies, so they must be excluded from the
// matcher. Look-alike paths must stay matched.
describe('upload routes bypass middleware body buffering', () => {
  const PATHS_EXCLUDED_FROM_MIDDLEWARE = ['/api/files/upload?schema=forestgeo_rabi&fileName=census2.csv', '/api/arcgis/preflight'];
  const PATHS_STILL_MATCHED = [
    '/api/files/uploadx',
    '/api/files/upload/extra',
    '/api/files/download',
    '/api/files/list',
    '/api/arcgis/preflightx',
    '/api/uploadjobs',
    '/api/cleanup',
    '/dashboard'
  ];

  async function middlewareConfig() {
    const { config } = await import('./middleware');
    return config;
  }

  it.each(PATHS_EXCLUDED_FROM_MIDDLEWARE)('does not run middleware for %s', async url => {
    const config = await middlewareConfig();
    expect(unstable_doesMiddlewareMatch({ config, url }), `matcher=${JSON.stringify(config.matcher)}`).toBe(false);
  });

  it.each(PATHS_STILL_MATCHED)('still runs middleware for %s', async url => {
    const config = await middlewareConfig();
    expect(unstable_doesMiddlewareMatch({ config, url }), `matcher=${JSON.stringify(config.matcher)}`).toBe(true);
  });

  it('does not raise the global pre-authentication body buffer in next.config.js', () => {
    const nextConfig = createRequire(import.meta.url)('./next.config.js');
    expect(
      nextConfig.experimental?.middlewareClientMaxBodySize,
      'raising this buffers larger bodies for every matched route before auth; exclude upload routes from the matcher instead'
    ).toBeUndefined();
  });
});
