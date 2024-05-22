import { getConn, runQuery } from "@/components/processors/processormacros";
import MapperFactory, { IDataMapper } from "@/config/datamapper";
import { HTTPResponses } from "@/config/macros";
import { PoolConnection } from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";

const buildQuery = (schema: string, fetchType: string, plotID?: string, censusID?: string, quadratID?: string): string => {
  if (fetchType === 'plots') {
    return `
      SELECT 
        p.*, 
        COUNT(q.QuadratID) AS NumQuadrats
      FROM 
        ${schema}.plots p
      LEFT JOIN 
        ${schema}.quadrats q ON p.PlotID = q.PlotID
      GROUP BY 
        p.PlotID
      ${plotID && plotID !== 'undefined' && !isNaN(parseInt(plotID)) ? `HAVING p.PlotID = ${plotID}` : ''}`;
  }

  let query = `SELECT * FROM ${schema}.${fetchType}`;
  const conditions = [];

  if (plotID && plotID !== 'undefined' && !isNaN(parseInt(plotID))) conditions.push(`PlotID = ${plotID}`);
  if (censusID && censusID !== 'undefined' && !isNaN(parseInt(censusID))) conditions.push(`CensusID = ${censusID}`);
  if (quadratID && quadratID !== 'undefined' && !isNaN(parseInt(quadratID))) conditions.push(`QuadratID = ${quadratID}`);

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  return query;
};


export async function GET(request: NextRequest, { params }: { params: { slugs?: string[] } }) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema || schema === 'undefined') {
    throw new Error("Schema selection was not provided to API endpoint");
  }

  const [fetchType, plotID, censusID, quadratID] = params.slugs ?? [];
  if (!fetchType) {
    throw new Error("fetchType was not correctly provided");
  } 

  console.log('fetchType: ', fetchType);

  const query = buildQuery(schema, fetchType, plotID, censusID, quadratID);
  let conn: PoolConnection | null = null;

  try {
    conn = await getConn();
    const results = await runQuery(conn, query);
    if (!results) {
      return new NextResponse(null, { status: 500 });
    }

    const mapper: IDataMapper<any, any> = MapperFactory.getMapper<any, any>(fetchType);
    const rows = mapper.mapData(results);
    return new NextResponse(JSON.stringify(rows), { status: HTTPResponses.OK });
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}
