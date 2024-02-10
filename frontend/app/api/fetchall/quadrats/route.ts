// FETCH ALL QUADRATS ROUTE HANDLERS
import {NextResponse} from "next/server";
import {QuadratRDS} from "@/config/sqlmacros";
import {PoolConnection} from "mysql2/promise";
import {getSqlConnection, QuadratsResult, runQuery} from "@/components/processors/processormacros";

export async function GET(): Promise<NextResponse<QuadratRDS[]>> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn: PoolConnection | null = null;
  try {
    conn = await getSqlConnection(0);
    const query = `SELECT * FROM ${schema}.Quadrats`;
    const results = await runQuery(conn, query);

    const quadratRows: QuadratRDS[] = results.map((row: QuadratsResult, index: number) => ({
      id: index + 1,
      quadratID: row.QuadratID,
      plotID: row.PlotID,
      quadratName: row.QuadratName,
      quadratX: row.QuadratX,
      quadratY: row.QuadratY,
      dimensionX: row.DimensionX,
      dimensionY: row.DimensionY,
      area: row.Area,
      quadratShape: row.QuadratShape
    }));
    return new NextResponse(JSON.stringify(quadratRows), {status: 200});
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}