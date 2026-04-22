// Two-layer apply API for single-row edits.
//
// Contract:
//   - `applyEdit` is the PUBLIC entry point for single-row edits. It owns the
//     transaction lifecycle (begin/commit/rollback) and acquires the scope lock.
//   - `applyEditInTransaction` is a LOWER-LEVEL primitive. The caller must have
//     already begun a transaction and acquired the scope lock. It never begins,
//     commits, rolls back, acquires, or releases.
//
// Batch callers (revision-apply, compatibility shims) MUST use
// `applyEditInTransaction` under their own outer transaction + scope lock.
// They MUST NOT loop over `applyEdit` — each call would try to re-acquire
// the same scope lock on a new inner transaction and fail-fast (timeout 0).
import ConnectionManager from '@/config/connectionmanager';
import type { UserAuthRoles } from '@/config/macros';
import { EditPlanDataType, ApplyResult, EditPlan } from './types';
import { analyzeEdit, assertEditPlanCanApply } from './analyzer';
import { writeMeasurementsSummary } from './writers/measurementssummary';
import { writeFailedMeasurements } from './writers/failedmeasurements';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';
import { ensureEditOperationsTable, writeEditOperation } from '@/config/editoperations';

export { SessionExpiredError } from './authorization';

export class ScopeLockHeldError extends Error {
  name = 'ScopeLockHeldError';
}

export class HashDriftError extends Error {
  constructor(public freshPlan: EditPlan) {
    super('plan hash drift');
    this.name = 'HashDriftError';
  }
}

export interface ApplyInput {
  dataType: EditPlanDataType;
  schema: string;
  plotID: number;
  censusID: number;
  targetID: number;
  newRow: Record<string, unknown>;
  expectedPlanHash: string | null;
  operationType?: 'single-row-edit' | 'bulk-revision-row' | 'revert';
  revertable?: boolean;
  writeLedger?: boolean;
  refreshViews?: boolean;
  createdBy: string;
  role?: UserAuthRoles | null;
  assertAuthorizationFresh?: () => Promise<void>;
  // Batch callers MUST set this true and call ensureEditOperationsTable ONCE
  // before opening the outer transaction. MySQL treats CREATE TABLE IF NOT
  // EXISTS as a DDL implicit-commit even when the table already exists, so a
  // per-iteration DDL call commits prior iterations' writes and defeats the
  // outer rollback. Default false preserves the self-bootstrap behavior for
  // single-row callers that own their own transaction.
  schemaEnsured?: boolean;
}

export interface ApplyInTransactionInput extends ApplyInput {
  transactionID: string;
}

export async function applyEdit(cm: ConnectionManager, input: ApplyInput): Promise<ApplyResult> {
  const txID = await cm.beginTransaction();
  try {
    const acquired = await cm.acquireApplicationLock(
      buildMeasurementScopeLockName(input.schema, input.plotID, input.censusID),
      txID,
      MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS
    );
    if (!acquired) throw new ScopeLockHeldError('scope locked');

    const result = await applyEditInTransaction(cm, { ...input, transactionID: txID });
    await cm.commitTransaction(txID);
    return result;
  } catch (err) {
    try {
      await cm.rollbackTransaction(txID);
    } catch {
      /* rollback best-effort */
    }
    throw err;
  }
}

export async function applyEditInTransaction(cm: ConnectionManager, input: ApplyInTransactionInput): Promise<ApplyResult> {
  if (!input.schemaEnsured) {
    await ensureEditOperationsTable(cm, input.schema, input.transactionID);
  }

  const freshPlan = await analyzeEdit(
    cm,
    input.schema,
    input.dataType,
    input.plotID,
    input.censusID,
    input.targetID,
    input.newRow,
    input.transactionID,
    { role: input.role }
  );

  assertEditPlanCanApply(freshPlan);

  if (input.expectedPlanHash !== null && freshPlan.planHash !== input.expectedPlanHash) {
    throw new HashDriftError(freshPlan);
  }

  if (input.assertAuthorizationFresh) {
    await input.assertAuthorizationFresh();
  }

  const writer = input.dataType === 'measurementssummary' ? writeMeasurementsSummary : writeFailedMeasurements;
  const { updatedIDs, beforeState, afterState, postValidation, validationPending } = await writer(cm, input, freshPlan, input.transactionID);

  let editOperationID: number | null = null;
  if (input.writeLedger !== false) {
    const operationType = input.operationType ?? 'single-row-edit';
    editOperationID = await writeEditOperation(
      cm,
      input.schema,
      {
        operationType,
        revertable: input.revertable ?? true,
        dataType: input.dataType,
        targetID: input.targetID,
        plotID: input.plotID,
        censusID: input.censusID,
        planHash: freshPlan.planHash,
        beforeState,
        afterState,
        createdBy: input.createdBy
      },
      input.transactionID
    );
  }

  return {
    updatedIDs,
    applyErrors: [],
    editOperationID,
    validationPending,
    postValidation
  };
}
