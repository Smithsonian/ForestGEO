import {NextRequest, NextResponse} from "next/server";
import {PoolConnection} from "mysql2/promise";
import {getConn, runQuery} from "@/components/processors/processormacros";
import {FORMSEARCH_LIMIT} from "@/config/macros";

export async function GET(request: NextRequest): Promise<NextResponse<string[]>> {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema provided!');
  const partialCode = request.nextUrl.searchParams.get('searchfor')!;
  let conn: PoolConnection | null;
  conn = await getConn();
  try {
    const query = partialCode === '' ?
      `SELECT DISTINCT Code FROM ${schema}.attributes ORDER BY Code LIMIT ${FORMSEARCH_LIMIT}` :
      `SELECT DISTINCT Code FROM ${schema}.attributes WHERE Code LIKE ? ORDER BY Code LIMIT ${FORMSEARCH_LIMIT}`;
    const queryParams = partialCode === '' ? [] : [`%${partialCode}%`];
    const results = await runQuery(conn, query, queryParams);

    return new NextResponse(JSON.stringify(results.map((row: any) => row.Code)), {status: 200});
  } catch (error: any) {
    console.error('Error in GET Attributes:', error.message || error);
    throw new Error('Failed to fetch attribute data');
  } finally {
    if (conn) conn.release();
  }
}
