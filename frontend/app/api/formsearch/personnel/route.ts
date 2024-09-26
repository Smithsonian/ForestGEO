import { NextRequest, NextResponse } from 'next/server';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { FORMSEARCH_LIMIT } from '@/config/macros/azurestorage';
import { HTTPResponses } from '@/config/macros';

export async function GET(request: NextRequest): Promise<NextResponse<string[]>> {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema || schema === 'undefined') throw new Error('no schema provided!');
  const partialLastName = request.nextUrl.searchParams.get('searchfor')!;
  const conn = await getConn();
  try {
    const query =
      partialLastName === ''
        ? `SELECT FirstName, LastName
      FROM ${schema}.personnel
      ORDER BY LastName
      LIMIT ${FORMSEARCH_LIMIT}`
        : `SELECT FirstName, LastName
      FROM ${schema}.personnel
      WHERE LastName LIKE ?
      ORDER BY LastName
      LIMIT ${FORMSEARCH_LIMIT}`;
    const queryParams = partialLastName === '' ? [] : [`%${partialLastName}%`];
    const results = await runQuery(conn, query, queryParams);

    // Properly mapping results to return an array of { label, code }
    return new NextResponse(JSON.stringify(results.map((row: any) => `${row.FirstName} ${row.LastName}`)), { status: HTTPResponses.OK });
  } catch (error: any) {
    console.error('Error in GET Personnel:', error.message || error);
    throw new Error('Failed to fetch personnel data');
  } finally {
    if (conn) conn.release();
  }
}
