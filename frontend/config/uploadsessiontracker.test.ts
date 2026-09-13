import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  beginTransaction: vi.fn(),
  executeQuery: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn(),
  moveTemporaryBatchToFailedMeasurements: vi.fn(),
  getConn: vi.fn(),
  runQuery: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn()
}));

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      beginTransaction: mocks.beginTransaction,
      executeQuery: mocks.executeQuery,
      commitTransaction: mocks.commitTransaction,
      rollbackTransaction: mocks.rollbackTransaction
    })
  }
}));

vi.mock('@/lib/batchfailuretransfer', () => ({
  moveTemporaryBatchToFailedMeasurements: mocks.moveTemporaryBatchToFailedMeasurements
}));

vi.mock('@/lib/db/primitives', () => ({
  getConn: mocks.getConn,
  runQuery: mocks.runQuery
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError
  }
}));

import { cleanupOrphanedData, createUploadSession, UploadSessionState } from './uploadsessiontracker';

describe('cleanupOrphanedData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.beginTransaction.mockResolvedValue('tx-cleanup');
    mocks.commitTransaction.mockResolvedValue(undefined);
    mocks.rollbackTransaction.mockResolvedValue(undefined);
  });

  it('keeps the full cleanup flow inside one transaction', async () => {
    mocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ FileID: 'file.csv', BatchID: 'batch-1' }])
      .mockResolvedValueOnce({ affectedRows: 1 });
    mocks.moveTemporaryBatchToFailedMeasurements.mockResolvedValue(3);

    const result = await cleanupOrphanedData('forestgeo_testing', {
      sessionId: 'session-1',
      schema: 'forestgeo_testing',
      plotId: 7,
      censusId: 9,
      userId: 'mason',
      state: UploadSessionState.ABANDONED,
      fileId: 'file.csv',
      totalChunks: 1,
      uploadedChunks: 1,
      processedBatches: 0,
      totalBatches: 1,
      lastHeartbeat: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    expect(result).toEqual({ temporaryDeleted: 3, failedDeleted: 3 });
    expect(mocks.beginTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.moveTemporaryBatchToFailedMeasurements).toHaveBeenCalledWith(
      expect.any(Object),
      'forestgeo_testing',
      'file.csv',
      'batch-1',
      'Upload session session-1 cleaned up after abandonment (pre-migration rows)',
      'interrupted_upload',
      'tx-cleanup'
    );
    expect(mocks.commitTransaction).toHaveBeenCalledWith('tx-cleanup');
    expect(mocks.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('marks a session-owned batch move as interrupted_upload (not just the pre-migration fallback)', async () => {
    mocks.executeQuery
      .mockResolvedValueOnce([{ FileID: 'file.csv', BatchID: 'batch-2' }]) // session-owned batches (SessionID = ?)
      .mockResolvedValueOnce([]) // no pre-migration (NULL SessionID) rows in this scope
      .mockResolvedValueOnce({ affectedRows: 1 }); // mark session cleaned up
    mocks.moveTemporaryBatchToFailedMeasurements.mockResolvedValue(2);

    const result = await cleanupOrphanedData('forestgeo_testing', {
      sessionId: 'session-2',
      schema: 'forestgeo_testing',
      plotId: 7,
      censusId: 9,
      userId: 'mason',
      state: UploadSessionState.ABANDONED,
      fileId: 'file.csv',
      totalChunks: 1,
      uploadedChunks: 1,
      processedBatches: 0,
      totalBatches: 1,
      lastHeartbeat: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    expect(result).toEqual({ temporaryDeleted: 2, failedDeleted: 2 });
    expect(mocks.moveTemporaryBatchToFailedMeasurements).toHaveBeenCalledWith(
      expect.any(Object),
      'forestgeo_testing',
      'file.csv',
      'batch-2',
      'Upload session session-2 cleaned up after abandonment',
      'interrupted_upload',
      'tx-cleanup'
    );
  });

  it('rolls back the outer transaction when a batch move fails', async () => {
    mocks.executeQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ FileID: 'file.csv', BatchID: 'batch-1' }]);
    mocks.moveTemporaryBatchToFailedMeasurements.mockRejectedValue(new Error('cleanup failed'));

    await expect(
      cleanupOrphanedData('forestgeo_testing', {
        sessionId: 'session-1',
        schema: 'forestgeo_testing',
        plotId: 7,
        censusId: 9,
        userId: 'mason',
        state: UploadSessionState.ABANDONED,
        fileId: 'file.csv',
        totalChunks: 1,
        uploadedChunks: 1,
        processedBatches: 0,
        totalBatches: 1,
        lastHeartbeat: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      })
    ).rejects.toThrow('cleanup failed');

    expect(mocks.rollbackTransaction).toHaveBeenCalledWith('tx-cleanup');
    expect(mocks.commitTransaction).not.toHaveBeenCalled();
  });
});

describe('createUploadSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries stale scope-lock collisions with the same mode-aware insert payload', async () => {
    const schema = 'forestgeo_uploadsession_retry_test';
    const staleHeartbeat = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const initialConn = { release: vi.fn() };
    const precheckConn = { release: vi.fn() };
    const insertConn = { release: vi.fn() };
    const catchLookupConn = { release: vi.fn() };
    const catchUpdateConn = { release: vi.fn() };

    mocks.getConn
      .mockResolvedValueOnce(initialConn)
      .mockResolvedValueOnce(precheckConn)
      .mockResolvedValueOnce(insertConn)
      .mockResolvedValueOnce(catchLookupConn)
      .mockResolvedValueOnce(catchUpdateConn);

    const duplicateScopeError = Object.assign(new Error('Duplicate entry for key uq_upload_sessions_active_scope'), {
      code: 'ER_DUP_ENTRY',
      sqlMessage: 'Duplicate entry for key uq_upload_sessions_active_scope'
    });

    mocks.runQuery
      // findSessionByIdempotencyKey
      .mockResolvedValueOnce([])
      // abandonStaleSessionsForScope -> findActiveSessionsForPlotCensus
      .mockResolvedValueOnce([])
      // ensureUploadSessionScopeLock -> hasColumn(active_scope_key)
      .mockResolvedValueOnce([{ count: 1 }])
      // ensureUploadSessionScopeLock -> abandonDuplicateActiveScopeSessions
      .mockResolvedValueOnce({ affectedRows: 0 })
      // ensureUploadSessionScopeLock -> hasIndex(uq_upload_sessions_active_scope)
      .mockResolvedValueOnce([{ count: 1 }])
      // initial INSERT hits duplicate-key race
      .mockRejectedValueOnce(duplicateScopeError)
      // catch branch -> findActiveSessionsForPlotCensus
      .mockResolvedValueOnce([
        {
          session_id: 'stale-session-1',
          schema_name: schema,
          plot_id: 7,
          census_id: 9,
          user_id: 'mason',
          state: 'initialized',
          file_id: 'file.csv',
          total_chunks: 3,
          uploaded_chunks: 0,
          processed_batches: 0,
          total_batches: 0,
          last_heartbeat: staleHeartbeat,
          created_at: staleHeartbeat,
          updated_at: staleHeartbeat,
          error_message: null,
          idempotency_key: 'older-idem',
          mode: 'revisions'
        }
      ])
      // catch branch -> updateSessionState(stale-session-1, abandoned)
      .mockResolvedValueOnce({ affectedRows: 1 })
      // catch branch -> retry INSERT succeeds
      .mockResolvedValueOnce({ affectedRows: 1 });

    const created = await createUploadSession(schema, 7, 9, 'mason', 'file.csv', 3, 'idem-1', 'clean_reupload');

    expect(created).toMatchObject({
      schema,
      plotId: 7,
      censusId: 9,
      userId: 'mason',
      fileId: 'file.csv',
      totalChunks: 3,
      idempotencyKey: 'idem-1',
      mode: 'clean_reupload'
    });
    expect(mocks.runQuery.mock.calls.at(-1)?.[2]).toEqual([created.sessionId, schema, 7, 9, 'mason', 'initialized', 'file.csv', 3, 'idem-1', 'clean_reupload']);
  });

  it('starts a new session instead of handing back a completed one with the same idempotency key', async () => {
    // Re-running a finished clean re-upload of unchanged files produces the same idempotency
    // key. The old session already recorded its replacement marker, so reusing it would make
    // the new upload skip the reset and silently append (#472).
    const schema = 'forestgeo_uploadsession_completed_test';
    const completedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const completedSessionID = 'completed-session-1';
    mocks.getConn.mockResolvedValue({ release: vi.fn() });
    mocks.runQuery
      // findSessionByIdempotencyKey -> the earlier, finished upload of the same files
      .mockResolvedValueOnce([
        {
          session_id: completedSessionID,
          schema_name: schema,
          plot_id: 7,
          census_id: 9,
          user_id: 'mason',
          state: UploadSessionState.COMPLETED,
          file_id: 'species.csv',
          total_chunks: 1,
          uploaded_chunks: 1,
          processed_batches: 0,
          total_batches: 0,
          last_heartbeat: completedAt,
          created_at: completedAt,
          updated_at: completedAt,
          error_message: null,
          idempotency_key: 'idem-completed',
          mode: 'clean_reupload'
        }
      ])
      // abandonStaleSessionsForScope -> findActiveSessionsForPlotCensus
      .mockResolvedValueOnce([])
      // ensureUploadSessionScopeLock -> hasColumn, abandonDuplicateActiveScopeSessions, hasIndex
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce([{ count: 1 }])
      // INSERT the new session
      .mockResolvedValueOnce({ affectedRows: 1 });

    const created = await createUploadSession(schema, 7, 9, 'mason', 'species.csv', 1, 'idem-completed', 'clean_reupload');

    const insertCall = mocks.runQuery.mock.calls.at(-1);
    console.log(`[createUploadSession] returned ${created.sessionId} (${created.state}); last statement: ${String(insertCall?.[1]).replace(/\s+/g, ' ')}`);
    expect(created.sessionId).not.toBe(completedSessionID);
    expect(created.state).toBe(UploadSessionState.INITIALIZED);
    expect(String(insertCall?.[1])).toContain('INSERT INTO');
    expect(insertCall?.[2]).toEqual([created.sessionId, schema, 7, 9, 'mason', 'initialized', 'species.csv', 1, 'idem-completed', 'clean_reupload']);
  });
});
