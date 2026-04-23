import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import ConnectionManager from '@/config/connectionmanager';
import { isValidSchema, safeFormatQuery } from '@/config/utils/sqlsecurity';
import { HTTPResponses } from '@/config/macros';
import { FileRow } from '@/config/macros/formdetails';
import { generateShortBatchID } from '@/config/utils';
import ailogger from '@/ailogger';
import { ACTIVE_UPLOAD_SESSION_STATES, ensureUploadSessionsTable } from '@/config/uploadsessiontracker';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';
import { ACTIVE_UPLOAD_SESSION_HEARTBEAT_TIMEOUT_SECONDS, STALE_VALIDATION_RUN_THRESHOLD_MINUTES } from '@/config/measurementscopepolicy';
import { refreshMeasurementViewsForScope } from '@/lib/measurementviewrefresh';
import { applyEditInTransaction, ScopeLockHeldError, SessionExpiredError } from '@/config/editplan/apply';
import { analyzeBulk, assertBulkPlanCanApply, BulkInput, BulkPlanUnapplicableError } from '@/config/editplan/bulkanalyzer';
import { MeasurementResolutionError } from '@/config/editplan/writers/resolvers-mutating';
import { assertCanEditMeasurementScope, ScopeAccessError, ScopeBusyError } from '@/config/editplan/scopeguard';
import { RoleForbiddenFieldError } from '@/config/editplan/analyzer';
import { assertSessionMayEdit, createFreshAuthorizationCheck, PendingUserEditForbiddenError } from '@/config/editplan/authorization';
import { applyRevisionRolePolicy, RevisionRoleFieldCandidate } from '@/config/editplan/revisionrolepolicy';
import { ensureEditOperationsTable, writeEditOperation } from '@/config/editoperations';
import { canonicalizeRowForHash } from '@/config/editplan/canonicalrow';

export const runtime = 'nodejs';

const REVISION_UPLOAD_FILE_ID = 'revision-upload';

class RevisionApplyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevisionApplyConflictError';
  }
}

class RevisionApplyPlanHashMismatchError extends Error {
  constructor(public freshPlan: unknown) {
    super('plan hash mismatch');
    this.name = 'RevisionApplyPlanHashMismatchError';
  }
}

interface ApplyMatchedRow {
  coreMeasurementID: number;
  csvRow: FileRow;
  duplicateMeasurementIDsToDelete?: number[];
}

interface ApplyNewRow {
  csvRow: FileRow;
  csvIndex: number;
}

interface ApplyInvalidRow {
  csvRow?: FileRow;
  csvIndex: number;
  reason: string;
}

interface DuplicateToDelete {
  coreMeasurementID: number;
  survivorCoreMeasurementID: number;
}

interface ApplyRequest {
  matchedRows: ApplyMatchedRow[];
  newRows: Array<ApplyNewRow | FileRow>;
  invalidRows?: ApplyInvalidRow[];
  confirmNewRows: boolean;
  duplicateMeasurementIDsToDelete?: DuplicateToDelete[];
  schema: string;
  plotID: number;
  censusID: number;
  bulkPlanHash: string;
}

interface ApplyError {
  coreMeasurementID: number;
  error: string;
}

interface ApplyResponse {
  updatedCount: number;
  skippedCount: number;
  insertedCount: number;
  deletedDuplicateCount: number;
  applyErrors: ApplyError[];
  validationPending: boolean;
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

function parseNonNegativeInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }

    const parsed = Number.parseInt(trimmed, 10);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  return null;
}

function getAffectedRowCount(result: unknown): number {
  if (!result || typeof result !== 'object' || !('affectedRows' in result)) {
    return 0;
  }

  const affectedRows = (result as { affectedRows?: unknown }).affectedRows;
  return typeof affectedRows === 'number' && Number.isFinite(affectedRows) ? affectedRows : 0;
}

function isBlankOrNullPlaceholder(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  const trimmed = String(value).trim();
  return trimmed === '' || trimmed.toUpperCase() === 'NULL';
}

function speciesCodesDiffer(csvValue: unknown, dbValue: unknown): boolean {
  if (isBlankOrNullPlaceholder(csvValue)) return false;
  return (
    String(csvValue).trim().toLowerCase() !==
    String(dbValue ?? '')
      .trim()
      .toLowerCase()
  );
}

async function loadCurrentSpeciesCode(
  connectionManager: ConnectionManager,
  schema: string,
  coreMeasurementID: number,
  censusID: number,
  plotID: number,
  transactionID: string
): Promise<unknown> {
  const query = safeFormatQuery(
    schema,
    `SELECT sp.SpeciesCode
     FROM ??.coremeasurements cm
     JOIN ??.census c ON c.CensusID = cm.CensusID
     LEFT JOIN ??.stems st ON st.StemGUID = cm.StemGUID AND st.IsActive = 1
     LEFT JOIN ??.trees tr ON tr.TreeID = st.TreeID AND tr.IsActive = 1
     LEFT JOIN ??.species sp ON sp.SpeciesID = tr.SpeciesID
     WHERE cm.CoreMeasurementID = ?
       AND cm.CensusID = ?
       AND c.PlotID = ?
       AND cm.IsActive = 1
     LIMIT 1`
  );
  const rows = await connectionManager.executeQuery(query, [coreMeasurementID, censusID, plotID], transactionID);
  return rows[0]?.SpeciesCode ?? null;
}

async function buildRevisionRoleFieldCandidates(
  connectionManager: ConnectionManager,
  schema: string,
  plotID: number,
  censusID: number,
  matchedRows: ApplyMatchedRow[],
  newRows: ApplyNewRow[],
  transactionID: string
): Promise<RevisionRoleFieldCandidate[]> {
  const candidates: RevisionRoleFieldCandidate[] = [];
  for (const [index, row] of matchedRows.entries()) {
    if (isBlankOrNullPlaceholder(row.csvRow.spcode)) continue;
    const dbSpeciesCode = await loadCurrentSpeciesCode(connectionManager, schema, row.coreMeasurementID, censusID, plotID, transactionID);
    if (speciesCodesDiffer(row.csvRow.spcode, dbSpeciesCode)) {
      candidates.push({ rowIndex: index, field: 'spcode' });
    }
  }
  for (const row of newRows) {
    if (!isBlankOrNullPlaceholder(row.csvRow.spcode)) {
      candidates.push({ rowIndex: row.csvIndex, field: 'spcode' });
    }
  }
  return candidates;
}

function normalizeMatchedRows(rawRows: ApplyMatchedRow[]): { matchedRows: ApplyMatchedRow[]; applyErrors: ApplyError[] } {
  const matchedRows: ApplyMatchedRow[] = [];
  const applyErrors: ApplyError[] = [];

  rawRows.forEach((row, index) => {
    const coreMeasurementID = parsePositiveInteger(row?.coreMeasurementID);
    if (coreMeasurementID === null) {
      applyErrors.push({
        coreMeasurementID: 0,
        error: `Matched row ${index + 1} has an invalid coreMeasurementID`
      });
      return;
    }

    let duplicateMeasurementIDsToDelete: number[] | undefined;
    if (Array.isArray(row?.duplicateMeasurementIDsToDelete)) {
      duplicateMeasurementIDsToDelete = [];
      row.duplicateMeasurementIDsToDelete.forEach((rawDuplicateID, duplicateIndex) => {
        const duplicateID = parsePositiveInteger(rawDuplicateID);
        if (duplicateID === null) {
          applyErrors.push({
            coreMeasurementID,
            error: `Matched row ${index + 1} has an invalid duplicateMeasurementIDsToDelete value at position ${duplicateIndex + 1}`
          });
          return;
        }
        duplicateMeasurementIDsToDelete?.push(duplicateID);
      });
    }

    matchedRows.push({
      coreMeasurementID,
      csvRow: row?.csvRow ?? {},
      ...(duplicateMeasurementIDsToDelete ? { duplicateMeasurementIDsToDelete } : {})
    });
  });

  return { matchedRows, applyErrors };
}

function normalizeNewRows(rawRows: Array<ApplyNewRow | FileRow>): { newRows: ApplyNewRow[]; applyErrors: ApplyError[] } {
  const newRows: ApplyNewRow[] = [];
  const applyErrors: ApplyError[] = [];

  rawRows.forEach((row, index) => {
    const maybeWrapped = row as Partial<ApplyNewRow>;
    const hasWrappedShape = maybeWrapped.csvRow !== undefined || maybeWrapped.csvIndex !== undefined;
    const csvRow = hasWrappedShape ? maybeWrapped.csvRow : (row as FileRow);
    const parsedIndex = hasWrappedShape ? parseNonNegativeInteger(maybeWrapped.csvIndex) : index;

    if (parsedIndex === null) {
      applyErrors.push({
        coreMeasurementID: 0,
        error: `New row ${index + 1} has an invalid csvIndex`
      });
      return;
    }

    newRows.push({
      csvIndex: parsedIndex,
      csvRow: csvRow ?? {}
    });
  });

  return { newRows, applyErrors };
}

function normalizeInvalidRows(rawRows: ApplyInvalidRow[] | undefined): { invalidRows: ApplyInvalidRow[]; applyErrors: ApplyError[] } {
  const invalidRows: ApplyInvalidRow[] = [];
  const applyErrors: ApplyError[] = [];

  (rawRows ?? []).forEach((row, index) => {
    const csvIndex = parseNonNegativeInteger(row?.csvIndex);
    if (csvIndex === null || typeof row?.reason !== 'string' || row.reason.trim() === '') {
      applyErrors.push({
        coreMeasurementID: 0,
        error: `Invalid row ${index + 1} must include csvIndex and reason`
      });
      return;
    }

    invalidRows.push({
      csvIndex,
      csvRow: row.csvRow ?? {},
      reason: row.reason
    });
  });

  return { invalidRows, applyErrors };
}

function normalizeDuplicates(rawDuplicates: DuplicateToDelete[]): { duplicates: DuplicateToDelete[]; applyErrors: ApplyError[] } {
  const duplicates: DuplicateToDelete[] = [];
  const applyErrors: ApplyError[] = [];

  rawDuplicates.forEach((duplicate, index) => {
    const coreMeasurementID = parsePositiveInteger(duplicate?.coreMeasurementID);
    const survivorCoreMeasurementID = parsePositiveInteger(duplicate?.survivorCoreMeasurementID);

    if (coreMeasurementID === null || survivorCoreMeasurementID === null) {
      applyErrors.push({
        coreMeasurementID: coreMeasurementID ?? 0,
        error: `Duplicate deletion request ${index + 1} must use positive integer measurement IDs`
      });
      return;
    }

    duplicates.push({
      coreMeasurementID,
      survivorCoreMeasurementID
    });
  });

  return { duplicates, applyErrors };
}

function buildDuplicateDeletionHints(matchedRows: ApplyMatchedRow[]): DuplicateToDelete[] {
  const duplicates: DuplicateToDelete[] = [];
  for (const row of matchedRows) {
    for (const duplicateID of row.duplicateMeasurementIDsToDelete ?? []) {
      duplicates.push({
        coreMeasurementID: duplicateID,
        survivorCoreMeasurementID: row.coreMeasurementID
      });
    }
  }
  return duplicates;
}

function duplicateKey(duplicate: DuplicateToDelete): string {
  return `${duplicate.survivorCoreMeasurementID}:${duplicate.coreMeasurementID}`;
}

function duplicatesMatch(left: DuplicateToDelete[], right: DuplicateToDelete[]): boolean {
  const leftKeys = left.map(duplicateKey).sort();
  const rightKeys = right.map(duplicateKey).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]);
}

/**
 * Normalizes a date string to YYYY-MM-DD for MySQL DATE columns.
 * If already in that format, returns as-is.
 * Falls through to raw string on parse failure, letting MySQL reject it.
 */
function normalizeDateForSQL(dateStr: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  return dateStr;
}

/**
 * Re-resolves a CoreMeasurementID within the current plot+census boundary.
 * Returns true if the measurement is active and owned by the given plot.
 * This TOCTOU check ensures the row hasn't been deleted/deactivated between
 * the initial match (POST /revisionupload) and this apply step.
 */
async function verifyMeasurementStillActive(
  connectionManager: ConnectionManager,
  schema: string,
  coreMeasurementID: number,
  censusID: number,
  plotID: number,
  transactionID: string
): Promise<boolean> {
  const query = safeFormatQuery(
    schema,
    `SELECT 1
     FROM ??.coremeasurements cm
     JOIN ??.stems st ON st.StemGUID = cm.StemGUID AND st.IsActive = 1
     JOIN ??.quadrats q ON q.QuadratID = st.QuadratID AND q.IsActive = 1
     WHERE cm.CoreMeasurementID = ?
       AND cm.CensusID = ?
       AND cm.IsActive = 1
       AND cm.StemGUID IS NOT NULL
       AND q.PlotID = ?
     LIMIT 1`
  );

  const rows = await connectionManager.executeQuery(query, [coreMeasurementID, censusID, plotID], transactionID);
  return rows.length > 0;
}

function hasAnyCanonicalField(csvRow: FileRow): boolean {
  return Object.keys(canonicalizeRowForHash(csvRow, 'revision-update')).length > 0;
}

/**
 * Validates duplicate-deletion requests against the matched rows before any DB work.
 * Rejects if:
 *  - a duplicate ID equals a survivor ID (would delete the row we're about to update)
 *  - a duplicate ID appears more than once in the array
 *  - a duplicate ID is claimed by two different survivors
 *  - a survivor ID is not present in matchedRows
 */
function validateDuplicateRequests(duplicates: DuplicateToDelete[], matchedRows: ApplyMatchedRow[]): ApplyError[] {
  const errors: ApplyError[] = [];
  const survivorIDs = new Set(matchedRows.map(r => r.coreMeasurementID));
  const seenDuplicateIDs = new Map<number, number>(); // duplicateID -> survivorID

  for (const dup of duplicates) {
    if (survivorIDs.has(dup.coreMeasurementID)) {
      errors.push({
        coreMeasurementID: dup.coreMeasurementID,
        error: `Duplicate ID ${dup.coreMeasurementID} is also a survivor — refusing to delete a row being updated`
      });
      continue;
    }

    if (!survivorIDs.has(dup.survivorCoreMeasurementID)) {
      errors.push({
        coreMeasurementID: dup.coreMeasurementID,
        error: `Survivor ${dup.survivorCoreMeasurementID} is not in the matched rows`
      });
      continue;
    }

    const previousSurvivor = seenDuplicateIDs.get(dup.coreMeasurementID);
    if (previousSurvivor !== undefined) {
      if (previousSurvivor !== dup.survivorCoreMeasurementID) {
        errors.push({
          coreMeasurementID: dup.coreMeasurementID,
          error: `Duplicate ID ${dup.coreMeasurementID} claimed by two different survivors (${previousSurvivor} and ${dup.survivorCoreMeasurementID})`
        });
      } else {
        errors.push({
          coreMeasurementID: dup.coreMeasurementID,
          error: `Duplicate ID ${dup.coreMeasurementID} appears more than once in the request`
        });
      }
      continue;
    }

    seenDuplicateIDs.set(dup.coreMeasurementID, dup.survivorCoreMeasurementID);
  }

  return errors;
}

/**
 * Re-verifies a duplicate measurement inside the transaction, then deletes it.
 * Checks: active, same census, same plot, non-null StemGUID, same StemGUID as survivor.
 * Explicitly deletes cmattributes before the measurement row.
 *
 * Returns the number of actual coremeasurements rows deleted (0 or 1).
 */
async function verifyAndDeleteDuplicate(
  connectionManager: ConnectionManager,
  schema: string,
  duplicate: DuplicateToDelete,
  censusID: number,
  plotID: number,
  transactionID: string
): Promise<{ deleted: number; applyError?: ApplyError }> {
  // Load both the duplicate and its survivor in one query to verify stem-group membership
  const verifyQuery = safeFormatQuery(
    schema,
    `SELECT cm.CoreMeasurementID, cm.StemGUID
     FROM ??.coremeasurements cm
     JOIN ??.stems st ON st.StemGUID = cm.StemGUID AND st.IsActive = 1
     JOIN ??.quadrats q ON q.QuadratID = st.QuadratID AND q.IsActive = 1
     WHERE cm.CoreMeasurementID IN (?, ?)
       AND cm.CensusID = ?
       AND cm.IsActive = 1
       AND cm.StemGUID IS NOT NULL
       AND q.PlotID = ?`
  );
  const verifiedRows = await connectionManager.executeQuery(
    verifyQuery,
    [duplicate.coreMeasurementID, duplicate.survivorCoreMeasurementID, censusID, plotID],
    transactionID
  );

  const duplicateRow = verifiedRows.find((r: any) => r.CoreMeasurementID === duplicate.coreMeasurementID);
  const survivorRow = verifiedRows.find((r: any) => r.CoreMeasurementID === duplicate.survivorCoreMeasurementID);

  if (!duplicateRow) {
    return {
      deleted: 0,
      applyError: {
        coreMeasurementID: duplicate.coreMeasurementID,
        error: `Duplicate ${duplicate.coreMeasurementID} is no longer active in this plot/census or has already been removed`
      }
    };
  }

  if (!survivorRow) {
    return {
      deleted: 0,
      applyError: {
        coreMeasurementID: duplicate.coreMeasurementID,
        error: `Survivor ${duplicate.survivorCoreMeasurementID} is no longer active in this plot/census — refusing to delete duplicate without a valid survivor`
      }
    };
  }

  if (duplicateRow.StemGUID !== survivorRow.StemGUID) {
    return {
      deleted: 0,
      applyError: {
        coreMeasurementID: duplicate.coreMeasurementID,
        error: `Duplicate ${duplicate.coreMeasurementID} (StemGUID=${duplicateRow.StemGUID}) is not on the same stem as survivor ${duplicate.survivorCoreMeasurementID} (StemGUID=${survivorRow.StemGUID})`
      }
    };
  }

  // Explicitly delete cmattributes — don't rely on CASCADE
  const deleteAttrsSQL = safeFormatQuery(schema, 'DELETE FROM ??.cmattributes WHERE CoreMeasurementID = ?');
  await connectionManager.executeQuery(deleteAttrsSQL, [duplicate.coreMeasurementID], transactionID);

  // Delete the duplicate measurement row
  const deleteSQL = safeFormatQuery(schema, 'DELETE FROM ??.coremeasurements WHERE CoreMeasurementID = ? AND CensusID = ? AND IsActive = 1');
  const deleteResult = await connectionManager.executeQuery(deleteSQL, [duplicate.coreMeasurementID, censusID], transactionID);

  // Count actual rows deleted from the DB, not what the client requested
  const rowsDeleted = getAffectedRowCount(deleteResult);
  if (rowsDeleted > 0) {
    // These are denormalized materialized tables, not FK-backed views.
    const deleteMeasurementsSummarySQL = safeFormatQuery(schema, 'DELETE FROM ??.measurementssummary WHERE CoreMeasurementID = ?');
    await connectionManager.executeQuery(deleteMeasurementsSummarySQL, [duplicate.coreMeasurementID], transactionID);

    const deleteViewFullTableSQL = safeFormatQuery(schema, 'DELETE FROM ??.viewfulltable WHERE CoreMeasurementID = ?');
    await connectionManager.executeQuery(deleteViewFullTableSQL, [duplicate.coreMeasurementID], transactionID);
  }

  return { deleted: rowsDeleted };
}

async function assertNoConflictingApplyActivity(
  connectionManager: ConnectionManager,
  schema: string,
  plotID: number,
  censusID: number,
  transactionID: string
): Promise<void> {
  const lockAcquired = await connectionManager.acquireApplicationLock(
    buildMeasurementScopeLockName(schema, plotID, censusID),
    transactionID,
    MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS
  );

  if (!lockAcquired) {
    throw new ScopeLockHeldError(`Another measurement operation is already in progress for plot ${plotID}, census ${censusID}`);
  }

  const activeUploadStatesPlaceholders = ACTIVE_UPLOAD_SESSION_STATES.map(() => '?').join(', ');
  const activeUploadSessionSQL = safeFormatQuery(
    schema,
    `SELECT session_id
     FROM ??.upload_sessions
     WHERE plot_id = ?
       AND census_id = ?
       AND state IN (${activeUploadStatesPlaceholders})
       AND last_heartbeat >= DATE_SUB(NOW(), INTERVAL ? SECOND)
     ORDER BY last_heartbeat DESC, updated_at DESC, created_at DESC
     LIMIT 1
     FOR UPDATE`
  );
  const activeUploadSessions = await connectionManager.executeQuery(
    activeUploadSessionSQL,
    [plotID, censusID, ...ACTIVE_UPLOAD_SESSION_STATES, ACTIVE_UPLOAD_SESSION_HEARTBEAT_TIMEOUT_SECONDS],
    transactionID
  );

  if (activeUploadSessions.length > 0) {
    throw new ScopeBusyError(
      `Cannot apply revisions while upload session ${activeUploadSessions[0].session_id} is active for plot ${plotID}, census ${censusID}`
    );
  }

  const validationLockSQL = safeFormatQuery(
    schema,
    `SELECT RunID, StartedAt
     FROM ??.validation_runs
     WHERE PlotID = ? AND CensusID = ? AND Status = 'running'
     ORDER BY RunID DESC
     LIMIT 1
     FOR UPDATE`
  );
  const runningValidationRows = await connectionManager.executeQuery(validationLockSQL, [plotID, censusID], transactionID);

  if (Array.isArray(runningValidationRows) && runningValidationRows.length > 0) {
    const startedAt = new Date(runningValidationRows[0].StartedAt).getTime();
    const ageMinutes = Number.isNaN(startedAt) ? 0 : (Date.now() - startedAt) / 60_000;

    if (ageMinutes < STALE_VALIDATION_RUN_THRESHOLD_MINUTES) {
      throw new ScopeBusyError(
        `Cannot apply revisions while validation run ${runningValidationRows[0].RunID} is active for plot ${plotID}, census ${censusID}`
      );
    }
  }
}

/**
 * Stages confirmed new rows into temporarymeasurements, then calls
 * bulkingestionprocess to ingest them through the standard pipeline.
 *
 * Returns the number of rows inserted into temporarymeasurements.
 * The bulkingestionprocess handles its own error logging internally.
 */
async function insertNewRowsThroughPipeline(
  connectionManager: ConnectionManager,
  schema: string,
  plotID: number,
  censusID: number,
  newRows: FileRow[],
  transactionID: string
): Promise<number> {
  const batchID = generateShortBatchID();

  const rowValues = newRows.map(csvRow => {
    const lx = csvRow['lx'] !== null && csvRow['lx'] !== undefined && String(csvRow['lx']).trim() !== '' ? parseFloat(String(csvRow['lx']).trim()) : null;
    const ly = csvRow['ly'] !== null && csvRow['ly'] !== undefined && String(csvRow['ly']).trim() !== '' ? parseFloat(String(csvRow['ly']).trim()) : null;
    const dbh = csvRow['dbh'] !== null && csvRow['dbh'] !== undefined && String(csvRow['dbh']).trim() !== '' ? parseFloat(String(csvRow['dbh']).trim()) : null;
    const hom = csvRow['hom'] !== null && csvRow['hom'] !== undefined && String(csvRow['hom']).trim() !== '' ? parseFloat(String(csvRow['hom']).trim()) : null;
    const date =
      csvRow['date'] !== null && csvRow['date'] !== undefined && String(csvRow['date']).trim() !== ''
        ? normalizeDateForSQL(String(csvRow['date']).trim())
        : null;

    return [
      REVISION_UPLOAD_FILE_ID,
      batchID,
      plotID,
      censusID,
      csvRow['tag'] ?? null,
      csvRow['stemtag'] ?? null,
      csvRow['spcode'] ?? null,
      csvRow['quadrat'] ?? null,
      isNaN(lx as number) ? null : lx,
      isNaN(ly as number) ? null : ly,
      isNaN(dbh as number) ? null : dbh,
      isNaN(hom as number) ? null : hom,
      date,
      csvRow['codes'] ?? null,
      csvRow['comments'] ?? null
    ];
  });

  const insertTempSQL = safeFormatQuery(
    schema,
    `INSERT IGNORE INTO ??.temporarymeasurements
      (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
     VALUES ?`
  );
  await connectionManager.executeQuery(insertTempSQL, [rowValues], transactionID);

  const bulkIngestSQL = safeFormatQuery(schema, 'CALL ??.bulkingestionprocess(?, ?)');
  await connectionManager.executeQuery(bulkIngestSQL, [REVISION_UPLOAD_FILE_ID, batchID], transactionID);

  return newRows.length;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestStartedAt = Date.now();
  const requestTraceID = requestStartedAt.toString(36);
  const logPrefix = `[revisionupload/apply][${requestTraceID}]`;

  ailogger.info(`${logPrefix} request received`);

  const authStartedAt = Date.now();
  ailogger.info(`${logPrefix} auth start`);
  const session = await auth();
  ailogger.info(`${logPrefix} auth complete in ${Date.now() - authStartedAt}ms`);
  if (!session?.user) {
    ailogger.warn(`${logPrefix} unauthorized after ${Date.now() - requestStartedAt}ms`);
    return NextResponse.json({ error: 'Unauthorized' }, { status: HTTPResponses.UNAUTHORIZED });
  }

  let body: ApplyRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const { matchedRows, newRows, invalidRows, confirmNewRows, duplicateMeasurementIDsToDelete, schema, plotID, censusID, bulkPlanHash } = body;

  ailogger.info(
    `${logPrefix} parsed request body in ${Date.now() - requestStartedAt}ms (matchedRows=${Array.isArray(matchedRows) ? matchedRows.length : 'invalid'}, newRows=${Array.isArray(newRows) ? newRows.length : 'invalid'}, confirmNewRows=${confirmNewRows === true})`
  );

  if (!Array.isArray(matchedRows) || !Array.isArray(newRows) || plotID === undefined || censusID === undefined || !schema) {
    return NextResponse.json(
      { error: 'Missing required parameters: matchedRows (array), newRows (array), plotID, censusID, schema' },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  if (typeof bulkPlanHash !== 'string' || bulkPlanHash.trim() === '') {
    return NextResponse.json(
      { error: 'Missing required parameter: bulkPlanHash (string produced by the match endpoint)' },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  const normalizedPlotID = parsePositiveInteger(plotID);
  const normalizedCensusID = parsePositiveInteger(censusID);
  if (normalizedPlotID === null || normalizedCensusID === null) {
    return NextResponse.json({ error: 'plotID and censusID must be positive integers' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const normalizedMatchedRows = normalizeMatchedRows(matchedRows);
  const normalizedNewRows = normalizeNewRows(newRows);
  const normalizedInvalidRows = normalizeInvalidRows(invalidRows);
  const normalizationErrors = [...normalizedMatchedRows.applyErrors, ...normalizedNewRows.applyErrors, ...normalizedInvalidRows.applyErrors];
  if (normalizationErrors.length > 0) {
    return NextResponse.json({ error: 'Revision rows failed validation', applyErrors: normalizationErrors }, { status: HTTPResponses.INVALID_REQUEST });
  }

  // Pre-flight validation of duplicate deletion requests (before opening a transaction)
  const rowDuplicateHints = buildDuplicateDeletionHints(normalizedMatchedRows.matchedRows);
  const normalizedDuplicateResults = normalizeDuplicates(Array.isArray(duplicateMeasurementIDsToDelete) ? duplicateMeasurementIDsToDelete : rowDuplicateHints);
  if (normalizedDuplicateResults.applyErrors.length > 0) {
    return NextResponse.json(
      { error: 'Duplicate deletion request failed validation', applyErrors: normalizedDuplicateResults.applyErrors },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  if (Array.isArray(duplicateMeasurementIDsToDelete) && !duplicatesMatch(rowDuplicateHints, normalizedDuplicateResults.duplicates)) {
    return NextResponse.json(
      {
        error: 'Duplicate deletion request failed validation',
        applyErrors: [
          {
            coreMeasurementID: 0,
            error: 'Duplicate deletion hints must match the matchedRows payload'
          }
        ]
      },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  const duplicates = rowDuplicateHints.length > 0 ? rowDuplicateHints : normalizedDuplicateResults.duplicates;
  if (duplicates.length > 0) {
    const preflightErrors = validateDuplicateRequests(duplicates, normalizedMatchedRows.matchedRows);
    if (preflightErrors.length > 0) {
      return NextResponse.json(
        { error: 'Duplicate deletion request failed validation', applyErrors: preflightErrors },
        { status: HTTPResponses.INVALID_REQUEST }
      );
    }
  }

  if (!isValidSchema(schema)) {
    return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  try {
    assertSessionMayEdit(session);
  } catch (error) {
    if (error instanceof PendingUserEditForbiddenError) {
      return NextResponse.json({ error: 'pending users cannot edit measurements' }, { status: HTTPResponses.FORBIDDEN });
    }
    throw error;
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    await assertCanEditMeasurementScope(connectionManager, session, {
      schema,
      plotID: normalizedPlotID,
      censusID: normalizedCensusID
    });

    const ensureSessionsStartedAt = Date.now();
    await ensureUploadSessionsTable(schema);
    ailogger.info(`${logPrefix} ensureUploadSessionsTable complete in ${Date.now() - ensureSessionsStartedAt}ms for schema=${schema}`);

    // Ensure the edit_operations table exists OUTSIDE the outer transaction.
    // applyEditInTransaction and writeEditOperation both require the table,
    // but their usual self-bootstrap (via ensureEditOperationsTable inside
    // applyEditInTransaction) runs CREATE TABLE IF NOT EXISTS each iteration,
    // which MySQL treats as a DDL implicit-commit — ending the outer
    // transaction and defeating mid-bulk rollback. Bootstrap once here, then
    // pass schemaEnsured: true to every applyEditInTransaction call below.
    await ensureEditOperationsTable(connectionManager, schema);

    const transactionStartedAt = Date.now();
    ailogger.info(`${logPrefix} transaction requested for schema=${schema} plot=${normalizedPlotID} census=${normalizedCensusID}`);
    const createdBy = session.user.email ?? session.user.name ?? 'revision-apply';
    const assertAuthorizationFresh = createFreshAuthorizationCheck(session, {
      schema,
      plotID: normalizedPlotID,
      censusID: normalizedCensusID
    });
    const result = await connectionManager.withTransaction(async (transactionID: string) => {
      ailogger.info(`${logPrefix} transaction callback entered in ${Date.now() - transactionStartedAt}ms (tx=${transactionID})`);
      await assertNoConflictingApplyActivity(connectionManager, schema, normalizedPlotID, normalizedCensusID, transactionID);

      // --- Bulk plan hash check: re-compute the plan inside the outer transaction
      //     (under the scope lock) and compare against the hash the client sent
      //     back. Mismatch means the match-time plan has drifted and the user
      //     must re-review — return 409 with the fresh plan so the UI can
      //     surface the delta.
      const bulkInputForHashCheck: BulkInput = {
        matched: normalizedMatchedRows.matchedRows.map((row, index) => ({
          rowIndex: index,
          targetID: row.coreMeasurementID,
          newRow: canonicalizeRowForHash(row.csvRow, 'revision-update')
        })),
        newRows: normalizedNewRows.newRows.map(row => ({
          rowIndex: row.csvIndex,
          newRow: canonicalizeRowForHash(row.csvRow, 'revision-insert')
        })),
        invalid: normalizedInvalidRows.invalidRows.map(row => ({
          rowIndex: row.csvIndex,
          reason: row.reason
        })),
        duplicateMeasurementIDsToDelete: duplicates
      };
      const baseFreshPlan = await analyzeBulk(
        connectionManager,
        schema,
        'measurementssummary',
        normalizedPlotID,
        normalizedCensusID,
        bulkInputForHashCheck,
        transactionID,
        { role: session.user.userStatus }
      );
      const freshPlan = applyRevisionRolePolicy(
        baseFreshPlan,
        session.user.userStatus,
        await buildRevisionRoleFieldCandidates(
          connectionManager,
          schema,
          normalizedPlotID,
          normalizedCensusID,
          normalizedMatchedRows.matchedRows,
          normalizedNewRows.newRows,
          transactionID
        )
      );
      assertBulkPlanCanApply(freshPlan);
      if (freshPlan.planHash !== bulkPlanHash) {
        ailogger.warn(`${logPrefix} bulk plan hash mismatch (expected=${bulkPlanHash}, fresh=${freshPlan.planHash}) — aborting apply so UI can re-review`);
        throw new RevisionApplyPlanHashMismatchError(freshPlan);
      }

      await assertAuthorizationFresh();

      let updatedCount = 0;
      let skippedCount = 0;
      const applyErrors: ApplyError[] = [];
      const updatedCoreMeasurementIDs: number[] = [];

      for (const row of normalizedMatchedRows.matchedRows) {
        const stillActive = await verifyMeasurementStillActive(
          connectionManager,
          schema,
          row.coreMeasurementID,
          normalizedCensusID,
          normalizedPlotID,
          transactionID
        );
        if (!stillActive) {
          throw new RevisionApplyConflictError(
            `Measurement ${row.coreMeasurementID} is no longer active in this plot/census — may have been deactivated since upload was matched`
          );
        }

        if (!hasAnyCanonicalField(row.csvRow)) {
          skippedCount++;
          continue;
        }

        const canonicalNewRow = canonicalizeRowForHash(row.csvRow, 'revision-update');

        // Per-row ledger entries are suppressed: bulk rows are revertable:false,
        // so the full beforeState/afterState JSON would be pure audit cost.
        // A single summary entry is written once the batch completes.
        await applyEditInTransaction(connectionManager, {
          dataType: 'measurementssummary',
          schema,
          plotID: normalizedPlotID,
          censusID: normalizedCensusID,
          targetID: row.coreMeasurementID,
          newRow: canonicalNewRow,
          expectedPlanHash: null,
          operationType: 'bulk-revision-row',
          revertable: false,
          writeLedger: false,
          refreshViews: false,
          createdBy,
          role: session.user.userStatus,
          transactionID,
          schemaEnsured: true
        });

        updatedCount++;
        updatedCoreMeasurementIDs.push(row.coreMeasurementID);
      }

      // --- Delete verified duplicates ---
      let deletedDuplicateCount = 0;
      const deletedDuplicateIDs: number[] = [];
      for (const dup of duplicates) {
        const dupResult = await verifyAndDeleteDuplicate(connectionManager, schema, dup, normalizedCensusID, normalizedPlotID, transactionID);
        deletedDuplicateCount += dupResult.deleted;
        if (dupResult.deleted > 0) {
          deletedDuplicateIDs.push(dup.coreMeasurementID);
        }
        if (dupResult.applyError) {
          throw new RevisionApplyConflictError(dupResult.applyError.error);
        }
      }

      let insertedCount = 0;
      if (confirmNewRows && normalizedNewRows.newRows.length > 0) {
        insertedCount = await insertNewRowsThroughPipeline(
          connectionManager,
          schema,
          normalizedPlotID,
          normalizedCensusID,
          normalizedNewRows.newRows.map(row => row.csvRow),
          transactionID
        );
      }

      if (updatedCount > 0 || insertedCount > 0 || deletedDuplicateCount > 0) {
        const viewRefreshStartedAt = Date.now();
        ailogger.info(
          `${logPrefix} derived view refresh start (tx=${transactionID}, updated=${updatedCount}, inserted=${insertedCount}, deletedDuplicate=${deletedDuplicateCount})`
        );
        await refreshMeasurementViewsForScope(connectionManager, schema, normalizedPlotID, normalizedCensusID, transactionID);
        ailogger.info(`${logPrefix} derived view refresh complete in ${Date.now() - viewRefreshStartedAt}ms (tx=${transactionID})`);
      }

      // One batch-level ledger entry summarizes the whole apply. Row-level
      // state is intentionally NOT captured since bulk rows are not
      // revertable through the single-row revert path.
      //
      // TargetID is null for bulk rows: the batch has no single "target"
      // measurement. The affected CoreMeasurementIDs are captured in
      // BeforeState JSON, which is where filters/audit should read them from.
      if (updatedCount > 0 || deletedDuplicateCount > 0) {
        await writeEditOperation(
          connectionManager,
          schema,
          {
            operationType: 'bulk-revision-row',
            revertable: false,
            dataType: 'measurementssummary',
            targetID: null,
            plotID: normalizedPlotID,
            censusID: normalizedCensusID,
            planHash: bulkPlanHash,
            beforeState: [
              {
                table: 'bulk-revision-apply',
                primaryKey: 'bulkPlanHash',
                primaryKeyValue: bulkPlanHash,
                row: {
                  updatedCoreMeasurementIDs,
                  deletedDuplicateCoreMeasurementIDs: deletedDuplicateIDs,
                  updatedCount,
                  skippedCount,
                  insertedCount,
                  deletedDuplicateCount
                }
              }
            ],
            afterState: [],
            createdBy
          },
          transactionID
        );
      }

      return { updatedCount, skippedCount, insertedCount, deletedDuplicateCount, applyErrors };
    });
    ailogger.info(`${logPrefix} transaction complete in ${Date.now() - transactionStartedAt}ms`);

    const response: ApplyResponse = {
      updatedCount: result.updatedCount,
      skippedCount: result.skippedCount,
      insertedCount: result.insertedCount,
      deletedDuplicateCount: result.deletedDuplicateCount,
      applyErrors: result.applyErrors,
      validationPending: result.updatedCount > 0 || result.insertedCount > 0 || result.deletedDuplicateCount > 0
    };

    ailogger.info(
      `${logPrefix} response ready in ${Date.now() - requestStartedAt}ms (updated=${response.updatedCount}, inserted=${response.insertedCount}, deletedDuplicate=${response.deletedDuplicateCount}, skipped=${response.skippedCount}, validationPending=${response.validationPending})`
    );
    return NextResponse.json(response, { status: HTTPResponses.OK });
  } catch (error: unknown) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    ailogger.error(`${logPrefix} request failed after ${Date.now() - requestStartedAt}ms:`, errorObj);
    if (errorObj instanceof SessionExpiredError) {
      return NextResponse.json({ error: 'session expired' }, { status: HTTPResponses.UNAUTHORIZED });
    }
    if (errorObj instanceof ScopeAccessError) {
      return NextResponse.json({ error: 'scope forbidden' }, { status: HTTPResponses.FORBIDDEN });
    }
    if (errorObj instanceof ScopeLockHeldError) {
      return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.LOCKED });
    }
    if (errorObj instanceof ScopeBusyError) {
      return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.LOCKED });
    }
    if (errorObj instanceof RoleForbiddenFieldError) {
      return NextResponse.json({ error: 'role forbidden field', fields: errorObj.fields, role: errorObj.role }, { status: HTTPResponses.FORBIDDEN });
    }
    if (errorObj instanceof RevisionApplyPlanHashMismatchError) {
      return NextResponse.json({ error: 'plan hash mismatch', freshPlan: errorObj.freshPlan }, { status: HTTPResponses.CONFLICT });
    }
    if (errorObj instanceof BulkPlanUnapplicableError) {
      return NextResponse.json({ error: 'plan not applicable', blockingErrors: errorObj.blockingErrors }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }
    if (errorObj instanceof MeasurementResolutionError) {
      return NextResponse.json({ error: errorObj.message, subject: errorObj.subject, reason: errorObj.reason }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }
    const status = errorObj instanceof RevisionApplyConflictError ? HTTPResponses.CONFLICT : HTTPResponses.INTERNAL_SERVER_ERROR;
    return NextResponse.json({ error: errorObj.message }, { status });
  } finally {
    await connectionManager.closeConnection();
  }
}
