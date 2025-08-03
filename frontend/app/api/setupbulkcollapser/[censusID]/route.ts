import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';

export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{ censusID: string }>;
  }
) {
  const schema = request.nextUrl.searchParams.get('schema');
  const { censusID } = await props.params;
  if (!schema || !censusID) {
    return new NextResponse(JSON.stringify({ error: 'Missing parameters' }), { status: HTTPResponses.INVALID_REQUEST });
  }
  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string = '';
  try {
    transactionID = await connectionManager.beginTransaction();
    ailogger.info('triggering collapser!');
    await connectionManager.executeQuery(`CALL ${schema}.bulkingestioncollapser(?);`, [censusID]);
    ailogger.info('successfully collapsed & de-duped data!');
    await connectionManager.commitTransaction(transactionID);
    return new NextResponse(JSON.stringify({ responseMessage: 'Processing procedure executed' }), { status: HTTPResponses.OK });
  } catch (e: any) {
    await connectionManager.rollbackTransaction(transactionID);
    return new NextResponse(JSON.stringify({ error: e.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
