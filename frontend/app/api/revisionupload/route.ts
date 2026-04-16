import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import ConnectionManager from '@/config/connectionmanager';
import { isValidSchema, safeFormatQuery } from '@/config/utils/sqlsecurity';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { FileRow } from '@/config/macros/formdetails';
import { RevisionInvalidRow, RevisionMatchedRow, RevisionNewRowCandidate, RevisionUploadResponse } from '@/config/revisionuploadtypes';

export const runtime = 'nodejs';

const UPDATABLE_FIELDS = ['dbh', 'hom', 'date', 'codes', 'comments'] as const;
const REQUIRED_INSERT_FIELDS = ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date'] as const;
const LOOKUP_CHUNK_SIZE = 1000;
const TAG_STEMTAG_LOOKUP_CHUNK_SIZE = 250;

type UpdatableField = (typeof UPDATABLE_FIELDS)[number];
type MatchStrategy = 'stemid' | 'tag_stemtag';

const CSV_FIELD_TO_DB_COLUMN: Record<UpdatableField, string> = {
  dbh: 'MeasuredDBH',
  hom: 'MeasuredHOM',
  date: 'MeasurementDate',
  codes: 'RawCodes',
  comments: 'Description'
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
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

function areEquivalentNumericValues(csvValue: string, dbValue: unknown): boolean {
  const parsedCsvValue = Number.parseFloat(csvValue);
  const parsedDbValue = typeof dbValue === 'number' ? dbValue : Number.parseFloat(String(dbValue ?? ''));

  return Number.isFinite(parsedCsvValue) && Number.isFinite(parsedDbValue) && parsedCsvValue === parsedDbValue;
}

function computeDiff(csvRow: FileRow, dbRow: ExistingMeasurementRow): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const field of UPDATABLE_FIELDS) {
    const csvValue = csvRow[field];
    if (csvValue === undefined || csvValue === null || String(csvValue).trim() === '') {
      continue;
    }

    const dbColumn = CSV_FIELD_TO_DB_COLUMN[field];
    let dbValue: unknown;

    if (field === 'date') {
      dbValue = normalizeDateToString(dbRow.MeasurementDate as Date | string | null);
    } else {
      dbValue = dbRow[dbColumn as keyof ExistingMeasurementRow];
      if (dbValue !== null && dbValue !== undefined && typeof dbValue === 'number') {
        dbValue = String(dbValue);
      }
    }

    if ((field === 'dbh' || field === 'hom') && areEquivalentNumericValues(String(csvValue).trim(), dbValue)) {
      continue;
    }

    if (String(csvValue).trim() !== String(dbValue ?? '').trim()) {
      changes[field] = { from: dbValue, to: csvValue };
    }
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
  const survivors = new Map<string, ResolutionCandidate>();
  const invalidRows: RevisionInvalidRow[] = [];

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

      survivors.set(String(parsedStemID), {
        ...row,
        key: String(parsedStemID),
        stemID: parsedStemID
      });
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

    survivors.set(key, {
      ...row,
      key,
      tag: normalizeTagStemKeyPart(row.csvRow['tag']) ?? undefined,
      stemtag: normalizeTagStemKeyPart(row.csvRow['stemtag']) ?? undefined
    });
  }

  return {
    candidates: Array.from(survivors.values()).sort((left, right) => left.csvIndex - right.csvIndex),
    invalidRows
  };
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
  return (
    row.IsActive === 1 &&
    row.StemGUID !== null &&
    row.StemIsActive === 1 &&
    row.TreeIsActive === 1 &&
    row.QuadratIsActive === 1 &&
    row.PlotID === plotID
  );
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
              q.PlotID, t.TreeTag, st.StemTag
       FROM ??.coremeasurements cm
       LEFT JOIN ??.stems st ON st.StemGUID = cm.StemGUID
       LEFT JOIN ??.trees t ON t.TreeID = st.TreeID
       LEFT JOIN ??.quadrats q ON q.QuadratID = st.QuadratID
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
              q.PlotID, t.TreeTag, st.StemTag
       FROM ??.coremeasurements cm
       LEFT JOIN ??.stems st ON st.StemGUID = cm.StemGUID
       LEFT JOIN ??.trees t ON t.TreeID = st.TreeID
       LEFT JOIN ??.quadrats q ON q.QuadratID = st.QuadratID
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
          csvIndex: candidate.csvIndex
        });
      } else {
        invalidRows.push({
          csvRow: candidate.csvRow,
          csvIndex: candidate.csvIndex,
          reason: `missing required fields for new row: ${missingFields.join(', ')}`
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
      }
    };

    return NextResponse.json(response, { status: HTTPResponses.OK });
  } catch (error: unknown) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    if (errorObj instanceof RevisionUploadRequestError) {
      return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.INVALID_REQUEST });
    }
    ailogger.error('[revisionupload API] Error classifying rows:', errorObj);
    return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
