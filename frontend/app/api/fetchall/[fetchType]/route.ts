import { getConn, runQuery } from "@/components/processors/processormacros";
import { HTTPResponses } from "@/config/macros";
import { CensusRDS, CensusResult } from "@/config/sqlrdsdefinitions/censusrds";
import { PlotRDS, PlotsResult } from "@/config/sqlrdsdefinitions/plotrds";
import { QuadratsRDS, QuadratsResult } from "@/config/sqlrdsdefinitions/quadratrds";
import { SubQuadratRDS, SubQuadratResult } from "@/config/sqlrdsdefinitions/subquadratrds";
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

    switch (fetchType) {
      case 'census':
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
        return new NextResponse(JSON.stringify(censusRows), { status: HTTPResponses.OK });
      case 'plots':
        const plotRows: PlotRDS[] = results.map((row: PlotsResult, index: number) => ({
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
          plotShape: row.PlotShape,
          plotDescription: row.PlotDescription,
        }));

        return new NextResponse(JSON.stringify(plotRows), { status: 200 });
      case 'quadrats':
        const quadratRows: QuadratsRDS[] = results.map((row: QuadratsResult, index: number) => ({
          id: index + 1,
          quadratID: row.QuadratID,
          plotID: row.PlotID,
          censusID: row.CensusID,
          quadratName: row.QuadratName,
          dimensionX: row.DimensionX,
          dimensionY: row.DimensionY,
          area: row.Area,
          quadratShape: row.QuadratShape
        }));
        return new NextResponse(JSON.stringify(quadratRows), { status: 200 });
      case 'subquadrats':
        const subquadratRows: SubQuadratRDS[] = results.map((row: SubQuadratResult, index: number) => ({
          id: index + 1,
          subquadratID: row.SQID,
          subquadratName: row.SQName,
          quadratID: row.QuadratID,
          xIndex: row.Xindex,
          yIndex: row.Yindex,
          sqIndex: row.SQindex
        }));
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