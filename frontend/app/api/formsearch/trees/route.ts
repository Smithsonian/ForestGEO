import { NextRequest, NextResponse } from 'next/server';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { FORMSEARCH_LIMIT } from '@/config/macros/azurestorage';
import { HTTPResponses } from '@/config/macros';

export async function GET(request: NextRequest): Promise<NextResponse<string[]>> {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema || schema === 'undefined') throw new Error('no schema provided!');
  const partialTreeTag = request.nextUrl.searchParams.get('searchfor')!;
  const conn = await getConn();
  try {
    const query =
      partialTreeTag === ''
        ? `SELECT TreeTag
      FROM ${schema}.trees
      ORDER BY TreeTag
      LIMIT ${FORMSEARCH_LIMIT}`
        : `SELECT TreeTag
      FROM ${schema}.trees
      WHERE TreeTag LIKE ?
      ORDER BY TreeTag
      LIMIT ${FORMSEARCH_LIMIT}`;
    const queryParams = partialTreeTag === '' ? [] : [`%${partialTreeTag}%`];
    const results = await runQuery(conn, query, queryParams);
    conn.release();
    return new NextResponse(JSON.stringify(results.map((row: any) => row.TreeTag)), { status: HTTPResponses.OK });
  } catch (error: any) {
    console.error('Error in GET Quadrats:', error.message || error);
    throw new Error('Failed to fetch quadrat data');
  } finally {
    if (conn) conn.release();
  }
}
