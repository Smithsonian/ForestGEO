import { PER_COLUMN_DECIMAL_PRECISION, isDateField } from './fieldpolicy';

export type RowMode = 'revision-update' | 'revision-insert';

type CanonicalField =
  | 'TreeTag'
  | 'StemTag'
  | 'SpeciesCode'
  | 'QuadratName'
  | 'StemLocalX'
  | 'StemLocalY'
  | 'MeasuredDBH'
  | 'MeasuredHOM'
  | 'MeasurementDate'
  | 'Attributes'
  | 'Description';

const UPDATE_FIELDS: readonly CanonicalField[] = [
  'MeasuredDBH',
  'MeasuredHOM',
  'MeasurementDate',
  'Attributes',
  'Description',
  'TreeTag',
  'StemTag',
  'SpeciesCode',
  'QuadratName',
  'StemLocalX',
  'StemLocalY'
];

const INSERT_FIELDS: readonly CanonicalField[] = [...UPDATE_FIELDS];

// Maps CSV lowercase alias keys onto their canonical field names.
// These come from the `revision-row-local` and `revision-identity` surfaces
// defined in fieldpolicy.ts — kept here so canonicalrow has a single source
// of truth for the CSV alias taxonomy.
const CSV_ALIAS_TO_CANONICAL: Record<string, CanonicalField> = {
  tag: 'TreeTag',
  stemtag: 'StemTag',
  spcode: 'SpeciesCode',
  quadrat: 'QuadratName',
  lx: 'StemLocalX',
  ly: 'StemLocalY',
  dbh: 'MeasuredDBH',
  hom: 'MeasuredHOM',
  date: 'MeasurementDate',
  codes: 'Attributes',
  comments: 'Description'
};

const ALL_CANONICAL_FIELD_SET: ReadonlySet<string> = new Set<string>(INSERT_FIELDS);
const UPDATE_FIELD_SET: ReadonlySet<CanonicalField> = new Set(UPDATE_FIELDS);
const INSERT_FIELD_SET: ReadonlySet<CanonicalField> = new Set(INSERT_FIELDS);

function toCanonicalKey(key: string): CanonicalField | null {
  if (Object.prototype.hasOwnProperty.call(CSV_ALIAS_TO_CANONICAL, key)) return CSV_ALIAS_TO_CANONICAL[key];
  if (ALL_CANONICAL_FIELD_SET.has(key)) return key as CanonicalField;
  return null;
}

function normalizeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed.toUpperCase() === 'NULL') return null;
  return trimmed;
}

function normalizeDate(value: unknown): string | null {
  const trimmed = normalizeString(value);
  if (trimmed === null) return null;
  // Already in YYYY-MM-DD — pass through without touching
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  // ISO datetime — strip the time component
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
  // Fallback: parse and re-format, return raw string if unparseable
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString().slice(0, 10);
}

function normalizeDecimal(value: unknown, precision: number): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Number(value.toFixed(precision));
  }
  const trimmed = normalizeString(value);
  if (trimmed === null) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(precision));
}

/**
 * Normalizes a CSV row into the stable, hashable shape the editplan analyzer
 * and apply path both consume.
 *
 * Both modes accept the full editable surface — row-local fields
 * (`MeasuredDBH`, `MeasuredHOM`, `MeasurementDate`, `Attributes`,
 * `Description`) plus identity/coordinate fields (`TreeTag`, `StemTag`,
 * `SpeciesCode`, `QuadratName`, `StemLocalX`, `StemLocalY`). Phase 2 of the
 * revision-upload work removed the row-local-only restriction on
 * `revision-update` so identity edits flow through the same analyzer + writer
 * as the single-row PATCH path.
 *
 * Keys absent in the input are absent in the output (no `undefined`
 * pollution). Unknown keys are silently dropped. The function is idempotent:
 * calling it twice with the same mode yields the same result.
 */
export function canonicalizeRowForHash(row: Record<string, unknown>, mode: RowMode): Record<string, unknown> {
  const allowedSet = mode === 'revision-insert' ? INSERT_FIELD_SET : UPDATE_FIELD_SET;
  const out: Record<string, unknown> = {};

  for (const [rawKey, rawValue] of Object.entries(row)) {
    const canonical = toCanonicalKey(rawKey);
    if (canonical === null || !allowedSet.has(canonical)) continue;

    if (isDateField(canonical)) {
      out[canonical] = normalizeDate(rawValue);
      continue;
    }

    const precision = PER_COLUMN_DECIMAL_PRECISION[canonical];
    if (precision !== undefined) {
      out[canonical] = normalizeDecimal(rawValue, precision);
      continue;
    }

    out[canonical] = normalizeString(rawValue);
  }

  return out;
}
