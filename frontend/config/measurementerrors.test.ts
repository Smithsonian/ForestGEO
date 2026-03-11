import { describe, expect, it, vi } from 'vitest';

import { insertIngestionFailureRows, revalidateEditedFailedRow } from './measurementerrors';

vi.mock('@/ailogger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('measurementerrors helpers', () => {
  it('persists every inferred ingestion error for a failed row with a single bulk error-log upsert', async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce({ insertId: 1001 })
      .mockResolvedValueOnce({ insertId: 1002 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{ CoreMeasurementID: 77, SourceRowIndex: 1 }])
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

    const bulkMeasurementInsertCalls = executeQuery.mock.calls.filter(
      ([sql]: [string]) => sql.includes('INSERT INTO `forestgeo_testing`.coremeasurements')
    );
    expect(bulkMeasurementInsertCalls).toHaveLength(1);

    const lookupCalls = executeQuery.mock.calls.filter(([sql]: [string]) => sql.includes('SELECT CoreMeasurementID, SourceRowIndex'));
    expect(lookupCalls).toHaveLength(1);

    const logInsertCalls = executeQuery.mock.calls.filter(
      ([sql]: [string]) => sql.includes('measurement_error_log') && sql.includes('ON DUPLICATE KEY UPDATE')
    );

    expect(logInsertCalls).toHaveLength(1);
    expect(logInsertCalls[0][1]).toEqual([77, 1001, 77, 1002]);
  });

  it('falls back to sequential inserts when batch metadata is missing', async () => {
    const executeQuery = vi.fn().mockResolvedValueOnce({ insertId: 1001 }).mockResolvedValueOnce({ insertId: 88 }).mockResolvedValueOnce(undefined);

    const connectionManager = { executeQuery } as any;

    const insertedIDs = await insertIngestionFailureRows(
      connectionManager,
      'forestgeo_testing',
      [
        {
          plotID: 1,
          censusID: 2,
          tag: 'T-2',
          stemTag: '1',
          spCode: '',
          quadrat: '1301',
          failureReason: 'Missing required field: SpeciesCode',
          fileID: 'upload.csv',
          batchID: null,
          sourceRowIndex: null
        }
      ],
      'tx-1'
    );

    expect(insertedIDs).toEqual([88]);
    expect(executeQuery.mock.calls.some(([sql]: [string]) => sql.includes('SELECT CoreMeasurementID, SourceRowIndex'))).toBe(false);
  });

  it('keeps quadrat-mismatch rows failing during revalidation', async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce([{ PlotID: 22 }])
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{ PrevQuadratName: '1301', PrevX: 10, PrevY: 20 }]);

    const connectionManager = { executeQuery } as any;

    const errors = await revalidateEditedFailedRow(
      connectionManager,
      'forestgeo_testing',
      4,
      {
        Tag: '100001',
        StemTag: '1',
        SpCode: 'FAGR',
        Quadrat: '1317',
        X: 10,
        Y: 20,
        DBH: 3.5,
        HOM: 1.3,
        Date: '2010-03-17',
        Codes: 'LI'
      },
      'tx-1'
    );

    expect(errors).toContainEqual({
      errorCode: 'QUADRAT_MISMATCH',
      errorMessage: 'Quadrat mismatch across censuses'
    });
  });

  it('keeps coordinate-drift rows failing during revalidation', async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce([{ PlotID: 22 }])
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{ cnt: 1 }])
      .mockResolvedValueOnce([{ PrevQuadratName: '1301', PrevX: 10, PrevY: 20 }]);

    const connectionManager = { executeQuery } as any;

    const errors = await revalidateEditedFailedRow(
      connectionManager,
      'forestgeo_testing',
      4,
      {
        Tag: '100001',
        StemTag: '1',
        SpCode: 'FAGR',
        Quadrat: '1301',
        X: 25,
        Y: 20,
        DBH: 3.5,
        HOM: 1.3,
        Date: '2010-03-17',
        Codes: 'LI'
      },
      'tx-1'
    );

    expect(errors).toContainEqual({
      errorCode: 'COORDINATE_DRIFT',
      errorMessage: 'Coordinate drift exceeds allowed threshold'
    });
  });
});
