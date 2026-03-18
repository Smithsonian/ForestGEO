import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  beginTransaction: vi.fn(),
  executeQuery: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn(),
  moveTemporaryBatchToFailedMeasurements: vi.fn(),
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
  getConn: vi.fn(),
  runQuery: vi.fn()
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError
  }
}));

import { cleanupOrphanedData, UploadSessionState } from './uploadsessiontracker';

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
