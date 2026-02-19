import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  props: {
    params: Promise<{ schema: string; plotID: string; censusID: string }>;
  }
) {
  const { schema, plotID, censusID } = await props.params;

  const connectionManager = ConnectionManager.getInstance();
  let batchSQL: string;
  try {
    batchSQL = safeFormatQuery(schema, 'SELECT DISTINCT FileID, BatchID FROM ??.temporarymeasurements WHERE PlotID = ? AND CensusID = ? ORDER BY FileID, BatchID');
  } catch (error: any) {
    ailogger.error(`Invalid schema in setupbulkprocessor: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  try {
    const output: { fileID: string; batchID: string }[] = (
      await connectionManager.executeQuery(batchSQL, [plotID, censusID])
    ).map((row: any) => ({
      fileID: row.FileID,
      batchID: row.BatchID
    }));
    ailogger.info(`Found ${output.length} batches for schema: ${schema}, plotID: ${plotID}, censusID: ${censusID}`);
    ailogger.debug(`Batch details: ${JSON.stringify(output)}`);
    return new NextResponse(JSON.stringify(output), { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error(`Error fetching batches for bulk processor:`, error);
    return new NextResponse(JSON.stringify({ error: 'Failed to fetch batches', details: error.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
