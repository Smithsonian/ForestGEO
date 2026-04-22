import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import ConnectionManager from '@/config/connectionmanager';
import { isValidSchema, safeFormatQuery } from '@/config/utils/sqlsecurity';
import { HTTPResponses } from '@/config/macros';
import { FileRow } from '@/config/macros/formdetails';
import { generateShortBatchID } from '@/config/utils';
import ailogger from '@/ailogger';
import { ACTIVE_UPLOAD_SESSION_STATES, ensureUploadSessionsTable, SESSION_TIMEOUTS } from '@/config/uploadsessiontracker';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';
import { refreshMeasurementViewsForScope } from '@/lib/measurementviewrefresh';
import { applyEditInTransaction } from '@/config/editplan/apply';
import { analyzeBulk, BulkInput } from '@/config/editplan/bulkanalyzer';

export const runtime = 'nodejs';

const UPDATABLE_FIELDS = ['dbh', 'hom', 'date', 'codes', 'comments'] as const;

const REVISION_UPLOAD_FILE_ID = 'revision-upload';
const STALE_VALIDATION_RUN_THRESHOLD_MINUTES = 15;
const ACTIVE_UPLOAD_SESSION_HEARTBEAT_TIMEOUT_SECONDS = Math.ceil(SESSION_TIMEOUTS.HEARTBEAT_TIMEOUT / 1000);

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
}

interface DuplicateToDelete {
  coreMeasurementID: number;
  survivorCoreMeasurementID: number;
}

interface ApplyRequest {
  matchedRows: ApplyMatchedRow[];
  newRows: FileRow[];
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

function getAffectedRowCount(result: unknown): number {
  if (!result || typeof result !== 'object' || !('affectedRows' in result)) {
    return 0;
  }

  const affectedRows = (result as { affectedRows?: unknown }).affectedRows;
  return typeof affectedRows === 'number' && Number.isFinite(affectedRows) ? affectedRows : 0;
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

    matchedRows.push({
      coreMeasurementID,
      csvRow: row?.csvRow ?? {}
    });
  });

  return { matchedRows, applyErrors };
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

/**
 * Maps the CSV's lowercase updatable field keys (`dbh`, `hom`, `date`,
 * `codes`, `comments`) onto the canonical `measurementssummary` surface keys
 * the bulk analyzer and applyEditInTransaction writer expect. Blank/NULL
 * placeholders are dropped so the analyzer's diff only sees real intended
 * writes. `codes` is renamed to `Attributes` so the R5 attribute rule fires
 * on code changes. `date` values are normalized to YYYY-MM-DD.
 *
 * This mirrors `buildAnalyzerNewRow` in `app/api/revisionupload/route.ts`
 * so the apply-time canonical newRow is identical to the one analyzeBulk
 * saw at match time — otherwise the re-computed plan hash will drift.
 */
function buildCanonicalNewRow(csvRow: FileRow): Record<string, unknown> {
  const newRow: Record<string, unknown> = {};
  for (const field of UPDATABLE_FIELDS) {
    const value = csvRow[field];
    if (value === null || value === undefined) continue;
    const trimmed = String(value).trim();
    if (trimmed === '' || trimmed.toUpperCase() === 'NULL') continue;

    if (field === 'codes') {
      newRow.Attributes = trimmed;
    } else if (field === 'dbh') {
      newRow.MeasuredDBH = trimmed;
    } else if (field === 'hom') {
      newRow.MeasuredHOM = trimmed;
    } else if (field === 'date') {
      newRow.MeasurementDate = normalizeDateForSQL(trimmed);
    } else if (field === 'comments') {
      newRow.Description = trimmed;
    }
  }
  return newRow;
}

function hasAnyCanonicalField(csvRow: FileRow): boolean {
  return Object.keys(buildCanonicalNewRow(csvRow)).length > 0;
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
    throw new RevisionApplyConflictError(`Another measurement operation is already in progress for plot ${plotID}, census ${censusID}`);
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
    throw new RevisionApplyConflictError(
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
      throw new RevisionApplyConflictError(
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

  const { matchedRows, newRows, confirmNewRows, duplicateMeasurementIDsToDelete, schema, plotID, censusID, bulkPlanHash } = body;

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
  if (normalizedMatchedRows.applyErrors.length > 0) {
    return NextResponse.json(
      { error: 'Matched rows failed validation', applyErrors: normalizedMatchedRows.applyErrors },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  // Pre-flight validation of duplicate deletion requests (before opening a transaction)
  const normalizedDuplicateResults = normalizeDuplicates(Array.isArray(duplicateMeasurementIDsToDelete) ? duplicateMeasurementIDsToDelete : []);
  if (normalizedDuplicateResults.applyErrors.length > 0) {
    return NextResponse.json(
      { error: 'Duplicate deletion request failed validation', applyErrors: normalizedDuplicateResults.applyErrors },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  const duplicates = normalizedDuplicateResults.duplicates;
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

  const connectionManager = ConnectionManager.getInstance();

  try {
    const ensureSessionsStartedAt = Date.now();
    await ensureUploadSessionsTable(schema);
    ailogger.info(`${logPrefix} ensureUploadSessionsTable complete in ${Date.now() - ensureSessionsStartedAt}ms for schema=${schema}`);

    const transactionStartedAt = Date.now();
    ailogger.info(`${logPrefix} transaction requested for schema=${schema} plot=${normalizedPlotID} census=${normalizedCensusID}`);
    const createdBy = session.user.email ?? session.user.name ?? 'revision-apply';
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
          newRow: buildCanonicalNewRow(row.csvRow)
        })),
        newRows: newRows.map((csvRow, index) => ({
          rowIndex: index,
          newRow: buildCanonicalNewRow(csvRow)
        })),
        invalid: [],
        duplicateMeasurementIDsToDelete: duplicates.map(d => d.coreMeasurementID)
      };
      const freshPlan = await analyzeBulk(
        connectionManager,
        schema,
        'measurementssummary',
        normalizedPlotID,
        normalizedCensusID,
        bulkInputForHashCheck,
        transactionID
      );
      if (freshPlan.planHash !== bulkPlanHash) {
        ailogger.warn(
          `${logPrefix} bulk plan hash mismatch (expected=${bulkPlanHash}, fresh=${freshPlan.planHash}) — aborting apply so UI can re-review`
        );
        throw new RevisionApplyPlanHashMismatchError(freshPlan);
      }

      let updatedCount = 0;
      let skippedCount = 0;
      const applyErrors: ApplyError[] = [];

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
          applyErrors.push({
            coreMeasurementID: row.coreMeasurementID,
            error: 'Measurement no longer active in this plot/census — may have been deactivated since upload was matched'
          });
          continue;
        }

        if (!hasAnyCanonicalField(row.csvRow)) {
          skippedCount++;
          continue;
        }

        const canonicalNewRow = buildCanonicalNewRow(row.csvRow);

        await applyEditInTransaction(connectionManager, {
          dataType: 'measurementssummary',
          schema,
          plotID: normalizedPlotID,
          censusID: normalizedCensusID,
          targetID: row.coreMeasurementID,
          newRow: canonicalNewRow,
          expectedPlanHash: null,
          operationType: 'bulk-revision-row',
          writeLedger: false,
          createdBy,
          transactionID
        });

        updatedCount++;
      }

      // --- Delete verified duplicates ---
      let deletedDuplicateCount = 0;
      for (const dup of duplicates) {
        const dupResult = await verifyAndDeleteDuplicate(connectionManager, schema, dup, normalizedCensusID, normalizedPlotID, transactionID);
        deletedDuplicateCount += dupResult.deleted;
        if (dupResult.applyError) {
          applyErrors.push(dupResult.applyError);
        }
      }

      let insertedCount = 0;
      if (confirmNewRows && newRows.length > 0) {
        insertedCount = await insertNewRowsThroughPipeline(connectionManager, schema, normalizedPlotID, normalizedCensusID, newRows, transactionID);
      }

      if (updatedCount > 0 || insertedCount > 0 || deletedDuplicateCount > 0) {
        const viewRefreshStartedAt = Date.now();
        ailogger.info(
          `${logPrefix} derived view refresh start (tx=${transactionID}, updated=${updatedCount}, inserted=${insertedCount}, deletedDuplicate=${deletedDuplicateCount})`
        );
        await refreshMeasurementViewsForScope(connectionManager, schema, normalizedPlotID, normalizedCensusID, transactionID);
        ailogger.info(`${logPrefix} derived view refresh complete in ${Date.now() - viewRefreshStartedAt}ms (tx=${transactionID})`);
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
    if (errorObj instanceof RevisionApplyPlanHashMismatchError) {
      return NextResponse.json({ error: 'plan hash mismatch', freshPlan: errorObj.freshPlan }, { status: HTTPResponses.CONFLICT });
    }
    const status = errorObj instanceof RevisionApplyConflictError ? HTTPResponses.CONFLICT : HTTPResponses.INTERNAL_SERVER_ERROR;
    return NextResponse.json({ error: errorObj.message }, { status });
  } finally {
    await connectionManager.closeConnection();
  }
}
