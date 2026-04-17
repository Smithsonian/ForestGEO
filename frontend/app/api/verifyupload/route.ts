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
  const fileName = searchParams.get('fileName');
  const batchID = searchParams.get('batchID');
  const plotID = searchParams.get('plotID');
  const censusID = searchParams.get('censusID');

  if (!schema || !fileName || !plotID || !censusID) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters: schema, fileName, plotID, censusID' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    const verificationSQL = batchID
      ? safeFormatQuery(schema, 'SELECT COUNT(*) as count FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ? AND PlotID = ? AND CensusID = ?')
      : safeFormatQuery(schema, 'SELECT COUNT(*) as count FROM ??.temporarymeasurements WHERE FileID = ? AND PlotID = ? AND CensusID = ?');
    const verificationParams = batchID ? [fileName, batchID, plotID, censusID] : [fileName, plotID, censusID];
    const result = await connectionManager.executeQuery(verificationSQL, verificationParams);

    const count = result[0]?.count || 0;
    ailogger.info(`Verification check for ${fileName}${batchID ? ` (${batchID})` : ''}: ${count} row(s) found in temporarymeasurements`, {
      fileName,
      batchID: batchID || null,
      plotID,
      censusID
    });

    return new NextResponse(
      JSON.stringify({
        count,
        fileName,
        batchID: batchID || null,
        scope: batchID ? 'batch' : 'file',
        schema,
        plotID,
        censusID,
        verified: count > 0
      }),
      { status: HTTPResponses.OK }
    );
  } catch (error: any) {
    ailogger.error('Error verifying upload:', error);
    return new NextResponse(
      JSON.stringify({
        error: 'Failed to verify upload',
        details: error.message,
        count: 0,
        verified: false
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  } finally {
    await connectionManager.closeConnection();
  }
}
