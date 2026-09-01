import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery, validateSchemaOrThrow } from '@/lib/db/sqlsecurity';
import ailogger from '@/ailogger';
import { moveTemporaryBatchToFailedMeasurements, moveTemporarySubBatchesToFailedMeasurements } from '@/lib/batchfailuretransfer';
import { requireUploadSessionOwnership, UploadSessionOwnershipError, UploadSessionState } from '@/config/uploadsessiontracker';
import { fromQuery, withRouteAuthz, type RouteContext } from '@/lib/route-authz';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Advisory only — see setupbulkprocedure for the full explanation. Next.js
// records maxDuration in the build manifest but only Vercel enforces it; on
// Azure App Service this non-streaming route is cut off with a 504 at the
// load balancer's fixed ~240s idle timeout regardless of the value here.
export const maxDuration = 900;

// FAILURE PROCESS -- IF A BATCH EXCEEDS ALLOWED ATTEMPTS, MOVE IT TO FAILED & MOVE ON
// Phase-3: user→schema membership via guard; requireUploadSessionOwnership retains plot/census token ownership.
async function handler(request: NextRequest, context: RouteContext) {
  const schema = request.nextUrl.searchParams.get('schema');
  const failureReason = (request.nextUrl.searchParams.get('reason') || 'Batch moved after max attempts').slice(0, 255);
  const { fileID, batchID } = (await context.params) as { fileID: string; batchID: string };
  if (!schema || !fileID || !batchID) {
    return new NextResponse(JSON.stringify({ error: 'Missing parameters' }), { status: HTTPResponses.INVALID_REQUEST });
  }
  const sessionId = request.headers.get('x-upload-session-id');
  if (!sessionId) {
    return new NextResponse(JSON.stringify({ error: 'Upload session is required for batch failure handling' }), { status: HTTPResponses.CONFLICT });
  }

  try {
    validateSchemaOrThrow(schema);
  } catch (error: any) {
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();
  try {
    const scopeSQL = safeFormatQuery(
      schema,
      `SELECT PlotID, CensusID
       FROM ??.temporarymeasurements
       WHERE FileID = ?
         AND (BatchID = ? OR BatchID LIKE ?)
       GROUP BY PlotID, CensusID
       LIMIT 1`
    );
    const scopeRows = await connectionManager.executeQuery(scopeSQL, [fileID, batchID, `${batchID}__sub%`]);
    if (Array.isArray(scopeRows) && scopeRows.length > 0) {
      await requireUploadSessionOwnership({
        schema,
        sessionId,
        plotId: Number(scopeRows[0].PlotID),
        censusId: Number(scopeRows[0].CensusID),
        allowedStates: [UploadSessionState.PROCESSING, UploadSessionState.COLLAPSING],
        contextLabel: `batch failure handling for ${fileID}-${batchID}`
      });
    }

    // After sub-batching, remaining rows may have sub-batch IDs (e.g. batchID__sub001).
    // Try exact match first, then fall back to moving all sub-batches for this file.
    let movedRows = await moveTemporaryBatchToFailedMeasurements(connectionManager, schema, fileID, batchID, failureReason, 'sql_exception');

    if (movedRows === 0) {
      const subBatchPrefix = `${batchID}__sub`;
      movedRows = await moveTemporarySubBatchesToFailedMeasurements(connectionManager, schema, fileID, subBatchPrefix, failureReason, 'sql_exception');
      if (movedRows > 0) {
        ailogger.warn(
          `Moved ${movedRows} sub-batched temporary rows to unresolved coremeasurements for ${fileID} (prefix: ${subBatchPrefix}). Reason: ${failureReason}`
        );
      }
    } else {
      ailogger.warn(`Moved ${movedRows} temporary rows to unresolved coremeasurements for ${fileID}-${batchID}. Reason: ${failureReason}`);
    }
  } catch (error: any) {
    if (error instanceof UploadSessionOwnershipError) {
      return new NextResponse(JSON.stringify({ error: error.message }), { status: error.status });
    }
    ailogger.error(`failure transfer for ${fileID}-${batchID}:`, error);
    return new NextResponse(
      JSON.stringify({
        error: 'Failure transfer to unresolved coremeasurements detected.',
        details: error.message
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  } finally {
    await connectionManager.closeConnection();
  }
  return new NextResponse(JSON.stringify({ temp: true }), { status: HTTPResponses.OK });
}

export const GET = withRouteAuthz('setupbulkfailure/[fileID]/[batchID]', handler, { schema: fromQuery('schema') });
