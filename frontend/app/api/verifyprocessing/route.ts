import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const schema = searchParams.get('schema');
  const plotID = searchParams.get('plotID');
  const censusID = searchParams.get('censusID');

  if (!schema || !plotID || !censusID) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters: schema, plotID, censusID' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    // Check how many rows remain in temporary measurements (should be 0 or very few after processing)
    const tempResult = await connectionManager.executeQuery(`SELECT COUNT(*) as count FROM ${schema}.temporarymeasurements WHERE PlotID = ? AND CensusID = ?`, [
      plotID,
      censusID
    ]);

    // Check how many rows were processed into the main measurements table
    const processedResult = await connectionManager.executeQuery(
      `SELECT COUNT(*) as count FROM ${schema}.coremeasurements WHERE PlotID = ? AND CensusID = ? AND MeasurementDate >= CURDATE() - INTERVAL 1 DAY`,
      [plotID, censusID]
    );

    const remainingCount = tempResult[0]?.count || 0;
    const processedCount = processedResult[0]?.count || 0;

    ailogger.info(`Processing verification: ${processedCount} rows processed to coremeasurements, ${remainingCount} remaining in temporarymeasurements`);

    return new NextResponse(
      JSON.stringify({
        processedCount,
        remainingCount,
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
        remainingCount: -1,
        processingComplete: false
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  }
}
