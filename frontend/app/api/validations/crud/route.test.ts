import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  executeQuery: vi.fn(async () => []),
  beginTransaction: vi.fn(async () => 'tx-1'),
  commitTransaction: vi.fn(async () => undefined),
  rollbackTransaction: vi.fn(async () => undefined),
  closeConnection: vi.fn(async () => undefined),
  mapData: vi.fn((rows: any[]) => rows),
  demapData: vi.fn((rows: any[]) => rows)
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/config/connectionmanager', () => ({
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

import { GET, POST, PATCH, DELETE } from './route';

function makeReq(method: string, url = 'http://localhost/api/validations/crud?schema=forestgeo_testing', body?: unknown): NextRequest {
  return new NextRequest(url, body === undefined ? { method } : { method, body: JSON.stringify(body) });
}

describe('/api/validations/crud auth gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns 401 when no session', async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await GET(makeReq('GET'));
    expect(res.status).toBe(401);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('POST returns 403 for non-admin users', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'f@example.com', userStatus: 'field crew', sites: [], allsites: [] } });
    const res = await POST(makeReq('POST', undefined, { procedureName: 'x' }));
    expect(res.status).toBe(403);
    expect(mocks.beginTransaction).not.toHaveBeenCalled();
  });

  it('POST returns 503 when permissions could not be verified', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'a@example.com', permissionsUnavailable: true, sites: [], allsites: [] } });
    const res = await POST(makeReq('POST', undefined, { procedureName: 'x' }));
    expect(res.status).toBe(503);
    expect(mocks.beginTransaction).not.toHaveBeenCalled();
  });

  it('GET validates schema before executing SQL', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'a@example.com', userStatus: 'global', sites: [], allsites: [] } });
    const res = await GET(makeReq('GET', 'http://localhost/api/validations/crud?schema=not_allowed'));
    expect(res.status).toBe(400);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('POST allows db admins and writes through the mapper', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'd@example.com', userStatus: 'db admin', sites: [], allsites: [] } });
    mocks.executeQuery.mockResolvedValueOnce({ insertId: 42 });
    const res = await POST(makeReq('POST', undefined, { procedureName: 'dbh_check', validationID: 999 }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ insertID: 42, validationID: 42 });
    expect(mocks.beginTransaction).toHaveBeenCalled();
    expect(mocks.executeQuery.mock.calls[0][0]).toContain('sitespecificvalidations');
  });

  it('PATCH and DELETE are admin-only', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'f@example.com', userStatus: 'field crew', sites: [], allsites: [] } });
    await expect(PATCH(makeReq('PATCH', undefined, { validationID: 1 }))).resolves.toHaveProperty('status', 403);
    await expect(DELETE(makeReq('DELETE', undefined, { validationID: 1 }))).resolves.toHaveProperty('status', 403);
    expect(mocks.beginTransaction).not.toHaveBeenCalled();
  });
});
