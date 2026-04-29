import ConnectionManager from '@/config/connectionmanager';
import { BulkEditPlan, DuplicateDeletion, EditPlanDataType, Effect, PreviewError, RowPlan, SEVERITY_RANK, Severity } from './types';
import { AnalyzeEditOptions, RoleForbiddenFieldError, TargetNotFoundError, analyzeEdit, isRoleForbiddenPreviewError } from './analyzer';
import { applyDuplicateRules } from './rules/duplicates';
import { canonicalizeRowForHash } from './canonicalrow';
import { hashPlan } from './planhash';
import { SpeciesNotFoundError } from './rules/context';

export class BulkPlanUnapplicableError extends Error {
  constructor(public readonly blockingErrors: PreviewError[]) {
    super(`Bulk edit plan has ${blockingErrors.length} blocking error(s)`);
    this.name = 'BulkPlanUnapplicableError';
  }
}

export interface BulkInput {
  matched: Array<{ rowIndex: number; targetID: number; newRow: Record<string, unknown> }>;
  newRows: Array<{ rowIndex: number; newRow: Record<string, unknown> }>;
  invalid: Array<{ rowIndex: number; reason: string }>;
  duplicateMeasurementIDsToDelete: DuplicateDeletion[];
}

export async function analyzeBulk(
  cm: ConnectionManager,
  schema: string,
  dataType: EditPlanDataType,
  plotID: number,
  censusID: number,
  input: BulkInput,
  transactionID?: string,
  options: AnalyzeEditOptions = {}
): Promise<BulkEditPlan> {
  const rowPlans: RowPlan[] = [];

  for (const matched of input.matched) {
    // A matched row can become non-existent between match and apply (or be
    // deactivated while the user reviews). Converting TargetNotFoundError
    // into an invalid-row entry keeps the whole batch analyzable and forces
    // a plan-hash drift that the apply endpoint surfaces to the UI.
    try {
      const plan = await analyzeEdit(cm, schema, dataType, plotID, censusID, matched.targetID, matched.newRow, transactionID, options);

      // Per-row data-validity blockers (TreeStemResolution: missing quadrat,
      // inactive tree, stem in different quadrat, etc.) are demoted to
      // status:'invalid' so the row can be surfaced in the upload review's
      // Invalid tab while the rest of the batch still applies. Role-forbidden
      // errors stay on the plan because they're a per-user authorization
      // concern — every spcode-changing row would have the same role error,
      // and the UI needs to show the role-block banner once at the plan level
      // rather than N times in the Invalid tab.
      const dataBlockers = (plan.errors ?? []).filter(error => error.blocking && error.kind !== 'RoleForbiddenField');
      if (dataBlockers.length > 0) {
        rowPlans.push({
          rowIndex: matched.rowIndex,
          targetID: matched.targetID,
          status: 'invalid',
          reason: dataBlockers.map(error => error.message).join('; ')
        });
        continue;
      }

      rowPlans.push({
        rowIndex: matched.rowIndex,
        targetID: matched.targetID,
        plan,
        status: plan.fieldChanges.length ? 'matched' : 'unchanged'
      });
    } catch (err) {
      if (err instanceof TargetNotFoundError) {
        rowPlans.push({
          rowIndex: matched.rowIndex,
          targetID: matched.targetID,
          status: 'invalid',
          reason: `Measurement ${matched.targetID} is no longer active in this plot/census`
        });
        continue;
      }
      // SpeciesNotFoundError is a per-row issue: the user supplied a species
      // code that doesn't resolve in the species table (typo, deleted species,
      // or a placeholder like 'CHANGED'). Demoting it to an invalid rowPlan
      // lets the rest of the batch proceed and surfaces the offending row in
      // the upload review's "Invalid" tab — instead of failing the whole
      // bulk plan with a 422.
      if (err instanceof SpeciesNotFoundError) {
        rowPlans.push({
          rowIndex: matched.rowIndex,
          targetID: matched.targetID,
          status: 'invalid',
          reason: err.code === '' ? 'Species code is blank — species cannot be cleared' : `Species not found: ${err.code}`
        });
        continue;
      }
      throw err;
    }
  }

  for (const newRow of input.newRows) {
    rowPlans.push({
      rowIndex: newRow.rowIndex,
      status: 'new',
      canonicalNewRow: canonicalizeRowForHash(newRow.newRow, 'revision-insert')
    });
  }

  for (const invalid of input.invalid) {
    rowPlans.push({ rowIndex: invalid.rowIndex, status: 'invalid', reason: invalid.reason });
  }

  const surfacedEffects: Effect[] = [];
  surfacedEffects.push(...applyDuplicateRules(input.duplicateMeasurementIDsToDelete));
  const errors: PreviewError[] = [];
  for (const rowPlan of rowPlans) {
    if (rowPlan.status === 'invalid') continue;
    if (rowPlan.plan) {
      surfacedEffects.push(...rowPlan.plan.effects);
      errors.push(...(rowPlan.plan.errors ?? []).map(error => ({ ...error, rowIndex: rowPlan.rowIndex })));
    }
  }

  const aggregateEffects = aggregateByRuleID(surfacedEffects);
  const effectSeverity = aggregateEffects.reduce<Severity>((max, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[max] ? e.severity : max), 'info');
  const errorSeverity = errors.reduce<Severity>((max, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[max] ? e.severity : max), 'info');
  const maxSeverity: Severity = SEVERITY_RANK[errorSeverity] > SEVERITY_RANK[effectSeverity] ? errorSeverity : effectSeverity;

  const plan: BulkEditPlan = {
    dataType,
    rowCount: rowPlans.length,
    rowPlans,
    aggregateEffects,
    errors,
    canApply: errors.length === 0,
    maxSeverity,
    planHash: '',
    generatedAt: new Date().toISOString(),
    duplicateDeletions: [...input.duplicateMeasurementIDsToDelete]
  };
  plan.planHash = hashPlan(plan);
  return plan;
}

export function assertBulkPlanCanApply(plan: BulkEditPlan): void {
  const roleErrors = (plan.errors ?? []).filter(isRoleForbiddenPreviewError).filter(error => error.blocking);
  if (roleErrors.length > 0) {
    throw new RoleForbiddenFieldError(roleErrors.map(e => e.field), roleErrors[0].role);
  }
  if (plan.canApply === false) {
    throw new BulkPlanUnapplicableError((plan.errors ?? []).filter(e => e.blocking));
  }
}

function aggregateByRuleID(effects: Effect[]): Effect[] {
  const buckets = new Map<string, Effect[]>();
  for (const effect of effects) {
    const list = buckets.get(effect.id) ?? [];
    list.push(effect);
    buckets.set(effect.id, list);
  }
  const out: Effect[] = [];
  for (const [id, list] of buckets) {
    const sumRows = list.reduce((acc, e) => acc + e.affectedRowCount, 0);
    const maxSeverity = list.reduce<Severity>((m, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[m] ? e.severity : m), 'info');
    out.push({
      id,
      severity: maxSeverity,
      category: list[0].category,
      title: list[0].title,
      detail: `${list.length} row(s) affected · ${sumRows} downstream row(s)`,
      affectedTable: list[0].affectedTable,
      affectedRowCount: sumRows
    });
  }
  return out;
}
