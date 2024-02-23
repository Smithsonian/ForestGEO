import {NextResponse} from "next/server";
import {AttributesRDS} from "@/config/sqlmacros";
import {PoolConnection} from "mysql2/promise";
import {getSqlConnection, runQuery} from "@/components/processors/processormacros";

export async function GET(): Promise<NextResponse<AttributesRDS[]>> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn: PoolConnection | null = null;
  try {
    conn = await getSqlConnection(0);
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