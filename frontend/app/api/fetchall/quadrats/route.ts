// FETCH ALL QUADRATS ROUTE HANDLERS
import {NextRequest, NextResponse} from "next/server";
import {QuadratsRDS} from "@/config/sqlmacros";
import {PoolConnection} from "mysql2/promise";
import {getConn, QuadratsResult, runQuery} from "@/components/processors/processormacros";

export async function GET(request: NextRequest): Promise<NextResponse<QuadratsRDS[]>> {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error("Schema selection was not provided to API endpoint");

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const query = `SELECT * FROM ${schema}.Quadrats`;
    const results = await runQuery(conn, query);

    const quadratRows: QuadratsRDS[] = results.map((row: QuadratsResult, index: number) => ({
      id: index + 1,
      quadratID: row.QuadratID,
      plotID: row.PlotID,
      censusID: row.CensusID,
      quadratName: row.QuadratName,
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