// Revert helper — reads an `edit_operations` ledger row, reconstructs a
// restore plan by inverting the captured `beforeState`, and feeds it through
// `applyEditInTransaction` with `operationType: 'revert'`. After success,
// the original ledger entry's `RevertedByEditOperationID` is pointed at the
// revert operation — all in a single atomic transaction.
//
// Drift gate: the restore plan is re-analyzed against current DB state before
// writing. If the restore would now cause cross-row or destructive effects
// because the world moved on since the original edit, revert throws
// `RevertDriftError` with the fresh plan. The client is expected to surface it
// and retry with `confirmedPlanHash` matching the plan to explicitly accept
// those consequences.
import ConnectionManager from '@/config/connectionmanager';
import type { UserAuthRoles } from '@/config/macros';
import { ApplyResult, EditPlan, EditPlanDataType, SEVERITY_RANK } from './types';
import { analyzeEdit, assertEditPlanCanApply } from './analyzer';
import { applyEditInTransaction, ScopeLockHeldError } from './apply';
import { EditOperationRecord, EditOperationStateRow, ensureEditOperationsTable, markEditOperationReverted, readEditOperation } from '@/config/editoperations';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

export class EditOperationNotFoundError extends Error {
  constructor(public editOperationID: number) {
    super(`edit operation not found: ${editOperationID}`);
    this.name = 'EditOperationNotFoundError';
  }
}

export class AlreadyRevertedError extends Error {
  constructor(
    public editOperationID: number,
    public byEditOperationID: number
  ) {
    super(`edit operation ${editOperationID} already reverted by ${byEditOperationID}`);
    this.name = 'AlreadyRevertedError';
  }
}

export class CannotRevertRevertError extends Error {
  constructor(public editOperationID: number) {
    super(`cannot revert a revert operation: ${editOperationID}`);
    this.name = 'CannotRevertRevertError';
  }
}

export class NonRevertableEditOperationError extends Error {
  constructor(public editOperationID: number) {
    super(`edit operation is not revertable: ${editOperationID}`);
    this.name = 'NonRevertableEditOperationError';
  }
}

export class RevertDriftError extends Error {
  constructor(public freshPlan: EditPlan) {
    super('revert plan has cross-row or destructive effects; confirmation required');
    this.name = 'RevertDriftError';
  }
}

export interface RevertInput {
  schema: string;
  editOperationID: number;
  createdBy: string;
  // When the first revert attempt returned RevertDriftError, the client re-posts
  // with the plan hash from that response to acknowledge the fresh ramifications.
  // Missing or mismatched hash on a non-info restore plan is a 409.
  confirmedPlanHash?: string;
  role?: UserAuthRoles | null;
  assertAuthorizationFresh?: () => Promise<void>;
}

export async function revertEdit(cm: ConnectionManager, input: RevertInput): Promise<ApplyResult> {
  await ensureEditOperationsTable(cm, input.schema);

  const original = await readEditOperation(cm, input.schema, input.editOperationID);
  if (!original) {
    throw new EditOperationNotFoundError(input.editOperationID);
  }
  if (original.revertedByEditOperationID !== null) {
    throw new AlreadyRevertedError(original.editOperationID, original.revertedByEditOperationID);
  }
  if (original.operationType === 'revert') {
    throw new CannotRevertRevertError(original.editOperationID);
  }
  if (!original.revertable) {
    throw new NonRevertableEditOperationError(original.editOperationID);
  }
  // Defense-in-depth: revertable single-row-edit rows always have a real
  // TargetID; only bulk-revision-row entries (which are non-revertable) write
  // null. If both guards disagree, treat it as non-revertable rather than
  // dereference a null target through the analyzer.
  if (original.targetID === null) {
    throw new NonRevertableEditOperationError(original.editOperationID);
  }
  const targetID = original.targetID;

  const newRow = reconstructNewRow(original);

  const txID = await cm.beginTransaction();
  try {
    const acquired = await cm.acquireApplicationLock(
      buildMeasurementScopeLockName(input.schema, original.plotID, original.censusID),
      txID,
      MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS
    );
    if (!acquired) {
      throw new ScopeLockHeldError('scope locked');
    }

    const restorePlan = await analyzeEdit(cm, input.schema, original.dataType, original.plotID, original.censusID, targetID, newRow, txID, {
      role: input.role
    });

    assertEditPlanCanApply(restorePlan);

    if (SEVERITY_RANK[restorePlan.maxSeverity] > SEVERITY_RANK.info && input.confirmedPlanHash !== restorePlan.planHash) {
      throw new RevertDriftError(restorePlan);
    }

    const result = await applyEditInTransaction(cm, {
      dataType: original.dataType,
      schema: input.schema,
      plotID: original.plotID,
      censusID: original.censusID,
      targetID,
      newRow,
      expectedPlanHash: restorePlan.planHash,
      operationType: 'revert',
      revertable: false,
      createdBy: input.createdBy,
      role: input.role,
      assertAuthorizationFresh: input.assertAuthorizationFresh,
      transactionID: txID,
      // ensureEditOperationsTable already ran pre-transaction above; passing
      // schemaEnsured: true skips the per-call DDL inside the tx, which
      // MySQL treats as an implicit commit even when the table already exists.
      schemaEnsured: true
    });

    if (result.editOperationID !== null) {
      await markEditOperationReverted(cm, input.schema, original.editOperationID, result.editOperationID, txID);
    }

    await removeCreatedAfterStateSideEffects(cm, input.schema, original, txID);

    await cm.commitTransaction(txID);
    return result;
  } catch (err) {
    try {
      await cm.rollbackTransaction(txID);
    } catch {
      /* rollback best-effort — original error takes precedence */
    }
    throw err;
  }
}

function findStateRow(state: EditOperationStateRow[], table: string): EditOperationStateRow | undefined {
  return state.find(r => r.table === table);
}

function findStateRows(state: EditOperationStateRow[], table: string): EditOperationStateRow[] {
  return state.filter(r => r.table === table);
}

function findStateRowByPrimaryKey(state: EditOperationStateRow[], table: string, primaryKeyValue: string | number): EditOperationStateRow | undefined {
  return state.find(r => r.table === table && String(r.primaryKeyValue) === String(primaryKeyValue));
}

function afterRowsCreatedByOriginal(record: EditOperationRecord, table: string): EditOperationStateRow[] {
  return record.afterState.filter(row => {
    if (row.table !== table || row.row === null) return false;
    const before = findStateRowByPrimaryKey(record.beforeState, row.table, row.primaryKeyValue);
    return before?.row === null;
  });
}

async function removeCreatedAfterStateSideEffects(cm: ConnectionManager, schema: string, record: EditOperationRecord, transactionID: string): Promise<void> {
  for (const stemState of afterRowsCreatedByOriginal(record, 'stems')) {
    await cm.executeQuery(
      safeFormatQuery(
        schema,
        `DELETE FROM ??.stems
         WHERE StemGUID = ?
           AND NOT EXISTS (
             SELECT 1 FROM ??.coremeasurements cm
             WHERE cm.StemGUID = ?
             LIMIT 1
           )`
      ),
      [stemState.primaryKeyValue, stemState.primaryKeyValue],
      transactionID
    );
  }

  for (const treeState of afterRowsCreatedByOriginal(record, 'trees')) {
    await cm.executeQuery(
      safeFormatQuery(
        schema,
        `DELETE FROM ??.trees
         WHERE TreeID = ?
           AND NOT EXISTS (
             SELECT 1 FROM ??.stems s
             WHERE s.TreeID = ?
             LIMIT 1
           )`
      ),
      [treeState.primaryKeyValue, treeState.primaryKeyValue],
      transactionID
    );
  }
}

function normalizeMeasurementDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'string') {
    if (!value.includes('T')) return value;
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
    return value;
  }
  return null;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return String(value);
}

function reconstructMeasurementsSummaryRow(record: EditOperationRecord): Record<string, unknown> {
  const coreState = findStateRow(record.beforeState, 'coremeasurements');
  if (!coreState || !coreState.row) {
    throw new Error(`revertEdit: measurementssummary beforeState missing coremeasurements row for edit ${record.editOperationID}`);
  }
  const core = coreState.row;

  const stemState = findStateRow(record.beforeState, 'stems');
  const stem = stemState?.row ?? null;

  const cmattrStates = findStateRows(record.beforeState, 'cmattributes');

  const newRow: Record<string, unknown> = {
    TreeTag: toStringOrNull(core.RawTreeTag),
    StemTag: toStringOrNull(core.RawStemTag),
    SpeciesCode: toStringOrNull(core.RawSpCode),
    QuadratName: toStringOrNull(core.RawQuadrat),
    MeasurementDate: normalizeMeasurementDate(core.MeasurementDate),
    MeasuredDBH: toNumberOrNull(core.MeasuredDBH),
    MeasuredHOM: toNumberOrNull(core.MeasuredHOM),
    Description: toStringOrNull(core.Description)
  };

  if (stem) {
    newRow.StemLocalX = toNumberOrNull(stem.LocalX);
    newRow.StemLocalY = toNumberOrNull(stem.LocalY);
  } else {
    newRow.StemLocalX = toNumberOrNull(core.RawX);
    newRow.StemLocalY = toNumberOrNull(core.RawY);
  }

  if (cmattrStates.length > 0) {
    const codes = cmattrStates
      .map(s => (s.row ? toStringOrNull((s.row as Record<string, unknown>).Code) : null))
      .filter((code): code is string => code !== null && code.length > 0);
    // Match the seed/display format used by revision exports and
    // measurementssummary.RawCodes: '; ' separator with a trailing space.
    newRow.Attributes = codes.join('; ');
  } else {
    newRow.Attributes = toStringOrNull(core.RawCodes);
  }

  return newRow;
}

function reconstructFailedMeasurementsRow(record: EditOperationRecord): Record<string, unknown> {
  const coreState = findStateRow(record.beforeState, 'coremeasurements');
  if (!coreState || !coreState.row) {
    throw new Error(`revertEdit: failedmeasurements beforeState missing coremeasurements row for edit ${record.editOperationID}`);
  }
  const core = coreState.row;

  return {
    Tag: toStringOrNull(core.RawTreeTag),
    StemTag: toStringOrNull(core.RawStemTag),
    SpCode: toStringOrNull(core.RawSpCode),
    Quadrat: toStringOrNull(core.RawQuadrat),
    X: toNumberOrNull(core.RawX),
    Y: toNumberOrNull(core.RawY),
    DBH: toNumberOrNull(core.MeasuredDBH),
    HOM: toNumberOrNull(core.MeasuredHOM),
    Date: normalizeMeasurementDate(core.MeasurementDate),
    Codes: toStringOrNull(core.RawCodes),
    Comments: toStringOrNull(core.RawComments)
  };
}

function reconstructNewRow(record: EditOperationRecord): Record<string, unknown> {
  const dataType: EditPlanDataType = record.dataType;
  if (dataType === 'measurementssummary') {
    return reconstructMeasurementsSummaryRow(record);
  }
  if (dataType === 'failedmeasurements') {
    return reconstructFailedMeasurementsRow(record);
  }
  throw new Error(`revertEdit: unsupported dataType ${String(dataType)}`);
}
