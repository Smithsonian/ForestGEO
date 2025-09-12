import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';

export async function GET(
  _request: NextRequest,
  props: {
    params: Promise<{ schema: string; plotID: string; censusID: string }>;
  }
) {
  const { schema, plotID, censusID } = await props.params;

  const connectionManager = ConnectionManager.getInstance();

  try {
    const output: { fileID: string; batchID: string }[] = (
      await connectionManager.executeQuery(
        `select distinct FileID, BatchID from ${schema}.temporarymeasurements where PlotID = ? and CensusID = ? order by FileID, BatchID;`,
        [plotID, censusID]
      )
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
