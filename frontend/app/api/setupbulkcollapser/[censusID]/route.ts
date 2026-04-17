import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { requireUploadSessionOwnership, UploadSessionOwnershipError, UploadSessionState } from '@/config/uploadsessiontracker';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Next.js route segment config: allow up to 5 minutes for large censuses
export const maxDuration = 300;

// The collapser can be slow on large censuses (dedup queries with ROW_NUMBER + JOINs).
// 5 minutes gives plenty of headroom while still catching genuine hangs.
const COLLAPSER_TIMEOUT_MS = 5 * 60 * 1000;

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

  // Validate schema to prevent SQL injection
  let collapserSQL: string;
  try {
    collapserSQL = safeFormatQuery(schema, 'CALL ??.bulkingestioncollapser(?)');
  } catch (error: any) {
    ailogger.error(`Invalid schema in setupbulkcollapser: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    // The stored procedure manages its own START TRANSACTION / COMMIT internally,
    // so we use withTransaction only for connection lifecycle (keep-alive pings,
    // extended session timeouts) — the outer BEGIN/COMMIT is effectively a no-op
    // since the procedure's START TRANSACTION implicitly commits it.
    const result = await connectionManager.withTransaction(
      async transactionID => {
        ailogger.info(`Triggering collapser for census ${censusID} in schema ${schema}`);
        await connectionManager.executeQuery(collapserSQL, [censusID], transactionID);
        ailogger.info('Successfully collapsed & de-duped data!');
        return { responseMessage: 'Processing procedure executed' };
      },
      { timeoutMs: COLLAPSER_TIMEOUT_MS }
    );

    return new NextResponse(JSON.stringify(result), { status: HTTPResponses.OK });
  } catch (e: any) {
    ailogger.error(`Collapser failed for census ${censusID}:`, e.message);
    return new NextResponse(JSON.stringify({ error: e.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
