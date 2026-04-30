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
    const savedE2E = process.env.NEXT_PUBLIC_E2E_TESTING;
    process.env.NEXT_PUBLIC_E2E_TESTING = 'false';
    try {
      const mod = await import('./middleware');
      const req = makeRequest('/api/health', false);
      const res = await mod.default(req as any);
      expect(res?.status).toBe(200);
    } finally {
      process.env.NEXT_PUBLIC_E2E_TESTING = savedE2E;
    }
  });

  it('redirects unauthenticated /dashboard to /login', async () => {
    const savedE2E = process.env.NEXT_PUBLIC_E2E_TESTING;
    process.env.NEXT_PUBLIC_E2E_TESTING = 'false';
    try {
      const mod = await import('./middleware');
      const req = makeRequest('/dashboard', false);
      const res = await mod.default(req as any);
      expect(res?.headers.get('location')).toContain('/login');
    } finally {
      process.env.NEXT_PUBLIC_E2E_TESTING = savedE2E;
    }
  });

  it('redirects unauthenticated / to /login', async () => {
    const savedE2E = process.env.NEXT_PUBLIC_E2E_TESTING;
    process.env.NEXT_PUBLIC_E2E_TESTING = 'false';
    try {
      const mod = await import('./middleware');
      const req = makeRequest('/', false);
      const res = await mod.default(req as any);
      expect(res?.headers.get('location')).toContain('/login');
    } finally {
      process.env.NEXT_PUBLIC_E2E_TESTING = savedE2E;
    }
  });

  it('redirects authenticated / to /dashboard', async () => {
    const savedE2E = process.env.NEXT_PUBLIC_E2E_TESTING;
    process.env.NEXT_PUBLIC_E2E_TESTING = 'false';
    try {
      const mod = await import('./middleware');
      const req = makeRequest('/', true);
      const res = await mod.default(req as any);
      expect(res?.headers.get('location')).toContain('/dashboard');
    } finally {
      process.env.NEXT_PUBLIC_E2E_TESTING = savedE2E;
    }
  });
});

describe('middleware /api/* gating', () => {
  beforeEach(() => vi.resetModules());

  it('returns 401 JSON for unauthenticated /api/cleanup', async () => {
    const savedE2E = process.env.NEXT_PUBLIC_E2E_TESTING;
    process.env.NEXT_PUBLIC_E2E_TESTING = 'false';
    try {
      const mod = await import('./middleware');
      const req = makeRequest('/api/cleanup', false);
      const res = await mod.default(req as any);
      expect(res?.status).toBe(401);
      expect(res?.headers.get('content-type')).toMatch(/application\/json/);
    } finally {
      process.env.NEXT_PUBLIC_E2E_TESTING = savedE2E;
    }
  });

  it('lets /api/auth/callback through unauthenticated (NextAuth handlers)', async () => {
    const savedE2E = process.env.NEXT_PUBLIC_E2E_TESTING;
    process.env.NEXT_PUBLIC_E2E_TESTING = 'false';
    try {
      const mod = await import('./middleware');
      const req = makeRequest('/api/auth/callback', false);
      const res = await mod.default(req as any);
      expect(res?.status).not.toBe(401);
    } finally {
      process.env.NEXT_PUBLIC_E2E_TESTING = savedE2E;
    }
  });

  it('lets authenticated /api/cleanup through', async () => {
    const savedE2E = process.env.NEXT_PUBLIC_E2E_TESTING;
    process.env.NEXT_PUBLIC_E2E_TESTING = 'false';
    try {
      const mod = await import('./middleware');
      const req = makeRequest('/api/cleanup', true);
      const res = await mod.default(req as any);
      expect(res?.status).not.toBe(401);
    } finally {
      process.env.NEXT_PUBLIC_E2E_TESTING = savedE2E;
    }
  });
});
