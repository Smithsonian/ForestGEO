import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INGESTION_ERROR_SOURCE } from '@/config/measurementerrors';

const {
  authMock,
  validateContextualValuesMock,
  validateSchemaOrThrowMock,
  mockExecuteQuery,
  mockBeginTransaction,
  mockCommitTransaction,
  mockRollbackTransaction,
  mockCloseConnection
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  validateContextualValuesMock: vi.fn(),
  validateSchemaOrThrowMock: vi.fn(),
  mockExecuteQuery: vi.fn(),
  mockBeginTransaction: vi.fn(),
  mockCommitTransaction: vi.fn(),
  mockRollbackTransaction: vi.fn(),
  mockCloseConnection: vi.fn()
}));

vi.mock('@/auth', () => ({
  auth: authMock
}));

vi.mock('@/lib/contextvalidation', () => ({
  validateContextualValues: validateContextualValuesMock
}));

vi.mock('@/config/utils/sqlsecurity', () => ({
  validateSchemaOrThrow: validateSchemaOrThrowMock
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

vi.mock('@/ailogger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import { DELETE, GET } from './route';

function makeParams(tableType = 'failedmeasurements', schema = 'forestgeo_testing', plotID = '1', censusID = '2') {
  return {
    params: Promise.resolve({ tableType, schema, plotID, censusID })
  } as any;
}

describe('admin clear failedmeasurements route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'test-user-id' } });
    validateContextualValuesMock.mockResolvedValue({
      success: true,
      values: {
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2
      }
    });
    validateSchemaOrThrowMock.mockImplementation(() => undefined);
    mockBeginTransaction.mockResolvedValue('tx-admin-clear');
    mockCommitTransaction.mockResolvedValue(undefined);
    mockRollbackTransaction.mockResolvedValue(undefined);
    mockCloseConnection.mockResolvedValue(undefined);
  });

  it('GET scopes failed-measurement counts to the selected logical census', async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ total: 5 }]);

    const response = await GET(new Request('http://localhost/api/admin/clear/failedmeasurements/forestgeo_testing/1/2') as any, makeParams());

    expect(response.status).toBe(200);
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);

    const [countSQL, countParams] = mockExecuteQuery.mock.calls[0]!;
    expect(String(countSQL)).toContain('c.PlotCensusNumber = (');
    expect(String(countSQL)).toContain('selected_census.CensusID = ?');
    expect(String(countSQL)).toContain('selected_census.PlotID = ?');
    expect(String(countSQL)).not.toContain('AND cm.CensusID = ?');
    expect(countParams).toEqual(['1', '2', '1', INGESTION_ERROR_SOURCE]);

    const body = await response.json();
    expect(body.recordCount).toBe(5);
    expect(mockCloseConnection).toHaveBeenCalledTimes(1);
  });

  it('DELETE clears failed measurements across all censusIDs for the selected logical census', async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ total: 3 }]).mockResolvedValueOnce(undefined);

    const response = await DELETE(new Request('http://localhost/api/admin/clear/failedmeasurements/forestgeo_testing/1/2', { method: 'DELETE' }) as any, makeParams());

    expect(response.status).toBe(200);
    expect(mockBeginTransaction).toHaveBeenCalledTimes(1);
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);

    const [countSQL, countParams, countTx] = mockExecuteQuery.mock.calls[0]!;
    expect(String(countSQL)).toContain('c.PlotCensusNumber = (');
    expect(String(countSQL)).not.toContain('AND cm.CensusID = ?');
    expect(countParams).toEqual([1, 2, 1, INGESTION_ERROR_SOURCE]);
    expect(countTx).toBe('tx-admin-clear');

    const [deleteSQL, deleteParams, deleteTx] = mockExecuteQuery.mock.calls[1]!;
    expect(String(deleteSQL)).toContain('DELETE cm');
    expect(String(deleteSQL)).toContain('c.PlotCensusNumber = (');
    expect(String(deleteSQL)).toContain('selected_census.CensusID = ?');
    expect(String(deleteSQL)).toContain('selected_census.PlotID = ?');
    expect(String(deleteSQL)).not.toContain('AND cm.CensusID = ?');
    expect(deleteParams).toEqual([1, 2, 1, INGESTION_ERROR_SOURCE]);
    expect(deleteTx).toBe('tx-admin-clear');

    const body = await response.json();
    expect(body.recordsCleared).toBe(3);
    expect(mockCommitTransaction).toHaveBeenCalledWith('tx-admin-clear');
    expect(mockRollbackTransaction).not.toHaveBeenCalled();
    expect(mockCloseConnection).toHaveBeenCalledTimes(1);
  });
});
