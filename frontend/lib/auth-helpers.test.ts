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

  it('returns 401 when session is null', () => {
    const res = requireAdmin(null);
    expect(res?.status).toBe(401);
  });
});
