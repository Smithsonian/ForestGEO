import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import ConnectionManager from '@/config/connectionmanager';
import { isValidSchema, safeFormatQuery } from '@/config/utils/sqlsecurity';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { FileRow } from '@/config/macros/formdetails';
import { RevisionInvalidRow, RevisionMatchedRow, RevisionNewRowCandidate, RevisionUploadResponse } from '@/config/revisionuploadtypes';
import { analyzeBulk, BulkInput } from '@/config/editplan/bulkanalyzer';
import { assertCanEditMeasurementScope, ScopeAccessError, ScopeBusyError } from '@/config/editplan/scopeguard';
import { assertSessionMayEdit, PendingUserEditForbiddenError } from '@/config/editplan/authorization';
import { applyRevisionRolePolicy, RevisionRoleFieldCandidate } from '@/config/editplan/revisionrolepolicy';
import { canonicalizeRowForHash } from '@/config/editplan/canonicalrow';
import { DuplicateDeletion } from '@/config/editplan/types';

export const runtime = 'nodejs';

/**
 * Bulk-revision update surface (Phase 2): all 11 editable measurement fields,
 * matching the single-row PATCH path. Identity edits (`spcode`, `tag`,
 * `stemtag`, `quadrat`, `lx`, `ly`) are flagged in `changes` and propagated
 * into `analyzeBulk`, so the bulk plan surfaces R1a/R2/R3/R4 effects (species
 * re-link, tree/stem reassignment, coordinate cross-row propagation) in
 * addition to the row-local R5/R6 effects from Phase 1.
 */
const UPDATABLE_FIELDS = ['dbh', 'hom', 'date', 'codes', 'comments', 'spcode', 'quadrat', 'lx', 'ly', 'tag', 'stemtag'] as const;
const REQUIRED_INSERT_FIELDS = ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date'] as const;
const LOOKUP_CHUNK_SIZE = 1000;
const TAG_STEMTAG_LOOKUP_CHUNK_SIZE = 250;

type UpdatableField = (typeof UPDATABLE_FIELDS)[number];
type MatchStrategy = 'stemid' | 'tag_stemtag';

/**
 * Kind of DB value we're comparing against — controls how we normalize both
 * sides before the equality check.
 *
 * `numeric` parses both sides as floats and compares numerically (used for
 * `dbh`, `hom`, `lx`, `ly`).
 *
 * `numeric-or-string-ci` normalizes purely digit strings by stripping leading
 * zeros before comparing them; otherwise it falls back to case-insensitive
 * string equality. This tolerates leading-zero stripping when a researcher
 * opens the CSV in Numbers or Excel — those apps coerce `'0101'` to `'101'`
 * on save, producing fake change warnings on otherwise unchanged rows
 * without risking numeric precision loss on long identifiers (used for
 * `tag`, `stemtag`, `quadrat`).
 *
 * `string-ci` is case-insensitive string equality (used for `spcode`).
 *
 * `string-exact` is exact string equality after trimming (used for `codes`
 * and `comments`).
 *
 * `date` normalizes the DB value to a YYYY-MM-DD string before comparing
 * (used for `date`).
 */
type FieldCompareKind = 'numeric' | 'string-ci' | 'numeric-or-string-ci' | 'string-exact' | 'date';

interface FieldDescriptor {
  dbProperty: keyof ExistingMeasurementRow;
  compareKind: FieldCompareKind;
}

const FIELD_DESCRIPTORS: Record<UpdatableField, FieldDescriptor> = {
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

class RevisionUploadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevisionUploadRequestError';
  }
}

interface ExistingMeasurementRow {
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

interface RevisionUploadFileRequest {
  fileName?: string;
  rows: FileRow[];
}

interface RevisionUploadRequest {
  rows?: FileRow[];
  files?: RevisionUploadFileRequest[];
  plotID: number | string;
  censusID: number | string;
  schema: string;
}

interface IndexedFileRow {
  csvRow: FileRow;
  csvIndex: number;
}

interface ResolutionCandidate extends IndexedFileRow {
  key: string;
  stemID?: number;
  tag?: string;
  stemtag?: string;
}

interface NormalizedRequestFile {
  fileName: string;
  rows: FileRow[];
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }

    const parsed = Number.parseInt(trimmed, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function normalizeNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeTagStemKeyPart(value: unknown): string | null {
  const normalized = normalizeNullableString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function buildTagStemKey(tag: unknown, stemtag: unknown): string | null {
  const normalizedTag = normalizeTagStemKeyPart(tag);
  const normalizedStemTag = normalizeTagStemKeyPart(stemtag);

  if (!normalizedTag || !normalizedStemTag) {
    return null;
  }

  return `${normalizedTag}::${normalizedStemTag}`;
}

function getDerivedDbTagStemKey(row: ExistingMeasurementRow): string | null {
  return buildTagStemKey(row.TreeTag ?? row.RawTreeTag, row.StemTag ?? row.RawStemTag);
}

function normalizeDateToString(value: Date | string | null): string | null {
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

function isBlankOrNullPlaceholder(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  const trimmed = String(value).trim();
  return trimmed === '' || trimmed.toUpperCase() === 'NULL';
}

function buildRevisionRoleFieldCandidates(matchedRows: RevisionMatchedRow[], newRows: RevisionNewRowCandidate[]): RevisionRoleFieldCandidate[] {
  const candidates: RevisionRoleFieldCandidate[] = [];
  matchedRows.forEach((row, index) => {
    if (row.changes?.spcode) {
      candidates.push({ rowIndex: index, field: 'spcode' });
    }
  });
  for (const row of newRows) {
    if (!isBlankOrNullPlaceholder(row.csvRow.spcode)) {
      candidates.push({ rowIndex: row.csvIndex, field: 'spcode' });
    }
  }
  return candidates;
}

/**
 * Tag/stemtag/quadrat values are tolerant of leading-zero stripping (Excel
 * coerces `'0101'` to `'101'` on round-trip). When both sides are pure
 * digits, we compare them after stripping leading zeros so spreadsheet
 * round-trips don't surface phantom changes. Returns null when either side
 * isn't a pure digit string, signaling the caller to fall back to
 * case-insensitive string equality.
 */
function normalizeDigitString(value: string): string | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const normalized = value.replace(/^0+/, '');
  return normalized === '' ? '0' : normalized;
}

function areEquivalentAsDigitStrings(csvNormalized: string, dbNormalized: string): boolean {
  const normalizedCsv = normalizeDigitString(csvNormalized);
  const normalizedDb = normalizeDigitString(dbNormalized);
  return normalizedCsv !== null && normalizedDb !== null && normalizedCsv === normalizedDb;
}

function fieldValuesAreEquivalent(compareKind: FieldCompareKind, csvValue: unknown, dbValue: unknown): boolean {
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

function readDbValueForDisplay(field: UpdatableField, dbRow: ExistingMeasurementRow): unknown {
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

function computeDiff(csvRow: FileRow, dbRow: ExistingMeasurementRow): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const field of UPDATABLE_FIELDS) {
    const csvValue = csvRow[field];
    if (isBlankOrNullPlaceholder(csvValue)) {
      continue;
    }

    const descriptor = FIELD_DESCRIPTORS[field];
    const dbValue = readDbValueForDisplay(field, dbRow);

    if (fieldValuesAreEquivalent(descriptor.compareKind, csvValue, dbValue)) {
      continue;
    }

    changes[field] = { from: dbValue, to: csvValue };
  }

  return changes;
}

function detectMatchStrategy(rows: IndexedFileRow[], fileName: string): MatchStrategy {
  if (rows.length === 0) {
    throw new RevisionUploadRequestError(`Revision file "${fileName}" is empty and cannot be matched`);
  }

  const headers = new Set(rows.flatMap(row => Object.keys(row.csvRow)));
  const hasStemIDHeader = headers.has('stemid');
  const hasStemIDValues = rows.some(row => normalizeNullableString(row.csvRow['stemid']) !== null);

  if (hasStemIDHeader && hasStemIDValues) {
    return 'stemid';
  }

  if (headers.has('tag') && headers.has('stemtag')) {
    return 'tag_stemtag';
  }

  throw new RevisionUploadRequestError(`Revision file "${fileName}" must include stemid values or both tag and stemtag headers`);
}

function buildResolutionCandidates(rows: IndexedFileRow[], strategy: MatchStrategy): { candidates: ResolutionCandidate[]; invalidRows: RevisionInvalidRow[] } {
  const firstSeen = new Map<string, ResolutionCandidate>();
  const duplicateKeys = new Set<string>();
  const invalidRows: RevisionInvalidRow[] = [];
  const acceptedRows: ResolutionCandidate[] = [];

  for (const row of rows) {
    if (strategy === 'stemid') {
      const parsedStemID = parsePositiveInteger(row.csvRow['stemid']);
      if (parsedStemID === null) {
        const rawStemID = normalizeNullableString(row.csvRow['stemid']);
        invalidRows.push({
          csvRow: row.csvRow,
          csvIndex: row.csvIndex,
          reason: rawStemID === null ? 'missing stemid' : `invalid stemid "${rawStemID}"`
        });
        continue;
      }

      const candidate: ResolutionCandidate = {
        ...row,
        key: String(parsedStemID),
        stemID: parsedStemID
      };
      acceptedRows.push(candidate);
      if (firstSeen.has(candidate.key)) {
        duplicateKeys.add(candidate.key);
      } else {
        firstSeen.set(candidate.key, candidate);
      }
      continue;
    }

    const key = buildTagStemKey(row.csvRow['tag'], row.csvRow['stemtag']);
    if (!key) {
      invalidRows.push({
        csvRow: row.csvRow,
        csvIndex: row.csvIndex,
        reason: 'missing tag/stemtag'
      });
      continue;
    }

    const candidate: ResolutionCandidate = {
      ...row,
      key,
      tag: normalizeTagStemKeyPart(row.csvRow['tag']) ?? undefined,
      stemtag: normalizeTagStemKeyPart(row.csvRow['stemtag']) ?? undefined
    };
    acceptedRows.push(candidate);
    if (firstSeen.has(candidate.key)) {
      duplicateKeys.add(candidate.key);
    } else {
      firstSeen.set(candidate.key, candidate);
    }
  }

  const candidates: ResolutionCandidate[] = [];
  for (const candidate of acceptedRows) {
    if (duplicateKeys.has(candidate.key)) {
      invalidRows.push({
        csvRow: candidate.csvRow,
        csvIndex: candidate.csvIndex,
        reason: buildDuplicateKeyReason(strategy, candidate)
      });
      continue;
    }

    candidates.push(candidate);
  }

  return {
    candidates: candidates.sort((left, right) => left.csvIndex - right.csvIndex),
    invalidRows
  };
}

function buildDuplicateKeyReason(strategy: MatchStrategy, candidate: ResolutionCandidate): string {
  if (strategy === 'stemid') {
    return `duplicate stemid ${candidate.stemID} appears in multiple rows of the same file; each stemid must appear at most once`;
  }

  return `duplicate tag+stemtag "${candidate.tag}/${candidate.stemtag}" appears in multiple rows of the same file; each tag+stemtag must appear at most once`;
}

function groupRowsByKey(rows: ExistingMeasurementRow[], strategy: MatchStrategy): Map<string, ExistingMeasurementRow[]> {
  const grouped = new Map<string, ExistingMeasurementRow[]>();

  for (const row of rows) {
    const key = strategy === 'stemid' ? (row.StemGUID !== null ? String(row.StemGUID) : null) : getDerivedDbTagStemKey(row);
    if (!key) {
      continue;
    }

    const existing = grouped.get(key) ?? [];
    existing.push(row);
    grouped.set(key, existing);
  }

  return grouped;
}

function isResolvableMeasurement(row: ExistingMeasurementRow, plotID: number): boolean {
  return row.IsActive === 1 && row.StemGUID !== null && row.StemIsActive === 1 && row.TreeIsActive === 1 && row.QuadratIsActive === 1 && row.PlotID === plotID;
}

function buildExistingValues(row: ExistingMeasurementRow): RevisionMatchedRow['existingValues'] {
  return {
    measuredDBH: row.MeasuredDBH,
    measuredHOM: row.MeasuredHOM,
    measurementDate: normalizeDateToString(row.MeasurementDate as Date | string | null),
    rawCodes: row.RawCodes,
    description: row.Description
  };
}

function getMissingRequiredInsertFields(csvRow: FileRow): string[] {
  return REQUIRED_INSERT_FIELDS.filter(field => normalizeNullableString(csvRow[field]) === null);
}

async function loadMeasurementsByStemID(
  connectionManager: ConnectionManager,
  schema: string,
  censusID: number,
  stemIDs: number[]
): Promise<Map<string, ExistingMeasurementRow[]>> {
  const groupedRows = new Map<string, ExistingMeasurementRow[]>();

  for (const chunk of chunkArray(stemIDs, LOOKUP_CHUNK_SIZE)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const query = safeFormatQuery(
      schema,
      `SELECT cm.CoreMeasurementID, cm.StemGUID, cm.IsActive, cm.MeasuredDBH, cm.MeasuredHOM,
              cm.MeasurementDate, cm.RawCodes, cm.Description, cm.RawTreeTag, cm.RawStemTag,
              st.IsActive AS StemIsActive, t.IsActive AS TreeIsActive, q.IsActive AS QuadratIsActive,
              q.PlotID, t.TreeTag, st.StemTag,
              sp.SpeciesCode, q.QuadratName, st.LocalX, st.LocalY
       FROM ??.coremeasurements cm
       LEFT JOIN ??.stems st ON st.StemGUID = cm.StemGUID
       LEFT JOIN ??.trees t ON t.TreeID = st.TreeID
       LEFT JOIN ??.quadrats q ON q.QuadratID = st.QuadratID
       LEFT JOIN ??.species sp ON sp.SpeciesID = t.SpeciesID
       WHERE cm.CensusID = ?
         AND cm.StemGUID IN (${placeholders})`
    );

    const rows = (await connectionManager.executeQuery(query, [censusID, ...chunk])) as ExistingMeasurementRow[];
    const chunkGrouped = groupRowsByKey(rows, 'stemid');
    chunkGrouped.forEach((value, key) => {
      const existing = groupedRows.get(key) ?? [];
      groupedRows.set(key, [...existing, ...value]);
    });
  }

  return groupedRows;
}

async function loadMeasurementsByTagStemTag(
  connectionManager: ConnectionManager,
  schema: string,
  censusID: number,
  keys: Array<Required<Pick<ResolutionCandidate, 'tag' | 'stemtag'>>>
): Promise<Map<string, ExistingMeasurementRow[]>> {
  const groupedRows = new Map<string, ExistingMeasurementRow[]>();

  for (const chunk of chunkArray(keys, TAG_STEMTAG_LOOKUP_CHUNK_SIZE)) {
    const conditions = chunk
      .map(() => `(LOWER(TRIM(COALESCE(t.TreeTag, cm.RawTreeTag, ''))) = ? AND LOWER(TRIM(COALESCE(st.StemTag, cm.RawStemTag, ''))) = ?)`)
      .join(' OR ');

    const params = [censusID, ...chunk.flatMap(key => [key.tag, key.stemtag])];
    const query = safeFormatQuery(
      schema,
      `SELECT cm.CoreMeasurementID, cm.StemGUID, cm.IsActive, cm.MeasuredDBH, cm.MeasuredHOM,
              cm.MeasurementDate, cm.RawCodes, cm.Description, cm.RawTreeTag, cm.RawStemTag,
              st.IsActive AS StemIsActive, t.IsActive AS TreeIsActive, q.IsActive AS QuadratIsActive,
              q.PlotID, t.TreeTag, st.StemTag,
              sp.SpeciesCode, q.QuadratName, st.LocalX, st.LocalY
       FROM ??.coremeasurements cm
       LEFT JOIN ??.stems st ON st.StemGUID = cm.StemGUID
       LEFT JOIN ??.trees t ON t.TreeID = st.TreeID
       LEFT JOIN ??.quadrats q ON q.QuadratID = st.QuadratID
       LEFT JOIN ??.species sp ON sp.SpeciesID = t.SpeciesID
       WHERE cm.CensusID = ?
         AND (${conditions})`
    );

    const rows = (await connectionManager.executeQuery(query, params)) as ExistingMeasurementRow[];
    const chunkGrouped = groupRowsByKey(rows, 'tag_stemtag');
    chunkGrouped.forEach((value, key) => {
      const existing = groupedRows.get(key) ?? [];
      groupedRows.set(key, [...existing, ...value]);
    });
  }

  return groupedRows;
}

function buildBulkInput(matchedRows: RevisionMatchedRow[], newRows: RevisionNewRowCandidate[], invalidRows: RevisionInvalidRow[]): BulkInput {
  const duplicateDeletions: DuplicateDeletion[] = [];
  for (const row of matchedRows) {
    if (row.duplicateMeasurementIDsToDelete) {
      for (const duplicateID of row.duplicateMeasurementIDsToDelete) {
        duplicateDeletions.push({ coreMeasurementID: duplicateID, survivorCoreMeasurementID: row.coreMeasurementID });
      }
    }
  }

  return {
    matched: matchedRows.map((row, index) => ({
      rowIndex: index,
      targetID: row.coreMeasurementID,
      newRow: canonicalizeRowForHash(row.csvRow, 'revision-update')
    })),
    newRows: newRows.map(row => ({
      rowIndex: row.csvIndex,
      newRow: canonicalizeRowForHash(row.csvRow, 'revision-insert')
    })),
    invalid: invalidRows.map(row => ({
      rowIndex: row.csvIndex,
      reason: row.reason
    })),
    duplicateMeasurementIDsToDelete: duplicateDeletions
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function normalizeRequestFiles(body: RevisionUploadRequest): NormalizedRequestFile[] {
  if (Array.isArray(body.files)) {
    return body.files.map((file, index) => {
      if (!file || !Array.isArray(file.rows)) {
        throw new RevisionUploadRequestError(`Revision file ${index + 1} is missing a rows array`);
      }

      return {
        fileName: file.fileName?.trim() || `file-${index + 1}`,
        rows: file.rows
      };
    });
  }

  if (Array.isArray(body.rows)) {
    return [
      {
        fileName: 'revision-upload.csv',
        rows: body.rows
      }
    ];
  }

  throw new RevisionUploadRequestError('Missing required parameters: files (array) or rows (array), plotID, censusID, schema');
}

async function classifyFileRows(
  connectionManager: ConnectionManager,
  schema: string,
  censusID: number,
  plotID: number,
  fileName: string,
  rows: IndexedFileRow[]
): Promise<{ matchedRows: RevisionMatchedRow[]; newRows: RevisionNewRowCandidate[]; invalidRows: RevisionInvalidRow[] }> {
  const strategy = detectMatchStrategy(rows, fileName);
  const { candidates, invalidRows } = buildResolutionCandidates(rows, strategy);

  let lookup = new Map<string, ExistingMeasurementRow[]>();
  if (strategy === 'stemid') {
    lookup = await loadMeasurementsByStemID(
      connectionManager,
      schema,
      censusID,
      candidates.map(candidate => candidate.stemID as number)
    );
  } else {
    lookup = await loadMeasurementsByTagStemTag(
      connectionManager,
      schema,
      censusID,
      candidates.map(candidate => ({
        tag: candidate.tag as string,
        stemtag: candidate.stemtag as string
      }))
    );
  }

  const matchedRows: RevisionMatchedRow[] = [];
  const newRows: RevisionNewRowCandidate[] = [];

  for (const candidate of candidates) {
    const dbRows = lookup.get(candidate.key) ?? [];
    const resolvedRows = dbRows.filter(row => isResolvableMeasurement(row, plotID));

    if (resolvedRows.length > 0) {
      const survivor = resolvedRows.reduce((best, current) => (current.CoreMeasurementID > best.CoreMeasurementID ? current : best));
      const duplicateMeasurementIDsToDelete = resolvedRows
        .filter(row => row.CoreMeasurementID !== survivor.CoreMeasurementID)
        .map(row => row.CoreMeasurementID)
        .sort((left, right) => left - right);

      matchedRows.push({
        csvRow: candidate.csvRow,
        coreMeasurementID: survivor.CoreMeasurementID,
        duplicateMeasurementIDsToDelete,
        existingValues: buildExistingValues(survivor),
        changes: computeDiff(candidate.csvRow, survivor)
      });
      continue;
    }

    if (dbRows.length === 0) {
      const missingFields = getMissingRequiredInsertFields(candidate.csvRow);
      if (missingFields.length === 0) {
        newRows.push({
          csvRow: candidate.csvRow,
          csvIndex: candidate.csvIndex,
          reason: strategy === 'stemid' ? 'stemid-not-found' : 'no-match-key-in-db'
        });
      } else {
        invalidRows.push({
          csvRow: candidate.csvRow,
          csvIndex: candidate.csvIndex,
          reason:
            strategy === 'stemid'
              ? `stemid ${candidate.stemID} not found in target census; also missing required fields for new row: ${missingFields.join(', ')}`
              : `missing required fields for new row: ${missingFields.join(', ')}`
        });
      }
      continue;
    }

    const hasDifferentPlotRows = dbRows.some(row => row.PlotID !== null && row.PlotID !== plotID);
    invalidRows.push({
      csvRow: candidate.csvRow,
      csvIndex: candidate.csvIndex,
      reason: hasDifferentPlotRows ? 'stem exists in this census but belongs to a different plot' : 'stem exists but all measurements are inactive/failed'
    });
  }

  return { matchedRows, newRows, invalidRows };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: HTTPResponses.UNAUTHORIZED });
  }

  let body: RevisionUploadRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const { plotID, censusID, schema } = body;

  if (plotID === undefined || censusID === undefined || !schema) {
    return NextResponse.json(
      { error: 'Missing required parameters: files (array) or rows (array), plotID, censusID, schema' },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  const normalizedPlotID = parsePositiveInteger(plotID);
  const normalizedCensusID = parsePositiveInteger(censusID);
  if (normalizedPlotID === null || normalizedCensusID === null) {
    return NextResponse.json({ error: 'plotID and censusID must be positive integers' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  if (!isValidSchema(schema)) {
    return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  try {
    assertSessionMayEdit(session);
  } catch (error) {
    if (error instanceof PendingUserEditForbiddenError) {
      return NextResponse.json({ error: 'pending users cannot edit measurements' }, { status: 403 });
    }
    throw error;
  }

  let requestFiles: NormalizedRequestFile[];
  try {
    requestFiles = normalizeRequestFiles(body);
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.INVALID_REQUEST });
  }

  if (requestFiles.length === 0) {
    return NextResponse.json({ error: 'At least one revision file is required' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  if (requestFiles.some(file => file.rows.length === 0)) {
    return NextResponse.json({ error: 'Revision files must contain at least one data row' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();
  const matchedRows: RevisionMatchedRow[] = [];
  const newRows: RevisionNewRowCandidate[] = [];
  const invalidRows: RevisionInvalidRow[] = [];

  try {
    await assertCanEditMeasurementScope(connectionManager, session, {
      schema,
      plotID: normalizedPlotID,
      censusID: normalizedCensusID
    });

    let csvIndexOffset = 0;

    for (const file of requestFiles) {
      const indexedRows = file.rows.map((csvRow, index) => ({
        csvRow,
        csvIndex: csvIndexOffset + index
      }));

      const classifiedRows = await classifyFileRows(connectionManager, schema, normalizedCensusID, normalizedPlotID, file.fileName, indexedRows);
      matchedRows.push(...classifiedRows.matchedRows);
      newRows.push(...classifiedRows.newRows);
      invalidRows.push(...classifiedRows.invalidRows);
      csvIndexOffset += file.rows.length;
    }

    const baseBulkPlan = await analyzeBulk(
      connectionManager,
      schema,
      'measurementssummary',
      normalizedPlotID,
      normalizedCensusID,
      buildBulkInput(matchedRows, newRows, invalidRows),
      undefined,
      { role: session.user.userStatus }
    );
    const bulkPlan = applyRevisionRolePolicy(baseBulkPlan, session.user.userStatus, buildRevisionRoleFieldCandidates(matchedRows, newRows));

    const response: RevisionUploadResponse = {
      matchedRows,
      newRows,
      invalidRows,
      counts: {
        matched: matchedRows.length,
        matchedWithChanges: matchedRows.filter(row => Object.keys(row.changes).length > 0 || (row.duplicateMeasurementIDsToDelete?.length ?? 0) > 0).length,
        new: newRows.length,
        invalid: invalidRows.length,
        total: matchedRows.length + newRows.length + invalidRows.length
      },
      bulkPlan
    };

    return NextResponse.json(response, { status: HTTPResponses.OK });
  } catch (error: unknown) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    if (errorObj instanceof RevisionUploadRequestError) {
      return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.INVALID_REQUEST });
    }
    if (errorObj instanceof ScopeAccessError) {
      return NextResponse.json({ error: 'scope forbidden' }, { status: HTTPResponses.FORBIDDEN });
    }
    if (errorObj instanceof ScopeBusyError) {
      return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.LOCKED });
    }
    ailogger.error('[revisionupload API] Error classifying rows:', errorObj);
    return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
