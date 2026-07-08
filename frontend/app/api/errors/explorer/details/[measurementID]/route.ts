import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { ContradictionType } from '@/config/errorsexplorer';
import { isValidSchema } from '@/lib/db/sqlsecurity';
import { buildErrorExplorerDetails } from '../../_shared';
import { fromQuery, withRouteAuthz, type RouteContext } from '@/lib/route-authz';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

async function handler(request: NextRequest, context: RouteContext) {
  const connectionManager = ConnectionManager.getInstance();

  try {
    const measurementID = (await context.params).measurementID as string;
    const schema = request.nextUrl.searchParams.get('schema');
    const plotID = Number(request.nextUrl.searchParams.get('plotID') ?? 0);
    const censusID = Number(request.nextUrl.searchParams.get('censusID') ?? 0);
    const activeContradictionType = request.nextUrl.searchParams.get('activeContradictionType') as ContradictionType | null;

    // defense-in-depth: guard validates schema first; retained to narrow the type for safeFormatQuery.
    if (!isValidSchema(schema)) {
      return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.INVALID_REQUEST });
    }
    if (!plotID || !censusID || !measurementID) {
      return NextResponse.json({ error: 'schema, plotID, censusID, and measurementID are required' }, { status: HTTPResponses.INVALID_REQUEST });
    }
    if (activeContradictionType && !['duplicate_tag_stem', 'same_batch_conflict'].includes(activeContradictionType)) {
      return NextResponse.json({ error: 'Invalid contradiction type' }, { status: HTTPResponses.INVALID_REQUEST });
    }

    const response = await buildErrorExplorerDetails(
      connectionManager,
      { schema, plotID, censusID },
      Number(measurementID),
      activeContradictionType ?? undefined
    );
    return NextResponse.json(response, { status: HTTPResponses.OK });
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    ailogger.error('Error loading errors explorer details:', errorObj);
    return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}

export const GET = withRouteAuthz('errors/explorer/details/[measurementID]', handler, { schema: fromQuery('schema') });
