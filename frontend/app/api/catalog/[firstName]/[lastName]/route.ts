import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ firstName: string; lastName: string }> }
) {
  const params = await props.params;
  const { firstName, lastName } = params;
  if (!firstName || !lastName) throw new Error('no first or last name provided!');

  const connectionManager = ConnectionManager.getInstance();

  try {
    const query = `SELECT UserID FROM catalog.users WHERE FirstName = ? AND LastName = ?;`;
    const results = await connectionManager.executeQuery(query, [firstName, lastName]);
    if (results.length === 0) {
      throw new Error('User not found');
    }
    return new NextResponse(JSON.stringify(results[0].UserID), { status: HTTPResponses.OK });
  } catch (e: any) {
    console.error('Error in GET request:', e.message);
    return new NextResponse(JSON.stringify({ error: e.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
