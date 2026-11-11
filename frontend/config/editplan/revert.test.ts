import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AlreadyRevertedError,
  EditOperationNotFoundError,
  NonRevertableEditOperationError,
  RevertDriftError,
  RevertRecordChangedError,
  revertEdit
} from './revert';
import { ScopeLockHeldError } from './apply';
import { ScopeAccessError } from './scopeguard';

const RESTORE_PLAN_HASH = 'r'.repeat(64);

const mocks = vi.hoisted(() => ({
  ensureEditOperationsTable: vi.fn(),
  readEditOperation: vi.fn(),
  markEditOperationReverted: vi.fn(),
  writeEditOperation: vi.fn(),
  applyEditInTransaction: vi.fn(),
  analyzeEdit: vi.fn(),
  assertEditPlanCanApply: vi.fn(),
  parseSpeciesCorrectionUndoMetadata: vi.fn(),
  preflightSpeciesCorrectionUndo: vi.fn(),
  buildSpeciesCorrectionUndoPlan: vi.fn(),
  writeSpeciesCorrectionUndo: vi.fn()
}));

vi.mock('@/config/editoperations', () => ({
  ensureEditOperationsTable: mocks.ensureEditOperationsTable,
  readEditOperation: mocks.readEditOperation,
  markEditOperationReverted: mocks.markEditOperationReverted,
  writeEditOperation: mocks.writeEditOperation
}));

vi.mock('./apply', () => ({
  applyEditInTransaction: mocks.applyEditInTransaction,
  ScopeLockHeldError: class ScopeLockHeldError extends Error {}
}));

vi.mock('./analyzer', () => ({
  analyzeEdit: mocks.analyzeEdit,
  assertEditPlanCanApply: mocks.assertEditPlanCanApply
}));

// #427 species-correction collaborators — mocked so this suite proves only
// revertEdit's dispatch wiring; see the real-MySQL integration suite for deep coverage.
vi.mock('@/config/editplan/species-correction-undo-metadata', () => ({
  parseSpeciesCorrectionUndoMetadata: mocks.parseSpeciesCorrectionUndoMetadata
}));

vi.mock('./species-correction-undo', () => ({
  preflightSpeciesCorrectionUndo: mocks.preflightSpeciesCorrectionUndo,
  buildSpeciesCorrectionUndoPlan: mocks.buildSpeciesCorrectionUndoPlan
}));

vi.mock('./species-correction-undo-write', () => ({
  writeSpeciesCorrectionUndo: mocks.writeSpeciesCorrectionUndo
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
    // null = "not a species correction" (see revert.ts); the species-correction
    // describe block below overrides this per-test.
    mocks.parseSpeciesCorrectionUndoMetadata.mockReturnValue(null);
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

  describe('legacy measurementssummary restore row and SpeciesCode', () => {
    function buildMeasurementsSummaryOperation(beforeRawSpCode: string, afterRawSpCode: string | undefined) {
      const coreRow = (rawSpCode: string, measuredDBH: number) => ({
        RawTreeTag: '011375',
        RawStemTag: '5',
        RawSpCode: rawSpCode,
        RawQuadrat: '0101',
        MeasuredDBH: measuredDBH,
        MeasuredHOM: 1.3,
        MeasurementDate: '1994-12-05',
        RawCodes: 'M',
        Description: null
      });
      const beforeCore = { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 42, row: coreRow(beforeRawSpCode, 12) };
      const afterState =
        afterRawSpCode === undefined
          ? []
          : [{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 42, row: coreRow(afterRawSpCode, 15) }];
      return buildOperation({ dataType: 'measurementssummary', beforeState: [beforeCore], afterState });
    }

    async function revertAndCaptureRestoreRow(operation: ReturnType<typeof buildOperation>): Promise<Record<string, unknown>> {
      const cm = makeConnectionManager();
      mocks.readEditOperation.mockResolvedValue(operation);
      mocks.applyEditInTransaction.mockResolvedValue({ updatedIDs: {}, applyErrors: [], editOperationID: 8, validationPending: false });
      await revertEdit(cm, { schema: 'forestgeo_testing', editOperationID: 7, createdBy: 'mason@example.com' });
      expect(mocks.analyzeEdit).toHaveBeenCalledTimes(1);
      return mocks.analyzeEdit.mock.calls[0][6] as Record<string, unknown>;
    }

    it('omits SpeciesCode when the original edit left RawSpCode unchanged, so undoing a DBH edit cannot plan a tree-wide species correction', async () => {
      const restoreRow = await revertAndCaptureRestoreRow(buildMeasurementsSummaryOperation('AAA', 'AAA'));

      expect(restoreRow, `restore row sent to analyzeEdit: ${JSON.stringify(restoreRow)}`).not.toHaveProperty('SpeciesCode');
      expect(restoreRow.MeasuredDBH).toBe(12);
    });

    it('restores SpeciesCode when the original edit changed RawSpCode', async () => {
      const restoreRow = await revertAndCaptureRestoreRow(buildMeasurementsSummaryOperation('AAA', 'BBB'));

      expect(restoreRow.SpeciesCode, `restore row sent to analyzeEdit: ${JSON.stringify(restoreRow)}`).toBe('AAA');
    });

    it('restores SpeciesCode when the ledger row has no coremeasurements afterState to prove the species was untouched', async () => {
      const restoreRow = await revertAndCaptureRestoreRow(buildMeasurementsSummaryOperation('AAA', undefined));

      expect(restoreRow.SpeciesCode, `restore row sent to analyzeEdit: ${JSON.stringify(restoreRow)}`).toBe('AAA');
    });
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

  describe('ledger-lock prerequisite: two-read pattern', () => {
    it('reads once unlocked to discover scope, then re-reads FOR UPDATE only after the scope lock is held', async () => {
      const cm = makeConnectionManager();
      const operation = buildOperation();
      const callOrder: string[] = [];

      cm.acquireApplicationLock = vi.fn(async () => {
        callOrder.push('lock-acquired');
        return true;
      });
      mocks.readEditOperation.mockImplementation(
        async (_cm: unknown, _schema: string, _id: number, transactionID?: string, options?: { forUpdate?: boolean }) => {
          callOrder.push(options?.forUpdate ? 'locked-read' : 'discovery-read');
          return operation;
        }
      );
      mocks.applyEditInTransaction.mockResolvedValue({
        updatedIDs: { coremeasurements: 42 },
        applyErrors: [],
        editOperationID: 8,
        validationPending: false
      });

      await revertEdit(cm, { schema: 'forestgeo_testing', editOperationID: 7, createdBy: 'mason@example.com' });

      expect(callOrder).toEqual(['discovery-read', 'lock-acquired', 'locked-read']);
      expect(mocks.readEditOperation).toHaveBeenCalledTimes(2);
      expect(mocks.readEditOperation).toHaveBeenNthCalledWith(1, cm, 'forestgeo_testing', 7);
      expect(mocks.readEditOperation).toHaveBeenNthCalledWith(2, cm, 'forestgeo_testing', 7, 'tx', { forUpdate: true });
    });

    it('rolls back without writing when the locked re-read shows a concurrent revert already claimed the row', async () => {
      const cm = makeConnectionManager();
      const discovery = buildOperation();
      mocks.readEditOperation.mockResolvedValueOnce(discovery).mockResolvedValueOnce({ ...discovery, revertedByEditOperationID: 999 });

      await expect(revertEdit(cm, { schema: 'forestgeo_testing', editOperationID: 7, createdBy: 'mason@example.com' })).rejects.toBeInstanceOf(
        AlreadyRevertedError
      );

      expect(mocks.analyzeEdit).not.toHaveBeenCalled();
      expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
      expect(mocks.markEditOperationReverted).not.toHaveBeenCalled();
      expect(cm.commitTransaction).not.toHaveBeenCalled();
      expect(cm.rollbackTransaction).toHaveBeenCalledWith('tx');
    });

    it('rolls back without writing when the locked re-read finds the row gone', async () => {
      const cm = makeConnectionManager();
      mocks.readEditOperation.mockResolvedValueOnce(buildOperation()).mockResolvedValueOnce(null);

      await expect(revertEdit(cm, { schema: 'forestgeo_testing', editOperationID: 7, createdBy: 'mason@example.com' })).rejects.toBeInstanceOf(
        EditOperationNotFoundError
      );

      expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
      expect(mocks.markEditOperationReverted).not.toHaveBeenCalled();
      expect(cm.rollbackTransaction).toHaveBeenCalledWith('tx');
    });

    it('rolls back without writing when the locked re-read shows the row became non-revertable', async () => {
      const cm = makeConnectionManager();
      mocks.readEditOperation.mockResolvedValueOnce(buildOperation()).mockResolvedValueOnce(buildOperation({ revertable: false }));

      await expect(revertEdit(cm, { schema: 'forestgeo_testing', editOperationID: 7, createdBy: 'mason@example.com' })).rejects.toBeInstanceOf(
        NonRevertableEditOperationError
      );

      expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
      expect(mocks.markEditOperationReverted).not.toHaveBeenCalled();
      expect(cm.rollbackTransaction).toHaveBeenCalledWith('tx');
    });

    it('rolls back without writing when the locked re-read disagrees with discovery on the revert target', async () => {
      const cm = makeConnectionManager();
      mocks.readEditOperation.mockResolvedValueOnce(buildOperation()).mockResolvedValueOnce(buildOperation({ targetID: 9999 }));

      await expect(revertEdit(cm, { schema: 'forestgeo_testing', editOperationID: 7, createdBy: 'mason@example.com' })).rejects.toBeInstanceOf(
        RevertRecordChangedError
      );

      expect(mocks.analyzeEdit).not.toHaveBeenCalled();
      expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
      expect(mocks.markEditOperationReverted).not.toHaveBeenCalled();
      expect(cm.rollbackTransaction).toHaveBeenCalledWith('tx');
    });

    it('rolls back without writing when the locked re-read disagrees with discovery on plot/census scope', async () => {
      const cm = makeConnectionManager();
      mocks.readEditOperation.mockResolvedValueOnce(buildOperation()).mockResolvedValueOnce(buildOperation({ censusID: 55 }));

      await expect(revertEdit(cm, { schema: 'forestgeo_testing', editOperationID: 7, createdBy: 'mason@example.com' })).rejects.toBeInstanceOf(
        RevertRecordChangedError
      );

      expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
      expect(cm.rollbackTransaction).toHaveBeenCalledWith('tx');
    });

    it('throws ScopeAccessError before opening a transaction when the discovery read disagrees with the authorized scope', async () => {
      const cm = makeConnectionManager();
      mocks.readEditOperation.mockResolvedValue(buildOperation({ plotID: 1, censusID: 2 }));

      await expect(
        revertEdit(cm, {
          schema: 'forestgeo_testing',
          editOperationID: 7,
          createdBy: 'mason@example.com',
          expectedScope: { plotID: 1, censusID: 999 }
        })
      ).rejects.toBeInstanceOf(ScopeAccessError);

      expect(cm.beginTransaction).not.toHaveBeenCalled();
      expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
    });

    it('rolls back when the locked re-read scope no longer matches the authorized scope', async () => {
      const cm = makeConnectionManager();
      mocks.readEditOperation
        .mockResolvedValueOnce(buildOperation({ plotID: 1, censusID: 2 }))
        .mockResolvedValueOnce(buildOperation({ plotID: 1, censusID: 777 }));

      await expect(
        revertEdit(cm, {
          schema: 'forestgeo_testing',
          editOperationID: 7,
          createdBy: 'mason@example.com',
          expectedScope: { plotID: 1, censusID: 2 }
        })
      ).rejects.toBeInstanceOf(ScopeAccessError);

      expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
      expect(mocks.markEditOperationReverted).not.toHaveBeenCalled();
      expect(cm.rollbackTransaction).toHaveBeenCalledWith('tx');
    });

    it('proceeds when the discovery and locked reads both match the caller-authorized scope', async () => {
      const cm = makeConnectionManager();
      mocks.readEditOperation.mockResolvedValue(buildOperation({ plotID: 1, censusID: 2 }));
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
        expectedScope: { plotID: 1, censusID: 2 }
      });

      expect(cm.commitTransaction).toHaveBeenCalledWith('tx');
    });

    it('preserves the markEditOperationReverted error over a subsequent rollback failure', async () => {
      const cm = makeConnectionManager();
      mocks.readEditOperation.mockResolvedValue(buildOperation());
      mocks.applyEditInTransaction.mockResolvedValue({
        updatedIDs: { coremeasurements: 42 },
        applyErrors: [],
        editOperationID: 8,
        validationPending: false
      });
      const markError = new Error('markEditOperationReverted: edit operation 7 not found or already reverted');
      mocks.markEditOperationReverted.mockRejectedValue(markError);
      cm.rollbackTransaction = vi.fn(async () => {
        throw new Error('rollback: connection lost');
      });

      await expect(revertEdit(cm, { schema: 'forestgeo_testing', editOperationID: 7, createdBy: 'mason@example.com' })).rejects.toBe(markError);

      expect(cm.commitTransaction).not.toHaveBeenCalled();
      expect(cm.rollbackTransaction).toHaveBeenCalledWith('tx');
    });
  });

  describe('#427 species-correction undo dispatch', () => {
    const SPECIES_CORRECTION_UNDO_PLAN_HASH = 'u'.repeat(64);
    const EDITED_CORE_MEASUREMENT_ID = 4242;
    const NEW_UNDO_LEDGER_ID = 909;
    const MEMBER_CORE_MEASUREMENT_BEFORE_ROW = {
      table: 'coremeasurements',
      primaryKey: 'CoreMeasurementID',
      primaryKeyValue: EDITED_CORE_MEASUREMENT_ID,
      row: { RawSpCode: 'OLD' }
    };
    const MEMBER_CORE_MEASUREMENT_AFTER_ROW = {
      table: 'coremeasurements',
      primaryKey: 'CoreMeasurementID',
      primaryKeyValue: EDITED_CORE_MEASUREMENT_ID,
      row: { RawSpCode: 'NEW' }
    };
    const TREE_BEFORE_ROW = { table: 'trees', primaryKey: 'TreeID', primaryKeyValue: 1, row: { SpeciesID: 1 } };
    const TREE_AFTER_ROW = { table: 'trees', primaryKey: 'TreeID', primaryKeyValue: 1, row: { SpeciesID: 2 } };

    const speciesCorrectionMetadataPair = { before: {}, after: {} };
    const undoPreflight = { metadata: { after: { editedCoreMeasurementID: EDITED_CORE_MEASUREMENT_ID } } };
    const undoPlan = { planHash: SPECIES_CORRECTION_UNDO_PLAN_HASH };
    const undoWriteResult = {
      treeBeforeState: TREE_BEFORE_ROW,
      treeAfterState: TREE_AFTER_ROW,
      editedStemBeforeState: null,
      editedStemAfterState: null,
      memberCoreMeasurementBeforeState: [MEMBER_CORE_MEASUREMENT_BEFORE_ROW],
      memberCoreMeasurementAfterState: [MEMBER_CORE_MEASUREMENT_AFTER_ROW],
      attributeBeforeState: [],
      attributeAfterState: [],
      errorRefresh: { pendingMeasurementIDs: [], ingestionRefreshedMeasurementIDs: [] }
    };

    beforeEach(() => {
      mocks.parseSpeciesCorrectionUndoMetadata.mockReturnValue(speciesCorrectionMetadataPair);
      mocks.preflightSpeciesCorrectionUndo.mockResolvedValue(undoPreflight);
      mocks.buildSpeciesCorrectionUndoPlan.mockReturnValue(undoPlan);
      mocks.writeSpeciesCorrectionUndo.mockResolvedValue(undoWriteResult);
      mocks.writeEditOperation.mockResolvedValue(NEW_UNDO_LEDGER_ID);
    });

    it('dispatches a recognized species correction to the undo writer, never the legacy reconstruct/apply/cleanup path', async () => {
      const cm = makeConnectionManager();
      mocks.readEditOperation.mockResolvedValue(buildOperation());

      await revertEdit(cm, {
        schema: 'forestgeo_testing',
        editOperationID: 7,
        createdBy: 'mason@example.com',
        confirmedPlanHash: SPECIES_CORRECTION_UNDO_PLAN_HASH
      });

      expect(mocks.analyzeEdit).not.toHaveBeenCalled();
      expect(mocks.applyEditInTransaction).not.toHaveBeenCalled();
      // The legacy-only cleanup path issues DELETE queries; the undo path never does.
      expect(cm.executeQuery).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM'), expect.anything(), expect.anything());
      expect(mocks.writeSpeciesCorrectionUndo).toHaveBeenCalledTimes(1);
      expect(cm.commitTransaction).toHaveBeenCalledWith('tx');
    });

    it('throws RevertDriftError carrying the freshly built reverse undo plan, with no mutation and no ledger insert, when confirmedPlanHash is missing', async () => {
      const cm = makeConnectionManager();
      mocks.readEditOperation.mockResolvedValue(buildOperation());

      let caught: unknown;
      try {
        await revertEdit(cm, { schema: 'forestgeo_testing', editOperationID: 7, createdBy: 'mason@example.com' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RevertDriftError);
      expect((caught as InstanceType<typeof RevertDriftError>).freshPlan).toBe(undoPlan);
      expect(mocks.writeSpeciesCorrectionUndo).not.toHaveBeenCalled();
      expect(mocks.writeEditOperation).not.toHaveBeenCalled();
      expect(cm.commitTransaction).not.toHaveBeenCalled();
      expect(cm.rollbackTransaction).toHaveBeenCalledWith('tx');
    });

    it('forwards the caller-supplied assertAuthorizationFresh callback (same reference, invoked once) into the writer, rolling back and rethrowing its rejection with no ledger row', async () => {
      const cm = makeConnectionManager();
      mocks.readEditOperation.mockResolvedValue(buildOperation());
      const authError = new Error('assertAuthorizationFresh: authorization is no longer fresh');
      const assertAuthorizationFresh = vi.fn(async () => {
        throw authError;
      });
      mocks.writeSpeciesCorrectionUndo.mockImplementation(async (_cm, _schema, writerInput) => {
        await writerInput.assertAuthorizationFresh();
        throw new Error('unreachable: assertAuthorizationFresh should have rejected first');
      });

      await expect(
        revertEdit(cm, {
          schema: 'forestgeo_testing',
          editOperationID: 7,
          createdBy: 'mason@example.com',
          confirmedPlanHash: SPECIES_CORRECTION_UNDO_PLAN_HASH,
          assertAuthorizationFresh
        })
      ).rejects.toBe(authError);

      expect(mocks.writeSpeciesCorrectionUndo).toHaveBeenCalledTimes(1);
      const forwardedInput = mocks.writeSpeciesCorrectionUndo.mock.calls[0][2];
      expect(forwardedInput.assertAuthorizationFresh).toBe(assertAuthorizationFresh);
      expect(assertAuthorizationFresh).toHaveBeenCalledTimes(1);
      expect(mocks.writeEditOperation).not.toHaveBeenCalled();
      expect(cm.commitTransaction).not.toHaveBeenCalled();
      expect(cm.rollbackTransaction).toHaveBeenCalledWith('tx');
    });

    it('writes one revert ledger row with the writer snapshots and marks the original reverted, all under the single open transaction', async () => {
      const cm = makeConnectionManager();
      mocks.readEditOperation.mockResolvedValue(buildOperation());

      await revertEdit(cm, {
        schema: 'forestgeo_testing',
        editOperationID: 7,
        createdBy: 'mason@example.com',
        confirmedPlanHash: SPECIES_CORRECTION_UNDO_PLAN_HASH
      });

      expect(mocks.writeEditOperation).toHaveBeenCalledTimes(1);
      expect(mocks.writeEditOperation).toHaveBeenCalledWith(
        cm,
        'forestgeo_testing',
        expect.objectContaining({
          operationType: 'revert',
          revertable: false,
          beforeState: [TREE_BEFORE_ROW, MEMBER_CORE_MEASUREMENT_BEFORE_ROW],
          afterState: [TREE_AFTER_ROW, MEMBER_CORE_MEASUREMENT_AFTER_ROW]
        }),
        'tx'
      );
      expect(mocks.markEditOperationReverted).toHaveBeenCalledWith(cm, 'forestgeo_testing', 7, NEW_UNDO_LEDGER_ID, 'tx');
      expect(cm.beginTransaction).toHaveBeenCalledTimes(1);
      expect(cm.commitTransaction).toHaveBeenCalledTimes(1);
      expect(cm.commitTransaction).toHaveBeenCalledWith('tx');
    });
  });
});
