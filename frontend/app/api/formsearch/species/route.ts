import {NextRequest, NextResponse} from "next/server";
import {PoolConnection, RowDataPacket} from "mysql2/promise";
import {getConn, getSchema, runQuery} from "@/components/processors/processormacros";

export async function GET(request: NextRequest): Promise<NextResponse<string[]>> {
  const schema = getSchema();
  const partialSpeciesCode = request.nextUrl.searchParams.get('searchfor')!;
  let conn: PoolConnection | null;
  conn = await getConn();
  try {
    const query = partialSpeciesCode === '' ? `SELECT SpeciesCode
      FROM ${schema}.species
      ORDER BY SpeciesCode
      LIMIT 5` : `SELECT SpeciesCode
      FROM ${schema}.species
      WHERE SpeciesCode LIKE ?
      ORDER BY SpeciesCode
      LIMIT 5`;
    const queryParams = partialSpeciesCode === '' ? [] : [`%${partialSpeciesCode}%`];
    const results = await runQuery(conn, query, queryParams);
    return new NextResponse(JSON.stringify(results.map((row: RowDataPacket) => row.SpeciesCode)), {status: 200});
  } catch (error: any) {
    console.error('Error in GET Quadrats:', error.message || error);
    throw new Error('Failed to fetch quadrat data');
  } finally {
    if (conn) conn.release();
  }
}
