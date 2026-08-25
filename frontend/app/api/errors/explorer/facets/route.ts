import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { DEFAULT_ERROR_EXPLORER_FILTERS, ErrorExplorerQueryRequest } from '@/config/errorsexplorer';
import { isValidSchema } from '@/lib/db/sqlsecurity';
import { buildErrorExplorerFacets } from '../_shared';
import { fromBody, withRouteAuthz, type RouteContext } from '@/lib/route-authz';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

function parseRequest(body: Partial<ErrorExplorerQueryRequest>) {
  return {
    schema: body.schema ?? '',
    plotID: Number(body.plotID ?? 0),
    censusID: Number(body.censusID ?? 0),
    censusIDs: Array.from(new Set((body.censusIDs ?? []).map(Number).filter(censusID => Number.isInteger(censusID) && censusID > 0))),
    filters: {
      ...DEFAULT_ERROR_EXPLORER_FILTERS,
      ...body.filters,
      exactMessages: body.filters?.exactMessages ?? [],
      affectedFields: body.filters?.affectedFields ?? [],
      contradictionTypes: body.filters?.contradictionTypes ?? []
    }
  };
}

async function handler(request: NextRequest, _context: RouteContext) {
  const connectionManager = ConnectionManager.getInstance();

  try {
    const body = parseRequest(await request.json());
    // defense-in-depth: withRouteAuthz already validated body.schema; retained to narrow the type.
    if (!isValidSchema(body.schema)) {
      return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.INVALID_REQUEST });
    }
    if (!body.plotID || !body.censusID) {
      return NextResponse.json({ error: 'plotID and censusID are required' }, { status: HTTPResponses.INVALID_REQUEST });
    }

    const response = await buildErrorExplorerFacets(connectionManager, body);
    return NextResponse.json(response, { status: HTTPResponses.OK });
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    ailogger.error('Error loading errors explorer facets:', errorObj);
    return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}

export const POST = withRouteAuthz('errors/explorer/facets', handler, { schema: fromBody('schema') });
