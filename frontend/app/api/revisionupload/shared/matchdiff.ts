import type ConnectionManager from '@/config/connectionmanager';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { FileRow } from '@/config/macros/formdetails';
import { canonicalizeRowForHash, RowMode } from '@/config/editplan/canonicalrow';

export const UPDATABLE_FIELDS = ['dbh', 'hom', 'date', 'codes', 'comments', 'spcode', 'quadrat', 'lx', 'ly', 'tag', 'stemtag'] as const;

export type UpdatableField = (typeof UPDATABLE_FIELDS)[number];
export type MatchStrategy = 'stemid' | 'tag_stemtag';

/**
 * Kind of DB value we're comparing against — controls how we normalize both
 * sides before the equality check.
 *
 * `numeric` parses both sides as floats and compares numerically (used for
 * `dbh`, `hom`, `lx`, `ly`).
 *
 * `numeric-or-string-ci` normalizes purely digit strings by stripping leading
 * zeros before comparing them; otherwise falls back to case-insensitive string
 * equality. Tolerates leading-zero stripping when a researcher opens the CSV
 * in Numbers or Excel — those apps coerce `'0101'` to `'101'` on save,
 * producing fake change warnings on otherwise unchanged rows without risking
 * numeric precision loss on long identifiers (used for `tag`, `stemtag`,
 * `quadrat`).
 *
 * `string-ci` is case-insensitive string equality (used for `spcode`).
 *
 * `string-exact` is exact string equality after trimming (used for `codes`
 * and `comments`).
 *
 * `date` normalizes the DB value to a YYYY-MM-DD string before comparing
 * (used for `date`).
 */
export type FieldCompareKind = 'numeric' | 'string-ci' | 'numeric-or-string-ci' | 'string-exact' | 'date';

export interface FieldDescriptor {
  dbProperty: keyof ExistingMeasurementRow;
  compareKind: FieldCompareKind;
}

export const FIELD_DESCRIPTORS: Record<UpdatableField, FieldDescriptor> = {
  dbh: { dbProperty: 'MeasuredDBH', compareKind: 'numeric' },
  hom: { dbProperty: 'MeasuredHOM', compareKind: 'numeric' },
  date: { dbProperty: 'MeasurementDate', compareKind: 'date' },
  codes: { dbProperty: 'RawCodes', compareKind: 'string-exact' },
  comments: { dbProperty: 'Description', compareKind: 'string-exact' },
  spcode: { dbProperty: 'SpeciesCode', compareKind: 'string-ci' },
  quadrat: { dbProperty: 'QuadratName', compareKind: 'numeric-or-string-ci' },
  lx: { dbProperty: 'LocalX', compareKind: 'numeric' },
  ly: { dbProperty: 'LocalY', compareKind: 'numeric' },
  tag: { dbProperty: 'TreeTag', compareKind: 'numeric-or-string-ci' },
  stemtag: { dbProperty: 'StemTag', compareKind: 'numeric-or-string-ci' }
};

export interface ExistingMeasurementRow {
  CoreMeasurementID: number;
  StemGUID: number | null;
  IsActive: number;
  MeasuredDBH: number | null;
  MeasuredHOM: number | null;
  MeasurementDate: Date | string | null;
  RawCodes: string | null;
  Description: string | null;
  RawTreeTag: string | null;
  RawStemTag: string | null;
  StemIsActive: number | null;
  TreeIsActive: number | null;
  QuadratIsActive: number | null;
  PlotID: number | null;
  TreeTag: string | null;
  StemTag: string | null;
  SpeciesCode: string | null;
  QuadratName: string | null;
  LocalX: number | string | null;
  LocalY: number | string | null;
}

export const LOOKUP_CHUNK_SIZE = 1000;
export const TAG_STEMTAG_LOOKUP_CHUNK_SIZE = 250;

const MEASUREMENT_SELECT = `cm.CoreMeasurementID, cm.StemGUID, cm.IsActive, cm.MeasuredDBH, cm.MeasuredHOM,
              cm.MeasurementDate, cm.RawCodes, cm.Description, cm.RawTreeTag, cm.RawStemTag,
              st.IsActive AS StemIsActive, t.IsActive AS TreeIsActive, q.IsActive AS QuadratIsActive,
              q.PlotID, t.TreeTag, st.StemTag,
              sp.SpeciesCode, q.QuadratName, st.LocalX, st.LocalY`;

const MEASUREMENT_JOINS = `??.coremeasurements cm
       LEFT JOIN ??.stems st ON st.StemGUID = cm.StemGUID
       LEFT JOIN ??.trees t ON t.TreeID = st.TreeID
       LEFT JOIN ??.quadrats q ON q.QuadratID = st.QuadratID
       LEFT JOIN ??.species sp ON sp.SpeciesID = t.SpeciesID`;

export function isBlankOrNullPlaceholder(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  const trimmed = String(value).trim();
  return trimmed === '' || trimmed.toUpperCase() === 'NULL';
}

export function normalizeDateToString(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function areEquivalentNumericValues(csvValue: string, dbValue: unknown): boolean {
  const parsedCsvValue = Number.parseFloat(csvValue);
  const parsedDbValue = typeof dbValue === 'number' ? dbValue : Number.parseFloat(String(dbValue ?? ''));
  return Number.isFinite(parsedCsvValue) && Number.isFinite(parsedDbValue) && parsedCsvValue === parsedDbValue;
}

/**
 * Tag/stemtag/quadrat values are tolerant of leading-zero stripping (Excel
 * coerces `'0101'` to `'101'` on round-trip). When both sides are pure digits,
 * we compare them after stripping leading zeros so spreadsheet round-trips
 * don't surface phantom changes. Returns null when either side isn't a pure
 * digit string, signaling the caller to fall back to case-insensitive string
 * equality.
 */
function normalizeDigitString(value: string): string | null {
  if (!/^\d+$/.test(value)) return null;
  const normalized = value.replace(/^0+/, '');
  return normalized === '' ? '0' : normalized;
}

function areEquivalentAsDigitStrings(csvNormalized: string, dbNormalized: string): boolean {
  const normalizedCsv = normalizeDigitString(csvNormalized);
  const normalizedDb = normalizeDigitString(dbNormalized);
  return normalizedCsv !== null && normalizedDb !== null && normalizedCsv === normalizedDb;
}

export function fieldValuesAreEquivalent(compareKind: FieldCompareKind, csvValue: unknown, dbValue: unknown): boolean {
  const csvNormalized = String(csvValue).trim();
  const dbNormalized = String(dbValue ?? '').trim();

  switch (compareKind) {
    case 'numeric':
      return areEquivalentNumericValues(csvNormalized, dbValue);
    case 'date':
      return csvNormalized === dbNormalized;
    case 'string-exact':
      return csvNormalized === dbNormalized;
    case 'string-ci':
      return csvNormalized.toLowerCase() === dbNormalized.toLowerCase();
    case 'numeric-or-string-ci':
      return areEquivalentAsDigitStrings(csvNormalized, dbNormalized) || csvNormalized.toLowerCase() === dbNormalized.toLowerCase();
  }
}

export function readDbValueForDisplay(field: UpdatableField, dbRow: ExistingMeasurementRow): unknown {
  const descriptor = FIELD_DESCRIPTORS[field];
  if (descriptor.compareKind === 'date') {
    return normalizeDateToString(dbRow.MeasurementDate as Date | string | null);
  }
  const raw = dbRow[descriptor.dbProperty];
  // Stringify numeric DB values for the `from` slot so consumers (UI,
  // BulkEditPlan effects) see a stable shape across row-local and identity
  // edits. The actual equality check still happens via fieldValuesAreEquivalent.
  if (typeof raw === 'number') return String(raw);
  return raw;
}

/**
 * Per-field diff of CSV vs current DB values, applying the revision-upload
 * tolerances: NULL/blank cells count as "no change", spcode is case-insensitive,
 * and tag/stemtag/quadrat tolerate leading-zero stripping. Output keys are the
 * lowercase aliases used in `UPDATABLE_FIELDS` so the analyzer/apply path can
 * feed them back through `canonicalizeRowForHash` for canonical-name mapping.
 */
export function computeDiff(csvRow: FileRow, dbRow: ExistingMeasurementRow): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const field of UPDATABLE_FIELDS) {
    const csvValue = csvRow[field];
    if (isBlankOrNullPlaceholder(csvValue)) continue;

    const descriptor = FIELD_DESCRIPTORS[field];
    const dbValue = readDbValueForDisplay(field, dbRow);

    if (fieldValuesAreEquivalent(descriptor.compareKind, csvValue, dbValue)) continue;

    changes[field] = { from: dbValue, to: csvValue };
  }

  return changes;
}

/**
 * Builds an analyzer-side `newRow` from the diff output rather than the raw
 * CSV row. This keeps revision-upload semantics single-sourced: the analyzer
 * and apply paths only see fields that `computeDiff` flagged as genuine
 * changes — NULL placeholders, leading-zero round-trips, and case-insensitive
 * spcode no-ops are filtered out before they reach `canonicalizeEditPayload`,
 * which would otherwise reject them as `invalid clear` (identity fields) or
 * surface them as fake bulk-plan changes.
 */
export function buildAnalyzerRowFromChanges(
  changes: Record<string, { from: unknown; to: unknown }>,
  mode: RowMode = 'revision-update'
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [field, change] of Object.entries(changes)) {
    row[field] = change.to;
  }
  return canonicalizeRowForHash(row, mode);
}

/**
 * A measurement row is "resolvable" when the coremeasurement, its stem, its
 * tree, its quadrat are all active and the quadrat lives in the supplied
 * plot. Both the classify-time match filter and the apply-time TOCTOU check
 * use the same predicate so divergence between the two paths is impossible.
 */
export function isResolvableMeasurement(row: ExistingMeasurementRow, plotID: number): boolean {
  return row.IsActive === 1 && row.StemGUID !== null && row.StemIsActive === 1 && row.TreeIsActive === 1 && row.QuadratIsActive === 1 && row.PlotID === plotID;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function groupRowsByStemID(rows: ExistingMeasurementRow[]): Map<string, ExistingMeasurementRow[]> {
  const grouped = new Map<string, ExistingMeasurementRow[]>();
  for (const row of rows) {
    if (row.StemGUID === null) continue;
    const key = String(row.StemGUID);
    const existing = grouped.get(key) ?? [];
    existing.push(row);
    grouped.set(key, existing);
  }
  return grouped;
}

function buildTagStemKeyForDbRow(row: ExistingMeasurementRow): string | null {
  const tag = row.TreeTag ?? row.RawTreeTag;
  const stemTag = row.StemTag ?? row.RawStemTag;
  if (tag === null || tag === undefined || stemTag === null || stemTag === undefined) return null;
  const tagPart = String(tag).trim().toLowerCase();
  const stemPart = String(stemTag).trim().toLowerCase();
  if (!tagPart || !stemPart) return null;
  return `${tagPart}::${stemPart}`;
}

function groupRowsByTagStemKey(rows: ExistingMeasurementRow[]): Map<string, ExistingMeasurementRow[]> {
  const grouped = new Map<string, ExistingMeasurementRow[]>();
  for (const row of rows) {
    const key = buildTagStemKeyForDbRow(row);
    if (!key) continue;
    const existing = grouped.get(key) ?? [];
    existing.push(row);
    grouped.set(key, existing);
  }
  return grouped;
}

export async function loadMeasurementsByStemID(
  connectionManager: ConnectionManager,
  schema: string,
  censusID: number,
  stemIDs: number[],
  transactionID?: string
): Promise<Map<string, ExistingMeasurementRow[]>> {
  const grouped = new Map<string, ExistingMeasurementRow[]>();

  for (const chunk of chunkArray(stemIDs, LOOKUP_CHUNK_SIZE)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const query = safeFormatQuery(
      schema,
      `SELECT ${MEASUREMENT_SELECT}
       FROM ${MEASUREMENT_JOINS}
       WHERE cm.CensusID = ?
         AND cm.StemGUID IN (${placeholders})`
    );

    const rows = (await connectionManager.executeQuery(query, [censusID, ...chunk], transactionID)) as ExistingMeasurementRow[];
    const chunkGrouped = groupRowsByStemID(rows);
    chunkGrouped.forEach((value, key) => {
      const existing = grouped.get(key) ?? [];
      grouped.set(key, [...existing, ...value]);
    });
  }

  return grouped;
}

export async function loadMeasurementsByTagStemTag(
  connectionManager: ConnectionManager,
  schema: string,
  censusID: number,
  keys: Array<{ tag: string; stemtag: string }>,
  transactionID?: string
): Promise<Map<string, ExistingMeasurementRow[]>> {
  const grouped = new Map<string, ExistingMeasurementRow[]>();

  for (const chunk of chunkArray(keys, TAG_STEMTAG_LOOKUP_CHUNK_SIZE)) {
    const conditions = chunk
      .map(() => `(LOWER(TRIM(COALESCE(t.TreeTag, cm.RawTreeTag, ''))) = ? AND LOWER(TRIM(COALESCE(st.StemTag, cm.RawStemTag, ''))) = ?)`)
      .join(' OR ');

    const params = [censusID, ...chunk.flatMap(key => [key.tag, key.stemtag])];
    const query = safeFormatQuery(
      schema,
      `SELECT ${MEASUREMENT_SELECT}
       FROM ${MEASUREMENT_JOINS}
       WHERE cm.CensusID = ?
         AND (${conditions})`
    );

    const rows = (await connectionManager.executeQuery(query, params, transactionID)) as ExistingMeasurementRow[];
    const chunkGrouped = groupRowsByTagStemKey(rows);
    chunkGrouped.forEach((value, key) => {
      const existing = grouped.get(key) ?? [];
      grouped.set(key, [...existing, ...value]);
    });
  }

  return grouped;
}

/**
 * Apply-time lookup: load ExistingMeasurementRow shape keyed by
 * CoreMeasurementID for matched rows. Used to recompute the diff against live
 * DB state inside the apply transaction so plan-hash drift is detected and
 * the analyzer/writer payloads stay in lockstep with `computeDiff` semantics.
 */
export async function loadMeasurementsByCoreID(
  connectionManager: ConnectionManager,
  schema: string,
  censusID: number,
  coreMeasurementIDs: number[],
  transactionID?: string
): Promise<Map<number, ExistingMeasurementRow>> {
  const result = new Map<number, ExistingMeasurementRow>();
  if (coreMeasurementIDs.length === 0) return result;

  for (const chunk of chunkArray(coreMeasurementIDs, LOOKUP_CHUNK_SIZE)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const query = safeFormatQuery(
      schema,
      `SELECT ${MEASUREMENT_SELECT}
       FROM ${MEASUREMENT_JOINS}
       WHERE cm.CensusID = ?
         AND cm.CoreMeasurementID IN (${placeholders})`
    );

    const rows = (await connectionManager.executeQuery(query, [censusID, ...chunk], transactionID)) as ExistingMeasurementRow[];
    for (const row of rows) {
      result.set(row.CoreMeasurementID, row);
    }
  }

  return result;
}
