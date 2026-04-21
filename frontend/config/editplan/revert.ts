// Revert helper — reads an `edit_operations` ledger row, reconstructs a
// restore plan by inverting the captured `beforeState`, and feeds it through
// `applyEditInTransaction` with `operationType: 'revert'`. After success,
// the original ledger entry's `RevertedByEditOperationID` is pointed at the
// revert operation — all in a single atomic transaction.
import ConnectionManager from '@/config/connectionmanager';
import { ApplyResult, EditPlanDataType } from './types';
import { applyEditInTransaction, ScopeLockHeldError } from './apply';
import {
  EditOperationRecord,
  EditOperationStateRow,
  markEditOperationReverted,
  readEditOperation
} from '@/config/editoperations';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';

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

export interface RevertInput {
  schema: string;
  editOperationID: number;
  createdBy: string;
}

export async function revertEdit(cm: ConnectionManager, input: RevertInput): Promise<ApplyResult> {
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

    const result = await applyEditInTransaction(cm, {
      dataType: original.dataType,
      schema: input.schema,
      plotID: original.plotID,
      censusID: original.censusID,
      targetID: original.targetID,
      newRow,
      expectedPlanHash: null,
      operationType: 'revert',
      createdBy: input.createdBy,
      transactionID: txID
    });

    if (result.editOperationID !== null) {
      await markEditOperationReverted(cm, input.schema, original.editOperationID, result.editOperationID, txID);
    }

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
    newRow.Attributes = codes.join(';');
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
