import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

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

  // Validate schema to prevent SQL injection
  let collapserSQL: string;
  try {
    collapserSQL = safeFormatQuery(schema, 'CALL ??.bulkingestioncollapser(?)');
  } catch (error: any) {
    ailogger.error(`Invalid schema in setupbulkcollapser: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string = '';
  try {
    transactionID = await connectionManager.beginTransaction();
    ailogger.info('triggering collapser!');
    // Use pre-validated and formatted SQL to prevent injection
    await connectionManager.executeQuery(collapserSQL, [censusID], transactionID);
    ailogger.info('successfully collapsed & de-duped data!');
    await connectionManager.commitTransaction(transactionID);
    return new NextResponse(JSON.stringify({ responseMessage: 'Processing procedure executed' }), { status: HTTPResponses.OK });
  } catch (e: any) {
    await connectionManager.rollbackTransaction(transactionID);
    return new NextResponse(JSON.stringify({ error: e.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
