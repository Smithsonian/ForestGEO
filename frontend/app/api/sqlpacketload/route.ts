import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses, InsertUpdateProcessingProps } from '@/config/macros';
import { FileRow, FileRowSet, normalizeSourceFormat, SourceFormat } from '@/config/macros/formdetails';
import { NextRequest, NextResponse } from 'next/server';
import { Plot } from '@/lib/db/definitions/zones';
import { OrgCensus } from '@/lib/db/definitions/timekeeping';
import { insertOrUpdate } from '@/components/processors/processorhelperfunctions';
import { generateShortBatchID, handleUpsert } from '@/config/utils';
import { getCookie } from '@/app/actions/cookiemanager';
import ailogger from '@/ailogger';
import { auth } from '@/auth';
import { format } from 'mysql2/promise';
import { isValidSchema, safeFormatQuery } from '@/lib/db/sqlsecurity';
import crypto from 'crypto';
import { requireUploadSessionOwnership, UploadSessionOwnershipError, UploadSessionState as TrackedUploadSessionState } from '@/config/uploadsessiontracker';
import { normalizeUploadMode, UploadMode } from '@/config/uploadmodes';
import { QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT, type QuadratOverlapSummary } from '@/lib/provisioning/quadrat-collection-validation';
import { QuadratGeometryValidationError, QuadratOverlapAcknowledgmentRequiredError, writeQuadratUpload } from '@/lib/ingestion/quadrat-write-boundary';
import { QUADRAT_OVERLAP_ACKNOWLEDGMENT_REQUIRED_CODE } from '@/lib/ingestion/quadrat-overlap-contract';
import { FamilyResult, GenusResult } from '@/lib/db/definitions/taxonomies';
import { RoleResult } from '@/lib/db/definitions/personnel';
import { requireSession } from '@/lib/auth-helpers';
import { assertSchemaAccess } from '@/lib/authz';
import { isColumnMappingShape } from '@/lib/column-mapping/mapping';
import { MeasurementChunkResolutionError, stageMeasurementChunk } from '@/lib/uploads/stage-measurements';
import {
  type FixedDataProcessingResult,
  normalizeOptionalString,
  normalizeRequiredString,
  upsertAttributeRows,
  upsertSpeciesRows
} from '@/lib/uploads/reference-data-writers';

/**
 * Generate idempotency key for a batch of data
 * This allows us to detect and skip duplicate submissions
 * IMPORTANT: Uses content hash to differentiate chunks from the same file
 */
function generateIdempotencyKey(fileName: string, plotId: number, censusId: number, rowCount: number, contentHash: string): string {
  return `${fileName}_${plotId}_${censusId}_${rowCount}_${contentHash}`;
}

/**
 * Generate a hash of the chunk content for idempotency checking
 * CRITICAL: Hashes ALL rows in the chunk to uniquely identify this specific chunk
 * This prevents false duplicate detection when different chunks have the same row count
 *
 * Uses full SHA-256 hash (64 chars) instead of truncated MD5 for:
 * - Stronger collision resistance
 * - Better uniqueness guarantees for large datasets
 */
function hashChunkContent(fileRowSet: FileRowSet): string {
  const rows = Object.values(fileRowSet);
  if (rows.length === 0) return 'empty';
  // Sort rows by a consistent key to ensure same data produces same hash regardless of order
  const sortedRows = rows.map(row => JSON.stringify(row)).sort();
  const data = sortedRows.join('|');
  // Use full SHA-256 hash for better collision resistance
  return crypto.createHash('sha256').update(data).digest('hex');
}

function toPositiveInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildMeasurementScopeErrorResponse(status: HTTPResponses, message: string, details: Record<string, unknown>): NextResponse {
  return new NextResponse(
    JSON.stringify({
      responseMessage: 'Measurement upload context mismatch',
      error: message,
      details
    }),
    { status }
  );
}

function authenticatedSessionIdentity(sessionUser: unknown): string {
  if (!sessionUser || typeof sessionUser !== 'object' || Array.isArray(sessionUser)) return 'authenticated-user';
  const record = sessionUser as Record<string, unknown>;
  for (const key of ['email', 'name', 'id']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return 'authenticated-user';
}

async function insertQuadratOverlapAcknowledgmentEvent(
  connectionManager: ConnectionManager,
  schema: string,
  fileName: string,
  uploadMode: UploadMode,
  uploadSessionId: string | null,
  plotID: number | undefined,
  censusID: number | undefined,
  sessionUser: unknown,
  summaries: QuadratOverlapSummary[],
  transactionID: string
): Promise<void> {
  const changedBy = authenticatedSessionIdentity(sessionUser);
  const layoutSignatures = summaries.map(summary => summary.layoutSignature).sort();
  const recordID = crypto
    .createHash('sha256')
    .update([schema, plotID ?? '', censusID ?? '', fileName, uploadSessionId ?? '', ...layoutSignatures].join('#'))
    .digest('hex')
    .slice(0, 40);
  const eventState = JSON.stringify({
    statement: QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT,
    acknowledgedBy: changedBy,
    fileName,
    uploadMode,
    uploadSessionId,
    summaries
  });
  // Keep acknowledgment provenance immutable and avoid the file_upload JSON merge entirely.
  // The deterministic RecordID makes a retry of the same upload event idempotent.
  const insertSQL = safeFormatQuery(
    schema,
    `INSERT INTO ??.unifiedchangelog
       (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
     SELECT ?, ?, 'INSERT', ?, NOW(), ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1
       FROM ??.unifiedchangelog
       WHERE TableName = 'quadrat_overlap_acknowledgment'
         AND RecordID = ?
         AND Operation = 'INSERT'
     )`
  );
  await connectionManager.executeQuery(
    insertSQL,
    ['quadrat_overlap_acknowledgment', recordID, eventState, changedBy, plotID, censusID, recordID],
    transactionID
  );
}

function isSupportedUploadMode(value: unknown): value is UploadMode {
  return value === UploadMode.CLEAN_REUPLOAD || value === UploadMode.REVISIONS;
}

async function rollbackPreservingOriginalError(connectionManager: ConnectionManager, transactionID: string, context: Record<string, unknown>): Promise<void> {
  try {
    await connectionManager.rollbackTransaction(transactionID);
  } catch (rollbackError: unknown) {
    const error = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    ailogger.error(`Failed to roll back transaction ${transactionID}; preserving the original upload error`, error, context);
  }
}

function isRetryableUploadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const candidate = error as Error & { code?: string };
  return (
    candidate.message.includes('Lock wait timeout') ||
    candidate.message.includes('Deadlock') ||
    candidate.message.includes('Connection lost') ||
    candidate.message.includes('server has gone away') ||
    candidate.code === 'PROTOCOL_CONNECTION_LOST' ||
    candidate.code === 'ECONNRESET'
  );
}

function getUploadRetryDelayMs(attemptNumber: number): number {
  return Math.min(1000 * Math.pow(2, attemptNumber - 1), 10000);
}

async function upsertPersonnelRows(
  connectionManager: ConnectionManager,
  schema: string,
  censusID: number | undefined,
  rows: FileRow[],
  uploadMode: UploadMode,
  transactionID: string
): Promise<FixedDataProcessingResult> {
  if (!censusID) {
    throw new Error('CensusID is required for personnel uploads');
  }

  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  if (uploadMode === UploadMode.CLEAN_REUPLOAD) {
    // Remove all census-active links for this census
    const deleteCapSQL = format(`DELETE FROM ??.censusactivepersonnel WHERE CensusID = ?`, [schema]);
    await connectionManager.executeQuery(deleteCapSQL, [censusID], transactionID);
    // Remove personnel who are no longer linked to any census
    const deleteOrphanedSQL = format(
      `DELETE p FROM ??.personnel p
       LEFT JOIN ??.censusactivepersonnel cap ON cap.PersonnelID = p.PersonnelID
       WHERE cap.PersonnelID IS NULL AND p.IsActive = 1`,
      [schema, schema]
    );
    await connectionManager.executeQuery(deleteOrphanedSQL, [], transactionID);
  }

  for (const row of rows) {
    const firstName = normalizeRequiredString(row.firstname);
    const lastName = normalizeRequiredString(row.lastname);
    const roleName = normalizeRequiredString(row.role);
    const roleDescription = normalizeOptionalString(row.roledescription);

    if (!firstName || !lastName || !roleName) {
      skippedCount += 1;
      continue;
    }

    const normalizedRole = roleName
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();

    const roleID = (
      await handleUpsert<RoleResult>(
        connectionManager,
        schema,
        'roles',
        {
          RoleName: normalizedRole,
          RoleDescription: roleDescription
        },
        'RoleID',
        transactionID
      )
    ).id;

    if (uploadMode === UploadMode.REVISIONS) {
      const existingSQL = format(
        `SELECT p.PersonnelID FROM ??.personnel p
         WHERE LOWER(p.FirstName) = LOWER(?) AND LOWER(p.LastName) = LOWER(?) AND p.IsActive = 1
         LIMIT 1`,
        [schema]
      );
      const existingRows = await connectionManager.executeQuery(existingSQL, [firstName, lastName], transactionID);

      if (existingRows.length > 0) {
        const personnelID = Number(existingRows[0].PersonnelID);
        const updateSQL = format(`UPDATE ??.personnel SET FirstName = ?, LastName = ?, RoleID = ?, DeletedAt = NULL WHERE PersonnelID = ?`, [schema]);
        await connectionManager.executeQuery(updateSQL, [firstName, lastName, roleID, personnelID], transactionID);
        const capSQL = format(`INSERT IGNORE INTO ??.censusactivepersonnel (CensusID, PersonnelID) VALUES (?, ?)`, [schema]);
        await connectionManager.executeQuery(capSQL, [censusID, personnelID], transactionID);
        updatedCount += 1;
        continue;
      }
    }

    const insertSQL = format(`INSERT INTO ??.personnel (FirstName, LastName, RoleID, IsActive, DeletedAt) VALUES (?, ?, ?, 1, NULL)`, [schema]);
    const insertResult = await connectionManager.executeQuery(insertSQL, [firstName, lastName, roleID], transactionID);
    const personnelID = Number(insertResult.insertId);
    const capSQL = format(`INSERT IGNORE INTO ??.censusactivepersonnel (CensusID, PersonnelID) VALUES (?, ?)`, [schema]);
    await connectionManager.executeQuery(capSQL, [censusID, personnelID], transactionID);
    insertedCount += 1;
  }

  return { insertedCount, updatedCount, skippedCount };
}

async function validateMeasurementUploadScope(
  connectionManager: ConnectionManager,
  schema: string,
  fileName: string,
  batchID: string,
  plot: Plot | undefined,
  census: OrgCensus | undefined
): Promise<{ plotID: number; censusID: number } | NextResponse> {
  const bodyPlotID = toPositiveInteger(plot?.plotID);
  const bodyCensusID = toPositiveInteger(census?.dateRanges?.[0]?.censusID);
  const cookiePlotID = toPositiveInteger(await getCookie('plotID'));
  const cookieCensusID = toPositiveInteger(await getCookie('censusID'));

  if (bodyPlotID !== null && cookiePlotID !== null && bodyPlotID !== cookiePlotID) {
    ailogger.warn(`Measurement upload for ${fileName} has plotID mismatch between request body and cookie; preferring request body`, {
      fileName,
      batchID,
      bodyPlotID,
      cookiePlotID
    });
  }

  if (bodyCensusID !== null && cookieCensusID !== null && bodyCensusID !== cookieCensusID) {
    ailogger.warn(`Measurement upload for ${fileName} has censusID mismatch between request body and cookie; preferring request body`, {
      fileName,
      batchID,
      bodyCensusID,
      cookieCensusID
    });
  }

  const resolvedPlotID = bodyPlotID ?? cookiePlotID;
  const resolvedCensusID = bodyCensusID ?? cookieCensusID;

  if (resolvedPlotID === null || resolvedCensusID === null) {
    return buildMeasurementScopeErrorResponse(HTTPResponses.INVALID_REQUEST, 'Missing plotID or censusID for measurement upload', {
      fileName,
      batchID,
      bodyPlotID,
      bodyCensusID,
      cookiePlotID,
      cookieCensusID
    });
  }

  const censusScopeSQL = format(`SELECT PlotID FROM ??.census WHERE CensusID = ? LIMIT 1`, [schema]);
  const censusScopeResult = await connectionManager.executeQuery(censusScopeSQL, [resolvedCensusID]);
  const censusPlotID = toPositiveInteger(censusScopeResult?.[0]?.PlotID);

  if (censusPlotID === null) {
    ailogger.warn(`Rejected measurement upload for ${fileName}: census ${resolvedCensusID} not found in schema ${schema}`, {
      fileName,
      batchID,
      resolvedPlotID,
      resolvedCensusID
    });
    return buildMeasurementScopeErrorResponse(HTTPResponses.INVALID_REQUEST, `Census ${resolvedCensusID} was not found in schema ${schema}`, {
      fileName,
      batchID,
      resolvedPlotID,
      resolvedCensusID
    });
  }

  if (censusPlotID !== resolvedPlotID) {
    ailogger.warn(`Rejected measurement upload for ${fileName}: census ${resolvedCensusID} belongs to plot ${censusPlotID}, not ${resolvedPlotID}`, {
      fileName,
      batchID,
      resolvedPlotID,
      resolvedCensusID,
      censusPlotID
    });
    return buildMeasurementScopeErrorResponse(HTTPResponses.CONFLICT, 'censusID does not belong to the provided plotID', {
      fileName,
      batchID,
      resolvedPlotID,
      resolvedCensusID,
      censusPlotID
    });
  }

  const batchScopeSQL = format(
    `SELECT COUNT(DISTINCT PlotID) as distinctPlotCount,
            COUNT(DISTINCT CensusID) as distinctCensusCount,
            MIN(PlotID) as plotID,
            MIN(CensusID) as censusID
     FROM ??.temporarymeasurements
     WHERE FileID = ? AND BatchID = ?`,
    [schema]
  );
  const batchScopeResult = await connectionManager.executeQuery(batchScopeSQL, [fileName, batchID]);
  const batchScope = batchScopeResult?.[0] ?? {};
  const distinctPlotCount = Number(batchScope.distinctPlotCount ?? 0);
  const distinctCensusCount = Number(batchScope.distinctCensusCount ?? 0);
  const batchPlotID = toPositiveInteger(batchScope.plotID ?? batchScope.PlotID);
  const batchCensusID = toPositiveInteger(batchScope.censusID ?? batchScope.CensusID);

  if (distinctPlotCount > 1 || distinctCensusCount > 1) {
    ailogger.error(
      `Rejected measurement upload for ${fileName}: existing batch ${batchID} already contains mixed plot/census scope ` +
        `(plots=${distinctPlotCount}, censuses=${distinctCensusCount}, batchPlotID=${batchPlotID}, batchCensusID=${batchCensusID})`
    );
    return buildMeasurementScopeErrorResponse(HTTPResponses.CONFLICT, 'Existing batch contains mixed plot/census scope', {
      fileName,
      batchID,
      distinctPlotCount,
      distinctCensusCount,
      batchPlotID,
      batchCensusID
    });
  }

  if ((batchPlotID !== null && batchPlotID !== resolvedPlotID) || (batchCensusID !== null && batchCensusID !== resolvedCensusID)) {
    ailogger.warn(`Rejected measurement upload for ${fileName}: existing batch scope does not match incoming plot/census`, {
      fileName,
      batchID,
      resolvedPlotID,
      resolvedCensusID,
      batchPlotID,
      batchCensusID
    });
    return buildMeasurementScopeErrorResponse(HTTPResponses.CONFLICT, 'Existing batch scope does not match incoming plot/census', {
      fileName,
      batchID,
      resolvedPlotID,
      resolvedCensusID,
      batchPlotID,
      batchCensusID
    });
  }

  return { plotID: resolvedPlotID, censusID: resolvedCensusID };
}

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  // Authentication check
  const session = await auth();
  const authError = requireSession(session);
  if (authError) {
    ailogger.warn('Unauthorized upload attempt - no session');
    return authError;
  }

  let body;

  try {
    body = await request.json();
  } catch (error: any) {
    ailogger.error('Error parsing JSON body:', error);
    return new NextResponse(
      JSON.stringify({
        responseMessage: 'Invalid or empty JSON body in the request',
        error: error.message
      }),
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be a JSON object', code: 'INVALID_REQUEST_BODY' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const schema: string = body.schema;

  // SQL Injection Prevention: Validate schema against whitelist
  if (!isValidSchema(schema)) {
    ailogger.error(`Invalid schema provided: ${schema}. Allowed schemas: forestgeo, forestgeo_testing, forestgeo_testing_alternate, catalog`);
    return new NextResponse(
      JSON.stringify({
        responseMessage: 'Invalid schema',
        error: 'The provided schema is not allowed'
      }),
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  // Phase-3: user→schema membership enforced INLINE rather than via `withRouteAuthz` +
  // `fromBody('schema')`. This route accepts a potentially large upload body; `fromBody`
  // clones and fully re-parses the whole body to read one field, doubling parse cost on
  // the hot upload path. The handler already parsed the body and authenticated the session
  // above, so we reuse the resolved `schema` and `session` directly. The measurements branch
  // below retains `requireUploadSessionOwnership` for plot/census token ownership — this adds
  // the missing user→schema check on top. The meta-test (app/api/route-policy.test.ts)
  // recognises the `assertSchemaAccess` + `if (denied) return denied` pair as a valid signal.
  const denied = assertSchemaAccess(session!, schema);
  if (denied) return denied;

  const formType: string = body.formType;
  const sourceFormat = normalizeSourceFormat(body.sourceFormat ?? SourceFormat.csv);
  if (sourceFormat !== SourceFormat.csv) {
    return new NextResponse(
      JSON.stringify({
        responseMessage: 'Invalid source format',
        error: `sourceFormat must be ${SourceFormat.csv}`
      }),
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }
  if (body.uploadMode !== undefined && !isSupportedUploadMode(body.uploadMode)) {
    return NextResponse.json(
      {
        error: `uploadMode must be ${UploadMode.CLEAN_REUPLOAD} or ${UploadMode.REVISIONS}`,
        code: 'INVALID_UPLOAD_MODE'
      },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }
  const uploadMode = normalizeUploadMode(body.uploadMode);
  const plot: Plot = body.plot;
  const census: OrgCensus = body.census;
  const user: string = body.user;
  const fileRowSet: FileRowSet = body.fileRowSet ?? {};
  const fileName: string = body.fileName;
  // Optional RAW-rows path (#6, server half): when present, the server re-resolves/keys/validates
  // CSV headers via the shared pipeline instead of trusting client-computed keys in fileRowSet.
  const rawRows: Record<string, string>[] | undefined = Array.isArray(body.rawRows) ? body.rawRows : undefined;
  const csvHeaders: string[] = Array.isArray(body.csvHeaders) ? body.csvHeaders : [];
  const clientMapping: unknown = body.mapping;
  const csvDelimiter: string = typeof body.delimiter === 'string' && body.delimiter.length > 0 ? body.delimiter : ',';
  let transactionID: string | undefined;
  const failingRows: Set<FileRow> = new Set<FileRow>();
  const connectionManager = ConnectionManager.getInstance();
  const maxRetries = 3;
  let retryCount = 0;
  const sessionId = request.headers.get('x-upload-session-id');
  if (formType === 'measurements') {
    const batchID = body.batchID || generateShortBatchID();
    let scopeValidation: Awaited<ReturnType<typeof validateMeasurementUploadScope>>;
    try {
      scopeValidation = await validateMeasurementUploadScope(connectionManager, schema, fileName, batchID, plot, census);
    } catch (error: any) {
      ailogger.error(`Failed to validate measurement upload scope for ${fileName}-${batchID}`, error);
      return new NextResponse(
        JSON.stringify({
          responseMessage: 'Failed to validate measurement upload scope',
          error: error.message,
          fileName,
          batchID
        }),
        { status: HTTPResponses.SERVICE_UNAVAILABLE }
      );
    }
    if (scopeValidation instanceof NextResponse) {
      return scopeValidation;
    }
    const { plotID: resolvedPlotID, censusID: resolvedCensusID } = scopeValidation;

    try {
      await requireUploadSessionOwnership({
        schema,
        sessionId,
        plotId: resolvedPlotID,
        censusId: resolvedCensusID,
        allowedStates: [TrackedUploadSessionState.INITIALIZED, TrackedUploadSessionState.UPLOADING],
        contextLabel: `measurement chunk upload for ${fileName}-${batchID}`
      });
    } catch (error: unknown) {
      if (error instanceof UploadSessionOwnershipError) {
        ailogger.warn(`Rejected measurement upload for ${fileName}-${batchID}: ${error.message}`);
        return new NextResponse(
          JSON.stringify({
            responseMessage: 'Upload session conflict',
            error: error.message,
            fileName,
            batchID
          }),
          { status: error.status }
        );
      }
      throw error;
    }

    // SERVER-RESOLUTION STAGE (#6): when the client sends RAW rows, the server is authoritative
    // over CSV header resolution (stageMeasurementChunk re-keys/validates via the shared
    // lib/column-mapping pipeline). Gated on rawRows + non-revisions so the legacy fileRowSet path
    // is byte identical. Revisions uploads keep their existing measurementID-matching path untouched.
    const useServerResolution = rawRows !== undefined && uploadMode !== UploadMode.REVISIONS;
    if (useServerResolution) {
      // Reject a malformed/tampered mapping at the wire boundary (parity with the arcgis preflight route).
      if (clientMapping !== undefined && clientMapping !== null && !isColumnMappingShape(clientMapping)) {
        return new NextResponse(JSON.stringify({ responseMessage: 'Invalid mapping payload', fileName, batchID }), { status: HTTPResponses.INVALID_REQUEST });
      }
    }

    // Captured before any DB write inside stageMeasurementChunk so error responses can still
    // report the resolution's parse rejects after a rollback.
    let resolutionInvalidRows: FileRow[] = [];
    // Surfaced from the staging result so silently-dropped columns / unparseable inputs are
    // visible to the client instead of vanishing.
    let mappingDiagnostics: { invalidDateValues: string[]; extraColumnRows: number; ignoredColumnCount: number } | null = null;

    // Retry logic for database operations
    while (retryCount <= maxRetries) {
      try {
        transactionID = await connectionManager.beginTransaction();

        const stageResult = await stageMeasurementChunk(connectionManager, {
          schema,
          fileName,
          batchID,
          plotID: resolvedPlotID,
          censusID: resolvedCensusID,
          uploadMode,
          sourceFormat,
          rawRows: rawRows ?? [],
          csvHeaders,
          delimiter: csvDelimiter,
          storedMapping: isColumnMappingShape(clientMapping) ? clientMapping : undefined,
          uploadSessionID: sessionId,
          transactionID,
          preKeyedRows: useServerResolution ? undefined : Object.values(fileRowSet ?? {}),
          changedBy: user,
          onInvalidRows: invalidRows => {
            resolutionInvalidRows = invalidRows;
          }
        });
        mappingDiagnostics = stageResult.diagnostics;

        await connectionManager.commitTransaction(transactionID);
        transactionID = undefined;

        // On the rawRows path fileRowSet is `{}`, which would make the hash constant across distinct
        // chunks and break idempotency. Hash the rows actually being inserted instead.
        const effectiveRowSet: FileRowSet = rawRows
          ? Object.fromEntries(stageResult.stagedRows.map((row, index) => [`row-${index}`, row] as const))
          : fileRowSet;
        const contentHash = hashChunkContent(effectiveRowSet);
        const idempotencyKey = generateIdempotencyKey(fileName, resolvedPlotID, resolvedCensusID, stageResult.stagedRows.length, contentHash);

        return new NextResponse(
          JSON.stringify({
            responseMessage:
              stageResult.droppedCount > 0
                ? `Bulk insert completed with ${stageResult.droppedCount} row(s) dropped - check unresolved ingestion errors`
                : `Bulk insert to SQL completed`,
            failingRows: stageResult.invalidRows,
            insertedCount: stageResult.insertedCount,
            expectedCount: stageResult.expectedCount,
            droppedCount: stageResult.droppedCount,
            dataIntegrityWarning: stageResult.droppedCount > 0,
            transactionCompleted: true,
            batchID: batchID,
            uploadMode,
            idempotencyKey,
            ...(mappingDiagnostics ? { mappingDiagnostics } : {})
          }),
          { status: HTTPResponses.OK }
        );
      } catch (e: any) {
        if (transactionID) {
          const failedTransactionID = transactionID;
          transactionID = undefined;
          await rollbackPreservingOriginalError(connectionManager, failedTransactionID, {
            schema,
            formType,
            fileName,
            uploadMode,
            branch: 'measurements'
          });
        }

        if (e instanceof MeasurementChunkResolutionError) {
          return new NextResponse(JSON.stringify({ responseMessage: 'Header plan misalignment for the uploaded file', fileName, batchID }), {
            status: HTTPResponses.UNPROCESSABLE_ENTITY
          });
        }

        retryCount++;
        if (isRetryableUploadError(e) && retryCount <= maxRetries) {
          const delay = getUploadRetryDelayMs(retryCount);
          ailogger.warn(`Retryable error for ${fileName} (attempt ${retryCount}/${maxRetries + 1}), retrying in ${delay}ms: ${e.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        ailogger.error(`Error processing file ${fileName} after ${retryCount} attempts:`, e.message);
        return new NextResponse(
          JSON.stringify({
            responseMessage: `Error processing file ${fileName}: ${e.message}`,
            failingRows: resolutionInvalidRows,
            retryCount
          }),
          { status: HTTPResponses.INTERNAL_SERVER_ERROR }
        );
      }
    }
  } else {
    const uploadRows = Object.values(fileRowSet);

    while (retryCount <= maxRetries) {
      let rowId = '';
      let fixedDataProcessingResult: FixedDataProcessingResult = { insertedCount: 0, updatedCount: 0, skippedCount: 0 };

      try {
        transactionID = await connectionManager.beginTransaction();

        if (formType === 'quadrats') {
          const overlapAcknowledgment: unknown = body.quadratOverlapAcknowledgment;
          fixedDataProcessingResult = await writeQuadratUpload(
            connectionManager,
            schema,
            plot?.plotID,
            uploadRows,
            uploadMode,
            overlapAcknowledgment,
            body.coordinateReferenceCorner,
            transactionID
          );
        } else if (formType === 'attributes') {
          fixedDataProcessingResult = await upsertAttributeRows(connectionManager, schema, uploadRows, uploadMode, transactionID);
        } else if (formType === 'species') {
          fixedDataProcessingResult = await upsertSpeciesRows(connectionManager, schema, uploadRows, uploadMode, transactionID);
        } else if (formType === 'personnel') {
          fixedDataProcessingResult = await upsertPersonnelRows(
            connectionManager,
            schema,
            census?.dateRanges?.[0]?.censusID,
            uploadRows,
            uploadMode,
            transactionID
          );
        } else {
          for (rowId in fileRowSet) {
            const row = fileRowSet[rowId];
            const props: InsertUpdateProcessingProps = {
              schema,
              connectionManager: connectionManager,
              formType,
              rowData: row,
              plot,
              census,
              fullName: user
            };
            try {
              await insertOrUpdate(props);
              fixedDataProcessingResult.updatedCount += 1;
            } catch (e: any) {
              ailogger.error(`Error processing row for file ${fileName}:`, e.message);
              failingRows.add(row);
            }
          }
        }

        // Track file upload in unifiedchangelog (single row per file)
        try {
          const batchRowCount = Object.keys(fileRowSet).length;
          const censusID = census?.dateRanges?.[0]?.censusID;

          // Check if we've already logged this file upload - use format() for schema
          const existingEntrySQL = format(
            `SELECT ChangeID, NewRowState FROM ??.unifiedchangelog
             WHERE TableName = 'file_upload' AND RecordID = ? AND CensusID = ?
             ORDER BY ChangeID DESC LIMIT 1`,
            [schema]
          );
          const existingEntry = await connectionManager.executeQuery(existingEntrySQL, [fileName, censusID], transactionID);

          if (existingEntry.length === 0) {
            // First batch for this file - insert new entry
            const uploadMetadata = JSON.stringify({
              fileName,
              formType,
              uploadMode,
              rowCount: batchRowCount,
              insertedCount: fixedDataProcessingResult.insertedCount,
              updatedCount: fixedDataProcessingResult.updatedCount,
              skippedCount: fixedDataProcessingResult.skippedCount,
              batchCount: 1
            });
            const insertChangelogSQL = format(
              `INSERT INTO ??.unifiedchangelog
              (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
              VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
              [schema]
            );
            await connectionManager.executeQuery(
              insertChangelogSQL,
              ['file_upload', fileName, 'INSERT', uploadMetadata, user, plot?.plotID, censusID],
              transactionID
            );
          } else {
            // Subsequent batch - update the existing entry with accumulated count
            // Handle both string and already-parsed object (MySQL driver may auto-parse JSON columns)
            const metadata = typeof existingEntry[0].NewRowState === 'string' ? JSON.parse(existingEntry[0].NewRowState) : existingEntry[0].NewRowState;
            // Preserve the user's initial mode across chunked fixed-data uploads. Later
            // quadrat chunks intentionally execute as revisions after the first clean-reset
            // chunk, but the file-level changelog must continue to say clean_reupload.
            metadata.uploadMode = metadata.uploadMode || uploadMode;
            metadata.lastChunkMode = uploadMode;
            metadata.rowCount = (metadata.rowCount || 0) + batchRowCount;
            metadata.insertedCount = (metadata.insertedCount || 0) + fixedDataProcessingResult.insertedCount;
            metadata.updatedCount = (metadata.updatedCount || 0) + fixedDataProcessingResult.updatedCount;
            metadata.skippedCount = (metadata.skippedCount || 0) + fixedDataProcessingResult.skippedCount;
            metadata.batchCount = (metadata.batchCount || 1) + 1;
            const updateChangelogSQL = format(`UPDATE ??.unifiedchangelog SET NewRowState = ?, ChangeTimestamp = NOW() WHERE ChangeID = ?`, [schema]);
            await connectionManager.executeQuery(updateChangelogSQL, [JSON.stringify(metadata), existingEntry[0].ChangeID], transactionID);
          }

          if (fixedDataProcessingResult.acknowledgedOverlapSummaries?.length) {
            await insertQuadratOverlapAcknowledgmentEvent(
              connectionManager,
              schema,
              fileName,
              uploadMode,
              sessionId,
              plot?.plotID,
              censusID,
              session?.user,
              fixedDataProcessingResult.acknowledgedOverlapSummaries,
              transactionID
            );
          }
        } catch (logError: any) {
          ailogger.error('Failed to log file upload to changelog', logError);
          // The changelog now shares the data transaction, so a transaction-fatal error here
          // (deadlock, lock-wait timeout, lost connection -- e.g. two concurrent chunks racing
          // on the same changelog row) may have rolled the WHOLE transaction back. Swallowing
          // it would let the commit below no-op "succeed" and return 200 while this chunk's
          // data rows were silently lost. Rethrow so the outer catch rolls back cleanly and
          // the retry loop re-runs the chunk.
          if (isRetryableUploadError(logError)) {
            throw logError;
          }
          // An overlap acknowledgment is part of the write authorization and provenance, not
          // optional telemetry. Keep it in the same transaction so an audit failure rolls the
          // quadrat data back. Preserve the legacy best-effort behavior for unrelated uploads.
          if (fixedDataProcessingResult.acknowledgedOverlapSummaries?.length) {
            throw new Error(`Failed to persist quadrat overlap acknowledgment: ${logError instanceof Error ? logError.message : String(logError)}`);
          }
        }

        await connectionManager.commitTransaction(transactionID ?? '');
        transactionID = undefined;

        return new NextResponse(
          JSON.stringify({
            responseMessage: uploadMode === UploadMode.REVISIONS ? `Revisions upload completed` : `Clean re-upload completed`,
            failingRows: Array.from(failingRows),
            insertedCount: fixedDataProcessingResult.insertedCount,
            updatedCount: fixedDataProcessingResult.updatedCount,
            skippedCount: fixedDataProcessingResult.skippedCount,
            uploadMode,
            transactionCompleted: true
          }),
          { status: HTTPResponses.OK }
        );
      } catch (error: any) {
        if (transactionID) {
          const failedTransactionID = transactionID;
          transactionID = undefined;
          await rollbackPreservingOriginalError(connectionManager, failedTransactionID, {
            schema,
            formType,
            fileName,
            uploadMode,
            branch: 'fixed-data'
          });
        }

        // Unacknowledged overlaps are a confirm-and-retry condition, not a data error: the
        // client re-submits the same file with the acknowledgment flag once the uploader
        // confirms the overlaps reflect field measurements. Distinct code so the UI can react.
        if (error instanceof QuadratOverlapAcknowledgmentRequiredError) {
          ailogger.warn(`Quadrat upload for ${fileName} requires overlap acknowledgment: ${error.message}`, {
            schema,
            plotID: plot?.plotID ?? null,
            uploadMode,
            code: QUADRAT_OVERLAP_ACKNOWLEDGMENT_REQUIRED_CODE
          });
          return NextResponse.json(
            {
              error: error.message,
              code: QUADRAT_OVERLAP_ACKNOWLEDGMENT_REQUIRED_CODE,
              overlapSummaries: [error.overlapSummary]
            },
            { status: HTTPResponses.INVALID_REQUEST }
          );
        }

        // A geometry validation failure is a client error, never a retryable infrastructure
        // failure -- check for it BEFORE retryCount/isRetryableUploadError so it can never be
        // retried and never falls through to the generic 503 responses below.
        if (error instanceof QuadratGeometryValidationError) {
          ailogger.warn(`Rejected quadrat upload for ${fileName}: ${error.message}`, {
            schema,
            plotID: plot?.plotID ?? null,
            uploadMode,
            rowCount: uploadRows.length,
            code: 'INVALID_QUADRAT_GEOMETRY'
          });
          return NextResponse.json({ error: error.message, code: 'INVALID_QUADRAT_GEOMETRY' }, { status: HTTPResponses.INVALID_REQUEST });
        }

        retryCount++;
        if (isRetryableUploadError(error) && retryCount <= maxRetries) {
          const delay = getUploadRetryDelayMs(retryCount);
          ailogger.warn(`Retryable fixed-data error for ${fileName} (attempt ${retryCount}/${maxRetries + 1}), retrying in ${delay}ms: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        ailogger.error('CATASTROPHIC ERROR: sqlpacketload: transaction rolled back.');
        ailogger.error(`Row ${rowId} failed processing:`, error);
        if (error instanceof Error) {
          ailogger.error(`Error processing row for file ${fileName}:`, error);
          return new NextResponse(
            JSON.stringify({
              responseMessage: `Error processing row in file ${fileName}`,
              error: error.message,
              failingRows: Array.from(failingRows),
              retryCount
            }),
            { status: HTTPResponses.SERVICE_UNAVAILABLE }
          );
        }

        ailogger.error('Unknown error processing row:', error);
        return new NextResponse(
          JSON.stringify({
            responseMessage: `Unknown processing error at row, in file ${fileName}`,
            failingRows: Array.from(failingRows),
            retryCount
          }),
          { status: HTTPResponses.SERVICE_UNAVAILABLE }
        );
      }
    }
  }
}
