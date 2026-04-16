import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import ConnectionManager from '@/config/connectionmanager';
import { isValidSchema, safeFormatQuery } from '@/config/utils/sqlsecurity';
import { HTTPResponses } from '@/config/macros';
import { FileRow } from '@/config/macros/formdetails';
import { generateShortBatchID } from '@/config/utils';
import { isMySQLError } from '@/lib/errorhelpers';
import ailogger from '@/ailogger';
import { ACTIVE_UPLOAD_SESSION_STATES, ensureUploadSessionsTable, SESSION_TIMEOUTS } from '@/config/uploadsessiontracker';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';

export const runtime = 'nodejs';

const MYSQL_ER_DUP_ENTRY = 'ER_DUP_ENTRY';

const REVISION_UPLOAD_FILE_ID = 'revision-upload';
const STALE_VALIDATION_RUN_THRESHOLD_MINUTES = 15;
const ACTIVE_UPLOAD_SESSION_HEARTBEAT_TIMEOUT_SECONDS = Math.ceil(SESSION_TIMEOUTS.HEARTBEAT_TIMEOUT / 1000);

class RevisionApplyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevisionApplyConflictError';
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
 * Builds the SET clause and params for a single matched-row UPDATE.
 * Returns null if no CSV fields are non-empty (row should be skipped).
 *
 * Fields updated:
 *  - dbh      → MeasuredDBH (parseFloat)
 *  - hom      → MeasuredHOM (parseFloat)
 *  - date     → MeasurementDate (normalized to YYYY-MM-DD)
 *  - codes    → RawCodes (raw string; cmattributes handled separately)
 *  - comments → Description + RawComments (same value to both)
 *
 * UploadFileID and UploadBatchID are never touched — original ingestion
 * provenance is preserved.
 */
function buildUpdateClause(csvRow: FileRow): { setClauses: string[]; setParams: (string | number | null)[] } | null {
  const setClauses: string[] = [];
  const setParams: (string | number | null)[] = [];

  const dbh = csvRow['dbh'];
  if (dbh !== null && dbh !== undefined && String(dbh).trim() !== '') {
    const parsed = parseFloat(String(dbh).trim());
    if (!isNaN(parsed)) {
      setClauses.push('MeasuredDBH = ?');
      setParams.push(parsed);
    }
  }

  const hom = csvRow['hom'];
  if (hom !== null && hom !== undefined && String(hom).trim() !== '') {
    const parsed = parseFloat(String(hom).trim());
    if (!isNaN(parsed)) {
      setClauses.push('MeasuredHOM = ?');
      setParams.push(parsed);
    }
  }

  const date = csvRow['date'];
  if (date !== null && date !== undefined && String(date).trim() !== '') {
    setClauses.push('MeasurementDate = ?');
    setParams.push(normalizeDateForSQL(String(date).trim()));
  }

  const codes = csvRow['codes'];
  if (codes !== null && codes !== undefined && String(codes).trim() !== '') {
    setClauses.push('RawCodes = ?');
    setParams.push(String(codes).trim());
  }

  const comments = csvRow['comments'];
  if (comments !== null && comments !== undefined && String(comments).trim() !== '') {
    const commentValue = String(comments).trim();
    setClauses.push('Description = ?', 'RawComments = ?');
    setParams.push(commentValue, commentValue);
  }

  if (setClauses.length === 0) return null;

  // Always reset validation state when any field changes
  setClauses.push('IsValidated = NULL');

  return { setClauses, setParams };
}

/**
 * Parses a semicolon-separated codes string into individual attribute codes.
 */
function parseCodesSemicolon(codesStr: string): string[] {
  return codesStr
    .split(';')
    .map(c => c.trim())
    .filter(c => c.length > 0);
}

/**
 * Applies a single matched-row update within an open transaction.
 * Handles TOCTOU re-resolve, UPDATE, cmattributes rebuild, and error log clear.
 *
 * @returns 'updated' | 'skipped' | 'error'
 */
async function applyMatchedRowUpdate(
  connectionManager: ConnectionManager,
  schema: string,
  plotID: number,
  censusID: number,
  row: ApplyMatchedRow,
  transactionID: string
): Promise<{ result: 'updated' | 'skipped' | 'error'; applyError?: ApplyError }> {
  const { coreMeasurementID, csvRow } = row;

  const stillActive = await verifyMeasurementStillActive(connectionManager, schema, coreMeasurementID, censusID, plotID, transactionID);
  if (!stillActive) {
    return {
      result: 'error',
      applyError: {
        coreMeasurementID,
        error: 'Measurement no longer active in this plot/census — may have been deactivated since upload was matched'
      }
    };
  }

  const updateClause = buildUpdateClause(csvRow);
  if (updateClause === null) {
    return { result: 'skipped' };
  }

  const { setClauses, setParams } = updateClause;
  const updateSQL = safeFormatQuery(schema, `UPDATE ??.coremeasurements SET ${setClauses.join(', ')} WHERE CoreMeasurementID = ?`);

  try {
    await connectionManager.executeQuery(updateSQL, [...setParams, coreMeasurementID], transactionID);
  } catch (error: unknown) {
    if (isMySQLError(error) && error.code === MYSQL_ER_DUP_ENTRY) {
      return {
        result: 'error',
        applyError: {
          coreMeasurementID,
          error: `Duplicate measurement constraint violation: ${error.sqlMessage ?? error.message}`
        }
      };
    }
    throw error;
  }

  const codesValue = csvRow['codes'];
  if (codesValue !== null && codesValue !== undefined && String(codesValue).trim() !== '') {
    const deleteAttributesSQL = safeFormatQuery(schema, 'DELETE FROM ??.cmattributes WHERE CoreMeasurementID = ?');
    await connectionManager.executeQuery(deleteAttributesSQL, [coreMeasurementID], transactionID);

    const parsedCodes = parseCodesSemicolon(String(codesValue).trim());
    if (parsedCodes.length > 0) {
      const insertPlaceholders = parsedCodes.map(() => '(?, ?)').join(', ');
      const insertAttributesSQL = safeFormatQuery(schema, `INSERT IGNORE INTO ??.cmattributes (CoreMeasurementID, Code) VALUES ${insertPlaceholders}`);
      const insertAttributesParams = parsedCodes.flatMap(code => [coreMeasurementID, code]);
      await connectionManager.executeQuery(insertAttributesSQL, insertAttributesParams, transactionID);
    }
  }

  const clearErrorsSQL = safeFormatQuery(
    schema,
    `DELETE mel
     FROM ??.measurement_error_log mel
     JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
     WHERE mel.MeasurementID = ?
       AND mel.IsResolved = FALSE
       AND me.ErrorSource = 'validation'`
  );
  await connectionManager.executeQuery(clearErrorsSQL, [coreMeasurementID], transactionID);

  return { result: 'updated' };
}

/**
 * Validates duplicate-deletion requests against the matched rows before any DB work.
 * Rejects if:
 *  - a duplicate ID equals a survivor ID (would delete the row we're about to update)
 *  - a duplicate ID appears more than once in the array
 *  - a duplicate ID is claimed by two different survivors
 *  - a survivor ID is not present in matchedRows
 */
function validateDuplicateRequests(
  duplicates: DuplicateToDelete[],
  matchedRows: ApplyMatchedRow[]
): ApplyError[] {
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
  const rowsDeleted = (deleteResult as any).affectedRows ?? 0;
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
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: HTTPResponses.UNAUTHORIZED });
  }

  let body: ApplyRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const { matchedRows, newRows, confirmNewRows, duplicateMeasurementIDsToDelete, schema, plotID, censusID } = body;

  if (!Array.isArray(matchedRows) || !Array.isArray(newRows) || plotID === undefined || censusID === undefined || !schema) {
    return NextResponse.json(
      { error: 'Missing required parameters: matchedRows (array), newRows (array), plotID, censusID, schema' },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  // Pre-flight validation of duplicate deletion requests (before opening a transaction)
  const duplicates = Array.isArray(duplicateMeasurementIDsToDelete) ? duplicateMeasurementIDsToDelete : [];
  if (duplicates.length > 0) {
    const preflightErrors = validateDuplicateRequests(duplicates, matchedRows);
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
    await ensureUploadSessionsTable(schema);

    const result = await connectionManager.withTransaction(async (transactionID: string) => {
      await assertNoConflictingApplyActivity(connectionManager, schema, plotID, censusID, transactionID);

      let updatedCount = 0;
      let skippedCount = 0;
      const applyErrors: ApplyError[] = [];

      for (const row of matchedRows) {
        const applyResult = await applyMatchedRowUpdate(connectionManager, schema, plotID, censusID, row, transactionID);

        if (applyResult.result === 'updated') {
          updatedCount++;
        } else if (applyResult.result === 'skipped') {
          skippedCount++;
        } else if (applyResult.result === 'error' && applyResult.applyError) {
          applyErrors.push(applyResult.applyError);
        }
      }

      // --- Delete verified duplicates ---
      let deletedDuplicateCount = 0;
      for (const dup of duplicates) {
        const dupResult = await verifyAndDeleteDuplicate(connectionManager, schema, dup, censusID, plotID, transactionID);
        deletedDuplicateCount += dupResult.deleted;
        if (dupResult.applyError) {
          applyErrors.push(dupResult.applyError);
        }
      }

      let insertedCount = 0;
      if (confirmNewRows && newRows.length > 0) {
        insertedCount = await insertNewRowsThroughPipeline(connectionManager, schema, plotID, censusID, newRows, transactionID);
      }

      return { updatedCount, skippedCount, insertedCount, deletedDuplicateCount, applyErrors };
    });

    const response: ApplyResponse = {
      updatedCount: result.updatedCount,
      skippedCount: result.skippedCount,
      insertedCount: result.insertedCount,
      deletedDuplicateCount: result.deletedDuplicateCount,
      applyErrors: result.applyErrors,
      validationPending: result.updatedCount > 0 || result.insertedCount > 0 || result.deletedDuplicateCount > 0
    };

    return NextResponse.json(response, { status: HTTPResponses.OK });
  } catch (error: unknown) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    ailogger.error('[revisionupload/apply] Transaction failed:', errorObj);
    const status = errorObj instanceof RevisionApplyConflictError ? HTTPResponses.CONFLICT : HTTPResponses.INTERNAL_SERVER_ERROR;
    return NextResponse.json({ error: errorObj.message }, { status });
  } finally {
    await connectionManager.closeConnection();
  }
}
