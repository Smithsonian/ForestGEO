import { getConn, runQuery } from "@/components/processors/processormacros";
import MapperFactory, { IDataMapper } from "@/config/datamapper";
import { HTTPResponses } from "@/config/macros";
import { PoolConnection } from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";


export async function GET(request: NextRequest, { params }: { params: { slugs?: string[] } }) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema || schema === 'undefined') throw new Error("Schema selection was not provided to API endpoint");
  if (!params.slugs || params.slugs.length === 0) throw new Error("fetchType was not correctly provided");
  // optional parameter handling -- if optional parameters are provided, check for them and handle appropriately.
  if (params.slugs.length > 1) {
    // fetchType will always be first
    // order of provision: plotID, censusID, quadratID
    let [fetchType, plotID, censusID, quadratID] = params.slugs; // censusID or quadratID may be null
    let paginatedQuery = `SELECT * FROM ${schema}.${fetchType} 
    WHERE ${plotID && plotID !== 'undefined' && !isNaN(parseInt(plotID)) ? `PlotID = ${plotID} ` : ``} 
    ${censusID && censusID !== 'undefined' && !isNaN(parseInt(censusID)) ? `AND CensusID = ${censusID} ` : ``}
    ${quadratID && quadratID !== 'undefined' && !isNaN(parseInt(quadratID)) ? ` AND QuadratID = ${quadratID}` : ``}`;
    let conn: PoolConnection | null = null;
    try {
      conn = await getConn();

      const results = await runQuery(conn, paginatedQuery);
      if (!results) return new NextResponse(null, { status: 500 });

      let mapper: IDataMapper<any, any>;
      mapper = MapperFactory.getMapper<any, any>(fetchType);
      const rows = mapper.mapData(results);
      return new NextResponse(JSON.stringify(rows), { status: HTTPResponses.OK });
    } catch (error) {
      console.error('Error:', error);
      throw new Error("Call failed");
    } finally {
      if (conn) conn.release();
    }
  } else {
    const [fetchType] = params.slugs;
    let conn: PoolConnection | null = null;
    try {
      conn = await getConn();

      const results = await runQuery(conn, `SELECT * FROM ${schema}.${fetchType}`);
      if (!results) return new NextResponse(null, { status: 500 });

      let mapper: IDataMapper<any, any>;
      mapper = MapperFactory.getMapper<any, any>(fetchType);
      const rows = mapper.mapData(results);
      return new NextResponse(JSON.stringify(rows), { status: HTTPResponses.OK });
    } catch (error) {
      console.error('Error:', error);
      throw new Error("Call failed");
    } finally {
      if (conn) conn.release();
    }
  }
}