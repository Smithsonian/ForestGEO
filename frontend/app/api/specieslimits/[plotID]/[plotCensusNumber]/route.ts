import { NextRequest, NextResponse } from 'next/server';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// pulls everything
export async function GET(request: NextRequest, props: { params: Promise<{ plotID: string; plotCensusNumber: string }> }) {
  const params = await props.params;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('Schema not provided');
  if (isNaN(parseInt(params.plotID)) || isNaN(parseInt(params.plotCensusNumber))) throw new Error('required slugs were not provided');
  const connectionManager = ConnectionManager.getInstance();
  try {
    const query = safeFormatQuery(
      schema,
      `SELECT * FROM ??.specieslimits WHERE PlotID = ? AND CensusID IN (SELECT CensusID FROM ??.census WHERE PlotID = ? AND PlotCensusNumber = ?)`
    );
    const results = await connectionManager.executeQuery(query, [params.plotID, params.plotID, params.plotCensusNumber]);
    return new NextResponse(JSON.stringify(MapperFactory.getMapper<any, any>('specieslimits').mapData(results)), { status: HTTPResponses.OK });
  } catch (error: any) {
    throw new Error(error);
  } finally {
    await connectionManager.closeConnection();
  }
}

// don't need to add POST here --> the fixeddata/route POST handler can do it w/ no issue
