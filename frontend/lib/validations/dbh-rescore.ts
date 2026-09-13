/**
 * Atomic, fixed-rule DBH re-score for one census.
 *
 * This deliberately does not use the upload validation orchestrator: the
 * reset, DBH procedure, finalization, derived views, and terminal run row all
 * belong to one connection and one transaction.
 */
import { randomUUID } from 'crypto';
import ConnectionManager, { getTransactionFailureOutcome, type TxExecutor } from '@/lib/db/connectionmanager';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';
import { MANAGER_OVERRIDE_ERROR_CODE } from '@/config/validationoverride';
import { ACTIVE_UPLOAD_SESSION_STATES } from '@/config/uploadsessiontracker';
import { NON_TERMINAL_BACKGROUND_JOB_STATUSES } from '@/lib/background-jobs/types';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { refreshMeasurementViewsForScope } from '@/lib/measurementviewrefresh';
import { completeValidationRunRecordInTransaction, createValidationRunRecordInTransaction } from '@/lib/validations/run-records';
import {
  finalizeValidatedRowsInTransaction,
  prepareDBHValidationDefinitions,
  runSharedDBHChangeValidationsInTransaction
} from '@/lib/validations/dbh-execution';

const DBH_VALIDATION_IDS = [1, 2] as const;

export type DbhRescoreDatabaseOutcome = 'committed' | 'rolled-back' | 'not-started' | 'unknown';
export type DbhRescoreOutcome = 'completed' | 'skipped-locked' | 'deferred-pending' | 'held-valid-to-invalid' | 'failed' | 'artifact-failed';

export interface DbhRescoreScope {
  schema: string;
  plotID: number;
  censusID: number;
}

export interface DbhRescoreArtifactEvent {
  event: 'before' | 'prepared' | 'committed' | 'outcome' | 'reconciled';
  attemptID: string;
  scope: DbhRescoreScope;
  runID?: number;
  provisionalRunID?: number;
  data: Record<string, unknown>;
}

export interface DbhRescoreResult {
  outcome: DbhRescoreOutcome;
  databaseOutcome: DbhRescoreDatabaseOutcome;
  attemptID: string;
  runID?: number;
  provisionalRunID?: number;
  originalConnectionID?: number;
  blockingScope?: { censusID: number; plotID: number; reason: 'running' | 'upload' | 'pending' | 'background-job' };
  counts?: Record<string, number>;
  /** Rows that were valid before the re-score and invalid after it. */
  validToInvalidMeasurementIDs?: number[];
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  errors: string[];
  artifactError?: string;
}

type ScopeRow = { CensusID: number; PlotID: number; PlotCensusNumber: number | null };

export interface DbhRescoreDependencies {
  connectionManager?: Pick<ConnectionManager, 'executeQuery' | 'withTransaction' | 'acquireApplicationLock'>;
  /** A durable writer: failures before commit must abort the transaction. */
  writeArtifact?: (event: DbhRescoreArtifactEvent) => Promise<void>;
  attemptID?: () => string;
  timeoutMs?: number;
  /** Without this, any valid row the re-score would turn invalid rolls the census back for operator review. */
  allowValidToInvalid?: boolean;
  prepareDefinitions?: typeof prepareDBHValidationDefinitions;
  runDbh?: typeof runSharedDBHChangeValidationsInTransaction;
  finalize?: typeof finalizeValidatedRowsInTransaction;
  refreshViews?: typeof refreshMeasurementViewsForScope;
  /** Catalog-side job check supplied by the sweep; count > 0 defers safely. */
  checkBackgroundJobs?: (scope: DbhRescoreScope, tx: TxExecutor) => Promise<number>;
}

export interface DbhRescoreReconciliationDependencies {
  /** Must use a newly acquired connection, never the interrupted tx session. */
  queryFresh: (sql: string, params?: unknown[]) => Promise<unknown>;
  /** Original MySQL thread ID captured inside the transaction before mutation. */
  originalConnectionID?: number;
}

const attemptMarker = (attemptID: string) => `dbh-rescore-attempt:${attemptID}`;

export class DbhRescoreValidToInvalidError extends Error {
  constructor(readonly measurementIDs: number[]) {
    super(`DBH re-score would turn ${measurementIDs.length} valid measurement(s) invalid; review them and rerun with valid-to-invalid changes allowed`);
    this.name = 'DbhRescoreValidToInvalidError';
  }
}

async function countActiveBackgroundJobs(scope: DbhRescoreScope, tx: TxExecutor): Promise<number> {
  const rows = await tx.query<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM catalog.background_jobs
     WHERE SchemaName = ? AND PlotID = ? AND CensusID = ?
       AND Status IN (${NON_TERMINAL_BACKGROUND_JOB_STATUSES.map(() => '?').join(', ')})`,
    [scope.schema, scope.plotID, scope.censusID, ...NON_TERMINAL_BACKGROUND_JOB_STATUSES]
  );
  return asNumber(rows[0]?.count ?? 0);
}

/** A completed atomic run proves commit; absence only proves rollback after session termination. */
export async function reconcileDbhRescoreAttempt(
  scope: DbhRescoreScope,
  attemptID: string,
  deps: DbhRescoreReconciliationDependencies
): Promise<Pick<DbhRescoreResult, 'databaseOutcome' | 'runID' | 'errors'>> {
  validateScopeInput(scope);
  const sql = safeFormatQuery(
    scope.schema,
    `SELECT RunID FROM ??.validation_runs
     WHERE PlotID = ? AND CensusID = ? AND Status = 'completed'
       AND JSON_CONTAINS(ErrorMessages, JSON_QUOTE(?)) = 1
     ORDER BY RunID DESC LIMIT 1`
  );
  const rows = (await deps.queryFresh(sql, [scope.plotID, scope.censusID, attemptMarker(attemptID)])) as Array<{ RunID: number }>;
  const runID = Number(rows[0]?.RunID);
  if (Number.isInteger(runID) && runID > 0) return { databaseOutcome: 'committed', runID, errors: [] };

  if (deps.originalConnectionID === undefined) {
    return { databaseOutcome: 'unknown', errors: ['Original DBH re-score connection ID is unavailable; absence does not prove rollback'] };
  }
  const sessions = (await deps.queryFresh('SELECT COUNT(*) AS sessionCount FROM information_schema.PROCESSLIST WHERE ID = ?', [
    deps.originalConnectionID
  ])) as Array<{ sessionCount: number }>;
  const transactions = (await deps.queryFresh('SELECT COUNT(*) AS transactionCount FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id = ?', [
    deps.originalConnectionID
  ])) as Array<{ transactionCount: number }>;
  const ended = isObservedZeroCount(sessions[0]?.sessionCount) && isObservedZeroCount(transactions[0]?.transactionCount);
  if (!ended) return { databaseOutcome: 'unknown', errors: ['Original DBH re-score session or transaction has not ended; absence does not prove rollback'] };

  // The original session can commit between the first marker read and the
  // disappearance checks above. Re-read after both have ended so that race
  // is reported as committed rather than incorrectly as rolled back.
  const finalRows = (await deps.queryFresh(sql, [scope.plotID, scope.censusID, attemptMarker(attemptID)])) as Array<{ RunID: number }>;
  const finalRunID = Number(finalRows[0]?.RunID);
  if (Number.isInteger(finalRunID) && finalRunID > 0) return { databaseOutcome: 'committed', runID: finalRunID, errors: [] };
  return { databaseOutcome: 'rolled-back', errors: [] };
}

async function reconcileOnFreshConnection(scope: DbhRescoreScope, attemptID: string, originalConnectionID?: number) {
  const pool = await getPoolMonitorInstance().getUsablePool();
  const connection = await pool.getConnection();
  try {
    return await reconcileDbhRescoreAttempt(scope, attemptID, {
      originalConnectionID,
      queryFresh: async (sql, params) => (await connection.query(sql, params))[0]
    });
  } finally {
    connection.release();
  }
}

function asNumber(value: unknown): number {
  return Number(value);
}

/** Reconciliation is conservative: absent/null count data never proves zero. */
function isObservedZeroCount(value: unknown): boolean {
  return value !== null && value !== undefined && Number.isInteger(Number(value)) && Number(value) === 0;
}

function enabled(value: unknown): boolean {
  return Buffer.isBuffer(value) ? value[0] === 1 : Number(value) === 1 || value === true;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateScopeInput(scope: DbhRescoreScope): void {
  if (!scope.schema || !/^[A-Za-z0-9_]+$/.test(scope.schema)) throw new Error('A valid explicit schema is required for DBH re-score');
  if (!Number.isInteger(scope.plotID) || scope.plotID <= 0) throw new Error('A positive plotID is required for DBH re-score');
  if (!Number.isInteger(scope.censusID) || scope.censusID <= 0) throw new Error('A positive censusID is required for DBH re-score');
}

async function loadScope(executor: { query: TxExecutor['query'] }, schema: string, plotID: number, censusID: number, forUpdate = false): Promise<ScopeRow> {
  const sql = safeFormatQuery(
    schema,
    `SELECT CensusID, PlotID, PlotCensusNumber
     FROM ??.census
     WHERE CensusID = ? AND PlotID = ? AND IsActive = 1
     ${forUpdate ? 'FOR UPDATE' : ''}`
  );
  const rows = (await executor.query(sql, [censusID, plotID])) as ScopeRow[];
  if (rows.length !== 1) throw new Error(`Census ${censusID} does not belong to plot ${plotID}`);
  const row = rows[0];
  if (!Number.isInteger(asNumber(row.PlotCensusNumber)) || asNumber(row.PlotCensusNumber) <= 0) {
    throw new Error(`Census ${censusID} has an invalid PlotCensusNumber`);
  }
  return row;
}

async function loadPriorScope(
  executor: { query: TxExecutor['query'] },
  schema: string,
  plotID: number,
  currentNumber: number,
  forUpdate = false
): Promise<ScopeRow | null> {
  if (currentNumber === 1) return null;
  const sql = safeFormatQuery(
    schema,
    `SELECT CensusID, PlotID, PlotCensusNumber
     FROM ??.census
     WHERE PlotID = ? AND PlotCensusNumber = ? AND IsActive = 1
     ${forUpdate ? 'FOR UPDATE' : ''}`
  );
  const rows = (await executor.query(sql, [plotID, currentNumber - 1])) as ScopeRow[];
  if (rows.length > 1) throw new Error(`Plot ${plotID} has ambiguous census number ${currentNumber - 1}`);
  return rows[0] ?? null;
}

async function discoverScope(
  executor: { query: TxExecutor['query'] },
  scope: DbhRescoreScope,
  forUpdate = false
): Promise<{ current: ScopeRow; prior: ScopeRow | null }> {
  const allCensusesSQL = safeFormatQuery(
    scope.schema,
    `SELECT CensusID, PlotID, PlotCensusNumber, IsActive FROM ??.census WHERE PlotID = ? AND IsActive = 1 ${forUpdate ? 'FOR UPDATE' : ''}`
  );
  const allCensuses = (await executor.query(allCensusesSQL, [scope.plotID])) as Array<ScopeRow & { IsActive: unknown }>;
  const numbers = new Set<number>();
  for (const row of allCensuses) {
    const number = asNumber(row.PlotCensusNumber);
    if (!Number.isInteger(number) || number <= 0) throw new Error(`Plot ${scope.plotID} has a NULL or invalid PlotCensusNumber`);
    if (numbers.has(number)) throw new Error(`Plot ${scope.plotID} has duplicate PlotCensusNumber ${number}`);
    numbers.add(number);
  }
  const current = await loadScope(executor, scope.schema, scope.plotID, scope.censusID, forUpdate);
  const currentRow = allCensuses.find(row => asNumber(row.CensusID) === scope.censusID);
  if (!currentRow || !enabled(currentRow.IsActive)) throw new Error(`Census ${scope.censusID} is not active for DBH re-score`);
  const prior = await loadPriorScope(executor, scope.schema, scope.plotID, asNumber(current.PlotCensusNumber), forUpdate);
  const priorRow = prior && allCensuses.find(row => asNumber(row.CensusID) === asNumber(prior.CensusID));
  if (priorRow && !enabled(priorRow.IsActive)) throw new Error(`Immediate prior census ${prior.CensusID} is not active for DBH re-score`);
  return { current, prior };
}

async function assertBothDbhRulesEnabled(executor: { query: TxExecutor['query'] }, schema: string): Promise<void> {
  const sql = safeFormatQuery(schema, 'SELECT ValidationID, IsEnabled FROM ??.sitespecificvalidations WHERE ValidationID IN (?, ?) FOR UPDATE');
  const rows = (await executor.query(sql, [...DBH_VALIDATION_IDS])) as Array<{ ValidationID: number; IsEnabled: unknown }>;
  const found = new Map(rows.map(row => [asNumber(row.ValidationID), enabled(row.IsEnabled)]));
  if (!found.get(1) || !found.get(2) || found.size !== DBH_VALIDATION_IDS.length) {
    throw new Error('Both fixed DBH validations (1 and 2) must be enabled before re-score');
  }
}

async function preflightScope(
  tx: TxExecutor,
  scope: DbhRescoreScope
): Promise<{ reason: 'running' | 'upload' | 'pending' | 'background-job'; count: number } | null> {
  const runningSQL = safeFormatQuery(scope.schema, "SELECT COUNT(*) AS count FROM ??.validation_runs WHERE PlotID = ? AND CensusID = ? AND Status = 'running'");
  const uploadSQL = safeFormatQuery(
    scope.schema,
    `SELECT COUNT(*) AS count FROM ??.upload_sessions
     WHERE plot_id = ? AND census_id = ? AND state IN (${ACTIVE_UPLOAD_SESSION_STATES.map(() => '?').join(', ')})`
  );
  const pendingSQL = safeFormatQuery(
    scope.schema,
    'SELECT COUNT(*) AS count FROM ??.coremeasurements WHERE CensusID = ? AND IsActive = TRUE AND StemGUID IS NOT NULL AND IsValidated IS NULL'
  );
  for (const [reason, sql, params] of [
    ['running', runningSQL, [scope.plotID, scope.censusID]],
    ['upload', uploadSQL, [scope.plotID, scope.censusID, ...ACTIVE_UPLOAD_SESSION_STATES]],
    ['pending', pendingSQL, [scope.censusID]]
  ] as const) {
    const rows = (await tx.query(sql, [...params])) as Array<{ count: number }>;
    const count = asNumber(rows[0]?.count ?? 0);
    if (count > 0) return { reason, count };
  }
  return null;
}

async function countEligiblePending(tx: TxExecutor, scope: DbhRescoreScope): Promise<number> {
  const sql = safeFormatQuery(
    scope.schema,
    'SELECT COUNT(*) AS count FROM ??.coremeasurements WHERE CensusID = ? AND IsActive = TRUE AND StemGUID IS NOT NULL AND IsValidated IS NULL'
  );
  const rows = (await tx.query(sql, [scope.censusID])) as Array<{ count: number }>;
  return asNumber(rows[0]?.count ?? 0);
}

async function captureScopeState(tx: TxExecutor, scope: DbhRescoreScope): Promise<Record<string, unknown>> {
  const validitySQL = safeFormatQuery(
    scope.schema,
    `SELECT
       COALESCE(SUM(IsValidated IS TRUE), 0) AS validCount,
       COALESCE(SUM(IsValidated IS FALSE), 0) AS invalidCount,
       COALESCE(SUM(IsValidated IS NULL), 0) AS pendingCount,
       COUNT(*) AS totalCount
     FROM ??.coremeasurements cm
     JOIN ??.census c ON c.CensusID = cm.CensusID
     WHERE c.PlotID = ? AND cm.CensusID = ? AND cm.IsActive = TRUE AND cm.StemGUID IS NOT NULL`
  );
  const errorSQL = safeFormatQuery(
    scope.schema,
    `SELECT cm.CoreMeasurementID AS MeasurementID, mel.ErrorID, mel.CreatedAt, mel.IsResolved, mel.ResolvedAt,
            mel.PriorCensusID, mel.PriorDBH, mel.PriorHOM
     FROM ??.coremeasurements cm
     JOIN ??.census c ON c.CensusID = cm.CensusID
     JOIN ??.measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
     JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
     WHERE c.PlotID = ? AND cm.CensusID = ? AND me.ErrorSource = 'validation' AND me.ErrorCode IN (?, ?)
     ORDER BY cm.CoreMeasurementID, mel.ErrorID`
  );
  const measurementSQL = safeFormatQuery(
    scope.schema,
    `SELECT cm.CoreMeasurementID AS MeasurementID, cm.IsValidated
     FROM ??.coremeasurements cm JOIN ??.census c ON c.CensusID = cm.CensusID
     WHERE c.PlotID = ? AND cm.CensusID = ? AND cm.IsActive = TRUE AND cm.StemGUID IS NOT NULL
     ORDER BY cm.CoreMeasurementID`
  );
  const [validityRows, errors, measurements] = await Promise.all([
    tx.query(validitySQL, [scope.plotID, scope.censusID]) as Promise<Array<Record<string, unknown>>>,
    tx.query(errorSQL, [scope.plotID, scope.censusID, ...DBH_VALIDATION_IDS]) as Promise<Array<Record<string, unknown>>>,
    tx.query(measurementSQL, [scope.plotID, scope.censusID]) as Promise<Array<Record<string, unknown>>>
  ]);
  return { validity: validityRows[0] ?? {}, measurements, dbhErrors: errors };
}

const MANAGER_OVERRIDE_EXISTS_SQL = `EXISTS (
       SELECT 1 FROM ??.measurement_error_log mel
       JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE mel.MeasurementID = cm.CoreMeasurementID AND me.ErrorSource = 'validation' AND me.ErrorCode = ?)`;

/** Manager-overridden valid rows keep their result; everything else in scope is re-scored. */
async function resetCurrentScope(tx: TxExecutor, scope: DbhRescoreScope): Promise<number> {
  const sql = safeFormatQuery(
    scope.schema,
    `UPDATE ??.coremeasurements cm SET cm.IsValidated = NULL
     WHERE cm.CensusID = ? AND cm.IsActive = TRUE AND cm.StemGUID IS NOT NULL AND cm.IsValidated IS NOT NULL
       AND NOT (cm.IsValidated = TRUE AND ${MANAGER_OVERRIDE_EXISTS_SQL})`
  );
  const result = (await tx.query(sql, [scope.censusID, MANAGER_OVERRIDE_ERROR_CODE])) as { affectedRows?: number };
  return asNumber(result.affectedRows ?? 0);
}

async function countPreservedOverrides(tx: TxExecutor, scope: DbhRescoreScope): Promise<number> {
  const sql = safeFormatQuery(
    scope.schema,
    `SELECT COUNT(*) AS count FROM ??.coremeasurements cm
     WHERE cm.CensusID = ? AND cm.IsActive = TRUE AND cm.StemGUID IS NOT NULL AND cm.IsValidated = TRUE AND ${MANAGER_OVERRIDE_EXISTS_SQL}`
  );
  const rows = (await tx.query(sql, [scope.censusID, MANAGER_OVERRIDE_ERROR_CODE])) as Array<{ count: number }>;
  return asNumber(rows[0]?.count ?? 0);
}

function validityOf(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return enabled(value);
}

function findValidToInvalidMeasurementIDs(before: Record<string, unknown>, after: Record<string, unknown>): number[] {
  const afterValidity = new Map((after.measurements as Array<Record<string, unknown>>).map(row => [asNumber(row.MeasurementID), validityOf(row.IsValidated)]));
  return (before.measurements as Array<Record<string, unknown>>)
    .filter(row => validityOf(row.IsValidated) === true && afterValidity.get(asNumber(row.MeasurementID)) === false)
    .map(row => asNumber(row.MeasurementID));
}

/**
 * Re-score only fixed DBH validation IDs 1 and 2.  `before` and `prepared`
 * artifacts are deliberately written while the database transaction remains
 * open; an artifact failure aborts the transaction before any commit.
 */
export async function rescoreDbhCensus(scope: DbhRescoreScope, deps: DbhRescoreDependencies = {}): Promise<DbhRescoreResult> {
  validateScopeInput(scope);
  const connectionManager = deps.connectionManager ?? ConnectionManager.getInstance();
  if (!deps.writeArtifact) {
    return {
      outcome: 'failed',
      databaseOutcome: 'not-started',
      attemptID: deps.attemptID?.() ?? randomUUID(),
      errors: ['A durable DBH re-score artifact writer is required']
    };
  }
  const writeArtifact = deps.writeArtifact;
  const attemptID = deps.attemptID?.() ?? randomUUID();
  const prepareDefinitions = deps.prepareDefinitions ?? prepareDBHValidationDefinitions;
  const runDbh = deps.runDbh ?? runSharedDBHChangeValidationsInTransaction;
  const finalize = deps.finalize ?? finalizeValidatedRowsInTransaction;
  const refreshViews = deps.refreshViews ?? refreshMeasurementViewsForScope;
  const checkBackgroundJobs = deps.checkBackgroundJobs ?? countActiveBackgroundJobs;

  let provisionalRunID: number | undefined;
  let preparedResult: Omit<DbhRescoreResult, 'databaseOutcome' | 'outcome' | 'errors'> | undefined;
  let callbackFinished = false;
  let transactionEntered = false;
  let originalConnectionID: number | undefined;
  let beforeState: Record<string, unknown> | undefined;

  try {
    // Required definitions are catalog preparation, never measurement mutation.
    await assertBothDbhRulesEnabled({ query: connectionManager.executeQuery.bind(connectionManager) }, scope.schema);
    await prepareDefinitions(connectionManager as ConnectionManager, scope.schema);

    const discovered = await discoverScope({ query: connectionManager.executeQuery.bind(connectionManager) }, scope);

    const result = await connectionManager.withTransaction(
      async tx => {
        transactionEntered = true;
        // The preflight identity only supplies lock names. It intentionally
        // does not acquire row locks before the advisory locks.
        const current = discovered.current;
        const prior = discovered.prior;
        const lockScopes = [current, ...(prior ? [prior] : [])].sort((a, b) => asNumber(a.CensusID) - asNumber(b.CensusID));
        for (const lockScope of lockScopes) {
          const acquired = await connectionManager.acquireApplicationLock(
            buildMeasurementScopeLockName(scope.schema, scope.plotID, asNumber(lockScope.CensusID)),
            tx.id,
            MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS
          );
          if (!acquired) {
            return {
              outcome: 'skipped-locked' as const,
              databaseOutcome: 'not-started' as const,
              attemptID,
              blockingScope: { censusID: asNumber(lockScope.CensusID), plotID: scope.plotID, reason: 'running' as const },
              errors: []
            };
          }
        }

        const sessions = await tx.query<Array<{ connectionID: number }>>('SELECT CONNECTION_ID() AS connectionID');
        originalConnectionID = Number(sessions[0]?.connectionID);
        if (!Number.isSafeInteger(originalConnectionID)) throw new Error('Unable to identify DBH transaction session');

        // Acquire locks before re-reading anything that controls mutation.
        const locked = await discoverScope(tx, scope, true);
        const lockedCurrent = locked.current;
        const lockedPrior = locked.prior;
        if (
          asNumber(lockedCurrent.PlotCensusNumber) !== asNumber(discovered.current.PlotCensusNumber) ||
          asNumber(lockedPrior?.CensusID ?? 0) !== asNumber(discovered.prior?.CensusID ?? 0)
        ) {
          throw new Error('DBH re-score census ordering changed while acquiring scope locks');
        }
        await assertBothDbhRulesEnabled(tx, scope.schema);
        for (const census of [lockedCurrent, ...(lockedPrior ? [lockedPrior] : [])]) {
          const blocking = await preflightScope(tx, { ...scope, censusID: asNumber(census.CensusID) });
          if (blocking) {
            return {
              outcome: 'deferred-pending' as const,
              databaseOutcome: 'not-started' as const,
              attemptID,
              blockingScope: { censusID: asNumber(census.CensusID), plotID: scope.plotID, reason: blocking.reason },
              counts: { blockingCount: blocking.count },
              errors: []
            };
          }
        }
        for (const census of [lockedCurrent, ...(lockedPrior ? [lockedPrior] : [])]) {
          const jobScope = { ...scope, censusID: asNumber(census.CensusID) };
          const jobCount = await checkBackgroundJobs(jobScope, tx);
          if (jobCount > 0) {
            return {
              outcome: 'deferred-pending' as const,
              databaseOutcome: 'not-started' as const,
              attemptID,
              blockingScope: { censusID: jobScope.censusID, plotID: scope.plotID, reason: 'background-job' as const },
              counts: { blockingJobCount: jobCount },
              errors: ['Catalog background work is active for this DBH re-score scope']
            };
          }
        }

        provisionalRunID = await createValidationRunRecordInTransaction(tx, scope.schema, scope.plotID, scope.censusID, DBH_VALIDATION_IDS.length);
        const before = await captureScopeState(tx, scope);
        beforeState = before;
        await writeArtifact({ event: 'before', attemptID, scope, provisionalRunID, data: { ...before, originalConnectionID } });

        const preservedOverrideCount = await countPreservedOverrides(tx, scope);
        const resetCount = await resetCurrentScope(tx, scope);
        const execution = await runDbh({
          schema: scope.schema,
          tx,
          params: { p_CensusID: scope.censusID, p_PlotID: scope.plotID },
          requireActiveStemGUID: true
        });
        if (!execution.ranGrowth || !execution.ranShrinkage) throw new Error('Both fixed DBH validations must execute during re-score');
        const finalizedCount = await finalize({
          schema: scope.schema,
          tx,
          params: { p_CensusID: scope.censusID, p_PlotID: scope.plotID },
          requireActiveStemGUID: true
        });
        const remainingPending = await countEligiblePending(tx, scope);
        if (remainingPending > 0) throw new Error(`DBH re-score left ${remainingPending} eligible pending measurement(s)`);
        await refreshViews(connectionManager as ConnectionManager, scope.schema, scope.plotID, scope.censusID, tx.id);
        const after = await captureScopeState(tx, scope);
        const validToInvalidMeasurementIDs = findValidToInvalidMeasurementIDs(before, after);
        const counts = {
          resetCount,
          finalizedCount,
          preservedOverrideCount,
          validToInvalidCount: validToInvalidMeasurementIDs.length,
          ...(execution.skipCounts ?? {})
        };
        if (resetCount !== finalizedCount) {
          throw new Error(`DBH re-score reset/finalized mismatch (${resetCount} reset, ${finalizedCount} finalized)`);
        }
        if (validToInvalidMeasurementIDs.length > 0 && !deps.allowValidToInvalid) throw new DbhRescoreValidToInvalidError(validToInvalidMeasurementIDs);
        await writeArtifact({
          event: 'prepared',
          attemptID,
          scope,
          provisionalRunID,
          data: { before, after, counts, validToInvalidMeasurementIDs, originalConnectionID }
        });
        await completeValidationRunRecordInTransaction(tx, scope.schema, provisionalRunID, {
          completedSteps: DBH_VALIDATION_IDS.length,
          failedSteps: 0,
          errorMessages: [attemptMarker(attemptID)]
        });
        const prepared: DbhRescoreResult = {
          outcome: 'completed',
          databaseOutcome: 'committed',
          attemptID,
          runID: provisionalRunID,
          originalConnectionID,
          counts,
          validToInvalidMeasurementIDs,
          before,
          after,
          errors: []
        };
        preparedResult = prepared;
        callbackFinished = true;
        return prepared;
      },
      { timeoutMs: deps.timeoutMs }
    );

    if (result.outcome !== 'completed') return result;
    try {
      await writeArtifact({ event: 'committed', attemptID, scope, runID: result.runID, data: { counts: result.counts ?? {}, after: result.after ?? {} } });
      return result;
    } catch (artifactError) {
      return { ...result, outcome: 'artifact-failed', artifactError: errorText(artifactError), errors: [errorText(artifactError)] };
    }
  } catch (error) {
    const failure = getTransactionFailureOutcome(error);
    let databaseOutcome: DbhRescoreDatabaseOutcome = failure?.databaseOutcome ?? (transactionEntered ? 'unknown' : 'not-started');
    originalConnectionID ??= failure?.connectionID;
    let runID: number | undefined;
    const errors = [errorText(error)];
    if (databaseOutcome === 'unknown' && originalConnectionID !== undefined) {
      try {
        const reconciled = await reconcileOnFreshConnection(scope, attemptID, originalConnectionID);
        databaseOutcome = reconciled.databaseOutcome;
        runID = reconciled.runID;
        errors.push(...reconciled.errors);
      } catch (reconciliationError) {
        errors.push(`Reconciliation unavailable: ${errorText(reconciliationError)}`);
      }
    }
    // A reconciled commit remains a failed operator attempt until its required
    // outcome artifact is repaired and downstream work is explicitly resumed.
    const heldValidToInvalid = error instanceof DbhRescoreValidToInvalidError && databaseOutcome === 'rolled-back';
    const result: DbhRescoreResult = {
      outcome: heldValidToInvalid ? 'held-valid-to-invalid' : 'failed',
      databaseOutcome,
      ...(error instanceof DbhRescoreValidToInvalidError ? { validToInvalidMeasurementIDs: error.measurementIDs } : {}),
      attemptID,
      errors,
      ...(runID ? { runID } : {}),
      ...(provisionalRunID ? { provisionalRunID } : {}),
      ...(originalConnectionID ? { originalConnectionID } : {}),
      ...(beforeState ? { before: beforeState } : {}),
      ...(preparedResult ? { counts: preparedResult.counts, after: preparedResult.after } : {})
    };
    try {
      await writeArtifact({
        event: callbackFinished ? 'reconciled' : 'outcome',
        attemptID,
        scope,
        ...(runID ? { runID } : {}),
        ...(provisionalRunID ? { provisionalRunID } : {}),
        data: { ...result }
      });
    } catch (artifactError) {
      result.outcome = 'artifact-failed';
      result.artifactError = errorText(artifactError);
      result.errors.push(`Outcome artifact failed: ${result.artifactError}`);
    }
    return result;
  }
}
