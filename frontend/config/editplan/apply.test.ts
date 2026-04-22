import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyEdit, applyEditInTransaction, HashDriftError, ScopeLockHeldError, ApplyInput, SessionExpiredError } from './apply';
import { DisallowedFieldError, RoleForbiddenFieldError } from './analyzer';
import { SpeciesNotFoundError } from './rules/context';

vi.mock('./analyzer', async () => {
  const actual = await vi.importActual<typeof import('./analyzer')>('./analyzer');
  return {
    ...actual,
    analyzeEdit: vi.fn()
  };
});
vi.mock('./writers/measurementssummary', () => ({ writeMeasurementsSummary: vi.fn() }));
vi.mock('./writers/failedmeasurements', () => ({ writeFailedMeasurements: vi.fn() }));
vi.mock('@/config/editoperations', () => ({
  ensureEditOperationsTable: vi.fn(async () => undefined),
  writeEditOperation: vi.fn(async () => 99)
}));

import * as analyzer from './analyzer';
import * as measurementsWriter from './writers/measurementssummary';
import * as failedWriter from './writers/failedmeasurements';
import * as editOps from '@/config/editoperations';

const TRANSACTION_ID = 'tx';
const LEDGER_ID = 99;
const FRESH_PLAN_HASH = 'x';
const EXPECTED_PLAN_HASH = 'x';

function makeCM(opts: { lockAcquired: boolean }) {
  return {
    beginTransaction: vi.fn(async () => TRANSACTION_ID),
    commitTransaction: vi.fn(async () => undefined),
    rollbackTransaction: vi.fn(async () => undefined),
    acquireApplicationLock: vi.fn(async () => opts.lockAcquired),
    executeQuery: vi.fn(),
    closeConnection: vi.fn()
  } as any;
}

const baseInput: ApplyInput = {
  dataType: 'measurementssummary',
  schema: 'forestgeo_test',
  plotID: 1,
  censusID: 1,
  targetID: 42,
  newRow: { MeasuredDBH: 15 },
  expectedPlanHash: EXPECTED_PLAN_HASH,
  createdBy: 'tester'
};

function mockFreshPlan(planHash: string = FRESH_PLAN_HASH) {
  (analyzer.analyzeEdit as any).mockResolvedValue({
    dataType: 'measurementssummary',
    targetID: 42,
    fieldChanges: [],
    effects: [],
    errors: [],
    canApply: true,
    maxSeverity: 'info',
    planHash,
    generatedAt: '2026-04-21T00:00:00Z'
  });
}

function mockWriterSuccess() {
  (measurementsWriter.writeMeasurementsSummary as any).mockResolvedValue({
    updatedIDs: { CoreMeasurementID: 42 },
    beforeState: [{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 42, row: { MeasuredDBH: 10 } }],
    afterState: [{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 42, row: { MeasuredDBH: 15 } }],
    validationPending: true
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('applyEdit', () => {
  it('acquires the scope lock and commits on success', async () => {
    const cm = makeCM({ lockAcquired: true });
    mockFreshPlan();
    mockWriterSuccess();

    const result = await applyEdit(cm, baseInput);

    expect(cm.beginTransaction).toHaveBeenCalledTimes(1);
    expect(cm.acquireApplicationLock).toHaveBeenCalledWith(
      `measurement-scope:${baseInput.schema}:${baseInput.plotID}:${baseInput.censusID}`,
      TRANSACTION_ID,
      0
    );
    expect(cm.commitTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
    expect(cm.rollbackTransaction).not.toHaveBeenCalled();
    expect(result.editOperationID).toBe(LEDGER_ID);
    expect(result.validationPending).toBe(true);
    expect(result.applyErrors).toEqual([]);
  });

  it('throws ScopeLockHeldError and rolls back when lock not acquired', async () => {
    const cm = makeCM({ lockAcquired: false });

    await expect(applyEdit(cm, baseInput)).rejects.toBeInstanceOf(ScopeLockHeldError);

    expect(cm.beginTransaction).toHaveBeenCalledTimes(1);
    expect(cm.rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
    expect(cm.commitTransaction).not.toHaveBeenCalled();
    expect(analyzer.analyzeEdit).not.toHaveBeenCalled();
    expect(measurementsWriter.writeMeasurementsSummary).not.toHaveBeenCalled();
  });

  it('rolls back when the writer throws', async () => {
    const cm = makeCM({ lockAcquired: true });
    mockFreshPlan();
    const writerError = new Error('boom');
    (measurementsWriter.writeMeasurementsSummary as any).mockRejectedValue(writerError);

    await expect(applyEdit(cm, baseInput)).rejects.toBe(writerError);

    expect(cm.rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
    expect(cm.commitTransaction).not.toHaveBeenCalled();
  });

  it('throws HashDriftError carrying the fresh plan and does not call the writer', async () => {
    const cm = makeCM({ lockAcquired: true });
    mockFreshPlan('different-hash');

    const err = await applyEdit(cm, baseInput).catch(e => e);
    expect(err).toBeInstanceOf(HashDriftError);
    expect((err as HashDriftError).freshPlan.planHash).toBe('different-hash');

    expect(measurementsWriter.writeMeasurementsSummary).not.toHaveBeenCalled();
    expect(editOps.writeEditOperation).not.toHaveBeenCalled();
    expect(cm.rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
    expect(cm.commitTransaction).not.toHaveBeenCalled();
  });

  it('revalidates authorization after hash check and rolls back before writing when stale', async () => {
    const cm = makeCM({ lockAcquired: true });
    mockFreshPlan();
    mockWriterSuccess();
    const assertAuthorizationFresh = vi.fn(async () => {
      throw new SessionExpiredError('role changed');
    });

    await expect(applyEdit(cm, { ...baseInput, assertAuthorizationFresh })).rejects.toBeInstanceOf(SessionExpiredError);

    expect(assertAuthorizationFresh).toHaveBeenCalledTimes(1);
    expect(measurementsWriter.writeMeasurementsSummary).not.toHaveBeenCalled();
    expect(editOps.writeEditOperation).not.toHaveBeenCalled();
    expect(cm.rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
    expect(cm.commitTransaction).not.toHaveBeenCalled();
  });

  it('bubbles SpeciesNotFoundError from analyzer', async () => {
    const cm = makeCM({ lockAcquired: true });
    const speciesErr = new SpeciesNotFoundError('AA');
    (analyzer.analyzeEdit as any).mockRejectedValue(speciesErr);

    await expect(applyEdit(cm, baseInput)).rejects.toBe(speciesErr);
    expect(cm.rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
  });

  it('bubbles DisallowedFieldError from analyzer', async () => {
    const cm = makeCM({ lockAcquired: true });
    const disallowed = new DisallowedFieldError(['CoreMeasurementID']);
    (analyzer.analyzeEdit as any).mockRejectedValue(disallowed);

    await expect(applyEdit(cm, baseInput)).rejects.toBe(disallowed);
    expect(cm.rollbackTransaction).toHaveBeenCalledWith(TRANSACTION_ID);
  });

  it('dispatches to the failedmeasurements writer when dataType is failedmeasurements', async () => {
    const cm = makeCM({ lockAcquired: true });
    mockFreshPlan();
    (failedWriter.writeFailedMeasurements as any).mockResolvedValue({
      updatedIDs: { CoreMeasurementID: 42 },
      beforeState: [],
      afterState: [],
      validationPending: true
    });

    await applyEdit(cm, { ...baseInput, dataType: 'failedmeasurements' });

    expect(failedWriter.writeFailedMeasurements).toHaveBeenCalledTimes(1);
    expect(measurementsWriter.writeMeasurementsSummary).not.toHaveBeenCalled();
  });
});

describe('applyEditInTransaction', () => {
  it('never begins, commits, rolls back, or acquires the scope lock', async () => {
    const cm = makeCM({ lockAcquired: true });
    mockFreshPlan();
    mockWriterSuccess();

    await applyEditInTransaction(cm, { ...baseInput, transactionID: 'outer-tx' });

    expect(cm.beginTransaction).not.toHaveBeenCalled();
    expect(cm.commitTransaction).not.toHaveBeenCalled();
    expect(cm.rollbackTransaction).not.toHaveBeenCalled();
    expect(cm.acquireApplicationLock).not.toHaveBeenCalled();
  });

  it('writes a ledger row using the caller-provided transaction', async () => {
    const cm = makeCM({ lockAcquired: true });
    mockFreshPlan();
    mockWriterSuccess();

    const result = await applyEditInTransaction(cm, { ...baseInput, transactionID: 'outer-tx' });

    expect(editOps.ensureEditOperationsTable).toHaveBeenCalledWith(cm, baseInput.schema, 'outer-tx');
    expect(editOps.writeEditOperation).toHaveBeenCalledTimes(1);
    const [, schemaArg, record, txArg] = (editOps.writeEditOperation as any).mock.calls[0];
    expect(schemaArg).toBe(baseInput.schema);
    expect(txArg).toBe('outer-tx');
    expect(record.operationType).toBe('single-row-edit');
    expect(record.revertable).toBe(true);
    expect(record.planHash).toBe(FRESH_PLAN_HASH);
    expect(record.beforeState).toHaveLength(1);
    expect(record.afterState).toHaveLength(1);
    expect(result.editOperationID).toBe(LEDGER_ID);
  });

  it('uses the caller-specified operationType when provided', async () => {
    const cm = makeCM({ lockAcquired: true });
    mockFreshPlan();
    mockWriterSuccess();

    await applyEditInTransaction(cm, {
      ...baseInput,
      transactionID: 'outer-tx',
      operationType: 'bulk-revision-row',
      revertable: false
    });

    const [, , record] = (editOps.writeEditOperation as any).mock.calls[0];
    expect(record.operationType).toBe('bulk-revision-row');
    expect(record.revertable).toBe(false);
  });

  it('skips the ledger write when writeLedger is false', async () => {
    const cm = makeCM({ lockAcquired: true });
    mockFreshPlan();
    mockWriterSuccess();

    const result = await applyEditInTransaction(cm, {
      ...baseInput,
      transactionID: 'outer-tx',
      writeLedger: false
    });

    expect(editOps.writeEditOperation).not.toHaveBeenCalled();
    expect(result.editOperationID).toBeNull();
  });

  it('throws HashDriftError without calling the writer', async () => {
    const cm = makeCM({ lockAcquired: true });
    mockFreshPlan('different-hash');

    const err = await applyEditInTransaction(cm, { ...baseInput, transactionID: 'outer-tx' }).catch(e => e);
    expect(err).toBeInstanceOf(HashDriftError);
    expect((err as HashDriftError).freshPlan.planHash).toBe('different-hash');
    expect(measurementsWriter.writeMeasurementsSummary).not.toHaveBeenCalled();
    expect(editOps.writeEditOperation).not.toHaveBeenCalled();
  });

  it('throws RoleForbiddenFieldError for blocking role errors before writing', async () => {
    const cm = makeCM({ lockAcquired: true });
    (analyzer.analyzeEdit as any).mockResolvedValue({
      dataType: 'measurementssummary',
      targetID: 42,
      fieldChanges: [{ field: 'SpeciesCode', from: 'AA', to: 'BB' }],
      effects: [],
      errors: [
        {
          kind: 'RoleForbiddenField',
          field: 'SpeciesCode',
          role: 'field crew',
          message: 'SpeciesCode can only be edited by global or db admin users.',
          severity: 'destructive',
          blocking: true
        }
      ],
      canApply: false,
      maxSeverity: 'destructive',
      planHash: EXPECTED_PLAN_HASH,
      generatedAt: '2026-04-21T00:00:00Z'
    });

    await expect(applyEditInTransaction(cm, { ...baseInput, transactionID: 'outer-tx', role: 'field crew' })).rejects.toBeInstanceOf(RoleForbiddenFieldError);

    expect(measurementsWriter.writeMeasurementsSummary).not.toHaveBeenCalled();
    expect(editOps.writeEditOperation).not.toHaveBeenCalled();
  });

  it('skips hash check when expectedPlanHash is null (server-internal caller)', async () => {
    const cm = makeCM({ lockAcquired: true });
    mockFreshPlan('any-hash');
    mockWriterSuccess();

    await applyEditInTransaction(cm, {
      ...baseInput,
      transactionID: 'outer-tx',
      expectedPlanHash: null
    });

    expect(measurementsWriter.writeMeasurementsSummary).toHaveBeenCalledTimes(1);
    expect(editOps.writeEditOperation).toHaveBeenCalledTimes(1);
  });
});
