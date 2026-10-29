import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';

const { authMock, runSessionCleanupMock, ensureUploadSessionsTableMock, isValidSchemaMock, findOrphanedMock, deleteOrphanedMock, purgeOldSessionsMock } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    findOrphanedMock: vi.fn(),
    deleteOrphanedMock: vi.fn(),
    purgeOldSessionsMock: vi.fn(),
    runSessionCleanupMock: vi.fn(),
    ensureUploadSessionsTableMock: vi.fn(),
    isValidSchemaMock: vi.fn()
  }));

vi.mock('@/auth', () => ({ auth: authMock }));

vi.unmock('@/lib/db/connectionmanager');

vi.mock('@/config/uploadsessiontracker', () => ({
  runSessionCleanup: runSessionCleanupMock,
  purgeOldSessions: purgeOldSessionsMock,
  findStaleSessions: vi.fn().mockResolvedValue([]),
  findAbandonedSessionsNeedingCleanup: vi.fn().mockResolvedValue([]),
  ensureUploadSessionsTable: ensureUploadSessionsTableMock
}));

vi.mock('@/lib/db/sqlsecurity', () => ({
  isValidSchema: isValidSchemaMock
}));

vi.mock('@/lib/uploads/orphaned-staging-cleanup', () => ({
  findOrphanedTemporaryMeasurements: findOrphanedMock,
  deleteOrphanedTemporaryMeasurements: deleteOrphanedMock
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
    findOrphanedMock.mockResolvedValue([]);
    deleteOrphanedMock.mockResolvedValue(0);
    purgeOldSessionsMock.mockResolvedValue(0);
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

describe('cleanup route orphan step lock errors (#561 N1)', () => {
  const SCHEMA = 'forestgeo_testing';
  const ORPHANED_FILE = { fileId: 'old.csv', rowCount: 4 };
  const OLD_SESSIONS_PURGED = 7;
  const ORPHAN_STEP_ERROR_PREFIX = 'Orphaned temp cleanup error: ';
  const LOCK_ERRORS = [
    { name: 'deadlock', error: Object.assign(new Error('Deadlock found when trying to get lock'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 }) },
    { name: 'lock wait timeout', error: Object.assign(new Error('Lock wait timeout exceeded'), { code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205 }) }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'admin', userStatus: 'global' } });
    isValidSchemaMock.mockReturnValue(true);
    ensureUploadSessionsTableMock.mockResolvedValue(undefined);
    findOrphanedMock.mockResolvedValue([ORPHANED_FILE]);
    purgeOldSessionsMock.mockResolvedValue(OLD_SESSIONS_PURGED);
  });

  it.each(LOCK_ERRORS)('reports a $name from the orphan DELETE in result.errors and still runs the purge step', async ({ error }) => {
    deleteOrphanedMock.mockRejectedValue(error);

    const res = await POST(
      postRequest({ schema: SCHEMA, options: { cleanupSessions: false, cleanupOrphanedTemp: true, purgeOldSessions: true, clearStaleTransactions: false } })
    );
    const body = await res.json();
    console.log(`[N1] status=${res.status} errors=${JSON.stringify(body.result.errors)} purged=${body.result.oldSessionsPurged}`);

    expect(res.status).toBe(HTTPResponses.OK);
    expect(body.result.errors).toContain(`${ORPHAN_STEP_ERROR_PREFIX}${error.message}`);
    expect(body.result.orphanedTempRowsFound).toBe(ORPHANED_FILE.rowCount);
    expect(body.result.orphanedTempRowsDeleted).toBe(0);
    expect(purgeOldSessionsMock).toHaveBeenCalledWith(SCHEMA, expect.any(Number));
    expect(body.result.oldSessionsPurged).toBe(OLD_SESSIONS_PURGED);
  });
});
