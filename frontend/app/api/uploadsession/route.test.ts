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
  generateIdempotencyKey: vi.fn(() => 'idem-1'),
  isValidSchema: vi.fn(() => true),
  loggerError: vi.fn()
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
  generateIdempotencyKey: mocks.generateIdempotencyKey,
  UploadSessionOwnershipError: class UploadSessionOwnershipError extends Error {}
}));

vi.mock('@/config/utils/sqlsecurity', () => ({
  isValidSchema: mocks.isValidSchema
}));

vi.mock('@/ailogger', () => ({
  default: {
    error: mocks.loggerError
  }
}));

describe('POST /api/uploadsession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(mocks.generateIdempotencyKey).toHaveBeenCalledWith('forestgeo_testing', 1, 2, 'hash-1');
    expect(mocks.createUploadSession).toHaveBeenCalledWith('forestgeo_testing', 1, 2, 'mason', 'file.csv', 3, 'idem-1');
  });
});
