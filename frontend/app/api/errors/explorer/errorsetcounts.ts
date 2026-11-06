import {
  dedupeStrings,
  INGESTION_ERROR_FIELD_MAP,
  type ContradictionType,
  type ErrorDetailRecord,
  type ErrorExplorerFacetsResponse,
  type ErrorExplorerFilters,
  type ErrorFacetOption
} from '@/config/errorsexplorer';
import {
  LIST_SEPARATOR,
  NO_LOG_ERROR_CODE,
  NO_LOG_ERROR_MESSAGE,
  NO_LOG_ERROR_SOURCE,
  NO_LOG_ERROR_TYPE_KEY,
  SQL_TRUE,
  type ErrorSignatureRow,
  type ErrorTypeCatalogRow,
  type ErrorTypeKeyFilter,
  type FlagCombinations
} from './errorsetsql';

const VALIDATION_ERROR_FIELD_FALLBACK_MAP: Record<string, string[]> = {
  '5': ['treeTag', 'stemTag'],
  '21': ['treeTag', 'speciesCode']
};
const DUPLICATE_TAG_STEM: ContradictionType = 'duplicate_tag_stem';
const SAME_BATCH_CONFLICT: ContradictionType = 'same_batch_conflict';
const WHOLE_ID_TOKEN = /^\d+$/;

function splitValidationCriteria(criteria?: string | null): string[] {
  if (!criteria) return [];
  return dedupeStrings(criteria.split(';').map(part => part.trim()));
}

export function getOccurrenceFields(source: 'validation' | 'ingestion', errorCode: string, validationCriteria?: string | null): string[] {
  if (source === 'validation') {
    const criteriaFields = splitValidationCriteria(validationCriteria);
    return criteriaFields.length > 0 ? criteriaFields : (VALIDATION_ERROR_FIELD_FALLBACK_MAP[errorCode] ?? []);
  }
  return INGESTION_ERROR_FIELD_MAP[errorCode] ?? [];
}

/** Today's per-error filter (materializeMatchingErrors' body at 8b60006b). */
export function errorMatchesFilters(error: ErrorDetailRecord, filters: ErrorExplorerFilters): boolean {
  if (filters.source !== 'all' && error.source !== filters.source) return false;
  if (filters.exactMessages.length > 0 && !filters.exactMessages.includes(error.message)) return false;
  if (filters.affectedFields.length > 0 && !error.fields.some(field => filters.affectedFields.includes(field))) return false;
  return true;
}

/** Today's contradiction filter (rowMatchesFilters at 8b60006b, lines 424-429). */
export function contradictionFiltersAllow(
  filters: Pick<ErrorExplorerFilters, 'contradictionOnly' | 'contradictionTypes'>,
  hasContradiction: boolean,
  contradictionTypes: readonly ContradictionType[]
): boolean {
  if (filters.contradictionOnly && !hasContradiction) return false;
  if (filters.contradictionTypes.length > 0 && !contradictionTypes.some(type => filters.contradictionTypes.includes(type))) return false;
  return true;
}

export class ErrorTypeCatalogMismatchError extends Error {
  constructor(
    readonly errorTypeKeys: readonly number[],
    reason: string
  ) {
    super(`Error type catalog mismatch for keys ${errorTypeKeys.join(', ')}: ${reason}`);
    this.name = 'ErrorTypeCatalogMismatchError';
  }
}

export interface ErrorTypeCatalog {
  readonly recordsByKey: ReadonlyMap<number, ErrorDetailRecord>;
}

function catalogRecord(source: 'validation' | 'ingestion', code: string, message: string, criteria: string, procedureName: string | null): ErrorDetailRecord {
  return { source, code, message, fields: getOccurrenceFields(source, code, criteria), procedureName, comparison: null };
}

export function buildErrorTypeCatalog(rows: readonly ErrorTypeCatalogRow[]): ErrorTypeCatalog {
  const recordsByKey = new Map<number, ErrorDetailRecord>([
    [NO_LOG_ERROR_TYPE_KEY, catalogRecord(NO_LOG_ERROR_SOURCE, NO_LOG_ERROR_CODE, NO_LOG_ERROR_MESSAGE, '', '')]
  ]);
  for (const row of rows) {
    const key = Number(row.ErrorID);
    if (key === NO_LOG_ERROR_TYPE_KEY) throw new ErrorTypeCatalogMismatchError([key], 'measurement_errors stores the key reserved for the no-log type');
    recordsByKey.set(key, catalogRecord(row.ErrorSource, String(row.ErrorCode), row.DisplayMessage, row.ValidationCriteria, row.ProcedureName ?? null));
  }
  return { recordsByKey };
}

function filtersRestrictErrorTypes(filters: ErrorExplorerFilters): boolean {
  return filters.source !== 'all' || filters.exactMessages.length > 0 || filters.affectedFields.length > 0;
}

export function computeErrorKeySets(catalog: ErrorTypeCatalog, filters: ErrorExplorerFilters): ErrorTypeKeyFilter {
  const matching = Array.from(catalog.recordsByKey).filter(([, record]) => errorMatchesFilters(record, filters));
  return {
    allKeysMatch: !filtersRestrictErrorTypes(filters),
    matchingKeys: matching.map(([key]) => key),
    matchingValidationKeys: matching.filter(([, record]) => record.source === 'validation').map(([key]) => key),
    matchingIngestionKeys: matching.filter(([, record]) => record.source === 'ingestion').map(([key]) => key)
  };
}

export function isImpossibleKeyFilter(keyFilter: ErrorTypeKeyFilter): boolean {
  return !keyFilter.allKeysMatch && keyFilter.matchingKeys.length === 0;
}

const FLAG_COMBINATION_TYPES: Record<keyof FlagCombinations, readonly ContradictionType[]> = {
  none: [],
  sameBatchOnly: [SAME_BATCH_CONFLICT],
  duplicateOnly: [DUPLICATE_TAG_STEM],
  both: [DUPLICATE_TAG_STEM, SAME_BATCH_CONFLICT]
};

export function allowedFlagCombinations(filters: Pick<ErrorExplorerFilters, 'contradictionOnly' | 'contradictionTypes'>): FlagCombinations {
  const allows = (types: readonly ContradictionType[]) => contradictionFiltersAllow(filters, types.length > 0, types);
  return {
    none: allows(FLAG_COMBINATION_TYPES.none),
    sameBatchOnly: allows(FLAG_COMBINATION_TYPES.sameBatchOnly),
    duplicateOnly: allows(FLAG_COMBINATION_TYPES.duplicateOnly),
    both: allows(FLAG_COMBINATION_TYPES.both)
  };
}

export function anyFlagCombinationAllowed(flags: FlagCombinations): boolean {
  return flags.none || flags.sameBatchOnly || flags.duplicateOnly || flags.both;
}

export interface SliceBounds {
  readonly offset: number;
  readonly limit: number;
}

const EMPTY_SLICE: SliceBounds = { offset: 0, limit: 0 };

function toSliceIndex(value: number): number {
  if (Number.isNaN(value)) return 0;
  const truncated = Math.trunc(value);
  return truncated < 0 ? 0 : truncated;
}

/**
 * The offset and limit Array.prototype.slice(page * pageSize, page * pageSize + pageSize) would use, for the inputs
 * the routes can produce (page >= 0 or NaN, possibly fractional or infinite; pageSize clamped to [10, 100] or NaN).
 * A slice that cannot select anything (past any representable length) becomes an empty window.
 */
export function toSliceBounds(page: number, pageSize: number): SliceBounds {
  const start = page * pageSize;
  const offset = toSliceIndex(start);
  const end = toSliceIndex(start + pageSize);
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || end <= offset) return EMPTY_SLICE;
  return { offset, limit: end - offset };
}

/** D4: a cut list keeps only tokens a separator follows, so it can drop an edge ID but never invent one (spec §4). */
export function parseWholeMemberIDs(memberList: string | null | undefined, listComplete: boolean): number[] {
  if (!memberList) return [];
  const tokens = String(memberList).split(LIST_SEPARATOR);
  const wholeTokens = listComplete ? tokens : tokens.slice(0, -1);
  return wholeTokens.filter(token => WHOLE_ID_TOKEN.test(token)).map(Number);
}

export function buildRelatedMeasurementIDs(memberList: string | null | undefined, listComplete: boolean, requestedMeasurementID: number): number[] {
  return parseWholeMemberIDs(memberList, listComplete).filter(id => id !== requestedMeasurementID);
}

export interface WeightedErrorRow {
  readonly errors: readonly ErrorDetailRecord[];
  readonly contradictionTypes: readonly ContradictionType[];
  readonly hasContradiction: boolean;
  readonly measurementCount: number;
}

export function parseErrorTypeKeys(errorTypeKeys: string): number[] {
  return String(errorTypeKeys).split(LIST_SEPARATOR).map(Number);
}

function signatureMergeKey(row: ErrorSignatureRow): string {
  return [String(row.ErrorTypeKeys), Number(row.SignatureComplete), Number(row.HasDuplicate), Number(row.HasSameBatch)].join('|');
}

export function mergeSignatureRows(chunks: readonly ErrorSignatureRow[][]): ErrorSignatureRow[] {
  const merged = new Map<string, ErrorSignatureRow>();
  for (const row of chunks.flat()) {
    const key = signatureMergeKey(row);
    const existing = merged.get(key);
    merged.set(key, { ...row, MeasurementCount: Number(existing?.MeasurementCount ?? 0) + Number(row.MeasurementCount) });
  }
  return Array.from(merged.values());
}

export function hasIncompleteSignature(rows: readonly ErrorSignatureRow[]): boolean {
  return rows.some(row => Number(row.SignatureComplete) !== SQL_TRUE);
}

export function findMissingErrorTypeKeys(rows: readonly ErrorSignatureRow[], catalog: ErrorTypeCatalog): number[] {
  const missing = new Set<number>();
  rows.forEach(row => parseErrorTypeKeys(row.ErrorTypeKeys).forEach(key => !catalog.recordsByKey.has(key) && missing.add(key)));
  return Array.from(missing);
}

function contradictionTypesFromFlags(hasDuplicate: boolean, hasSameBatch: boolean): ContradictionType[] {
  return [...(hasDuplicate ? [DUPLICATE_TAG_STEM] : []), ...(hasSameBatch ? [SAME_BATCH_CONFLICT] : [])];
}

export function toWeightedErrorRows(rows: readonly ErrorSignatureRow[], catalog: ErrorTypeCatalog): WeightedErrorRow[] {
  const missing = findMissingErrorTypeKeys(rows, catalog);
  if (missing.length > 0) throw new ErrorTypeCatalogMismatchError(missing, 'the histogram returned error types the catalog does not list');
  return rows.map(row => {
    const contradictionTypes = contradictionTypesFromFlags(Number(row.HasDuplicate) === SQL_TRUE, Number(row.HasSameBatch) === SQL_TRUE);
    return {
      errors: parseErrorTypeKeys(row.ErrorTypeKeys).map(key => catalog.recordsByKey.get(key) as ErrorDetailRecord),
      contradictionTypes,
      hasContradiction: contradictionTypes.length > 0,
      measurementCount: Number(row.MeasurementCount)
    };
  });
}

export function sortFacetOptions(entries: Iterable<[string, number]>): ErrorFacetOption[] {
  return Array.from(entries)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function addWeight(counts: Map<string, number>, value: string, weight: number): void {
  counts.set(value, (counts.get(value) ?? 0) + weight);
}

function weightedMessageCounts(rows: readonly WeightedErrorRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  rows.forEach(row => new Set(row.errors.map(error => error.message)).forEach(message => addWeight(counts, message, row.measurementCount)));
  return counts;
}

function totalWeight(rows: readonly WeightedErrorRow[], predicate: (row: WeightedErrorRow) => boolean = () => true): number {
  return rows.filter(predicate).reduce((total, row) => total + row.measurementCount, 0);
}

export interface ErrorMessageCounts {
  /** Distinct measurements carrying at least one unresolved error or an invalid flag. */
  totalMeasurements: number;
  messages: ErrorFacetOption[];
}

/** Today's facet math (buildErrorExplorerFacets at 8b60006b, lines 647-680) with a weight per row; search is applied by the caller. */
export function computeErrorFacets(rows: readonly WeightedErrorRow[], filters: ErrorExplorerFilters): ErrorExplorerFacetsResponse {
  const scopedRows = rows.filter(
    row =>
      (filters.source === 'all' || row.errors.some(error => error.source === filters.source)) &&
      contradictionFiltersAllow(filters, row.hasContradiction, row.contradictionTypes)
  );
  const fieldCounts = new Map<string, number>();
  scopedRows.forEach(row => new Set(row.errors.flatMap(error => error.fields)).forEach(field => addWeight(fieldCounts, field, row.measurementCount)));
  return {
    messages: sortFacetOptions(weightedMessageCounts(scopedRows).entries()),
    fields: sortFacetOptions(fieldCounts.entries()),
    sourceCounts: {
      validation: totalWeight(scopedRows, row => row.errors.some(error => error.source === 'validation')),
      ingestion: totalWeight(scopedRows, row => row.errors.some(error => error.source === 'ingestion'))
    },
    contradictionCounts: {
      duplicateTagStem: totalWeight(scopedRows, row => row.contradictionTypes.includes(DUPLICATE_TAG_STEM)),
      sameBatchConflict: totalWeight(scopedRows, row => row.contradictionTypes.includes(SAME_BATCH_CONFLICT))
    },
    totalMeasurements: totalWeight(scopedRows)
  };
}

export function computeErrorMessageCounts(rows: readonly WeightedErrorRow[]): ErrorMessageCounts {
  return { totalMeasurements: totalWeight(rows), messages: sortFacetOptions(weightedMessageCounts(rows).entries()) };
}

/**
 * True when the sorted options hold two different values with the same count that localeCompare calls equal (for
 * example NFC and NFD forms of one letter, or strings differing only in ignorable characters). The stable sort then
 * keeps encounter order, which differs between histogram rows and measurement rows, so such a response must be
 * rebuilt on the Node path to keep today's order (spec D1).
 */
export function hasLocaleCompareTie(options: readonly ErrorFacetOption[]): boolean {
  return options.some((option, index) => {
    const next = options[index + 1];
    return next !== undefined && next.count === option.count && next.value !== option.value && option.value.localeCompare(next.value) === 0;
  });
}
