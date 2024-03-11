import {NextResponse} from "next/server";
import {PersonnelRDS} from "@/config/sqlmacros";
import {PoolConnection} from "mysql2/promise";
import {getSqlConnection, PersonnelResult, runQuery} from "@/components/processors/processormacros";

export async function GET(): Promise<NextResponse<PersonnelRDS[]>> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn: PoolConnection | null = null;
  try {
    conn = await getSqlConnection(0);
    const query = `SELECT * FROM ${schema}.Quadrats`;
    const results = await runQuery(conn, query);

    const personnelRows: PersonnelRDS[] = results.map((row: PersonnelResult, index: number) => ({
      id: index + 1,
      personnelID: row.PersonnelID,
      firstName: row.FirstName,
      lastName: row.LastName,
      role: row.Role
    }));

    return new NextResponse(JSON.stringify(personnelRows), {status: 200});
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}