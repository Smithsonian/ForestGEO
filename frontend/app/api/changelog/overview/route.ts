import { NextRequest, NextResponse } from 'next/server';
import { PoolConnection } from 'mysql2/promise';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { HTTPResponses } from '@/config/macros';
import MapperFactory from '@/config/datamapper';

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('schema not found');
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const query = `SELECT * FROM ${schema}.unifiedchangelog ORDER BY ChangeTimestamp DESC LIMIT 5;`;
    const results = await runQuery(conn, query);
    return new NextResponse(JSON.stringify(MapperFactory.getMapper<any, any>('unifiedchangelog').mapData(results)), { status: HTTPResponses.OK });
  } catch (e: any) {
    throw new Error('SQL query failed: ' + e.message);
  } finally {
    if (conn) conn.release();
  }
}
