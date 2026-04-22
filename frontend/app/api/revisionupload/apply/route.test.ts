import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const MATCHED_PLAN_HASH = 'plan-hash-matched';
const DRIFTED_PLAN_HASH = 'plan-hash-drifted';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  isValidSchema: vi.fn(() => true),
  safeFormatQuery: vi.fn((_schema: string, query: string) => query),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  ensureUploadSessionsTable: vi.fn(),
  withTransaction: vi.fn(async (fn: (transactionId: string) => Promise<unknown>) => fn('tx-1')),
  acquireApplicationLock: vi.fn(async () => true),
  executeQuery: vi.fn<(...args: any[]) => Promise<any>>(async () => []),
  closeConnection: vi.fn(async () => undefined),
  buildMeasurementScopeLockName: vi.fn((schema: string, plotID: number, censusID: number) => `measurement-scope:${schema}:${plotID}:${censusID}`),
  refreshMeasurementViewsForScope: vi.fn(async () => undefined),
  assertEditScopeAllowed: vi.fn(async () => undefined),
  MockEditScopeForbiddenError: class MockEditScopeForbiddenError extends Error {},
  MockEditScopeConflictError: class MockEditScopeConflictError extends Error {},
  applyEditInTransaction: vi.fn(async () => ({
    updatedIDs: { CoreMeasurementID: 0 },
    applyErrors: [],
    editOperationID: null,
    validationPending: true
  })),
  analyzeBulk: vi.fn(async () => ({
    dataType: 'measurementssummary',
    rowCount: 0,
    rowPlans: [],
    aggregateEffects: [],
    maxSeverity: 'info',
    planHash: 'hash-not-mocked',
    generatedAt: '2026-04-21T00:00:00Z'
  }))
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

vi.mock('@/lib/measurementviewrefresh', () => ({
  refreshMeasurementViewsForScope: mocks.refreshMeasurementViewsForScope
}));

vi.mock('@/config/editplan/apply', () => ({
  applyEditInTransaction: mocks.applyEditInTransaction
}));

vi.mock('@/config/editplan/bulkanalyzer', () => ({
  analyzeBulk: mocks.analyzeBulk
}));

vi.mock('@/config/editplan/scopeguard', () => ({
  assertEditScopeAllowed: mocks.assertEditScopeAllowed,
  EditScopeForbiddenError: mocks.MockEditScopeForbiddenError,
  EditScopeConflictError: mocks.MockEditScopeConflictError
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError
  }
}));

function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/revisionupload/apply', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as any;
}

function buildValidBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    matchedRows: [],
    newRows: [],
    confirmNewRows: false,
    schema: 'forestgeo_testing',
    plotID: 1,
    censusID: 2,
    bulkPlanHash: MATCHED_PLAN_HASH,
    ...overrides
  };
}

function buildFreshPlan(planHash: string, overrides: Record<string, unknown> = {}) {
  return {
    dataType: 'measurementssummary',
    rowCount: 1,
    rowPlans: [],
    aggregateEffects: [],
    maxSeverity: 'info',
    planHash,
    generatedAt: '2026-04-21T00:00:00Z',
    ...overrides
  };
}

describe('POST /api/revisionupload/apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.auth.mockResolvedValue({ user: { name: 'Mason', email: 'mason@example.com' } });
    mocks.isValidSchema.mockReturnValue(true);
    mocks.ensureUploadSessionsTable.mockResolvedValue(undefined);
    mocks.withTransaction.mockImplementation(async (fn: (transactionId: string) => Promise<unknown>) => fn('tx-1'));
    mocks.acquireApplicationLock.mockResolvedValue(true);
    mocks.executeQuery.mockResolvedValue([]);
    mocks.closeConnection.mockResolvedValue(undefined);
    mocks.refreshMeasurementViewsForScope.mockResolvedValue(undefined);
    mocks.assertEditScopeAllowed.mockResolvedValue(undefined);
    mocks.analyzeBulk.mockResolvedValue(buildFreshPlan(MATCHED_PLAN_HASH));
    mocks.applyEditInTransaction.mockResolvedValue({
      updatedIDs: { CoreMeasurementID: 0 },
      applyErrors: [],
      editOperationID: null,
      validationPending: true
    });
  });

  it('rejects requests missing the bulkPlanHash batch-level guard', async () => {
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

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('bulkPlanHash');
  });

  it('returns 409 when the plot/census measurement scope lock is unavailable', async () => {
    mocks.acquireApplicationLock.mockResolvedValue(false);

    const response = await POST(buildRequest(buildValidBody()));

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

    const response = await POST(buildRequest(buildValidBody()));

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

    const response = await POST(buildRequest(buildValidBody()));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Cannot apply revisions while validation run 99 is active for plot 1, census 2'
    });
  });

  it('normalizes duplicate deletion IDs before validation so survivor collisions are caught', async () => {
    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: 42, csvRow: {}, duplicateMeasurementIDsToDelete: [42] }],
          duplicateMeasurementIDsToDelete: [{ coreMeasurementID: '42', survivorCoreMeasurementID: 42 }]
        })
      )
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

  it('recomputes the bulk hash from the full reviewed row set', async () => {
    await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [
            { coreMeasurementID: 101, csvRow: { dbh: '12.5' } },
            { coreMeasurementID: 202, csvRow: {}, duplicateMeasurementIDsToDelete: [303] }
          ],
          newRows: [{ csvIndex: 5, csvRow: { tag: 'T2', dbh: '1.2' } }],
          invalidRows: [{ csvIndex: 7, csvRow: { tag: 'BAD' }, reason: 'duplicate stemid' }]
        })
      )
    );

    expect(mocks.analyzeBulk).toHaveBeenCalledWith(
      expect.any(Object),
      'forestgeo_testing',
      'measurementssummary',
      1,
      2,
      {
        matched: [
          { rowIndex: 0, targetID: 101, newRow: { MeasuredDBH: '12.5' } },
          { rowIndex: 1, targetID: 202, newRow: {} }
        ],
        newRows: [{ rowIndex: 5, newRow: { MeasuredDBH: '1.2' } }],
        invalid: [{ rowIndex: 7, reason: 'duplicate stemid' }],
        duplicateMeasurementIDsToDelete: [303]
      },
      'tx-1'
    );
  });

  it('returns 409 with freshPlan when the bulk plan hash drifts between match and apply', async () => {
    const freshPlan = buildFreshPlan(DRIFTED_PLAN_HASH, { rowCount: 2 });
    mocks.analyzeBulk.mockResolvedValue(freshPlan);

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: 101, csvRow: { dbh: '12.5' } }],
          bulkPlanHash: MATCHED_PLAN_HASH
        })
      )
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'plan hash mismatch',
      freshPlan
    });
    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
  });

  it('calls applyEditInTransaction per matched row with operationType=bulk-revision-row and non-revertable ledger rows', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('WHERE cm.CoreMeasurementID = ?') && query.includes('LIMIT 1')) {
        return [{ ok: 1 }];
      }
      return [];
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [
            { coreMeasurementID: 101, csvRow: { dbh: '12.5', codes: 'L;D' } },
            { coreMeasurementID: 202, csvRow: { hom: '1.3' } }
          ]
        })
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.updatedCount).toBe(2);
    expect(body.skippedCount).toBe(0);
    expect(body.validationPending).toBe(true);

    expect(mocks.applyEditInTransaction).toHaveBeenCalledTimes(2);

    const firstCall = mocks.applyEditInTransaction.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    const firstInput = firstCall[1];
    expect(firstInput).toMatchObject({
      dataType: 'measurementssummary',
      schema: 'forestgeo_testing',
      plotID: 1,
      censusID: 2,
      targetID: 101,
        expectedPlanHash: null,
        operationType: 'bulk-revision-row',
        revertable: false,
        refreshViews: false,
        transactionID: 'tx-1'
      });
    expect(firstInput.newRow).toEqual({ MeasuredDBH: '12.5', Attributes: 'L;D' });

    const secondCall = mocks.applyEditInTransaction.mock.calls[1] as unknown as [unknown, Record<string, unknown>];
    const secondInput = secondCall[1];
    expect(secondInput).toMatchObject({
      targetID: 202,
      operationType: 'bulk-revision-row',
      revertable: false,
      refreshViews: false
    });
    expect(secondInput.newRow).toEqual({ MeasuredHOM: '1.3' });
  });

  it('rolls back the entire batch and surfaces 500 when the writer throws mid-loop', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('WHERE cm.CoreMeasurementID = ?') && query.includes('LIMIT 1')) {
        return [{ ok: 1 }];
      }
      return [];
    });

    const writerError = new Error('writer blew up on row 2');
    mocks.applyEditInTransaction.mockImplementationOnce(async () => ({
      updatedIDs: { CoreMeasurementID: 101 },
      applyErrors: [],
      editOperationID: null,
      validationPending: true
    }));
    mocks.applyEditInTransaction.mockImplementationOnce(async () => {
      throw writerError;
    });

    // Simulate withTransaction: run fn and propagate errors (no commit swallow).
    mocks.withTransaction.mockImplementation(async (fn: (transactionId: string) => Promise<unknown>) => {
      return fn('tx-1');
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [
            { coreMeasurementID: 101, csvRow: { dbh: '12.5' } },
            { coreMeasurementID: 202, csvRow: { dbh: '13.0' } }
          ]
        })
      )
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('writer blew up on row 2');
    expect(mocks.applyEditInTransaction).toHaveBeenCalledTimes(2);
    expect(mocks.refreshMeasurementViewsForScope).not.toHaveBeenCalled();
  });

  it('rolls back the batch when TOCTOU re-resolve finds a measurement inactive', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('WHERE cm.CoreMeasurementID = ?') && query.includes('LIMIT 1')) {
        return []; // row no longer active
      }
      return [];
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: 101, csvRow: { dbh: '12.5' } }]
        })
      )
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe('Measurement 101 is no longer active in this plot/census — may have been deactivated since upload was matched');
    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
  });

  it('deletes denormalized view rows when removing a verified duplicate measurement', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
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
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: 101, csvRow: {}, duplicateMeasurementIDsToDelete: [55] }],
          duplicateMeasurementIDsToDelete: [{ coreMeasurementID: 55, survivorCoreMeasurementID: 101 }]
        })
      )
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

    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
    expect(mocks.executeQuery).toHaveBeenCalledWith('DELETE FROM ??.measurementssummary WHERE CoreMeasurementID = ?', [55], 'tx-1');
    expect(mocks.executeQuery).toHaveBeenCalledWith('DELETE FROM ??.viewfulltable WHERE CoreMeasurementID = ?', [55], 'tx-1');
    expect(mocks.refreshMeasurementViewsForScope).toHaveBeenCalledWith(expect.any(Object), 'forestgeo_testing', 1, 2, 'tx-1');
  });

  it('refreshes derived measurement views when matched rows are updated', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('WHERE cm.CoreMeasurementID = ?') && query.includes('LIMIT 1')) {
        return [{ ok: 1 }];
      }
      return [];
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: 101, csvRow: { dbh: '12.5' } }]
        })
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      updatedCount: 1,
      skippedCount: 0,
      insertedCount: 0,
      deletedDuplicateCount: 0,
      applyErrors: [],
      validationPending: true
    });

    expect(mocks.applyEditInTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.refreshMeasurementViewsForScope).toHaveBeenCalledWith(expect.any(Object), 'forestgeo_testing', 1, 2, 'tx-1');
  });

  it('does not refresh derived measurement views when apply makes no changes', async () => {
    mocks.executeQuery.mockImplementation(async (query: string) => {
      if (query.includes('FROM ??.upload_sessions')) return [];
      if (query.includes('FROM ??.validation_runs')) return [];
      if (query.includes('WHERE cm.CoreMeasurementID = ?') && query.includes('LIMIT 1')) {
        return [{ ok: 1 }];
      }
      return [];
    });

    const response = await POST(
      buildRequest(
        buildValidBody({
          matchedRows: [{ coreMeasurementID: 101, csvRow: {} }]
        })
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      updatedCount: 0,
      skippedCount: 1,
      insertedCount: 0,
      deletedDuplicateCount: 0,
      applyErrors: [],
      validationPending: false
    });

    expect(mocks.refreshMeasurementViewsForScope).not.toHaveBeenCalled();
    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
  });
});
