import {NextRequest, NextResponse} from "next/server";
import {PoolConnection} from "mysql2/promise";
import {getCatalogSchema, getConn, runQuery} from "@/components/processors/processormacros";
import {generateHash} from "@/config/crypto-actions";

export async function GET(request: NextRequest) {
  let conn: PoolConnection | null = null;
  const email = request.nextUrl.searchParams.get('email');
  if (!email) throw new Error('missing email');
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema provided!');
  try {
    const catalogSchema = getCatalogSchema();
    conn = await getConn();
    const userQuery = `
      SELECT UserID FROM ${catalogSchema}.users
      WHERE Email = ?
    `;
    const userParams = [email];
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

    return new NextResponse(JSON.stringify(generateHash(plotResults)), {status: 200});
  } catch (error) {
    console.error('Error in GET:', error);
    throw new Error('Failed to fetch plot data');
  } finally {
    if (conn) conn.release();
  }
}