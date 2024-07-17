import {NextRequest, NextResponse} from "next/server";
import {getConn, runQuery} from "@/components/processors/processormacros";
import {FORMSEARCH_LIMIT} from "@/config/macros/azurestorage";
import { HTTPResponses } from "@/config/macros";

export async function GET(request: NextRequest): Promise<NextResponse<string[]>> {
  const schema = request.nextUrl.searchParams.get('schema');
  if ((!schema || schema === 'undefined')) throw new Error('no schema provided!');
  const partialStemTag = request.nextUrl.searchParams.get('searchfor')!;
  const conn = await getConn();
  try {
    const query = partialStemTag === '' ?
      `SELECT StemTag
      FROM ${schema}.stems
      ORDER BY StemTag
      LIMIT ${FORMSEARCH_LIMIT}` :
      `SELECT StemTag
      FROM ${schema}.stems
      WHERE StemTag LIKE ?
      ORDER BY StemTag
      LIMIT ${FORMSEARCH_LIMIT}`;
    const queryParams = partialStemTag === '' ? [] : [`%${partialStemTag}%`];
    const results = await runQuery(conn, query, queryParams);
    return new NextResponse(JSON.stringify(results.map((row: any) => row.StemTag ? row.StemTag : '')), {status: HTTPResponses.OK});
  } catch (error: any) {
    console.error('Error in GET Quadrats:', error.message || error);
    throw new Error('Failed to fetch quadrat data');
  } finally {
    if (conn) conn.release();
  }
}
