import { NextRequest, NextResponse } from 'next/server';
import { PoolConnection } from 'mysql2/promise';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { HTTPResponses } from '@/config/macros';
import MapperFactory from '@/config/datamapper';

export async function GET(request: NextRequest, { params }: { params: { changelogType: string } }) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('schema not found');
  if (!params.changelogType) throw new Error('changelogType not provided');
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    let query = ``;
    switch (params.changelogType) {
      case 'unifiedchangelog':
        query = `SELECT *
                 FROM ${schema}.unifiedchangelog
                 ORDER BY ChangeTimestamp DESC LIMIT 5;`;
        break;
      case 'validationchangelog':
        query = `SELECT *
                 FROM ${schema}.${params.changelogType}
                 ORDER BY RunDateTime DESC LIMIT 5;`;
        break;
    }

    const results = await runQuery(conn, query);
    return new NextResponse(results.length > 0 ? JSON.stringify(MapperFactory.getMapper<any, any>(params.changelogType).mapData(results)) : null, {
      status: HTTPResponses.OK
    });
  } catch (e: any) {
    throw new Error('SQL query failed: ' + e.message);
  } finally {
    if (conn) conn.release();
  }
}
