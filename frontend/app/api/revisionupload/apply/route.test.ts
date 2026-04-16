import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  isValidSchema: vi.fn(() => true),
  safeFormatQuery: vi.fn((_schema: string, query: string) => query),
  loggerError: vi.fn(),
  ensureUploadSessionsTable: vi.fn(),
  withTransaction: vi.fn(async (fn: (transactionId: string) => Promise<unknown>) => fn('tx-1')),
  acquireApplicationLock: vi.fn(async () => true),
  executeQuery: vi.fn(async () => []),
  closeConnection: vi.fn(async () => undefined),
  buildMeasurementScopeLockName: vi.fn((schema: string, plotID: number, censusID: number) => `measurement-scope:${schema}:${plotID}:${censusID}`)
}));

vi.mock('@/auth', () => ({
  auth: mocks.auth
}));

vi.mock('@/config/utils/sqlsecurity', () => ({
  isValidSchema: mocks.isValidSchema,
  safeFormatQuery: mocks.safeFormatQuery
}));

vi.mock('@/config/uploadsessiontracker', () => ({
  ACTIVE_UPLOAD_SESSION_STATES: ['initialized', 'uploading', 'uploaded', 'processing', 'collapsing'],
  ensureUploadSessionsTable: mocks.ensureUploadSessionsTable,
  SESSION_TIMEOUTS: {
    HEARTBEAT_TIMEOUT: 30_000
  }
}));

vi.mock('@/config/measurementscopelock', () => ({
  buildMeasurementScopeLockName: mocks.buildMeasurementScopeLockName,
  MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS: 0
}));

vi.mock('@/config/utils', () => ({
  generateShortBatchID: vi.fn(() => 'batch-1')
}));

vi.mock('@/lib/errorhelpers', () => ({
  isMySQLError: vi.fn(() => false)
}));

vi.mock('@/config/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      withTransaction: mocks.withTransaction,
      acquireApplicationLock: mocks.acquireApplicationLock,
      executeQuery: mocks.executeQuery,
      closeConnection: mocks.closeConnection
    })
  }
}));

vi.mock('@/ailogger', () => ({
  default: {
    error: mocks.loggerError
  }
}));

function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/revisionupload/apply', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as any;
}

describe('POST /api/revisionupload/apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.auth.mockResolvedValue({ user: { name: 'Mason' } });
    mocks.isValidSchema.mockReturnValue(true);
    mocks.ensureUploadSessionsTable.mockResolvedValue(undefined);
    mocks.withTransaction.mockImplementation(async (fn: (transactionId: string) => Promise<unknown>) => fn('tx-1'));
    mocks.acquireApplicationLock.mockResolvedValue(true);
    mocks.executeQuery.mockResolvedValue([]);
    mocks.closeConnection.mockResolvedValue(undefined);
  });

  it('returns 409 when the plot/census measurement scope lock is unavailable', async () => {
    mocks.acquireApplicationLock.mockResolvedValue(false);

    const response = await POST(
      buildRequest({
        matchedRows: [],
        newRows: [],
        confirmNewRows: false,
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Another measurement operation is already in progress for plot 1, census 2'
    });
    expect(mocks.buildMeasurementScopeLockName).toHaveBeenCalledWith('forestgeo_testing', 1, 2);
    expect(mocks.acquireApplicationLock).toHaveBeenCalledWith('measurement-scope:forestgeo_testing:1:2', 'tx-1', 0);
  });

  it('returns 409 when a clean upload session is active for the same plot/census', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) {
        return [{ session_id: 'upload-session-7' }];
      }
      return [];
    });

    const response = await POST(
      buildRequest({
        matchedRows: [],
        newRows: [],
        confirmNewRows: false,
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Cannot apply revisions while upload session upload-session-7 is active for plot 1, census 2'
    });
  });

  it('returns 409 when a recent validation run is active for the same plot/census', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) {
        return [];
      }
      if (query.includes('FROM ??.validation_runs')) {
        return [{ RunID: 99, StartedAt: new Date().toISOString() }];
      }
      return [];
    });

    const response = await POST(
      buildRequest({
        matchedRows: [],
        newRows: [],
        confirmNewRows: false,
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Cannot apply revisions while validation run 99 is active for plot 1, census 2'
    });
  });

  it('normalizes duplicate deletion IDs before validation so survivor collisions are caught', async () => {
    const response = await POST(
      buildRequest({
        matchedRows: [{ coreMeasurementID: 42, csvRow: {} }],
        newRows: [],
        confirmNewRows: false,
        duplicateMeasurementIDsToDelete: [{ coreMeasurementID: '42', survivorCoreMeasurementID: 42 }],
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Duplicate deletion request failed validation',
      applyErrors: [
        {
          coreMeasurementID: 42,
          error: 'Duplicate ID 42 is also a survivor — refusing to delete a row being updated'
        }
      ]
    });
  });

  it('deletes denormalized view rows when removing a verified duplicate measurement', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) {
        return [];
      }
      if (query.includes('FROM ??.validation_runs')) {
        return [];
      }
      if (query.includes('WHERE cm.CoreMeasurementID = ?') && query.includes('LIMIT 1')) {
        return [{ ok: 1 }];
      }
      if (query.includes('SELECT cm.CoreMeasurementID, cm.StemGUID')) {
        return [
          { CoreMeasurementID: 55, StemGUID: 777 },
          { CoreMeasurementID: 101, StemGUID: 777 }
        ];
      }
      if (query.includes('DELETE FROM ??.coremeasurements WHERE CoreMeasurementID = ? AND CensusID = ? AND IsActive = 1')) {
        return { affectedRows: 1 };
      }
      return [];
    });

    const response = await POST(
      buildRequest({
        matchedRows: [{ coreMeasurementID: 101, csvRow: {} }],
        newRows: [],
        confirmNewRows: false,
        duplicateMeasurementIDsToDelete: [{ coreMeasurementID: 55, survivorCoreMeasurementID: 101 }],
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      updatedCount: 0,
      skippedCount: 1,
      insertedCount: 0,
      deletedDuplicateCount: 1,
      applyErrors: [],
      validationPending: true
    });

    expect(mocks.executeQuery).toHaveBeenCalledWith('DELETE FROM ??.measurementssummary WHERE CoreMeasurementID = ?', [55], 'tx-1');
    expect(mocks.executeQuery).toHaveBeenCalledWith('DELETE FROM ??.viewfulltable WHERE CoreMeasurementID = ?', [55], 'tx-1');
  });
});
