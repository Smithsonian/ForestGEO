import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveTemporaryBatchToFailedMeasurements } from './batchfailuretransfer';

const ensureMeasurementErrorDefinition = vi.hoisted(() => vi.fn());

vi.mock('@/config/measurementerrors', () => ({
  ensureMeasurementErrorDefinition,
  getIngestionErrorMessage: vi.fn((code: string, fallback?: string) => fallback || code),
  inferIngestionErrorCode: vi.fn(() => 'SQL_EXCEPTION'),
  INGESTION_ERROR_SOURCE: 'ingestion'
}));

describe('moveTemporaryBatchToFailedMeasurements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves temporary rows into unresolved coremeasurements and deletes temp rows', async () => {
    const connectionManager = {
      beginTransaction: vi.fn().mockResolvedValue('tx-1'),
      executeQuery: vi
        .fn()
        .mockResolvedValueOnce([{ rowCount: 1 }])
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 }),
      commitTransaction: vi.fn().mockResolvedValue(undefined),
      rollbackTransaction: vi.fn().mockResolvedValue(undefined)
    } as any;
    ensureMeasurementErrorDefinition.mockResolvedValue(22);

    const movedRows = await moveTemporaryBatchToFailedMeasurements(connectionManager, 'forestgeo_testing', 'file.csv', 'batch-1', 'failed');

    expect(movedRows).toBe(1);
    expect(ensureMeasurementErrorDefinition).toHaveBeenCalledTimes(1);
    expect(connectionManager.executeQuery).toHaveBeenCalledTimes(4);
    expect(connectionManager.commitTransaction).toHaveBeenCalledWith('tx-1');
    expect(connectionManager.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('rolls back when the transfer fails', async () => {
    const connectionManager = {
      beginTransaction: vi.fn().mockResolvedValue('tx-2'),
      executeQuery: vi.fn().mockRejectedValue(new Error('select failed')),
      commitTransaction: vi.fn().mockResolvedValue(undefined),
      rollbackTransaction: vi.fn().mockResolvedValue(undefined)
    } as any;

    await expect(moveTemporaryBatchToFailedMeasurements(connectionManager, 'forestgeo_testing', 'file.csv', 'batch-2', 'failed')).rejects.toThrow(
      'select failed'
    );

    expect(connectionManager.rollbackTransaction).toHaveBeenCalledWith('tx-2');
    expect(connectionManager.commitTransaction).not.toHaveBeenCalled();
  });

  it('reuses an existing transaction when one is provided', async () => {
    const connectionManager = {
      beginTransaction: vi.fn(),
      executeQuery: vi
        .fn()
        .mockResolvedValueOnce([{ rowCount: 1 }])
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 }),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn()
    } as any;
    ensureMeasurementErrorDefinition.mockResolvedValue(22);

    const movedRows = await moveTemporaryBatchToFailedMeasurements(connectionManager, 'forestgeo_testing', 'file.csv', 'batch-3', 'failed', 'outer-tx');

    expect(movedRows).toBe(1);
    expect(connectionManager.beginTransaction).not.toHaveBeenCalled();
    expect(connectionManager.commitTransaction).not.toHaveBeenCalled();
    expect(connectionManager.rollbackTransaction).not.toHaveBeenCalled();
    expect(connectionManager.executeQuery).toHaveBeenNthCalledWith(1, expect.any(String), ['file.csv', 'batch-3'], 'outer-tx');
  });
});
