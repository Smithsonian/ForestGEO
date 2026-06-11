import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { requireUploadSessionOwnership, UploadSessionOwnershipError, UploadSessionState } from '@/config/uploadsessiontracker';
import { ingestBatch, IngestBatchAbortedError, type IngestBatchResult } from '@/lib/uploads/ingest-batch';

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

export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{ fileID: string; batchID: string }>;
  }
) {
  const schema = request.nextUrl.searchParams.get('schema');
  const { fileID, batchID } = await props.params;
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
  let temporaryInfoSQL: string;
  try {
    temporaryInfoSQL = safeFormatQuery(schema, 'SELECT PlotID, CensusID FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ? LIMIT 1');
  } catch (error: any) {
    ailogger.error(`Invalid schema in setupbulkprocedure: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();

  // Upload-session ownership is a route-only concern: derive the plot/census
  // scope from the staged rows, then verify this session owns that scope.
  try {
    const infoRows = await connectionManager.executeQuery(temporaryInfoSQL, [fileID, batchID]);
    if (!infoRows || infoRows.length === 0) {
      ailogger.warn(`No temporary rows found for ${fileID}-${batchID}`);
      return noDataFoundResponse();
    }

    await requireUploadSessionOwnership({
      schema,
      sessionId,
      plotId: Number(infoRows[0].PlotID),
      censusId: Number(infoRows[0].CensusID),
      allowedStates: [UploadSessionState.UPLOADED, UploadSessionState.PROCESSING],
      contextLabel: `batch processing for ${fileID}-${batchID}`
    });
  } catch (setupError: any) {
    if (setupError instanceof UploadSessionOwnershipError) {
      return new NextResponse(JSON.stringify({ error: setupError.message, fileID, batchID }), { status: setupError.status });
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
