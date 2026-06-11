import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { requireUploadSessionOwnership, UploadSessionOwnershipError, UploadSessionState } from '@/config/uploadsessiontracker';
import { collapseCensus } from '@/lib/uploads/collapse-census';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Next.js route segment config: allow up to 5 minutes for large censuses
export const maxDuration = 300;

export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{ censusID: string }>;
  }
) {
  const schema = request.nextUrl.searchParams.get('schema');
  const { censusID } = await props.params;
  if (!schema || !censusID) {
    return new NextResponse(JSON.stringify({ error: 'Missing parameters' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  try {
    await requireUploadSessionOwnership({
      schema,
      sessionId: request.headers.get('x-upload-session-id'),
      censusId: Number(censusID),
      allowedStates: [UploadSessionState.PROCESSING, UploadSessionState.COLLAPSING],
      contextLabel: `collapser for census ${censusID}`
    });
  } catch (error: unknown) {
    if (error instanceof UploadSessionOwnershipError) {
      return new NextResponse(JSON.stringify({ error: error.message }), { status: error.status });
    }
    throw error;
  }

  // Validate schema before delegating — collapseCensus calls safeFormatQuery
  // internally, but we want to return a 400 rather than a 500 on a bad schema.
  try {
    safeFormatQuery(schema, 'SELECT 1');
  } catch (error: any) {
    ailogger.error(`Invalid schema in setupbulkcollapser: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    await collapseCensus(connectionManager, { schema, censusID: Number(censusID) });
    return new NextResponse(JSON.stringify({ responseMessage: 'Processing procedure executed' }), { status: HTTPResponses.OK });
  } catch (e: any) {
    ailogger.error(`Collapser failed for census ${censusID}:`, e.message);
    return new NextResponse(JSON.stringify({ error: e.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
