// FETCH ALL CENSUS ROUTE HANDLERS
import {NextRequest, NextResponse} from "next/server";
import {CensusRDS} from "@/config/sqlmacros";
import {PoolConnection} from "mysql2/promise";
import {CensusResult, getConn, runQuery} from "@/components/processors/processormacros";
import {HTTPResponses} from "@/config/macros";


export async function GET(request: NextRequest): Promise<NextResponse<CensusRDS[]>> {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error("Schema selection was not provided to API endpoint");

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();

    const results = await runQuery(conn, `SELECT * FROM ${schema}.census`);
    if (!results) return new NextResponse(null, {status: 500});

    // Map the results to CensusRDS structure
    const censusRows: CensusRDS[] = results.map((row: CensusResult, index: any) => ({
      id: index + 1,
      censusID: row.CensusID,
      plotID: row.PlotID,
      plotCensusNumber: row.PlotCensusNumber,
      startDate: row.StartDate,
      endDate: row.EndDate,
      description: row.Description,
      // ... other fields as needed
    }));
    return new NextResponse(JSON.stringify(censusRows), {status: HTTPResponses.OK});
  } catch (error) {
    console.error('Error in GET:', error);
    throw new Error('Failed to fetch census data'); // Providing a more user-friendly error message
  } finally {
    if (conn) conn.release(); // Release the connection
  }
}