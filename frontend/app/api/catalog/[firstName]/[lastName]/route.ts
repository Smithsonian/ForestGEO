import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, props: { params: Promise<{ firstName: string; lastName: string }> }) {
  const params = await props.params;
  const { firstName, lastName } = params;

  const connectionManager = ConnectionManager.getInstance();

  try {
    if (!firstName || !lastName) {
      return new NextResponse(JSON.stringify({ error: 'First name and last name are required' }), {
        status: HTTPResponses.BAD_REQUEST
      });
    }
    const query = `SELECT UserID FROM catalog.users WHERE FirstName = ? AND LastName = ?;`;
    const results = await connectionManager.executeQuery(query, [firstName, lastName]);
    if (results.length === 0) {
      // User not found is a 404, not a 500 - it's not a server error
      ailogger.info(`User not found: ${firstName} ${lastName}`);
      return new NextResponse(JSON.stringify({ error: 'User not found', firstName, lastName }), {
        status: HTTPResponses.NOT_FOUND
      });
    }
    return new NextResponse(JSON.stringify(results[0].UserID), { status: HTTPResponses.OK });
  } catch (e: any) {
    ailogger.error('Error in GET request:', e.message, { endpoint: _request.nextUrl.toJSON() });
    return new NextResponse(JSON.stringify({ error: e.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
