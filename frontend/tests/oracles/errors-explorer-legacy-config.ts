/**
 * FROZEN ORACLE support (#544). Values the errors explorer oracle (errors-explorer-legacy.ts) reads from
 * config/errorsexplorer.ts, copied verbatim at 02292176 so a later change to the live config cannot move the oracle.
 * Only types are imported from the live module: a type change breaks compilation loudly, never silently.
 * Production code must never import it.
 */
import type { ErrorExplorerNumberField, ErrorExplorerSource, ErrorTypeIdentity } from '@/config/errorsexplorer';

export const ERROR_SOURCE = { validation: 'validation', ingestion: 'ingestion' } as const satisfies Record<string, Exclude<ErrorExplorerSource, 'all'>>;

/** The synthetic occurrence _shared.ts gives an IsValidated = FALSE row that has no unresolved log entry. */
export const FALLBACK_ERROR_CODE = 'failed_no_log';
export const FALLBACK_ERROR_MESSAGE = 'Measurement is marked invalid but has no unresolved error log entry.';

export const DBH_CHANGE_VALIDATION_CODES: ReadonlySet<string> = new Set(['1', '2']);
export const DBH_CHANGE_PERCENT_FRACTION_DIGITS = 1;
const PERCENT_SCALE = 100;

export function toFiniteNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim().length === 0) return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function computeDbhChangePercent(prior: unknown, now: unknown): number | null {
  const priorValue = toFiniteNumberOrNull(prior);
  const nowValue = toFiniteNumberOrNull(now);
  if (priorValue === null || nowValue === null || priorValue === 0) return null;
  const roundingFactor = 10 ** DBH_CHANGE_PERCENT_FRACTION_DIGITS;
  return Math.round(((nowValue - priorValue) / priorValue) * PERCENT_SCALE * roundingFactor) / roundingFactor;
}

export const INGESTION_ERROR_FIELD_MAP: Record<string, string[]> = {
  MISSING_FIELD_TREETAG: ['treeTag'],
  MISSING_FIELD_STEMTAG: ['stemTag'],
  MISSING_FIELD_SPECIESCODE: ['speciesCode'],
  MISSING_FIELD_QUADRATNAME: ['quadratName'],
  MISSING_FIELD_DATE: ['measurementDate'],
  MISSING_FIELD_LOCALX: ['stemLocalX'],
  MISSING_FIELD_LOCALY: ['stemLocalY'],
  INVALID_QUADRAT: ['quadratName'],
  INVALID_SPECIES: ['speciesCode'],
  QUADRAT_MISMATCH: ['quadratName'],
  COORDINATE_DRIFT: ['stemLocalX', 'stemLocalY'],
  DUPLICATE_ENTRY: ['treeTag', 'stemTag'],
  DUPLICATE_TAG_STEMTAG: ['treeTag', 'stemTag'],
  DUPLICATE_TAG_CONFLICT: ['treeTag', 'stemTag'],
  DUPLICATE_TAG_CONFLICT_EXISTING: ['treeTag', 'stemTag'],
  NEGATIVE_DBH: ['measuredDBH'],
  NEGATIVE_HOM: ['measuredHOM'],
  // Retired code — see config/measurementerrors.ts. Kept so rows persisted
  // under the old grouped lx/ly code still highlight their coordinate cells.
  MISSING_FIELD_COORDINATES: ['stemLocalX', 'stemLocalY'],
  NON_NUMERIC_DBH: ['measuredDBH'],
  NON_NUMERIC_HOM: ['measuredHOM'],
  NON_NUMERIC_COORDINATE: ['stemLocalX', 'stemLocalY', 'stemPlotX', 'stemPlotY'],
  INVALID_DATE: ['measurementDate'],
  MALFORMED_ROW: ['treeTag', 'stemTag'],
  // A storage-range reject can come from lx/ly OR px/py (Decimal value for lx|ly|px|py is out of
  // range) — the reason text doesn't say which pair, so route to both local and plot fields rather
  // than falsely pinning it on lx/ly alone.
  INVALID_COORDINATE: ['stemLocalX', 'stemLocalY', 'stemPlotX', 'stemPlotY'],
  FIELD_TOO_LONG: [],
  MISSING_MEASUREMENT_DATA: ['measuredDBH', 'measuredHOM'],
  // No field is at fault — the upload was cut off before the row was judged.
  INTERRUPTED_UPLOAD: [],
  SQL_EXCEPTION: [],
  // No field is at fault — the reject predates reason recording or its reason is unrecognized.
  UNCLASSIFIED_REJECT: [],
  SAME_BATCH_SPECIES_CONFLICT: ['treeTag', 'speciesCode']
};

export function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(value => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)));
}

export function dedupeNumbers(values: Array<number | null | undefined>): number[] {
  return Array.from(new Set(values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))));
}

export function buildErrorTypeKey({ source, code, message }: ErrorTypeIdentity): string {
  return JSON.stringify([source, code, message]);
}

export const ERROR_EXPLORER_NUMBER_FIELDS = [
  'stemLocalX',
  'stemLocalY',
  'stemPlotX',
  'stemPlotY',
  'measuredDBH',
  'measuredHOM',
  'priorDBH',
  'dbhChangePercent'
] as const;

export function isErrorExplorerNumberField(field: string): field is ErrorExplorerNumberField {
  return (ERROR_EXPLORER_NUMBER_FIELDS as readonly string[]).includes(field);
}
