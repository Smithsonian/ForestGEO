import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import { isValidSchema } from '@/config/utils/sqlsecurity';

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

  // SECURITY: Validate schema against whitelist to prevent SQL injection
  if (!isValidSchema(schema)) {
    ailogger.error(`[postvalidation API] Invalid schema provided: ${schema}`);
    return new NextResponse(JSON.stringify({ error: 'Invalid schema' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  const connectionManager = ConnectionManager.getInstance();
  try {
    // Schema is validated, safe to use in query (with backtick escaping for extra safety)
    const query = `SELECT QueryID, QueryName, Description FROM \`${schema}\`.postvalidationqueries WHERE IsEnabled IS TRUE;`;
    const results = await connectionManager.executeQuery(query);
    if (results.length === 0) {
      return new NextResponse(JSON.stringify({ message: 'No queries found' }), {
        status: HTTPResponses.NOT_FOUND
      });
    }
    const postValidations = results.map((row: { QueryID: number; QueryName: string; Description: string }) => ({
      queryID: row.QueryID,
      queryName: row.QueryName,
      queryDescription: row.Description
    }));
    return new NextResponse(JSON.stringify(postValidations), {
      status: HTTPResponses.OK
    });
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e));
    ailogger.error('[postvalidation API] Error:', error);
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  } finally {
    await connectionManager.closeConnection();
  }
}
