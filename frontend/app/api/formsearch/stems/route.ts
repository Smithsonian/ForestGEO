import {NextRequest, NextResponse} from "next/server";
import {PoolConnection, RowDataPacket} from "mysql2/promise";
import {getConn, getSchema, runQuery} from "@/components/processors/processormacros";

export async function GET(request: NextRequest): Promise<NextResponse<string[]>> {
  const schema = getSchema();
  const partialStemTag = request.nextUrl.searchParams.get('searchfor')!;
  let conn: PoolConnection | null;
  conn = await getConn();
  try {
    const query = partialStemTag === '' ? `SELECT DISTINCT StemTag
      FROM ${schema}.stems
      ORDER BY StemTag
      LIMIT 10` : `SELECT DISTINCT StemTag
      FROM ${schema}.stems
      WHERE StemTag LIKE ?
      ORDER BY StemTag
      LIMIT 10`;
    const queryParams = partialStemTag === '' ? [] : [`%${partialStemTag}%`];
    const results = await runQuery(conn, query, queryParams);
    return new NextResponse(JSON.stringify(results.map((row: RowDataPacket) => row.StemTag)), {status: 200});
  } catch (error: any) {
    console.error('Error in GET Quadrats:', error.message || error);
    throw new Error('Failed to fetch quadrat data');
  } finally {
    if (conn) conn.release();
  }
}
