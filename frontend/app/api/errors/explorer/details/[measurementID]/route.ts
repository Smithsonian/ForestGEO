import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { ContradictionType } from '@/config/errorsexplorer';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { buildErrorExplorerDetails } from '../../_shared';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ measurementID: string }> }) {
  const connectionManager = ConnectionManager.getInstance();

  try {
    const { measurementID } = await params;
    const schema = request.nextUrl.searchParams.get('schema');
    const plotID = Number(request.nextUrl.searchParams.get('plotID') ?? 0);
    const censusID = Number(request.nextUrl.searchParams.get('censusID') ?? 0);
    const activeContradictionType = request.nextUrl.searchParams.get('activeContradictionType') as ContradictionType | null;

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
