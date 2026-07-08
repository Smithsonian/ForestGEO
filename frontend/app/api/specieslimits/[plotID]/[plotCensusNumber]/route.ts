import { NextRequest, NextResponse } from 'next/server';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { fromQuery, type RouteContext, withRouteAuthz } from '@/lib/route-authz';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// pulls everything
async function handler(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const plotID = Array.isArray(params.plotID) ? params.plotID[0] : params.plotID;
  const plotCensusNumber = Array.isArray(params.plotCensusNumber) ? params.plotCensusNumber[0] : params.plotCensusNumber;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('Schema not provided');
  if (!plotID || !plotCensusNumber || isNaN(parseInt(plotID)) || isNaN(parseInt(plotCensusNumber))) throw new Error('required slugs were not provided');
  const connectionManager = ConnectionManager.getInstance();
  try {
    const query = safeFormatQuery(
      schema,
      `SELECT * FROM ??.specieslimits WHERE PlotID = ? AND CensusID IN (SELECT CensusID FROM ??.census WHERE PlotID = ? AND PlotCensusNumber = ?)`
    );
    const results = await connectionManager.executeQuery(query, [plotID, plotID, plotCensusNumber]);
    return new NextResponse(JSON.stringify(MapperFactory.getMapper<any, any>('specieslimits').mapData(results)), { status: HTTPResponses.OK });
  } catch (error: any) {
    throw new Error(error);
  } finally {
    await connectionManager.closeConnection();
  }
}

// don't need to add POST here --> the fixeddata/route POST handler can do it w/ no issue
export const GET = withRouteAuthz('specieslimits/[plotID]/[plotCensusNumber]', handler, { schema: fromQuery('schema') });
