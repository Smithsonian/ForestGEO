import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { DEFAULT_RECENT_CHANGES_FILTERS, RecentChangesQueryRequest } from '@/config/recentchangesexplorer';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { queryRecentChanges } from '../_shared';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

function parseRequest(body: Partial<RecentChangesQueryRequest>): RecentChangesQueryRequest {
  return {
    schema: body.schema ?? '',
    plotID: Number(body.plotID ?? 0),
    page: Math.max(0, Number(body.page ?? 0)),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Number(body.pageSize ?? DEFAULT_PAGE_SIZE))),
    filters: {
      ...DEFAULT_RECENT_CHANGES_FILTERS,
      ...body.filters
    }
  };
}

export async function POST(request: NextRequest) {
  const connectionManager = ConnectionManager.getInstance();

  try {
    const body = parseRequest(await request.json());
    if (!isValidSchema(body.schema)) {
      return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.INVALID_REQUEST });
    }
    if (!body.plotID) {
      return NextResponse.json({ error: 'plotID is required' }, { status: HTTPResponses.INVALID_REQUEST });
    }

    const response = await queryRecentChanges(
      connectionManager,
      body.schema,
      body.plotID,
      body.page,
      body.pageSize,
      body.filters
    );
    return NextResponse.json(response, { status: HTTPResponses.OK });
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    ailogger.error('Error querying recent changes explorer:', errorObj);
    return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
