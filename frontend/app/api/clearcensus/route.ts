import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  const censusIDParam = request.nextUrl.searchParams.get('censusID');
  const type = request.nextUrl.searchParams.get('type');
  if (!schema || !censusIDParam) {
    return new NextResponse('Missing required parameters', { status: HTTPResponses.SERVICE_UNAVAILABLE });
  }
  const connectionManager = ConnectionManager.getInstance();
  let transactionID = '';
  try {
    transactionID = await connectionManager.beginTransaction();
    await connectionManager.executeQuery(`CALL ${schema}.clearcensus${type}(?);`, [censusIDParam]);
    await connectionManager.commitTransaction(transactionID);
    return NextResponse.json({ message: 'Census cleared successfully' }, { status: HTTPResponses.OK });
  } catch (e: any) {
    await connectionManager.rollbackTransaction(transactionID);
    return new NextResponse(e.message, { status: HTTPResponses.SERVICE_UNAVAILABLE });
  }
}
