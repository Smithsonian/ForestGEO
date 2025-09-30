import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

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
  const maxAttempts = 10;

  const connectionManager = ConnectionManager.getInstance();
  let attempt = 0;
  let delay = 100;

  while (attempt <= maxAttempts) {
    try {
      attempt++;
      const startTime = Date.now();
      ailogger.info(`Attempting bulk procedure for ${fileID}-${batchID} (attempt ${attempt}/${maxAttempts})`);

      const result = await connectionManager.withTransaction(
        async (transactionID: string) => {
          ailogger.info(`Transaction ${transactionID} started for ${fileID}-${batchID} (attempt ${attempt})`);

          // Acquire application-level lock for this file to prevent concurrent processing
          const lockAcquired = await connectionManager.acquireApplicationLock(`file:${fileID}`, transactionID, 60000);
          if (!lockAcquired) {
            throw new Error(`Failed to acquire application lock for file ${fileID}`);
          }

          const queryStart = Date.now();
          const procedureResult = await connectionManager.executeQuery(`CALL ${schema}.bulkingestionprocess(?, ?);`, [fileID, batchID], transactionID);
          const queryDuration = Date.now() - queryStart;

          // Check if the procedure handled a batch failure internally
          const batchHandledInternally =
            procedureResult &&
            procedureResult[0] &&
            (procedureResult[0].message?.includes('moved to failedmeasurements') || procedureResult[0].batch_failed === true);

          if (batchHandledInternally) {
            ailogger.info(`Batch ${fileID}-${batchID} was handled internally by procedure (moved to failedmeasurements) in ${queryDuration}ms`);
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
        { timeoutMs: 8 * 60 * 1000 } // Increased to 8 minutes for large datasets
      );

      const duration = Date.now() - startTime;
      ailogger.info(`Transaction completed for ${fileID}-${batchID} in ${duration}ms (attempt ${attempt})`);

      return new NextResponse(JSON.stringify(result), { status: HTTPResponses.OK });
    } catch (e: any) {
      const isTimeout = e.message?.includes('timed out');
      const isConnectionError = e.code === 'ECONNRESET' || e.code === 'PROTOCOL_CONNECTION_LOST' || e.errno === 1927 || e.errno === 2013;
      const isDeadlock = e.code === 'ER_LOCK_DEADLOCK' || e.errno === 1213;

      ailogger.error(`Attempt ${attempt}: Error encountered for ${fileID}-${batchID}`, e, {
        code: (e as any).code || (e as any).errno || 'UNKNOWN',
        isTimeout,
        isConnectionError,
        isDeadlock,
        attempt,
        maxAttempts
      });

      // Don't retry on persistent timeout errors after multiple attempts
      if (isTimeout && attempt >= 5) {
        ailogger.error(`Persistent timeout detected on attempt ${attempt}, aborting further retries for ${fileID}-${batchID}`);
        break;
      }

      // For connection errors, wait longer before retry
      if (isConnectionError) {
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
