import { isDateField, PER_COLUMN_DECIMAL_PRECISION } from './fieldpolicy';

// MySQL2 returns DECIMAL columns as strings (e.g. '3.500000') and DATE/DATETIME
// columns as Date objects. The client sends numbers and 'YYYY-MM-DD' strings.
// Comparing those raw with Object.is produces spurious fieldChanges that fire
// cross-row rules (R4) on every revert and edit. Normalize both sides to the
// same JS shape before diffing. isDateField is sourced from fieldpolicy so the
// planhash uses the same classification.
function normalizeAtPrecision(field: string, value: unknown, resolvePrecision: (field: string) => number | undefined): unknown {
  if (value === null || value === undefined) return value;
  if (isDateField(field)) {
    if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    return value;
  }
  const precision = resolvePrecision(field);
  if (precision !== undefined) {
    const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(num)) return Number(num.toFixed(precision));
  }
  return value;
}

export function normalizeForDiff(field: string, value: unknown): unknown {
  return normalizeAtPrecision(field, value, f => PER_COLUMN_DECIMAL_PRECISION[f]);
}

export function fieldChanged(field: string, from: unknown, to: unknown): boolean {
  return !Object.is(normalizeForDiff(field, from), normalizeForDiff(field, to));
}

// Every PER_COLUMN_DECIMAL_PRECISION column is a DECIMAL(12,6) in the DB;
// the UI precision above rounds to fewer digits for display/diff purposes.
// A locked, freshly re-read DB value must be compared at this full stored
// scale so a sub-UI-precision concurrent change is never missed.
const STORED_DECIMAL_SCALE = 6;

/**
 * Like `fieldChanged`, but numeric fields are compared at the full stored
 * DECIMAL(12,6) scale (`STORED_DECIMAL_SCALE`) instead of each column's UI
 * rounding precision. For use ONLY when `to`/`from` represents a genuinely
 * current, locked DB read (never a UI-rounded preview value on both sides) —
 * e.g. a stale-preview drift guard. Date and non-numeric field handling is
 * identical to `fieldChanged`.
 */
export function fieldChangedAtStoredPrecision(field: string, from: unknown, to: unknown): boolean {
  const resolveStoredPrecision = (f: string): number | undefined => (PER_COLUMN_DECIMAL_PRECISION[f] !== undefined ? STORED_DECIMAL_SCALE : undefined);
  return !Object.is(normalizeAtPrecision(field, from, resolveStoredPrecision), normalizeAtPrecision(field, to, resolveStoredPrecision));
}
