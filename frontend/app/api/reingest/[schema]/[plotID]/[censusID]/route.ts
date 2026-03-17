import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { validateContextualValues } from '@/lib/contextvalidation';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { safeFormatQuery, validateSchemaOrThrow } from '@/config/utils/sqlsecurity';
import { generateShortBatchID } from '@/config/utils';
import { INGESTION_ERROR_SOURCE } from '@/config/measurementerrors';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

const MAX_SIGNED_INT = 2147483647;
const REINGESTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for bulk reingestion

interface ReingestionSourceRow {
  CoreMeasurementID: number;
  PlotID: number;
  CensusID: number;
  RawTreeTag: string | null;
  RawStemTag: string | null;
  RawSpCode: string | null;
  RawQuadrat: string | null;
  RawX: number | null;
  RawY: number | null;
  MeasuredDBH: number | null;
  MeasuredHOM: number | null;
  MeasurementDate: string | null;
  RawCodes: string | null;
  RawComments: string | null;
}

interface ReingestionRowMapping {
  originalMeasurementID: number;
  temporaryRowID: number;
}

interface MoveFailedRowsResult {
  totalRows: number;
  fileID: string;
  batchID: string;
  rowMappings: ReingestionRowMapping[];
}

interface BulkIngestionStatus {
  message: string | null;
  batchFailed: boolean;
}

/**
 * Validates and extracts context parameters from request
 * @returns Validated schema, plotID, and censusID or error response
 */
async function validateAndExtractParams(
  request: NextRequest,
  schemaParam: string,
  plotIDParam: string,
  censusIDParam: string
): Promise<{ schema: string; plotID: number; censusID: number } | NextResponse> {
  const validation = await validateContextualValues(request, {
    requireSchema: true,
    requirePlot: true,
    requireCensus: true,
    allowFallback: true,
    fallbackMessage: 'Reingestion requires active site, plot, and census selections.'
  });

  let plotID: number, censusID: number, schema: string;

  if (!validation.success) {
    // Try to use URL parameters as fallback
    if (schemaParam && plotIDParam && censusIDParam) {
      plotID = parseInt(plotIDParam);
      censusID = parseInt(censusIDParam);
      schema = schemaParam;

      if (isNaN(plotID) || isNaN(censusID)) {
        return NextResponse.json({ error: 'Invalid plotID or censusID parameters' }, { status: HTTPResponses.BAD_REQUEST });
      }
    } else {
      return validation.response!;
    }
  } else {
    const values = validation.values!;
    schema = values.schema!;
    plotID = values.plotID!;
    censusID = values.censusID!;
  }

  return { schema, plotID, censusID };
}

async function getFailedMeasurementRows(
  connectionManager: any,
  schema: string,
  plotID: number,
  censusID: number,
  transactionID?: string
): Promise<ReingestionSourceRow[]> {
  const selectSQL = safeFormatQuery(
    schema,
    `SELECT DISTINCT
       cm.CoreMeasurementID,
       c.PlotID,
       cm.CensusID,
       cm.RawTreeTag,
       cm.RawStemTag,
       cm.RawSpCode,
       cm.RawQuadrat,
       cm.RawX,
       cm.RawY,
       cm.MeasuredDBH,
       cm.MeasuredHOM,
       cm.MeasurementDate,
       cm.RawCodes,
       cm.RawComments
     FROM ??.coremeasurements cm
     JOIN ??.census c ON c.CensusID = cm.CensusID
     WHERE c.PlotID = ?
       AND cm.CensusID = ?
       AND cm.StemGUID IS NULL
       AND EXISTS (
         SELECT 1
         FROM ??.measurement_error_log mel
         JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
         WHERE mel.MeasurementID = cm.CoreMeasurementID
           AND me.ErrorSource = ?
       )
     ORDER BY cm.CoreMeasurementID`
  );

  return connectionManager.executeQuery(selectSQL, [plotID, censusID, INGESTION_ERROR_SOURCE], transactionID);
}

/**
 * Move failed measurement rows into temporarymeasurements for reprocessing.
 * Rows are intentionally retained in coremeasurements until reconciliation succeeds.
 */
async function moveFailedToTemporary(
  connectionManager: any,
  schema: string,
  plotID: number,
  censusID: number,
  transactionID?: string
): Promise<MoveFailedRowsResult> {
  validateSchemaOrThrow(schema);

  const sourceRows = await getFailedMeasurementRows(connectionManager, schema, plotID, censusID, transactionID);
  if (sourceRows.length === 0) {
    return { totalRows: 0, fileID: 'reingestion.csv', batchID: generateShortBatchID(), rowMappings: [] };
  }

  const fileID = 'reingestion.csv';
  const batchID = generateShortBatchID();

  // Only clear prior staged reingestion rows; never clear all temp rows for plot/census.
  const clearStaleReingestionSQL = safeFormatQuery(schema, 'DELETE FROM ??.temporarymeasurements WHERE FileID = ? AND PlotID = ? AND CensusID = ?');
  await connectionManager.executeQuery(clearStaleReingestionSQL, [fileID, plotID, censusID], transactionID);

  const values = sourceRows.map(row => [
    fileID,
    batchID,
    row.PlotID,
    row.CensusID,
    row.RawTreeTag,
    row.RawStemTag,
    row.RawSpCode,
    row.RawQuadrat,
    row.RawX,
    row.RawY,
    row.MeasuredDBH,
    row.MeasuredHOM,
    row.MeasurementDate,
    row.RawCodes,
    row.RawComments
  ]);

  const insertTempSQL = safeFormatQuery(
    schema,
    `INSERT INTO ??.temporarymeasurements
      (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
     VALUES ?`
  );
  const insertResult: any = await connectionManager.executeQuery(insertTempSQL, [values], transactionID);
  const firstInsertId = Number(insertResult?.insertId ?? 0);
  if (!Number.isInteger(firstInsertId) || firstInsertId <= 0) {
    throw new Error('Reingestion staging insert did not return a usable insertId');
  }

  const rowMappings: ReingestionRowMapping[] = sourceRows.map((row, idx) => {
    const temporaryRowID = firstInsertId + idx;
    if (temporaryRowID > MAX_SIGNED_INT) {
      throw new Error(`Reingestion staging id overflow: ${temporaryRowID}. temporarymeasurements.id exceeded safe range for coremeasurements.SourceRowIndex`);
    }

    return {
      originalMeasurementID: row.CoreMeasurementID,
      temporaryRowID
    };
  });

  return {
    totalRows: sourceRows.length,
    fileID,
    batchID,
    rowMappings
  };
}

function parseBulkIngestionStatus(procedureResult: any): BulkIngestionStatus {
  const rawRow = Array.isArray(procedureResult?.[0]) ? procedureResult[0][0] : procedureResult?.[0];

  return {
    message: typeof rawRow?.message === 'string' ? rawRow.message : null,
    batchFailed: rawRow?.batch_failed === true
  };
}

async function createReingestionMap(connectionManager: any, rowMappings: ReingestionRowMapping[], transactionID: string): Promise<void> {
  await connectionManager.executeQuery('DROP TEMPORARY TABLE IF EXISTS reingestion_map', [], transactionID);
  await connectionManager.executeQuery(
    `CREATE TEMPORARY TABLE reingestion_map (
      OriginalID INT NOT NULL PRIMARY KEY,
      TempRowID BIGINT UNSIGNED NOT NULL,
      INDEX idx_temp_row (TempRowID)
    ) ENGINE=MEMORY`,
    [],
    transactionID
  );

  const chunkSize = 1000;
  for (let i = 0; i < rowMappings.length; i += chunkSize) {
    const chunk = rowMappings.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '(?, ?)').join(', ');
    const params = chunk.flatMap(row => [row.originalMeasurementID, row.temporaryRowID]);
    await connectionManager.executeQuery(`INSERT INTO reingestion_map (OriginalID, TempRowID) VALUES ${placeholders}`, params, transactionID);
  }
}

async function createReingestionSnapshotTables(connectionManager: any, schema: string, fileID: string, batchID: string, transactionID: string): Promise<void> {
  await connectionManager.executeQuery('DROP TEMPORARY TABLE IF EXISTS reingestion_results', [], transactionID);
  await connectionManager.executeQuery('DROP TEMPORARY TABLE IF EXISTS reingestion_attributes', [], transactionID);

  await connectionManager.executeQuery(
    `CREATE TEMPORARY TABLE reingestion_results (
      OriginalID INT NOT NULL PRIMARY KEY,
      CensusID INT NULL,
      StemGUID INT NULL,
      IsValidated BIT NULL,
      MeasurementDate DATE NULL,
      MeasuredDBH DECIMAL(12, 6) NULL,
      MeasuredHOM DECIMAL(12, 6) NULL,
      Description VARCHAR(255) NULL,
      UserDefinedFields JSON NULL,
      RawTreeTag VARCHAR(20) NULL,
      RawStemTag VARCHAR(10) NULL,
      RawSpCode VARCHAR(25) NULL,
      RawQuadrat VARCHAR(255) NULL,
      RawX DECIMAL(12, 6) NULL,
      RawY DECIMAL(12, 6) NULL,
      RawCodes VARCHAR(255) NULL,
      RawComments VARCHAR(255) NULL,
      IsActive TINYINT(1) NOT NULL
    )`,
    [],
    transactionID
  );

  const snapshotResultsSQL = safeFormatQuery(
    schema,
    `INSERT INTO reingestion_results
      (OriginalID, CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
       Description, UserDefinedFields, RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY,
       RawCodes, RawComments, IsActive)
     SELECT
       rm.OriginalID,
       cm_new.CensusID,
       cm_new.StemGUID,
       cm_new.IsValidated,
       cm_new.MeasurementDate,
       cm_new.MeasuredDBH,
       cm_new.MeasuredHOM,
       cm_new.Description,
       cm_new.UserDefinedFields,
       cm_new.RawTreeTag,
       cm_new.RawStemTag,
       cm_new.RawSpCode,
       cm_new.RawQuadrat,
       cm_new.RawX,
       cm_new.RawY,
       cm_new.RawCodes,
       cm_new.RawComments,
       cm_new.IsActive
     FROM ??.coremeasurements cm_new
     JOIN reingestion_map rm ON rm.TempRowID = cm_new.SourceRowIndex
     WHERE cm_new.UploadBatchID = ?
       AND cm_new.UploadFileID = ?`
  );
  await connectionManager.executeQuery(snapshotResultsSQL, [batchID, fileID], transactionID);

  await connectionManager.executeQuery(
    `CREATE TEMPORARY TABLE reingestion_attributes (
      OriginalID INT NOT NULL,
      Code VARCHAR(10) NOT NULL,
      PRIMARY KEY (OriginalID, Code)
    )`,
    [],
    transactionID
  );

  const snapshotAttributesSQL = safeFormatQuery(
    schema,
    `INSERT INTO reingestion_attributes (OriginalID, Code)
     SELECT rm.OriginalID, ca.Code
     FROM ??.cmattributes ca
     JOIN ??.coremeasurements cm_new ON cm_new.CoreMeasurementID = ca.CoreMeasurementID
     JOIN reingestion_map rm ON rm.TempRowID = cm_new.SourceRowIndex
     WHERE cm_new.UploadBatchID = ?
       AND cm_new.UploadFileID = ?`
  );
  await connectionManager.executeQuery(snapshotAttributesSQL, [batchID, fileID], transactionID);
}

async function reconcileReingestionRows(
  connectionManager: any,
  schema: string,
  fileID: string,
  batchID: string,
  rowMappings: ReingestionRowMapping[],
  transactionID: string
): Promise<{ successfulReingestions: number; remainingFailures: number }> {
  if (rowMappings.length === 0) {
    return { successfulReingestions: 0, remainingFailures: 0 };
  }

  await createReingestionMap(connectionManager, rowMappings, transactionID);

  try {
    const resolveExistingIngestionSQL = safeFormatQuery(
      schema,
      `UPDATE ??.measurement_error_log mel
       JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
       JOIN reingestion_map rm ON rm.OriginalID = mel.MeasurementID
       SET mel.IsResolved = TRUE, mel.ResolvedAt = NOW()
       WHERE me.ErrorSource = ?
         AND mel.IsResolved = FALSE`
    );
    await connectionManager.executeQuery(resolveExistingIngestionSQL, [INGESTION_ERROR_SOURCE], transactionID);

    const transferErrorsSQL = safeFormatQuery(
      schema,
      `INSERT INTO ??.measurement_error_log (MeasurementID, ErrorID, IsResolved, CreatedAt, ResolvedAt)
       SELECT rm.OriginalID, mel_new.ErrorID, mel_new.IsResolved, mel_new.CreatedAt, mel_new.ResolvedAt
       FROM ??.coremeasurements cm_new
       JOIN reingestion_map rm ON rm.TempRowID = cm_new.SourceRowIndex
       JOIN ??.measurement_error_log mel_new ON mel_new.MeasurementID = cm_new.CoreMeasurementID
       WHERE cm_new.UploadBatchID = ?
         AND cm_new.UploadFileID = ?
       ON DUPLICATE KEY UPDATE
         IsResolved = VALUES(IsResolved),
         ResolvedAt = VALUES(ResolvedAt)`
    );
    await connectionManager.executeQuery(transferErrorsSQL, [batchID, fileID], transactionID);

    await createReingestionSnapshotTables(connectionManager, schema, fileID, batchID, transactionID);

    const deleteTransientRowsSQL = safeFormatQuery(
      schema,
      `DELETE cm_new
       FROM ??.coremeasurements cm_new
       JOIN reingestion_map rm ON rm.TempRowID = cm_new.SourceRowIndex
       WHERE cm_new.UploadBatchID = ?
         AND cm_new.UploadFileID = ?`
    );
    await connectionManager.executeQuery(deleteTransientRowsSQL, [batchID, fileID], transactionID);

    // Preserve original upload metadata while applying the newly ingested values
    // back onto the original CoreMeasurementIDs.
    const syncOriginalRowsSQL = safeFormatQuery(
      schema,
      `UPDATE ??.coremeasurements orig
       JOIN reingestion_results rr ON rr.OriginalID = orig.CoreMeasurementID
       SET orig.CensusID = rr.CensusID,
           orig.StemGUID = rr.StemGUID,
           orig.IsValidated = rr.IsValidated,
           orig.MeasurementDate = rr.MeasurementDate,
           orig.MeasuredDBH = rr.MeasuredDBH,
           orig.MeasuredHOM = rr.MeasuredHOM,
           orig.Description = rr.Description,
           orig.UserDefinedFields = rr.UserDefinedFields,
           orig.RawTreeTag = rr.RawTreeTag,
           orig.RawStemTag = rr.RawStemTag,
           orig.RawSpCode = rr.RawSpCode,
           orig.RawQuadrat = rr.RawQuadrat,
           orig.RawX = rr.RawX,
           orig.RawY = rr.RawY,
           orig.RawCodes = rr.RawCodes,
           orig.RawComments = rr.RawComments,
           orig.IsActive = rr.IsActive`
    );
    await connectionManager.executeQuery(syncOriginalRowsSQL, [], transactionID);

    const clearOriginalAttributesSQL = safeFormatQuery(
      schema,
      `DELETE ca
       FROM ??.cmattributes ca
       JOIN reingestion_map rm ON rm.OriginalID = ca.CoreMeasurementID`
    );
    await connectionManager.executeQuery(clearOriginalAttributesSQL, [], transactionID);

    const restoreAttributesSQL = safeFormatQuery(
      schema,
      `INSERT IGNORE INTO ??.cmattributes (CoreMeasurementID, Code)
       SELECT OriginalID, Code
       FROM reingestion_attributes`
    );
    await connectionManager.executeQuery(restoreAttributesSQL, [], transactionID);

    const successfulReingestionsSQL = safeFormatQuery(
      schema,
      `SELECT COUNT(*) as count
       FROM reingestion_results
       WHERE StemGUID IS NOT NULL`
    );
    const successfulResult = await connectionManager.executeQuery(successfulReingestionsSQL, [], transactionID);
    const successfulReingestions = successfulResult[0]?.count || 0;

    const remainingFailuresSQL = safeFormatQuery(
      schema,
      `SELECT COUNT(DISTINCT orig.CoreMeasurementID) as count
       FROM ??.coremeasurements orig
       JOIN reingestion_map rm ON rm.OriginalID = orig.CoreMeasurementID
       JOIN ??.measurement_error_log mel ON mel.MeasurementID = orig.CoreMeasurementID
       JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE orig.StemGUID IS NULL
         AND mel.IsResolved = FALSE
         AND me.ErrorSource = ?`
    );
    const remainingResult = await connectionManager.executeQuery(remainingFailuresSQL, [INGESTION_ERROR_SOURCE], transactionID);
    const remainingFailures = remainingResult[0]?.count || 0;

    return { successfulReingestions, remainingFailures };
  } finally {
    await connectionManager.executeQuery('DROP TEMPORARY TABLE IF EXISTS reingestion_attributes', [], transactionID);
    await connectionManager.executeQuery('DROP TEMPORARY TABLE IF EXISTS reingestion_results', [], transactionID);
    await connectionManager.executeQuery('DROP TEMPORARY TABLE IF EXISTS reingestion_map', [], transactionID);
  }
}

/**
 * POST: Stage unresolved ingestion rows to temporarymeasurements.
 * This endpoint does not delete original rows from coremeasurements.
 */
export async function POST(
  request: NextRequest,
  props: {
    params: Promise<{ schema: string; plotID: string; censusID: string }>;
  }
) {
  const { schema: schemaParam, plotID: plotIDParam, censusID: censusIDParam } = await props.params;

  const paramsResult = await validateAndExtractParams(request, schemaParam, plotIDParam, censusIDParam);
  if (paramsResult instanceof NextResponse) {
    return paramsResult;
  }

  const { schema, plotID, censusID } = paramsResult;

  const connectionManager = ConnectionManager.getInstance();
  try {
    await connectionManager.cleanupStaleTransactions();
    const { totalRows, fileID, batchID } = await connectionManager.withTransaction(async (transactionID: string) =>
      moveFailedToTemporary(connectionManager, schema, plotID, censusID, transactionID)
    );

    if (totalRows === 0) {
      return new NextResponse(
        JSON.stringify({
          responseMessage: 'No failed measurement rows found to reingest',
          rowsMoved: 0
        }),
        { status: HTTPResponses.OK }
      );
    }

    return new NextResponse(
      JSON.stringify({
        responseMessage: 'Rows staged to temporary table for reingestion',
        rowsMoved: totalRows,
        fileID: fileID,
        batchID: batchID,
        originalsRetained: true
      }),
      { status: HTTPResponses.OK }
    );
  } catch (e: any) {
    ailogger.error('Failed to move rows to temporary table:', e);

    return new NextResponse(
      JSON.stringify({
        error: e.message,
        responseMessage: 'Failed to prepare reingestion - check logs for details'
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  } finally {
    await connectionManager.closeConnection();
  }
}

/**
 * GET: Run full reingestion process and reconcile results back onto original rows.
 */
export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{ schema: string; plotID: string; censusID: string }>;
  }
) {
  const { schema: schemaParam, plotID: plotIDParam, censusID: censusIDParam } = await props.params;

  const paramsResult = await validateAndExtractParams(request, schemaParam, plotIDParam, censusIDParam);
  if (paramsResult instanceof NextResponse) {
    return paramsResult;
  }

  const { schema, plotID, censusID } = paramsResult;

  const connectionManager = ConnectionManager.getInstance();
  try {
    await connectionManager.cleanupStaleTransactions();

    // All three steps run in a single transaction for atomicity:
    // if any step fails, everything rolls back and originals remain untouched.
    const lockKey = `reingest:${schema}:${plotID}:${censusID}`;
    const result = await connectionManager.withTransaction(
      async (transactionID: string) => {
        // Acquire a distributed lock to prevent concurrent reingestion for the same plot/census.
        // Without this, two concurrent requests can corrupt each other's staging data.
        const lockAcquired = await connectionManager.acquireApplicationLock(lockKey, transactionID, REINGESTION_TIMEOUT_MS);
        if (!lockAcquired) {
          throw new Error(`Another reingestion is already in progress for ${schema} plot ${plotID} census ${censusID}`);
        }

        // Step 1: Stage failed rows to temporarymeasurements
        const { totalRows, fileID, batchID, rowMappings } = await moveFailedToTemporary(connectionManager, schema, plotID, censusID, transactionID);

        if (totalRows === 0) {
          return { totalRows: 0, successfulReingestions: 0, remainingFailures: 0 };
        }

        // Step 2: Run bulkingestionprocess within the same transaction
        const bulkProcessSQL = safeFormatQuery(schema, 'CALL ??.bulkingestionprocess(?, ?)');
        const procedureResult = await connectionManager.executeQuery(bulkProcessSQL, [fileID, batchID], transactionID);
        const ingestionStatus = parseBulkIngestionStatus(procedureResult);

        // Step 3: Reconcile processed rows back onto original CoreMeasurementIDs
        const { successfulReingestions, remainingFailures } = await reconcileReingestionRows(
          connectionManager,
          schema,
          fileID,
          batchID,
          rowMappings,
          transactionID
        );

        if (ingestionStatus.batchFailed) {
          ailogger.warn(`Reingestion batch ${batchID} failed internally: ${ingestionStatus.message ?? 'Unknown failure'}`);
        }

        return {
          totalRows,
          successfulReingestions,
          remainingFailures,
          batchFailed: ingestionStatus.batchFailed,
          failureMessage: ingestionStatus.message
        };
      },
      { timeoutMs: REINGESTION_TIMEOUT_MS }
    );

    if (result.totalRows === 0) {
      return new NextResponse(
        JSON.stringify({
          responseMessage: 'No unresolved ingestion-error rows found to reingest',
          totalProcessed: 0,
          successfulReingestions: 0,
          remainingFailures: 0
        }),
        { status: HTTPResponses.OK }
      );
    }

    if ('batchFailed' in result && result.batchFailed) {
      return new NextResponse(
        JSON.stringify({
          responseMessage: 'Reingestion batch failed internally — diagnostics preserved',
          totalProcessed: result.totalRows,
          successfulReingestions: 0,
          remainingFailures: result.remainingFailures,
          batchFailed: true,
          failureMessage: result.failureMessage
        }),
        { status: HTTPResponses.OK }
      );
    }

    return new NextResponse(
      JSON.stringify({
        responseMessage: 'Reingestion completed',
        totalProcessed: result.totalRows,
        successfulReingestions: result.successfulReingestions,
        remainingFailures: result.remainingFailures
      }),
      { status: HTTPResponses.OK }
    );
  } catch (e: any) {
    ailogger.error('Reingestion failed:', e);

    return new NextResponse(
      JSON.stringify({
        error: e.message,
        responseMessage: 'Reingestion failed - check logs for details'
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  } finally {
    await connectionManager.closeConnection();
  }
}
