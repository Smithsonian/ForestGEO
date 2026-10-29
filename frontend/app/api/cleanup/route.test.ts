import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';

const { authMock, runSessionCleanupMock, ensureUploadSessionsTableMock, isValidSchemaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  runSessionCleanupMock: vi.fn(),
  ensureUploadSessionsTableMock: vi.fn(),
  isValidSchemaMock: vi.fn()
}));

vi.mock('@/auth', () => ({ auth: authMock }));

vi.unmock('@/lib/db/connectionmanager');

vi.mock('@/config/uploadsessiontracker', () => ({
  runSessionCleanup: runSessionCleanupMock,
  purgeOldSessions: vi.fn().mockResolvedValue(0),
  findStaleSessions: vi.fn().mockResolvedValue([]),
  findAbandonedSessionsNeedingCleanup: vi.fn().mockResolvedValue([]),
  ensureUploadSessionsTable: ensureUploadSessionsTableMock
}));

vi.mock('@/lib/db/sqlsecurity', () => ({
  isValidSchema: isValidSchemaMock
}));

vi.mock('@/lib/db/primitives', () => ({
  getConn: vi.fn().mockResolvedValue({ release: vi.fn() }),
  runQuery: vi.fn().mockResolvedValue([])
}));

vi.mock('@/ailogger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import ailogger from '@/ailogger';
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

describe('cleanup admin route reports the real stale-transaction count (#563)', () => {
  const ABANDONED_IDS = ['cleanup-reap-a', 'cleanup-reap-b'];
  const HEALTHY_ID = 'cleanup-healthy';
  const IN_FLIGHT_ID = 'cleanup-in-flight';
  const OVERDUE_MS = 1_000;
  const FUTURE_DEADLINE_MS = 60_000;
  const STALE_TRANSACTIONS_ONLY = { cleanupSessions: false, cleanupOrphanedTemp: false, purgeOldSessions: false };
  /** The route's catch-block log in clearStaleTransactions (app/api/cleanup/route.ts). */
  const CLEANUP_FAILURE_LOG_MESSAGE = '[Cleanup API] Failed to clear stale transactions:';

  type SeededConnection = { threadId: number; destroy: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  type ManagerInternals = { transactionConnections: Map<string, unknown>; transactionMeta: Map<string, unknown> };

  async function managerInternals(): Promise<ManagerInternals> {
    const { default: ConnectionManager } = await import('@/lib/db/connectionmanager');
    const internals = ConnectionManager.getInstance() as unknown as ManagerInternals;
    internals.transactionConnections.clear();
    internals.transactionMeta.clear();
    return internals;
  }

  function seed(internals: ManagerInternals, transactionId: string, threadId: number, deadlineOffsetMs: number, inFlightStatements: number): SeededConnection {
    const now = Date.now();
    const connection = { threadId, destroy: vi.fn(), release: vi.fn() };
    internals.transactionConnections.set(transactionId, connection);
    internals.transactionMeta.set(transactionId, {
      startedAt: now - OVERDUE_MS,
      deadlineAt: now + deadlineOffsetMs,
      phase: 'active',
      inFlightStatements,
      keepAliveHandle: null,
      resourceLocks: new Set<string>(),
      pendingLockAcquisitions: new Map<string, Promise<boolean>>()
    });
    return connection;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'admin', userStatus: 'global' } });
    isValidSchemaMock.mockReturnValue(true);
    ensureUploadSessionsTableMock.mockResolvedValue(undefined);
  });

  it('counts exactly the abandoned transactions it reaped', async () => {
    const internals = await managerInternals();
    const abandoned = ABANDONED_IDS.map((id, index) => seed(internals, id, index + 1, -OVERDUE_MS, 0));
    const healthy = seed(internals, HEALTHY_ID, 10, FUTURE_DEADLINE_MS, 0);
    const inFlight = seed(internals, IN_FLIGHT_ID, 11, -OVERDUE_MS, 1);

    const res = await POST(postRequest({ schema: 'forestgeo_testing', options: STALE_TRANSACTIONS_ONLY }));
    const body = await res.json();
    console.log('[cleanup count] response result:', body.result);

    expect(res.status).toBe(HTTPResponses.OK);
    expect(body.result.staleTransactionsCleared, 'the route used to report a constant 1 ("attempted")').toBe(ABANDONED_IDS.length);
    abandoned.forEach(connection => expect(connection.destroy).toHaveBeenCalledTimes(1));
    expect(healthy.destroy).not.toHaveBeenCalled();
    expect(inFlight.destroy).not.toHaveBeenCalled();
    expect(vi.mocked(ailogger.error)).not.toHaveBeenCalledWith(CLEANUP_FAILURE_LOG_MESSAGE, expect.anything());
    internals.transactionConnections.clear();
    internals.transactionMeta.clear();
  });

  it('reports 0 when nothing is abandoned', async () => {
    await managerInternals();
    const res = await POST(postRequest({ schema: 'forestgeo_testing', options: STALE_TRANSACTIONS_ONLY }));
    const body = await res.json();
    console.log('[cleanup count] empty result:', body.result);
    expect(body.result.staleTransactionsCleared).toBe(0);
    expect(vi.mocked(ailogger.error), 'a 0 from the catch block would look identical without this check').not.toHaveBeenCalledWith(
      CLEANUP_FAILURE_LOG_MESSAGE,
      expect.anything()
    );
    expect(body.result.errors).toEqual([]);
  });
});
