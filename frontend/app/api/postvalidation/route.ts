import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) {
    return new NextResponse(JSON.stringify({ error: 'no schema variable provided' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  const connectionManager = ConnectionManager.getInstance();
  try {
    const query = `SELECT QueryID, QueryName, Description FROM ${schema}.postvalidationqueries WHERE IsEnabled IS TRUE;`;
    const results = await connectionManager.executeQuery(query);
    if (results.length === 0) {
      return new NextResponse(JSON.stringify({ message: 'No queries found' }), {
        status: HTTPResponses.NOT_FOUND
      });
    }
    const postValidations = results.map((row: any) => ({
      queryID: row.QueryID,
      queryName: row.QueryName,
      queryDescription: row.Description
    }));
    return new NextResponse(JSON.stringify(postValidations), {
      status: HTTPResponses.OK
    });
  } catch (e: any) {
    ailogger.error('Error in postvalidation GET:', e);
    return new NextResponse(JSON.stringify({ error: e.message }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  } finally {
    await connectionManager.closeConnection();
  }
}
