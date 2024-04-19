import {NextRequest, NextResponse} from "next/server";
import {PoolConnection} from "mysql2/promise";
import {getConn, runQuery} from "@/components/processors/processormacros";
import {FORMSEARCH_LIMIT} from "@/config/macros/azurestorage";

export async function GET(request: NextRequest): Promise<NextResponse<string[]>> {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema provided!');
  const partialSpeciesCode = request.nextUrl.searchParams.get('searchfor')!;
  let conn: PoolConnection | null;
  conn = await getConn();
  try {
    const query = partialSpeciesCode === '' ? `SELECT SpeciesCode
      FROM ${schema}.species
      ORDER BY SpeciesCode
      LIMIT ${FORMSEARCH_LIMIT}` : `SELECT SpeciesCode
      FROM ${schema}.species
      WHERE SpeciesCode LIKE ?
      ORDER BY SpeciesCode
      LIMIT ${FORMSEARCH_LIMIT}`;
    const queryParams = partialSpeciesCode === '' ? [] : [`%${partialSpeciesCode}%`];
    const results = await runQuery(conn, query, queryParams);
    return new NextResponse(JSON.stringify(results.map((row: any) => row.SpeciesCode)), {status: 200});
  } catch (error: any) {
    console.error('Error in GET Quadrats:', error.message || error);
    throw new Error('Failed to fetch quadrat data');
  } finally {
    if (conn) conn.release();
  }
}
