import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';
import { validateSchemaOrThrow } from '@/lib/db/sqlsecurity';
import { requireUploadSessionOwnership, UploadSessionOwnershipError, UploadSessionState } from '@/config/uploadsessiontracker';
import { collapseCensus } from '@/lib/uploads/collapse-census';
import { fromQuery, withRouteAuthz, type RouteContext } from '@/lib/route-authz';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Advisory only — see setupbulkprocedure. Next.js records maxDuration in the
// build manifest but only Vercel enforces it; on Azure App Service the real
// ceiling is the load balancer's fixed ~240s idle timeout. Note that
// COLLAPSER_TIMEOUT_MS (5 min) therefore outlives what this non-streaming
// request can survive on the deployed site: the collapse keeps running
// server-side after the client has already been handed a 504.
export const maxDuration = 300;

// Phase-3: user→schema membership via guard; requireUploadSessionOwnership retains plot/census token ownership.
async function handler(request: NextRequest, context: RouteContext) {
  const schema = request.nextUrl.searchParams.get('schema');
  const { censusID } = (await context.params) as { censusID: string };
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
    validateSchemaOrThrow(schema);
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

export const GET = withRouteAuthz('setupbulkcollapser/[censusID]', handler, { schema: fromQuery('schema') });
