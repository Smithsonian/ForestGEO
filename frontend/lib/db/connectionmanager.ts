// connectionmanager.ts
import '@/lib/connectionlogger';
import { PoolConnection } from 'mysql2/promise';
import chalk from 'chalk';
import { TransactionCallbackTimeoutError } from '@/lib/db/transactionerrors';
import { ConnectionQuarantinedError, isConnectionQuarantined, quarantineConnection, settleWithinDeadline } from '@/lib/db/connectionquarantine';
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

export type TransactionPhase = 'active' | 'committing' | 'rolling_back';

interface TransactionMeta {
  startedAt: number;
  /** After this (epoch ms, same clock as startedAt) an idle active transaction may be reaped. */
  deadlineAt: number;
  phase: TransactionPhase;
  /** Statements issued through executeQuery with this transaction's id that have not settled yet. */
  inFlightStatements: number;
  keepAliveHandle: NodeJS.Timeout | null;
  resourceLocks: Set<string>;
  /** In-flight acquireApplicationLock calls for this transaction, keyed by lock name — see acquireApplicationLock's doc comment. */
  pendingLockAcquisitions: Map<string, Promise<boolean>>;
}

type LockCleanupOutcome = 'confirmed' | 'unconfirmed';
type ConnectionDisposition = 'release' | 'quarantine' | 'already_quarantined';

/** Bound on releasing a transaction's application locks after COMMIT/ROLLBACK (names the old literal 10 s). */
export const APPLICATION_LOCK_CLEANUP_DEADLINE_MS = 10_000;
export const LOCK_CLEANUP_UNCONFIRMED_EVENT = 'db.transaction.lock_cleanup_unconfirmed';

const MILLISECONDS_PER_SECOND = 1000;
/** Extra session idle time beyond the transaction timeout, so the server never drops a live transaction's session. */
const SESSION_TIMEOUT_BUFFER_SECONDS = 300;
/** Cap on innodb_lock_wait_timeout for withTransaction sessions. */
const MAX_TRANSACTION_LOCK_WAIT_SECONDS = 300;

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
  private transactionMeta = new Map<string, TransactionMeta>();
  private static readonly DEFAULT_TX_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
  public static readonly DEFAULT_STALE_TRANSACTION_THRESHOLD_MS = ConnectionManager.DEFAULT_TX_TIMEOUT_MS * 2;
  /** Added to a withTransaction's timeoutMs to form its reaper deadline, so the reaper can never act before the callback timer. */
  public static readonly TRANSACTION_REAPER_GRACE_MS = 60_000;
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

    const meta = transactionId ? this.transactionMeta.get(transactionId) : undefined;
    if (meta) meta.inFlightStatements += 1;

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
        // runQuery destroyed this connection, so the transaction is over: the
        // server rolls it back when the socket closes. Without finalizing here,
        // the caller's `rollbackTransaction` in its catch/finally would find the
        // map entry still present, call rollback() on a closed connection, and
        // throw "closed state" — replacing the QueryTimeoutError in the route's
        // 500 with a misleading one. Finalize now so that later rollback takes
        // the existing already-finalized no-op path.
        this.finalizeTransactionAfterConnectionLoss(transactionId, `statement timed out after ${error.timeoutMs}ms`);
      }
      throw error;
    } finally {
      if (meta) meta.inFlightStatements -= 1;
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
      if (!transactionId && !isConnectionQuarantined(connection)) {
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
  public async beginTransaction(opts?: { reaperDeadlineMs?: number }): Promise<string> {
    const reaperDeadlineMs = opts?.reaperDeadlineMs ?? ConnectionManager.DEFAULT_STALE_TRANSACTION_THRESHOLD_MS;
    if (!Number.isFinite(reaperDeadlineMs) || reaperDeadlineMs <= 0) {
      throw new RangeError(`reaperDeadlineMs must be a finite number of milliseconds greater than 0 (got ${reaperDeadlineMs})`);
    }
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
          const startedAt = Date.now();
          this.transactionMeta.set(transactionId, {
            startedAt,
            deadlineAt: startedAt + reaperDeadlineMs,
            phase: 'active',
            inFlightStatements: 0,
            keepAliveHandle: null,
            resourceLocks: new Set<string>(),
            pendingLockAcquisitions: new Map<string, Promise<boolean>>()
          });

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
  public async commitTransaction(transactionId: string): Promise<void> {
    const connection = this.transactionConnections.get(transactionId);
    const meta = this.transactionMeta.get(transactionId);
    if (!connection || !meta) {
      ailogger.warn(`Transaction with ID ${transactionId} does not exist or has already been finalized.`);
      return; // Avoid throwing an error for an already finalized transaction
    }

    this.leaveActivePhase(meta, 'committing');
    try {
      await connection.commit();
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(getErrorMessage(error));
      ailogger.error(chalk.red(`Error committing transaction: ${getErrorMessage(error)}`), errorObj);
      this.discardTransaction(transactionId, 'COMMIT failed');
      throw error;
    }
    ailogger.info(chalk.green(`Transaction committed: ${transactionId} (thread: ${(connection as PoolConnectionWithThreadId).threadId})`));

    // Flush buffered changelog entries now that the transaction is committed
    flushTransactionChangelog(transactionId);
    await this.releaseLocksAndFinalize(transactionId, 'COMMIT');
  }

  // Rollback a transaction
  public async rollbackTransaction(transactionId: string): Promise<void> {
    const connection = this.transactionConnections.get(transactionId);
    const meta = this.transactionMeta.get(transactionId);
    if (!connection || !meta) {
      ailogger.warn(`Transaction with ID ${transactionId} does not exist or has already been finalized.`);
      return; // Avoid throwing an error for an already finalized transaction
    }

    this.leaveActivePhase(meta, 'rolling_back');
    try {
      await connection.rollback();
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(getErrorMessage(error));
      ailogger.error(chalk.red(`Error rolling back transaction: ${getErrorMessage(error)}`), errorObj);
      this.discardTransaction(transactionId, 'ROLLBACK failed');
      throw error;
    }
    ailogger.warn(chalk.yellow(`Transaction rolled back: ${transactionId} (thread: ${(connection as PoolConnectionWithThreadId).threadId})`));

    // Discard any buffered changelog entries — the transaction was rolled back
    discardTransactionChangelog(transactionId);
    await this.releaseLocksAndFinalize(transactionId, 'ROLLBACK');
  }

  /** Moves a transaction out of 'active' and stops its keep-alive in the same synchronous step. */
  private leaveActivePhase(meta: TransactionMeta, phase: Exclude<TransactionPhase, 'active'>): void {
    meta.phase = phase;
    if (meta.keepAliveHandle) {
      clearInterval(meta.keepAliveHandle);
      meta.keepAliveHandle = null;
    }
  }

  /**
   * The one exit for every transaction: drops the map entry and meta (clearing the keep-alive), then releases the
   * connection or quarantines it, then frees the slot. The map entry is the guard, so it runs at most once.
   */
  private finalizeTransaction(transactionId: string, disposition: ConnectionDisposition, reason: string): void {
    const connection = this.transactionConnections.get(transactionId);
    if (!connection) return;
    this.transactionConnections.delete(transactionId);
    const meta = this.transactionMeta.get(transactionId);
    if (meta?.keepAliveHandle) clearInterval(meta.keepAliveHandle);
    this.transactionMeta.delete(transactionId);
    if (disposition === 'release') {
      connection.release();
    } else if (disposition === 'quarantine') {
      quarantineConnection(connection, `transaction ${transactionId}: ${reason}`);
    }
    this.releaseTransactionSlot();
  }

  /** After an acknowledged COMMIT or ROLLBACK: release the connection only if every lock release was confirmed. */
  private async releaseLocksAndFinalize(transactionId: string, acknowledgedStatement: 'COMMIT' | 'ROLLBACK'): Promise<void> {
    const lockCleanup = await this.cleanupApplicationLocks(transactionId);
    if (lockCleanup === 'confirmed') {
      this.finalizeTransaction(transactionId, 'release', `${acknowledgedStatement} acknowledged`);
      return;
    }
    this.finalizeTransaction(transactionId, 'quarantine', `${acknowledgedStatement} acknowledged but application-lock release was not confirmed`);
  }

  /**
   * Finalize after runQuery already quarantined this transaction's connection (statement timeout). There is nothing
   * left to ROLLBACK over the wire — the server rolled the transaction back when the socket closed — so this only
   * settles the bookkeeping and discards buffered changelog entries, which describe rolled-back writes.
   *
   * Application locks are NOT released here: they are session-scoped MySQL GET_LOCKs, and the session is gone, so the
   * server has already dropped them.
   */
  private finalizeTransactionAfterConnectionLoss(transactionId: string, reason: string): void {
    if (!this.transactionConnections.has(transactionId)) return;
    ailogger.warn(chalk.yellow(`Transaction ${transactionId} finalized without ROLLBACK: its connection was quarantined (${reason}).`));
    discardTransactionChangelog(transactionId);
    this.finalizeTransaction(transactionId, 'already_quarantined', reason);
  }

  /**
   * Quarantine a transaction's connection whose session can no longer be trusted, so it never returns to the pool,
   * and finalize the transaction. A later commit or rollback is a no-op. Never throws, so it cannot mask the caller's
   * own error.
   */
  public discardTransaction(transactionId: string, reason: string): void {
    if (!this.transactionConnections.has(transactionId)) return;
    ailogger.warn(chalk.yellow(`Transaction ${transactionId} discarded: its connection was quarantined (${reason}).`));
    discardTransactionChangelog(transactionId);
    this.finalizeTransaction(transactionId, 'quarantine', reason);
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
   * killQueryOnThread}) to abort the running statement, so the queued ROLLBACK
   * and connection release proceed promptly — returning control to the caller
   * at ~timeoutMs and freeing the transaction slot. An `AbortSignal` cannot
   * substitute for this: MySQL has no protocol-level statement abort, so the
   * server keeps executing until the statement is KILLed. The orphan
   * `fnPromise` rejection (the KILLed statement) is swallowed so it cannot
   * surface as an unhandled rejection.
   *
   * The callback timer is a local of this method, armed BEFORE the session
   * setup, so a stalled setup statement and a discarded transaction are both
   * still bounded by `timeoutMs`.
   */
  public async withTransaction<T>(fn: (tx: TxExecutor) => Promise<T>, opts?: { timeoutMs?: number }): Promise<T> {
    const timeoutMs = opts?.timeoutMs ?? ConnectionManager.DEFAULT_TX_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new RangeError(`timeoutMs must be a finite, non-negative number of milliseconds (got ${timeoutMs})`);
    }
    const reaperDeadlineMs = timeoutMs + ConnectionManager.TRANSACTION_REAPER_GRACE_MS;

    let transactionId: string;
    let retryCount = 0;
    const maxRetries = 3;

    // Retry transaction start in case of connection issues. beginTransaction owns
    // slot reservation, so there is no slot to unwind here. A RangeError is a
    // programming error, never retried. A BEGIN-statement QueryTimeoutError is
    // not a deadlock, so beginTransaction rethrows it at once (its connection
    // already quarantined and KILLed by runQuery) and this loop retries it on a
    // fresh connection: at most maxRetries × 2 statements × 30 s + 1 s + 2 s of
    // pauses ≈ 183 s of BEGIN stalls, plus slot waits, before rejecting.
    while (retryCount < maxRetries) {
      try {
        transactionId = await this.beginTransaction({ reaperDeadlineMs });
        break;
      } catch (error: unknown) {
        if (error instanceof RangeError) throw error;
        retryCount++;
        if (retryCount >= maxRetries) {
          throw new Error(`Failed to start transaction after ${maxRetries} retries: ${getErrorMessage(error)}`);
        }
        ailogger.warn(`Transaction start failed (attempt ${retryCount}/${maxRetries}), retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      }
    }

    const meta = this.transactionMeta.get(transactionId!);
    if (!meta || !this.transactionConnections.has(transactionId!)) {
      this.transactionConnections.delete(transactionId!);
      this.transactionMeta.delete(transactionId!);
      this.releaseTransactionSlot();
      throw new Error(`Connection lost immediately after transaction start for ${transactionId!}`);
    }
    const startedAt = meta.startedAt;

    // Enhanced keep-alive mechanism: ping every 90 seconds for long transactions.
    // It runs only while the transaction is active: commit/rollback clear it
    // (leaveActivePhase), finalizeTransaction clears it on every other exit, and
    // a tick re-checks after its ping because the transaction may have finished
    // (and its connection gone back to the pool) while the ping was queued.
    if (timeoutMs > 90 * 1000) {
      const pingInterval = Math.min(90 * 1000, timeoutMs / 4); // Ping every 90s or 1/4 of timeout
      meta.keepAliveHandle = setInterval(async () => {
        const isActive = () => this.transactionMeta.get(transactionId!)?.phase === 'active';
        try {
          const conn = this.transactionConnections.get(transactionId!);
          if (!conn || !isActive()) return;
          await conn.ping();
          if (!isActive()) return;
          // Also refresh connection settings to prevent timeout
          await conn.query('SET SESSION wait_timeout = ?', [Math.ceil(timeoutMs / MILLISECONDS_PER_SECOND) + SESSION_TIMEOUT_BUFFER_SECONDS]);
          ailogger.info(`Keep-alive ping and timeout refresh for transaction ${transactionId!} (thread: ${(conn as PoolConnectionWithThreadId).threadId})`);
        } catch (pingError: unknown) {
          ailogger.error(`Keep-alive ping failed for transaction ${transactionId!}: ${getErrorMessage(pingError)}`);
          // If ping fails, the connection might be dead - this will cause the transaction to fail
          // but that's better than hanging indefinitely
        }
      }, pingInterval);
    }

    const tx: TxExecutor = {
      query: (sql, params) => this.executeQuery(sql, params, transactionId!),
      id: transactionId!
    };

    // withTransaction alone owns the callback timer. It is armed BEFORE the
    // session setup so a stalled setup statement is bounded by timeoutMs too.
    let timedOut = false;
    let callbackTimeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      callbackTimeoutHandle = setTimeout(() => {
        timedOut = true;
        reject(new TransactionCallbackTimeoutError(transactionId!, timeoutMs));
      }, timeoutMs);
    });

    // Deferred so a non-async callback that throws synchronously follows the
    // same rollback path as an asynchronously rejected one.
    const fnPromise = Promise.resolve().then(async () => {
      await this.applySessionSettings(tx, timeoutMs);
      // A setup statement that settled after the deadline must not start the callback on an abandoned transaction.
      if (timedOut) throw new TransactionCallbackTimeoutError(transactionId!, timeoutMs);
      return fn(tx);
    });

    let result: T;
    try {
      result = (await Promise.race([fnPromise, timeoutPromise])) as T;
    } catch (err: unknown) {
      clearTimeout(callbackTimeoutHandle);
      await this.endFailedCallbackTransaction(transactionId!, err, { timedOut, fnPromise, startedAt });
      throw err;
    }
    clearTimeout(callbackTimeoutHandle);
    await this.commitTransaction(transactionId!);
    return result;
  }

  /**
   * Session settings for a withTransaction session. Runs inside the timed body, through executeQuery, so each
   * statement is bounded by runQuery, counted in flight, and covered by the callback deadline. A cancellation
   * (quarantine) or a statement timeout ends the transaction and must stop the callback from running; any other
   * failure keeps the historical warn-and-continue.
   */
  private async applySessionSettings(tx: TxExecutor, timeoutMs: number): Promise<void> {
    const timeoutSeconds = Math.ceil(timeoutMs / MILLISECONDS_PER_SECOND);
    const sessionTimeoutSeconds = timeoutSeconds + SESSION_TIMEOUT_BUFFER_SECONDS;
    const lockWaitSeconds = Math.min(MAX_TRANSACTION_LOCK_WAIT_SECONDS, timeoutSeconds);
    // Interpolated, never bound: over the prepared protocol mysql2 binds a JS number as DOUBLE and MySQL rejects it
    // for these variables (ER_WRONG_TYPE_FOR_VAR). Each value is proven an integer first, so nothing else can reach
    // the SQL text (same pattern as processorhelperfunctions.tsx's MAX_EXECUTION_TIME).
    for (const seconds of [sessionTimeoutSeconds, lockWaitSeconds]) {
      if (!Number.isInteger(seconds) || seconds < 0) {
        throw new RangeError(`Session timeout must be a non-negative integer number of seconds (got ${seconds})`);
      }
    }
    try {
      await tx.query(`SET SESSION wait_timeout = ${sessionTimeoutSeconds}`);
      await tx.query(`SET SESSION interactive_timeout = ${sessionTimeoutSeconds}`);
      await tx.query(`SET SESSION innodb_lock_wait_timeout = ${lockWaitSeconds}`);
      ailogger.info(`Enhanced connection settings applied for transaction ${tx.id}`);
    } catch (configError: unknown) {
      if (configError instanceof QueryTimeoutError || configError instanceof ConnectionQuarantinedError) {
        throw configError;
      }
      ailogger.warn(`Failed to apply enhanced connection settings: ${getErrorMessage(configError)}`);
    }
  }

  /** Ends a transaction whose callback rejected or timed out; never throws, so the callback's error reaches the caller. */
  private async endFailedCallbackTransaction(
    transactionId: string,
    err: unknown,
    context: { timedOut: boolean; fnPromise: Promise<unknown>; startedAt: number }
  ): Promise<void> {
    // The callback may still have a statement in flight. Attach the swallow
    // handler BEFORE anything below so its eventual rejection can never surface
    // as an unhandled rejection.
    context.fnPromise.catch((fnErr: unknown) => {
      ailogger.warn(`Orphaned callback error for transaction ${transactionId} (expected after abort/rollback): ${getErrorMessage(fnErr)}`);
    });

    const errMessage = getErrorMessage(err);
    const errorObj = err instanceof Error ? err : new Error(errMessage);
    ailogger.error(`Transaction ${transactionId} failed: ${errMessage}`, errorObj, {
      transactionId,
      duration: Date.now() - context.startedAt,
      errorType: err instanceof Error ? err.constructor.name : 'Unknown',
      isConnectionError: this.isConnectionError(err),
      isTimeoutError: this.isLockTimeoutError(err) || errMessage.includes('timed out')
    });

    if (context.timedOut) {
      const txConnection = this.transactionConnections.get(transactionId) as PoolConnectionWithThreadId | undefined;
      const threadId = txConnection?.threadId;
      if (typeof threadId === 'number') {
        await killQueryOnThread(threadId, 'transaction timeout');
      }
    }

    try {
      await this.rollbackTransaction(transactionId);
    } catch (rbErr: unknown) {
      ailogger.error(`Rollback failed for transaction ${transactionId}: ${getErrorMessage(rbErr)}`);
    }
  }

  public hasActiveTransactions(): boolean {
    return this.transactionConnections.size > 0;
  }

  public async cleanupStaleTransactions(maxAgeMs?: number): Promise<void> {
    const threshold = maxAgeMs ?? ConnectionManager.DEFAULT_STALE_TRANSACTION_THRESHOLD_MS;
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
  /**
   * MySQL's GET_LOCK is refcounted per (session, name): acquiring the same
   * name twice on one connection requires two RELEASE_LOCK calls to fully
   * drop it, while cleanupApplicationLocks only ever releases once per name
   * tracked in `resourceLocks`. A transaction that already tracks this name
   * already holds it for its full remaining lifetime, so a re-acquire is a
   * safe no-op rather than a second real GET_LOCK call — handled below for
   * both a sequential re-acquire (already in `resourceLocks`) and a
   * concurrent one racing the first (joins its in-flight `pendingLockAcquisitions`
   * promise instead of starting a second real GET_LOCK that would raise the
   * session's refcount a second time).
   *
   * `transactionId` must name a transaction THIS instance is actively
   * tracking: an unknown id has no `resourceLocks` to register the lock in,
   * so cleanupApplicationLocks could never release it — an untracked lock
   * held forever on a connection returned to the pool. Rejected outright
   * rather than silently taking the lock anyway.
   */
  public async acquireApplicationLock(lockName: string, transactionId: string, timeoutMs: number = this.LOCK_TIMEOUT_MS): Promise<boolean> {
    const meta = this.transactionMeta.get(transactionId);
    if (!meta) {
      ailogger.error(chalk.red(`acquireApplicationLock: unknown transaction ${transactionId} — refusing to take an untracked lock ${lockName}`));
      return false;
    }

    if (meta.resourceLocks.has(lockName)) {
      return true;
    }

    const pendingAcquisition = meta.pendingLockAcquisitions.get(lockName);
    if (pendingAcquisition) {
      return pendingAcquisition;
    }

    const acquisition = this.acquireApplicationLockOnce(lockName, transactionId, timeoutMs, meta);
    meta.pendingLockAcquisitions.set(lockName, acquisition);
    try {
      return await acquisition;
    } finally {
      meta.pendingLockAcquisitions.delete(lockName);
    }
  }

  private async acquireApplicationLockOnce(lockName: string, transactionId: string, timeoutMs: number, meta: { resourceLocks: Set<string> }): Promise<boolean> {
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
        meta.resourceLocks.add(lockName);

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
    await this.releaseApplicationLockWithOutcome(lockName, transactionId);
  }

  /**
   * RELEASE_LOCK returns 1 (released), 0 (not held by this session) or NULL (no such lock): each proves the session
   * no longer holds it. A thrown error or a missing row cannot prove that. Never throws.
   */
  private async releaseApplicationLockWithOutcome(lockName: string, transactionId: string): Promise<LockCleanupOutcome> {
    try {
      const result = await this.executeQuery('SELECT RELEASE_LOCK(?) as released', [lockName], transactionId);
      this.transactionMeta.get(transactionId)?.resourceLocks.delete(lockName);
      const released = Array.isArray(result) && result.length > 0 ? result[0]?.released : undefined;
      if (released === 1) {
        ailogger.info(chalk.blue(`MySQL lock released: ${lockName} by transaction ${transactionId}`));
        return 'confirmed';
      }
      if (released === 0) {
        ailogger.warn(chalk.yellow(`Lock ${lockName} was not held by transaction ${transactionId}`));
        return 'confirmed';
      }
      if (released === null) {
        ailogger.info(`Lock ${lockName} no longer existed when transaction ${transactionId} released it`);
        return 'confirmed';
      }
      ailogger.warn(chalk.yellow(`RELEASE_LOCK for ${lockName} returned no usable result for transaction ${transactionId}`));
      return 'unconfirmed';
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(getErrorMessage(error));
      ailogger.error(chalk.red(`Error releasing MySQL lock ${lockName}: ${getErrorMessage(error)}`), errorObj);
      return 'unconfirmed';
    }
  }

  private async cleanupApplicationLocks(transactionId: string): Promise<LockCleanupOutcome> {
    const meta = this.transactionMeta.get(transactionId);
    if (!meta || meta.resourceLocks.size === 0) return 'confirmed';
    const lockCount = meta.resourceLocks.size;
    ailogger.info(`Cleaning up ${lockCount} locks for transaction ${transactionId}`);
    const releases = Promise.all(Array.from(meta.resourceLocks).map(lockName => this.releaseApplicationLockWithOutcome(lockName, transactionId)));
    const settlement = await settleWithinDeadline(releases, APPLICATION_LOCK_CLEANUP_DEADLINE_MS, late => {
      ailogger.info(`Lock cleanup for transaction ${transactionId} settled (${late.status}) after its ${APPLICATION_LOCK_CLEANUP_DEADLINE_MS}ms deadline`);
    });
    if (settlement.status === 'settled' && settlement.value.every(outcome => outcome === 'confirmed')) return 'confirmed';
    ailogger.warn(LOCK_CLEANUP_UNCONFIRMED_EVENT, { transactionId, lockCount, settlement: settlement.status });
    return 'unconfirmed';
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

export { TransactionCallbackTimeoutError } from './transactionerrors';
export default ConnectionManager;
