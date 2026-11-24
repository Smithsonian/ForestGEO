import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { queryRecentChanges } from '../_shared';
import { fromBody, withRouteAuthz, type RouteContext } from '@/lib/route-authz';
import { parseExplorerRequest, readExplorerRequestJson } from '@/lib/errorsexplorer/explorerrequest';
import { INVALID_RECENT_CHANGES_REQUEST_RESPONSE, recentChangesQueryRequestSchema } from '@/lib/changes/explorerrequest';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

async function handler(request: NextRequest, _context: RouteContext) {
  const connectionManager = ConnectionManager.getInstance();

  try {
    const json = await readExplorerRequestJson(request);
    if (!json.ok) {
      return NextResponse.json(INVALID_RECENT_CHANGES_REQUEST_RESPONSE, { status: HTTPResponses.INVALID_REQUEST });
    }
    const parsed = parseExplorerRequest(recentChangesQueryRequestSchema, json.body);
    if (!parsed.ok) {
      ailogger.warn('Rejected invalid recent changes request', { issues: parsed.issues });
      return NextResponse.json(INVALID_RECENT_CHANGES_REQUEST_RESPONSE, { status: HTTPResponses.INVALID_REQUEST });
    }
    const { schema, plotID, page, pageSize, filters } = parsed.data;

    const response = await queryRecentChanges(connectionManager, schema, plotID, page, pageSize, filters);
    return NextResponse.json(response, { status: HTTPResponses.OK });
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    ailogger.error('Error querying recent changes explorer:', errorObj);
    return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}

export const POST = withRouteAuthz('changes/explorer/query', handler, { schema: fromBody('schema') });
