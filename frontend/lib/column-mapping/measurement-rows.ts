import moment from 'moment';
import { FileRow, FormType, SourceFormat } from '@/config/macros/formdetails';
import { aliasesFor } from './fields';
import { ColumnMapping } from './types';
import { chooseEffectiveCsvMapping } from './mapping';
import { CSV_RESOLVE_OPTIONS, collapseRowWithPlan, HeaderResolutionPlan, planColumnCountMatches, resolveHeaders, transformHeaderFromPlan } from './resolution';

/**
 * The exact date-format list the client's inline `transform` uses, in priority order.
 * Ported verbatim from components/uploadsystem/segments/uploadfiresql.tsx.
 */
const DATE_FORMATS = [
  'YYYY-MM-DD',
  'MM/DD/YYYY',
  'DD/MM/YYYY',
  'YYYY/MM/DD',
  'MM-DD-YYYY',
  'DD-MM-YYYY',
  'YYYY.MM.DD',
  'MM.DD.YYYY',
  'DD.MM.YYYY',
  'MMMM DD, YYYY',
  'MMM DD, YYYY',
  'DD MMM YYYY',
  'DD MMMM YYYY',
  'YYYY-MM-DD HH:mm:ss',
  'MM/DD/YYYY HH:mm:ss',
  'DD/MM/YYYY HH:mm:ss',
  'YYYY-MM-DDTHH:mm:ss',
  'YYYY-MM-DDTHH:mm:ss.SSS',
  'YYYY-MM-DDTHH:mm:ss.SSSZ'
] as const;

const NULLISH = new Set(['NA', 'NULL', '']);
const MAX_DECIMAL = 999999.999999;
// papaparse parks the leftover cells of an over-wide row under this synthetic key (an array value).
const PARSED_EXTRA_KEY = '__parsed_extra';
// Measurement fields that must hold a number; a non-numeric value here rejects the row rather than
// being coerced (transform) or nulled — dbh/hom are optional, so nulling would silently accept bad input.
const NUMERIC_MEASUREMENT_FIELDS = ['dbh', 'hom', 'lx', 'ly'] as const;

/** A value that is present (non-nullish) but does not strictly parse as a finite number. */
function isPresentNonNumeric(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (text === '' || NULLISH.has(text)) return false;
  return !Number.isFinite(Number(text));
}

/**
 * Per-cell transform for a measurement upload. Pure port of the client's inline `transform`:
 * NA/NULL/'' collapse to null; measurement dates parse through the format list then fall back to
 * flexible parsing (returning the original string when nothing parses); lx/ly round to 6 decimals;
 * dbh/hom round to 2 decimals; everything else passes through unchanged.
 */
export function transformMeasurementValue(value: string, field: string, formType: FormType): unknown {
  const trimmed = value.trim();
  if (NULLISH.has(trimmed)) return null;

  if (formType === FormType.measurements && field === 'date') {
    for (const fmt of DATE_FORMATS) {
      const parsed = moment(trimmed, fmt, true);
      if (parsed.isValid()) return parsed.toDate();
    }
    const flexible = moment(trimmed);
    return flexible.isValid() ? flexible.toDate() : value;
  }

  // Strict numeric parsing: Number() rejects partially-numeric strings like '12.5abc' that
  // Number.parseFloat would silently truncate to 12.5. A non-numeric value is returned unchanged
  // (as a string) so validateMeasurementRow can reject the row instead of ingesting a coerced value.
  if (formType === FormType.measurements && (field === 'lx' || field === 'ly')) {
    const n = Number(trimmed);
    if (!Number.isNaN(n)) return Math.round(n * 1000000) / 1000000;
  }

  if (formType === FormType.measurements && (field === 'dbh' || field === 'hom')) {
    const n = Number(trimmed);
    if (!Number.isNaN(n)) return Math.round(n * 100) / 100;
  }

  return value;
}

export interface RowValidation {
  valid: boolean;
  failureReason?: string;
  hasExtraColumns: boolean;
}

/**
 * Row-level validation, ported from the client's inline `validateRow`. The row MUST already be
 * plan-collapsed (no `__ignored` keys) before this is called, so out-of-range values diverted to
 * ignored columns never reach the decimal-range check.
 */
export function validateMeasurementRow(row: FileRow, requiredHeaders: { label: string }[], delimiter: string, formType: FormType): RowValidation {
  const errors: string[] = [];

  const missing = requiredHeaders.filter(h => {
    const v = row[h.label];
    return v === null || v === '' || v === 'NA' || v === 'NULL' || v === undefined;
  });
  if (missing.length > 0) {
    errors.push(`Missing required fields: ${missing.map(f => f.label).join(', ')}`);
  }

  const hasExtraColumns = row['__parsed_extra'] !== undefined;

  if (formType === FormType.measurements) {
    const tag = row.tag;
    const stemtag = row.stemtag;
    if (tag && stemtag) {
      const tagText = String(tag);
      const stemTagText = String(stemtag);
      if (tagText.includes(delimiter) || stemTagText.includes(delimiter)) {
        errors.push(`Tag values contain delimiter character "${delimiter}": tag="${tagText}", stemtag="${stemTagText}". This suggests parsing error.`);
      }
      if (tagText.length > 50 || stemTagText.length > 50) {
        errors.push(
          `Unusually long tag values detected: tag="${tagText.slice(0, 30)}...", stemtag="${stemTagText.slice(0, 30)}...". This may indicate concatenated fields due to parsing error.`
        );
      }
    }

    // A numeric measurement field that is present but not strictly numeric must reject the row.
    for (const field of NUMERIC_MEASUREMENT_FIELDS) {
      if (isPresentNonNumeric(row[field])) {
        errors.push(`Non-numeric value for ${field}: ${String(row[field])}`);
      }
    }

    // After transform a valid date is a Date; an unparseable one survives as a non-empty string.
    // FileRow types values as string|null, but transformMeasurementValue stores a real Date here.
    const dateValue: unknown = row.date;
    if (dateValue !== null && dateValue !== undefined && !(dateValue instanceof Date)) {
      const dateText = String(dateValue).trim();
      if (dateText !== '' && !NULLISH.has(dateText)) {
        errors.push(`Unparseable date value: ${dateText}`);
      }
    }
  }

  for (const [key, value] of Object.entries(row)) {
    if (value !== null && value !== undefined && !['tag', 'stemtag'].includes(key)) {
      const num = Number.parseFloat(String(value));
      if (!Number.isNaN(num) && (num < 0 || num > MAX_DECIMAL)) {
        errors.push(`Decimal value for ${key} is out of range: ${value}`);
      }
    }
  }

  return { valid: errors.length === 0, failureReason: errors.length ? errors.join('|') : undefined, hasExtraColumns };
}

export interface MeasurementChunkResult {
  validRows: FileRow[];
  invalidRows: FileRow[];
  plan: HeaderResolutionPlan | null;
  columnCountMismatch: boolean;
  diagnostics: { invalidDateValues: string[]; extraColumnRows: number; ignoredColumnCount: number };
}

export interface ResolveChunkOptions {
  formType: FormType;
  uploadMode: 'revisions' | 'other';
  delimiter: string;
  requiredHeaders: { label: string }[];
  csvHeaders: string[];
  storedMapping?: ColumnMapping;
}

/**
 * Resolve one chunk of raw parsed CSV rows into validated measurement rows. Owns the chunk-level
 * header resolution: it builds a single resolution plan, rejects the whole chunk on a column-count
 * mismatch, then per-row keys, transforms, collapses, and validates. Collapsing happens BEFORE
 * validation so ignored source columns never reach the range check.
 */
export function resolveMeasurementChunk(rawRows: Record<string, string>[], parsedFieldCount: number, options: ResolveChunkOptions): MeasurementChunkResult {
  const { formType, uploadMode, delimiter, requiredHeaders, csvHeaders, storedMapping } = options;

  const mappingFlow = formType === FormType.measurements && uploadMode !== 'revisions' && csvHeaders.length > 0;
  const plan = mappingFlow
    ? resolveHeaders(csvHeaders, chooseEffectiveCsvMapping(storedMapping, csvHeaders).mapping, aliasesFor(SourceFormat.csv), CSV_RESOLVE_OPTIONS)
    : null;

  const ignoredColumnCount = plan ? plan.ignoredKeys.size : 0;

  if (plan && !planColumnCountMatches(plan, parsedFieldCount)) {
    return { validRows: [], invalidRows: [], plan, columnCountMismatch: true, diagnostics: { invalidDateValues: [], extraColumnRows: 0, ignoredColumnCount } };
  }

  const keyOf = plan ? transformHeaderFromPlan(plan) : (h: string) => h;
  const validRows: FileRow[] = [];
  const invalidRows: FileRow[] = [];
  const invalidDateValues: string[] = [];
  let extraColumnRows = 0;

  // Key one parsed row's entries positionally through the active plan (or identity when plan-less),
  // applying the per-cell measurement transform and recording unparseable dates as we go.
  const keyEntries = (entries: [string, string][]): FileRow => {
    const keyed: FileRow = {};
    entries.forEach(([rawKey, rawVal], index) => {
      const key = keyOf(rawKey, index);
      const transformed = transformMeasurementValue((rawVal ?? '').toString(), key, formType);
      if (formType === FormType.measurements && key === 'date' && typeof transformed === 'string' && (rawVal ?? '') !== '') {
        invalidDateValues.push(String(rawVal));
      }
      keyed[key] = transformed as string | null;
    });
    return keyed;
  };

  for (const rawRow of rawRows) {
    const allEntries = Object.entries(rawRow) as [string, string][];

    if (plan) {
      // Server-authoritative mapping path: the plan keys parsed rows BY POSITION, so it is only valid
      // when the parsed row width matches the plan. papaparse signals an over-wide line with a trailing
      // `__parsed_extra` array and an under-wide line by omitting trailing header keys. Both are
      // malformed lines: reject them here rather than mis-key (which previously injected a normalized
      // `__parsed_extra` column straight into the upload).
      const hasExtraCells = Object.prototype.hasOwnProperty.call(rawRow, PARSED_EXTRA_KEY);
      const entries = allEntries.filter(([rawKey]) => rawKey !== PARSED_EXTRA_KEY);
      const collapsed = collapseRowWithPlan(keyEntries(entries), plan);

      if (hasExtraCells || entries.length < plan.outputKeys.length) {
        if (hasExtraCells) extraColumnRows += 1;
        const failureReason = hasExtraCells
          ? `Row has too many columns: expected ${plan.outputKeys.length} but the parsed line carried extra delimited values`
          : `Row has too few columns: expected ${plan.outputKeys.length}, found ${entries.length}`;
        invalidRows.push({ ...collapsed, failureReason });
        continue;
      }

      const result = validateMeasurementRow(collapsed, requiredHeaders, delimiter, formType);
      if (result.valid) validRows.push(collapsed);
      else invalidRows.push({ ...collapsed, failureReason: result.failureReason ?? 'Unknown error' });
      continue;
    }

    // Plan-less (revisions) path: unchanged — raw keys survive and __parsed_extra is counted, not rejected.
    const keyed = keyEntries(allEntries);
    const result = validateMeasurementRow(keyed, requiredHeaders, delimiter, formType);
    if (result.hasExtraColumns) extraColumnRows += 1;
    if (result.valid) validRows.push(keyed);
    else invalidRows.push({ ...keyed, failureReason: result.failureReason ?? 'Unknown error' });
  }

  return { validRows, invalidRows, plan, columnCountMismatch: false, diagnostics: { invalidDateValues, extraColumnRows, ignoredColumnCount } };
}
