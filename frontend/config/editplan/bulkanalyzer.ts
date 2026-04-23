import ConnectionManager from '@/config/connectionmanager';
import { BulkEditPlan, DuplicateDeletion, EditPlanDataType, Effect, PreviewError, RowPlan, SEVERITY_RANK, Severity } from './types';
import { AnalyzeEditOptions, RoleForbiddenFieldError, TargetNotFoundError, analyzeEdit, isRoleForbiddenPreviewError } from './analyzer';
import { applyDuplicateRules } from './rules/duplicates';
import { canonicalizeRowForHash } from './canonicalrow';
import { hashPlan } from './planhash';

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
  if (roleErrors.length > 0 || plan.canApply === false) {
    throw new RoleForbiddenFieldError(
      roleErrors.map(error => error.field),
      roleErrors[0]?.role ?? 'unknown'
    );
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
