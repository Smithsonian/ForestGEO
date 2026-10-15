// connectionmanager.ts
import '@/lib/connectionlogger';
import { PoolConnection } from 'mysql2/promise';
import chalk from 'chalk';
import { getConn, killQueryOnThread, QueryTimeoutError, runQuery } from '@/lib/db/primitives';
import { v4 as uuidv4 } from 'uuid';
import { patchConnectionManager, flushTransactionChangelog, discardTransactionChangelog } from '@/lib/connectionlogger';
import ailogger from '@/ailogger';

/**
 * MySQL error interface for type-safe error handling
 */
interface MySQLError extends Error {
  code?: string;
  errno?: number;
  sqlState?: string;
  sqlMessage?: string;
}

/**
 * Scoped query executor handed to `ConnectionManager.withTransaction` callbacks.
 *
 * `query` runs a statement on the transaction's dedicated connection — callers
 * no longer need to thread the raw transaction-id string into every
 * `executeQuery` call. New code should use `tx.query(...)`.
 */
export interface TxExecutor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(sql: string, params?: unknown[]): Promise<T>;
  /**
   * Migration bridge ONLY: pass to acquireApplicationLock / legacy string-id
   * helpers not yet migrated to accept a TxExecutor. New code should use
   * tx.query, not tx.id.
   */
  readonly id: string;
}

export class TransactionCallbackTimeoutError extends Error {
  readonly code = 'TRANSACTION_CALLBACK_TIMEOUT';
  readonly timeoutMs: number;
  readonly transactionId: string;
  constructor(transactionId: string, timeoutMs: number) {
    super(`Transaction ${transactionId} timed out after ${timeoutMs}ms`);
    this.name = 'TransactionCallbackTimeoutError';
    this.transactionId = transactionId;
    this.timeoutMs = timeoutMs;
  }
}

export class TransactionCommitOutcomeUnknownError extends Error {
  readonly code = 'TRANSACTION_COMMIT_OUTCOME_UNKNOWN';
  readonly cause: unknown;
  constructor(cause: unknown) {
    super(`Transaction COMMIT acknowledgement was not received: ${getErrorMessage(cause)}`);
    this.name = 'TransactionCommitOutcomeUnknownError';
    this.cause = cause;
  }
}

export class TransactionCommitCleanupError extends Error {
  readonly code = 'TRANSACTION_COMMITTED_CLEANUP_FAILED';
  readonly committed = true;
  readonly cause: unknown;
  constructor(cause: unknown) {
    super(`Transaction committed, but post-commit cleanup failed: ${getErrorMessage(cause)}`);
    this.name = 'TransactionCommitCleanupError';
    this.cause = cause;
  }
}

export class TransactionRollbackCleanupError extends Error {
  readonly rollbackAcknowledged = true;
  readonly cause: unknown;
  constructor(cause: unknown) {
    super(`Transaction rollback was acknowledged, but connection cleanup failed: ${getErrorMessage(cause)}`);
    this.name = 'TransactionRollbackCleanupError';
    this.cause = cause;
  }
}

export type TransactionOutcome = 'committed' | 'rolled_back' | 'commit_outcome_unknown' | 'commit_acknowledged_cleanup_failed' | 'failed';
export interface TransactionLifecycleEvent {
  readonly type:
    | 'callback_started'
    | 'callback_succeeded'
    | 'callback_failed'
    | 'commit_started'
    | 'commit_acknowledged'
    | 'commit_outcome_unknown'
    | 'rollback_started'
    | 'rollback_acknowledged'
    | 'cleanup_finished'
    | 'transaction_finished';
  readonly elapsedMs: number;
  readonly callbackDurationMs?: number;
  readonly commitDurationMs?: number;
  readonly cleanupDurationMs?: number;
  readonly totalDurationMs?: number;
  readonly outcome?: TransactionOutcome;
}
export interface WithTransactionOptions {
  timeoutMs?: number;
  lifecycleObserver?: (event: TransactionLifecycleEvent) => void;
}

function monotonicNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Number(process.hrtime.bigint()) / 1_000_000;
}

interface QueryTimingDetails {
  schema: string | null;
  transactionId?: string;
  acquireMs: number;
  schemaUseMs: number;
  queryMs: number;
  totalMs: number;
  failed: boolean;
  queryPreview: string;
}

/**
 * Extracts schema name from a query containing fully-qualified table names
 * Matches patterns like: schema.tablename, `schema`.`tablename`, schema.tablename AS alias
 * Returns the first schema found, or null if none
 */
function extractSchemaFromQuery(query: string): string | null {
  // Match patterns like: FROM schema.table, JOIN schema.table, INTO schema.table,
  // UPDATE schema.table, CALL schema.procedure
  // Also handles backtick-quoted identifiers
  const schemaPatterns = [
    /(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+`?(\w+)`?\.\w+/i,
    /(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+`?(\w+)`?\.`?\w+`?/i,
    /CALL\s+`?(\w+)`?\.`?\w+`?/i
  ];

  for (const pattern of schemaPatterns) {
    const match = query.match(pattern);
    if (match && match[1]) {
      // Validate that it looks like a ForestGEO schema name
      const schema = match[1];
      if (schema.startsWith('forestgeo_') || schema.includes('_')) {
        return schema;
      }
    }
  }
  return null;
}

/**
 * Type for accessing PoolConnection with threadId property (internal mysql2 property)
 */
type PoolConnectionWithThreadId = PoolConnection & { threadId?: number };

/**
 * Tracks the most recently `USE`d schema per pool connection. mysql2 reuses
 * PoolConnection wrappers, and the underlying MySQL session retains its
 * current database between acquisitions, so we can skip the per-query
 * `USE \`schema\`` round-trip when the connection is already on that schema.
 *
 * WeakMap so a destroyed PoolConnection drops its entry without leaking.
 * If a `USE` ever fails, the entry is cleared so the next query will retry.
 */
const connectionSchemaCache = new WeakMap<PoolConnection, string>();

/**
 * Helper to safely extract error message from unknown type
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// Observable map for debugging transaction connections
class ObservableMap<K, V> extends Map<K, V> {
  override set(key: K, value: V): this {
    super.set(key, value);
    const conn = value as PoolConnectionWithThreadId;
    ailogger.info(`[transactionConnections] set ${key} → ${conn.threadId}`);
    this.logContents();
    return this;
  }

  override delete(key: K): boolean {
    const deleted = super.delete(key);
    ailogger.info(`[transactionConnections] delete ${key}`);
    this.logContents();
    return deleted;
  }

  private logContents() {
    ailogger.info(
      '[transactionConnections] current:',
      Array.from(this.entries()).map(([id, conn]) => ({ id, threadId: (conn as PoolConnectionWithThreadId).threadId }))
    );
  }
}

class ConnectionManager {
  private static instance: ConnectionManager | null = null; // Singleton instance
  private transactionConnections = new ObservableMap<string, PoolConnection>(); // Store transaction-specific connections
  private transactionMeta = new Map<
    string,
    { startedAt: number; timeoutHandle: NodeJS.Timeout | null; keepAliveHandle: NodeJS.Timeout | null; resourceLocks: Set<string> }
  >();
  private readonly DEFAULT_TX_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
  private readonly MAX_CONCURRENT_TRANSACTIONS = 12; // Reduced to prevent overwhelming connection pool
  // Removed in-memory applicationLocks Map - now using MySQL GET_LOCK/RELEASE_LOCK for distributed locking
  private readonly LOCK_TIMEOUT_MS = 2 * 60 * 1000; // Reduced from 5 to 2 minutes for application locks
  private transactionSlotQueue: Array<() => void> = []; // Queue for waiting transactions
  private startingTransactions = 0; // Reserved slots for transactions between queue wake-up and BEGIN registration

  // Private constructor
  private constructor() {
    // console.log(chalk.green('ConnectionManager initialized as a singleton.'));
  }

  // Singleton instance getter
  public static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  // Execute a query using the acquired connection
  // Note: Return type is any[] to maintain backward compatibility with numerous callers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async executeQuery(query: string, params?: unknown[], transactionId?: string): Promise<any> {
    const startedAt = Date.now();
    const acquireStartedAt = Date.now();
    const connection = transactionId ? this.transactionConnections.get(transactionId) : await this.acquireConnectionInternal();
    const acquireMs = transactionId ? 0 : Date.now() - acquireStartedAt;

    if (!connection) {
      throw new Error(transactionId ? `No connection found for transaction: ${transactionId}` : 'Unable to acquire connection.');
    }

    const schema = extractSchemaFromQuery(query);
    let schemaUseMs = 0;
    let queryMs = 0;
    let failed = false;

    try {
      // Extract schema from query and ensure database context is set
      // This prevents "No database selected" errors when connections are acquired
      // from a pool that may have been reinitialized without proper database context
      //
      // NOTE: We use connection.query('USE ...') instead of connection.changeUser()
      // because changeUser has a known mysql2 bug where it affects the entire pool
      // configuration, not just the current connection. See:
      // https://github.com/sidorares/node-mysql2/issues/477
      // https://github.com/sidorares/node-mysql2/issues/1469
      if (schema && connectionSchemaCache.get(connection) !== schema) {
        try {
          const schemaUseStartedAt = Date.now();
          // Use simple query protocol (not prepared statements) to switch database
          await connection.query(`USE \`${schema}\``);
          schemaUseMs = Date.now() - schemaUseStartedAt;
          connectionSchemaCache.set(connection, schema);
        } catch (useError: unknown) {
          // Log but don't fail - the query may still work with fully-qualified names
          ailogger.warn(chalk.yellow(`Could not set database context to ${schema}: ${getErrorMessage(useError)}`));
          connectionSchemaCache.delete(connection);
        }
      }

      const queryStartedAt = Date.now();
      const result = await runQuery(connection, query, params);
      queryMs = Date.now() - queryStartedAt;
      return result;
    } catch (error: unknown) {
      failed = true;
      queryMs = queryMs || Date.now() - startedAt - acquireMs - schemaUseMs;
      const errMsg = error instanceof Error ? error.message : String(error);
      ailogger.error(chalk.red(`Error executing query: ${errMsg}`));
      if (transactionId && error instanceof QueryTimeoutError) {
        // runQuery destroyed this connection, so it cannot be reused. Server
        // settlement is not inferred from socket destruction. Finalize local
        // bookkeeping so a later rollback cannot replace the original timeout.
        this.finalizeTransactionAfterConnectionLoss(transactionId, `statement timed out after ${error.timeoutMs}ms`);
      }
      throw error;
    } finally {
      this.logQueryTiming({
        schema,
        transactionId,
        acquireMs,
        schemaUseMs,
        queryMs,
        totalMs: Date.now() - startedAt,
        failed,
        queryPreview: this.queryPreview(query)
      });
      if (!transactionId) {
        connection.release(); // Release if not part of a transaction
      }
    }
  }

  // Begin a transaction with enhanced deadlock handling.
  //
  // Slot authority: beginTransaction is the SINGLE owner of transaction-slot
  // reservation. It reserves one slot up front via acquireTransactionSlot()
  // (which enforces MAX_CONCURRENT_TRANSACTIONS and may wait up to 60s or
  // throw), then hands that reservation off to the transactionConnections map
  // entry via consumeTransactionStartSlot() once BEGIN succeeds. On any failure
  // path that never registered a map entry, the reserved slot is returned via
  // releaseTransactionStartSlot() so a queued waiter is woken. This means EVERY
  // path into an open transaction — withTransaction AND the ~20 direct callers —
  // is gated by the same cap.
  public async beginTransaction(): Promise<string> {
    const startTime = Date.now();
    const transactionId = uuidv4();
    let connection: PoolConnection | null = null;
    let retryDelay = 100; // Start with 100ms delay
    let slotHandedOff = false;

    // Reserve the slot BEFORE the try/finally: if this throws (60s slot-wait
    // timeout), startingTransactions was never incremented, so there is nothing
    // to release and the finally below must not run.
    await this.acquireTransactionSlot();

    try {
      while (Date.now() - startTime < 30000) {
        // Increased timeout to 30 seconds
        try {
          connection = await this.acquireConnectionInternal();

          // Set transaction isolation level to reduce deadlock probability
          await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');

          await connection.beginTransaction();
          this.transactionConnections.set(transactionId, connection);
          // Hand the reserved slot off from the starting-counter to the map
          // entry: net occupancy stays +1, now held by transactionConnections.
          this.consumeTransactionStartSlot();
          slotHandedOff = true;

          // Initialize transaction metadata with resource locks tracking
          const meta = {
            startedAt: Date.now(),
            timeoutHandle: null as NodeJS.Timeout | null,
            keepAliveHandle: null as NodeJS.Timeout | null,
            resourceLocks: new Set<string>()
          };
          this.transactionMeta.set(transactionId, meta);

          ailogger.info(chalk.green(`Transaction started: ${transactionId} (thread: ${(connection as PoolConnectionWithThreadId).threadId})`));
          return transactionId;
        } catch (error: unknown) {
          connection?.release();
          if (!this.isDeadlockError(error) && !this.isLockTimeoutError(error)) {
            const errorObj = error instanceof Error ? error : new Error(getErrorMessage(error));
            ailogger.error(chalk.red(`Error starting transaction: ${getErrorMessage(error)}`), errorObj);
            throw error;
          }

          // Exponential backoff with jitter for deadlock/timeout retries
          const jitter = Math.random() * 500; // Up to 500ms jitter
          retryDelay = Math.min(retryDelay * 1.5, 5000); // Cap at 5 seconds
          const totalDelay = retryDelay + jitter;

          ailogger.warn(
            chalk.yellow(
              `${getErrorMessage(error)} encountered, retrying after ${totalDelay.toFixed(0)}ms... (thread: ${(connection as PoolConnectionWithThreadId)?.threadId || 'unknown'})`
            )
          );
          await new Promise(resolve => setTimeout(resolve, totalDelay));
        }
      }
      throw new Error('Failed to start transaction after 30 seconds due to persistent deadlock/timeout issues.');
    } catch (e: unknown) {
      const errorObj = e instanceof Error ? e : new Error(getErrorMessage(e));
      ailogger.error(chalk.red(`Error starting transaction: ${getErrorMessage(e)}`), errorObj);
      throw e;
    } finally {
      // If BEGIN never registered a map entry, the reserved slot is still held
      // by the starting-counter — return it (and wake a queued waiter) so it is
      // not leaked. On success the slot lives on in the map entry and is
      // released later by commit/rollback.
      if (!slotHandedOff) {
        this.releaseTransactionStartSlot();
      }
    }
  }

  // Commit a transaction
  public async commitTransaction(
    transactionId: string,
    timing?: (event: 'acknowledged' | 'outcome_unknown' | 'cleanup_finished', elapsedMs: number) => void
  ): Promise<void> {
    const connection = this.transactionConnections.get(transactionId);

    if (!connection) {
      if (timing) throw new Error(`Connection lost before COMMIT for transaction ${transactionId}`);
      ailogger.warn(`Transaction with ID ${transactionId} does not exist or has already been finalized.`);
      // Clean up metadata even if connection is gone
      const meta = this.transactionMeta.get(transactionId);
      if (meta) {
        if (meta.timeoutHandle) clearTimeout(meta.timeoutHandle);
        if (meta.keepAliveHandle) clearInterval(meta.keepAliveHandle);
        this.transactionMeta.delete(transactionId);
      }
      return; // Avoid throwing an error for an already finalized transaction
    }

    const commitStartedAt = monotonicNow();
    let acknowledged = false;
    let commitError: unknown;
    let cleanupError: unknown;
    try {
      await connection.commit();
      acknowledged = true;
      timing?.('acknowledged', monotonicNow() - commitStartedAt);
      ailogger.info(chalk.green(`Transaction committed: ${transactionId} (thread: ${(connection as PoolConnectionWithThreadId).threadId})`));

      // Flush buffered changelog entries now that the transaction is committed
      flushTransactionChangelog(transactionId);
    } catch (error: unknown) {
      commitError = error;
      const errorObj = error instanceof Error ? error : new Error(getErrorMessage(error));
      ailogger.error(chalk.red(`Error committing transaction: ${getErrorMessage(error)}`), errorObj);

      // Discard changelog entries if commit itself failed
      discardTransactionChangelog(transactionId);
      if (acknowledged) cleanupError = error;
    }
    if (!acknowledged) {
      // A rejected COMMIT command does not establish whether the server committed.
      // Quarantine before any release path; never issue ROLLBACK on this session.
      const commitDurationMs = monotonicNow() - commitStartedAt;
      timing?.('outcome_unknown', commitDurationMs);
      const cleanupStartedAt = monotonicNow();
      this.discardTransaction(transactionId, 'COMMIT acknowledgement lost; server outcome unknown');
      timing?.('cleanup_finished', monotonicNow() - cleanupStartedAt);
      throw new TransactionCommitOutcomeUnknownError(commitError);
    }

    const cleanupStartedAt = monotonicNow();
    try {
      // Clean up application locks before releasing connection
      await this.cleanupApplicationLocks(transactionId);
    } catch (error: unknown) {
      cleanupError ??= error;
    }
    if (cleanupError !== undefined) {
      this.discardTransaction(transactionId, 'acknowledged COMMIT cleanup failed');
    } else {
      try {
        connection.release();
        this.transactionConnections.delete(transactionId);
        this.releaseTransactionSlot();
      } catch (error: unknown) {
        cleanupError = error;
        this.discardTransaction(transactionId, 'connection release failed after acknowledged COMMIT');
      }
    }

    // CRITICAL FIX: Clean up metadata to prevent leaks
    const meta = this.transactionMeta.get(transactionId);
    if (meta) {
      if (meta.timeoutHandle) clearTimeout(meta.timeoutHandle);
      if (meta.keepAliveHandle) clearInterval(meta.keepAliveHandle);
      this.transactionMeta.delete(transactionId);
    }
    timing?.('cleanup_finished', monotonicNow() - cleanupStartedAt);
    if (cleanupError !== undefined) throw new TransactionCommitCleanupError(cleanupError);
  }

  // Rollback a transaction
  public async rollbackTransaction(transactionId: string): Promise<void> {
    await this.rollbackTransactionWithOutcome(transactionId);
  }

  private async rollbackTransactionWithOutcome(transactionId: string): Promise<boolean> {
    const connection = this.transactionConnections.get(transactionId);

    if (!connection) {
      ailogger.warn(`Transaction with ID ${transactionId} does not exist or has already been finalized.`);
      // Clean up metadata even if connection is gone
      const meta = this.transactionMeta.get(transactionId);
      if (meta) {
        if (meta.timeoutHandle) clearTimeout(meta.timeoutHandle);
        if (meta.keepAliveHandle) clearInterval(meta.keepAliveHandle);
        this.transactionMeta.delete(transactionId);
      }
      return false; // No server acknowledgement was observed.
    }

    let rollbackAcknowledged = false;
    let rollbackFailed = false;
    let rollbackError: unknown;
    let cleanupFailed = false;
    let cleanupError: unknown;
    try {
      await connection.rollback();
      rollbackAcknowledged = true;
      ailogger.warn(chalk.yellow(`Transaction rolled back: ${transactionId} (thread: ${(connection as PoolConnectionWithThreadId).threadId})`));
    } catch (error: unknown) {
      rollbackFailed = true;
      rollbackError = error;
      const errorObj = error instanceof Error ? error : new Error(getErrorMessage(error));
      ailogger.error(chalk.red(`Error rolling back transaction: ${getErrorMessage(error)}`), errorObj);
    }

    if (this.transactionConnections.has(transactionId)) discardTransactionChangelog(transactionId);
    try {
      if (this.transactionConnections.has(transactionId)) await this.cleanupApplicationLocks(transactionId);
    } catch (error: unknown) {
      cleanupFailed = true;
      cleanupError = error;
    }

    if (rollbackFailed || cleanupFailed) {
      this.discardTransaction(transactionId, rollbackError !== undefined ? 'ROLLBACK failed' : 'rollback lock cleanup failed');
    } else if (this.transactionConnections.has(transactionId)) {
      try {
        connection.release();
        this.transactionConnections.delete(transactionId);
        this.releaseTransactionSlot();
      } catch (error: unknown) {
        cleanupFailed = true;
        cleanupError = error;
        this.discardTransaction(transactionId, 'connection release failed after acknowledged ROLLBACK');
      }
    }

    const meta = this.transactionMeta.get(transactionId);
    if (meta) {
      if (meta.timeoutHandle) clearTimeout(meta.timeoutHandle);
      if (meta.keepAliveHandle) clearInterval(meta.keepAliveHandle);
      this.transactionMeta.delete(transactionId);
    }

    if (rollbackFailed) throw rollbackError;
    if (cleanupFailed) {
      if (rollbackAcknowledged) throw new TransactionRollbackCleanupError(cleanupError);
      throw cleanupError;
    }
    return rollbackAcknowledged;
  }

  /**
   * Finalize local bookkeeping for a transaction whose connection is already
   * gone. Socket destruction prevents connection reuse but does not establish
   * whether the server-side statement or transaction has settled:
   *
   *   - drop the map entry and metadata (clearing its timers),
   *   - discard buffered changelog entries that can no longer be safely
   *     associated with a confirmed transaction outcome,
   *   - release the transaction slot so a queued waiter is woken.
   *
   * Runs exactly once per transaction: the map entry is the guard, and every
   * other exit path (commit/rollback) deletes it too. Callers that later invoke
   * rollbackTransaction land on its "already finalized" no-op branch.
   *
   * Application locks are NOT released here: they are session-scoped MySQL
   * GET_LOCKs. Their server-side status is unknown when the session is lost.
   */
  private finalizeTransactionAfterConnectionLoss(transactionId: string, reason: string): void {
    if (!this.transactionConnections.has(transactionId)) return;

    ailogger.warn(
      chalk.yellow(
        `Transaction ${transactionId} bookkeeping finalized without ROLLBACK — its connection was destroyed (${reason}). Server-side settlement is not inferred.`
      )
    );

    this.transactionConnections.delete(transactionId);
    discardTransactionChangelog(transactionId);

    const meta = this.transactionMeta.get(transactionId);
    if (meta) {
      if (meta.timeoutHandle) clearTimeout(meta.timeoutHandle);
      if (meta.keepAliveHandle) clearInterval(meta.keepAliveHandle);
      this.transactionMeta.delete(transactionId);
    }

    this.releaseTransactionSlot();
  }

  /**
   * Destroy a transaction's connection whose session state can no longer be
   * trusted, so it never returns to the pool. Socket destruction does not prove
   * server-side settlement; bookkeeping settles through
   * {@link finalizeTransactionAfterConnectionLoss}, so a later commit/rollback
   * is a no-op. Never throws, so it cannot mask the caller's own error.
   */
  public discardTransaction(transactionId: string, reason: string): void {
    const connection = this.transactionConnections.get(transactionId);
    if (!connection) return;

    try {
      connection.destroy();
    } catch (destroyError: unknown) {
      const errorObj = destroyError instanceof Error ? destroyError : new Error(getErrorMessage(destroyError));
      ailogger.error(chalk.red(`Error destroying connection for transaction ${transactionId}: ${getErrorMessage(destroyError)}`), errorObj);
    } finally {
      this.finalizeTransactionAfterConnectionLoss(transactionId, reason);
    }
  }

  // Close connection method (no-op for compatibility)
  public async closeConnection(): Promise<void> {
    // console.warn(chalk.yellow('Warning: closeConnection is deprecated for concurrency. Connections are managed dynamically and do not persist.'));
  }

  /**
   * Run `fn` inside a managed MySQL transaction. The callback receives a scoped
   * {@link TxExecutor}: `tx.query` binds to the transaction's dedicated
   * connection, `tx.id` is the migration bridge for legacy string-id helpers.
   *
   * Timeout semantics: the timeout uses `Promise.race` against `fn(tx)`. When
   * the timeout wins, the callback's statement may still be executing on the
   * transaction's dedicated connection. Because mysql2 serializes commands per
   * connection, a naive ROLLBACK would be queued BEHIND that statement and
   * could not run until it finished on its own — which would defeat the timeout
   * and pin the slot. To avoid that, on timeout this method issues
   * `KILL QUERY <threadId>` from a SEPARATE connection (see {@link
   * killQueryOnThread}) to abort the running statement, so ROLLBACK can proceed
   * promptly. If cancellation cannot be confirmed, the connection is discarded
   * without claiming server settlement. An `AbortSignal` cannot
   * substitute for this: MySQL has no protocol-level statement abort, so the
   * server keeps executing until the statement is KILLed. The orphan
   * `fnPromise` rejection (the KILLed statement) is swallowed so it cannot
   * surface as an unhandled rejection.
   */
  public async withTransaction<T>(fn: (tx: TxExecutor) => Promise<T>, opts?: WithTransactionOptions): Promise<T> {
    const timeoutMs = opts?.timeoutMs ?? this.DEFAULT_TX_TIMEOUT_MS;
    const transactionStartedAt = monotonicNow();
    const notify = (event: Omit<TransactionLifecycleEvent, 'elapsedMs'>) => {
      try {
        const result: unknown = opts?.lifecycleObserver?.(Object.freeze({ ...event, elapsedMs: monotonicNow() - transactionStartedAt }));
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          Promise.resolve(result).catch(() => undefined);
        }
      } catch {
        // Lifecycle telemetry must never influence database work.
      }
    };

    // Slot reservation is owned entirely by beginTransaction now: each attempt
    // reserves its own slot and, on failure, releases it before throwing. So
    // this retry loop just rethrows on exhaustion — there is no slot to unwind
    // here.
    let transactionId: string;
    let retryCount = 0;
    const maxRetries = 3;

    // Retry transaction start in case of connection issues
    while (retryCount < maxRetries) {
      try {
        transactionId = await this.beginTransaction();
        break;
      } catch (error: unknown) {
        retryCount++;
        if (retryCount >= maxRetries) {
          throw new Error(`Failed to start transaction after ${maxRetries} retries: ${getErrorMessage(error)}`);
        }
        ailogger.warn(`Transaction start failed (attempt ${retryCount}/${maxRetries}), retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      }
    }

    const connection = this.transactionConnections.get(transactionId!);
    if (!connection) {
      // beginTransaction succeeded, so it handed its reserved slot to the map
      // entry — but that entry is now gone. Fully unwind so the slot is not
      // leaked: drop any map/meta remnants (freeing the slot from occupancy),
      // then release to wake a queued waiter. Do NOT call
      // releaseTransactionStartSlot here — the starting-counter reservation was
      // already consumed by beginTransaction's handoff.
      this.transactionConnections.delete(transactionId!);
      const orphanMeta = this.transactionMeta.get(transactionId!);
      if (orphanMeta) {
        if (orphanMeta.timeoutHandle) clearTimeout(orphanMeta.timeoutHandle);
        if (orphanMeta.keepAliveHandle) clearInterval(orphanMeta.keepAliveHandle);
        this.transactionMeta.delete(transactionId!);
      }
      this.releaseTransactionSlot();
      throw new Error(`Connection lost immediately after transaction start for ${transactionId!}`);
    }

    // Enhanced connection configuration for long-running transactions
    try {
      await connection.query('SET SESSION wait_timeout = ?', [Math.ceil(timeoutMs / 1000) + 300]); // Add 5 minutes buffer
      await connection.query('SET SESSION interactive_timeout = ?', [Math.ceil(timeoutMs / 1000) + 300]);
      await connection.query('SET SESSION innodb_lock_wait_timeout = ?', [Math.min(300, Math.ceil(timeoutMs / 1000))]); // Cap at 5 minutes
      ailogger.info(`Enhanced connection settings applied for transaction ${transactionId!}`);
    } catch (configError: unknown) {
      ailogger.warn(`Failed to apply enhanced connection settings: ${getErrorMessage(configError)}`);
    }

    // set up metadata / timeout with resource locks
    const meta = this.transactionMeta.get(transactionId!) || {
      startedAt: Date.now(),
      timeoutHandle: null as NodeJS.Timeout | null,
      keepAliveHandle: null as NodeJS.Timeout | null,
      resourceLocks: new Set<string>()
    };

    // Enhanced keep-alive mechanism: ping every 90 seconds for long transactions
    if (timeoutMs > 90 * 1000) {
      const pingInterval = Math.min(90 * 1000, timeoutMs / 4); // Ping every 90s or 1/4 of timeout
      meta.keepAliveHandle = setInterval(async () => {
        try {
          const conn = this.transactionConnections.get(transactionId!);
          if (conn) {
            await conn.ping();
            // Also refresh connection settings to prevent timeout
            await conn.query('SET SESSION wait_timeout = ?', [Math.ceil(timeoutMs / 1000) + 300]);
            ailogger.info(`Keep-alive ping and timeout refresh for transaction ${transactionId!} (thread: ${(conn as PoolConnectionWithThreadId).threadId})`);
          }
        } catch (pingError: unknown) {
          ailogger.error(`Keep-alive ping failed for transaction ${transactionId!}: ${getErrorMessage(pingError)}`);
          // If ping fails, the connection might be dead - this will cause the transaction to fail
          // but that's better than hanging indefinitely
        }
      }, pingInterval);
    }

    // Tracks whether the timeout (not an ordinary callback error) ended the
    // race, so the catch block knows to KILL the still-running statement.
    let timedOut = false;
    const timeoutPromise = new Promise<never>((_, reject) => {
      meta.timeoutHandle = setTimeout(() => {
        timedOut = true;
        reject(new TransactionCallbackTimeoutError(transactionId!, timeoutMs));
      }, timeoutMs);
    });

    // Scoped executor: binds executeQuery to this transaction's connection so
    // callbacks call tx.query(...) instead of threading the id string. tx.id is
    // the migration bridge for legacy helpers still typed against a string id.
    const tx: TxExecutor = {
      query: (sql, params) => this.executeQuery(sql, params, transactionId!),
      id: transactionId!
    };

    // Capture the fn promise so we can handle its rejection if a timeout fires.
    // Without this, the orphaned fn promise produces an unhandled rejection that
    // can crash the Node.js process when it eventually fails (e.g. "No connection
    // found for transaction" after the connection was released by rollback).
    // Defer invocation into a promise so a non-async callback that throws
    // before returning a promise follows the same rollback/cleanup path as an
    // asynchronously rejected callback.
    const callbackStartedAt = monotonicNow();
    notify({ type: 'callback_started' });
    const fnPromise = Promise.resolve().then(() => fn(tx));
    let callbackDurationMs: number | undefined;
    let commitDurationMs: number | undefined;
    let cleanupDurationMs: number | undefined;

    try {
      const result = (await Promise.race([fnPromise, timeoutPromise])) as T;
      callbackDurationMs = monotonicNow() - callbackStartedAt;
      notify({ type: 'callback_succeeded', callbackDurationMs });
      // success path
      if (meta.timeoutHandle) clearTimeout(meta.timeoutHandle);
      if (meta.keepAliveHandle) clearInterval(meta.keepAliveHandle);
      notify({ type: 'commit_started', callbackDurationMs });
      await this.commitTransaction(transactionId!, (event, duration) => {
        if (event === 'acknowledged') {
          commitDurationMs = duration;
          notify({ type: 'commit_acknowledged', callbackDurationMs, commitDurationMs });
        } else if (event === 'outcome_unknown') {
          commitDurationMs = duration;
          notify({ type: 'commit_outcome_unknown', callbackDurationMs, commitDurationMs, outcome: 'commit_outcome_unknown' });
        } else {
          cleanupDurationMs = duration;
          notify({ type: 'cleanup_finished', callbackDurationMs, commitDurationMs, cleanupDurationMs });
        }
      });
      this.transactionMeta.delete(transactionId!);
      notify({
        type: 'transaction_finished',
        callbackDurationMs,
        commitDurationMs,
        cleanupDurationMs,
        totalDurationMs: monotonicNow() - transactionStartedAt,
        outcome: 'committed'
      });
      return result;
    } catch (err: unknown) {
      // on error / timeout
      if (meta.timeoutHandle) clearTimeout(meta.timeoutHandle);
      if (meta.keepAliveHandle) clearInterval(meta.keepAliveHandle);

      // The callback may still have a statement in flight (especially on
      // timeout). Attach the swallow handler BEFORE the KILL/rollback below so
      // the eventual rejection of that orphaned statement can never surface as
      // an unhandled rejection in the window between abort and handler attach.
      fnPromise.catch((fnErr: unknown) => {
        ailogger.warn(`Orphaned callback error for transaction ${transactionId!} (expected after abort/rollback): ${getErrorMessage(fnErr)}`);
      });

      // Enhanced error logging
      const errMessage = getErrorMessage(err);
      callbackDurationMs ??= monotonicNow() - callbackStartedAt;
      if (err instanceof TransactionCommitOutcomeUnknownError) {
        this.transactionMeta.delete(transactionId!);
        notify({
          type: 'transaction_finished',
          callbackDurationMs,
          commitDurationMs,
          cleanupDurationMs,
          totalDurationMs: monotonicNow() - transactionStartedAt,
          outcome: 'commit_outcome_unknown'
        });
        throw err;
      }
      if (err instanceof TransactionCommitCleanupError) {
        this.transactionMeta.delete(transactionId!);
        notify({ type: 'cleanup_finished', callbackDurationMs, commitDurationMs, cleanupDurationMs, outcome: 'commit_acknowledged_cleanup_failed' });
        notify({
          type: 'transaction_finished',
          callbackDurationMs,
          commitDurationMs,
          cleanupDurationMs,
          totalDurationMs: monotonicNow() - transactionStartedAt,
          outcome: 'commit_acknowledged_cleanup_failed'
        });
        throw err;
      }
      notify({ type: 'callback_failed', callbackDurationMs });
      const errorType = err instanceof Error ? err.constructor.name : 'Unknown';
      const errorObj = err instanceof Error ? err : new Error(errMessage);
      ailogger.error(`Transaction ${transactionId!} failed: ${errMessage}`, errorObj, {
        transactionId: transactionId!,
        duration: Date.now() - meta.startedAt,
        errorType,
        isConnectionError: this.isConnectionError(err),
        isTimeoutError: this.isLockTimeoutError(err) || errMessage.includes('timed out')
      });

      // On timeout the callback's statement is still running on the tx's
      // dedicated connection; the ROLLBACK below would queue behind it. KILL it
      // from a separate connection first so rollback/release proceed promptly.
      const cleanupStartedAt = monotonicNow();
      let safeToAttemptRollback = true;
      if (timedOut) {
        const txConnection = this.transactionConnections.get(transactionId!) as PoolConnectionWithThreadId | undefined;
        const threadId = txConnection?.threadId;
        if (typeof threadId === 'number') {
          try {
            const cancellation = await killQueryOnThread(threadId, 'transaction timeout');
            if (cancellation.status === 'no_kill_connection') {
              safeToAttemptRollback = false;
              this.discardTransaction(transactionId!, 'timed-out statement could not be confirmed stopped');
            }
          } catch (killError: unknown) {
            ailogger.error(`Unable to cancel timed-out transaction ${transactionId!}: ${getErrorMessage(killError)}`);
            safeToAttemptRollback = false;
            this.discardTransaction(transactionId!, 'timed-out statement cancellation failed');
          }
        } else {
          safeToAttemptRollback = false;
          this.discardTransaction(transactionId!, 'timed-out transaction has no connection thread id');
        }
      }

      let rollbackAcknowledged = false;
      if (safeToAttemptRollback) {
        try {
          notify({ type: 'rollback_started' });
          rollbackAcknowledged = await this.rollbackTransactionWithOutcome(transactionId!);
          if (rollbackAcknowledged) notify({ type: 'rollback_acknowledged' });
        } catch (rbErr: unknown) {
          if (rbErr instanceof TransactionRollbackCleanupError) {
            rollbackAcknowledged = true;
            notify({ type: 'rollback_acknowledged' });
          }
          ailogger.error(`Rollback failed for transaction ${transactionId!}: ${getErrorMessage(rbErr)}`);
        }
      }

      cleanupDurationMs = monotonicNow() - cleanupStartedAt;
      notify({ type: 'cleanup_finished', callbackDurationMs, cleanupDurationMs });
      this.transactionMeta.delete(transactionId!);
      notify({
        type: 'transaction_finished',
        callbackDurationMs,
        commitDurationMs,
        cleanupDurationMs,
        totalDurationMs: monotonicNow() - transactionStartedAt,
        outcome: rollbackAcknowledged ? 'rolled_back' : 'failed'
      });
      throw err;
    }
  }

  public hasActiveTransactions(): boolean {
    return this.transactionConnections.size > 0;
  }

  public async cleanupStaleTransactions(maxAgeMs?: number): Promise<void> {
    const threshold = maxAgeMs ?? this.DEFAULT_TX_TIMEOUT_MS * 2; // e.g., twice default
    const now = Date.now();
    const staleTransactions: string[] = [];

    for (const [txId, meta] of this.transactionMeta.entries()) {
      if (now - meta.startedAt > threshold) {
        staleTransactions.push(txId);
      }
    }

    if (staleTransactions.length === 0) {
      return; // No stale transactions, exit silently
    }

    // Log once for all stale transactions found
    ailogger.warn(`Detected ${staleTransactions.length} stale transaction(s), cleaning up...`);

    for (const txId of staleTransactions) {
      try {
        const meta = this.transactionMeta.get(txId);
        if (meta) {
          const ageSeconds = (now - meta.startedAt) / 1000;
          ailogger.info(`Cleaning up stale transaction ${txId} (age: ${ageSeconds.toFixed(1)}s)`);
          await this.rollbackTransaction(txId);
        }
      } catch (e: unknown) {
        const errorObj = e instanceof Error ? e : new Error(getErrorMessage(e));
        ailogger.error(`Error rolling back stale transaction ${txId}: ${getErrorMessage(e)}`, errorObj);
        // Ensure metadata is deleted even if rollback fails
        this.transactionMeta.delete(txId);
      }
    }
  }

  // Application-level lock management using MySQL distributed locks
  public async acquireApplicationLock(lockName: string, transactionId: string, timeoutMs: number = this.LOCK_TIMEOUT_MS): Promise<boolean> {
    const lockStartTime = Date.now();
    const timeoutSeconds = Math.ceil(timeoutMs / 1000);

    try {
      // Use MySQL GET_LOCK for distributed, atomic lock acquisition
      // GET_LOCK returns:
      // - 1 if lock was acquired successfully
      // - 0 if timeout occurred
      // - NULL if an error occurred
      const query = 'SELECT GET_LOCK(?, ?) as acquired';
      const result = await this.executeQuery(query, [lockName, timeoutSeconds], transactionId);

      if (result && result[0]?.acquired === 1) {
        // Track lock for cleanup
        const meta = this.transactionMeta.get(transactionId);
        if (meta) {
          meta.resourceLocks.add(lockName);
        }

        const lockWaitTime = Date.now() - lockStartTime;
        if (lockWaitTime > 10000) {
          ailogger.warn(chalk.yellow(`Slow lock acquisition: ${lockWaitTime}ms for ${lockName}`));
        }

        ailogger.info(chalk.blue(`MySQL lock acquired: ${lockName} by transaction ${transactionId} (waited ${lockWaitTime}ms)`));
        return true;
      }

      // Lock acquisition failed (timeout or error)
      const lockWaitTime = Date.now() - lockStartTime;
      ailogger.warn(chalk.yellow(`Failed to acquire MySQL lock: ${lockName} within ${timeoutMs}ms (actual: ${lockWaitTime}ms)`));
      return false;
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(getErrorMessage(error));
      ailogger.error(chalk.red(`Error acquiring MySQL lock ${lockName}: ${getErrorMessage(error)}`), errorObj);
      return false;
    }
  }

  public async releaseApplicationLock(lockName: string, transactionId: string): Promise<void> {
    try {
      // Use MySQL RELEASE_LOCK for distributed lock release
      // RELEASE_LOCK returns:
      // - 1 if lock was released successfully
      // - 0 if lock was not held by this connection
      // - NULL if the lock doesn't exist
      const query = 'SELECT RELEASE_LOCK(?) as released';
      const result = await this.executeQuery(query, [lockName], transactionId);

      // Remove from resource locks tracking
      const meta = this.transactionMeta.get(transactionId);
      if (meta) {
        meta.resourceLocks.delete(lockName);
      }

      if (result && result[0]?.released === 1) {
        ailogger.info(chalk.blue(`MySQL lock released: ${lockName} by transaction ${transactionId}`));
      } else if (result && result[0]?.released === 0) {
        ailogger.warn(chalk.yellow(`Lock ${lockName} was not held by transaction ${transactionId}`));
        throw new Error(`MySQL lock ${lockName} was not held by transaction ${transactionId}`);
      } else {
        throw new Error(`Could not confirm release of MySQL lock ${lockName} for transaction ${transactionId}`);
      }
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(getErrorMessage(error));
      ailogger.error(chalk.red(`Error releasing MySQL lock ${lockName}: ${getErrorMessage(error)}`), errorObj);
      throw error;
    }
  }

  private async cleanupApplicationLocks(transactionId: string): Promise<void> {
    const meta = this.transactionMeta.get(transactionId);
    if (meta && meta.resourceLocks.size > 0) {
      ailogger.info(`Cleaning up ${meta.resourceLocks.size} locks for transaction ${transactionId}`);

      // Release all locks for this transaction
      const releasePromises = Array.from(meta.resourceLocks).map(lockName => this.releaseApplicationLock(lockName, transactionId));

      let timeoutHandle: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          Promise.all(releasePromises),
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new Error('Lock cleanup timeout')), 10000);
          })
        ]);
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    }
  }

  private transactionSlotOccupancy(): number {
    return this.transactionConnections.size + this.startingTransactions;
  }

  private async acquireTransactionSlot(): Promise<void> {
    while (this.transactionSlotOccupancy() >= this.MAX_CONCURRENT_TRANSACTIONS) {
      ailogger.warn(`Transaction limit reached (${this.MAX_CONCURRENT_TRANSACTIONS}), waiting for available slot...`);

      // Wait for a slot to become available using a promise queue.
      // wrappedResolve is the function actually pushed to the queue, so the
      // timeout cleanup must look that up — NOT the bare resolve, which is
      // never in the queue and whose indexOf always returned -1 (leaving the
      // dead wrappedResolve stranded; releaseTransactionSlot would later
      // shift+call it, silently consuming a slot release for a waiter that
      // has already been rejected).
      await new Promise<void>((resolve, reject) => {
        const wrappedResolve = () => {
          clearTimeout(timeoutId);
          resolve();
        };
        const timeoutId = setTimeout(() => {
          const index = this.transactionSlotQueue.indexOf(wrappedResolve);
          if (index !== -1) {
            this.transactionSlotQueue.splice(index, 1);
          }
          reject(new Error('Transaction slot wait timeout - too many concurrent transactions'));
        }, 60000); // 1 minute max wait

        this.transactionSlotQueue.push(wrappedResolve);
      });

      ailogger.info('Transaction slot available, proceeding...');
    }

    this.startingTransactions++;
  }

  private consumeTransactionStartSlot(): void {
    if (this.startingTransactions > 0) {
      this.startingTransactions--;
    }
  }

  private releaseTransactionStartSlot(): void {
    this.consumeTransactionStartSlot();
    this.releaseTransactionSlot();
  }

  // Release a transaction slot from the queue (race condition fix)
  private releaseTransactionSlot(): void {
    if (this.transactionSlotQueue.length > 0 && this.transactionSlotOccupancy() < this.MAX_CONCURRENT_TRANSACTIONS) {
      const nextResolver = this.transactionSlotQueue.shift();
      if (nextResolver) {
        nextResolver();
        ailogger.info('Released transaction slot to waiting transaction');
      }
    }
  }

  // Helper methods to detect various MySQL errors
  private isDeadlockError(error: unknown): boolean {
    const mysqlError = error as MySQLError;
    return Boolean(
      mysqlError &&
        (mysqlError.code === 'ER_LOCK_DEADLOCK' || mysqlError.errno === 1213 || mysqlError.message?.includes('Deadlock found when trying to get lock'))
    );
  }

  private isLockTimeoutError(error: unknown): boolean {
    const mysqlError = error as MySQLError;
    return Boolean(
      mysqlError && (mysqlError.code === 'ER_LOCK_WAIT_TIMEOUT' || mysqlError.errno === 1205 || mysqlError.message?.includes('Lock wait timeout exceeded'))
    );
  }

  private isConnectionError(error: unknown): boolean {
    const mysqlError = error as MySQLError;
    return Boolean(
      mysqlError &&
        (mysqlError.code === 'ECONNRESET' ||
          mysqlError.code === 'PROTOCOL_CONNECTION_LOST' ||
          mysqlError.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR' ||
          mysqlError.code === 'ER_CONNECTION_KILLED' ||
          mysqlError.errno === 1927 || // Connection was killed
          mysqlError.errno === 2013 || // Lost connection to MySQL server during query
          mysqlError.message?.includes('Connection lost') ||
          mysqlError.message?.includes('server has gone away') ||
          mysqlError.message?.includes('Connection was killed'))
    );
  }

  private queryPreview(query: string): string {
    return query.replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  private connectionTimingThresholdMs(): number {
    const threshold = Number(process.env.CONNECTION_QUERY_TIMING_THRESHOLD_MS ?? '250');
    return Number.isFinite(threshold) && threshold >= 0 ? threshold : 250;
  }

  private logQueryTiming(details: QueryTimingDetails): void {
    const threshold = this.connectionTimingThresholdMs();
    if (!details.failed && details.totalMs < threshold && details.acquireMs < threshold && details.schemaUseMs < threshold && details.queryMs < threshold) {
      return;
    }

    ailogger.info('ConnectionManager.executeQuery timing', {
      schema: details.schema,
      transactionId: details.transactionId,
      acquireMs: details.acquireMs,
      schemaUseMs: details.schemaUseMs,
      queryMs: details.queryMs,
      totalMs: details.totalMs,
      failed: details.failed,
      queryPreview: details.queryPreview
    });
  }

  // Acquire a connection for the current operation. Validation is left to the
  // query path itself so read-heavy endpoints do not pay an unconditional ping
  // round-trip before every statement.
  private async acquireConnectionInternal(): Promise<PoolConnection> {
    try {
      return await getConn();
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(getErrorMessage(error));
      ailogger.error(chalk.red(`Error acquiring or validating connection: ${getErrorMessage(error)}`), errorObj);
      throw error;
    }
  }
}

patchConnectionManager(ConnectionManager.getInstance());

export default ConnectionManager;
