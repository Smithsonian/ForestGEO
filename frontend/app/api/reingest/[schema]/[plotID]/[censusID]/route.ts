import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { validateContextualValues } from '@/lib/contextvalidation';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { safeFormatQuery, validateSchemaOrThrow } from '@/config/utils/sqlsecurity';
import { generateShortBatchID } from '@/config/utils';

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
 * Moves rows from failedmeasurements to temporarymeasurements
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

  // Count total failed measurements
  const countSQL = safeFormatQuery(schema, 'SELECT COUNT(*) as total FROM ??.failedmeasurements WHERE PlotID = ? AND CensusID = ?');
  const countResult = await connectionManager.executeQuery(countSQL, [plotID, censusID]);
  const totalRows = countResult[0]?.total || 0;

  if (totalRows === 0) {
    return { totalRows: 0, fileID: 'reingestion.csv', batchID: generateShortBatchID(), failedIds: [] };
  }

  const idSQL = safeFormatQuery(schema, 'SELECT FailedMeasurementID FROM ??.failedmeasurements WHERE PlotID = ? AND CensusID = ?');
  const idRows = await connectionManager.executeQuery(idSQL, [plotID, censusID]);
  const failedIds = idRows.map((row: any) => row.FailedMeasurementID).filter((id: any) => typeof id === 'number');

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
      fm.PlotID,
      fm.CensusID,
      fm.Tag,
      fm.StemTag,
      fm.SpCode,
      fm.Quadrat,
      fm.X,
      fm.Y,
      fm.DBH,
      fm.HOM,
      fm.Date,
      fm.Codes,
      fm.Comments
    FROM ??.failedmeasurements fm
    WHERE fm.PlotID = ? AND fm.CensusID = ?`
  );

  // Clear temp table and move failed measurements
  const deleteTempSQL = safeFormatQuery(schema, 'DELETE FROM ??.temporarymeasurements WHERE PlotID = ? AND CensusID = ?');
  await connectionManager.executeQuery(deleteTempSQL, [plotID, censusID]);
  await connectionManager.executeQuery(shiftQuery, [fileID, batchID, plotID, censusID]);

  return { totalRows, fileID, batchID, failedIds };
}

async function deleteFailedByIds(connectionManager: any, schema: string, failedIds: number[]): Promise<void> {
  if (failedIds.length === 0) return;

  const chunkSize = 1000;
  for (let i = 0; i < failedIds.length; i += chunkSize) {
    const chunk = failedIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const deleteSQL = safeFormatQuery(schema, `DELETE FROM ??.failedmeasurements WHERE FailedMeasurementID IN (${placeholders})`);
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
          responseMessage: 'No failed measurements found to reingest',
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
          responseMessage: 'No failed measurements found to reingest',
          totalProcessed: 0,
          successfulReingestions: 0,
          remainingFailures: 0
        }),
        { status: HTTPResponses.OK }
      );
    }

    // Run ingestion process (may move some back to failed measurements)
    const bulkProcessSQL = safeFormatQuery(schema, 'CALL ??.bulkingestionprocess(?, ?)');
    await connectionManager.executeQuery(bulkProcessSQL, [fileID, batchID]);

    // Remove originals only after successful processing to avoid data loss
    await deleteFailedByIds(connectionManager, schema, failedIds);

    // Refresh failure reasons for any rows that ended up back in failedmeasurements
    const refreshFailedSQL = safeFormatQuery(schema, 'CALL ??.refresh_failedmeasurements_current(?, ?)');
    await connectionManager.executeQuery(refreshFailedSQL, [plotID, censusID]);

    // Auto-reingest rows that passed validation (no actionable errors)
    const readyCountSQL = safeFormatQuery(
      schema,
      `SELECT COUNT(*) as cnt FROM ??.failedmeasurements
       WHERE PlotID = ? AND CensusID = ? AND FailureReasons = 'Ready for reingestion'`
    );
    const readyResult = await connectionManager.executeQuery(readyCountSQL, [plotID, censusID]);
    const readyCount = readyResult[0]?.cnt || 0;

    if (readyCount > 0) {
      const autoFileID = 'auto-reingest.csv';
      const autoBatchID = generateShortBatchID();

      try {
        const moveReadySQL = safeFormatQuery(
          schema,
          `INSERT IGNORE INTO ??.temporarymeasurements
            (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName,
             LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
          SELECT ?, ?, PlotID, CensusID, Tag, StemTag, SpCode, Quadrat,
                 X, Y, DBH, HOM, Date, Codes, Comments
          FROM ??.failedmeasurements
          WHERE PlotID = ? AND CensusID = ? AND FailureReasons = 'Ready for reingestion'`
        );
        await connectionManager.executeQuery(moveReadySQL, [autoFileID, autoBatchID, plotID, censusID]);

        await connectionManager.executeQuery(bulkProcessSQL, [autoFileID, autoBatchID]);

        const deleteReadySQL = safeFormatQuery(
          schema,
          `DELETE FROM ??.failedmeasurements
           WHERE PlotID = ? AND CensusID = ? AND FailureReasons = 'Ready for reingestion'`
        );
        await connectionManager.executeQuery(deleteReadySQL, [plotID, censusID]);
      } catch (autoError: any) {
        ailogger.error('Auto-reingest failed, rows remain in failedmeasurements:', autoError);
        try {
          const cleanupSQL = safeFormatQuery(schema, 'DELETE FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?');
          await connectionManager.executeQuery(cleanupSQL, [autoFileID, autoBatchID]);
        } catch (cleanupError: any) {
          ailogger.error('Failed to clean up temporary auto-reingest rows:', cleanupError);
        }
      }
    }

    // Count remaining failures (only rows with real validation errors)
    const countRemainingSQL = safeFormatQuery(schema, 'SELECT COUNT(*) as remaining FROM ??.failedmeasurements WHERE PlotID = ? AND CensusID = ?');
    const remainingFailuresResult = await connectionManager.executeQuery(countRemainingSQL, [plotID, censusID]);
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
