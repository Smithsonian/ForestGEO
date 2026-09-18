import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConnectionManager = vi.hoisted(() => ({
  beginTransaction: vi.fn(),
  executeQuery: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn()
}));

const ensureMeasurementErrorDefinition = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => mockConnectionManager
  }
}));

vi.mock('@/config/measurementerrors', () => ({
  ensureMeasurementErrorDefinition,
  VALIDATION_ERROR_SOURCE: 'validation'
}));

vi.mock('@/ailogger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}));

import { runCombinedCrossCensusLocationValidations, runValidation } from '@/components/processors/processorhelperfunctions';
import { parseDbhValidationSkipCounts, runSharedDBHChangeValidationsInTransaction } from '@/lib/validations/dbh-execution';

describe('validation connection retries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries shared cross-census validation after a transient connection loss', async () => {
    mockConnectionManager.beginTransaction.mockResolvedValueOnce('tx-1').mockResolvedValueOnce('tx-2');

    let sharedCallAttempts = 0;

    mockConnectionManager.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('SELECT ValidationID, ProcedureName, IsEnabled')) {
        return [
          { ValidationID: 17, ProcedureName: 'ValidateQuadratMismatchAcrossCensuses', IsEnabled: 1 },
          { ValidationID: 18, ProcedureName: 'ValidateCoordinateDriftAcrossCensuses', IsEnabled: 1 }
        ];
      }

      if (query.includes('CALL forestgeo_testing.RunSharedCrossCensusLocationValidations')) {
        sharedCallAttempts += 1;

        if (sharedCallAttempts === 1) {
          const error: any = new Error('Connection lost: The server closed the connection.');
          error.code = 'PROTOCOL_CONNECTION_LOST';
          throw error;
        }

        return [];
      }

      return [];
    });

    const result = await runCombinedCrossCensusLocationValidations('forestgeo_testing', {
      p_CensusID: 6,
      p_PlotID: 1
    });

    expect(result).toEqual({
      success: true,
      ranQuadratMismatch: true,
      ranCoordinateDrift: true
    });
    expect(sharedCallAttempts).toBe(2);
    expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalledWith('tx-1');
    expect(mockConnectionManager.commitTransaction).toHaveBeenCalledWith('tx-2');
    expect(ensureMeasurementErrorDefinition).toHaveBeenCalledTimes(4);
  });

  it('reads DBH skip counts by their SQL result names rather than CALL result-set position', () => {
    const counts = parseDbhValidationSkipCounts([
      [{ unrelated: true }],
      [
        {
          SkippedNoInterval: '6',
          SkippedNegativeInterval: 1,
          SkippedImplausibleInterval: '5'
        },
        [{ SkippedBelowDbhFloor: '4' }]
      ],
      { affectedRows: 0 }
    ]);

    expect(counts).toEqual({
      skippedNoInterval: 6,
      skippedNegativeInterval: 1,
      skippedImplausibleInterval: 5,
      skippedBelowDbhFloor: 4
    });
  });

  it('returns zero DBH skip counts when no result set is returned', () => {
    expect(parseDbhValidationSkipCounts([])).toEqual({
      skippedNoInterval: 0,
      skippedNegativeInterval: 0,
      skippedImplausibleInterval: 0,
      skippedBelowDbhFloor: 0
    });
  });

  it('uses only the caller transaction for DBH scrub and execution', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT ValidationID')) {
        return [
          { ValidationID: 1, ProcedureName: 'ValidateDBHGrowthExceedsMax', IsEnabled: 1 },
          { ValidationID: 2, ProcedureName: 'ValidateDBHShrinkageExceedsMax', IsEnabled: 1 }
        ];
      }
      if (sql.includes('CALL `forestgeo_testing`.RunSharedDBHChangeValidations')) {
        return [[{ SkippedNoInterval: 1, SkippedNegativeInterval: 0, SkippedImplausibleInterval: 1 }], [{ SkippedBelowDbhFloor: 2 }]];
      }
      return { affectedRows: 0 };
    });

    await expect(
      runSharedDBHChangeValidationsInTransaction({
        schema: 'forestgeo_testing',
        tx: { id: 'owner-tx', query: query as any },
        params: { p_CensusID: 7, p_PlotID: 3 }
      })
    ).resolves.toEqual({
      ranGrowth: true,
      ranShrinkage: true,
      skipCounts: { skippedNoInterval: 1, skippedNegativeInterval: 0, skippedImplausibleInterval: 1, skippedBelowDbhFloor: 2 }
    });
    expect(mockConnectionManager.beginTransaction).not.toHaveBeenCalled();
    expect(mockConnectionManager.commitTransaction).not.toHaveBeenCalled();
    expect(mockConnectionManager.rollbackTransaction).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => String(sql).includes('cm.StemGUID IS NOT NULL'))).toBe(true);
  });

  it('uses the server DBH scrub when the normal singleton wrapper runs validation 1', async () => {
    mockConnectionManager.beginTransaction.mockResolvedValue('singleton-tx');
    mockConnectionManager.executeQuery.mockResolvedValue({ affectedRows: 0 });

    await expect(runValidation(1, 'ValidateDBHGrowthExceedsMax', 'forestgeo_testing', 'SELECT 1')).resolves.toBe(true);

    const queries = mockConnectionManager.executeQuery.mock.calls.map(([sql]) => String(sql));
    expect(
      queries.some(sql => sql.includes('UPDATE `forestgeo_testing`.coremeasurements cm') && sql.includes('mel.MeasurementID = cm.CoreMeasurementID'))
    ).toBe(true);
    expect(queries.some(sql => sql.includes('DELETE cme FROM forestgeo_testing.measurement_error_log'))).toBe(false);
    expect(mockConnectionManager.commitTransaction).toHaveBeenCalledWith('singleton-tx');
  });

  it('keeps DELETE cleanup for a non-DBH singleton validation', async () => {
    mockConnectionManager.beginTransaction.mockResolvedValue('singleton-tx');
    mockConnectionManager.executeQuery.mockResolvedValue({ affectedRows: 0 });

    await expect(runValidation(19, 'ValidateDuplicateTags', 'forestgeo_testing', 'SELECT 1')).resolves.toBe(true);

    expect(mockConnectionManager.executeQuery.mock.calls.some(([sql]) => String(sql).includes('DELETE cme FROM forestgeo_testing.measurement_error_log'))).toBe(
      true
    );
    expect(mockConnectionManager.commitTransaction).toHaveBeenCalledWith('singleton-tx');
  });
});
