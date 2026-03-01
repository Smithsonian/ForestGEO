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

async function getUnresolvedIngestionRows(
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
     JOIN ??.measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
     JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
     WHERE c.PlotID = ?
       AND cm.CensusID = ?
       AND cm.StemGUID IS NULL
       AND mel.IsResolved = FALSE
       AND me.ErrorSource = ?
     ORDER BY cm.CoreMeasurementID`
  );

  return connectionManager.executeQuery(selectSQL, [plotID, censusID, INGESTION_ERROR_SOURCE], transactionID);
}

/**
 * Move unresolved ingestion rows into temporarymeasurements for reprocessing.
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

  const sourceRows = await getUnresolvedIngestionRows(connectionManager, schema, plotID, censusID, transactionID);
  if (sourceRows.length === 0) {
    return { totalRows: 0, fileID: 'reingestion.csv', batchID: generateShortBatchID(), rowMappings: [] };
  }

  const fileID = 'reingestion.csv';
  const batchID = generateShortBatchID();

  // Only clear prior staged reingestion rows; never clear all temp rows for plot/census.
  const clearStaleReingestionSQL = safeFormatQuery(
    schema,
    'DELETE FROM ??.temporarymeasurements WHERE FileID = ? AND PlotID = ? AND CensusID = ?'
  );
  await connectionManager.executeQuery(clearStaleReingestionSQL, [fileID, plotID, censusID], transactionID);

  const maxIdSQL = safeFormatQuery(schema, 'SELECT COALESCE(MAX(id), 0) as maxId FROM ??.temporarymeasurements');
  const maxIdResult = await connectionManager.executeQuery(maxIdSQL, [], transactionID);
  const startID = Number(maxIdResult[0]?.maxId || 0);

  const rowMappings: ReingestionRowMapping[] = sourceRows.map((row, idx) => {
    const temporaryRowID = startID + idx + 1;
    if (temporaryRowID > MAX_SIGNED_INT) {
      throw new Error(
        `Reingestion staging id overflow: ${temporaryRowID}. temporarymeasurements.id exceeded safe range for coremeasurements.SourceRowIndex`
      );
    }
    return {
      originalMeasurementID: row.CoreMeasurementID,
      temporaryRowID
    };
  });

  const values = sourceRows.map((row, idx) => [
    rowMappings[idx].temporaryRowID,
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
      (id, FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
     VALUES ?`
  );
  await connectionManager.executeQuery(insertTempSQL, [values], transactionID);

  return {
    totalRows: sourceRows.length,
    fileID,
    batchID,
    rowMappings
  };
}

async function createReingestionMap(
  connectionManager: any,
  rowMappings: ReingestionRowMapping[],
  transactionID: string
): Promise<void> {
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

    // Preserve original upload metadata to avoid collisions with transient rows
    // on ux_cm_uploadbatch_rowindex during reconciliation.
    const syncOriginalRowsSQL = safeFormatQuery(
      schema,
      `UPDATE ??.coremeasurements orig
       JOIN reingestion_map rm ON rm.OriginalID = orig.CoreMeasurementID
       JOIN ??.coremeasurements cm_new
         ON cm_new.SourceRowIndex = rm.TempRowID
         AND cm_new.UploadBatchID = ?
         AND cm_new.UploadFileID = ?
       SET orig.CensusID = cm_new.CensusID,
           orig.StemGUID = cm_new.StemGUID,
           orig.IsValidated = cm_new.IsValidated,
           orig.MeasurementDate = cm_new.MeasurementDate,
           orig.MeasuredDBH = cm_new.MeasuredDBH,
           orig.MeasuredHOM = cm_new.MeasuredHOM,
           orig.Description = cm_new.Description,
           orig.UserDefinedFields = cm_new.UserDefinedFields,
           orig.RawTreeTag = cm_new.RawTreeTag,
           orig.RawStemTag = cm_new.RawStemTag,
           orig.RawSpCode = cm_new.RawSpCode,
           orig.RawQuadrat = cm_new.RawQuadrat,
           orig.RawX = cm_new.RawX,
           orig.RawY = cm_new.RawY,
           orig.RawCodes = cm_new.RawCodes,
           orig.RawComments = cm_new.RawComments,
           orig.IsActive = cm_new.IsActive`
    );
    await connectionManager.executeQuery(syncOriginalRowsSQL, [batchID, fileID], transactionID);

    const successfulReingestionsSQL = safeFormatQuery(
      schema,
      `SELECT COUNT(*) as count
       FROM ??.coremeasurements orig
       JOIN reingestion_map rm ON rm.OriginalID = orig.CoreMeasurementID
       WHERE orig.StemGUID IS NOT NULL`
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

    const deleteTransientRowsSQL = safeFormatQuery(
      schema,
      `DELETE cm_new
       FROM ??.coremeasurements cm_new
       JOIN reingestion_map rm ON rm.TempRowID = cm_new.SourceRowIndex
       WHERE cm_new.UploadBatchID = ?
         AND cm_new.UploadFileID = ?`
    );
    await connectionManager.executeQuery(deleteTransientRowsSQL, [batchID, fileID], transactionID);

    return { successfulReingestions, remainingFailures };
  } finally {
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
          responseMessage: 'No unresolved ingestion-error rows found to reingest',
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
    const result = await connectionManager.withTransaction(
      async (transactionID: string) => {
        // Step 1: Stage failed rows to temporarymeasurements
        const { totalRows, fileID, batchID, rowMappings } = await moveFailedToTemporary(
          connectionManager, schema, plotID, censusID, transactionID
        );

        if (totalRows === 0) {
          return { totalRows: 0, successfulReingestions: 0, remainingFailures: 0 };
        }

        // Step 2: Run bulkingestionprocess within the same transaction
        const bulkProcessSQL = safeFormatQuery(schema, 'CALL ??.bulkingestionprocess(?, ?)');
        await connectionManager.executeQuery(bulkProcessSQL, [fileID, batchID], transactionID);

        // Step 3: Reconcile processed rows back onto original CoreMeasurementIDs
        const { successfulReingestions, remainingFailures } = await reconcileReingestionRows(
          connectionManager, schema, fileID, batchID, rowMappings, transactionID
        );

        return { totalRows, successfulReingestions, remainingFailures };
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
