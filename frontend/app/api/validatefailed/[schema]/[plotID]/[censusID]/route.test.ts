import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExecuteQuery,
  mockBeginTransaction,
  mockCommitTransaction,
  mockRollbackTransaction,
  mockCloseConnection,
  mockRefreshIngestionErrorsForMeasurement
} = vi.hoisted(() => ({
  mockExecuteQuery: vi.fn(),
  mockBeginTransaction: vi.fn(),
  mockCommitTransaction: vi.fn(),
  mockRollbackTransaction: vi.fn(),
  mockCloseConnection: vi.fn(),
  mockRefreshIngestionErrorsForMeasurement: vi.fn()
}));

vi.mock('@/config/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      executeQuery: mockExecuteQuery,
      beginTransaction: mockBeginTransaction,
      commitTransaction: mockCommitTransaction,
      rollbackTransaction: mockRollbackTransaction,
      closeConnection: mockCloseConnection
    })
  }
}));

vi.mock('@/config/utils/sqlsecurity', () => ({
  validateSchemaOrThrow: vi.fn()
}));

vi.mock('@/config/measurementerrors', () => ({
  buildFailedMeasurementsSelectQuery: vi.fn(() => 'SELECT * FROM failed_measurements_source'),
  refreshIngestionErrorsForMeasurement: mockRefreshIngestionErrorsForMeasurement
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import { GET } from './route';

function makeParams(schema = 'forestgeo_testing', plotID = '1', censusID = '2') {
  return {
    params: Promise.resolve({ schema, plotID, censusID })
  } as any;
}

describe('validatefailed route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBeginTransaction.mockResolvedValue('tx-validate');
    mockCommitTransaction.mockResolvedValue(undefined);
    mockRollbackTransaction.mockResolvedValue(undefined);
    mockCloseConnection.mockResolvedValue(undefined);
  });

  it('recomputes readiness and returns mixed ready/failing results', async () => {
    mockExecuteQuery.mockResolvedValueOnce([
      {
        FailedMeasurementID: 101,
        PlotID: 1,
        CensusID: 2,
        Tag: 'T-101',
        StemTag: '1',
        SpCode: 'GOOD',
        Quadrat: 'Q01',
        X: 1,
        Y: 2,
        DBH: 10,
        HOM: 1.3,
        Date: '2025-01-01',
        Codes: 'AL',
        Comments: null,
        OriginalFailureReasons: 'Invalid species reference'
      },
      {
        FailedMeasurementID: 102,
        PlotID: 1,
        CensusID: 2,
        Tag: 'T-102',
        StemTag: '2',
        SpCode: 'BAD',
        Quadrat: 'Q02',
        X: 3,
        Y: 4,
        DBH: 12,
        HOM: 1.4,
        Date: '2025-01-02',
        Codes: '',
        Comments: 'check me',
        OriginalFailureReasons: 'Missing required field: SpeciesCode'
      }
    ]);
    mockRefreshIngestionErrorsForMeasurement
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ errorCode: 'INVALID_SPECIES', errorMessage: 'Invalid species reference' }]);

    const response = await GET(new Request('http://localhost/api/validatefailed') as any, makeParams());

    expect(response.status).toBe(200);
    expect(mockBeginTransaction).toHaveBeenCalledTimes(1);
    expect(mockCommitTransaction).toHaveBeenCalledWith('tx-validate');
    expect(mockRefreshIngestionErrorsForMeasurement).toHaveBeenCalledTimes(2);

    const body = await response.json();
    expect(body).toMatchObject({
      totalRows: 2,
      readyCount: 1,
      failingCount: 1,
      autoReingestedCount: 0
    });
    expect(body.details).toEqual([
      expect.objectContaining({
        failedMeasurementID: 101,
        isReady: true,
        currentFailureReasons: null
      }),
      expect.objectContaining({
        failedMeasurementID: 102,
        isReady: false,
        currentFailureReasons: 'Invalid species reference'
      })
    ]);
  });

  it('rolls back when refreshing failed-row state throws', async () => {
    mockExecuteQuery.mockResolvedValueOnce([
      {
        FailedMeasurementID: 201,
        PlotID: 1,
        CensusID: 2,
        Tag: 'T-201',
        StemTag: '1',
        SpCode: 'BAD',
        Quadrat: 'Q01',
        X: 1,
        Y: 2,
        DBH: 10,
        HOM: 1.3,
        Date: '2025-01-01',
        Codes: null,
        Comments: null,
        OriginalFailureReasons: 'Invalid species reference'
      }
    ]);
    mockRefreshIngestionErrorsForMeasurement.mockRejectedValueOnce(new Error('refresh failed'));

    const response = await GET(new Request('http://localhost/api/validatefailed') as any, makeParams());

    expect(response.status).toBe(500);
    expect(mockRollbackTransaction).toHaveBeenCalledWith('tx-validate');
    expect(mockCommitTransaction).not.toHaveBeenCalled();
  });
});
