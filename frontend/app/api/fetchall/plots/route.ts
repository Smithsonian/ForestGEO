// FETCH ALL PLOTS ROUTE HANDLERS
import {NextRequest, NextResponse} from "next/server";
import {PlotRDS} from "@/config/sqlmacros";
import {getCatalogSchema, getConn, getSchema, getSqlConnection, PlotsResult, runQuery} from "@/components/processors/processormacros";
import {PoolConnection} from "mysql2/promise";

export async function GET(request: NextRequest): Promise<NextResponse<PlotRDS[]>> {
  let conn: PoolConnection | null = null;
  try {
    const schema = getSchema();
    const catalogSchema = getCatalogSchema();
    conn = await getConn();

    const lastName = request.nextUrl.searchParams.get('lastname');
    const email = request.nextUrl.searchParams.get('email');

    if (!lastName || !email) throw new Error('missing lastname or email');

    const userQuery = `
      SELECT UserID FROM ${catalogSchema}.users
      WHERE LastName = ? AND Email = ?
    `;
    const userParams = [lastName, email];
    const userResults = await runQuery(conn, userQuery, userParams);

    if (userResults.length === 0) {
      throw new Error('User not found');
    }
    const userID = userResults[0].UserID;

    // Query to get plots
    const plotQuery = `
      SELECT p.*
      FROM ${schema}.Plots AS p
      LEFT JOIN ${catalogSchema}.UserPlotRelations AS upr ON p.PlotID = upr.PlotID
      WHERE (upr.UserID = ? OR upr.AllPlots = 1) AND (upr.UserID IS NOT NULL)
    `;
    const plotParams = [userID];
    const plotResults = await runQuery(conn, plotQuery, plotParams);

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
    throw new Error('Failed to fetch plot data');
  } finally {
    if (conn) conn.release();
  }
}
