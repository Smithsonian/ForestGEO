import {NextRequest, NextResponse} from "next/server";
import {PoolConnection, RowDataPacket} from "mysql2/promise";
import {getConn, getSchema, runQuery} from "@/components/processors/processormacros";

export async function GET(request: NextRequest): Promise<NextResponse<string[]>> {
  const schema = getSchema();
  const partialLastName = request.nextUrl.searchParams.get('searchfor')!;
  let conn: PoolConnection | null;
  conn = await getConn();
  try {
    const query = partialLastName === '' ?
      `SELECT FirstName, LastName
      FROM ${schema}.personnel
      ORDER BY LastName
      LIMIT 5` :
      `SELECT FirstName, LastName
      FROM ${schema}.personnel
      WHERE LastName LIKE ?
      ORDER BY LastName
      LIMIT 5`;
    const queryParams = partialLastName === '' ? [] : [`%${partialLastName}%`];
    const results = await runQuery(conn, query, queryParams);

    // Properly mapping results to return an array of { label, code }
    return new NextResponse(JSON.stringify(results.map((row: RowDataPacket) => `${row.FirstName} ${row.LastName}`)), {status: 200});
  } catch (error: any) {
    console.error('Error in GET Personnel:', error.message || error);
    throw new Error('Failed to fetch personnel data');
  } finally {
    if (conn) conn.release();
  }
}
