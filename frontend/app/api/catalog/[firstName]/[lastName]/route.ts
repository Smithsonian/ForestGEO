import { NextRequest, NextResponse } from 'next/server';
import { PoolConnection } from 'mysql2/promise';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { HTTPResponses } from '@/config/macros';

export async function GET(_request: NextRequest, { params }: { params: { firstName: string; lastName: string } }) {
  const { firstName, lastName } = params;
  if (!firstName || !lastName) throw new Error('no first or last name provided!');

  let conn: PoolConnection | null = null;

  try {
    conn = await getConn();
    const query = `SELECT UserID FROM catalog.users WHERE FirstName = ? AND LastName = ?;`;
    const results = await runQuery(conn, query, [firstName, lastName]);
    if (results.length === 0) {
      throw new Error('User not found');
    }
    conn.release();
    return new NextResponse(JSON.stringify(results[0].UserID), { status: HTTPResponses.OK });
  } catch (e: any) {
    console.error('Error in GET request:', e.message);
    return new NextResponse(JSON.stringify({ error: e.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    if (conn) conn.release();
  }
}
