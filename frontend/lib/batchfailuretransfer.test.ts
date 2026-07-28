import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveTemporaryBatchToFailedMeasurements } from './batchfailuretransfer';

const ensureMeasurementErrorDefinition = vi.hoisted(() => vi.fn());

// Only the DB-touching definition upsert is stubbed. The classifier and message
// lookup stay REAL so this suite proves the code that actually reaches
// measurement_errors, rather than a hardcoded stand-in.
vi.mock('@/config/measurementerrors', async importOriginal => {
  const actual = await importOriginal<typeof import('@/config/measurementerrors')>();
  return { ...actual, ensureMeasurementErrorDefinition };
});

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

  /**
   * Incident path: when a batch is abandoned mid-flight, its staged rows are
   * moved to unresolved coremeasurements carrying the interruption reason. The
   * code recorded against them must say "interrupted", not "SQL exception" —
   * otherwise clean rows are permanently mislabelled as defective data.
   */
  it('records an interrupted batch under INTERRUPTED_UPLOAD rather than SQL_EXCEPTION', async () => {
    const INTERRUPTION_REASON = 'Upload session upload_ms3jw74a_97uvta1zlug cleaned up after abandonment';
    const connectionManager = {
      beginTransaction: vi.fn().mockResolvedValue('tx-interrupted'),
      executeQuery: vi
        .fn()
        .mockResolvedValueOnce([{ rowCount: 3 }])
        .mockResolvedValueOnce({ affectedRows: 3 })
        .mockResolvedValueOnce({ affectedRows: 3 })
        .mockResolvedValueOnce({ affectedRows: 3 }),
      commitTransaction: vi.fn().mockResolvedValue(undefined),
      rollbackTransaction: vi.fn().mockResolvedValue(undefined)
    } as any;
    ensureMeasurementErrorDefinition.mockResolvedValue(31);

    const movedRows = await moveTemporaryBatchToFailedMeasurements(
      connectionManager,
      'forestgeo_harvard',
      'harvard2014b.TXT',
      'batch-interrupted',
      INTERRUPTION_REASON
    );

    expect(movedRows).toBe(3);
    expect(ensureMeasurementErrorDefinition).toHaveBeenCalledTimes(1);

    const [, schema, source, errorCode, errorMessage] = ensureMeasurementErrorDefinition.mock.calls[0];
    expect(schema).toBe('forestgeo_harvard');
    expect(source).toBe('ingestion');
    expect(errorCode).toBe('INTERRUPTED_UPLOAD');
    expect(errorCode).not.toBe('SQL_EXCEPTION');
    expect(String(errorMessage).toLowerCase()).toContain('interrupted');
  });
});
