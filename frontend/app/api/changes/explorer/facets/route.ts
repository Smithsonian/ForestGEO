import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { queryRecentChangesFacets } from '../_shared';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

interface FacetsRequestBody {
  schema?: string;
  plotID?: number;
}

export async function POST(request: NextRequest) {
  const connectionManager = ConnectionManager.getInstance();

  try {
    const body: FacetsRequestBody = await request.json();
    const schema = body.schema ?? '';
    const plotID = Number(body.plotID ?? 0);

    if (!isValidSchema(schema)) {
      return NextResponse.json({ error: 'Invalid schema' }, { status: HTTPResponses.INVALID_REQUEST });
    }
    if (!plotID) {
      return NextResponse.json({ error: 'plotID is required' }, { status: HTTPResponses.INVALID_REQUEST });
    }

    const response = await queryRecentChangesFacets(connectionManager, schema, plotID);
    return NextResponse.json(response, { status: HTTPResponses.OK });
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    ailogger.error('Error loading recent changes facets:', errorObj);
    return NextResponse.json({ error: errorObj.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
