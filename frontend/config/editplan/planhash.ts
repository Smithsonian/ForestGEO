import { createHash } from 'node:crypto';
import {
  BulkEditPlan,
  Effect,
  EditPlan,
  FieldChange,
  RowPlan,
  SpeciesCorrectionGroup,
  SpeciesCorrectionSummary,
  SpeciesCorrectionUndoRestoration
} from './types';
import { PER_COLUMN_DECIMAL_PRECISION, isDateField } from './fieldpolicy';

function normalizeDate(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return value;
}

function normalizeDecimal(value: unknown, precision: number): unknown {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  return Number(value.toFixed(precision));
}

/** Applies the hash's own date/decimal normalization so callers compare values exactly as the hash does. */
export function normalizeFieldValueForComparison(field: string, value: unknown): unknown {
  if (isDateField(field)) return normalizeDate(value);
  const precision = PER_COLUMN_DECIMAL_PRECISION[field];
  return precision !== undefined ? normalizeDecimal(value, precision) : value;
}

function normalizeFieldChange(fc: FieldChange): FieldChange {
  return {
    field: fc.field,
    from: normalizeFieldValueForComparison(fc.field, fc.from),
    to: normalizeFieldValueForComparison(fc.field, fc.to)
  };
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

// Re-sort so query/enumeration order never affects the hash. Whole records are
// hashed, not just IDs, so a measurement moving between stems changes the hash.
function sortCorrectionMembership(correction: SpeciesCorrectionSummary): SpeciesCorrectionSummary {
  return {
    ...correction,
    stems: [...correction.stems].sort((a, b) => a.stemGUID - b.stemGUID),
    measurements: [...correction.measurements].sort((a, b) => a.coreMeasurementID - b.coreMeasurementID)
  };
}

function normalizeSpeciesCorrection(correction: EditPlan['speciesCorrection']): SpeciesCorrectionSummary | undefined {
  if (!correction) return undefined;
  return sortCorrectionMembership(correction);
}

// `restoredAttributeCodes` keeps `null` distinct from `[]`.
function normalizeSpeciesCorrectionUndo(restoration: EditPlan['speciesCorrectionUndo']): SpeciesCorrectionUndoRestoration | undefined {
  if (!restoration) return undefined;
  return {
    ...restoration,
    restoredMemberRawSpCodes: [...restoration.restoredMemberRawSpCodes].sort((a, b) => a.coreMeasurementID - b.coreMeasurementID),
    restoredCoreMeasurementColumns: [...restoration.restoredCoreMeasurementColumns].sort((a, b) => a.column.localeCompare(b.column)),
    restoredStemColumns: [...restoration.restoredStemColumns].sort((a, b) => a.column.localeCompare(b.column)),
    restoredAttributeCodes: restoration.restoredAttributeCodes === null ? null : [...restoration.restoredAttributeCodes].sort()
  };
}

function normalizeSpeciesCorrectionGroups(groups: BulkEditPlan['speciesCorrectionGroups']): SpeciesCorrectionGroup[] | undefined {
  if (!groups) return undefined;
  return [...groups]
    .map(group => ({
      ...group,
      correction: sortCorrectionMembership(group.correction),
      members: [...group.members].sort((a, b) => a.rowIndex - b.rowIndex),
      affectedCoreMeasurementIDs: sortNumericArray(group.affectedCoreMeasurementIDs) ?? [],
      affectedStemGUIDs: sortNumericArray(group.affectedStemGUIDs) ?? []
    }))
    .sort((a, b) => a.treeID - b.treeID || a.censusID - b.censusID);
}

function canonicalizeEditPlan(plan: EditPlan): unknown {
  const { planHash: _planHash, generatedAt: _generatedAt, ...rest } = plan;
  const canonical = {
    ...rest,
    effects: sortEffects(plan.effects).map(effect => sortKeys(effect)),
    fieldChanges: plan.fieldChanges.map(normalizeFieldChange).sort((a, b) => a.field.localeCompare(b.field)),
    speciesCorrection: normalizeSpeciesCorrection(plan.speciesCorrection),
    speciesCorrectionUndo: normalizeSpeciesCorrectionUndo(plan.speciesCorrectionUndo)
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
    const sortedDuplicates = [...plan.duplicateDeletions].sort(
      (a, b) => a.coreMeasurementID - b.coreMeasurementID || a.survivorCoreMeasurementID - b.survivorCoreMeasurementID
    );
    return sortKeys({
      ...rest,
      rowPlans: plan.rowPlans
        .map(canonicalizeRowPlan)
        .sort((a, b) => Number((a as { rowIndex: number }).rowIndex) - Number((b as { rowIndex: number }).rowIndex)),
      aggregateEffects: sortEffects(plan.aggregateEffects).map(effect => sortKeys(effect)),
      duplicateDeletions: sortedDuplicates,
      // An `undefined` value is dropped by JSON.stringify, so a group-free bulk plan hashes exactly as one that predates this field.
      speciesCorrectionGroups: normalizeSpeciesCorrectionGroups(plan.speciesCorrectionGroups)
    });
  }

  return canonicalizeEditPlan(plan);
}

export function hashPlan(plan: EditPlan | BulkEditPlan): string {
  const canonical = canonicalizePlan(plan);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
