import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NonRevertableEditOperationError, RevertDriftError, revertEdit } from './revert';
import { ScopeLockHeldError } from './apply';

const RESTORE_PLAN_HASH = 'r'.repeat(64);

const mocks = vi.hoisted(() => ({
  ensureEditOperationsTable: vi.fn(),
  readEditOperation: vi.fn(),
  markEditOperationReverted: vi.fn(),
  applyEditInTransaction: vi.fn(),
  analyzeEdit: vi.fn(),
  assertEditPlanCanApply: vi.fn()
}));

vi.mock('@/config/editoperations', () => ({
  ensureEditOperationsTable: mocks.ensureEditOperationsTable,
  readEditOperation: mocks.readEditOperation,
  markEditOperationReverted: mocks.markEditOperationReverted
}));

vi.mock('./apply', () => ({
  applyEditInTransaction: mocks.applyEditInTransaction,
  ScopeLockHeldError: class ScopeLockHeldError extends Error {}
}));

vi.mock('./analyzer', () => ({
  analyzeEdit: mocks.analyzeEdit,
  assertEditPlanCanApply: mocks.assertEditPlanCanApply
}));

function buildRestorePlan(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    dataType: 'measurementssummary',
    targetID: 42,
    fieldChanges: [],
    effects: [],
    maxSeverity: 'info' as const,
    planHash: RESTORE_PLAN_HASH,
    generatedAt: '2026-04-22T00:00:00.000Z',
    ...overrides
  };
}

function makeConnectionManager() {
  return {
    beginTransaction: vi.fn(async () => 'tx'),
    commitTransaction: vi.fn(async () => undefined),
    rollbackTransaction: vi.fn(async () => undefined),
    acquireApplicationLock: vi.fn(async () => true),
    executeQuery: vi.fn(async () => ({ affectedRows: 1 }))
  } as any;
}

function buildOperation(overrides: Record<string, unknown> = {}) {
  return {
    editOperationID: 7,
    operationType: 'single-row-edit',
    revertable: true,
    dataType: 'failedmeasurements',
    targetID: 42,
    plotID: 1,
    censusID: 2,
    planHash: 'a'.repeat(64),
    beforeState: [
      {
        table: 'coremeasurements',
        primaryKey: 'CoreMeasurementID',
        primaryKeyValue: 42,
        row: {
          RawTreeTag: '011375',
          RawStemTag: '5',
          RawSpCode: 'CRATSN',
          RawQuadrat: '0101',
          RawX: 18.4,
          RawY: 9.9,
          MeasuredDBH: 12,
          MeasuredHOM: 1.3,
          MeasurementDate: '1994-12-05',
          RawCodes: 'M',
          RawComments: null
        }
      }
    ],
    afterState: [],
    createdBy: 'mason@example.com',
    createdAt: '2026-04-21T00:00:00.000Z',
    revertedByEditOperationID: null,
    ...overrides
  };
}

describe('revertEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureEditOperationsTable.mockResolvedValue(undefined);
    mocks.markEditOperationReverted.mockResolvedValue(undefined);
    mocks.analyzeEdit.mockResolvedValue(buildRestorePlan());
    mocks.assertEditPlanCanApply.mockReturnValue(undefined);
  });

  it('rejects non-revertable bulk revision rows before opening a transaction', async () => {
    const cm = makeConnectionManager();
    mocks.readEditOperation.mockResolvedValue(buildOperation({ operationType: 'bulk-revision-row', revertable: false }));

    await expect(revertEdit(cm, { schema: 'forestgeo_testing', editOperationID: 7, createdBy: 'mason@example.com' })).rejects.toBeInstanceOf(
      NonRevertableEditOperationError
    );

    expect(mocks.ensureEditOperationsTable).toHaveBeenCalledWith(cm, 'forestgeo_testing');
    expect(cm.beginTransaction).not.toHaveBeenCalled();
    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
  });

  it('marks revert ledger rows as non-revertable and forwards the restore plan hash to apply', async () => {
    const cm = makeConnectionManager();
    mocks.readEditOperation.mockResolvedValue(buildOperation());
    mocks.applyEditInTransaction.mockResolvedValue({
      updatedIDs: { coremeasurements: 42 },
      applyErrors: [],
      editOperationID: 8,
      validationPending: false
    });

    await revertEdit(cm, { schema: 'forestgeo_testing', editOperationID: 7, createdBy: 'mason@example.com' });

    expect(mocks.applyEditInTransaction).toHaveBeenCalledWith(
      cm,
      expect.objectContaining({
        operationType: 'revert',
        revertable: false,
        transactionID: 'tx',
        expectedPlanHash: RESTORE_PLAN_HASH
      })
    );
    expect(mocks.markEditOperationReverted).toHaveBeenCalledWith(cm, 'forestgeo_testing', 7, 8, 'tx');
    expect(cm.commitTransaction).toHaveBeenCalledWith('tx');
  });

  it('throws RevertDriftError when the restore plan has warn severity and no confirmation is supplied', async () => {
    const cm = makeConnectionManager();
    mocks.readEditOperation.mockResolvedValue(buildOperation());
    const driftedPlan = buildRestorePlan({ maxSeverity: 'warn' });
    mocks.analyzeEdit.mockResolvedValue(driftedPlan);

    await expect(revertEdit(cm, { schema: 'forestgeo_testing', editOperationID: 7, createdBy: 'mason@example.com' })).rejects.toBeInstanceOf(RevertDriftError);

    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
    expect(mocks.markEditOperationReverted).not.toHaveBeenCalled();
    expect(cm.rollbackTransaction).toHaveBeenCalledWith('tx');
    expect(cm.commitTransaction).not.toHaveBeenCalled();
  });

  it('throws RevertDriftError when the restore plan is destructive and no confirmation is supplied', async () => {
    const cm = makeConnectionManager();
    mocks.readEditOperation.mockResolvedValue(buildOperation());
    const driftedPlan = buildRestorePlan({ maxSeverity: 'destructive' });
    mocks.analyzeEdit.mockResolvedValue(driftedPlan);

    await expect(revertEdit(cm, { schema: 'forestgeo_testing', editOperationID: 7, createdBy: 'mason@example.com' })).rejects.toBeInstanceOf(RevertDriftError);
  });

  it('proceeds when a non-info restore plan hash is explicitly confirmed', async () => {
    const cm = makeConnectionManager();
    mocks.readEditOperation.mockResolvedValue(buildOperation());
    const warnPlan = buildRestorePlan({ maxSeverity: 'warn' });
    mocks.analyzeEdit.mockResolvedValue(warnPlan);
    mocks.applyEditInTransaction.mockResolvedValue({
      updatedIDs: { coremeasurements: 42 },
      applyErrors: [],
      editOperationID: 8,
      validationPending: false
    });

    await revertEdit(cm, {
      schema: 'forestgeo_testing',
      editOperationID: 7,
      createdBy: 'mason@example.com',
      confirmedPlanHash: warnPlan.planHash
    });

    expect(mocks.applyEditInTransaction).toHaveBeenCalledWith(cm, expect.objectContaining({ expectedPlanHash: warnPlan.planHash }));
    expect(cm.commitTransaction).toHaveBeenCalledWith('tx');
  });

  it('throws ScopeLockHeldError and rolls back when the scope lock cannot be acquired', async () => {
    const cm = makeConnectionManager();
    cm.acquireApplicationLock = vi.fn(async () => false);
    mocks.readEditOperation.mockResolvedValue(buildOperation());

    await expect(revertEdit(cm, { schema: 'forestgeo_testing', editOperationID: 7, createdBy: 'mason@example.com' })).rejects.toBeInstanceOf(
      ScopeLockHeldError
    );

    // No analyzer pass, no writer call, no ledger marking — and the tx is rolled back, not committed.
    expect(mocks.analyzeEdit).not.toHaveBeenCalled();
    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
    expect(mocks.markEditOperationReverted).not.toHaveBeenCalled();
    expect(cm.commitTransaction).not.toHaveBeenCalled();
    expect(cm.rollbackTransaction).toHaveBeenCalledWith('tx');
  });

  it('rejects a stale confirmedPlanHash that does not match the fresh restore plan', async () => {
    const cm = makeConnectionManager();
    mocks.readEditOperation.mockResolvedValue(buildOperation());
    mocks.analyzeEdit.mockResolvedValue(buildRestorePlan({ maxSeverity: 'warn' }));

    await expect(
      revertEdit(cm, {
        schema: 'forestgeo_testing',
        editOperationID: 7,
        createdBy: 'mason@example.com',
        confirmedPlanHash: 's'.repeat(64)
      })
    ).rejects.toBeInstanceOf(RevertDriftError);

    expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
  });

  it('removes tree and stem rows created by the original edit after applying the restore', async () => {
    const cm = makeConnectionManager();
    mocks.readEditOperation.mockResolvedValue(
      buildOperation({
        dataType: 'measurementssummary',
        beforeState: [
          {
            table: 'coremeasurements',
            primaryKey: 'CoreMeasurementID',
            primaryKeyValue: 42,
            row: {
              RawTreeTag: 'OLD',
              RawStemTag: '1',
              RawSpCode: 'SP',
              RawQuadrat: '0101',
              RawX: 1,
              RawY: 2,
              MeasuredDBH: 12,
              MeasuredHOM: 1.3,
              MeasurementDate: '1994-12-05',
              RawCodes: 'A; M',
              Description: 'Initial measurement'
            }
          },
          { table: 'stems', primaryKey: 'StemGUID', primaryKeyValue: 555, row: null },
          { table: 'trees', primaryKey: 'TreeID', primaryKeyValue: 777, row: null }
        ],
        afterState: [
          {
            table: 'stems',
            primaryKey: 'StemGUID',
            primaryKeyValue: 555,
            row: { StemGUID: 555, TreeID: 777, CensusID: 2, IsActive: 1 }
          },
          {
            table: 'trees',
            primaryKey: 'TreeID',
            primaryKeyValue: 777,
            row: { TreeID: 777, CensusID: 2, IsActive: 1 }
          }
        ]
      })
    );
    mocks.applyEditInTransaction.mockResolvedValue({
      updatedIDs: { coremeasurements: 42 },
      applyErrors: [],
      editOperationID: 8,
      validationPending: false
    });

    await revertEdit(cm, { schema: 'forestgeo_testing', editOperationID: 7, createdBy: 'mason@example.com' });

    expect(cm.executeQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM `forestgeo_testing`.stems'), [555, 555], 'tx');
    expect(cm.executeQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM `forestgeo_testing`.trees'), [777, 777], 'tx');
    expect(cm.commitTransaction).toHaveBeenCalledWith('tx');
  });
});
