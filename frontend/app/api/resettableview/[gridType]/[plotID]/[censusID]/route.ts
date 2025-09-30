import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { validateContextualValues } from '@/lib/contextvalidation';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{ gridType: string; plotID: string; censusID: string }>;
  }
) {
  const { gridType, plotID: plotIDParam, censusID: censusIDParam } = await props.params;

  if (!gridType) {
    return NextResponse.json({ error: 'Grid type parameter is required' }, { status: HTTPResponses.BAD_REQUEST });
  }

  // Validate contextual values with fallback to URL params
  const validation = await validateContextualValues(request, {
    requireSchema: true,
    requirePlot: true,
    requireCensus: true,
    allowFallback: true,
    fallbackMessage: 'Resettable view operations require active site, plot, and census selections.'
  });

  if (!validation.success) {
    // Try to use URL parameters as fallback
    const schema = request.nextUrl.searchParams.get('schema');
    if (schema && plotIDParam && censusIDParam) {
      const plotID = parseInt(plotIDParam);
      const censusID = parseInt(censusIDParam);

      if (isNaN(plotID) || isNaN(censusID)) {
        return NextResponse.json({ error: 'Invalid plot ID or census ID parameters' }, { status: HTTPResponses.BAD_REQUEST });
      }

      return await processReset(gridType, schema, plotID, censusID);
    }
    return validation.response!;
  }

  const { schema, plotID, censusID } = validation.values!;
  return await processReset(gridType, schema!, plotID!, censusID!);
}

async function processReset(gridType: string, schema: string, plotID: number, censusID: number): Promise<NextResponse> {
  const connectionManager = ConnectionManager.getInstance();
  let transactionID = '';
  try {
    transactionID = await connectionManager.beginTransaction();
    switch (gridType) {
      case 'alltaxonomiesview':
        await connectionManager.executeQuery(`update ${schema}.trees set SpeciesID = null;`);
        await connectionManager.executeQuery('set foreign_key_checks = 0;');
        await connectionManager.executeQuery(`truncate ${schema}.species`);
        await connectionManager.executeQuery(`truncate ${schema}.genus`);
        await connectionManager.executeQuery(`truncate ${schema}.family`);
        await connectionManager.executeQuery('set foreign_key_checks = 1;');
        break;
      case 'quadrats':
        await connectionManager.executeQuery(``);
        break;
      case 'attributes':
        break;
      case 'personnel':
        break;
    }
    await connectionManager.commitTransaction(transactionID);
    return NextResponse.json({ message: `${gridType} reset completed` }, { status: HTTPResponses.OK });
  } catch (e: any) {
    ailogger.error('Reset operation failed:', e);
    if (transactionID) {
      await connectionManager.rollbackTransaction(transactionID);
    }
    return NextResponse.json({ error: 'Reset operation failed', details: e.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
