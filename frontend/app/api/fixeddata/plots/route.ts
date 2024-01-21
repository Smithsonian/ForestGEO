import { NextResponse } from "next/server";
import { PlotRDS } from "@/config/sqlmacros";
import { getSqlConnection, runQuery } from "@/components/processors/processorhelpers";
import {PoolConnection, RowDataPacket} from "mysql2/promise";

export async function GET(): Promise<NextResponse<PlotRDS[]>> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) {
    throw new Error("Environmental variable extraction for schema failed");
  }
  let conn : PoolConnection | null = null;
  try {
    conn = await getSqlConnection(0);
    const query = `SELECT * FROM ${schema}.Plots`;
    const results = await runQuery(conn, query);

    const plotRows: PlotRDS[] = results.map((row: RowDataPacket, index: number) => ({
      id: index + 1,
      plotID: row.PlotID,
      plotName: row.PlotName,
      locationName: row.LocationName,
      countryName: row.CountryName,
      area: row.Area,
      plotX: row.PlotX,
      plotY: row.PlotY,
      plotZ: row.PlotZ,
      plotShape: row.PlotShape,
      plotDescription: row.PlotDescription,
    }));

    return new NextResponse(JSON.stringify(plotRows), { status: 200 });
  } catch (error) {
    console.error('Error in GET:', error);
    throw new Error('Failed to fetch plot data');
  } finally {
    if (conn) conn.release();
  }
}
