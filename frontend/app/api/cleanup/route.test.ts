import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';

const { authMock, runSessionCleanupMock, ensureUploadSessionsTableMock, isValidSchemaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  runSessionCleanupMock: vi.fn(),
  ensureUploadSessionsTableMock: vi.fn(),
  isValidSchemaMock: vi.fn()
}));

vi.mock('@/auth', () => ({ auth: authMock }));

vi.mock('@/config/uploadsessiontracker', () => ({
  runSessionCleanup: runSessionCleanupMock,
  purgeOldSessions: vi.fn().mockResolvedValue(0),
  findStaleSessions: vi.fn().mockResolvedValue([]),
  findAbandonedSessionsNeedingCleanup: vi.fn().mockResolvedValue([]),
  ensureUploadSessionsTable: ensureUploadSessionsTableMock
}));

vi.mock('@/config/utils/sqlsecurity', () => ({
  isValidSchema: isValidSchemaMock
}));

vi.mock('@/lib/db/primitives', () => ({
  getConn: vi.fn().mockResolvedValue({ release: vi.fn() }),
  runQuery: vi.fn().mockResolvedValue([])
}));

vi.mock('@/ailogger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { GET, POST } from './route';

function postRequest(body: unknown) {
  const req = new Request('http://localhost/api/cleanup', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
  }) as any;
  req.nextUrl = new URL('http://localhost/api/cleanup');
  return req;
}

function getRequest(url = 'http://localhost/api/cleanup?schema=forestgeo_testing') {
  const req: any = new Request(url, { method: 'GET' });
  req.nextUrl = new URL(url);
  return req;
}

describe('cleanup admin route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'admin', userStatus: 'global' } });
    isValidSchemaMock.mockReturnValue(true);
    ensureUploadSessionsTableMock.mockResolvedValue(undefined);
    runSessionCleanupMock.mockResolvedValue({ staleMarked: 0, cleanedUp: 0, totalTempDeleted: 0 });
  });

  describe('POST', () => {
    it('401 when no session — no cleanup work performed', async () => {
      authMock.mockResolvedValueOnce(null);
      const res = await POST(postRequest({ schema: 'forestgeo_testing' }));
      expect(res.status).toBe(HTTPResponses.UNAUTHORIZED);
      expect(runSessionCleanupMock).not.toHaveBeenCalled();
      expect(ensureUploadSessionsTableMock).not.toHaveBeenCalled();
    });

    it('403 when non-admin — no cleanup work performed', async () => {
      authMock.mockResolvedValueOnce({ user: { id: 'user', userStatus: 'field crew' } });
      const res = await POST(postRequest({ schema: 'forestgeo_testing' }));
      expect(res.status).toBe(HTTPResponses.FORBIDDEN);
      expect(runSessionCleanupMock).not.toHaveBeenCalled();
      expect(ensureUploadSessionsTableMock).not.toHaveBeenCalled();
    });

    it('admin proceeds normally', async () => {
      const res = await POST(postRequest({ schema: 'forestgeo_testing' }));
      expect(res.status).toBe(HTTPResponses.OK);
      expect(ensureUploadSessionsTableMock).toHaveBeenCalledWith('forestgeo_testing');
    });
  });

  describe('GET', () => {
    it('401 when no session — no schema lookup performed', async () => {
      authMock.mockResolvedValueOnce(null);
      const res = await GET(getRequest());
      expect(res.status).toBe(HTTPResponses.UNAUTHORIZED);
      expect(ensureUploadSessionsTableMock).not.toHaveBeenCalled();
    });

    it('403 when non-admin — no schema lookup performed', async () => {
      authMock.mockResolvedValueOnce({ user: { id: 'user', userStatus: 'field crew' } });
      const res = await GET(getRequest());
      expect(res.status).toBe(HTTPResponses.FORBIDDEN);
      expect(ensureUploadSessionsTableMock).not.toHaveBeenCalled();
    });

    it('admin proceeds normally', async () => {
      const res = await GET(getRequest());
      expect(res.status).toBe(HTTPResponses.OK);
      expect(ensureUploadSessionsTableMock).toHaveBeenCalledWith('forestgeo_testing');
    });
  });
});
