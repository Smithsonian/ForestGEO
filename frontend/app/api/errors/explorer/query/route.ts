import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { DEFAULT_ERROR_EXPLORER_FILTERS, ErrorExplorerQueryRequest } from '@/config/errorsexplorer';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { queryErrorExplorer } from '../_shared';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

function parseRequest(body: Partial<ErrorExplorerQueryRequest>): ErrorExplorerQueryRequest {
  return {
    schema: body.schema ?? '',
    plotID: Number(body.plotID ?? 0),
    censusID: Number(body.censusID ?? 0),
    page: Math.max(0, Number(body.page ?? 0)),
    pageSize: Math.min(100, Math.max(10, Number(body.pageSize ?? 25))),
    filters: {
      ...DEFAULT_ERROR_EXPLORER_FILTERS,
      ...body.filters,
      exactMessages: body.filters?.exactMessages ?? [],
      affectedFields: body.filters?.affectedFields ?? [],
      contradictionTypes: body.filters?.contradictionTypes ?? []
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
    if (!body.plotID || !body.censusID) {
      return NextResponse.json({ error: 'plotID and censusID are required' }, { status: HTTPResponses.INVALID_REQUEST });
    }

    const response = await queryErrorExplorer(connectionManager, body);
    return NextResponse.json(response, { status: HTTPResponses.OK });
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    ailogger.error('Error querying errors explorer:', errorObj);
    return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
