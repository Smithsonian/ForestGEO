import { getConn, runQuery } from "@/components/processors/processormacros";
import { HTTPResponses } from "@/config/macros";
import { PoolConnection } from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";

/**
 * Handles the POST request for the rollover API endpoint, which allows users to roll over quadrat or personnel data from one census to another within a specified schema.
 *
 * @param request - The NextRequest object containing the incoming request data.
 * @param params - The route parameters, including the `dataType` (either 'quadrats' or 'personnel') and the `slugs` (an array containing the schema, plotID, sourceCensusID, and newCensusID).
 * @returns A NextResponse with a success message or an error message, along with the appropriate HTTP status code.
 */
export async function POST(request: NextRequest, { params }: { params: { dataType: string; slugs?: string[] } }) {
  if (!params.slugs) throw new Error("slugs not provided");
  const [schema, plotID, sourceCensusID, newCensusID] = params.slugs;
  if (!schema || !plotID || !sourceCensusID || !newCensusID) throw new Error("no schema or plotID or censusID provided");

  let conn: PoolConnection | null = null;
  try {
    const { incoming } = await request.json();
    if (!Array.isArray(incoming) || incoming.length === 0) throw new Error("No quadrat or personnel IDs provided");

    conn = await getConn();
    if (conn) console.log("connection created.");

    let query = ``;
    let queryParams = [];

    await conn.beginTransaction();
    console.log("transaction started.");

    switch (params.dataType) {
      case "quadrats":
        query = `
          INSERT INTO ${schema}.quadrats (PlotID, CensusID, QuadratName, StartX, StartY, CoordinateUnits, DimensionX, DimensionY, DimensionUnits, Area, AreaUnits, QuadratShape)
          SELECT 
              PlotID, 
              ?, 
              QuadratName, 
              StartX, 
              StartY, 
              CoordinateUnits, 
              DimensionX, 
              DimensionY, 
              DimensionUnits, 
              Area, 
              AreaUnits, 
              QuadratShape
          FROM ${schema}.quadrats
          WHERE CensusID = ? AND QuadratID IN (${incoming.map(() => "?").join(", ")});`;
        queryParams = [Number(newCensusID), Number(sourceCensusID), ...incoming];
        await runQuery(conn, query, queryParams);
        break;
      case "personnel":
        query = `
          INSERT INTO ${schema}.personnel (CensusID, FirstName, LastName, RoleID)
          SELECT 
              ?, 
              FirstName, 
              LastName, 
              RoleID
          FROM ${schema}.personnel
          WHERE CensusID = ? AND PersonnelID IN (${incoming.map(() => "?").join(", ")});`;
        queryParams = [Number(newCensusID), Number(sourceCensusID), ...incoming];
        await runQuery(conn, query, queryParams);
        break;
      default:
        throw new Error("Invalid data type");
    }
    await conn.commit(); // testing
    return new NextResponse(JSON.stringify({ message: "Rollover successful" }), { status: HTTPResponses.OK });
  } catch (error: any) {
    await conn?.rollback();
    console.error("Error in rollover API:", error.message);
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: 500
    });
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Handles the POST request for the rollover API endpoint, which allows users to rollover quadrat or personnel data from one census to another within a given schema.
 *
 * The slugs provided in the URL MUST include (in order): a schema, plotID, source censusID, and new censusID to target.
 *
 * @param request - The NextRequest object containing the request data.
 * @param params - The URL parameters, including the dataType, schema, plotID, source censusID, and new censusID.
 * @returns A NextResponse with a success message or an error message.
 */
