import {NextRequest, NextResponse} from "next/server";
import {PoolConnection, RowDataPacket} from "mysql2/promise";
import {getConn, getSchema, runQuery} from "@/components/processors/processormacros";

export async function GET(request: NextRequest): Promise<NextResponse<string[]>> {
  const schema = getSchema();
  const partialCode = request.nextUrl.searchParams.get('searchfor')!;
  let conn: PoolConnection | null;
  conn = await getConn();
  try {
    const query = partialCode === '' ?
      `SELECT DISTINCT Code FROM ${schema}.attributes ORDER BY Code LIMIT 10` :
      `SELECT DISTINCT Code FROM ${schema}.attributes WHERE Code LIKE ? ORDER BY Code LIMIT 10`;
    const queryParams = partialCode === '' ? [] : [`%${partialCode}%`];
    const results = await runQuery(conn, query, queryParams);

    // Properly mapping results to return an array of { label, code }
    return new NextResponse(JSON.stringify(results.map((row: RowDataPacket) => row.Code)), {status: 200});
  } catch (error: any) {
    console.error('Error in GET Attributes:', error.message || error);
    throw new Error('Failed to fetch attribute data');
  } finally {
    if (conn) conn.release();
  }
}
