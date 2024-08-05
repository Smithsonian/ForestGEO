import { NextRequest, NextResponse } from 'next/server';
import { PoolConnection } from 'mysql2/promise';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { generateHash } from '@/config/crypto-actions';
import { HTTPResponses } from '@/config/macros';

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema provided!');
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn(); // Utilize the retry mechanism effectively

    const results = await runQuery(conn, `SELECT * FROM ${schema}.census`);
    if (!results) throw new Error('Call failed');

    return new NextResponse(JSON.stringify(generateHash(results)), {
      status: HTTPResponses.OK
    });
  } catch (error) {
    console.error('Error in GET:', error);
    throw new Error('Failed to fetch census data'); // Providing a more user-friendly error message
  } finally {
    if (conn) conn.release(); // Release the connection
  }
}
