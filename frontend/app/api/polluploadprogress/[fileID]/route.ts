import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';

export async function GET(request: NextRequest, props: { params: Promise<{ fileID: string }> }) {
  const { fileID } = await props.params;
  if (!fileID) throw new Error('fileID not provided');
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('schema not provided');

  const connectionManager = ConnectionManager.getInstance();

  try {
    const results = await connectionManager.executeQuery(
      `SELECT ProcessedBatches as processedbatches, TotalBatches as totalbatches FROM ${schema}.ingest_uploadprocessingtracker WHERE FileID = ?;`,
      [fileID]
    );
    if (results.length === 0) throw new Error('No results found');
    console.log('progress: ', ((results[0].processedbatches ?? 0) / (results[0].totalbatches ?? 1)) * 100);
    return NextResponse.json({ progress: ((results[0].processedbatches ?? 0) / (results[0].totalbatches ?? 1)) * 100 }, { status: HTTPResponses.OK });
  } catch (e) {
    console.error('Error in GET request:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
