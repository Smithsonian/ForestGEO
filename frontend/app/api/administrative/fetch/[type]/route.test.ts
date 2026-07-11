import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  executeQuery: vi.fn(async (): Promise<any> => []),
  beginTransaction: vi.fn(async () => 'tx-1'),
  commitTransaction: vi.fn(async () => {}),
  rollbackTransaction: vi.fn(async () => {}),
  closeConnection: vi.fn(async () => {}),
  mapData: vi.fn((rows: any[]) => rows),
  demapData: vi.fn((rows: any[]) => rows),
  invalidatePermissions: vi.fn()
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      executeQuery: mocks.executeQuery,
      beginTransaction: mocks.beginTransaction,
      commitTransaction: mocks.commitTransaction,
      rollbackTransaction: mocks.rollbackTransaction,
      closeConnection: mocks.closeConnection
    })
  }
}));
vi.mock('@/config/datamapper', () => ({
  default: {
    getMapper: () => ({ mapData: mocks.mapData, demapData: mocks.demapData })
  }
}));
vi.mock('@/lib/permissionscache', () => ({
  invalidatePermissions: mocks.invalidatePermissions
}));

import { GET, POST, PATCH, DELETE } from './route';

function makeReq(url: string, body?: unknown): NextRequest {
  return new NextRequest(url, body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : undefined);
}

const params = (type: string) => ({ params: Promise.resolve({ type }) });

describe('/api/administrative/fetch/[type] auth gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET → 401 when no session', async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await GET(makeReq('http://x/api/administrative/fetch/users'), params('users'));
    expect(res.status).toBe(401);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
    expect(mocks.beginTransaction).not.toHaveBeenCalled();
  });

  it('GET → 403 when non-admin', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'f@x', userStatus: 'field crew' } });
    const res = await GET(makeReq('http://x/api/administrative/fetch/users'), params('users'));
    expect(res.status).toBe(403);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
    expect(mocks.beginTransaction).not.toHaveBeenCalled();
  });

  it('GET → 200 when global admin', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'a@x', userStatus: 'global' } });
    const res = await GET(makeReq('http://x/api/administrative/fetch/users'), params('users'));
    expect(res.status).toBe(200);
  });

  it('user administration requires the global role', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'db@x', userStatus: 'db admin' } });
    const res = await GET(makeReq('http://x/api/administrative/fetch/users'), params('users'));
    expect(res.status).toBe(403);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('GET → preserves paginated format toggle when ?email= is present', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'a@x', userStatus: 'global' } });
    const res = await GET(makeReq('http://x/api/administrative/fetch/users?email=ignored'), params('users'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('output');
    expect(body).toHaveProperty('totalCount');
  });

  it('POST → 403 when non-admin (no email-query bypass)', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'f@x', userStatus: 'field crew' } });
    const res = await POST(makeReq('http://x/api/administrative/fetch/users?email=admin@evil.com', { newRow: { firstName: 'X' } }), params('users'));
    expect(res.status).toBe(403);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
    expect(mocks.beginTransaction).not.toHaveBeenCalled();
  });

  it('POST → 401 when no session even with email query', async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await POST(makeReq('http://x/api/administrative/fetch/users?email=any@x.com', { newRow: { firstName: 'X' } }), params('users'));
    expect(res.status).toBe(401);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
    expect(mocks.beginTransaction).not.toHaveBeenCalled();
  });

  it('rejects resource names outside the administrative allow-list', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'a@x', userStatus: 'global' } });
    const res = await POST(makeReq('http://x/api/administrative/fetch/secrets', { newRow: { value: 'x' } }), params('secrets'));
    expect(res.status).toBe(400);
    expect(mocks.beginTransaction).not.toHaveBeenCalled();
  });

  it('validates new users and returns the database user id', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'a@x', userStatus: 'global' } });
    mocks.executeQuery.mockResolvedValueOnce({ insertId: 42 });
    const res = await POST(
      makeReq('http://x/api/administrative/fetch/users', {
        newRow: { firstName: ' Ada ', lastName: ' Lovelace ', email: 'ADA@example.com', notifications: true, userStatus: 'field crew' }
      }),
      params('users')
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ userID: 42 });
    expect(mocks.executeQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO catalog.users'),
      ['Ada', 'Lovelace', 'ada@example.com', true, 'field crew'],
      'tx-1'
    );
  });

  it('rejects malformed new users without executing an insert', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'a@x', userStatus: 'global' } });
    const res = await POST(
      makeReq('http://x/api/administrative/fetch/users', {
        newRow: { firstName: '', lastName: '', email: 'not-an-email', notifications: 'yes', userStatus: 'owner' }
      }),
      params('users')
    );
    expect(res.status).toBe(400);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
    expect(mocks.rollbackTransaction).toHaveBeenCalledWith('tx-1');
  });

  it('PATCH → 403 when non-admin', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'f@x', userStatus: 'field crew' } });
    const res = await PATCH(
      makeReq('http://x/api/administrative/fetch/users', {
        oldRow: { userID: 1, userSites: [], notifications: '' },
        newRow: { userID: 1, userSites: [], notifications: '' }
      }),
      params('users')
    );
    expect(res.status).toBe(403);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
    expect(mocks.beginTransaction).not.toHaveBeenCalled();
  });

  it('DELETE → 401 when no session (no cookie bypass)', async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await DELETE(makeReq('http://x/api/administrative/fetch/users', { newRow: { UserID: 1 } }), params('users'));
    expect(res.status).toBe(401);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
    expect(mocks.beginTransaction).not.toHaveBeenCalled();
  });

  it('DELETE → 403 when non-admin', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'f@x', userStatus: 'field crew' } });
    const res = await DELETE(makeReq('http://x/api/administrative/fetch/users', { newRow: { UserID: 1 } }), params('users'));
    expect(res.status).toBe(403);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
    expect(mocks.beginTransaction).not.toHaveBeenCalled();
  });

  it('PATCH → invalidates old and new user emails after a successful admin mutation', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'a@x', userStatus: 'global' } });
    const res = await PATCH(
      makeReq('http://x/api/administrative/fetch/users', {
        oldRow: { userID: 1, email: 'old@example.com', userSites: [], notifications: '' },
        newRow: { userID: 1, email: 'new@example.com', userSites: [], notifications: '' }
      }),
      params('users')
    );

    expect(res.status).toBe(200);
    expect(mocks.invalidatePermissions).toHaveBeenCalledWith('old@example.com');
    expect(mocks.invalidatePermissions).toHaveBeenCalledWith('new@example.com');
  });

  it('POST → clears the permission cache when a site changes', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'a@x', userStatus: 'global' } });
    const res = await POST(makeReq('http://x/api/administrative/fetch/sites', { newRow: { siteName: 'BCI' } }), params('sites'));

    expect(res.status).toBe(200);
    expect(mocks.invalidatePermissions).toHaveBeenCalledWith();
  });
});
