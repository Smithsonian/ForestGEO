import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import ConnectionManager from '@/lib/db/connectionmanager';
import { isValidSchema } from '@/lib/db/sqlsecurity';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { FileRow } from '@/config/macros/formdetails';
import { RevisionInvalidRow, RevisionMatchedRow, RevisionNewRowCandidate, RevisionUploadResponse } from '@/config/revisionuploadtypes';
import { analyzeBulk, BulkInput, isGroupBlockingPreviewError } from '@/config/editplan/bulkanalyzer';
import { assertCanEditMeasurementScope, ScopeAccessError, ScopeBusyError } from '@/config/editplan/scopeguard';
import { assertSessionMayEdit, PendingUserEditForbiddenError } from '@/config/editplan/authorization';
import { applyRevisionRolePolicy, RevisionRoleFieldCandidate } from '@/config/editplan/revisionrolepolicy';
import { canonicalizeRowForHash } from '@/config/editplan/canonicalrow';
import { DuplicateDeletion } from '@/config/editplan/types';
import { InvalidClearError, InvalidFieldValueError } from '@/config/editplan/fieldpolicy';
import {
  buildAnalyzerRowFromChanges,
  computeDiff,
  ExistingMeasurementRow,
  isBlankOrNullPlaceholder,
  isResolvableMeasurement,
  loadMeasurementsByStemID,
  loadMeasurementsByTagStemTag,
  MatchStrategy,
  normalizeDateToString,
  readExplicitSpeciesCode
} from './shared/matchdiff';
import { requireSession } from '@/lib/auth-helpers';

export const runtime = 'nodejs';

const REQUIRED_INSERT_FIELDS = ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date'] as const;

class RevisionUploadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevisionUploadRequestError';
  }
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
      // Build the analyzer payload from the diff (lowercase-aliased `to`
      // values), not the full CSV row. This keeps revision-upload semantics
      // single-sourced: NULL placeholders, leading-zero round-trips, and
      // case-insensitive spcode no-ops are filtered out by `computeDiff`
      // before they reach `canonicalizeEditPayload`, which would otherwise
      // reject them as `invalid clear` (identity fields) or surface them
      // as fake bulk-plan fieldChanges.
      newRow: buildAnalyzerRowFromChanges(row.changes, 'revision-update'),
      explicitSpeciesCode: readExplicitSpeciesCode(row.csvRow)
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

      // computeDiff canonicalizes numeric cells, so one malformed or
      // out-of-range value throws. Demote that row to invalid with its CSV
      // index instead of letting it 422 the whole file, which left the
      // researcher with a field name and no way to find the offending row.
      let changes: Record<string, { from: unknown; to: unknown }>;
      try {
        changes = computeDiff(candidate.csvRow, survivor);
      } catch (diffError: unknown) {
        if (!(diffError instanceof InvalidFieldValueError)) throw diffError;
        invalidRows.push({
          csvRow: candidate.csvRow,
          csvIndex: candidate.csvIndex,
          reason: diffError.message
        });
        continue;
      }

      matchedRows.push({
        csvIndex: candidate.csvIndex,
        csvRow: candidate.csvRow,
        coreMeasurementID: survivor.CoreMeasurementID,
        duplicateMeasurementIDsToDelete,
        existingValues: buildExistingValues(survivor),
        changes
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

  // Species codes are intentionally NOT pre-validated here. A matched row
  // whose spcode targets an unknown species is left in matchedRows and goes
  // into the batch-wide analyzeBulk call below, where SpeciesNotFoundError
  // becomes an invalid rowPlan (bulkanalyzer.ts) that still carries the
  // row's explicitSpeciesCode into #427 batch grouping. Stripping it out
  // per-file here, before grouping ever sees it, would hide a sibling row's
  // contradicting correction request (#427).
  return { matchedRows, newRows, invalidRows };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

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
    assertSessionMayEdit(session!);
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
    await assertCanEditMeasurementScope(connectionManager, session!, {
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

    let baseBulkPlan = await analyzeBulk(
      connectionManager,
      schema,
      'measurementssummary',
      normalizedPlotID,
      normalizedCensusID,
      buildBulkInput(matchedRows, newRows, invalidRows),
      undefined,
      { role: session!.user.userStatus }
    );

    // analyzeBulk may demote individual matched rows to status:'invalid' —
    // a per-row data blocker (TreeStemResolution: missing quadrat, inactive
    // tree, ...) or an unresolved species code (SpeciesNotFoundError) — that
    // we don't want to sink the whole batch over. Surface those into
    // invalidRows here so the upload review's Invalid tab renders them with
    // a proper reason, then re-run analyzeBulk on the survivors so the
    // returned plan hash — and every rowIndex inside it, including a #427
    // group error's rowIndexes — stays aligned with the matchedRows array
    // actually being returned. Skipping the re-run would leave stale
    // indices pointing at the wrong row once matchedRows shifts.
    //
    // A row NAMED by a batch-level group blocker (#427, `rowIndexes` on a
    // `group_*` error) is excluded from demotion below: its
    // explicitSpeciesCode is what created the conflict, so dropping it from
    // the re-run input would make that conflict silently disappear. Only
    // genuinely unrelated invalid rows are ever removed, which is why the
    // re-run can never erase a group conflict it didn't touch.
    const groupImplicatedRowIndexes = new Set<number>();
    for (const groupError of baseBulkPlan.errors ?? []) {
      if (!isGroupBlockingPreviewError(groupError)) continue;
      for (const rowIndex of groupError.rowIndexes ?? []) groupImplicatedRowIndexes.add(rowIndex);
    }

    const demotedMatchedIndices = new Set<number>();
    baseBulkPlan.rowPlans.forEach(rowPlan => {
      if (rowPlan.status !== 'invalid' || rowPlan.targetID === undefined) return;
      if (groupImplicatedRowIndexes.has(rowPlan.rowIndex)) return;
      const matchedRow = matchedRows[rowPlan.rowIndex];
      if (matchedRow && matchedRow.coreMeasurementID === rowPlan.targetID) {
        invalidRows.push({
          csvRow: matchedRow.csvRow,
          csvIndex: matchedRow.csvIndex,
          reason: rowPlan.reason ?? 'Row failed validation'
        });
        demotedMatchedIndices.add(rowPlan.rowIndex);
      }
    });

    if (demotedMatchedIndices.size > 0) {
      const survivors = matchedRows.filter((_, index) => !demotedMatchedIndices.has(index));
      matchedRows.length = 0;
      matchedRows.push(...survivors);

      baseBulkPlan = await analyzeBulk(
        connectionManager,
        schema,
        'measurementssummary',
        normalizedPlotID,
        normalizedCensusID,
        buildBulkInput(matchedRows, newRows, invalidRows),
        undefined,
        { role: session!.user.userStatus }
      );
    }

    const bulkPlan = applyRevisionRolePolicy(baseBulkPlan, session!.user.userStatus, buildRevisionRoleFieldCandidates(matchedRows, newRows));

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
    if (errorObj instanceof InvalidClearError) {
      return NextResponse.json({ error: 'invalid clear', field: errorObj.field }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }
    if (errorObj instanceof InvalidFieldValueError) {
      return NextResponse.json({ error: 'invalid field value', field: errorObj.field }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }
    ailogger.error('[revisionupload API] Error classifying rows:', errorObj);
    return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
