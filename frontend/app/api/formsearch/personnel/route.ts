import {NextRequest, NextResponse} from "next/server";
import {PoolConnection} from "mysql2/promise";
import {getConn, runQuery} from "@/components/processors/processormacros";
import {FORMSEARCH_LIMIT} from "@/config/macros/azurestorage";

export async function GET(request: NextRequest): Promise<NextResponse<string[]>> {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema provided!');
  const partialLastName = request.nextUrl.searchParams.get('searchfor')!;
  let conn: PoolConnection | null;
  conn = await getConn();
  try {
    const query = partialLastName === '' ?
      `SELECT FirstName, LastName
      FROM ${schema}.personnel
      ORDER BY LastName
      LIMIT ${FORMSEARCH_LIMIT}` :
      `SELECT FirstName, LastName
      FROM ${schema}.personnel
      WHERE LastName LIKE ?
      ORDER BY LastName
      LIMIT ${FORMSEARCH_LIMIT}`;
    const queryParams = partialLastName === '' ? [] : [`%${partialLastName}%`];
    const results = await runQuery(conn, query, queryParams);

    // Properly mapping results to return an array of { label, code }
    return new NextResponse(JSON.stringify(results.map((row: any) => `${row.FirstName} ${row.LastName}`)), {status: 200});
  } catch (error: any) {
    console.error('Error in GET Personnel:', error.message || error);
    throw new Error('Failed to fetch personnel data');
  } finally {
    if (conn) conn.release();
  }
}
