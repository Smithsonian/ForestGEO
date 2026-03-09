import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { shouldRecoverFailedInitialCensus } from '@/lib/failedinitialcensusrecovery';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

/**
 * Helper to check if request was aborted (client disconnected)
 */
function isRequestAborted(request: NextRequest): boolean {
  // Note: Next.js doesn't directly expose AbortSignal, but we can check request state
  // The request object becomes unusable when client disconnects
  try {
    // Accessing headers after abort will throw
    request.headers.get('x-check');
    return false;
  } catch {
    return true;
  }
}

function toCount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value) || 0;
  return 0;
}

async function recoverFailedInitialCensusIfNeeded(
  connectionManager: ConnectionManager,
  schema: string,
  fileID: string,
  batchID: string,
  plotID: number,
  censusID: number,
  transactionID: string
): Promise<boolean> {
  const recoveryStateSQL = safeFormatQuery(
    schema,
    `SELECT
       (SELECT COUNT(*) FROM ??.uploadmetrics WHERE PlotID = ? AND CensusID = ? AND status = 'completed') AS completedUploads,
       (SELECT COUNT(*) FROM ??.uploadmetrics WHERE PlotID = ? AND CensusID = ? AND status IN ('failed', 'processing')) AS incompleteUploads,
       (SELECT COUNT(*) FROM ??.trees WHERE CensusID = ?) AS treeCount,
       (SELECT COUNT(*) FROM ??.stems WHERE CensusID = ?) AS stemCount,
       (SELECT COUNT(*) FROM ??.coremeasurements WHERE CensusID = ?) AS coreMeasurementCount`
  );

  const recoveryStateRows = await connectionManager.executeQuery(
    recoveryStateSQL,
    [plotID, censusID, plotID, censusID, censusID, censusID, censusID],
    transactionID
  );
  const recoveryStateRow = recoveryStateRows[0] ?? {};
  const recoveryState = {
    completedUploads: toCount(recoveryStateRow.completedUploads),
    incompleteUploads: toCount(recoveryStateRow.incompleteUploads),
    treeCount: toCount(recoveryStateRow.treeCount),
    stemCount: toCount(recoveryStateRow.stemCount),
    coreMeasurementCount: toCount(recoveryStateRow.coreMeasurementCount)
  };

  if (!shouldRecoverFailedInitialCensus(recoveryState)) {
    return false;
  }

  ailogger.warn(`Recovering dirty failed first-load census state for plot ${plotID}, census ${censusID} before processing ${fileID}-${batchID}`, {
    plotID,
    censusID,
    fileID,
    batchID,
    recoveryState
  });

  const cleanupSteps = [
    {
      sql: safeFormatQuery(
        schema,
        'DELETE cma FROM ??.cmattributes cma INNER JOIN ??.coremeasurements cm ON cm.CoreMeasurementID = cma.CoreMeasurementID WHERE cm.CensusID = ?'
      ),
      params: [censusID]
    },
    {
      sql: safeFormatQuery(
        schema,
        'DELETE mel FROM ??.measurement_error_log mel INNER JOIN ??.coremeasurements cm ON mel.MeasurementID = cm.CoreMeasurementID WHERE cm.CensusID = ?'
      ),
      params: [censusID]
    },
    {
      sql: safeFormatQuery(schema, 'DELETE FROM ??.measurementssummary WHERE CensusID = ?'),
      params: [censusID]
    },
    {
      sql: safeFormatQuery(schema, 'DELETE FROM ??.coremeasurements WHERE CensusID = ?'),
      params: [censusID]
    },
    {
      sql: safeFormatQuery(schema, 'DELETE FROM ??.stems WHERE CensusID = ?'),
      params: [censusID]
    },
    {
      sql: safeFormatQuery(schema, 'DELETE FROM ??.trees WHERE CensusID = ?'),
      params: [censusID]
    },
    {
      sql: safeFormatQuery(schema, 'DELETE FROM ??.temporarymeasurements WHERE PlotID = ? AND CensusID = ? AND NOT (FileID = ? AND BatchID = ?)'),
      params: [plotID, censusID, fileID, batchID]
    },
    {
      sql: safeFormatQuery(schema, 'DELETE FROM ??.uploadintegrityalerts WHERE PlotID = ? AND CensusID = ?'),
      params: [plotID, censusID]
    },
    {
      sql: safeFormatQuery(schema, "DELETE FROM ??.uploadmetrics WHERE PlotID = ? AND CensusID = ? AND status IN ('failed', 'processing')"),
      params: [plotID, censusID]
    }
  ];

  for (const step of cleanupSteps) {
    await connectionManager.executeQuery(step.sql, step.params, transactionID);
  }

  return true;
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

  // Get session ID from headers if provided (for tracking)
  const sessionId = request.headers.get('x-upload-session-id');
  if (sessionId) {
    ailogger.info(`Processing batch ${fileID}-${batchID} for session ${sessionId}`);
  }

  // Validate schema to prevent SQL injection
  let procedureSQL: string;
  try {
    procedureSQL = safeFormatQuery(schema, 'CALL ??.bulkingestionprocess(?, ?)');
  } catch (error: any) {
    ailogger.error(`Invalid schema in setupbulkprocedure: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const maxAttempts = 10;

  const connectionManager = ConnectionManager.getInstance();
  let attempt = 0;
  let delay = 100;

  while (attempt <= maxAttempts) {
    // Check if client disconnected before starting attempt
    if (isRequestAborted(request)) {
      ailogger.warn(`Client disconnected before attempt ${attempt} for ${fileID}-${batchID}`);
      // Don't return error - just log and exit gracefully
      // The batch will be handled by cleanup if needed
      return new NextResponse(JSON.stringify({ error: 'Client disconnected', aborted: true }), {
        status: 499 // Client Closed Request
      });
    }

    try {
      attempt++;
      const startTime = Date.now();
      ailogger.info(`Attempting bulk procedure for ${fileID}-${batchID} (attempt ${attempt}/${maxAttempts})`);

      const result = await connectionManager.withTransaction(
        async (transactionID: string) => {
          ailogger.info(`Transaction ${transactionID} started for ${fileID}-${batchID} (attempt ${attempt})`);

          // Lock timeout - reduced for faster retry on contention
          const lockTimeoutMs = 2 * 60 * 1000; // 2 minutes (reduced from 5 to improve retry behavior)

          // Get plotID and censusID first for compound lock
          const plotCensusQuery = safeFormatQuery(
            schema,
            'SELECT DISTINCT PlotID, CensusID FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ? LIMIT 1'
          );
          const plotCensusResult = await connectionManager.executeQuery(plotCensusQuery, [fileID, batchID], transactionID);

          let lockKey: string;
          let currentPlotID: number | null = null;
          let currentCensusID: number | null = null;
          if (plotCensusResult && plotCensusResult.length > 0) {
            const { PlotID, CensusID } = plotCensusResult[0];
            currentPlotID = Number(PlotID);
            currentCensusID = Number(CensusID);
            // Use single compound lock that includes file, plot, and census
            // This prevents concurrent processing of the same data while avoiding lock ordering issues
            lockKey = `upload:file:${fileID}:plot:${PlotID}:census:${CensusID}`;
            ailogger.info(`Using compound lock: ${lockKey}`);
          } else {
            // Fallback to file-only lock if plot/census not found
            lockKey = `upload:file:${fileID}`;
            ailogger.warn(`No plot/census found for ${fileID}-${batchID}, using file-only lock`);
          }

          // Acquire single compound lock
          const lockAcquired = await connectionManager.acquireApplicationLock(lockKey, transactionID, lockTimeoutMs);
          if (!lockAcquired) {
            throw new Error(`Failed to acquire application lock for file ${fileID}. Another upload may be in progress.`);
          }
          ailogger.info(`Acquired application lock: ${lockKey}`);

          if (currentPlotID !== null && currentCensusID !== null) {
            await recoverFailedInitialCensusIfNeeded(connectionManager, schema, fileID, batchID, currentPlotID, currentCensusID, transactionID);
          }

          const queryStart = Date.now();
          // Use pre-validated and formatted SQL to prevent injection
          const procedureResult = await connectionManager.executeQuery(procedureSQL, [fileID, batchID], transactionID);
          const queryDuration = Date.now() - queryStart;

          // Check if the procedure handled a batch failure internally.
          const batchHandledInternally =
            procedureResult && procedureResult[0] && (procedureResult[0].records_failed > 0 || procedureResult[0].batch_failed === true);

          if (batchHandledInternally) {
            ailogger.info(`Batch ${fileID}-${batchID} was handled internally by procedure in ${queryDuration}ms`);
            return {
              attemptsNeeded: attempt,
              batchFailedButHandled: true,
              message: procedureResult[0].message
            };
          } else {
            ailogger.info(`Stored procedure completed successfully for ${fileID}-${batchID} in ${queryDuration}ms (transaction ${transactionID})`);
            return {
              attemptsNeeded: attempt,
              batchFailedButHandled: false
            };
          }
        },
        { timeoutMs: 15 * 60 * 1000 } // 15 minutes for consolidated single-batch-per-file processing
      );

      const duration = Date.now() - startTime;
      ailogger.info(`Transaction completed for ${fileID}-${batchID} in ${duration}ms (attempt ${attempt})`);

      return new NextResponse(JSON.stringify(result), { status: HTTPResponses.OK });
    } catch (e: any) {
      const isTimeout = e.message?.includes('timed out');
      const isConnectionError = e.code === 'ECONNRESET' || e.code === 'PROTOCOL_CONNECTION_LOST' || e.errno === 1927 || e.errno === 2013;
      const isDeadlock = e.code === 'ER_LOCK_DEADLOCK' || e.errno === 1213;
      const isLockContention = e.message?.includes('Failed to acquire application lock') || e.message?.includes('Another upload is in progress');

      ailogger.error(`Attempt ${attempt}: Error encountered for ${fileID}-${batchID}`, e, {
        code: (e as any).code || (e as any).errno || 'UNKNOWN',
        isTimeout,
        isConnectionError,
        isDeadlock,
        isLockContention,
        attempt,
        maxAttempts
      });

      // Don't retry on persistent timeout errors after multiple attempts
      if (isTimeout && attempt >= 5) {
        ailogger.error(`Persistent timeout detected on attempt ${attempt}, aborting further retries for ${fileID}-${batchID}`);
        break;
      }

      // Lock contention means another batch is actively processing
      // Since we already waited up to 2 minutes for the lock, don't retry many times
      if (isLockContention) {
        if (attempt >= 2) {
          ailogger.error(`Lock contention persists after ${attempt} attempts, aborting for ${fileID}-${batchID}`);
          break;
        }
        delay = 15000; // Wait 15 seconds before retry - the other batch should finish soon
      } else if (isConnectionError) {
        delay = Math.min(delay * 3, 15000); // Longer delay for connection issues
      } else if (isDeadlock) {
        delay = Math.min(delay * 1.5, 3000); // Shorter delay for deadlocks
      } else {
        delay = Math.min(delay * 2, 5000); // Standard exponential backoff
      }

      // Wait for an exponentially increasing delay before retrying
      await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 1000)); // Add jitter
    }
  }

  ailogger.error(`All ${maxAttempts} attempts exhausted for ${fileID}-${batchID}`);
  return new NextResponse(
    JSON.stringify({
      error: `Failed after ${maxAttempts} attempts`,
      fileID,
      batchID
    }),
    { status: HTTPResponses.SERVICE_UNAVAILABLE }
  );
}
