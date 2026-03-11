import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { shouldRecoverFailedInitialCensus } from '@/lib/failedinitialcensusrecovery';
import { moveTemporaryBatchToFailedMeasurements } from '@/lib/batchfailuretransfer';
import { requireUploadSessionOwnership, UploadSessionOwnershipError, UploadSessionState } from '@/config/uploadsessiontracker';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';
export const maxDuration = 900;

// Sub-batches of 10K rows keep transaction duration ~6.5s (benchmarked),
// well under the 50s innodb_lock_wait_timeout on Azure MySQL.
const INGESTION_BATCH_SIZE = 10_000;

const MAX_ATTEMPTS_PER_SUBBATCH = 5;
const SUB_BATCH_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes per sub-batch (10K rows take ~6.5s, leaves headroom for retries)

interface SubBatchResult {
  subBatchID: string;
  rowCount: number;
  durationMs: number;
  attemptsNeeded: number;
  batchFailedButHandled: boolean;
  message?: string;
}

function isRequestAborted(request: NextRequest): boolean {
  try {
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

/**
 * Extracts the first data row from a mysql2 stored procedure result.
 * mysql2 returns CALL results as [[row1, row2, ...], OkPacket] — the first
 * element is the result set array.  We need the first row object.
 */
function extractProcedureRow(procedureResult: any): Record<string, any> | null {
  if (!procedureResult) return null;
  const firstResultSet = procedureResult[0];
  if (Array.isArray(firstResultSet) && firstResultSet.length > 0) {
    return firstResultSet[0];
  }
  // Fallback: some code paths may already return the row directly
  if (firstResultSet && typeof firstResultSet === 'object' && !Array.isArray(firstResultSet)) {
    return firstResultSet;
  }
  return null;
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
      sql: safeFormatQuery(
        schema,
        `DELETE tm
         FROM ??.temporarymeasurements tm
         INNER JOIN ??.uploadmetrics um
           ON um.fileID = tm.FileID
          AND um.batchID = tm.BatchID
          AND um.plotID = tm.PlotID
          AND um.censusID = tm.CensusID
         WHERE tm.PlotID = ?
           AND tm.CensusID = ?
           AND um.status IN ('failed', 'processing')
           AND NOT (tm.FileID = ? AND tm.BatchID = ?)`
      ),
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

/**
 * Splits a large batch into sub-batches of INGESTION_BATCH_SIZE by updating
 * the BatchID column on subsets of rows. Returns the list of sub-batch IDs
 * (or the original batchID if no split was needed).
 */
async function splitIntoSubBatches(
  connectionManager: ConnectionManager,
  schema: string,
  fileID: string,
  originalBatchID: string,
  totalRows: number,
  transactionID: string
): Promise<string[]> {
  if (totalRows <= INGESTION_BATCH_SIZE) {
    return [originalBatchID];
  }

  const subBatchCount = Math.ceil(totalRows / INGESTION_BATCH_SIZE);
  const subBatchIDs: string[] = [];

  ailogger.info(`Splitting ${totalRows} rows into ${subBatchCount} sub-batches of ~${INGESTION_BATCH_SIZE} rows each for ${fileID}`);

  for (let i = 0; i < subBatchCount; i++) {
    const subBatchID = `${originalBatchID}__sub${String(i + 1).padStart(3, '0')}`;
    // LIMIT cannot be parameterized in mysql2 prepared statements, so inline the constant
    const updateSQL = safeFormatQuery(
      schema,
      `UPDATE ??.temporarymeasurements SET BatchID = ? WHERE FileID = ? AND BatchID = ? LIMIT ${INGESTION_BATCH_SIZE}`
    );
    const updateResult = await connectionManager.executeQuery(updateSQL, [subBatchID, fileID, originalBatchID], transactionID);
    const affectedRows = toCount(updateResult?.affectedRows);

    if (affectedRows === 0) break;

    subBatchIDs.push(subBatchID);
    ailogger.info(`Created sub-batch ${subBatchID} with ${affectedRows} rows (${i + 1}/${subBatchCount})`);
  }

  return subBatchIDs;
}

/**
 * Process a single sub-batch through bulkingestionprocess with retry logic.
 *
 * The procedure manages its own transaction (START TRANSACTION / COMMIT),
 * so we must NOT wrap it in withTransaction — that would create a nested
 * transaction which MySQL handles by implicitly committing the outer one,
 * corrupting the wrapper's state. Instead we call executeQuery directly
 * (no transactionID) and rely on the procedure's internal transaction.
 */
async function processSubBatch(
  connectionManager: ConnectionManager,
  schema: string,
  procedureSQL: string,
  fileID: string,
  subBatchID: string,
  _plotID: number,
  _censusID: number,
  request: NextRequest
): Promise<SubBatchResult> {
  let attempt = 0;
  let delay = 100;

  while (attempt < MAX_ATTEMPTS_PER_SUBBATCH) {
    if (isRequestAborted(request)) {
      throw new Error('Client disconnected');
    }

    try {
      attempt++;
      const startTime = Date.now();

      ailogger.info(`Sub-batch ${subBatchID} attempt ${attempt}: calling bulkingestionprocess...`);

      // Call procedure directly — it manages its own transaction internally.
      // No outer transaction or application lock needed per sub-batch since
      // sub-batches are processed sequentially and the procedure is self-contained.
      const procedureResult = await connectionManager.executeQuery(procedureSQL, [fileID, subBatchID]);

      ailogger.info(`Sub-batch ${subBatchID} attempt ${attempt}: procedure returned, parsing result...`, {
        resultType: typeof procedureResult,
        isArray: Array.isArray(procedureResult),
        firstElementType: procedureResult?.[0] ? typeof procedureResult[0] : 'undefined',
        firstElementIsArray: Array.isArray(procedureResult?.[0])
      });

      const row = extractProcedureRow(procedureResult);

      const batchFailedButHandled = row !== null && (toCount(row.records_failed) > 0 || toCount(row.batch_failed) === 1);

      const result: SubBatchResult = {
        subBatchID,
        rowCount: 0,
        durationMs: Date.now() - startTime,
        attemptsNeeded: attempt,
        batchFailedButHandled,
        message: row?.message
      };

      ailogger.info(`Sub-batch ${subBatchID} completed in ${result.durationMs}ms (attempt ${attempt})`, {
        batchFailedButHandled,
        message: row?.message,
        recordsFailed: row?.records_failed,
        batchFailed: row?.batch_failed
      });
      return result;
    } catch (e: any) {
      const isTimeout = e.message?.includes('timed out');
      const isConnectionError = e.code === 'ECONNRESET' || e.code === 'PROTOCOL_CONNECTION_LOST' || e.errno === 1927 || e.errno === 2013;
      const isDeadlock = e.code === 'ER_LOCK_DEADLOCK' || e.errno === 1213;
      const isLockContention = e.message?.includes('Failed to acquire application lock') || e.message?.includes('Another upload is in progress');

      ailogger.error(`Sub-batch ${subBatchID} attempt ${attempt} failed — MySQL error details:`, e, {
        message: e.message,
        code: e.code,
        errno: e.errno,
        sqlState: e.sqlState,
        sqlMessage: e.sqlMessage,
        sql: e.sql?.substring(0, 200),
        isTimeout,
        isConnectionError,
        isDeadlock,
        isLockContention,
        attempt,
        maxAttempts: MAX_ATTEMPTS_PER_SUBBATCH,
        fileID,
        subBatchID
      });

      if (isTimeout && attempt >= 3) break;
      if (isLockContention && attempt >= 2) break;

      if (isLockContention) {
        delay = 15000;
      } else if (isConnectionError) {
        delay = Math.min(delay * 3, 15000);
      } else if (isDeadlock) {
        delay = Math.min(delay * 1.5, 3000);
      } else {
        delay = Math.min(delay * 2, 5000);
      }

      await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 1000));
    }
  }

  // All retries exhausted for this sub-batch — move remaining rows to failed
  ailogger.error(`All ${MAX_ATTEMPTS_PER_SUBBATCH} attempts exhausted for sub-batch ${subBatchID}`);
  const movedRows = await moveTemporaryBatchToFailedMeasurements(
    connectionManager,
    schema,
    fileID,
    subBatchID,
    `Sub-batch moved after ${MAX_ATTEMPTS_PER_SUBBATCH} failed attempts`
  );
  ailogger.warn(`Moved ${movedRows} rows from sub-batch ${subBatchID} to unresolved coremeasurements`);

  return {
    subBatchID,
    rowCount: movedRows,
    durationMs: 0,
    attemptsNeeded: attempt,
    batchFailedButHandled: true,
    message: `Sub-batch exhausted retries, ${movedRows} rows moved to unresolved coremeasurements`
  };
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

  let procedureSQL: string;
  try {
    procedureSQL = safeFormatQuery(schema, 'CALL ??.bulkingestionprocess(?, ?)');
  } catch (error: any) {
    ailogger.error(`Invalid schema in setupbulkprocedure: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();

  // --- Phase 1: Setup (count rows, get plot/census, recovery, split) ---
  let subBatchIDs: string[];
  let plotID: number;
  let censusID: number;

  try {
    const setupResult = await connectionManager.withTransaction(
      async (transactionID: string) => {
        const lockTimeoutMs = 2 * 60 * 1000;

        // Get plot/census and row count
        const infoSQL = safeFormatQuery(
          schema,
          'SELECT PlotID, CensusID, COUNT(*) AS rowCount FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ? GROUP BY PlotID, CensusID LIMIT 1'
        );
        const infoRows = await connectionManager.executeQuery(infoSQL, [fileID, batchID], transactionID);

        if (!infoRows || infoRows.length === 0) {
          return { plotID: null, censusID: null, totalRows: 0, subBatchIDs: [] as string[] };
        }

        const currentPlotID = Number(infoRows[0].PlotID);
        const currentCensusID = Number(infoRows[0].CensusID);
        const totalRows = toCount(infoRows[0].rowCount);

        await requireUploadSessionOwnership({
          schema,
          sessionId,
          plotId: currentPlotID,
          censusId: currentCensusID,
          allowedStates: [UploadSessionState.UPLOADED, UploadSessionState.PROCESSING],
          contextLabel: `batch processing for ${fileID}-${batchID}`
        });

        // Acquire lock for setup phase
        const lockKey = `upload:file:${fileID}:plot:${currentPlotID}:census:${currentCensusID}`;
        const lockAcquired = await connectionManager.acquireApplicationLock(lockKey, transactionID, lockTimeoutMs);
        if (!lockAcquired) {
          throw new Error(`Failed to acquire application lock for file ${fileID}. Another upload may be in progress.`);
        }

        // Recovery check (uses original batchID before any splitting)
        await recoverFailedInitialCensusIfNeeded(connectionManager, schema, fileID, batchID, currentPlotID, currentCensusID, transactionID);

        // Split into sub-batches if needed (UPDATE within same transaction)
        const ids = await splitIntoSubBatches(connectionManager, schema, fileID, batchID, totalRows, transactionID);

        ailogger.info(`Setup complete for ${fileID}: ${totalRows} rows → ${ids.length} batch(es), plot=${currentPlotID}, census=${currentCensusID}`);

        return { plotID: currentPlotID, censusID: currentCensusID, totalRows, subBatchIDs: ids };
      },
      { timeoutMs: 2 * 60 * 1000 }
    );

    if (setupResult.plotID === null || setupResult.subBatchIDs.length === 0) {
      ailogger.warn(`No temporary rows found for ${fileID}-${batchID}`);
      return new NextResponse(
        JSON.stringify({ attemptsNeeded: 0, batchFailedButHandled: false, message: 'No data found' }),
        { status: HTTPResponses.OK }
      );
    }

    plotID = setupResult.plotID;
    censusID = setupResult.censusID!;
    subBatchIDs = setupResult.subBatchIDs;
  } catch (setupError: any) {
    if (setupError instanceof UploadSessionOwnershipError) {
      return new NextResponse(JSON.stringify({ error: setupError.message, fileID, batchID }), { status: setupError.status });
    }
    ailogger.error(`Setup phase failed for ${fileID}-${batchID}: ${setupError.message}`, setupError);
    return new NextResponse(
      JSON.stringify({ error: `Setup failed: ${setupError.message}`, fileID, batchID }),
      { status: HTTPResponses.SERVICE_UNAVAILABLE }
    );
  }

  // --- Phase 2: Process each sub-batch sequentially ---
  const results: SubBatchResult[] = [];
  const overallStartTime = Date.now();

  for (let i = 0; i < subBatchIDs.length; i++) {
    const subBatchID = subBatchIDs[i];

    if (isRequestAborted(request)) {
      ailogger.warn(`Client disconnected before sub-batch ${i + 1}/${subBatchIDs.length} for ${fileID}`);
      return new NextResponse(JSON.stringify({ error: 'Client disconnected', aborted: true }), { status: 499 });
    }

    ailogger.info(`Processing sub-batch ${i + 1}/${subBatchIDs.length}: ${subBatchID}`);

    try {
      const subResult = await processSubBatch(connectionManager, schema, procedureSQL, fileID, subBatchID, plotID, censusID, request);
      results.push(subResult);
    } catch (subError: any) {
      // Client disconnect or truly unrecoverable error — move remaining sub-batches to failed
      ailogger.error(`Unrecoverable error on sub-batch ${subBatchID}: ${subError.message}`, subError);

      for (let j = i; j < subBatchIDs.length; j++) {
        try {
          const movedRows = await moveTemporaryBatchToFailedMeasurements(
            connectionManager,
            schema,
            fileID,
            subBatchIDs[j],
            `Sub-batch abandoned after unrecoverable error: ${subError.message}`
          );
          results.push({
            subBatchID: subBatchIDs[j],
            rowCount: movedRows,
            durationMs: 0,
            attemptsNeeded: 0,
            batchFailedButHandled: true,
            message: `Moved ${movedRows} rows to unresolved coremeasurements`
          });
        } catch (moveError: any) {
          ailogger.error(`Failed to move remaining sub-batch ${subBatchIDs[j]} to failed: ${moveError.message}`);
        }
      }
      break;
    }
  }

  const overallDuration = Date.now() - overallStartTime;
  const totalAttempts = results.reduce((sum, r) => sum + r.attemptsNeeded, 0);
  const anyFailed = results.some(r => r.batchFailedButHandled);

  ailogger.info(
    `All ${results.length} sub-batch(es) for ${fileID} completed in ${overallDuration}ms` +
      ` (${totalAttempts} total attempts, ${anyFailed ? 'some failures handled' : 'all succeeded'})`
  );

  return new NextResponse(
    JSON.stringify({
      attemptsNeeded: totalAttempts,
      batchFailedButHandled: anyFailed,
      subBatchCount: results.length,
      totalDurationMs: overallDuration,
      message: anyFailed
        ? `${results.filter(r => r.batchFailedButHandled).length} of ${results.length} sub-batches had failures (handled)`
        : `All ${results.length} sub-batch(es) processed successfully`
    }),
    { status: HTTPResponses.OK }
  );
}
