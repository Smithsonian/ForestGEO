import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/config/connectionmanager', () => {
  return {
    default: {
      getInstance: () => ({
        executeQuery: vi.fn(async () => []),
        beginTransaction: vi.fn(async () => 'tx-1'),
        commitTransaction: vi.fn(async () => {}),
        rollbackTransaction: vi.fn(async () => {}),
        closeConnection: vi.fn(async () => {})
      })
    }
  };
});

vi.mock('@/config/datamapper', () => {
  return {
    default: {
      getMapper: () => ({
        mapData: (_results: unknown[]) => [],
        demapData: (rows: unknown[]) => rows
      })
    }
  };
});

import { auth } from '@/auth';
import { GET, POST, PATCH, DELETE } from './route';

function makeReq(url: string, body?: unknown): NextRequest {
  return new NextRequest(url, body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : undefined);
}

const params = (type: string) => ({ params: Promise.resolve({ type }) });

describe('/api/administrative/fetch/[type] auth gate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GET → 401 when no session', async () => {
    (auth as any).mockResolvedValue(null);
    const res = await GET(makeReq('http://x/api/administrative/fetch/users'), params('users'));
    expect(res.status).toBe(401);
  });

  it('GET → 403 when non-admin', async () => {
    (auth as any).mockResolvedValue({ user: { email: 'f@x', userStatus: 'field crew' } });
    const res = await GET(makeReq('http://x/api/administrative/fetch/users'), params('users'));
    expect(res.status).toBe(403);
  });

  it('GET → 200 when global admin', async () => {
    (auth as any).mockResolvedValue({ user: { email: 'a@x', userStatus: 'global' } });
    const res = await GET(makeReq('http://x/api/administrative/fetch/users'), params('users'));
    expect(res.status).toBe(200);
  });

  it('GET → preserves paginated format toggle when ?email= is present', async () => {
    (auth as any).mockResolvedValue({ user: { email: 'a@x', userStatus: 'global' } });
    const res = await GET(makeReq('http://x/api/administrative/fetch/users?email=ignored'), params('users'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('output');
    expect(body).toHaveProperty('totalCount');
  });

  it('POST → 403 when non-admin (no email-query bypass)', async () => {
    (auth as any).mockResolvedValue({ user: { email: 'f@x', userStatus: 'field crew' } });
    const res = await POST(makeReq('http://x/api/administrative/fetch/users?email=admin@evil.com', { newRow: { firstName: 'X' } }), params('users'));
    expect(res.status).toBe(403);
  });

  it('POST → 401 when no session even with email query', async () => {
    (auth as any).mockResolvedValue(null);
    const res = await POST(makeReq('http://x/api/administrative/fetch/users?email=any@x.com', { newRow: { firstName: 'X' } }), params('users'));
    expect(res.status).toBe(401);
  });

  it('PATCH → 403 when non-admin', async () => {
    (auth as any).mockResolvedValue({ user: { email: 'f@x', userStatus: 'field crew' } });
    const res = await PATCH(
      makeReq('http://x/api/administrative/fetch/users', {
        oldRow: { userID: 1, userSites: [], notifications: '' },
        newRow: { userID: 1, userSites: [], notifications: '' }
      }),
      params('users')
    );
    expect(res.status).toBe(403);
  });

  it('DELETE → 401 when no session (no cookie bypass)', async () => {
    (auth as any).mockResolvedValue(null);
    const res = await DELETE(makeReq('http://x/api/administrative/fetch/users', { newRow: { UserID: 1 } }), params('users'));
    expect(res.status).toBe(401);
  });

  it('DELETE → 403 when non-admin', async () => {
    (auth as any).mockResolvedValue({ user: { email: 'f@x', userStatus: 'field crew' } });
    const res = await DELETE(makeReq('http://x/api/administrative/fetch/users', { newRow: { UserID: 1 } }), params('users'));
    expect(res.status).toBe(403);
  });
});
