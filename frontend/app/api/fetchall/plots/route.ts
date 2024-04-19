// FETCH ALL PLOTS ROUTE HANDLERS
import {NextRequest, NextResponse} from "next/server";
import {PlotRDS, PlotsResult} from '@/config/sqlrdsdefinitions/plotrds';
import {getConn, runQuery} from "@/components/processors/processormacros";
import {PoolConnection} from "mysql2/promise";

export async function GET(request: NextRequest): Promise<NextResponse<PlotRDS[]>> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error("Schema selection was not provided to API endpoint");
  try {
    conn = await getConn();
    // Query to get plots
    const plotQuery = `
      SELECT * FROM ${schema}.plots
    `;
    const plotResults = await runQuery(conn, plotQuery, []);

    if (plotResults.length === 0) {
      throw new Error('No plots found');
    }

    const plotRows: PlotRDS[] = plotResults.map((row: PlotsResult, index: number) => ({
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
    throw new Error(`Failed to fetch plot data --> ${error}`);
  } finally {
    if (conn) conn.release();
  }
}
