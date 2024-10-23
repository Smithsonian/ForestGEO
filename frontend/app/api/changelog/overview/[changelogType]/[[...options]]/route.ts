import { NextRequest, NextResponse } from 'next/server';
import { PoolConnection } from 'mysql2/promise';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { HTTPResponses } from '@/config/macros';
import MapperFactory from '@/config/datamapper';

export async function GET(request: NextRequest, { params }: { params: { changelogType: string; options?: string[] } }) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('schema not found');
  if (!params.changelogType) throw new Error('changelogType not provided');
  if (!params.options) throw new Error('options not provided');
  if (params.options.length !== 2) throw new Error('Missing plot id or census id parameters');
  const [plotIDParam, pcnParam] = params.options;
  const plotID = parseInt(plotIDParam);
  const pcn = parseInt(pcnParam);
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    let query = ``;
    switch (params.changelogType) {
      case 'unifiedchangelog':
        query = `
        SELECT * FROM ${schema}.unifiedchangelog
        WHERE 
          (PlotID = ? OR PlotID IS NULL) AND 
          (CensusID IN (SELECT CensusID FROM ${schema}.census WHERE PlotID = ? AND PlotCensusNumber = ?) OR CensusID IS NULL)
        ORDER BY ChangeTimestamp DESC 
        LIMIT 5;`;
        break;
      case 'validationchangelog':
        query = `SELECT *
                 FROM ${schema}.${params.changelogType}
                 ORDER BY RunDateTime DESC LIMIT 5;`;
        break;
    }

    const results = await runQuery(conn, query, [plotID, plotID, pcn]);
    conn.release();
    return new NextResponse(results.length > 0 ? JSON.stringify(MapperFactory.getMapper<any, any>(params.changelogType).mapData(results)) : null, {
      status: HTTPResponses.OK
    });
  } catch (e: any) {
    throw new Error('SQL query failed: ' + e.message);
  } finally {
    if (conn) conn.release();
  }
}
