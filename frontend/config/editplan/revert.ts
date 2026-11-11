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
import ConnectionManager from '@/lib/db/connectionmanager';
import type { UserAuthRoles } from '@/config/macros';
import { ApplyResult, EditPlan, EditPlanDataType, SEVERITY_RANK } from './types';
import { analyzeEdit, assertEditPlanCanApply } from './analyzer';
import { applyEditInTransaction, ScopeLockHeldError } from './apply';
import {
  EditOperationRecord,
  EditOperationStateRow,
  ensureEditOperationsTable,
  markEditOperationReverted,
  readEditOperation,
  writeEditOperation
} from '@/config/editoperations';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { assertNoActiveMeasurementScopeConflict, ScopeAccessError } from './scopeguard';
import { parseSpeciesCorrectionUndoMetadata, type SpeciesCorrectionUndoMetadataPair } from './species-correction-undo-metadata';
import { buildSpeciesCorrectionUndoPlan, preflightSpeciesCorrectionUndo } from './species-correction-undo';
import { writeSpeciesCorrectionUndo } from './species-correction-undo-write';

// The edit_operations.dataType value recorded for a species-correction undo
// ledger row — simply the existing 'measurementssummary' EditPlanDataType,
// not a distinct undo-specific type.
const SPECIES_CORRECTION_UNDO_LEDGER_DATA_TYPE: EditPlanDataType = 'measurementssummary';

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

// Thrown when the locked re-read (taken after the application-scope lock is
// acquired) disagrees with the pre-lock discovery read on plot/census/dataType
// /target. This should only happen if the ledger row was mutated between the
// two reads, which the lock is meant to rule out going forward — treat it as
// a hard stop rather than silently reconstructing against a moving target.
export class RevertRecordChangedError extends Error {
  constructor(public editOperationID: number) {
    super(`edit operation ${editOperationID} changed between the discovery read and the locked recheck`);
    this.name = 'RevertRecordChangedError';
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
  // Authorized plot/census scope the caller resolved (and ran
  // assertCanEditMeasurementScope against) before invoking revertEdit. When
  // supplied, both the discovery read and the post-lock recheck must match
  // it, or revertEdit throws ScopeAccessError rather than operating on
  // whatever scope the ledger row happens to carry.
  expectedScope?: { plotID: number; censusID: number };
}

// Checked against both the pre-lock discovery read and the post-lock FOR
// UPDATE recheck — every eligibility rule must hold against whichever record
// is about to be used, not just the first one we happened to see.
function assertRevertEligible(record: EditOperationRecord | null, editOperationID: number): EditOperationRecord {
  if (!record) {
    throw new EditOperationNotFoundError(editOperationID);
  }
  if (record.revertedByEditOperationID !== null) {
    throw new AlreadyRevertedError(record.editOperationID, record.revertedByEditOperationID);
  }
  if (record.operationType === 'revert') {
    throw new CannotRevertRevertError(record.editOperationID);
  }
  if (!record.revertable) {
    throw new NonRevertableEditOperationError(record.editOperationID);
  }
  // Defense-in-depth: revertable single-row-edit rows always have a real
  // TargetID; only bulk-revision-row entries (which are non-revertable) write
  // null. If both guards disagree, treat it as non-revertable rather than
  // dereference a null target through the analyzer.
  if (record.targetID === null) {
    throw new NonRevertableEditOperationError(record.editOperationID);
  }
  return record;
}

function assertScopeMatchesExpectation(record: EditOperationRecord, expectedScope: RevertInput['expectedScope']): void {
  if (!expectedScope) return;
  if (record.plotID !== expectedScope.plotID || record.censusID !== expectedScope.censusID) {
    throw new ScopeAccessError('revert scope does not match the authorized plot/census scope');
  }
}

// The lock only protects writes going forward; it says nothing about what
// changed between the unlocked discovery read and the moment the lock was
// acquired. Re-verify the record identity so the restore plan is never built
// against a target the discovery read didn't actually see.
function assertLockedRecordMatchesDiscovery(discovery: EditOperationRecord, locked: EditOperationRecord): void {
  if (
    discovery.plotID !== locked.plotID ||
    discovery.censusID !== locked.censusID ||
    discovery.dataType !== locked.dataType ||
    discovery.targetID !== locked.targetID
  ) {
    throw new RevertRecordChangedError(discovery.editOperationID);
  }
}

export async function revertEdit(cm: ConnectionManager, input: RevertInput): Promise<ApplyResult> {
  await ensureEditOperationsTable(cm, input.schema);

  // Discovery read (no lock): fast-fails obviously-ineligible requests before
  // we pay for a transaction, and tells us which plot/census scope lock to
  // acquire. It must NOT be trusted for reconstruction — see the locked
  // re-read below.
  const discovery = assertRevertEligible(await readEditOperation(cm, input.schema, input.editOperationID), input.editOperationID);
  assertScopeMatchesExpectation(discovery, input.expectedScope);

  const txID = await cm.beginTransaction();
  try {
    const acquired = await cm.acquireApplicationLock(
      buildMeasurementScopeLockName(input.schema, discovery.plotID, discovery.censusID),
      txID,
      MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS
    );
    if (!acquired) {
      throw new ScopeLockHeldError('scope locked');
    }

    await assertNoActiveMeasurementScopeConflict(
      cm,
      {
        schema: input.schema,
        plotID: discovery.plotID,
        censusID: discovery.censusID
      },
      txID
    );

    // Locked re-read: now that the scope lock is held, pin the ledger row
    // with FOR UPDATE and repeat every eligibility check against it. Nothing
    // below this point may use `discovery` for reconstruction/analysis/write.
    const locked = assertRevertEligible(await readEditOperation(cm, input.schema, input.editOperationID, txID, { forUpdate: true }), input.editOperationID);
    assertScopeMatchesExpectation(locked, input.expectedScope);
    assertLockedRecordMatchesDiscovery(discovery, locked);

    // A #427 tree-species correction's ledger row carries a
    // `species_correction_metadata` marker on both before/afterState; every
    // other revertable row does not. `null` here means "not a species
    // correction" — fall through to the legacy single-row restore below.
    const speciesCorrectionMetadata = parseSpeciesCorrectionUndoMetadata(locked);

    let result: ApplyResult;
    if (speciesCorrectionMetadata !== null) {
      result = await revertSpeciesCorrection(cm, input, locked, speciesCorrectionMetadata, txID);
    } else {
      const targetID = locked.targetID as number;
      const newRow = reconstructNewRow(locked);

      const restorePlan = await analyzeEdit(cm, input.schema, locked.dataType, locked.plotID, locked.censusID, targetID, newRow, txID, {
        role: input.role
      });

      assertEditPlanCanApply(restorePlan);

      if (SEVERITY_RANK[restorePlan.maxSeverity] > SEVERITY_RANK.info && input.confirmedPlanHash !== restorePlan.planHash) {
        throw new RevertDriftError(restorePlan);
      }

      result = await applyEditInTransaction(cm, {
        dataType: locked.dataType,
        schema: input.schema,
        plotID: locked.plotID,
        censusID: locked.censusID,
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
        await markEditOperationReverted(cm, input.schema, locked.editOperationID, result.editOperationID, txID);
      }

      await removeCreatedAfterStateSideEffects(cm, input.schema, locked, txID);
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

// Undo path for a #427 tree-species correction, dispatched from `revertEdit`
// once `parseSpeciesCorrectionUndoMetadata` confirms `locked` is one. Runs
// entirely inside the caller's already-open transaction/scope lock: no
// nested begin/commit, no DDL, no reconstructNewRow/analyzeEdit/
// applyEditInTransaction/removeCreatedAfterStateSideEffects — those are the
// legacy single-row-edit path's machinery and do not apply to a species
// correction's cross-row shape.
async function revertSpeciesCorrection(
  cm: ConnectionManager,
  input: RevertInput,
  locked: EditOperationRecord,
  metadata: SpeciesCorrectionUndoMetadataPair,
  transactionID: string
): Promise<ApplyResult> {
  // Read-only current-state preflight. Throws SpeciesCorrectionUndoUnapplicableError
  // or SpeciesCorrectionUndoCurrentStateConflictError on any hard conflict —
  // neither is caught here, so a matching confirmedPlanHash below can never
  // suppress a current-state conflict: the preflight always runs first.
  const preflight = await preflightSpeciesCorrectionUndo(cm, input.schema, locked, metadata, transactionID);

  // Role/field enforcement (SpeciesCode included) happens inside this call,
  // via the same fieldpolicy.ts policy a forward SpeciesCode edit uses —
  // throws RoleForbiddenFieldError rather than silently dropping a field.
  const undoPlan = buildSpeciesCorrectionUndoPlan(preflight, input.role ?? undefined);

  // A species-correction undo is a cross-row restore (species + every
  // member's RawSpCode + any changed local columns/attributes), so it
  // always requires an explicit, hashed confirmation — unconditionally.
  if (input.confirmedPlanHash !== undoPlan.planHash) {
    throw new RevertDriftError(undoPlan);
  }

  const writeResult = await writeSpeciesCorrectionUndo(
    cm,
    input.schema,
    { preflight, assertAuthorizationFresh: input.assertAuthorizationFresh },
    transactionID
  );

  const beforeState: EditOperationStateRow[] = [
    writeResult.treeBeforeState,
    ...(writeResult.editedStemBeforeState ? [writeResult.editedStemBeforeState] : []),
    ...writeResult.memberCoreMeasurementBeforeState,
    ...writeResult.attributeBeforeState
  ];
  const afterState: EditOperationStateRow[] = [
    writeResult.treeAfterState,
    ...(writeResult.editedStemAfterState ? [writeResult.editedStemAfterState] : []),
    ...writeResult.memberCoreMeasurementAfterState,
    ...writeResult.attributeAfterState
  ];

  const editOperationID = await writeEditOperation(
    cm,
    input.schema,
    {
      operationType: 'revert',
      revertable: false,
      dataType: SPECIES_CORRECTION_UNDO_LEDGER_DATA_TYPE,
      targetID: preflight.metadata.after.editedCoreMeasurementID,
      plotID: locked.plotID,
      censusID: locked.censusID,
      planHash: undoPlan.planHash,
      beforeState,
      afterState,
      createdBy: input.createdBy
    },
    transactionID
  );

  await markEditOperationReverted(cm, input.schema, locked.editOperationID, editOperationID, transactionID);

  return {
    updatedIDs: { CoreMeasurementID: preflight.metadata.after.editedCoreMeasurementID },
    applyErrors: [],
    editOperationID,
    // Measured, not assumed: true only when the write actually re-queued
    // active members for revalidation (writeResult.errorRefresh.pendingMeasurementIDs).
    validationPending: writeResult.errorRefresh.pendingMeasurementIDs.length > 0,
    postValidation: undefined
  };
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

// A SpeciesCode in the restore row is planned as a tree-wide correction, so an
// undo may only carry one when the original edit itself changed the species.
function originalEditChangedSpeciesCode(record: EditOperationRecord, beforeCore: Record<string, unknown>): boolean {
  const afterCore = findStateRow(record.afterState, 'coremeasurements')?.row;
  if (!afterCore) return true;
  return toStringOrNull(beforeCore.RawSpCode) !== toStringOrNull(afterCore.RawSpCode);
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
    QuadratName: toStringOrNull(core.RawQuadrat),
    MeasurementDate: normalizeMeasurementDate(core.MeasurementDate),
    MeasuredDBH: toNumberOrNull(core.MeasuredDBH),
    MeasuredHOM: toNumberOrNull(core.MeasuredHOM),
    Description: toStringOrNull(core.Description)
  };

  if (originalEditChangedSpeciesCode(record, core)) {
    newRow.SpeciesCode = toStringOrNull(core.RawSpCode);
  }

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
