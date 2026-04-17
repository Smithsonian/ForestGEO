// connectionmanager.ts
import '@/lib/connectionlogger';
import { PoolConnection } from 'mysql2/promise';
import chalk from 'chalk';
import { getConn, runQuery } from '@/components/processors/processormacros';
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
    const connection = transactionId ? this.transactionConnections.get(transactionId) : await this.acquireConnectionInternal();

    if (!connection) {
      throw new Error(transactionId ? `No connection found for transaction: ${transactionId}` : 'Unable to acquire connection.');
    }

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
      const schema = extractSchemaFromQuery(query);
      if (schema) {
        try {
          // Use simple query protocol (not prepared statements) to switch database
          await connection.query(`USE \`${schema}\``);
        } catch (useError: unknown) {
          // Log but don't fail - the query may still work with fully-qualified names
          ailogger.warn(chalk.yellow(`Could not set database context to ${schema}: ${getErrorMessage(useError)}`));
        }
      }

      return await runQuery(connection, query, params);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      ailogger.error(chalk.red(`Error executing query: ${errMsg}`));
      throw error;
    } finally {
      if (!transactionId) {
        connection.release(); // Release if not part of a transaction
      }
    }
  }

  // Begin a transaction with enhanced deadlock handling
  public async beginTransaction(): Promise<string> {
    const startTime = Date.now();
    const transactionId = uuidv4();
    let connection: PoolConnection | null = null;
    let retryDelay = 100; // Start with 100ms delay

    try {
      while (Date.now() - startTime < 30000) {
        // Increased timeout to 30 seconds
        try {
          connection = await this.acquireConnectionInternal();

          // Set transaction isolation level to reduce deadlock probability
          await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');

          await connection.beginTransaction();
          this.transactionConnections.set(transactionId, connection);

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
    }
  }

  // Commit a transaction
  public async commitTransaction(transactionId: string): Promise<void> {
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
      return; // Avoid throwing an error for an already finalized transaction
    }

    try {
      await connection.commit();
      ailogger.info(chalk.green(`Transaction committed: ${transactionId} (thread: ${(connection as PoolConnectionWithThreadId).threadId})`));

      // Flush buffered changelog entries now that the transaction is committed
      flushTransactionChangelog(transactionId);
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(getErrorMessage(error));
      ailogger.error(chalk.red(`Error committing transaction: ${getErrorMessage(error)}`), errorObj);

      // Discard changelog entries if commit itself failed
      discardTransactionChangelog(transactionId);
      throw error;
    } finally {
      // Clean up application locks before releasing connection
      await this.cleanupApplicationLocks(transactionId);
      connection.release();
      this.transactionConnections.delete(transactionId);

      // CRITICAL FIX: Clean up metadata to prevent leaks
      const meta = this.transactionMeta.get(transactionId);
      if (meta) {
        if (meta.timeoutHandle) clearTimeout(meta.timeoutHandle);
        if (meta.keepAliveHandle) clearInterval(meta.keepAliveHandle);
        this.transactionMeta.delete(transactionId);
      }

      // Release a waiting transaction slot (race condition fix)
      this.releaseTransactionSlot();
    }
  }

  // Rollback a transaction
  public async rollbackTransaction(transactionId: string): Promise<void> {
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
      return; // Avoid throwing an error for an already finalized transaction
    }

    try {
      await connection.rollback();
      ailogger.warn(chalk.yellow(`Transaction rolled back: ${transactionId} (thread: ${(connection as PoolConnectionWithThreadId).threadId})`));
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(getErrorMessage(error));
      ailogger.error(chalk.red(`Error rolling back transaction: ${getErrorMessage(error)}`), errorObj);
      throw error;
    } finally {
      // Discard any buffered changelog entries — the transaction was rolled back
      discardTransactionChangelog(transactionId);

      // Clean up application locks before releasing connection
      await this.cleanupApplicationLocks(transactionId);
      connection.release();
      this.transactionConnections.delete(transactionId);

      // CRITICAL FIX: Clean up metadata to prevent leaks
      const meta = this.transactionMeta.get(transactionId);
      if (meta) {
        if (meta.timeoutHandle) clearTimeout(meta.timeoutHandle);
        if (meta.keepAliveHandle) clearInterval(meta.keepAliveHandle);
        this.transactionMeta.delete(transactionId);
      }

      // Release a waiting transaction slot (race condition fix)
      this.releaseTransactionSlot();
    }
  }

  // Close connection method (no-op for compatibility)
  public async closeConnection(): Promise<void> {
    // console.warn(chalk.yellow('Warning: closeConnection is deprecated for concurrency. Connections are managed dynamically and do not persist.'));
  }

  public async withTransaction<T>(fn: (transactionId: string) => Promise<T>, opts?: { timeoutMs?: number }): Promise<T> {
    const timeoutMs = opts?.timeoutMs ?? this.DEFAULT_TX_TIMEOUT_MS;

    // Race condition fix: use promise-based queue instead of polling
    if (this.transactionConnections.size >= this.MAX_CONCURRENT_TRANSACTIONS) {
      ailogger.warn(`Transaction limit reached (${this.MAX_CONCURRENT_TRANSACTIONS}), waiting for available slot...`);

      // Wait for a slot to become available using a promise queue
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          // Remove from queue if still waiting
          const index = this.transactionSlotQueue.indexOf(resolve);
          if (index !== -1) {
            this.transactionSlotQueue.splice(index, 1);
          }
          reject(new Error('Transaction slot wait timeout - too many concurrent transactions'));
        }, 60000); // 1 minute max wait

        // Add to queue with cleanup
        const wrappedResolve = () => {
          clearTimeout(timeoutId);
          resolve();
        };
        this.transactionSlotQueue.push(wrappedResolve);
      });

      ailogger.info('Transaction slot available, proceeding...');
    }

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

    const timeoutPromise = new Promise<never>((_, reject) => {
      meta.timeoutHandle = setTimeout(() => {
        reject(new Error(`Transaction ${transactionId!} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    // Capture the fn promise so we can handle its rejection if a timeout fires.
    // Without this, the orphaned fn promise produces an unhandled rejection that
    // can crash the Node.js process when it eventually fails (e.g. "No connection
    // found for transaction" after the connection was released by rollback).
    const fnPromise = fn(transactionId!);

    try {
      const result = (await Promise.race([fnPromise, timeoutPromise])) as T;
      // success path
      if (meta.timeoutHandle) clearTimeout(meta.timeoutHandle);
      if (meta.keepAliveHandle) clearInterval(meta.keepAliveHandle);
      await this.commitTransaction(transactionId!);
      this.transactionMeta.delete(transactionId!);
      return result;
    } catch (err: unknown) {
      // on error / timeout
      if (meta.timeoutHandle) clearTimeout(meta.timeoutHandle);
      if (meta.keepAliveHandle) clearInterval(meta.keepAliveHandle);

      // Enhanced error logging
      const errMessage = getErrorMessage(err);
      const errorType = err instanceof Error ? err.constructor.name : 'Unknown';
      const errorObj = err instanceof Error ? err : new Error(errMessage);
      ailogger.error(`Transaction ${transactionId!} failed: ${errMessage}`, errorObj, {
        transactionId: transactionId!,
        duration: Date.now() - meta.startedAt,
        errorType,
        isConnectionError: this.isConnectionError(err),
        isTimeoutError: this.isLockTimeoutError(err) || errMessage.includes('timed out')
      });

      try {
        await this.rollbackTransaction(transactionId!);
      } catch (rbErr: unknown) {
        ailogger.error(`Rollback failed for transaction ${transactionId!}: ${getErrorMessage(rbErr)}`);
      }

      // After rollback, the fn callback may still be in-flight. Its subsequent
      // executeQuery calls will fail with "No connection found" because the
      // connection was released during rollback. Swallow that eventual rejection
      // to prevent an unhandled promise rejection crash.
      fnPromise.catch((fnErr: unknown) => {
        ailogger.warn(`Post-rollback callback error for transaction ${transactionId!} (expected): ${getErrorMessage(fnErr)}`);
      });

      this.transactionMeta.delete(transactionId!);
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
      }
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(getErrorMessage(error));
      ailogger.error(chalk.red(`Error releasing MySQL lock ${lockName}: ${getErrorMessage(error)}`), errorObj);
      // Don't throw - we want cleanup to continue even if release fails
    }
  }

  private async cleanupApplicationLocks(transactionId: string): Promise<void> {
    const meta = this.transactionMeta.get(transactionId);
    if (meta && meta.resourceLocks.size > 0) {
      ailogger.info(`Cleaning up ${meta.resourceLocks.size} locks for transaction ${transactionId}`);

      // Release all locks for this transaction
      const releasePromises = Array.from(meta.resourceLocks).map(lockName => this.releaseApplicationLock(lockName, transactionId));

      // Wait for all releases to complete (with timeout)
      await Promise.race([Promise.all(releasePromises), new Promise((_, reject) => setTimeout(() => reject(new Error('Lock cleanup timeout')), 10000))]).catch(
        (error: unknown) => {
          const errorObj = error instanceof Error ? error : new Error(getErrorMessage(error));
          ailogger.error(`Error during lock cleanup for transaction ${transactionId}: ${getErrorMessage(error)}`, errorObj);
          // Continue anyway - locks will be auto-released when connection closes
        }
      );
    }
  }

  // Release a transaction slot from the queue (race condition fix)
  private releaseTransactionSlot(): void {
    if (this.transactionSlotQueue.length > 0) {
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

  // Acquire a connection for the current operation
  private async acquireConnectionInternal(): Promise<PoolConnection> {
    try {
      const connection = await getConn(); // Reuse getConn from processormacros
      await connection.ping(); // Validate connection
      // console.log(chalk.green('Connection validated.'));
      return connection;
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(getErrorMessage(error));
      ailogger.error(chalk.red(`Error acquiring or validating connection: ${getErrorMessage(error)}`), errorObj);
      throw error;
    }
  }
}

patchConnectionManager(ConnectionManager.getInstance());

export default ConnectionManager;
