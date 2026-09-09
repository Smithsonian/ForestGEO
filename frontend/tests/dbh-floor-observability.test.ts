import { beforeEach, describe, expect, it, vi } from 'vitest';

const manager = vi.hoisted(() => ({
  beginTransaction: vi.fn(),
  executeQuery: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn()
}));
const warn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/connectionmanager', () => ({ default: { getInstance: () => manager } }));
vi.mock('@/config/measurementerrors', () => ({ ensureMeasurementErrorDefinition: vi.fn(), VALIDATION_ERROR_SOURCE: 'validation' }));
vi.mock('@/ailogger', () => ({ default: { warn, info: vi.fn(), error: vi.fn() } }));

import { runCombinedDBHValidations, runValidation } from '@/components/processors/processorhelperfunctions';

const params = { p_CensusID: 7, p_PlotID: 2 };
const call = 'CALL RunSharedDBHChangeValidations(@p_CensusID, @p_PlotID, 1, 0);';

describe('DBH floor exclusions in normal validation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    manager.beginTransaction.mockResolvedValue('floor-tx');
    manager.executeQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT ValidationID')) {
        return [
          { ValidationID: 1, IsEnabled: 1 },
          { ValidationID: 2, IsEnabled: 1 }
        ];
      }
      if (sql.includes('CALL forestgeo_testing.RunSharedDBHChangeValidations')) {
        return [[{ SkippedNoInterval: 0, SkippedBelowDbhFloor: '42' }], { affectedRows: 0 }];
      }
      return { affectedRows: 0 };
    });
  });

  it.each(['single', 'combined'])('surfaces excluded comparisons after a committed %s run', async mode => {
    if (mode === 'single') {
      expect(await runValidation(1, 'ValidateDBHGrowthExceedsMax', 'forestgeo_testing', call, params)).toBe(true);
    } else {
      expect((await runCombinedDBHValidations('forestgeo_testing', params)).success).toBe(true);
    }
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("check the plot's DBH units"),
      expect.objectContaining({ schema: 'forestgeo_testing', censusID: 7, plotID: 2, skippedBelowDbhFloor: 42 })
    );
    expect(manager.commitTransaction.mock.invocationCallOrder[0]).toBeLessThan(warn.mock.invocationCallOrder[0]);
  });

  it('does not report a rolled-back comparison as a completed exclusion', async () => {
    manager.commitTransaction.mockRejectedValue(new Error('commit failed'));
    expect((await runCombinedDBHValidations('forestgeo_testing', params)).success).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn when no comparison is excluded by the floor', async () => {
    manager.executeQuery.mockResolvedValue([[{ SkippedNoInterval: 0, SkippedBelowDbhFloor: 0 }]]);
    expect(await runValidation(1, 'ValidateDBHGrowthExceedsMax', 'forestgeo_testing', call, params)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
