import { describe, expect, it, vi } from 'vitest';

import { insertIngestionFailureRows } from './measurementerrors';

vi.mock('@/ailogger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('measurementerrors helpers', () => {
  it('persists every inferred ingestion error for a failed row', async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce({ insertId: 77 })
      .mockResolvedValueOnce({ insertId: 1001 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ insertId: 1002 })
      .mockResolvedValueOnce(undefined);

    const connectionManager = { executeQuery } as any;

    const insertedIDs = await insertIngestionFailureRows(
      connectionManager,
      'forestgeo_testing',
      [
        {
          plotID: 1,
          censusID: 2,
          tag: 'T-1',
          stemTag: '1',
          spCode: '',
          quadrat: '',
          failureReason: 'Missing required field: SpeciesCode | Missing required field: QuadratName',
          fileID: 'upload.csv',
          batchID: 'batch-1',
          sourceRowIndex: 1
        }
      ],
      'tx-1'
    );

    expect(insertedIDs).toEqual([77]);

    const logInsertCalls = executeQuery.mock.calls.filter(
      ([sql]: [string]) => sql.includes('measurement_error_log') && sql.includes('ON DUPLICATE KEY UPDATE')
    );

    expect(logInsertCalls).toHaveLength(2);
    expect(logInsertCalls[0][1]).toEqual([77, 1001]);
    expect(logInsertCalls[1][1]).toEqual([77, 1002]);
  });
});
