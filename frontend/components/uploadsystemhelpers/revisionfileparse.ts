import { FileRow } from '@/config/macros/formdetails';

const HEADER_ALIASES: Record<string, string> = {
  stemguid: 'stemid',
  stemid: 'stemid',
  treetag: 'tag',
  tag: 'tag',
  stemtag: 'stemtag',
  measureddbh: 'dbh',
  dbh: 'dbh',
  measuredhom: 'hom',
  hom: 'hom',
  measurementdate: 'date',
  date: 'date',
  speciescode: 'spcode',
  spcode: 'spcode',
  quadratname: 'quadrat',
  quadrat: 'quadrat',
  stemlocalx: 'lx',
  localx: 'lx',
  lx: 'lx',
  stemlocaly: 'ly',
  localy: 'ly',
  ly: 'ly',
  description: 'comments',
  comments: 'comments',
  rawcodes: 'rawcodes',
  attributes: 'attributes',
  codes: 'codes'
};

function normalizeHeaderKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[_\s-]/g, '');
}

function normalizeCellValue(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  return value.trim().toUpperCase() === 'NULL' ? null : value;
}

function pickPreferredCodesValue(row: FileRow): string | null {
  const candidates = [row['codes'], row['rawcodes'], row['attributes']];

  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && String(candidate).trim() !== '') {
      return candidate;
    }
  }

  return null;
}

/**
 * Normalizes revision upload headers into canonical short-form keys.
 *
 * Exported app CSVs and canonical revision templates are both supported.
 * Unknown headers are left as normalized lowercase keys so they can pass
 * through the parser and be ignored later by revision diff logic.
 */
export function normalizeRevisionHeader(header: string): string {
  const normalized = normalizeHeaderKey(header);
  return HEADER_ALIASES[normalized] ?? normalized;
}

/**
 * Canonicalizes a parsed revision row after Papa Parse has applied
 * transformHeader().
 *
 * This collapses multiple accepted codes columns into the single Phase 1
 * `codes` field, preferring raw export codes when both are present, and turns
 * the app export's literal "NULL" placeholders back into null.
 */
export function canonicalizeRevisionRow(row: FileRow): FileRow {
  const normalizedRow = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeCellValue(value)])) as FileRow;
  const preferredCodes = pickPreferredCodesValue(normalizedRow);

  return {
    ...normalizedRow,
    codes: preferredCodes
  };
}
