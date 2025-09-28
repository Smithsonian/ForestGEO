import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import MapperFactory from '@/config/datamapper';
import ConnectionManager from '@/config/connectionmanager';
import { validateContextualValues } from '@/lib/contextvalidation';
import ailogger from '@/ailogger';

export async function GET(request: NextRequest, props: { params: Promise<{ changelogType: string; options?: string[] }> }) {
  const params = await props.params;

  if (!params.changelogType) {
    return NextResponse.json({ error: 'changelogType parameter is required' }, { status: HTTPResponses.BAD_REQUEST });
  }

  if (!params.options || params.options.length !== 2) {
    return NextResponse.json({ error: 'Missing plot ID or census ID parameters in options' }, { status: HTTPResponses.BAD_REQUEST });
  }

  // Validate contextual values with fallback to URL params
  const validation = await validateContextualValues(request, {
    requireSchema: true,
    requirePlot: true,
    allowFallback: true,
    fallbackMessage: 'Changelog requires active site and plot selections.'
  });

  let plotID: number, pcn: number, schema: string;

  if (!validation.success) {
    // Try to use URL parameters as fallback
    const schemaParam = request.nextUrl.searchParams.get('schema');
    if (schemaParam && params.options.length === 2) {
      const [plotIDParam, pcnParam] = params.options;
      plotID = parseInt(plotIDParam);
      pcn = parseInt(pcnParam);
      schema = schemaParam;

      if (isNaN(plotID) || isNaN(pcn)) {
        return NextResponse.json({ error: 'Invalid plot ID or census number parameters' }, { status: HTTPResponses.BAD_REQUEST });
      }
    } else {
      return validation.response!;
    }
  } else {
    const values = validation.values!;
    schema = values.schema!;
    plotID = values.plotID!;
    // For changelog, we might need to derive PCN from context
    pcn = parseInt(params.options[1]);
  }

  const connectionManager = ConnectionManager.getInstance();
  try {
    let query = ``;
    switch (params.changelogType) {
      case 'unifiedchangelog':
        query = `SELECT * FROM ${schema}.unifiedchangelog 
        WHERE (PlotID = ? OR PlotID IS NULL) AND 
          (CensusID IN (SELECT CensusID FROM ${schema}.census WHERE PlotID = ? AND PlotCensusNumber = ? AND IsActive IS TRUE) OR CensusID IS NULL) 
        ORDER BY ChangeTimestamp DESC 
        LIMIT 5;`;
        break;
      case 'validationchangelog':
        query = `SELECT * 
                 FROM ${schema}.${params.changelogType} 
                 ORDER BY RunDateTime DESC LIMIT 5;`;
        break;
    }
    const results = await connectionManager.executeQuery(query, [plotID, plotID, pcn]);
    return new NextResponse(results.length > 0 ? JSON.stringify(MapperFactory.getMapper<any, any>(params.changelogType).mapData(results)) : null, {
      status: HTTPResponses.OK
    });
  } catch (e: any) {
    ailogger.error('Changelog query failed:', e);
    return NextResponse.json({ error: 'Failed to fetch changelog data', details: e.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
