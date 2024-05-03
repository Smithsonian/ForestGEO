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
    switch (fetchType) {
      case 'census':
        // Map the results to CensusRDS structure
        mapper = MapperFactory.getMapper<CensusResult, CensusRDS>('Census');
        const censusRows = mapper.mapData(results);
        return new NextResponse(JSON.stringify(censusRows), { status: HTTPResponses.OK });
      case 'plots':
        mapper = MapperFactory.getMapper<PlotsResult, PlotRDS>('Plots');
        const plotRows = mapper.mapData(results);
        return new NextResponse(JSON.stringify(plotRows), { status: 200 });
      case 'quadrats':
        mapper = MapperFactory.getMapper<QuadratsResult, QuadratsRDS>('Quadrats');
        const quadratRows = mapper.mapData(results);
        return new NextResponse(JSON.stringify(quadratRows), { status: 200 });
      case 'subquadrats':
        mapper = MapperFactory.getMapper<SubquadratResult, SubquadratRDS>('Subquadrats');
        const subquadratRows = mapper.mapData(results);
        return new NextResponse(JSON.stringify(subquadratRows), { status: 200 });
      default:
        return new NextResponse(null, { status: 500 });
    }
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}