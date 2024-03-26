import {NextRequest, NextResponse} from "next/server";
import {AttributesRDS} from "@/config/sqlmacros";
import {PoolConnection} from "mysql2/promise";
import {getConn, runQuery} from "@/components/processors/processormacros";

export async function GET(request: NextRequest): Promise<NextResponse<AttributesRDS[]>> {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error("Schema selection was not provided to API endpoint");

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const query = `SELECT * FROM ${schema}.Quadrats`;
    const results = await runQuery(conn, query);

    const attributeRows: AttributesRDS[] = results.map((row: any, index: number) => ({
      id: index + 1,
      code: row.Code,
      description: row.Description,
      status: row.Status,
    }));
    return new NextResponse(JSON.stringify(attributeRows), {status: 200});
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}