import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { validateContextualValues } from '@/lib/contextvalidation';
import { v4 } from 'uuid';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';

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
  transactionID: string,
  schema: string,
  plotID: number,
  censusID: number
): Promise<{ totalRows: number; fileID: string; batchID: string }> {
  // Count total failed measurements
  const countResult = await connectionManager.executeQuery(
    `SELECT COUNT(*) as total FROM ${schema}.failedmeasurements WHERE PlotID = ? AND CensusID = ?`,
    [plotID, censusID],
    transactionID
  );
  const totalRows = countResult[0]?.total || 0;

  if (totalRows === 0) {
    return { totalRows: 0, fileID: 'reingestion.csv', batchID: v4() };
  }

  // Generate batch identifiers
  const fileID = 'reingestion.csv';
  const batchID = v4();

  const shiftQuery = `
    INSERT IGNORE INTO ${schema}.temporarymeasurements
      (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes)
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
      fm.Codes
    FROM ${schema}.failedmeasurements fm
    WHERE fm.PlotID = ? AND fm.CensusID = ?;`;

  // Clear temp table and move failed measurements
  await connectionManager.executeQuery(`DELETE FROM ${schema}.temporarymeasurements WHERE PlotID = ? AND CensusID = ?`, [plotID, censusID], transactionID);
  await connectionManager.executeQuery(shiftQuery, [fileID, batchID, plotID, censusID], transactionID);

  // Clear failed measurements (they're now in temp table)
  await connectionManager.executeQuery(`DELETE FROM ${schema}.failedmeasurements WHERE PlotID = ? AND CensusID = ?`, [plotID, censusID], transactionID);

  return { totalRows, fileID, batchID };
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
  let transactionID = '';

  try {
    await connectionManager.cleanupStaleTransactions();
    transactionID = await connectionManager.beginTransaction();

    const { totalRows, fileID, batchID } = await moveFailedToTemporary(connectionManager, transactionID, schema, plotID, censusID);

    if (totalRows === 0) {
      await connectionManager.commitTransaction(transactionID);
      return new NextResponse(
        JSON.stringify({
          responseMessage: 'No failed measurements found to reingest',
          rowsMoved: 0
        }),
        { status: HTTPResponses.OK }
      );
    }

    await connectionManager.commitTransaction(transactionID);

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
    if (transactionID) {
      await connectionManager.rollbackTransaction(transactionID);
    }

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
  let transactionID = '';

  try {
    await connectionManager.cleanupStaleTransactions();
    transactionID = await connectionManager.beginTransaction();

    const { totalRows, fileID, batchID } = await moveFailedToTemporary(connectionManager, transactionID, schema, plotID, censusID);

    if (totalRows === 0) {
      await connectionManager.commitTransaction(transactionID);
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
    await connectionManager.executeQuery(`CALL ${schema}.bulkingestionprocess(?, ?)`, [fileID, batchID], transactionID);

    // Step 4: Count remaining failures and successes
    const remainingFailuresResult = await connectionManager.executeQuery(
      `SELECT COUNT(*) as remaining FROM ${schema}.failedmeasurements WHERE PlotID = ? AND CensusID = ?`,
      [plotID, censusID],
      transactionID
    );
    const remainingFailures = remainingFailuresResult[0]?.remaining || 0;
    const successfulReingestions = totalRows - remainingFailures;

    // Step 5: Update failure reasons for any remaining failures
    await connectionManager.executeQuery(`CALL ${schema}.reviewfailed()`, [], transactionID);

    await connectionManager.commitTransaction(transactionID);

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
    if (transactionID) {
      await connectionManager.rollbackTransaction(transactionID);
    }

    // Try to run reviewfailed to update any failure reasons
    try {
      await connectionManager.executeQuery(`CALL ${schema}.reviewfailed()`);
    } catch (reviewError: any) {
      ailogger.error('Failed to update failure reasons:', reviewError);
    }

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
