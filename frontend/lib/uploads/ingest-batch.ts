/**
 * Batch ingestion — the single mechanism for running one staged file/batch
 * through the `bulkingestionprocess` stored procedure.
 *
 * Both the synchronous HTTP route (app/api/setupbulkprocedure/[fileID]/[batchID])
 * and the background upload worker call ingestBatch; neither owns any ingestion
 * internals of its own. The sequence is:
 *
 *   Phase 1 (one transaction, application-locked):
 *     - derive plot/census + row count from temporarymeasurements
 *     - recover dirty failed first-load census state if detected
 *     - remove stale unresolved ingestion rows that match the staged rows
 *     - split oversized batches into sub-batches
 *   Phase 2 (no outer transaction — the procedure manages its own):
 *     - run each sub-batch through bulkingestionprocess with retry/backoff
 *     - on exhausted retries or unrecoverable errors, move remaining rows to
 *       unresolved coremeasurements via moveTemporaryBatchToFailedMeasurements
 *
 * Cancellation is caller-defined: the HTTP route passes a request-abort probe,
 * the worker passes its job-cancellation probe. An abort detected between
 * sub-batches throws IngestBatchAbortedError (rows for unprocessed sub-batches
 * stay in temporarymeasurements); an abort detected inside a sub-batch's retry
 * loop moves the remaining rows to unresolved coremeasurements.
 */

import ConnectionManager from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { shouldRecoverFailedInitialCensus } from '@/lib/failedinitialcensusrecovery';
import { moveTemporaryBatchToFailedMeasurements } from '@/lib/batchfailuretransfer';

// Sub-batches of 10K rows keep transaction duration ~6.5s (benchmarked),
// well under the 50s innodb_lock_wait_timeout on Azure MySQL.
const INGESTION_BATCH_SIZE = 10_000;

const MAX_ATTEMPTS_PER_SUBBATCH = 5;
const SETUP_PHASE_TIMEOUT_MS = 2 * 60 * 1000;

// Retry / backoff constants for processSubBatch
const INITIAL_RETRY_DELAY_MS = 100;

// Give-up thresholds: once attempt count reaches these, stop retrying that class of error.
const TIMEOUT_GIVE_UP_AFTER_ATTEMPTS = 3;
const LOCK_GIVE_UP_AFTER_ATTEMPTS = 2;

// Backoff delays and caps per error class
const LOCK_CONTENTION_BACKOFF_MS = 15_000; // flat delay — don't escalate; just back off and retry once
const CONNECTION_BACKOFF_MULTIPLIER = 3;
const CONNECTION_BACKOFF_CAP_MS = 15_000;
const DEADLOCK_BACKOFF_MULTIPLIER = 1.5;
const DEADLOCK_BACKOFF_CAP_MS = 3_000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_BACKOFF_CAP_MS = 5_000; // timeout errors also fall into this bucket
const RETRY_JITTER_MAX_MS = 1_000;

// MySQL error numbers for connection-loss and deadlock conditions
const MYSQL_ERRNO_SERVER_GONE = 1927; // ER_SERVER_LOST — server closed the connection
const MYSQL_ERRNO_TCP_LOST = 2013; // CR_SERVER_LOST — TCP connection lost during query
const MYSQL_ERRNO_DEADLOCK = 1213; // ER_LOCK_DEADLOCK

/**
 * Thrown when the caller's isAborted probe fires between sub-batches.
 * Rows belonging to not-yet-processed sub-batches remain in
 * temporarymeasurements so a retry can resume them.
 *
 * When midBatch is true the abort was detected inside a sub-batch's retry loop
 * (before the procedure call). Those rows are moved to unresolved
 * coremeasurements internally — the error does NOT propagate to the caller.
 * When midBatch is false the abort was detected between sub-batches and the
 * error propagates so the caller sees a 499 / cancellation response.
 */
export class IngestBatchAbortedError extends Error {
  readonly midBatch: boolean;

  constructor(fileID: string, batchID: string, midBatch: boolean = false) {
    super(`Ingestion aborted by caller for ${fileID}-${batchID}`);
    this.name = 'IngestBatchAbortedError';
    this.midBatch = midBatch;
  }
}

export interface SubBatchResult {
  subBatchID: string;
  /**
   * On failure paths (retries exhausted or mid-batch abort): the number of
   * rows moved from temporarymeasurements to unresolved coremeasurements.
   * Always 0 on success (the procedure drained the rows itself).
   */
  rowCount: number;
  durationMs: number;
  attemptsNeeded: number;
  batchFailedButHandled: boolean;
  message?: string;
}

export interface IngestBatchParams {
  schema: string;
  fileID: string;
  batchID: string;
  /**
   * Cancellation probe checked between sub-batches and between retry attempts.
   * The HTTP route passes a request-abort check; the worker passes its
   * job-cancellation probe. Defaults to "never aborted".
   */
  isAborted?: () => boolean;
}

export interface IngestBatchResult {
  processedSubBatches: number;
  totalRows: number;
  recovered: boolean;
  /** True when no staged temporarymeasurements rows exist for the file/batch. */
  noDataFound: boolean;
  /** Wall-clock duration of the sub-batch processing phase. */
  totalDurationMs: number;
  /** Per-sub-batch detail for callers that shape HTTP responses or job metrics. */
  subBatchResults: SubBatchResult[];
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

async function cleanupMatchedUnresolvedIngestionFailuresForBatch(
  connectionManager: ConnectionManager,
  schema: string,
  fileID: string,
  batchID: string,
  censusID: number,
  transactionID: string
): Promise<number> {
  const sameFileDeleteSQL = safeFormatQuery(
    schema,
    `DELETE FROM ??.coremeasurements
     WHERE CensusID = ?
       AND StemGUID IS NULL
       AND UploadFileID = ?
       AND NOT (UploadBatchID <=> ?)`
  );

  const sameFileDeleteResult = await connectionManager.executeQuery(sameFileDeleteSQL, [censusID, fileID, batchID], transactionID);
  const sameFileDeletedRows = toCount(sameFileDeleteResult?.affectedRows);

  if (sameFileDeletedRows > 0) {
    ailogger.warn(`Removed ${sameFileDeletedRows} stale unresolved row(s) from prior same-file upload batches for ${fileID}-${batchID}`);
  }

  const crossFileCandidatesSQL = safeFormatQuery(
    schema,
    `SELECT 1
     FROM ??.coremeasurements
     WHERE CensusID = ?
       AND StemGUID IS NULL
       AND UploadFileID IS NOT NULL
       AND NOT (UploadFileID <=> ?)
     LIMIT 1`
  );

  const crossFileCandidateRows = await connectionManager.executeQuery(crossFileCandidatesSQL, [censusID, fileID], transactionID);
  if (!Array.isArray(crossFileCandidateRows) || crossFileCandidateRows.length === 0) {
    return sameFileDeletedRows;
  }

  const deleteSQL = safeFormatQuery(
    schema,
    `DELETE cm
     FROM ??.coremeasurements cm
     INNER JOIN ??.measurement_error_log mel
       ON mel.MeasurementID = cm.CoreMeasurementID
      AND mel.IsResolved = FALSE
     INNER JOIN ??.measurement_errors me
       ON me.ErrorID = mel.ErrorID
      AND me.ErrorSource = 'ingestion'
     INNER JOIN ??.temporarymeasurements tm
       ON tm.CensusID = cm.CensusID
      AND tm.FileID = ?
      AND tm.BatchID = ?
      AND tm.TreeTag <=> cm.RawTreeTag
      AND tm.StemTag <=> cm.RawStemTag
      AND tm.SpeciesCode <=> cm.RawSpCode
      AND tm.QuadratName <=> cm.RawQuadrat
      AND tm.LocalX <=> cm.RawX
      AND tm.LocalY <=> cm.RawY
      AND tm.DBH <=> cm.MeasuredDBH
      AND tm.HOM <=> cm.MeasuredHOM
      AND tm.MeasurementDate <=> cm.MeasurementDate
      AND tm.Codes <=> cm.RawCodes
      AND tm.Comments <=> cm.RawComments
     WHERE cm.CensusID = ?
       AND cm.StemGUID IS NULL
       AND NOT (cm.UploadFileID <=> ? AND cm.UploadBatchID <=> ?)`
  );

  const deleteResult = await connectionManager.executeQuery(deleteSQL, [fileID, batchID, censusID, fileID, batchID], transactionID);
  const deletedRows = toCount(deleteResult?.affectedRows);

  if (deletedRows > 0) {
    ailogger.warn(`Removed ${deletedRows} stale unresolved row(s) from prior cross-file uploads that matched ${fileID}-${batchID}`);
  }

  return sameFileDeletedRows + deletedRows;
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
    const updateSQL = safeFormatQuery(schema, `UPDATE ??.temporarymeasurements SET BatchID = ? WHERE FileID = ? AND BatchID = ? LIMIT ${INGESTION_BATCH_SIZE}`);
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
  isAborted: () => boolean
): Promise<SubBatchResult> {
  let attempt = 0;
  let delay = INITIAL_RETRY_DELAY_MS;

  while (attempt < MAX_ATTEMPTS_PER_SUBBATCH) {
    if (isAborted()) {
      throw new IngestBatchAbortedError(fileID, subBatchID, true);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      const isTimeout = e.message?.includes('timed out');
      const isConnectionError =
        e.code === 'ECONNRESET' || e.code === 'PROTOCOL_CONNECTION_LOST' || e.errno === MYSQL_ERRNO_SERVER_GONE || e.errno === MYSQL_ERRNO_TCP_LOST;
      const isDeadlock = e.code === 'ER_LOCK_DEADLOCK' || e.errno === MYSQL_ERRNO_DEADLOCK;
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

      if (isTimeout && attempt >= TIMEOUT_GIVE_UP_AFTER_ATTEMPTS) break;
      if (isLockContention && attempt >= LOCK_GIVE_UP_AFTER_ATTEMPTS) break;

      if (isLockContention) {
        delay = LOCK_CONTENTION_BACKOFF_MS;
      } else if (isConnectionError) {
        delay = Math.min(delay * CONNECTION_BACKOFF_MULTIPLIER, CONNECTION_BACKOFF_CAP_MS);
      } else if (isDeadlock) {
        delay = Math.min(delay * DEADLOCK_BACKOFF_MULTIPLIER, DEADLOCK_BACKOFF_CAP_MS);
      } else {
        delay = Math.min(delay * DEFAULT_BACKOFF_MULTIPLIER, DEFAULT_BACKOFF_CAP_MS);
      }

      await new Promise(resolve => setTimeout(resolve, delay + Math.random() * RETRY_JITTER_MAX_MS));
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

export async function ingestBatch(connectionManager: ConnectionManager, params: IngestBatchParams): Promise<IngestBatchResult> {
  const { schema, fileID, batchID } = params;
  const isAborted = params.isAborted ?? (() => false);
  const procedureSQL = safeFormatQuery(schema, 'CALL ??.bulkingestionprocess(?, ?)');

  // --- Phase 1: Setup (count rows, get plot/census, recovery, split) ---
  const setupResult = await connectionManager.withTransaction(
    async tx => {
      const lockTimeoutMs = SETUP_PHASE_TIMEOUT_MS;

      // Get plot/census and row count
      const infoSQL = safeFormatQuery(
        schema,
        'SELECT PlotID, CensusID, COUNT(*) AS rowCount FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ? GROUP BY PlotID, CensusID LIMIT 1'
      );
      const infoRows = await tx.query(infoSQL, [fileID, batchID]);

      if (!infoRows || infoRows.length === 0) {
        return { plotID: null as number | null, censusID: null as number | null, totalRows: 0, subBatchIDs: [] as string[], recovered: false };
      }

      const currentPlotID = Number(infoRows[0].PlotID);
      const currentCensusID = Number(infoRows[0].CensusID);
      const totalRows = toCount(infoRows[0].rowCount);

      // Acquire lock for setup phase
      const lockKey = `upload:file:${fileID}:plot:${currentPlotID}:census:${currentCensusID}`;
      const lockAcquired = await connectionManager.acquireApplicationLock(lockKey, tx.id, lockTimeoutMs);
      if (!lockAcquired) {
        throw new Error(`Failed to acquire application lock for file ${fileID}. Another upload may be in progress.`);
      }

      // Recovery check (uses original batchID before any splitting)
      const recovered = await recoverFailedInitialCensusIfNeeded(connectionManager, schema, fileID, batchID, currentPlotID, currentCensusID, tx.id);

      // If the same census is re-uploaded under a new filename, remove any old
      // unresolved ingestion rows that exactly match the currently staged rows.
      await cleanupMatchedUnresolvedIngestionFailuresForBatch(connectionManager, schema, fileID, batchID, currentCensusID, tx.id);

      // Split into sub-batches if needed (UPDATE within same transaction)
      const ids = await splitIntoSubBatches(connectionManager, schema, fileID, batchID, totalRows, tx.id);

      ailogger.info(`Setup complete for ${fileID}: ${totalRows} rows → ${ids.length} batch(es), plot=${currentPlotID}, census=${currentCensusID}`);

      return { plotID: currentPlotID, censusID: currentCensusID, totalRows, subBatchIDs: ids, recovered };
    },
    { timeoutMs: SETUP_PHASE_TIMEOUT_MS }
  );

  if (setupResult.plotID === null || setupResult.subBatchIDs.length === 0) {
    ailogger.warn(`No temporary rows found for ${fileID}-${batchID}`);
    return {
      processedSubBatches: 0,
      totalRows: setupResult.totalRows,
      recovered: setupResult.recovered,
      noDataFound: true,
      totalDurationMs: 0,
      subBatchResults: []
    };
  }

  const { totalRows, subBatchIDs, recovered } = setupResult;

  // --- Phase 2: Process each sub-batch sequentially ---
  const results: SubBatchResult[] = [];
  const overallStartTime = Date.now();

  for (let i = 0; i < subBatchIDs.length; i++) {
    const subBatchID = subBatchIDs[i];

    if (isAborted()) {
      ailogger.warn(`Client disconnected before sub-batch ${i + 1}/${subBatchIDs.length} for ${fileID}`);
      throw new IngestBatchAbortedError(fileID, batchID);
    }

    ailogger.info(`Processing sub-batch ${i + 1}/${subBatchIDs.length}: ${subBatchID}`);

    try {
      const subResult = await processSubBatch(connectionManager, schema, procedureSQL, fileID, subBatchID, isAborted);
      results.push(subResult);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (subError: any) {
      // Mid-batch abort (isAborted fired inside the retry loop) or truly
      // unrecoverable error — move remaining sub-batches to failed.
      // A between-batches IngestBatchAbortedError (midBatch=false) never
      // reaches here; it is thrown above the processSubBatch call and
      // propagates directly to the caller.
      const isMidBatchAbort = subError instanceof IngestBatchAbortedError && subError.midBatch;
      if (isMidBatchAbort) {
        ailogger.warn(`Client disconnected mid-retry for sub-batch ${subBatchID}: moving remaining rows to unresolved`);
      } else {
        ailogger.error(`Unrecoverable error on sub-batch ${subBatchID}: ${subError.message}`, subError);
      }

      const failureReason = isMidBatchAbort ? 'Batch cancelled before completion' : `Sub-batch abandoned after unrecoverable error: ${subError.message}`;

      // Move all remaining sub-batches in a single transaction so cleanup
      // is atomic — either every remaining sub-batch is moved to failures
      // or none are (no orphaned rows left in temporarymeasurements).
      let cleanupTransactionID: string | undefined;
      try {
        cleanupTransactionID = await connectionManager.beginTransaction();
        for (let j = i; j < subBatchIDs.length; j++) {
          const movedRows = await moveTemporaryBatchToFailedMeasurements(
            connectionManager,
            schema,
            fileID,
            subBatchIDs[j],
            failureReason,
            cleanupTransactionID
          );
          results.push({
            subBatchID: subBatchIDs[j],
            rowCount: movedRows,
            durationMs: 0,
            attemptsNeeded: 0,
            batchFailedButHandled: true,
            message: `Moved ${movedRows} rows to unresolved coremeasurements`
          });
        }
        await connectionManager.commitTransaction(cleanupTransactionID);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (moveError: any) {
        ailogger.error(`Failed to move remaining sub-batches to failed: ${moveError.message}`);
        if (cleanupTransactionID) {
          try {
            await connectionManager.rollbackTransaction(cleanupTransactionID);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (rollbackError: any) {
            ailogger.error(`Rollback of sub-batch cleanup also failed: ${rollbackError.message}`);
          }
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

  return {
    processedSubBatches: results.length,
    totalRows,
    recovered,
    noDataFound: false,
    totalDurationMs: overallDuration,
    subBatchResults: results
  };
}
