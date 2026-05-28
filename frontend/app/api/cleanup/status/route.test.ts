import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';

const { authMock, runGlobalCleanupMock, getCleanupStatusMock, startPeriodicCleanupMock, stopPeriodicCleanupMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  runGlobalCleanupMock: vi.fn(),
  getCleanupStatusMock: vi.fn(),
  startPeriodicCleanupMock: vi.fn(),
  stopPeriodicCleanupMock: vi.fn()
}));

vi.mock('@/auth', () => ({ auth: authMock }));

vi.mock('@/config/startupcleanup', () => ({
  runGlobalCleanup: runGlobalCleanupMock,
  startPeriodicCleanup: startPeriodicCleanupMock,
  stopPeriodicCleanup: stopPeriodicCleanupMock,
  getCleanupStatus: getCleanupStatusMock
}));

vi.mock('@/ailogger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { GET, POST } from './route';

function postRequest(body: unknown) {
  const req = new Request('http://localhost/api/cleanup/status', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
  }) as any;
  req.nextUrl = new URL('http://localhost/api/cleanup/status');
  return req;
}

describe('cleanup/status admin route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'admin', userStatus: 'global' } });
    getCleanupStatusMock.mockReturnValue({ running: false });
    runGlobalCleanupMock.mockResolvedValue({ schemasProcessed: 0 });
  });

  describe('GET', () => {
    it('401 when no session — does not read cleanup status', async () => {
      authMock.mockResolvedValueOnce(null);
      const res = await GET();
      expect(res.status).toBe(HTTPResponses.UNAUTHORIZED);
      expect(getCleanupStatusMock).not.toHaveBeenCalled();
    });

    it('403 when non-admin — does not read cleanup status', async () => {
      authMock.mockResolvedValueOnce({ user: { id: 'user', userStatus: 'field crew' } });
      const res = await GET();
      expect(res.status).toBe(HTTPResponses.FORBIDDEN);
      expect(getCleanupStatusMock).not.toHaveBeenCalled();
    });

    it('admin proceeds normally', async () => {
      const res = await GET();
      expect(res.status).toBe(HTTPResponses.OK);
      expect(getCleanupStatusMock).toHaveBeenCalled();
    });
  });

  describe('POST', () => {
    it('401 when no session — does not invoke global cleanup', async () => {
      authMock.mockResolvedValueOnce(null);
      const res = await POST(postRequest({ action: 'runGlobal' }));
      expect(res.status).toBe(HTTPResponses.UNAUTHORIZED);
      expect(runGlobalCleanupMock).not.toHaveBeenCalled();
      expect(startPeriodicCleanupMock).not.toHaveBeenCalled();
      expect(stopPeriodicCleanupMock).not.toHaveBeenCalled();
    });

    it('403 when non-admin — does not invoke global cleanup', async () => {
      authMock.mockResolvedValueOnce({ user: { id: 'user', userStatus: 'field crew' } });
      const res = await POST(postRequest({ action: 'runGlobal' }));
      expect(res.status).toBe(HTTPResponses.FORBIDDEN);
      expect(runGlobalCleanupMock).not.toHaveBeenCalled();
      expect(startPeriodicCleanupMock).not.toHaveBeenCalled();
      expect(stopPeriodicCleanupMock).not.toHaveBeenCalled();
    });

    it('admin proceeds normally and runs global cleanup', async () => {
      const res = await POST(postRequest({ action: 'runGlobal' }));
      expect(res.status).toBe(HTTPResponses.OK);
      expect(runGlobalCleanupMock).toHaveBeenCalledTimes(1);
    });
  });
});
