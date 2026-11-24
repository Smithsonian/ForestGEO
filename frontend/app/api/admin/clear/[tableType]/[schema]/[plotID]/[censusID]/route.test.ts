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
  mockCloseConnection,
  deleteWithAuditMock
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  validateContextualValuesMock: vi.fn(),
  validateSchemaOrThrowMock: vi.fn(),
  mockExecuteQuery: vi.fn(),
  mockBeginTransaction: vi.fn(),
  mockCommitTransaction: vi.fn(),
  mockRollbackTransaction: vi.fn(),
  mockCloseConnection: vi.fn(),
  deleteWithAuditMock: vi.fn()
}));

vi.mock('@/auth', () => ({
  auth: authMock
}));

vi.mock('@/lib/contextvalidation', () => ({
  validateContextualValues: validateContextualValuesMock
}));

vi.mock('@/lib/db/sqlsecurity', () => ({
  validateSchemaOrThrow: validateSchemaOrThrowMock
}));

vi.mock('@/lib/db/connectionmanager', () => ({
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

vi.mock('@/lib/ingestion/temporary-measurements', () => ({
  COREMEASUREMENTS_JOIN_ALIAS: 'cm',
  deleteCoreMeasurementsInBoundedChunksWithAudit: deleteWithAuditMock
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
    authMock.mockResolvedValue({ user: { id: 'test-user-id', userStatus: 'global' } });
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

  it('DELETE clears failed measurements across all censusIDs for the selected logical census, auditing each row as the session user (#507)', async () => {
    const adminEmail = 'clear-admin@forestgeo.test';
    authMock.mockResolvedValue({ user: { email: adminEmail, userStatus: 'global' } });
    deleteWithAuditMock.mockResolvedValueOnce(3);

    const response = await DELETE(
      new Request('http://localhost/api/admin/clear/failedmeasurements/forestgeo_testing/1/2', { method: 'DELETE' }) as any,
      makeParams()
    );

    expect(response.status).toBe(200);
    expect(mockBeginTransaction).toHaveBeenCalledTimes(1);
    expect(deleteWithAuditMock).toHaveBeenCalledTimes(1);

    const [, schema, whereSQL, whereParams, changedBy, plotID, censusID, transactionID, fromSQL, lockedAliases] = deleteWithAuditMock.mock.calls[0]!;
    expect(schema).toBe('forestgeo_testing');
    expect(String(whereSQL)).toContain('c.PlotCensusNumber = (');
    expect(String(whereSQL)).toContain('selected_census.CensusID = ?');
    expect(String(whereSQL)).toContain('selected_census.PlotID = ?');
    expect(String(whereSQL)).not.toContain('AND cm.CensusID = ?');
    expect(whereParams).toEqual([1, 2, 1, INGESTION_ERROR_SOURCE]);
    expect(changedBy, 'the audit row must name the authenticated admin, never a client value').toBe(adminEmail);
    expect([plotID, censusID, transactionID]).toEqual([1, 2, 'tx-admin-clear']);
    expect(String(fromSQL)).toMatch(/coremeasurements cm JOIN \?\?\.census c/);
    expect(lockedAliases).toEqual(['cm']);

    const body = await response.json();
    expect(body.recordsCleared).toBe(3);
    expect(mockCommitTransaction).toHaveBeenCalledWith('tx-admin-clear');
    expect(mockRollbackTransaction).not.toHaveBeenCalled();
    expect(mockCloseConnection).toHaveBeenCalledTimes(1);
  });

  it('DELETE rolls back and reports 500 when the audited delete fails, so no row is removed without its audit row', async () => {
    deleteWithAuditMock.mockRejectedValueOnce(new Error('audit write failed'));

    const response = await DELETE(
      new Request('http://localhost/api/admin/clear/failedmeasurements/forestgeo_testing/1/2', { method: 'DELETE' }) as any,
      makeParams()
    );

    expect(response.status).toBe(500);
    expect(mockRollbackTransaction).toHaveBeenCalledWith('tx-admin-clear');
    expect(mockCommitTransaction).not.toHaveBeenCalled();
  });

  it('DELETE of staging rows deletes them unaudited and reports the affected-row count', async () => {
    mockExecuteQuery.mockResolvedValueOnce({ affectedRows: 4 });

    const response = await DELETE(
      new Request('http://localhost/api/admin/clear/temporarymeasurements/forestgeo_testing/1/2', { method: 'DELETE' }) as any,
      makeParams('temporarymeasurements')
    );

    expect(response.status).toBe(200);
    expect(deleteWithAuditMock).not.toHaveBeenCalled();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    expect(String(mockExecuteQuery.mock.calls[0]![0])).toMatch(/^DELETE FROM `?forestgeo_testing`?\.`?temporarymeasurements`?/);
    expect(mockExecuteQuery.mock.calls[0]![2]).toBe('tx-admin-clear');
    expect((await response.json()).recordsCleared).toBe(4);
  });

  it('DELETE rejects authenticated non-admin users', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'test-user-id', userStatus: 'field crew' } });

    const response = await DELETE(
      new Request('http://localhost/api/admin/clear/failedmeasurements/forestgeo_testing/1/2', { method: 'DELETE' }) as any,
      makeParams()
    );

    expect(response.status).toBe(403);
    expect(mockBeginTransaction).not.toHaveBeenCalled();
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  it('GET rejects authenticated non-admin users', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'test-user-id', userStatus: 'field crew' } });

    const response = await GET(new Request('http://localhost/api/admin/clear/failedmeasurements/forestgeo_testing/1/2') as any, makeParams());

    expect(response.status).toBe(403);
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });
});
