import { NextRequest } from 'next/server';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { PoolConnection } from 'mysql2/promise';

export async function GET(_request: NextRequest, { params }: { params: { schema: string } }) {
  const schema = params.schema;
  if (!schema) throw new Error('no schema variable provided!');
  const query = `SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = ?`;
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const results = await runQuery(conn, query, [schema]);
    conn.release();
    return new Response(JSON.stringify(results), { status: 200 });
  } catch (e: any) {
    console.error('Error:', e);
    throw new Error('Call failed: ', e);
  } finally {
    if (conn) conn.release();
  }
}
