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

/**
 * Normalizes a single field's value the same way the hash does — date-first,
 * then per-column decimal precision, then passthrough. Exported so a later
 * batch-grouping stage can compare two rows' requested values using the SAME
 * server-side normalization the hash uses, instead of duplicating this logic.
 */
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

// Membership (stems/measurements) is read from the database in ID order by
// the planner, but the hash must not trust that: re-sort explicitly so query
// order is never load-bearing for hash stability, matching
// sortNumericArray's treatment of Effect.references. Re-sorting (rather than
// only validating) also means a future caller that constructs a
// SpeciesCorrectionSummary by hand (e.g. a writer reacting to a
// uniqueness-conflict retry) cannot accidentally produce two hashes for the
// same membership just by enumerating it in a different order.
//
// Each stem/measurement record's own link/scope/activity fields are part of
// the canonical shape as-is (not reduced to just an ID): a measurement
// moving between two already-attached stems (same CoreMeasurementID, new
// stemGUID) or an activity swap between two equal-count siblings must change
// the hash, which it does here because the full sorted record is hashed, not
// merely the sorted ID list.
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

// `EditPlan.speciesCorrectionUndo` (#427 undo) carries the exact evidence the
// writer will restore; its arrays are built from stored JSON evidence, so
// enumeration order must never be load-bearing here either — re-sort
// explicitly, the same way `sortCorrectionMembership` does for a
// correction's own `stems`/`measurements`. Always returns a NEW object (and
// new arrays); the caller's `restoration` is never mutated. `null` is
// preserved as `null` (distinct from `[]`) for `restoredAttributeCodes`.
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

// `BulkEditPlan.speciesCorrectionGroups` (#427 batch corrections) carries the
// SAME producer-enumeration-order risk `normalizeSpeciesCorrection` exists to
// close for a single-row `EditPlan.speciesCorrection`: `bulkanalyzer.ts`
// builds `groups` by iterating a `Map`'s values and `bulkspeciesgroups.ts`
// builds each group's `members`/affected-ID arrays from however the batch's
// rows and the tree's stems/measurements were enumerated. None of that
// iteration order is a property of the correction itself, so it must never
// be load-bearing for hash stability — re-sort explicitly here, the same way
// `sortNumericArray` already does for `Effect.references` and
// `sortCorrectionMembership` does for one correction's own `stems`/
// `measurements`. Always returns a NEW array (and new per-group objects);
// the caller's `plan.speciesCorrectionGroups` (and its nested arrays) is
// never mutated.
function normalizeSpeciesCorrectionGroups(groups: BulkEditPlan['speciesCorrectionGroups']): SpeciesCorrectionGroup[] | undefined {
  if (!groups) return undefined;
  return [...groups]
    .map(group => ({
      ...group,
      correction: sortCorrectionMembership(group.correction),
      members: [...group.members].sort((a, b) => a.rowIndex - b.rowIndex),
      // `affectedCoreMeasurementIDs`/`affectedStemGUIDs` are required (never
      // undefined) on `SpeciesCorrectionGroup`, so `sortNumericArray`'s
      // `undefined`-passthrough branch is unreachable here; `?? []` only
      // satisfies the shared helper's `number[] | undefined` return type.
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
      // `rest` already carries whatever `plan.speciesCorrectionGroups` was
      // (present+array, or absent entirely), but un-normalized; this
      // overrides that key with the re-sorted form. When `plan` has no
      // `speciesCorrectionGroups` at all, `normalizeSpeciesCorrectionGroups`
      // returns `undefined` and `JSON.stringify` drops an `undefined`-valued
      // key the same way it drops an entirely-absent key — so a group-free
      // bulk plan hashes identically to how it did before this field
      // existed, exactly like `speciesCorrection` already behaves on a
      // single-row `EditPlan` above.
      speciesCorrectionGroups: normalizeSpeciesCorrectionGroups(plan.speciesCorrectionGroups)
    });
  }

  return canonicalizeEditPlan(plan);
}

export function hashPlan(plan: EditPlan | BulkEditPlan): string {
  const canonical = canonicalizePlan(plan);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
