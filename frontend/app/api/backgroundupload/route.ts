import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  const fileID = request.nextUrl.searchParams.get('fileID');
  if (!schema || !fileID) throw new Error('schema not provided');
  const connectionManager = ConnectionManager.getInstance();
  try {
    const output = await connectionManager.executeQuery(
      `INSERT INTO ${schema}.ingest_uploadprocessingtracker (FileID, TotalBatches, ProcessedBatches, Status) VALUES (?, 100, 0, 'Pending') ON DUPLICATE KEY UPDATE FileID = VALUES(FileID), TotalBatches = VALUES(TotalBatches), ProcessedBatches = VALUES(ProcessedBatches), Status = VALUES(Status);`,
      [fileID]
    );
    console.log('Background upload started for file:', fileID);
    console.log('Output:', output);
  } catch (e: any) {
    console.error('Error in GET request:', e);
    return new NextResponse(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
  return new NextResponse(JSON.stringify({ message: 'Ingestion started' }), { status: 200 });
}
