import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  createUploadSession: vi.fn(),
  getSession: vi.fn(),
  updateSessionState: vi.fn(),
  updateSessionProgress: vi.fn(),
  sendHeartbeat: vi.fn(),
  runSessionCleanup: vi.fn(),
  ensureUploadSessionsTable: vi.fn(),
  generateUploadSessionIdempotencyKey: vi.fn(() => 'idem-1'),
  isValidSchema: vi.fn(() => true),
  auth: vi.fn(),
  assertCanEditMeasurementScope: vi.fn(async () => undefined),
  loggerError: vi.fn(),
  withTransaction: vi.fn(async (fn: (transactionId: string) => Promise<unknown>) => fn('tx-1')),
  acquireApplicationLock: vi.fn(async () => true),
  buildMeasurementScopeLockName: vi.fn((schema: string, plotId: number, censusId: number) => `measurement-scope:${schema}:${plotId}:${censusId}`)
}));

vi.mock('@/config/uploadsessiontracker', () => ({
  createUploadSession: mocks.createUploadSession,
  getSession: mocks.getSession,
  updateSessionState: mocks.updateSessionState,
  updateSessionProgress: mocks.updateSessionProgress,
  sendHeartbeat: mocks.sendHeartbeat,
  runSessionCleanup: mocks.runSessionCleanup,
  ensureUploadSessionsTable: mocks.ensureUploadSessionsTable,
  UploadSessionState: {
    INITIALIZED: 'initialized',
    UPLOADING: 'uploading',
    UPLOADED: 'uploaded',
    PROCESSING: 'processing',
    COLLAPSING: 'collapsing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    ABANDONED: 'abandoned',
    CLEANED_UP: 'cleaned_up'
  },
  generateUploadSessionIdempotencyKey: mocks.generateUploadSessionIdempotencyKey,
  UploadSessionOwnershipError: class UploadSessionOwnershipError extends Error {}
}));

vi.mock('@/auth', () => ({
  auth: mocks.auth
}));

vi.mock('@/config/editplan/scopeguard', () => ({
  assertCanEditMeasurementScope: mocks.assertCanEditMeasurementScope,
  ScopeAccessError: class ScopeAccessError extends Error {}
}));

vi.mock('@/config/utils/sqlsecurity', () => ({
  isValidSchema: mocks.isValidSchema
}));

vi.mock('@/config/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      withTransaction: mocks.withTransaction,
      acquireApplicationLock: mocks.acquireApplicationLock,
      executeQuery: vi.fn(async () => [{ ok: 1 }])
    })
  }
}));

vi.mock('@/config/measurementscopelock', () => ({
  buildMeasurementScopeLockName: mocks.buildMeasurementScopeLockName,
  MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS: 0
}));

vi.mock('@/ailogger', () => ({
  default: {
    error: mocks.loggerError
  }
}));

describe('POST /api/uploadsession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireApplicationLock.mockResolvedValue(true);
    mocks.auth.mockResolvedValue({
      user: { email: 'mason@example.com', name: 'Mason', userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_testing' }] }
    });
    mocks.getSession.mockResolvedValue({
      sessionId: 'session-1',
      userId: 'mason@example.com',
      state: 'uploading',
      plotId: 1,
      censusId: 2,
      lastHeartbeat: new Date()
    });
  });

  it('accepts unload beacons as POST state updates', async () => {
    const request = new Request('http://localhost/api/uploadsession', {
      method: 'POST',
      body: JSON.stringify({
        schema: 'forestgeo_testing',
        sessionId: 'session-1',
        action: 'updateState',
        state: 'abandoned',
        errorMessage: 'User closed browser during upload'
      })
    }) as any;

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.getSession).toHaveBeenCalledWith('forestgeo_testing', 'session-1');
    expect(mocks.updateSessionState).toHaveBeenCalledWith('forestgeo_testing', 'session-1', 'abandoned', 'User closed browser during upload');
    expect(mocks.ensureUploadSessionsTable).not.toHaveBeenCalled();
    expect(mocks.createUploadSession).not.toHaveBeenCalled();
  });

  it('still creates upload sessions for standard POST requests', async () => {
    mocks.createUploadSession.mockResolvedValue({ sessionId: 'session-2' });

    const request = new Request('http://localhost/api/uploadsession', {
      method: 'POST',
      body: JSON.stringify({
        schema: 'forestgeo_testing',
        plotId: 1,
        censusId: 2,
        userId: 'mason',
        fileId: 'file.csv',
        totalChunks: 3,
        fileHash: 'hash-1'
      })
    }) as any;

    const response = await POST(request);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ session: { sessionId: 'session-2' } });
    expect(mocks.ensureUploadSessionsTable).toHaveBeenCalledWith('forestgeo_testing');
    expect(mocks.generateUploadSessionIdempotencyKey).toHaveBeenCalledWith('forestgeo_testing', 1, 2, 'hash-1', undefined);
    expect(mocks.buildMeasurementScopeLockName).toHaveBeenCalledWith('forestgeo_testing', 1, 2);
    expect(mocks.acquireApplicationLock).toHaveBeenCalledWith('measurement-scope:forestgeo_testing:1:2', 'tx-1', 0);
    expect(mocks.assertCanEditMeasurementScope).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ user: expect.any(Object) }), {
      schema: 'forestgeo_testing',
      plotID: 1,
      censusID: 2
    });
    expect(mocks.createUploadSession).toHaveBeenCalledWith('forestgeo_testing', 1, 2, 'mason@example.com', 'file.csv', 3, 'idem-1', undefined);
  });

  it('forwards the upload mode from the request body to createUploadSession', async () => {
    mocks.createUploadSession.mockResolvedValue({ sessionId: 'session-3' });

    const request = new Request('http://localhost/api/uploadsession', {
      method: 'POST',
      body: JSON.stringify({
        schema: 'forestgeo_testing',
        plotId: 1,
        censusId: 2,
        userId: 'mason',
        fileId: 'spplist.csv',
        totalChunks: 1,
        fileHash: 'hash-2',
        mode: 'clean_reupload'
      })
    }) as any;

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mocks.createUploadSession).toHaveBeenCalledWith('forestgeo_testing', 1, 2, 'mason@example.com', 'spplist.csv', 1, 'idem-1', 'clean_reupload');
    expect(mocks.generateUploadSessionIdempotencyKey).toHaveBeenCalledWith('forestgeo_testing', 1, 2, 'hash-2', 'clean_reupload');
  });

  it('rejects session creation when permissions are unavailable', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'mason@example.com', permissionsUnavailable: true, sites: [], allsites: [] } });

    const request = new Request('http://localhost/api/uploadsession', {
      method: 'POST',
      body: JSON.stringify({
        schema: 'forestgeo_testing',
        plotId: 1,
        censusId: 2,
        userId: 'mason',
        fileId: 'file.csv',
        totalChunks: 3
      })
    }) as any;

    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(mocks.createUploadSession).not.toHaveBeenCalled();
  });

  it('rejects state updates for sessions owned by another user', async () => {
    mocks.getSession.mockResolvedValueOnce({
      sessionId: 'session-1',
      userId: 'other@example.com',
      state: 'uploading',
      plotId: 1,
      censusId: 2,
      lastHeartbeat: new Date()
    });

    const request = new Request('http://localhost/api/uploadsession', {
      method: 'POST',
      body: JSON.stringify({
        schema: 'forestgeo_testing',
        sessionId: 'session-1',
        action: 'updateState',
        state: 'abandoned'
      })
    }) as any;

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(mocks.updateSessionState).not.toHaveBeenCalled();
  });

  it('returns 409 when the measurement scope lock is unavailable', async () => {
    mocks.acquireApplicationLock.mockResolvedValue(false);

    const request = new Request('http://localhost/api/uploadsession', {
      method: 'POST',
      body: JSON.stringify({
        schema: 'forestgeo_testing',
        plotId: 1,
        censusId: 2,
        userId: 'mason',
        fileId: 'file.csv',
        totalChunks: 3
      })
    }) as any;

    const response = await POST(request);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Another measurement operation is in progress for Plot 1, Census 2. Please retry after it completes.'
    });
    expect(mocks.createUploadSession).not.toHaveBeenCalled();
  });
});
