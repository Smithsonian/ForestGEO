import { formatCount } from '@/config/censusoverview';
import type { MeasurementsSummaryRDS } from '@/lib/db/definitions/views';

export type ErrorExplorerSource = 'all' | 'validation' | 'ingestion';
export type ContradictionType = 'duplicate_tag_stem' | 'same_batch_conflict';

export const CONTRADICTION_LABELS: Record<ContradictionType, string> = {
  duplicate_tag_stem: 'Duplicate tag/stem',
  same_batch_conflict: 'Same-batch conflict'
};

export const CONTRADICTION_REASONS: Record<ContradictionType, string> = {
  duplicate_tag_stem: 'These rows share the same tree and stem tags within the active census and should be reviewed together.',
  same_batch_conflict: 'These rows came from the same upload batch, share a tree tag, and disagree on species.'
};

export interface ErrorFacetOption {
  value: string;
  count: number;
}

export interface ErrorExplorerFilters {
  source: ErrorExplorerSource;
  exactMessages: string[];
  affectedFields: string[];
  contradictionOnly: boolean;
  contradictionTypes: ContradictionType[];
  quickSearch: string;
  presetId?: string;
}

export interface ErrorExplorerQueryRequest {
  schema: string;
  plotID: number;
  censusID: number;
  /** All physical census rows represented by the selected plot census. */
  censusIDs?: number[];
  page: number;
  pageSize: number;
  filters: ErrorExplorerFilters;
}

export interface ErrorComparisonContext {
  priorCensusID: number | null;
  priorDBH: number | null;
  priorHOM: number | null;
  homChanged: boolean;
}

export interface ErrorDetailRecord {
  source: Exclude<ErrorExplorerSource, 'all'>;
  code: string;
  message: string;
  fields: string[];
  procedureName?: string | null;
  comparison: ErrorComparisonContext | null;
}

export interface ErrorExplorerRow extends MeasurementsSummaryRDS {
  id: number;
  primaryErrorMessage: string;
  errorMessages: string[];
  errorSources: Array<Exclude<ErrorExplorerSource, 'all'>>;
  errorFields: string[];
  errorCodes: string[];
  errorCount: number;
  hasContradiction: boolean;
  contradictionTypes: ContradictionType[];
  contradictionType: ContradictionType | null;
  contradictionGroupKey: string | null;
  relatedMeasurementIDs: number[];
  uploadFileID?: string | null;
  uploadBatchID?: string | null;
  // Authoritative failure flag derived from coremeasurements.StemGUID — must be
  // computed server-side because measurementssummary.StemGUID can drift stale.
  isFailedRow: boolean;
  // Comparison context of the first visible ValidationID 1/2 occurrence (ascending
  // code order), independent of raw-row/grouping order. See buildComparison in _shared.ts.
  priorCensusID?: number | null;
  priorDBH?: number | null;
  priorHOM?: number | null;
  homChanged?: boolean;
}

export interface ErrorExplorerSummary {
  total: number;
  validation: number;
  ingestion: number;
  contradictions: number;
  duplicateTagStem: number;
  sameBatchConflict: number;
}

export interface ErrorExplorerQueryResponse {
  rows: ErrorExplorerRow[];
  totalRows: number;
  summary: ErrorExplorerSummary;
}

export interface ErrorExplorerFacetsResponse {
  messages: ErrorFacetOption[];
  fields: ErrorFacetOption[];
  sourceCounts: {
    validation: number;
    ingestion: number;
  };
  contradictionCounts: {
    duplicateTagStem: number;
    sameBatchConflict: number;
  };
  /** Distinct measurements in scope after the facet filters; sourceCounts can overlap. */
  totalMeasurements: number;
}

export interface RelatedContradictionRow {
  coreMeasurementID: number;
  treeTag?: string;
  stemTag?: string;
  speciesCode?: string;
  quadratName?: string;
  measurementDate?: string | null;
  measuredDBH?: number | null;
  measuredHOM?: number | null;
  stemLocalX?: number | null;
  stemLocalY?: number | null;
  description?: string | null;
  uploadFileID?: string | null;
  uploadBatchID?: string | null;
  primaryErrorMessage?: string;
  errorCount?: number;
  errorMessages?: string[];
  /** false for a contradiction partner with no unresolved error (no details row exists for it); Task 11 returns those. */
  inErrorSet: boolean;
}

export interface ErrorExplorerDetailsResponse {
  row: ErrorExplorerRow | null;
  allErrors: ErrorDetailRecord[];
  relatedRows: RelatedContradictionRow[];
}

// ── Shared with View Data (specs 2026-11-04: View Errors "The shared panel", View Data "Details panel") ──

export const ERROR_SOURCE = { validation: 'validation', ingestion: 'ingestion' } as const satisfies Record<string, Exclude<ErrorExplorerSource, 'all'>>;

/** The synthetic occurrence _shared.ts gives an IsValidated = FALSE row that has no unresolved log entry. */
export const FALLBACK_ERROR_CODE = 'failed_no_log';
export const FALLBACK_ERROR_MESSAGE = 'Measurement is marked invalid but has no unresolved error log entry.';
export const MARKED_INVALID_NO_ERROR_LOGGED_LABEL = 'Marked invalid, no error logged';

export const CLEAR_VALIDATION_ERRORS_ENDPOINT = '/api/validations/clearmeasurementerrors';
export const CLEAR_VALIDATION_ERRORS_SUCCESS = 'Validation errors cleared. The row is pending until validations run again.';
export const CLEAR_VALIDATION_ERRORS_FAILED_MESSAGE = "Couldn't clear the validation errors. Nothing changed.";
export const CLEAR_UNCONFIRMED_MESSAGE = 'Could not confirm whether the validation errors were cleared.';
/** r3 (View Data R2): the row had nothing left to clear, so nothing changed; the page re-reads it. */
export const CLEAR_NOTHING_TO_CLEAR_MESSAGE = "Nothing to clear: this row's errors were already resolved.";
export const CLEAR_MEASUREMENT_ERRORS_CODES = {
  invalidRequest: 'INVALID_CLEAR_REQUEST',
  pendingUser: 'PENDING_USER_FORBIDDEN',
  sessionExpired: 'SESSION_EXPIRED',
  scopeForbidden: 'SCOPE_FORBIDDEN',
  scopeBusy: 'SCOPE_BUSY',
  notInScope: 'MEASUREMENT_NOT_IN_SCOPE',
  failedRow: 'FAILED_MEASUREMENT_NOT_CLEARABLE',
  nothingToClear: 'NOTHING_TO_CLEAR',
  failed: 'CLEAR_VALIDATION_ERRORS_FAILED'
} as const;

/** D-f: keyed by the exact stored message. Filters, identity and deep links keep the stored text. */
export const ERROR_TYPE_DISPLAY_LABELS: ReadonlyMap<string, string> = new Map([
  ['Flagged;Different species', 'Different species'],
  ['Flagged;Flagged;Different quadrats', 'Different quadrats'],
  ['Duplicate tree (and stem) tag found in census;Duplicate stem (and tree) tag found in census', 'Duplicate tree and stem tag in census'],
  ['Invalid DBH;Invalid HOM;DEAD-state attribute(s)', 'Measured, but coded dead'],
  ['Missing DBH;Missing HOM;LIVE-state attribute(s)', 'Not measured, but coded alive'],
  [FALLBACK_ERROR_MESSAGE, MARKED_INVALID_NO_ERROR_LOGGED_LABEL]
]);

export function formatErrorTypeLabel(message: string): string {
  return ERROR_TYPE_DISPLAY_LABELS.get(message) ?? message;
}

export function isMarkedInvalidWithoutLoggedError(errors: ReadonlyArray<Pick<ErrorDetailRecord, 'source' | 'code'>>): boolean {
  return errors.length === 1 && errors[0].source === ERROR_SOURCE.ingestion && errors[0].code === FALLBACK_ERROR_CODE;
}

export interface ClearValidationErrorsEligibility {
  isLinkedToStem: boolean;
  hasUnresolvedValidationError: boolean;
  markedInvalidWithoutLoggedError: boolean;
}

/** The Clear route refuses unlinked rows with 409, so this never offers what the route rejects. */
export function canClearValidationErrors({
  isLinkedToStem,
  hasUnresolvedValidationError,
  markedInvalidWithoutLoggedError
}: ClearValidationErrorsEligibility): boolean {
  return isLinkedToStem && (hasUnresolvedValidationError || markedInvalidWithoutLoggedError);
}

/** The always-present input of the shared details panel; each page builds it from its own grid row. */
export interface DetailsPanelRow {
  measurementID: number;
  treeTag: string | null;
  stemTag: string | null;
  quadratName: string | null;
  speciesCode: string | null;
  measurementDate: string | null;
  isLinkedToStem: boolean;
  markedInvalidWithoutLoggedError: boolean;
}

export type ErrorSourceKind = Exclude<ErrorExplorerSource, 'all'>;

export interface ErrorTypeIdentity {
  source: ErrorSourceKind;
  code: string;
  /** The stored message, never the display label. */
  message: string;
}

export const ERROR_DETAILS_SHEET_WIDTH = 440;

// DBH change (spec Error-type groups → Change; P5-1 moved the code set here from _shared.ts).
export const DBH_CHANGE_VALIDATION_CODES: ReadonlySet<string> = new Set(['1', '2']);
export const DBH_CHANGE_PERCENT_FRACTION_DIGITS = 1;
const PERCENT_SCALE = 100;
const DBH_DISPLAY_FRACTION_DIGITS = 2;
const POSITIVE_SIGN = '+';
const NEGATIVE_SIGN = '−';
const PERCENT_SUFFIX = '%';

/** null/undefined/blank and non-finite values are blank; DECIMAL columns arrive as strings (mysql2 without decimalNumbers). */
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

export function formatDbhChange(percent: number | null | undefined): string {
  if (percent === null || percent === undefined) return '';
  const sign = percent > 0 ? POSITIVE_SIGN : percent < 0 ? NEGATIVE_SIGN : '';
  return `${sign}${Math.abs(percent).toFixed(DBH_CHANGE_PERCENT_FRACTION_DIGITS)}${PERCENT_SUFFIX}`;
}

export function formatDbhChangeFact(priorDBH: number, priorCensusNumber: number | null, currentDBH: unknown, percent: number | null): string {
  const current = toFiniteNumberOrNull(currentDBH);
  const priorPlace = priorCensusNumber === null ? 'the previous census' : `Census ${priorCensusNumber}`;
  const now = current === null ? '—' : current.toFixed(DBH_DISPLAY_FRACTION_DIGITS);
  const change = percent === null ? '' : `, a change of ${formatDbhChange(percent)}`;
  return `DBH went from ${priorDBH.toFixed(DBH_DISPLAY_FRACTION_DIGITS)} in ${priorPlace} to ${now}${change}`;
}

function errorTypeCodeKey({ source, code }: Pick<ErrorTypeIdentity, 'source' | 'code'>): string {
  return `${source}:${code}`;
}

export const ATTRIBUTES_PAGE_PATH = '/fixeddatainput/attributes';
const ATTRIBUTE_CODE_ERROR_TYPES: ReadonlySet<string> = new Set(['validation:14']);

export function isAttributeCodeErrorType(identity: Pick<ErrorTypeIdentity, 'source' | 'code'>): boolean {
  return ATTRIBUTE_CODE_ERROR_TYPES.has(errorTypeCodeKey(identity));
}

export const EDIT_LOCK_TOOLTIPS = {
  editing: "Save or cancel the row you're editing first",
  saving: 'Wait for your edit to finish saving'
} as const;

export const EDIT_THIS_ROW_UNAVAILABLE_TOOLTIP = 'Open this row from its group to edit it';

export const DETAILS_SHEET_TEXT = {
  closeDetails: 'Close details',
  editThisRow: 'Edit this row',
  clearValidationErrors: 'Clear validation errors',
  openAttributes: 'Open Attributes →',
  noUnresolvedErrors: 'No unresolved errors',
  rowResolved: 'This row has no unresolved errors any more.',
  loadFailed: "Couldn't load these details.",
  compareTitle: 'Compare with the other row',
  inspectRow: 'Inspect this row',
  codesHeading: 'Codes',
  uploadedCodes: 'Uploaded',
  materializedCodes: 'Materialized',
  retry: 'Retry',
  rowsStale: 'These rows may be out of date.',
  validationChip: 'Validation',
  ingestionChip: 'Ingestion',
  unavailable: '—'
} as const;

export function formatMeasurementHeading(measurementID: number): string {
  return `Measurement ${measurementID}`;
}

export function formatTreeStemLine(treeTag: string | null, stemTag: string | null): string {
  return `Tree ${treeTag ?? DETAILS_SHEET_TEXT.unavailable} · Stem ${stemTag ?? DETAILS_SHEET_TEXT.unavailable}`;
}

export function formatQuadratLine(quadratName: string | null, speciesCode: string | null, measurementDate: string | null): string {
  return [
    `Quadrat ${quadratName ?? DETAILS_SHEET_TEXT.unavailable}`,
    speciesCode ?? DETAILS_SHEET_TEXT.unavailable,
    measurementDate ?? DETAILS_SHEET_TEXT.unavailable
  ].join(' · ');
}

export function formatUnresolvedErrorsHeading(count: number): string {
  return `${formatCount(count)} unresolved ${count === 1 ? 'error' : 'errors'}`;
}

export function formatFieldsDiffer(differing: number, total: number): string {
  return `${differing} of ${total} fields differ`;
}

export function formatOpenRow(measurementID: number): string {
  return `Open row ${measurementID}`;
}

export const DEFAULT_ERROR_EXPLORER_FILTERS: ErrorExplorerFilters = {
  source: 'all',
  exactMessages: [],
  affectedFields: [],
  contradictionOnly: false,
  contradictionTypes: [],
  quickSearch: '',
  presetId: 'all_errors'
};

export const ERRORS_PAGE_PATH = '/measurementshub/errors';
export const ERRORS_EXPLORER_MESSAGE_PARAM = 'message';
export const ERRORS_EXPLORER_VIEW_PARAM = 'view';
export const ERRORS_EXPLORER_VIEW_ALL = 'all';

export function buildErrorsExplorerMessageHref(message: string): string {
  return `${ERRORS_PAGE_PATH}?${new URLSearchParams({ [ERRORS_EXPLORER_MESSAGE_PARAM]: message }).toString()}`;
}

export const ERRORS_EXPLORER_VIEW_ALL_HREF = `${ERRORS_PAGE_PATH}?${new URLSearchParams({ [ERRORS_EXPLORER_VIEW_PARAM]: ERRORS_EXPLORER_VIEW_ALL }).toString()}`;

/**
 * Filters a View Errors deep link asks for, or null for a plain visit (which
 * restores the saved filters). `message` wins over `view=all`. A message link
 * clears presetId, as picking a message by hand does, so no preset chip claims
 * to be active. `searchParams` is null outside the app router.
 */
export function resolveErrorsExplorerDeepLinkFilters(searchParams: Pick<URLSearchParams, 'get'> | null): ErrorExplorerFilters | null {
  const message = searchParams?.get(ERRORS_EXPLORER_MESSAGE_PARAM);
  if (message && message.trim().length > 0) {
    return { ...DEFAULT_ERROR_EXPLORER_FILTERS, exactMessages: [message], presetId: undefined };
  }
  if (searchParams?.get(ERRORS_EXPLORER_VIEW_PARAM) === ERRORS_EXPLORER_VIEW_ALL) {
    return { ...DEFAULT_ERROR_EXPLORER_FILTERS };
  }
  return null;
}

export const ERROR_EXPLORER_PRESETS = [
  {
    id: 'all_errors',
    label: 'All Errors',
    filters: {
      source: 'all',
      exactMessages: [],
      affectedFields: [],
      contradictionOnly: false,
      contradictionTypes: [],
      quickSearch: ''
    } satisfies ErrorExplorerFilters
  },
  {
    id: 'validation_only',
    label: 'Validation Only',
    filters: {
      source: 'validation',
      exactMessages: [],
      affectedFields: [],
      contradictionOnly: false,
      contradictionTypes: [],
      quickSearch: ''
    } satisfies ErrorExplorerFilters
  },
  {
    id: 'ingestion_only',
    label: 'Ingestion Only',
    filters: {
      source: 'ingestion',
      exactMessages: [],
      affectedFields: [],
      contradictionOnly: false,
      contradictionTypes: [],
      quickSearch: ''
    } satisfies ErrorExplorerFilters
  },
  {
    id: 'contradictions',
    label: 'Contradictions',
    filters: {
      source: 'all',
      exactMessages: [],
      affectedFields: [],
      contradictionOnly: true,
      contradictionTypes: [],
      quickSearch: ''
    } satisfies ErrorExplorerFilters
  },
  {
    id: 'duplicate_tag_stem',
    label: 'Duplicate Tag/Stem',
    filters: {
      source: 'all',
      exactMessages: [],
      affectedFields: [],
      contradictionOnly: true,
      contradictionTypes: ['duplicate_tag_stem'],
      quickSearch: ''
    } satisfies ErrorExplorerFilters
  },
  {
    id: 'same_batch_conflict',
    label: 'Same-Batch Conflicts',
    filters: {
      source: 'all',
      exactMessages: [],
      affectedFields: [],
      contradictionOnly: true,
      contradictionTypes: ['same_batch_conflict'],
      quickSearch: ''
    } satisfies ErrorExplorerFilters
  }
] as const;

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
