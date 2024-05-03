import { getConn, runQuery } from "@/components/processors/processormacros";
import MapperFactory, { IDataMapper } from "@/config/datamapper";
import { HTTPResponses } from "@/config/macros";
import { CensusRDS, CensusResult } from "@/config/sqlrdsdefinitions/tables/censusrds";
import { PlotRDS, PlotsResult } from "@/config/sqlrdsdefinitions/tables/plotrds";
import { QuadratsRDS, QuadratsResult } from "@/config/sqlrdsdefinitions/tables/quadratrds";
import { SubQuadratRDS as SubquadratRDS, SubQuadratResult as SubquadratResult } from "@/config/sqlrdsdefinitions/tables/subquadratrds";
import { PoolConnection } from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";


export async function GET(request: NextRequest, { params }: { params: { fetchType: string } }) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error("Schema selection was not provided to API endpoint");
  const fetchType = params.fetchType;

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();

    const results = await runQuery(conn, `SELECT * FROM ${schema}.${fetchType}`);
    if (!results) return new NextResponse(null, { status: 500 });

    let mapper: IDataMapper<any, any>;
    mapper = MapperFactory.getMapper<any, any>(fetchType);
    const rows = mapper.mapData(results);
    return new NextResponse(JSON.stringify(rows), {status: HTTPResponses.OK});
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}