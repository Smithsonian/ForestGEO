import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');

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
    throw e;
  } finally {
    await connectionManager.closeConnection();
  }
}
