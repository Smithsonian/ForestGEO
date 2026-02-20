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

/**
 * Moves unresolved ingestion-error rows from coremeasurements to temporarymeasurements.
 * @returns Row count and batch IDs
 */
async function moveFailedToTemporary(
  connectionManager: any,
  schema: string,
  plotID: number,
  censusID: number
): Promise<{ totalRows: number; fileID: string; batchID: string; failedIds: number[] }> {
  // Validate schema to prevent SQL injection
  validateSchemaOrThrow(schema);

  const countSQL = safeFormatQuery(
    schema,
    `SELECT COUNT(DISTINCT cm.CoreMeasurementID) as total
     FROM ??.coremeasurements cm
     JOIN ??.census c ON c.CensusID = cm.CensusID
     JOIN ??.measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
     JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
     WHERE c.PlotID = ?
       AND cm.CensusID = ?
       AND cm.StemGUID IS NULL
       AND mel.IsResolved = FALSE
       AND me.ErrorSource = ?`
  );
  const countResult = await connectionManager.executeQuery(countSQL, [plotID, censusID, INGESTION_ERROR_SOURCE]);
  const totalRows = countResult[0]?.total || 0;

  if (totalRows === 0) {
    return { totalRows: 0, fileID: 'reingestion.csv', batchID: generateShortBatchID(), failedIds: [] };
  }

  const idSQL = safeFormatQuery(
    schema,
    `SELECT DISTINCT cm.CoreMeasurementID
     FROM ??.coremeasurements cm
     JOIN ??.census c ON c.CensusID = cm.CensusID
     JOIN ??.measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
     JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
     WHERE c.PlotID = ?
       AND cm.CensusID = ?
       AND cm.StemGUID IS NULL
       AND mel.IsResolved = FALSE
       AND me.ErrorSource = ?`
  );
  const idRows = await connectionManager.executeQuery(idSQL, [plotID, censusID, INGESTION_ERROR_SOURCE]);
  const failedIds = idRows.map((row: any) => row.CoreMeasurementID).filter((id: any) => typeof id === 'number');

  // Generate batch identifiers
  const fileID = 'reingestion.csv';
  const batchID = generateShortBatchID();

  const shiftQuery = safeFormatQuery(
    schema,
    `INSERT IGNORE INTO ??.temporarymeasurements
      (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
    SELECT
      ? AS FileID,
      ? AS BatchID,
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
    GROUP BY
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
      cm.RawComments`
  );

  // Clear temp table and move failed measurements
  const deleteTempSQL = safeFormatQuery(schema, 'DELETE FROM ??.temporarymeasurements WHERE PlotID = ? AND CensusID = ?');
  await connectionManager.executeQuery(deleteTempSQL, [plotID, censusID]);
  await connectionManager.executeQuery(shiftQuery, [fileID, batchID, plotID, censusID, INGESTION_ERROR_SOURCE]);

  return { totalRows, fileID, batchID, failedIds };
}

async function deleteFailedByIds(connectionManager: any, schema: string, failedIds: number[]): Promise<void> {
  if (failedIds.length === 0) return;

  const chunkSize = 1000;
  for (let i = 0; i < failedIds.length; i += chunkSize) {
    const chunk = failedIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const resolveSQL = safeFormatQuery(
      schema,
      `UPDATE ??.measurement_error_log mel
       JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
       SET mel.IsResolved = TRUE, mel.ResolvedAt = NOW()
       WHERE mel.MeasurementID IN (${placeholders})
         AND mel.IsResolved = FALSE
         AND me.ErrorSource = ?`
    );
    await connectionManager.executeQuery(resolveSQL, [...chunk, INGESTION_ERROR_SOURCE]);

    const deleteSQL = safeFormatQuery(schema, `DELETE FROM ??.coremeasurements WHERE CoreMeasurementID IN (${placeholders}) AND StemGUID IS NULL`);
    await connectionManager.executeQuery(deleteSQL, chunk);
  }
}

/**
 * POST: Move failed measurements to temporary table for reingestion via upload modal
 * This prepares rows for the batch ingestion process without running it immediately
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
    const { totalRows, fileID, batchID, failedIds } = await moveFailedToTemporary(connectionManager, schema, plotID, censusID);

    if (totalRows === 0) {
      return new NextResponse(
        JSON.stringify({
          responseMessage: 'No unresolved ingestion-error rows found to reingest',
          rowsMoved: 0
        }),
        { status: HTTPResponses.OK }
      );
    }

    await deleteFailedByIds(connectionManager, schema, failedIds);

    return new NextResponse(
      JSON.stringify({
        responseMessage: 'Rows moved to temporary table for reingestion',
        rowsMoved: totalRows,
        fileID: fileID,
        batchID: batchID
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
 * GET: Run full reingestion process (move rows + run batch ingestion)
 * This is the original behavior that runs the entire process immediately
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
    const { totalRows, fileID, batchID, failedIds } = await moveFailedToTemporary(connectionManager, schema, plotID, censusID);

    if (totalRows === 0) {
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

    // Run ingestion process.
    const bulkProcessSQL = safeFormatQuery(schema, 'CALL ??.bulkingestionprocess(?, ?)');
    await connectionManager.executeQuery(bulkProcessSQL, [fileID, batchID]);

    // Remove originals only after successful processing to avoid data loss
    await deleteFailedByIds(connectionManager, schema, failedIds);

    const countRemainingSQL = safeFormatQuery(
      schema,
      `SELECT COUNT(DISTINCT cm.CoreMeasurementID) as remaining
       FROM ??.coremeasurements cm
       JOIN ??.census c ON c.CensusID = cm.CensusID
       JOIN ??.measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
       JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE c.PlotID = ?
         AND cm.CensusID = ?
         AND cm.StemGUID IS NULL
         AND mel.IsResolved = FALSE
         AND me.ErrorSource = ?`
    );
    const remainingFailuresResult = await connectionManager.executeQuery(countRemainingSQL, [plotID, censusID, INGESTION_ERROR_SOURCE]);
    const remainingFailures = remainingFailuresResult[0]?.remaining || 0;
    const successfulReingestions = totalRows - remainingFailures;

    return new NextResponse(
      JSON.stringify({
        responseMessage: 'Reingestion completed',
        totalProcessed: totalRows,
        successfulReingestions: successfulReingestions,
        remainingFailures: remainingFailures
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
