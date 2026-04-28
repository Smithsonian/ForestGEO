import type { UserAuthRoles } from '@/config/macros';

export type EditSurface = 'measurementssummary' | 'failedmeasurements' | 'revision-row-local' | 'revision-identity';

export const EDITABLE_FIELDS_BY_SURFACE: Record<EditSurface, ReadonlySet<string>> = {
  measurementssummary: new Set([
    'SpeciesCode',
    'TreeTag',
    'StemTag',
    'QuadratName',
    'StemLocalX',
    'StemLocalY',
    'MeasurementDate',
    'MeasuredDBH',
    'MeasuredHOM',
    'Description',
    'Attributes'
  ]),
  failedmeasurements: new Set(['Tag', 'StemTag', 'SpCode', 'Quadrat', 'X', 'Y', 'DBH', 'HOM', 'Date', 'Codes', 'Comments']),
  'revision-row-local': new Set(['dbh', 'hom', 'date', 'codes', 'comments']),
  'revision-identity': new Set(['spcode', 'tag', 'stemtag', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes', 'comments'])
};

export const FIELD_ALIASES_BY_SURFACE: Record<EditSurface, Record<string, string>> = {
  measurementssummary: {
    speciesCode: 'SpeciesCode',
    treeTag: 'TreeTag',
    stemTag: 'StemTag',
    quadratName: 'QuadratName',
    stemLocalX: 'StemLocalX',
    stemLocalY: 'StemLocalY',
    measurementDate: 'MeasurementDate',
    measuredDBH: 'MeasuredDBH',
    measuredHOM: 'MeasuredHOM',
    description: 'Description',
    attributes: 'Attributes'
  },
  failedmeasurements: {
    tag: 'Tag',
    treeTag: 'Tag',
    rawTreeTag: 'Tag',
    RawTreeTag: 'Tag',
    stemTag: 'StemTag',
    rawStemTag: 'StemTag',
    RawStemTag: 'StemTag',
    spCode: 'SpCode',
    speciesCode: 'SpCode',
    rawSpCode: 'SpCode',
    RawSpCode: 'SpCode',
    quadrat: 'Quadrat',
    quadratName: 'Quadrat',
    rawQuadrat: 'Quadrat',
    RawQuadrat: 'Quadrat',
    x: 'X',
    stemLocalX: 'X',
    rawX: 'X',
    RawX: 'X',
    y: 'Y',
    stemLocalY: 'Y',
    rawY: 'Y',
    RawY: 'Y',
    dbh: 'DBH',
    measuredDBH: 'DBH',
    rawDBH: 'DBH',
    RawDBH: 'DBH',
    hom: 'HOM',
    measuredHOM: 'HOM',
    rawHOM: 'HOM',
    RawHOM: 'HOM',
    date: 'Date',
    measurementDate: 'Date',
    rawDate: 'Date',
    RawDate: 'Date',
    codes: 'Codes',
    attributes: 'Codes',
    rawCodes: 'Codes',
    RawCodes: 'Codes',
    comments: 'Comments',
    description: 'Comments',
    rawComments: 'Comments',
    RawComments: 'Comments'
  },
  'revision-row-local': {},
  'revision-identity': {}
};

export type ClearSemantics = 'no-op-on-blank' | 'clear-on-blank' | 'clear-on-explicit-null' | 'invalid-clear';

export const CLEAR_POLICY: Record<string, ClearSemantics> = {
  SpeciesCode: 'invalid-clear',
  TreeTag: 'invalid-clear',
  StemTag: 'invalid-clear',
  QuadratName: 'invalid-clear',
  Tag: 'invalid-clear',
  SpCode: 'invalid-clear',
  Quadrat: 'invalid-clear',
  X: 'no-op-on-blank',
  Y: 'no-op-on-blank',
  DBH: 'no-op-on-blank',
  HOM: 'no-op-on-blank',
  Date: 'invalid-clear',
  Codes: 'clear-on-blank',
  Comments: 'clear-on-blank',
  MeasuredDBH: 'no-op-on-blank',
  MeasuredHOM: 'no-op-on-blank',
  StemLocalX: 'no-op-on-blank',
  StemLocalY: 'no-op-on-blank',
  MeasurementDate: 'invalid-clear',
  Description: 'clear-on-blank',
  Attributes: 'clear-on-blank'
};

export const PER_COLUMN_DECIMAL_PRECISION: Record<string, number> = {
  MeasuredDBH: 2,
  MeasuredHOM: 2,
  StemLocalX: 2,
  StemLocalY: 2,
  DBH: 2,
  HOM: 2,
  X: 2,
  Y: 2
};

// Date-shaped fields across both surfaces. Analyzer diff and planhash
// normalization both key off this set — keeping them in lockstep so
// `from`/`to` comparisons and hash inputs agree for any new date column.
export const DATE_FIELDS: ReadonlySet<string> = new Set(['MeasurementDate', 'Date']);

export function isDateField(field: string): boolean {
  return DATE_FIELDS.has(field);
}

export class InvalidClearError extends Error {
  constructor(public field: string) {
    super(`Field "${field}" cannot be cleared`);
    this.name = 'InvalidClearError';
  }
}

const TAXONOMIC_IDENTITY_FIELDS = new Set(['SpeciesCode', 'SpCode', 'spcode']);
const SPECIES_EDIT_ROLES = new Set<UserAuthRoles>(['global', 'db admin']);

export function isFieldEditableByRole(fieldName: string, role: UserAuthRoles | null | undefined): boolean {
  if (role === 'pending') return false;
  if (!TAXONOMIC_IDENTITY_FIELDS.has(fieldName)) return true;
  return role !== null && role !== undefined && SPECIES_EDIT_ROLES.has(role);
}

export function normalizeFieldValue(field: string, value: unknown): unknown {
  const policy = CLEAR_POLICY[field] ?? 'no-op-on-blank';
  if (value === undefined) return undefined;
  if (value === null) {
    if (policy === 'invalid-clear') throw new InvalidClearError(field);
    if (policy === 'no-op-on-blank') return undefined;
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const isLiteralNull = trimmed.toUpperCase() === 'NULL';
    if (trimmed === '' || isLiteralNull) {
      if (policy === 'invalid-clear') throw new InvalidClearError(field);
      if (policy === 'no-op-on-blank') return undefined;
      if (policy === 'clear-on-explicit-null' && !isLiteralNull) return undefined;
      return null;
    }
    return trimmed;
  }
  return value;
}

export function canonicalizeEditPayload(surface: EditSurface, rawNewRow: Record<string, unknown>): Record<string, unknown> {
  const aliases = FIELD_ALIASES_BY_SURFACE[surface];
  const canonical: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(rawNewRow)) {
    const field = aliases[rawKey] ?? rawKey;
    const normalized = normalizeFieldValue(field, value);
    if (normalized !== undefined) canonical[field] = normalized;
  }
  return canonical;
}

export function rejectDisallowedFields(surface: EditSurface, newRow: Record<string, unknown>): string[] | null {
  const allowed = EDITABLE_FIELDS_BY_SURFACE[surface];
  const disallowed: string[] = [];
  for (const key of Object.keys(newRow)) {
    if (!allowed.has(key)) disallowed.push(key);
  }
  return disallowed.length ? disallowed : null;
}

// Grid-side predicate: given a raw column field key (any case / alias form),
// does it resolve to a field that the server allowlist marks as editable?
// Importing this from `measurementscommons.tsx` keeps the client grid's
// readonly behavior synchronized with the server allowlist; no separate
// local read-only list to drift silently.
export function isFieldEditableOnSurface(surface: EditSurface, fieldName: string): boolean {
  const aliases = FIELD_ALIASES_BY_SURFACE[surface];
  const canonical = aliases[fieldName] ?? fieldName;
  return EDITABLE_FIELDS_BY_SURFACE[surface].has(canonical);
}
