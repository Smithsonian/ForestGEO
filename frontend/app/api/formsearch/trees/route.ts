import {NextRequest, NextResponse} from "next/server";
import {PoolConnection} from "mysql2/promise";
import {getConn, runQuery} from "@/components/processors/processormacros";
import { FORMSEARCH_LIMIT } from "@/config/macros";

export async function GET(request: NextRequest): Promise<NextResponse<string[]>> {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema provided!');
  const partialTreeTag = request.nextUrl.searchParams.get('searchfor')!;
  let conn: PoolConnection | null;
  conn = await getConn();
  try {
    const query = partialTreeTag === '' ?
      `SELECT TreeTag
      FROM ${schema}.trees
      ORDER BY TreeTag
      LIMIT ${FORMSEARCH_LIMIT}` :
      `SELECT TreeTag
      FROM ${schema}.trees
      WHERE TreeTag LIKE ?
      ORDER BY TreeTag
      LIMIT ${FORMSEARCH_LIMIT}`;
    const queryParams = partialTreeTag === '' ? [] : [`%${partialTreeTag}%`];
    const results = await runQuery(conn, query, queryParams);
    return new NextResponse(JSON.stringify(results.map((row: any) => row.TreeTag)), {status: 200});
  } catch (error: any) {
    console.error('Error in GET Quadrats:', error.message || error);
    throw new Error('Failed to fetch quadrat data');
  } finally {
    if (conn) conn.release();
  }
}
