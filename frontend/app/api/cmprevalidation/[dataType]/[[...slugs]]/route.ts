import {getConn, runQuery} from "@/components/processors/processormacros";
import {PoolConnection} from "mysql2/promise";
import {NextRequest, NextResponse} from "next/server";
import {HTTPResponses} from "@/config/macros";

// datatype: table name
// expecting 1) schema 2) plotID 3) censusID
export async function GET(_request: NextRequest, {params}: { params: { dataType: string, slugs?: string[] } }) {
  if (!params.slugs || !params.dataType) throw new Error("missing slugs");
  const [schema, plotID, censusID] = params.slugs;
  if ((!schema || schema === 'undefined') || (!plotID || plotID === 'undefined') || (!censusID || censusID === 'undefined') || (params.slugs.length > 3 || params.slugs.length < 3)) throw new Error("incorrect slugs provided");
  let connection: PoolConnection | null = null;
  try {
    connection = await getConn();

    switch (params.dataType) {
      case 'attributes':
      case 'personnel':
      case 'species':
      case 'quadrats':
        let query = `SELECT 1
                     FROM ${schema}.${params.dataType} LIMIT 1`; // Check if the table has any row
        const results = await runQuery(connection, query);
        if (results.length === 0) return new NextResponse(null, {status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE});
        break;
      case 'subquadrats':
        let subquadratsQuery = `SELECT 1
                                FROM ${schema}.${params.dataType} s
                                       JOIN ${schema}.quadrats q ON s.QuadratID = q.QuadratID
                                WHERE q.PlotID = ${plotID}
                                  AND q.CensusID = ${censusID} LIMIT 1`;
        const subquadratsResults = await runQuery(connection, subquadratsQuery);
        if (subquadratsResults.length === 0) return new NextResponse(null, {status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE});
        break;
      default:
        return new NextResponse(null, {status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE});
    }

    // If all conditions are satisfied
    return new NextResponse(null, {status: 200});
  } catch (e: any) {
    console.error(e);
    throw e;
  } finally {
    if (connection) connection.release();
  }
}