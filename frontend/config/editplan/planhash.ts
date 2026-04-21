import { createHash } from 'node:crypto';
import { BulkEditPlan, Effect, EditPlan, FieldChange, RowPlan } from './types';
import { PER_COLUMN_DECIMAL_PRECISION } from './fieldpolicy';

function normalizeDate(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return value;
}

function normalizeDecimal(value: unknown, precision: number): unknown {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  return Number(value.toFixed(precision));
}

function normalizeFieldChange(fc: FieldChange): FieldChange {
  const precision = PER_COLUMN_DECIMAL_PRECISION[fc.field];
  const isDateField = fc.field.endsWith('Date');
  const from = isDateField ? normalizeDate(fc.from) : precision !== undefined ? normalizeDecimal(fc.from, precision) : fc.from;
  const to = isDateField ? normalizeDate(fc.to) : precision !== undefined ? normalizeDecimal(fc.to, precision) : fc.to;
  return { field: fc.field, from, to };
}

function sortKeys<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys) as unknown as T;
  const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sortKeys(v)] as const);
  entries.sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries) as T;
}

function sortNumericArray(values: number[] | undefined): number[] | undefined {
  if (!values) return undefined;
  return [...values].sort((a, b) => a - b);
}

function normalizeReferences(refs: Effect['references']): Effect['references'] {
  if (!refs) return undefined;
  const normalized: NonNullable<Effect['references']> = {};
  if (refs.coreMeasurementIDs !== undefined) normalized.coreMeasurementIDs = sortNumericArray(refs.coreMeasurementIDs);
  if (refs.stemGUIDs !== undefined) normalized.stemGUIDs = sortNumericArray(refs.stemGUIDs);
  if (refs.treeIDs !== undefined) normalized.treeIDs = sortNumericArray(refs.treeIDs);
  if (refs.speciesID !== undefined) normalized.speciesID = refs.speciesID;
  return normalized;
}

function sortEffects(effects: Effect[]): Effect[] {
  return [...effects]
    .map(effect => ({
      ...effect,
      references: normalizeReferences(effect.references)
    }))
    .sort((a, b) => (a.id + a.category + a.affectedTable).localeCompare(b.id + b.category + b.affectedTable));
}

function canonicalizeEditPlan(plan: EditPlan): unknown {
  const { planHash: _planHash, generatedAt: _generatedAt, ...rest } = plan;
  const canonical = {
    ...rest,
    effects: sortEffects(plan.effects).map(effect => sortKeys(effect)),
    fieldChanges: plan.fieldChanges.map(normalizeFieldChange).sort((a, b) => a.field.localeCompare(b.field))
  };
  return sortKeys(canonical);
}

function canonicalizeRowPlan(rowPlan: RowPlan): unknown {
  const { plan: nested, ...rest } = rowPlan;
  return sortKeys({
    ...rest,
    plan: nested ? canonicalizeEditPlan(nested) : undefined
  });
}

export function canonicalizePlan(plan: EditPlan | BulkEditPlan): unknown {
  if ('rowPlans' in plan) {
    const { planHash: _planHash, generatedAt: _generatedAt, ...rest } = plan;
    return sortKeys({
      ...rest,
      rowPlans: plan.rowPlans
        .map(canonicalizeRowPlan)
        .sort((a, b) => Number((a as { rowIndex: number }).rowIndex) - Number((b as { rowIndex: number }).rowIndex)),
      aggregateEffects: sortEffects(plan.aggregateEffects).map(effect => sortKeys(effect))
    });
  }

  return canonicalizeEditPlan(plan);
}

export function hashPlan(plan: EditPlan | BulkEditPlan): string {
  const canonical = canonicalizePlan(plan);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
