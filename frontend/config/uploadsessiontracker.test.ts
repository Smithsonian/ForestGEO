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

vi.mock('./connectionmanager', () => ({
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

vi.mock('@/components/processors/processormacros', () => ({
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
      'tx-cleanup'
    );
    expect(mocks.commitTransaction).toHaveBeenCalledWith('tx-cleanup');
    expect(mocks.rollbackTransaction).not.toHaveBeenCalled();
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
});
