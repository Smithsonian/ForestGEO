import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConnectionManager = vi.hoisted(() => ({
  beginTransaction: vi.fn(),
  executeQuery: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn()
}));

const ensureMeasurementErrorDefinition = vi.hoisted(() => vi.fn());

vi.mock('@/config/connectionmanager', () => ({
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

import { runCombinedCrossCensusLocationValidations } from '@/components/processors/processorhelperfunctions';

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
});
