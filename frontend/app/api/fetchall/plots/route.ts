// FETCH ALL PLOTS ROUTE HANDLERS
import {NextResponse} from "next/server";
import {PlotRDS} from "@/config/sqlmacros";
import {getSchema, getSqlConnection, runQuery} from "@/components/processors/processormacros";
import {PoolConnection, RowDataPacket} from "mysql2/promise";

export async function GET(): Promise<NextResponse<PlotRDS[]>> {
  let conn: PoolConnection | null = null;
  try {
    const schema = getSchema();
    conn = await getSqlConnection(0);
    const query = `SELECT * FROM ${schema}.Plots`;
    const results = await runQuery(conn, query);

    const plotRows: PlotRDS[] = results.map((row: any, index: number) => ({
      id: index + 1,
      plotID: row.PlotID,
      plotName: row.PlotName,
      locationName: row.LocationName,
      countryName: row.CountryName,
      dimensionX: row.DimensionX,
      dimensionY: row.DimensionY,
      area: row.Area,
      globalX: row.GlobalX,
      globalY: row.GlobalY,
      globalZ: row.GlobalZ,
      plotX: row.PlotX,
      plotY: row.PlotY,
      plotZ: row.PlotZ,
      plotShape: row.PlotShape,
      plotDescription: row.PlotDescription,
    }));

    return new NextResponse(JSON.stringify(plotRows), {status: 200});
  } catch (error) {
    console.error('Error in GET:', error);
    throw new Error('Failed to fetch plot data');
  } finally {
    if (conn) conn.release();
  }
}
