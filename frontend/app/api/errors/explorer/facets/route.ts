import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { buildErrorExplorerFacets } from '../_shared';
import { fromBody, withRouteAuthz, type RouteContext } from '@/lib/route-authz';
import {
  ERRORS_EXPLORER_FAILURE_RESPONSES,
  errorExplorerFacetsRequestSchema,
  INVALID_ERRORS_EXPLORER_REQUEST_RESPONSE,
  parseExplorerRequest,
  readExplorerRequestJson,
  resolveRequestCensusIDs
} from '@/lib/errorsexplorer/explorerrequest';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

async function handler(request: NextRequest, _context: RouteContext) {
  const json = await readExplorerRequestJson(request);
  if (!json.ok) return NextResponse.json(INVALID_ERRORS_EXPLORER_REQUEST_RESPONSE, { status: HTTPResponses.INVALID_REQUEST });
  const parsed = parseExplorerRequest(errorExplorerFacetsRequestSchema, json.body);
  if (!parsed.ok) {
    ailogger.warn('Rejected invalid errors explorer facets request', { issues: parsed.issues });
    return NextResponse.json(INVALID_ERRORS_EXPLORER_REQUEST_RESPONSE, { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();
  try {
    const response = await buildErrorExplorerFacets(connectionManager, { ...parsed.data, censusIDs: resolveRequestCensusIDs(parsed.data) });
    return NextResponse.json(response, { status: HTTPResponses.OK });
  } catch (error: unknown) {
    ailogger.error('Error loading errors explorer facets:', error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json(ERRORS_EXPLORER_FAILURE_RESPONSES.facets, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}

export const POST = withRouteAuthz('errors/explorer/facets', handler, { schema: fromBody('schema') });
