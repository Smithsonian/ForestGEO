// FETCH ALL CENSUS ROUTE HANDLERS
import {NextResponse} from "next/server";
import {CensusRDS} from "@/config/sqlmacros";
import {PoolConnection} from "mysql2/promise";
import {getSqlConnection, runQuery} from "@/components/processors/processormacros";
import {HTTPResponses} from "@/config/macros";


export async function GET(): Promise<NextResponse<CensusRDS[]>> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn: PoolConnection | null = null;
  try {
    conn = await getSqlConnection(0); // Utilize the retry mechanism effectively

    const results = await runQuery(conn, `SELECT * FROM ${schema}.Census`);
    if (!results) throw new Error("Call failed");

    // Map the results to CensusRDS structure
    const censusRows: CensusRDS[] = results.map((row, index) => ({
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