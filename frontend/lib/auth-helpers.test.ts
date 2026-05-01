import { describe, it, expect } from 'vitest';
import { requireSession, requireAdmin } from './auth-helpers';

const adminSession = { user: { email: 'a@example.com', userStatus: 'global', sites: [], allsites: [] } } as any;
const dbAdminSession = { user: { email: 'd@example.com', userStatus: 'db admin', sites: [], allsites: [] } } as any;
const fieldCrewSession = { user: { email: 'f@example.com', userStatus: 'field crew', sites: [], allsites: [] } } as any;

describe('requireSession', () => {
  it('returns null when session present', () => {
    expect(requireSession(adminSession)).toBeNull();
  });

  it('returns 401 NextResponse when session is null', () => {
    const res = requireSession(null);
    expect(res?.status).toBe(401);
  });

  it('returns 401 when session has no user', () => {
    expect(requireSession({} as any)?.status).toBe(401);
  });

  it('returns 503 when permissions could not be verified', async () => {
    const res = requireSession({ user: { email: 'u@example.com', permissionsUnavailable: true, sites: [], allsites: [] } } as any);
    expect(res?.status).toBe(503);
    await expect(res!.json()).resolves.toEqual({ error: 'permissions unavailable' });
  });
});

describe('requireAdmin', () => {
  it('returns null for global', () => {
    expect(requireAdmin(adminSession)).toBeNull();
  });

  it('returns null for db admin', () => {
    expect(requireAdmin(dbAdminSession)).toBeNull();
  });

  it('returns 403 for field crew', async () => {
    const res = requireAdmin(fieldCrewSession);
    expect(res?.status).toBe(403);
    const body = await res!.json();
    expect(body.error).toMatch(/admin/i);
  });

  it('returns 403 for lead technician', () => {
    const session = { user: { email: 'l@example.com', userStatus: 'lead technician', sites: [], allsites: [] } } as any;
    const res = requireAdmin(session);
    expect(res?.status).toBe(403);
  });

  it('returns 403 for pending', () => {
    const session = { user: { email: 'p@example.com', userStatus: 'pending', sites: [], allsites: [] } } as any;
    const res = requireAdmin(session);
    expect(res?.status).toBe(403);
  });

  it('returns 401 when session is null', () => {
    const res = requireAdmin(null);
    expect(res?.status).toBe(401);
  });

  it('returns 503 when admin permissions could not be verified', () => {
    const res = requireAdmin({ user: { email: 'a@example.com', permissionsUnavailable: true, sites: [], allsites: [] } } as any);
    expect(res?.status).toBe(503);
  });
});
