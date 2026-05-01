import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { NextRequest } from 'next/server';

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
});
