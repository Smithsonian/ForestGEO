import {NextResponse} from "next/server";
import {AttributesRDS} from "@/config/sqlmacros";
import {PoolConnection} from "mysql2/promise";
import {getSqlConnection, runQuery} from "@/components/processors/processormacros";
import {HTTPResponses} from "@/config/macros";

export async function GET(): Promise<NextResponse<AttributesRDS[]>> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn: PoolConnection | null = null;
  try {
    conn = await getSqlConnection(0); // Utilize the retry mechanism effectively

    const results = await runQuery(conn, `SELECT * FROM ${schema}.Census`);
    if (!results) throw new Error("Call failed");

    // Map the results to CensusRDS structure
    const attributeRows: AttributesRDS[] = results.map((row: any, index: any) => ({
      id: index + 1,
      code: row.Code,
      description: row.Description,
      status: row.Status,
    }));

    return new NextResponse(JSON.stringify(attributeRows), {status: HTTPResponses.OK});
  } catch (error) {
    console.error('Error in GET:', error);
    throw new Error('Failed to fetch census data'); // Providing a more user-friendly error message
  } finally {
    if (conn) conn.release(); // Release the connection
  }
}