import {NextRequest, NextResponse} from "next/server";
import {PoolConnection} from "mysql2/promise";
import {getConn, getSchema, runQuery} from "@/components/processors/processormacros";

export async function GET(request: NextRequest): Promise<NextResponse<string[]>> {
  const schema = getSchema();
  const partialQuadratName = request.nextUrl.searchParams.get('searchfor')!;
  let conn: PoolConnection | null;
  conn = await getConn();
  try {
    const query = partialQuadratName === '' ?
      `SELECT QuadratName
      FROM ${schema}.quadrats
      ORDER BY QuadratName
      LIMIT 5` :
      `SELECT QuadratName
      FROM ${schema}.quadrats
      WHERE QuadratName LIKE ?
      ORDER BY QuadratName
      LIMIT 5`;
    const queryParams = partialQuadratName === '' ? [] : [`%${partialQuadratName}%`];
    const results = await runQuery(conn, query, queryParams);
    return new NextResponse(JSON.stringify(results.map((row: any) => row.QuadratName)), {status: 200});
  } catch (error: any) {
    console.error('Error in GET Quadrats:', error.message || error);
    throw new Error('Failed to fetch quadrat data');
  } finally {
    if (conn) conn.release();
  }
}
