import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const schema = searchParams.get('schema');
  const plotID = searchParams.get('plotID');
  const censusID = searchParams.get('censusID');

  if (!schema || !plotID || !censusID) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters: schema, plotID, censusID' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // Validate schema to prevent SQL injection
  let tempSQL: string, processedSQL: string, failedSQL: string;
  try {
    tempSQL = safeFormatQuery(schema, 'SELECT COUNT(*) as count FROM ??.temporarymeasurements WHERE PlotID = ? AND CensusID = ?');
    // safeFormatQuery now handles multiple ?? placeholders automatically
    // IMPORTANT: This counts ALL rows for the plot/census combination, not just from the current upload
    // This is necessary because MeasurementDate is the field measurement date, not the upload date
    // For historical data uploads (e.g., measurements from 2020), date filters would exclude valid data
    processedSQL = safeFormatQuery(
      schema,
      'SELECT COUNT(*) as count FROM ??.coremeasurements cm JOIN ??.census c ON cm.CensusID = c.CensusID WHERE c.PlotID = ? AND cm.CensusID = ?'
    );
    failedSQL = safeFormatQuery(schema, 'SELECT COUNT(*) as count FROM ??.failedmeasurements WHERE PlotID = ? AND CensusID = ?');
  } catch (error: any) {
    ailogger.error(`Invalid schema in verifyprocessing: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    // Check how many rows remain in temporary measurements (should be 0 or very few after processing)
    const tempResult = await connectionManager.executeQuery(tempSQL, [plotID, censusID]);

    // Check how many rows were processed into the main measurements table
    const processedResult = await connectionManager.executeQuery(processedSQL, [plotID, censusID]);

    // Check how many rows failed during ingestion and were moved to failedmeasurements
    const failedResult = await connectionManager.executeQuery(failedSQL, [plotID, censusID]);

    const remainingCount = tempResult[0]?.count || 0;
    const processedCount = processedResult[0]?.count || 0;
    const failedCount = failedResult[0]?.count || 0;

    // Total accounted for = processed + failed (remaining in temp should be 0)
    // NOTE: These are cumulative counts for this plot/census, not just from the current upload
    const totalAccounted = processedCount + failedCount;

    ailogger.info(
      `Processing verification for Plot ${plotID}, Census ${censusID}: ${processedCount} total rows in coremeasurements, ${failedCount} total rows in failedmeasurements, ${remainingCount} remaining in temporarymeasurements. Cumulative total: ${totalAccounted}`
    );

    return new NextResponse(
      JSON.stringify({
        processedCount,
        failedCount,
        remainingCount,
        totalAccounted,
        plotID,
        censusID,
        schema,
        processingComplete: remainingCount === 0
      }),
      { status: HTTPResponses.OK }
    );
  } catch (error: any) {
    ailogger.error('Error verifying processing:', error);
    return new NextResponse(
      JSON.stringify({
        error: 'Failed to verify processing',
        details: error.message,
        processedCount: 0,
        failedCount: 0,
        remainingCount: -1,
        totalAccounted: 0,
        processingComplete: false
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  }
}
