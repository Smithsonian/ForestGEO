/**
 * Batch ingestion — the single mechanism for running one staged file/batch
 * through the `bulkingestionprocess` stored procedure.
 *
 * Both the synchronous HTTP route (app/api/setupbulkprocedure/[fileID]/[batchID])
 * and the background upload worker call ingestBatch; neither owns any ingestion
 * internals of its own. The sequence is:
 *
 *   Phase 1 (one transaction, application-locked):
 *     - discover the staged batch family once and check its scope and member sizes
 *     - recover dirty failed first-load census state if detected
 *     - remove stale unresolved ingestion rows that match the staged rows
 *     - split rows still staged under the original BatchID (legacy fallback)
 *   Phase 2 (one caller-owned transaction PER sub-batch — #507/#527):
 *     - run the sub-batch through bulkingestionprocess with the
 *       @bulkingestion_caller_owns_transaction flag set, so the procedure
 *       commits nothing itself
 *     - audit every coremeasurements row the call just committed — including
 *       unresolved StemGUID-NULL failure rows the procedure parks on a
 *       handled SQLEXCEPTION — via auditCoreMeasurementsScopeDiff, in
 *       the SAME transaction
 *     - commit the transaction, so the CALL's data and its audit trail land
 *       together or not at all; a thrown error rolls both back together and
 *       the attempt retries from a fresh transaction
 *     - on exhausted retries or unrecoverable errors, move remaining rows to
 *       unresolved coremeasurements via moveTemporaryBatchToFailedMeasurements
 *
 * Cancellation is caller-defined: the HTTP route passes a request-abort probe,
 * the worker passes its job-cancellation probe. An abort detected between
 * sub-batches throws IngestBatchAbortedError (rows for unprocessed sub-batches
 * stay in temporarymeasurements); an abort detected inside a sub-batch's retry
 * loop moves the remaining rows to unresolved coremeasurements.
 */

import crypto from 'crypto';
import ConnectionManager from '@/lib/db/connectionmanager';
import { TransactionCallbackTimeoutError } from '@/lib/db/transactionerrors';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { shouldRecoverFailedInitialCensus, type FailedInitialCensusRecoveryState } from '@/lib/failedinitialcensusrecovery';
import { moveTemporaryBatchToFailedMeasurements } from '@/lib/batchfailuretransfer';
import type { SystemFailureKind } from '@/config/measurementerrors';
import {
  BatchFamilyScopeError,
  buildSubBatchID,
  buildSubBatchPattern,
  discoverBatchFamily,
  FAMILY_SCAN_INDEX,
  getIngestionBatchSize,
  highestSubBatchOrdinal,
  LIKE_ESCAPE_CLAUSE,
  MAX_SUB_BATCH_ORDINAL,
  SubBatchOrdinalOverflowError,
  toCount,
  type BatchFamilyMember,
  type BatchFamilyScope
} from '@/lib/uploads/batch-family';
import { SETUP_FAILURE_CODES } from '@/lib/uploads/setup-failure';
import { isKilledConnectionError, isKilledStatementError, QueryTimeoutError } from '@/lib/db/primitives';
import { callBulkIngestionInCallerTransaction, transactionExecutorFor } from '@/lib/ingestion/bulk-ingestion-call';
import { auditCoreMeasurementsScopeDiff, snapshotCoreMeasurementsScope } from '@/lib/changelog/ingestion-audit';
import { ChangelogOperation, ChangelogWriteError } from '@/lib/changelog/record-mutation';
import { CHANGED_BY_MAX_LENGTH } from '@/lib/changelog/identity';
import {
  CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE,
  COREMEASUREMENTS_JOIN_ALIAS,
  deleteCoreMeasurementsInBoundedChunksWithAudit,
  lockAuditAndDeleteCoreMeasurementWindow,
  MEASUREMENT_ERROR_LOG_JOIN_ALIAS,
  PLAIN_COREMEASUREMENTS_FROM_SQL,
  selectCoreMeasurementIDsInScope,
  sliceIntoDeleteWindows,
  type CoreMeasurementDeleteScope,
  type CoreMeasurementLockAlias
} from '@/lib/ingestion/temporary-measurements';
import { retryWholeTransactionOnDeadlock } from '@/lib/db/deadlock-retry';
import { CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS } from '@/lib/uploads/stage-measurements';

const MAX_ATTEMPTS_PER_SUBBATCH = 5;
export const SETUP_PHASE_TIMEOUT_MS = 2 * 60 * 1000;

// Retry / backoff constants for processSubBatch
const INITIAL_RETRY_DELAY_MS = 100;

// Give-up threshold: once the attempt count reaches this, stop retrying lock
// contention. There is deliberately no timeout threshold — a timed-out call was
// KILLed, and a killed call is abandoned on the first occurrence, not after a
// budget (see the kill classification in processSubBatch).
const LOCK_GIVE_UP_AFTER_ATTEMPTS = 2;

// Backoff delays and caps per error class
const LOCK_CONTENTION_BACKOFF_MS = 15_000; // flat delay — don't escalate; just back off and retry once
const CONNECTION_BACKOFF_MULTIPLIER = 3;
const CONNECTION_BACKOFF_CAP_MS = 15_000;
const DEADLOCK_BACKOFF_MULTIPLIER = 1.5;
const DEADLOCK_BACKOFF_CAP_MS = 3_000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_BACKOFF_CAP_MS = 5_000;
const RETRY_JITTER_MAX_MS = 1_000;

// MySQL error numbers for connection-loss and deadlock conditions
const MYSQL_ERRNO_TCP_LOST = 2013; // CR_SERVER_LOST — TCP connection lost during query
const MYSQL_ERRNO_DEADLOCK = 1213; // ER_LOCK_DEADLOCK

/**
 * mysql2's code when the SERVER closed the connection underneath a running
 * statement. Measured against MySQL 8.0.36 (2026-07-29): an operator's
 * `KILL <id>` during a CALL surfaces here as `PROTOCOL_CONNECTION_LOST` with no
 * errno at all — NOT as ER_CONNECTION_KILLED/1927, which is what the error
 * catalog suggests. Classifying only on 1927 would have left the operator-kill
 * path retrying exactly as it did during the Harvard incident.
 *
 * It is grouped with the kills rather than with transient loss because the
 * server, not the network, ended the session — the same thing a KILL does.
 * ECONNRESET and CR_SERVER_LOST/2013 (network-layer loss) stay retryable.
 */
const PROTOCOL_CONNECTION_LOST_CODE = 'PROTOCOL_CONNECTION_LOST';

/**
 * MySQL GET_LOCK names may not exceed 64 characters. Hash the full logical
 * scope so a long filename cannot make lock acquisition fail, and include the
 * schema so equivalent file/plot/census values at different sites do not
 * serialize one another in the server-global advisory-lock namespace.
 */
export function buildIngestionLockName(schema: string, fileID: string, plotID: number, censusID: number): string {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify([schema, fileID, plotID, censusID]))
    .digest('hex')
    .slice(0, 40);
  return `upload:file:${digest}`;
}

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
  /** Caller-authorized scope; never derive this from ingestion discovery. */
  expectedScope: { plotID: number; censusID: number };
  /**
   * Cancellation probe checked between sub-batches and between retry attempts.
   * The HTTP route passes a request-abort check; the worker passes its
   * job-cancellation probe. Defaults to "never aborted".
   */
  isAborted?: () => boolean;
  /**
   * Trusted actor recorded as `unifiedchangelog.ChangedBy` for every
   * coremeasurements audit row this call writes (#507). MUST be a
   * server-resolved identity — `job.createdBy` for the background worker,
   * `authenticatedSessionIdentity(session.user)` for the synchronous route —
   * never a client-supplied field. Truncated to CHANGED_BY_MAX_LENGTH;
   * `undefined`/`null` records a NULL ChangedBy rather than throwing.
   */
  changedBy?: string | null;
  /** Synchronous, best-effort setup telemetry. Exceptions are ignored. */
  onSetupProgress?: (diagnostic: Readonly<SetupDiagnostic>) => void;
}

export interface SetupDiagnostic {
  step: 'discovery' | 'lock_wait' | 'recovery' | 'cleanup' | 'splitting' | 'commit' | 'terminal';
  outcome?: 'started' | 'completed' | 'failed' | 'committed';
  schema: string;
  plotID: number;
  censusID: number;
  fileID: string;
  batchID: string;
  elapsedMs: number;
  rowCount?: number;
  assignedRows?: number;
  completedBatches?: number;
  errorCode?: string;
  terminal?: boolean;
}

export class SetupCallbackTimeoutError extends Error {
  readonly code = SETUP_FAILURE_CODES.callbackTimeout;
  readonly cause: unknown;
  constructor(cause: unknown) {
    super('Ingestion setup transaction callback timed out');
    this.name = 'SetupCallbackTimeoutError';
    this.cause = cause;
  }
}

export class OversizedSubBatchError extends Error {
  readonly code = SETUP_FAILURE_CODES.oversizedSubBatch;
  constructor(fileID: string, member: BatchFamilyMember, batchSize: number) {
    super(
      `Sub-batch ${member.batchID} of ${fileID} holds ${member.rowCount} rows; the limit is ${batchSize}. It was staged with a different batch size or a tampered row offset.`
    );
    this.name = 'OversizedSubBatchError';
  }
}

export class SetupMembershipChangedError extends Error {
  readonly code = SETUP_FAILURE_CODES.membershipChanged;
  constructor(message: string) {
    super(message);
    this.name = 'SetupMembershipChangedError';
  }
}

export class SetupLockUnavailableError extends Error {
  readonly code = SETUP_FAILURE_CODES.lockUnavailable;
  constructor(fileID: string) {
    super(`Failed to acquire application lock for file ${fileID}. Another upload may be in progress.`);
    this.name = 'SetupLockUnavailableError';
  }
}

/**
 * Pinned to FBPC: on Azure (2026-10-16) the optimizer chose
 * idx_cid_md_dbh_hom_qn_tt, scanned and sorted every remaining row, and spent
 * 2.7 s per pass; the FBPC range scan returns the same rows in 20 ms.
 */
export function buildFallbackSplitSelectSQL(schema: string, batchSize: number): string {
  return safeFormatQuery(
    schema,
    `SELECT /*+ INDEX(tm ${FAMILY_SCAN_INDEX}) */ CAST(tm.id AS CHAR) AS rowID
     FROM ??.temporarymeasurements tm
     WHERE tm.FileID = ? AND tm.BatchID = ? AND tm.PlotID = ? AND tm.CensusID = ?
       AND tm.id > CAST(? AS UNSIGNED) AND tm.id <= CAST(? AS UNSIGNED)
     ORDER BY tm.id
     LIMIT ${batchSize}`
  );
}

/**
 * Staging derives membership from the client's firstRowOrdinal, so overlapping
 * or tampered offsets can pile more than one batch of rows into a member. This
 * is the only check that stops it before the procedure runs an oversized
 * transaction.
 */
function assertMembersWithinBatchSize(family: BatchFamilyScope, fileID: string, originalBatchID: string, batchSize: number): void {
  const oversized = family.members.find(member => member.batchID !== originalBatchID && member.rowCount > batchSize);
  if (oversized) throw new OversizedSubBatchError(fileID, oversized, batchSize);
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const { code } = error as { code: unknown };
  return typeof code === 'string' ? code : undefined;
}

function assertExpectedScope(family: BatchFamilyScope, plotID: number, censusID: number, fileID: string, batchID: string): void {
  if (family.plotID !== plotID || family.censusID !== censusID) {
    throw new BatchFamilyScopeError(
      fileID,
      batchID,
      `discovered plot=${family.plotID}, census=${family.censusID}; expected plot=${plotID}, census=${censusID}`
    );
  }
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
  /**
   * Count of the family's existing `__subNNN` members when setup began: normally
   * every member for pre-partitioned uploads, rather than ones created by this run's split.
   */
  resumedSubBatchCount: number;
}

interface SetupResult {
  totalRows: number;
  subBatchIDs: string[];
  recovered: boolean;
  resumedSubBatchCount: number;
}

/**
 * A single procedure-result row. mysql2 types column values as unknown at
 * the driver boundary (string | number | bigint | Date | Buffer | null,
 * depending on the column) — toCount/toOptionalMessage below narrow them.
 */
type ProcedureResultRow = Record<string, unknown>;

/**
 * mysql2's shape for a `CALL` with no OUT params: a tuple whose first element
 * is the result-set row array (or, on some drivers, the row object directly —
 * see the fallback branch in extractProcedureRow), with trailing driver
 * metadata (e.g. the OkPacket) this code never reads.
 */
type ProcedureCallResult = [ProcedureResultRow[] | ProcedureResultRow, ...unknown[]];

/**
 * Extracts the first data row from a mysql2 stored procedure result.
 * mysql2 returns CALL results as [[row1, row2, ...], OkPacket] — the first
 * element is the result set array.  We need the first row object.
 */
function extractProcedureRow(procedureResult: ProcedureCallResult | null | undefined): ProcedureResultRow | null {
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

/** Narrows an unknown procedure-row field to a string for SubBatchResult.message. */
function toOptionalMessage(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export type FailedCensusRecoveryOutcome = 'not_due' | 'recovered' | 'superseded';

export interface FailedCensusRecoveryParams {
  schema: string;
  fileID: string;
  batchID: string;
  plotID: number;
  censusID: number;
  changedBy: string | null;
}

export interface FailedCensusRecoveryResult {
  outcome: FailedCensusRecoveryOutcome;
  /** coremeasurements rows deleted, each with its DELETE-audit row. */
  deletedRows: number;
  /** Committed measurement-window transactions; the final transaction is not counted. */
  windowCount: number;
  /** The longest single window attempt, BEGIN to COMMIT/ROLLBACK; deadlock backoff waits are not included. */
  slowestWindowMs: number;
  deadlockRetries: number;
}

export const FAILED_CENSUS_RECOVERY_STARTED_EVENT = 'upload.failed_census_recovery.started';
export const FAILED_CENSUS_RECOVERY_COMPLETED_EVENT = 'upload.failed_census_recovery.completed';
export const FAILED_CENSUS_RECOVERY_FAILED_EVENT = 'upload.failed_census_recovery.failed';
export const FAILED_CENSUS_RECOVERY_WINDOW_TRANSACTION = 'failed_census_recovery_window';
export const FAILED_CENSUS_RECOVERY_FINAL_TRANSACTION = 'failed_census_recovery_final';
/** One more than a window: a final read that returns this many ids means rows arrived after the scope read. */
export const FAILED_CENSUS_RECOVERY_FINAL_READ_LIMIT = CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE + 1;

type FailedCensusRecoveryProgress = Omit<FailedCensusRecoveryResult, 'outcome'>;
type RecoveryTransactionResult<T> = { superseded: true } | { superseded: false; value: T };
type FinalRecoveryStep = { rowsArrived: true } | { rowsArrived: false; deletedRows: number };

const NOT_DUE_RECOVERY: FailedCensusRecoveryResult = { outcome: 'not_due', deletedRows: 0, windowCount: 0, slowestWindowMs: 0, deadlockRetries: 0 };

/** C1: the whole census. */
export function failedCensusRecoveryScope(censusID: number): CoreMeasurementDeleteScope {
  return { whereSQL: 'CensusID = ?', whereParams: [censusID], fromSQL: PLAIN_COREMEASUREMENTS_FROM_SQL };
}

async function readFailedInitialCensusRecoveryState(
  connectionManager: ConnectionManager,
  schema: string,
  plotID: number,
  censusID: number
): Promise<FailedInitialCensusRecoveryState> {
  const recoveryStateSQL = safeFormatQuery(
    schema,
    `SELECT
       (SELECT COUNT(*) FROM ??.uploadmetrics WHERE PlotID = ? AND CensusID = ? AND status = 'completed') AS completedUploads,
       (SELECT COUNT(*) FROM ??.uploadmetrics WHERE PlotID = ? AND CensusID = ? AND status IN ('failed', 'processing')) AS incompleteUploads,
       (SELECT COUNT(*) FROM ??.trees WHERE CensusID = ?) AS treeCount,
       (SELECT COUNT(*) FROM ??.stems WHERE CensusID = ?) AS stemCount,
       (SELECT COUNT(*) FROM ??.coremeasurements WHERE CensusID = ?) AS coreMeasurementCount`
  );
  const recoveryStateRows = await connectionManager.executeQuery(recoveryStateSQL, [plotID, censusID, plotID, censusID, censusID, censusID, censusID]);
  const recoveryStateRow = recoveryStateRows[0] ?? {};
  return {
    completedUploads: toCount(recoveryStateRow.completedUploads),
    incompleteUploads: toCount(recoveryStateRow.incompleteUploads),
    treeCount: toCount(recoveryStateRow.treeCount),
    stemCount: toCount(recoveryStateRow.stemCount),
    coreMeasurementCount: toCount(recoveryStateRow.coreMeasurementCount)
  };
}

/**
 * The first two statements of every recovery transaction. Every writer of the census's trees, stems or
 * measurement rows holds a shared lock on the census row through its foreign key until it commits, so this
 * FOR UPDATE waits for any such writer in flight and keeps new ones out until this transaction commits; the
 * guard then reads the census's completed uploads under that lock (spec #562 §3, D3, D10, E-6).
 */
async function recoveryIsSupersededUnderCensusLock(
  connectionManager: ConnectionManager,
  params: FailedCensusRecoveryParams,
  transactionID: string
): Promise<boolean> {
  const censusRows = await connectionManager.executeQuery(
    safeFormatQuery(params.schema, 'SELECT CensusID FROM ??.census WHERE CensusID = ? FOR UPDATE'),
    [params.censusID],
    transactionID
  );
  if (!Array.isArray(censusRows) || censusRows.length === 0) return true;
  const guardRows = await connectionManager.executeQuery(
    safeFormatQuery(params.schema, "SELECT COUNT(*) AS completedUploads FROM ??.uploadmetrics WHERE PlotID = ? AND CensusID = ? AND status = 'completed'"),
    [params.plotID, params.censusID],
    transactionID
  );
  return toCount(guardRows?.[0]?.completedUploads) > 0;
}

async function runRecoveryTransaction<T>(
  connectionManager: ConnectionManager,
  params: FailedCensusRecoveryParams,
  progress: FailedCensusRecoveryProgress,
  transactionKind: string,
  timeoutMs: number,
  work: (transactionID: string) => Promise<T>
): Promise<RecoveryTransactionResult<T>> {
  const attemptTransaction = async (): Promise<RecoveryTransactionResult<T>> => {
    const attemptStartedAt = Date.now();
    try {
      return await connectionManager.withTransaction<RecoveryTransactionResult<T>>(
        async tx =>
          (await recoveryIsSupersededUnderCensusLock(connectionManager, params, tx.id))
            ? { superseded: true }
            : { superseded: false, value: await work(tx.id) },
        { timeoutMs }
      );
    } finally {
      if (transactionKind === FAILED_CENSUS_RECOVERY_WINDOW_TRANSACTION)
        progress.slowestWindowMs = Math.max(progress.slowestWindowMs, Date.now() - attemptStartedAt);
    }
  };
  return retryWholeTransactionOnDeadlock(transactionKind, attemptTransaction, () => {
    progress.deadlockRetries += 1;
  });
}

/** Today's residue statements, in today's order. */
function failedCensusResidueStatements(params: FailedCensusRecoveryParams): Array<{ sql: string; params: unknown[] }> {
  const { schema, fileID, batchID, plotID, censusID } = params;
  return [
    // measurementssummary is derived and reconstructable, not a primary audit trail: deleted unaudited.
    { sql: safeFormatQuery(schema, 'DELETE FROM ??.measurementssummary WHERE CensusID = ?'), params: [censusID] },
    { sql: safeFormatQuery(schema, 'DELETE FROM ??.stems WHERE CensusID = ?'), params: [censusID] },
    { sql: safeFormatQuery(schema, 'DELETE FROM ??.trees WHERE CensusID = ?'), params: [censusID] },
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
           AND NOT (tm.FileID = ? AND (tm.BatchID = ? OR tm.BatchID LIKE ? ${LIKE_ESCAPE_CLAUSE}))`
      ),
      params: [plotID, censusID, fileID, batchID, buildSubBatchPattern(batchID)]
    },
    { sql: safeFormatQuery(schema, 'DELETE FROM ??.uploadintegrityalerts WHERE PlotID = ? AND CensusID = ?'), params: [plotID, censusID] },
    {
      sql: safeFormatQuery(schema, "DELETE FROM ??.uploadmetrics WHERE PlotID = ? AND CensusID = ? AND status IN ('failed', 'processing')"),
      params: [plotID, censusID]
    }
  ];
}

/**
 * The final transaction: under the census lock no uncommitted insert into the census can exist or start, so this
 * read is complete. The held-back slice goes in the same transaction as the metrics, alerts, staged rows, stems
 * and trees, so the census keeps the predicate's evidence until everything commits (spec #562 D4, G5).
 */
async function finishFailedCensusRecovery(
  connectionManager: ConnectionManager,
  params: FailedCensusRecoveryParams,
  scope: CoreMeasurementDeleteScope,
  transactionID: string
): Promise<FinalRecoveryStep> {
  const remainingRows = await connectionManager.executeQuery(
    safeFormatQuery(
      params.schema,
      `SELECT CoreMeasurementID FROM ??.coremeasurements WHERE CensusID = ? ORDER BY CoreMeasurementID LIMIT ${FAILED_CENSUS_RECOVERY_FINAL_READ_LIMIT}`
    ),
    [params.censusID],
    transactionID
  );
  const remainingIDs = (Array.isArray(remainingRows) ? remainingRows : []).map((row: { CoreMeasurementID: unknown }) => Number(row.CoreMeasurementID));
  if (remainingIDs.length > CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE) return { rowsArrived: true };
  const deletedRows = await lockAuditAndDeleteCoreMeasurementWindow(
    connectionManager,
    params.schema,
    scope,
    remainingIDs,
    params.changedBy,
    params.plotID,
    params.censusID,
    transactionID
  );
  for (const statement of failedCensusResidueStatements(params)) {
    await connectionManager.executeQuery(statement.sql, statement.params, transactionID);
  }
  return { rowsArrived: false, deletedRows };
}

/**
 * Each pass reads the census once and deletes what it read. A pass ends early ("rows arrived") only when more than
 * a window of rows exists under the final transaction's census lock, i.e. other writers added failure rows after the
 * read; those writers are failed attempts (a completed upload makes the guard stop the recovery), and every pass
 * deletes everything it read, so the loop only continues while new failed attempts keep landing in this census.
 * Deliberately not capped: a cap would leave a census half-recovered for a reason the next ingestBatch repeats.
 */
async function runFailedCensusRecovery(
  connectionManager: ConnectionManager,
  params: FailedCensusRecoveryParams,
  progress: FailedCensusRecoveryProgress
): Promise<Exclude<FailedCensusRecoveryOutcome, 'not_due'>> {
  const scope = failedCensusRecoveryScope(params.censusID);
  for (;;) {
    const windows = sliceIntoDeleteWindows(await selectCoreMeasurementIDsInScope(connectionManager, params.schema, scope));
    const heldBackWindowIndex = windows.length - 1;
    for (const windowIDs of windows.slice(0, heldBackWindowIndex)) {
      const window = await runRecoveryTransaction(
        connectionManager,
        params,
        progress,
        FAILED_CENSUS_RECOVERY_WINDOW_TRANSACTION,
        CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS,
        transactionID =>
          lockAuditAndDeleteCoreMeasurementWindow(
            connectionManager,
            params.schema,
            scope,
            windowIDs,
            params.changedBy,
            params.plotID,
            params.censusID,
            transactionID
          )
      );
      if (window.superseded) return 'superseded';
      progress.windowCount += 1;
      progress.deletedRows += window.value;
    }
    const final = await runRecoveryTransaction(
      connectionManager,
      params,
      progress,
      FAILED_CENSUS_RECOVERY_FINAL_TRANSACTION,
      SETUP_PHASE_TIMEOUT_MS,
      transactionID => finishFailedCensusRecovery(connectionManager, params, scope, transactionID)
    );
    if (final.superseded) return 'superseded';
    if (!final.value.rowsArrived) {
      progress.deletedRows += final.value.deletedRows;
      return 'recovered';
    }
  }
}

/**
 * Recovers a census whose first load failed (shouldRecoverFailedInitialCensus) BEFORE ingestBatch's setup
 * transaction opens, in separately committed transactions of at most CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE
 * measurement rows each (#562). Every transaction takes the census row FOR UPDATE, re-checks for a completed
 * upload, and is re-run whole on a deadlock. An interruption anywhere leaves a census that is still due, or one
 * that is fully recovered, so the next ingestBatch resumes (spec #562 §3).
 */
export async function recoverFailedInitialCensusInBoundedTransactions(
  connectionManager: ConnectionManager,
  params: FailedCensusRecoveryParams
): Promise<FailedCensusRecoveryResult> {
  const { schema, fileID, batchID, plotID, censusID } = params;
  const recoveryState = await readFailedInitialCensusRecoveryState(connectionManager, schema, plotID, censusID);
  if (!shouldRecoverFailedInitialCensus(recoveryState)) return { ...NOT_DUE_RECOVERY };

  const family = await discoverBatchFamily((sql, sqlParams) => connectionManager.executeQuery(sql, sqlParams), schema, fileID, batchID);
  if (!family) return { ...NOT_DUE_RECOVERY };
  assertExpectedScope(family, plotID, censusID, fileID, batchID);
  assertMembersWithinBatchSize(family, fileID, batchID, getIngestionBatchSize());

  const logKeys = { schema, plotID, censusID, fileID, batchID, recoveryState };
  ailogger.info(FAILED_CENSUS_RECOVERY_STARTED_EVENT, logKeys);
  const startedAt = Date.now();
  const progress: FailedCensusRecoveryProgress = { deletedRows: 0, windowCount: 0, slowestWindowMs: 0, deadlockRetries: 0 };
  let outcome: Exclude<FailedCensusRecoveryOutcome, 'not_due'>;
  try {
    outcome = await runFailedCensusRecovery(connectionManager, params, progress);
  } catch (recoveryError: unknown) {
    // Committed windows stay deleted and the next ingestBatch resumes; this line says how far this attempt got.
    ailogger.error(FAILED_CENSUS_RECOVERY_FAILED_EVENT, recoveryError instanceof Error ? recoveryError : undefined, {
      ...logKeys,
      ...progress,
      elapsedMs: Date.now() - startedAt,
      errorMessage: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
    });
    throw recoveryError;
  }
  ailogger.info(FAILED_CENSUS_RECOVERY_COMPLETED_EVENT, { ...logKeys, outcome, ...progress, elapsedMs: Date.now() - startedAt });
  return { outcome, ...progress };
}

async function recoverFailedInitialCensusIfNeeded(
  connectionManager: ConnectionManager,
  schema: string,
  fileID: string,
  batchID: string,
  plotID: number,
  censusID: number,
  changedBy: string | null,
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

  // measurementssummary is derived/reconstructable, not a primary audit trail
  // (same discipline as cleanupPreviousFileUploads — see
  // deleteCoreMeasurementsInBoundedChunksWithAudit's doc comment) — delete it
  // unaudited, before the audited coremeasurements delete below.
  await connectionManager.executeQuery(safeFormatQuery(schema, 'DELETE FROM ??.measurementssummary WHERE CensusID = ?'), [censusID], transactionID);

  // Every coremeasurements row in this census is a real committed write and
  // must be audited before removal (#507): reuse the same bounded,
  // FOR-UPDATE-locked select-audit-delete sequence Clean Re-Upload's own
  // census-wide cleanup uses (cleanupPreviousFileUploads), rather than a raw
  // unaudited DELETE.
  const recoveredCoreMeasurementsCount = await deleteCoreMeasurementsInBoundedChunksWithAudit(
    connectionManager,
    schema,
    'CensusID = ?',
    [censusID],
    changedBy,
    plotID,
    censusID,
    transactionID
  );
  if (recoveredCoreMeasurementsCount > 0) {
    ailogger.warn(`Recovery removed ${recoveredCoreMeasurementsCount} coremeasurement(s) from dirty failed first-load census ${censusID}`);
  }

  const cleanupSteps = [
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
           AND NOT (tm.FileID = ? AND (tm.BatchID = ? OR tm.BatchID LIKE ? ${LIKE_ESCAPE_CLAUSE}))`
      ),
      params: [plotID, censusID, fileID, batchID, buildSubBatchPattern(batchID)]
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
 * The cross-file cleanup locks the rows its predicate reads that can change under it: measurements and their
 * error links (resolveMeasurementErrors and the single-failure re-ingest update `mel` alone). It does not lock
 * the measurement_errors catalog, which nothing updates, nor the incoming family's staged rows, which are written
 * only under the setup's per-file application lock (spec #562 D11, E-7).
 */
export const CROSS_FILE_CLEANUP_LOCKED_ALIASES: readonly CoreMeasurementLockAlias[] = [COREMEASUREMENTS_JOIN_ALIAS, MEASUREMENT_ERROR_LOG_JOIN_ALIAS];

/** Unresolved rows of the incoming file in batch families other than the incoming one (C2). */
export function sameFileUnresolvedFailureScope(fileID: string, batchID: string, censusID: number): CoreMeasurementDeleteScope {
  return {
    whereSQL: `CensusID = ? AND StemGUID IS NULL AND UploadFileID = ? AND NOT (UploadBatchID <=> ? OR UploadBatchID LIKE ? ${LIKE_ESCAPE_CLAUSE})`,
    whereParams: [censusID, fileID, batchID, buildSubBatchPattern(batchID)],
    fromSQL: PLAIN_COREMEASUREMENTS_FROM_SQL
  };
}

/** Unresolved ingestion failures of other files that match a staged row of the incoming family (C3). */
export function crossFileUnresolvedFailureScope(fileID: string, batchID: string, censusID: number): CoreMeasurementDeleteScope {
  return {
    whereSQL: `cm.CensusID = ? AND cm.StemGUID IS NULL AND NOT (cm.UploadFileID <=> ? AND (cm.UploadBatchID <=> ? OR cm.UploadBatchID LIKE ? ${LIKE_ESCAPE_CLAUSE}))`,
    // The JOIN binds the incoming family (FileID, BatchID, LIKE pattern) before the WHERE's census and exclusion params.
    whereParams: [fileID, batchID, buildSubBatchPattern(batchID), censusID, fileID, batchID, buildSubBatchPattern(batchID)],
    fromSQL: `??.coremeasurements cm
     INNER JOIN ??.measurement_error_log mel
       ON mel.MeasurementID = cm.CoreMeasurementID
      AND mel.IsResolved = FALSE
     INNER JOIN ??.measurement_errors me
       ON me.ErrorID = mel.ErrorID
      AND me.ErrorSource = 'ingestion'
     INNER JOIN ??.temporarymeasurements tm
       ON tm.CensusID = cm.CensusID
      AND tm.FileID = ?
      AND (tm.BatchID = ? OR tm.BatchID LIKE ? ${LIKE_ESCAPE_CLAUSE})
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
      AND tm.Comments <=> cm.RawComments`,
    lockedAliases: CROSS_FILE_CLEANUP_LOCKED_ALIASES
  };
}

async function cleanupMatchedUnresolvedIngestionFailuresForBatch(
  connectionManager: ConnectionManager,
  schema: string,
  fileID: string,
  batchID: string,
  plotID: number,
  censusID: number,
  changedBy: string | null,
  transactionID: string
): Promise<number> {
  // Spare the CURRENT batch FAMILY (bare ID + its __subNNN members), not just
  // the bare ID: on a worker retry the batch ID is reused, and the completed
  // sub-batches' proc-recorded failure rows live under suffixed IDs — deleting
  // them here would permanently destroy recorded failures the idempotent
  // re-run never regenerates. Non-completed members' stale rows were already
  // removed by the worker's sub-batch-aware cleanup before re-staging. A
  // same-file re-upload under a NEW batch ID still cleans the old family
  // (a different family never matches the new one's pattern).
  //
  // Both deletes go through deleteCoreMeasurementsInBoundedChunksWithAudit
  // (#507, #562): one non-locking read of the scope, primary-key windows with
  // the predicate re-checked under lock, every removed row audited, and a
  // locking confirmation before the walk ends. Both stay inside the setup
  // transaction (spec #562 D7).
  const sameFileScope = sameFileUnresolvedFailureScope(fileID, batchID, censusID);
  const sameFileDeletedRows = await deleteCoreMeasurementsInBoundedChunksWithAudit(
    connectionManager,
    schema,
    sameFileScope.whereSQL,
    sameFileScope.whereParams,
    changedBy,
    plotID,
    censusID,
    transactionID,
    sameFileScope.fromSQL
  );

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

  // Cross-file match joins the incoming family's staged rows; its windows lock only cm and mel (spec #562 D11).
  const crossFileScope = crossFileUnresolvedFailureScope(fileID, batchID, censusID);
  const deletedRows = await deleteCoreMeasurementsInBoundedChunksWithAudit(
    connectionManager,
    schema,
    crossFileScope.whereSQL,
    crossFileScope.whereParams,
    changedBy,
    plotID,
    censusID,
    transactionID,
    crossFileScope.fromSQL,
    crossFileScope.lockedAliases
  );

  if (deletedRows > 0) {
    ailogger.warn(`Removed ${deletedRows} stale unresolved row(s) from prior cross-file uploads that matched ${fileID}-${batchID}`);
  }

  return sameFileDeletedRows + deletedRows;
}

/**
 * Fallback split for rows still staged under the original BatchID (legacy
 * client, re-ingestion, or an orphaned remainder). Pre-partitioned staging never
 * reaches it. It freezes its own upper bound, so rows staged after the bound
 * read stay under the original BatchID for the next setup instead of joining
 * a sub-batch this run already sized. Likewise a member first staged after the
 * locked discovery stays staged and is ingested by the next setup of the
 * family; staging completes before setup in both the worker and the browser.
 */
async function splitOriginalRowsIntoSubBatches(
  connectionManager: ConnectionManager,
  schema: string,
  fileID: string,
  originalBatchID: string,
  expectedRows: number,
  scope: { plotID: number; censusID: number },
  transactionID: string,
  startOrdinal: number,
  checkAbort: () => void,
  onProgress: (assignedRows: number, completedBatches: number) => void
): Promise<string[]> {
  const batchSize = getIngestionBatchSize();
  const boundSQL = safeFormatQuery(
    schema,
    `SELECT /*+ INDEX(tm ${FAMILY_SCAN_INDEX}) */ COUNT(*) AS rowCount, CAST(MAX(tm.id) AS CHAR) AS upperID
     FROM ??.temporarymeasurements tm
     WHERE tm.FileID = ? AND tm.BatchID = ? AND tm.PlotID = ? AND tm.CensusID = ?`
  );
  const [bound] = (await connectionManager.executeQuery(boundSQL, [fileID, originalBatchID, scope.plotID, scope.censusID], transactionID)) as Array<{
    rowCount: number | string;
    upperID: string | null;
  }>;
  if (toCount(bound?.rowCount) !== expectedRows || !bound?.upperID) {
    throw new SetupMembershipChangedError(
      `Batch ${fileID}-${originalBatchID} changed during setup: discovered ${expectedRows} original row(s), found ${toCount(bound?.rowCount)}`
    );
  }
  const subBatchCount = Math.ceil(expectedRows / batchSize);
  if (startOrdinal + subBatchCount > MAX_SUB_BATCH_ORDINAL) {
    const lastOriginalRowOrdinal = expectedRows - 1;
    throw new SubBatchOrdinalOverflowError(originalBatchID, lastOriginalRowOrdinal, startOrdinal + subBatchCount);
  }

  const selectSQL = buildFallbackSplitSelectSQL(schema, batchSize);
  const updateSQL = safeFormatQuery(
    schema,
    `UPDATE ??.temporarymeasurements SET BatchID = ?
     WHERE FileID = ? AND BatchID = ? AND PlotID = ? AND CensusID = ? AND id > CAST(? AS UNSIGNED) AND id <= CAST(? AS UNSIGNED)`
  );
  const subBatchIDs: string[] = [];
  let cursor = '0';
  let assigned = 0;
  for (let index = 0; index < subBatchCount; index++) {
    checkAbort();
    const subBatchID = buildSubBatchID(originalBatchID, startOrdinal + index + 1);
    const selected = (await connectionManager.executeQuery(
      selectSQL,
      [fileID, originalBatchID, scope.plotID, scope.censusID, cursor, bound.upperID],
      transactionID
    )) as Array<{ rowID: string }>;
    if (selected.length === 0)
      throw new SetupMembershipChangedError(`Fallback split selected no rows while ${expectedRows - assigned} remain for ${fileID}-${originalBatchID}`);
    const lastID = String(selected[selected.length - 1].rowID);
    const updateResult = await connectionManager.executeQuery(
      updateSQL,
      [subBatchID, fileID, originalBatchID, scope.plotID, scope.censusID, cursor, lastID],
      transactionID
    );
    const affectedRows = toCount(updateResult?.affectedRows);
    if (affectedRows !== selected.length)
      throw new SetupMembershipChangedError(`Fallback split selected ${selected.length} rows but assigned ${affectedRows} for ${subBatchID}`);
    subBatchIDs.push(subBatchID);
    assigned += affectedRows;
    cursor = lastID;
    onProgress(assigned, index + 1);
  }
  if (assigned !== expectedRows)
    throw new SetupMembershipChangedError(`Fallback split assigned ${assigned} of ${expectedRows} rows for ${fileID}-${originalBatchID}`);
  return subBatchIDs;
}

/**
 * Process a single sub-batch through bulkingestionprocess with retry logic.
 *
 * The CALL and its coremeasurements audit trail run inside ONE caller-owned
 * transaction per attempt (#507/#527): beginTransaction, SET the
 * @bulkingestion_caller_owns_transaction flag (via
 * callBulkIngestionInCallerTransaction, which also clears it on every exit),
 * run the procedure, audit the rows it just committed, then commit. A thrown
 * error — including an audit-write failure — rolls the WHOLE attempt back
 * (data and audit together) and falls through to this function's existing
 * retry/backoff/kill classification, which is unchanged by this.
 */

/**
 * Moves one sub-batch's remaining temporarymeasurements rows to unresolved
 * coremeasurements AND audits them in unifiedchangelog — bound to the SAME
 * transaction (#507). Used by both fallback paths below: processSubBatch's
 * give-up path (exhausted retries / a killed call) and ingestBatch's
 * mid-batch-abort / unrecoverable-error cleanup. Both call this inside a
 * transaction THEY own and commit/roll back themselves, exactly like the
 * happy-path CALL+audit in processSubBatch above.
 *
 * Verifies the audit wrote exactly as many rows as the move reported moving:
 * selecting "every row attached to this fileID/batchID" does not, on its
 * own, prove it is exactly this attempt's rows unless the two counts agree
 * (#507 — the same discipline deleteCoreMeasurementsInBoundedChunksWithAudit
 * applies to Clean Re-Upload's deletes).
 */
async function moveSubBatchToFailedMeasurementsWithAudit(
  connectionManager: ConnectionManager,
  schema: string,
  fileID: string,
  subBatchID: string,
  failureReason: string,
  failureKind: SystemFailureKind,
  transactionID: string,
  changedBy: string | null,
  plotID: number,
  censusID: number
): Promise<number> {
  return moveTemporaryBatchToFailedMeasurements(connectionManager, schema, fileID, subBatchID, failureReason, failureKind, transactionID, {
    changedBy,
    plotID,
    censusID
  });
}

async function processSubBatch(
  connectionManager: ConnectionManager,
  schema: string,
  fileID: string,
  subBatchID: string,
  plotID: number,
  censusID: number,
  changedBy: string | null,
  isAborted: () => boolean
): Promise<SubBatchResult> {
  let attempt = 0;
  let delay = INITIAL_RETRY_DELAY_MS;
  /** Set when the loop exits because the call was KILLed rather than because attempts ran out. */
  let killReason: string | null = null;
  /** The most recent attempt's thrown error, so the loop can tell a persistent audit-infrastructure outage apart from a data/SQL failure once attempts run out. */
  let lastError: unknown = null;

  while (attempt < MAX_ATTEMPTS_PER_SUBBATCH) {
    if (isAborted()) {
      throw new IngestBatchAbortedError(fileID, subBatchID, true);
    }

    let transactionID: string | undefined;
    try {
      attempt++;
      const startTime = Date.now();

      ailogger.info(`Sub-batch ${subBatchID} attempt ${attempt}: calling bulkingestionprocess...`);

      transactionID = await connectionManager.beginTransaction();
      const tx = transactionExecutorFor(connectionManager, transactionID);

      // Snapshotted BEFORE the CALL: a self-heal that deletes stale residue
      // and re-inserts can net to zero rows, but a count delta would miss
      // every new row's INSERT audit and every removed row's DELETE audit —
      // see auditCoreMeasurementsScopeDiff's doc comment.
      const beforeCallSnapshot = await snapshotCoreMeasurementsScope(tx, schema, fileID, subBatchID);

      const procedureResult = await callBulkIngestionInCallerTransaction<ProcedureCallResult>(tx, schema, fileID, subBatchID);

      ailogger.info(`Sub-batch ${subBatchID} attempt ${attempt}: procedure returned, parsing result...`, {
        resultType: typeof procedureResult,
        isArray: Array.isArray(procedureResult),
        firstElementType: procedureResult[0] ? typeof procedureResult[0] : 'undefined',
        firstElementIsArray: Array.isArray(procedureResult[0])
      });

      const row = extractProcedureRow(procedureResult);

      const batchFailedButHandled = row !== null && (toCount(row.records_failed) > 0 || toCount(row.batch_failed) === 1);

      // Audits whatever changed since beforeCallSnapshot (new rows as
      // INSERT, self-heal residue as DELETE, nothing on the no-op branch).
      // Runs BEFORE commit so a failure here rolls this attempt's data back with it.
      const auditDiff = await auditCoreMeasurementsScopeDiff({
        tx,
        schema,
        fileID,
        batchID: subBatchID,
        before: beforeCallSnapshot,
        changedBy,
        plotID,
        censusID
      });

      await connectionManager.commitTransaction(transactionID);

      const result: SubBatchResult = {
        subBatchID,
        rowCount: 0,
        durationMs: Date.now() - startTime,
        attemptsNeeded: attempt,
        batchFailedButHandled,
        message: toOptionalMessage(row?.message)
      };

      ailogger.info(`Sub-batch ${subBatchID} completed in ${result.durationMs}ms (attempt ${attempt})`, {
        batchFailedButHandled,
        message: row?.message,
        recordsFailed: row?.records_failed,
        batchFailed: row?.batch_failed,
        auditedInsertCount: auditDiff.insertedCount,
        auditedUpdateCount: auditDiff.updatedCount,
        auditedDeleteCount: auditDiff.deletedCount
      });
      return result;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      lastError = e;
      if (transactionID) {
        try {
          await connectionManager.rollbackTransaction(transactionID);
        } catch (rollbackError: unknown) {
          const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          ailogger.error(`Rollback failed for sub-batch ${subBatchID} attempt ${attempt}: ${rollbackMessage}`);
        }
      }

      // Typed, not substring-matched. The DB layer's own timeout raises
      // QueryTimeoutError, whose message merely happens to contain "timed out";
      // matching on that text also swallowed unrelated errors and, worse, routed
      // a KILLed CALL into the retry budget.
      const isQueryTimeout = e instanceof QueryTimeoutError;
      const isInterrupted = isKilledStatementError(e);
      const isConnectionKilled = isKilledConnectionError(e) || e.code === PROTOCOL_CONNECTION_LOST_CODE;
      // ChangelogWriteError wraps the audit statement's error as .cause, not
      // .code/.errno — classify the cause so a transient infra condition
      // underneath an audit failure still gets the SAME bounded backoff.
      const classificationSource: any = e instanceof ChangelogWriteError ? e.cause : e;
      const isConnectionError = classificationSource?.code === 'ECONNRESET' || classificationSource?.errno === MYSQL_ERRNO_TCP_LOST;
      const isDeadlock = classificationSource?.code === 'ER_LOCK_DEADLOCK' || classificationSource?.errno === MYSQL_ERRNO_DEADLOCK;
      const isLockContention = e.message?.includes('Failed to acquire application lock') || e.message?.includes('Another upload is in progress');
      // Any other audit/consistency failure is non-transient: the same CALL
      // would fail identically on replay, so retrying wastes the budget (#507).
      const isNonTransientAuditFailure = e instanceof ChangelogWriteError && !isConnectionError && !isDeadlock;

      // Every shape of "this procedure call was deliberately aborted": the DB
      // layer's timeout KILL (QueryTimeoutError), the ER_QUERY_INTERRUPTED that
      // KILL QUERY produces, and an operator's KILL <id> on the connection.
      const wasKilled = isQueryTimeout || isInterrupted || isConnectionKilled;

      ailogger.error(`Sub-batch ${subBatchID} attempt ${attempt} failed — MySQL error details:`, e, {
        message: e.message,
        code: e.code,
        errno: e.errno,
        sqlState: e.sqlState,
        sqlMessage: e.sqlMessage,
        sql: e.sql?.substring(0, 200),
        isQueryTimeout,
        isInterrupted,
        isConnectionKilled,
        isConnectionError,
        isDeadlock,
        isLockContention,
        isNonTransientAuditFailure,
        attempt,
        maxAttempts: MAX_ATTEMPTS_PER_SUBBATCH,
        fileID,
        subBatchID
      });

      // A KILLed bulkingestionprocess call is NEVER replayed automatically.
      //
      // The kill is deliberate by definition — an operator's KILL QUERY, an
      // operator's KILL <id>, or this application's own 660s statement timeout —
      // and the procedure was interrupted mid-transaction with its EXIT HANDLER
      // unfinished. Re-running it verbatim re-does the work that was just judged
      // pathological. During the 2026-07-28 Harvard incident an operator KILL of
      // a 25-minute statement landed here as generic-retryable and simply
      // started the same statement over; the DB-layer timeout kill escaped the
      // same way through the "timed out" substring branch, buying three more
      // attempts of the same 11-minute statement (~33 minutes of churn).
      if (wasKilled) {
        killReason = isQueryTimeout
          ? `statement timed out after ${e.timeoutMs}ms and was KILLed`
          : isConnectionKilled
            ? 'connection was KILLed by an operator'
            : 'statement was KILLed';
        break;
      }
      // Fail fast on a non-transient audit/consistency failure — see the
      // post-loop handling below, which propagates the original error rather
      // than moving staged rows to unresolved coremeasurements.
      if (isNonTransientAuditFailure) break;
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

  // An audit/consistency failure is NOT a data error (#507): every attempt
  // rolled the CALL's data back with its failed audit, so the staged rows
  // are still good and recoverable. Propagate instead of moving them to
  // unresolved coremeasurements, which would misreport a changelog outage as
  // bad data.
  if (!killReason && lastError instanceof ChangelogWriteError) {
    ailogger.error(
      `Sub-batch ${subBatchID} giving up after ${attempt} attempt(s): audit/consistency failure, not a data error — ` +
        `propagating rather than moving staged rows to unresolved coremeasurements (#507)`,
      lastError
    );
    throw lastError;
  }

  // The loop ended for one of two very different reasons, and conflating them
  // has already cost a diagnosis once: a sub-batch abandoned after ONE killed
  // attempt was logged and recorded as "exhausted all 5 attempts".
  const attemptSummary = killReason
    ? `${killReason} on attempt ${attempt} of ${MAX_ATTEMPTS_PER_SUBBATCH}; not retried (a killed procedure call is never replayed)`
    : `all ${MAX_ATTEMPTS_PER_SUBBATCH} attempts failed`;

  ailogger.error(`Sub-batch ${subBatchID} giving up: ${attemptSummary}`);
  const giveUpTransactionID = await connectionManager.beginTransaction();
  let movedRows: number;
  try {
    movedRows = await moveSubBatchToFailedMeasurementsWithAudit(
      connectionManager,
      schema,
      fileID,
      subBatchID,
      `Sub-batch moved after ${attemptSummary}`,
      'sql_exception',
      giveUpTransactionID,
      changedBy,
      plotID,
      censusID
    );
    await connectionManager.commitTransaction(giveUpTransactionID);
  } catch (giveUpError: unknown) {
    try {
      await connectionManager.rollbackTransaction(giveUpTransactionID);
    } catch (rollbackError: unknown) {
      const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      ailogger.error(`Rollback failed while giving up on sub-batch ${subBatchID}: ${rollbackMessage}`);
    }
    // Never report batchFailedButHandled:true when the fallback write or its
    // audit itself failed (#507): that would tell the caller this sub-batch
    // resolved when nothing actually landed. Propagate so ingestBatch's own
    // catch (below) retries the move/audit for this sub-batch rather than
    // silently treating it as done.
    throw giveUpError;
  }
  ailogger.warn(`Moved ${movedRows} rows from sub-batch ${subBatchID} to unresolved coremeasurements (${attemptSummary})`);

  return {
    subBatchID,
    rowCount: movedRows,
    durationMs: 0,
    attemptsNeeded: attempt,
    batchFailedButHandled: true,
    message: `Sub-batch abandoned — ${attemptSummary}; ${movedRows} rows moved to unresolved coremeasurements`
  };
}

export async function ingestBatch(connectionManager: ConnectionManager, params: IngestBatchParams): Promise<IngestBatchResult> {
  const { schema, fileID, batchID } = params;
  const isAborted = params.isAborted ?? (() => false);
  const { plotID: expectedPlotID, censusID: expectedCensusID } = params.expectedScope ?? ({} as IngestBatchParams['expectedScope']);
  if (!Number.isSafeInteger(expectedPlotID) || expectedPlotID <= 0 || !Number.isSafeInteger(expectedCensusID) || expectedCensusID <= 0) {
    throw new TypeError('ingestBatch requires positive integer expectedScope plotID and censusID');
  }
  const setupStarted = process.hrtime.bigint();
  let activeStep: SetupDiagnostic['step'] = 'discovery';
  let lastDiagnostic: Partial<SetupDiagnostic> = {};
  let terminalFrozen = false;
  const emit = (
    fields: Omit<SetupDiagnostic, 'step' | 'schema' | 'plotID' | 'censusID' | 'fileID' | 'batchID' | 'elapsedMs'> & { step?: SetupDiagnostic['step'] } = {}
  ) => {
    if (terminalFrozen || !params.onSetupProgress) return;
    const diagnostic = Object.freeze({
      ...lastDiagnostic,
      schema,
      plotID: expectedPlotID,
      censusID: expectedCensusID,
      fileID,
      batchID,
      elapsedMs: Number(process.hrtime.bigint() - setupStarted) / 1_000_000,
      ...fields,
      step: fields.step ?? activeStep
    }) as Readonly<SetupDiagnostic>;
    lastDiagnostic = diagnostic;
    try {
      const callbackResult: unknown = params.onSetupProgress(diagnostic);
      if (
        callbackResult &&
        (typeof callbackResult === 'object' || typeof callbackResult === 'function') &&
        typeof (callbackResult as { then?: unknown }).then === 'function'
      ) {
        void Promise.resolve(callbackResult).catch(() => {
          /* optional telemetry cannot change ingestion */
        });
      }
    } catch {
      /* optional telemetry cannot change ingestion */
    }
    if (fields.terminal) terminalFrozen = true;
  };
  // A deliberate loss, not a bug: ChangedBy is varchar(64) (see identity.ts).
  const changedBy = params.changedBy ? params.changedBy.slice(0, CHANGED_BY_MAX_LENGTH) : null;

  // --- Phase 1: Setup (lock, discover the family, recovery, cleanup, fallback split) ---
  let setupResult: SetupResult | null;
  try {
    setupResult = await connectionManager.withTransaction<SetupResult | null>(
      async tx => {
        activeStep = 'lock_wait';
        emit({ outcome: 'started' });
        const lockKey = buildIngestionLockName(schema, fileID, expectedPlotID, expectedCensusID);
        if (!(await connectionManager.acquireApplicationLock(lockKey, tx.id, SETUP_PHASE_TIMEOUT_MS))) {
          throw new SetupLockUnavailableError(fileID);
        }

        // One current-read discovery under the lock. Recovery and the unresolved-row
        // cleanup below never delete this family's staged rows, so nothing re-reads it.
        activeStep = 'discovery';
        emit({ outcome: 'started' });
        const family = await discoverBatchFamily((sql, sqlParams) => tx.query(sql, sqlParams), schema, fileID, batchID, { currentRead: true });
        if (!family) return null;
        assertExpectedScope(family, expectedPlotID, expectedCensusID, fileID, batchID);
        const batchSize = getIngestionBatchSize();
        assertMembersWithinBatchSize(family, fileID, batchID, batchSize);
        emit({ outcome: 'completed', rowCount: family.totalRows });

        activeStep = 'recovery';
        emit({ outcome: 'started', rowCount: family.totalRows });
        const recovered = await recoverFailedInitialCensusIfNeeded(
          connectionManager,
          schema,
          fileID,
          batchID,
          expectedPlotID,
          expectedCensusID,
          changedBy,
          tx.id
        );
        emit({ outcome: 'completed', rowCount: family.totalRows });

        activeStep = 'cleanup';
        emit({ outcome: 'started', rowCount: family.totalRows });
        await cleanupMatchedUnresolvedIngestionFailuresForBatch(connectionManager, schema, fileID, batchID, expectedPlotID, expectedCensusID, changedBy, tx.id);
        emit({ outcome: 'completed', rowCount: family.totalRows });

        // Completed members stay in the list: the procedure skips them and deletes
        // their re-staged rows, which a TS-side skip would strand.
        const subBatchIDs = [...family.orphanedSubBatchIDs];
        const originalFitsAsIs = subBatchIDs.length === 0 && family.originalRowCount <= batchSize;
        if (family.originalRowCount > 0 && originalFitsAsIs) {
          subBatchIDs.push(batchID);
        } else if (family.originalRowCount > 0) {
          activeStep = 'splitting';
          emit({ outcome: 'started', rowCount: family.originalRowCount, assignedRows: 0, completedBatches: 0 });
          ailogger.warn(
            `Setup fallback split for ${fileID}-${batchID}: ${family.originalRowCount} row(s) are staged under the original BatchID ` +
              `(legacy client, re-ingestion, or an orphaned remainder); rewriting their BatchID costs about 0.2 ms per row on Azure`
          );
          const splitIDs = await splitOriginalRowsIntoSubBatches(
            connectionManager,
            schema,
            fileID,
            batchID,
            family.originalRowCount,
            { plotID: expectedPlotID, censusID: expectedCensusID },
            tx.id,
            highestSubBatchOrdinal(family.orphanedSubBatchIDs, batchID),
            () => {
              if (isAborted()) throw new IngestBatchAbortedError(fileID, batchID);
            },
            (assignedRows, completedBatches) => emit({ outcome: 'started', rowCount: family.originalRowCount, assignedRows, completedBatches })
          );
          subBatchIDs.push(...splitIDs);
          emit({ outcome: 'completed', rowCount: family.originalRowCount, assignedRows: family.originalRowCount, completedBatches: splitIDs.length });
        }
        if (isAborted()) throw new IngestBatchAbortedError(fileID, batchID);

        activeStep = 'commit';
        emit({ outcome: 'started', rowCount: family.totalRows });
        ailogger.info(
          `Setup complete for ${fileID}: ${family.totalRows} rows → ${subBatchIDs.length} batch(es), plot=${expectedPlotID}, census=${expectedCensusID}`
        );
        return {
          totalRows: family.totalRows,
          subBatchIDs,
          recovered,
          resumedSubBatchCount: family.orphanedSubBatchIDs.length
        };
      },
      { timeoutMs: SETUP_PHASE_TIMEOUT_MS }
    );
    emit({ outcome: 'committed', rowCount: setupResult?.totalRows ?? 0, terminal: true });
  } catch (error: unknown) {
    const setupError = error instanceof TransactionCallbackTimeoutError ? new SetupCallbackTimeoutError(error) : error;
    emit({ outcome: 'failed', errorCode: errorCodeOf(setupError), terminal: true });
    throw setupError;
  }

  if (setupResult === null) {
    ailogger.warn(`No temporary rows found for ${fileID}-${batchID}`);
    return {
      processedSubBatches: 0,
      totalRows: 0,
      recovered: false,
      noDataFound: true,
      totalDurationMs: 0,
      subBatchResults: [],
      resumedSubBatchCount: 0
    };
  }

  // Setup's discovery asserted the family matches the expected scope.
  const plotID = expectedPlotID;
  const censusID = expectedCensusID;
  const { totalRows, subBatchIDs, recovered, resumedSubBatchCount } = setupResult;

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
      const subResult = await processSubBatch(connectionManager, schema, fileID, subBatchID, plotID, censusID, changedBy, isAborted);
      results.push(subResult);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (subError: any) {
      // An audit/consistency failure propagated from processSubBatch (#507)
      // already rolled its CALL's data back with the failed audit, so this
      // and every later sub-batch's rows stay staged for recovery rather
      // than being moved to unresolved coremeasurements. Earlier sub-batches
      // that already committed (their own transactions) are unaffected.
      if (subError instanceof ChangelogWriteError) {
        ailogger.error(
          `Audit-infrastructure failure on sub-batch ${subBatchID}; leaving it and every remaining sub-batch staged for recovery rather than ` +
            `moving them to unresolved coremeasurements: ${subError.message}`,
          subError
        );
        throw subError;
      }

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
      const failureKind: SystemFailureKind = isMidBatchAbort ? 'interrupted_upload' : 'sql_exception';

      // Move all remaining sub-batches in a single transaction so cleanup
      // is atomic — either every remaining sub-batch is moved to failures
      // (with its audit trail) or none are (no orphaned rows left in
      // temporarymeasurements, and no partial audit for data that rolled
      // back). Same bound move+audit helper processSubBatch's give-up path
      // uses above (#507) — a mismatch between moved and audited rows must
      // abort this transaction too, not commit a disagreeing audit trail.
      let cleanupTransactionID: string | undefined;
      try {
        cleanupTransactionID = await connectionManager.beginTransaction();
        for (let j = i; j < subBatchIDs.length; j++) {
          const movedRows = await moveSubBatchToFailedMeasurementsWithAudit(
            connectionManager,
            schema,
            fileID,
            subBatchIDs[j],
            failureReason,
            failureKind,
            cleanupTransactionID,
            changedBy,
            plotID,
            censusID
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
        // Propagate: the rows this loop was supposed to move/audit are still
        // stuck in temporarymeasurements (the rollback undid any partial
        // move+audit), so silently swallowing this and returning a "handled"
        // result would tell the caller the batch finished when the fallback
        // write never actually landed (#507 — the same discipline
        // processSubBatch's give-up path above applies to its own
        // move+audit failure).
        throw moveError;
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
    subBatchResults: results,
    resumedSubBatchCount
  };
}
