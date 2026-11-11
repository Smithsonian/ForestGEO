import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { ContradictionType } from '@/config/errorsexplorer';
import { isValidSchema } from '@/lib/db/sqlsecurity';
import { buildErrorExplorerDetails } from '../../_shared';
import { fromQuery, withRouteAuthz, type RouteContext } from '@/lib/route-authz';
import {
  ERRORS_EXPLORER_FAILURE_RESPONSES,
  INVALID_ERRORS_EXPLORER_REQUEST_RESPONSE,
  parseErrorExplorerDetailsParams
} from '@/lib/errorsexplorer/explorerrequest';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

const CONTRADICTION_TYPES: readonly ContradictionType[] = ['duplicate_tag_stem', 'same_batch_conflict'];

async function handler(request: NextRequest, context: RouteContext) {
  const routeParams = await context.params;
  const params = parseErrorExplorerDetailsParams({
    measurementID: typeof routeParams.measurementID === 'string' ? routeParams.measurementID : undefined,
    plotID: request.nextUrl.searchParams.get('plotID'),
    censusID: request.nextUrl.searchParams.get('censusID')
  });
  const schema = request.nextUrl.searchParams.get('schema');
  const activeContradictionType = request.nextUrl.searchParams.get('activeContradictionType') as ContradictionType | null;
  // defense-in-depth: guard validates schema first; retained to narrow the type for safeFormatQuery.
  if (!isValidSchema(schema) || !params.ok) {
    return NextResponse.json(INVALID_ERRORS_EXPLORER_REQUEST_RESPONSE, { status: HTTPResponses.INVALID_REQUEST });
  }
  if (activeContradictionType && !CONTRADICTION_TYPES.includes(activeContradictionType)) {
    return NextResponse.json(INVALID_ERRORS_EXPLORER_REQUEST_RESPONSE, { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();
  try {
    const response = await buildErrorExplorerDetails(
      connectionManager,
      { schema, plotID: params.plotID, censusID: params.censusID },
      params.measurementID,
      activeContradictionType ?? undefined
    );
    return NextResponse.json(response, { status: HTTPResponses.OK });
  } catch (error: unknown) {
    ailogger.error('Error loading errors explorer details:', error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json(ERRORS_EXPLORER_FAILURE_RESPONSES.details, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}

export const GET = withRouteAuthz('errors/explorer/details/[measurementID]', handler, { schema: fromQuery('schema') });
