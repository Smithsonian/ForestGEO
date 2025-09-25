import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';

export async function GET(
  _request: NextRequest,
  props: {
    params: Promise<{ schema: string; plotID: string; censusID: string }>;
  }
) {
  const { schema, plotID, censusID } = await props.params;

  const connectionManager = ConnectionManager.getInstance();

  const output: { fileID: string; batchID: string }[] = (
    await connectionManager.executeQuery(
      `select distinct FileID, BatchID from ${schema}.temporarymeasurements where PlotID = ? and CensusID = ? order by FileID, BatchID;`,
      [plotID, censusID]
    )
  ).map((row: any) => ({
    fileID: row.FileID,
    batchID: row.BatchID
  }));

  return new NextResponse(JSON.stringify(output), { status: HTTPResponses.OK });
}
