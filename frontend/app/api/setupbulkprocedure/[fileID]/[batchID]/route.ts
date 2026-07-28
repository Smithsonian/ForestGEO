import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';
import { validateSchemaOrThrow } from '@/lib/db/sqlsecurity';
import { requireUploadSessionOwnership, UploadSessionOwnershipError, UploadSessionState } from '@/config/uploadsessiontracker';
import { ingestBatch, IngestBatchAbortedError, type IngestBatchResult } from '@/lib/uploads/ingest-batch';
import { BatchFamilyScopeError, discoverBatchFamily } from '@/lib/uploads/batch-family';
import { fromQuery, withRouteAuthz, type RouteContext } from '@/lib/route-authz';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';
export const maxDuration = 900;

// Non-standard nginx status code for "client closed request"; preserved from
// the pre-extraction handler so callers see the same abort signal.
const HTTP_CLIENT_CLOSED_REQUEST = 499;

function isRequestAborted(request: NextRequest): boolean {
  try {
    request.headers.get('x-check');
    return false;
  } catch {
    return true;
  }
}

function noDataFoundResponse(): NextResponse {
  return new NextResponse(JSON.stringify({ attemptsNeeded: 0, batchFailedButHandled: false, message: 'No data found' }), { status: HTTPResponses.OK });
}

// Phase-3: user→schema membership via guard; requireUploadSessionOwnership retains plot/census token ownership.
async function handler(request: NextRequest, context: RouteContext) {
  const schema = request.nextUrl.searchParams.get('schema');
  const { fileID, batchID } = (await context.params) as { fileID: string; batchID: string };
  if (!schema || !fileID || !batchID) {
    return new NextResponse(JSON.stringify({ error: 'Missing parameters' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const sessionId = request.headers.get('x-upload-session-id');
  if (!sessionId) {
    return new NextResponse(JSON.stringify({ error: 'Upload session is required for batch processing' }), { status: HTTPResponses.CONFLICT });
  }
  ailogger.info(`Processing batch ${fileID}-${batchID} for session ${sessionId}`);

  // Validate the schema name up front so an invalid schema surfaces as
  // INVALID_REQUEST instead of a setup failure deeper in the pipeline.
  try {
    validateSchemaOrThrow(schema);
  } catch (error: any) {
    ailogger.error(`Invalid schema in setupbulkprocedure: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();

  // Upload-session ownership is a route-only concern: derive the plot/census
  // scope from the staged rows, then verify this session owns that scope.
  //
  // The scope must come from the whole batch FAMILY, not just the unsuffixed
  // BatchID. Once a prior attempt split this batch, every row lives under
  // `<batchID>__subNNN` and an exact-match lookup finds nothing — which is how
  // the 2026-07-27 Harvard retry returned 200 "No data found" in 31ms while
  // 106,227 rows were still staged. Only a genuinely empty family may return
  // early; otherwise authorize the discovered scope and let ingestBatch resume.
  try {
    const family = await discoverBatchFamily((sql, sqlParams) => connectionManager.executeQuery(sql, sqlParams), schema, fileID, batchID);

    if (!family) {
      ailogger.warn(`No temporary rows found for ${fileID}-${batchID} (original ID or sub-batch family)`);
      return noDataFoundResponse();
    }

    if (family.orphanedSubBatchIDs.length > 0) {
      ailogger.warn(
        `Found ${family.orphanedSubBatchIDs.length} orphaned sub-batch(es) for ${fileID}-${batchID} ` +
          `holding ${family.totalRows} row(s); authorizing their scope and resuming`
      );
    }

    await requireUploadSessionOwnership({
      schema,
      sessionId,
      plotId: family.plotID,
      censusId: family.censusID,
      allowedStates: [UploadSessionState.UPLOADED, UploadSessionState.PROCESSING],
      contextLabel: `batch processing for ${fileID}-${batchID}`
    });
  } catch (setupError: any) {
    if (setupError instanceof UploadSessionOwnershipError) {
      return new NextResponse(JSON.stringify({ error: setupError.message, fileID, batchID }), { status: setupError.status });
    }
    if (setupError instanceof BatchFamilyScopeError) {
      ailogger.error(`Ambiguous batch family for ${fileID}-${batchID}: ${setupError.message}`);
      return new NextResponse(JSON.stringify({ error: setupError.message, fileID, batchID }), { status: HTTPResponses.CONFLICT });
    }
    ailogger.error(`Setup phase failed for ${fileID}-${batchID}: ${setupError.message}`, setupError);
    return new NextResponse(JSON.stringify({ error: `Setup failed: ${setupError.message}`, fileID, batchID }), { status: HTTPResponses.SERVICE_UNAVAILABLE });
  }

  let result: IngestBatchResult;
  try {
    result = await ingestBatch(connectionManager, {
      schema,
      fileID,
      batchID,
      isAborted: () => isRequestAborted(request)
    });
  } catch (error: any) {
    if (error instanceof IngestBatchAbortedError) {
      return new NextResponse(JSON.stringify({ error: 'Client disconnected', aborted: true }), { status: HTTP_CLIENT_CLOSED_REQUEST });
    }
    // Only Phase-1 (setup) errors escape ingestBatch; sub-batch failures are
    // handled internally by moving rows to unresolved coremeasurements.
    ailogger.error(`Setup phase failed for ${fileID}-${batchID}: ${error.message}`, error);
    return new NextResponse(JSON.stringify({ error: `Setup failed: ${error.message}`, fileID, batchID }), { status: HTTPResponses.SERVICE_UNAVAILABLE });
  }

  if (result.noDataFound) {
    return noDataFoundResponse();
  }

  const totalAttempts = result.subBatchResults.reduce((sum, r) => sum + r.attemptsNeeded, 0);
  const anyFailed = result.subBatchResults.some(r => r.batchFailedButHandled);
  const failedSubBatchCount = result.subBatchResults.filter(r => r.batchFailedButHandled).length;

  return new NextResponse(
    JSON.stringify({
      attemptsNeeded: totalAttempts,
      batchFailedButHandled: anyFailed,
      subBatchCount: result.processedSubBatches,
      totalDurationMs: result.totalDurationMs,
      message: anyFailed
        ? `${failedSubBatchCount} of ${result.processedSubBatches} sub-batches had failures (handled)`
        : `All ${result.processedSubBatches} sub-batch(es) processed successfully`
    }),
    { status: HTTPResponses.OK }
  );
}

export const GET = withRouteAuthz('setupbulkprocedure/[fileID]/[batchID]', handler, { schema: fromQuery('schema') });
