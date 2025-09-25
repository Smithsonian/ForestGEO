// connectionmanager.ts
import '@/lib/connectionlogger';
import { PoolConnection } from 'mysql2/promise';
import chalk from 'chalk';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { v4 as uuidv4 } from 'uuid';
import { patchConnectionManager } from '@/lib/connectionlogger';
import ailogger from '@/ailogger';

// at the top of connectionmanager.ts
class ObservableMap<K, V> extends Map<K, V> {
  override set(key: K, value: V): this {
    super.set(key, value);
    ailogger.info(`[transactionConnections] set ${key} → ${(value as any).threadId}`);
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
      Array.from(this.entries()).map(([id, conn]) => ({ id, threadId: (conn as any).threadId }))
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
  private applicationLocks = new Map<string, { transactionId: string; acquiredAt: number }>();
  private readonly LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for application locks

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
  public async executeQuery(query: string, params?: any[], transactionId?: string): Promise<any> {
    const connection = transactionId ? this.transactionConnections.get(transactionId) : await this.acquireConnectionInternal();

    if (!connection) {
      throw new Error(transactionId ? `No connection found for transaction: ${transactionId}` : 'Unable to acquire connection.');
    }

    try {
      return await runQuery(connection, query, params);
    } catch (error: any) {
      ailogger.error(chalk.red('Error executing query:', error));
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

          ailogger.info(chalk.green(`Transaction started: ${transactionId} (thread: ${(connection as any).threadId})`));
          return transactionId;
        } catch (error: any) {
          connection?.release();
          if (!this.isDeadlockError(error) && !this.isLockTimeoutError(error)) {
            ailogger.error(chalk.red('Error starting transaction:', error));
            throw error;
          }

          // Exponential backoff with jitter for deadlock/timeout retries
          const jitter = Math.random() * 500; // Up to 500ms jitter
          retryDelay = Math.min(retryDelay * 1.5, 5000); // Cap at 5 seconds
          const totalDelay = retryDelay + jitter;

          ailogger.warn(
            chalk.yellow(`${error.message} encountered, retrying after ${totalDelay.toFixed(0)}ms... (thread: ${(connection as any)?.threadId || 'unknown'})`)
          );
          await new Promise(resolve => setTimeout(resolve, totalDelay));
        }
      }
      throw new Error('Failed to start transaction after 30 seconds due to persistent deadlock/timeout issues.');
    } catch (e: any) {
      ailogger.error(chalk.red('Error starting transaction:', e));
      throw e;
    }
    throw new Error('Failed to start transaction after 15 seconds due to persistent deadlock issues.');
  }

  // Commit a transaction
  public async commitTransaction(transactionId: string): Promise<void> {
    const connection = this.transactionConnections.get(transactionId);

    if (!connection) {
      ailogger.warn(`Transaction with ID ${transactionId} does not exist or has already been finalized.`);
      return; // Avoid throwing an error for an already finalized transaction
    }

    try {
      await connection.commit();
      ailogger.info(chalk.green(`Transaction committed: ${transactionId} (thread: ${(connection as any).threadId})`));
    } catch (error: any) {
      ailogger.error(chalk.red('Error committing transaction:', error));
      throw error;
    } finally {
      // Clean up application locks before releasing connection
      this.cleanupApplicationLocks(transactionId);
      connection.release();
      this.transactionConnections.delete(transactionId);
    }
  }

  // Rollback a transaction
  public async rollbackTransaction(transactionId: string): Promise<void> {
    const connection = this.transactionConnections.get(transactionId);

    if (!connection) {
      ailogger.warn(`Transaction with ID ${transactionId} does not exist or has already been finalized.`);
      return; // Avoid throwing an error for an already finalized transaction
    }

    try {
      await connection.rollback();
      ailogger.warn(chalk.yellow(`Transaction rolled back: ${transactionId} (thread: ${(connection as any).threadId})`));
    } catch (error: any) {
      ailogger.error(chalk.red('Error rolling back transaction:', error));
      throw error;
    } finally {
      // Clean up application locks before releasing connection
      this.cleanupApplicationLocks(transactionId);
      connection.release();
      this.transactionConnections.delete(transactionId);
    }
  }

  // Close connection method (no-op for compatibility)
  public async closeConnection(): Promise<void> {
    // console.warn(chalk.yellow('Warning: closeConnection is deprecated for concurrency. Connections are managed dynamically and do not persist.'));
  }

  public async withTransaction<T>(fn: (transactionId: string) => Promise<T>, opts?: { timeoutMs?: number }): Promise<T> {
    const timeoutMs = opts?.timeoutMs ?? this.DEFAULT_TX_TIMEOUT_MS;

    // Check if we're at the concurrent transaction limit
    if (this.transactionConnections.size >= this.MAX_CONCURRENT_TRANSACTIONS) {
      ailogger.warn(`Transaction limit reached (${this.MAX_CONCURRENT_TRANSACTIONS}), waiting for available slot...`);

      // Wait for a transaction to complete with timeout
      const waitStart = Date.now();
      const maxWait = 60000; // 1 minute max wait

      while (this.transactionConnections.size >= this.MAX_CONCURRENT_TRANSACTIONS && Date.now() - waitStart < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Check every second
      }

      if (this.transactionConnections.size >= this.MAX_CONCURRENT_TRANSACTIONS) {
        throw new Error('Transaction slot wait timeout - too many concurrent transactions');
      }

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
      } catch (error: any) {
        retryCount++;
        if (retryCount >= maxRetries) {
          throw new Error(`Failed to start transaction after ${maxRetries} retries: ${error.message}`);
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
    } catch (configError: any) {
      ailogger.warn(`Failed to apply enhanced connection settings: ${configError.message}`);
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
            ailogger.info(`Keep-alive ping and timeout refresh for transaction ${transactionId!} (thread: ${(conn as any).threadId})`);
          }
        } catch (pingError: any) {
          ailogger.error(`Keep-alive ping failed for transaction ${transactionId!}:`, pingError);
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

    try {
      const result = (await Promise.race([fn(transactionId!), timeoutPromise])) as T;
      // success path
      if (meta.timeoutHandle) clearTimeout(meta.timeoutHandle);
      if (meta.keepAliveHandle) clearInterval(meta.keepAliveHandle);
      await this.commitTransaction(transactionId!);
      this.transactionMeta.delete(transactionId!);
      return result;
    } catch (err: any) {
      // on error / timeout
      if (meta.timeoutHandle) clearTimeout(meta.timeoutHandle);
      if (meta.keepAliveHandle) clearInterval(meta.keepAliveHandle);

      // Enhanced error logging
      ailogger.error(`Transaction ${transactionId!} failed: ${err.message}`, {
        transactionId: transactionId!,
        duration: Date.now() - meta.startedAt,
        errorType: err.constructor.name,
        isConnectionError: this.isConnectionError(err),
        isTimeoutError: this.isLockTimeoutError(err) || err.message?.includes('timed out')
      } as any);

      try {
        await this.rollbackTransaction(transactionId!);
      } catch (rbErr: any) {
        ailogger.error(`Rollback failed for transaction ${transactionId!}:`, rbErr);
      }
      this.transactionMeta.delete(transactionId!);
      throw err;
    }
  }

  public async cleanupStaleTransactions(maxAgeMs?: number): Promise<void> {
    const threshold = maxAgeMs ?? this.DEFAULT_TX_TIMEOUT_MS * 2; // e.g., twice default
    const now = Date.now();
    for (const [txId, meta] of this.transactionMeta.entries()) {
      if (now - meta.startedAt > threshold) {
        ailogger.warn(`Detected stale transaction ${txId} (age ${(now - meta.startedAt) / 1000}s), forcing rollback.`);
        try {
          await this.rollbackTransaction(txId);
        } catch (e: any) {
          ailogger.error(`Error rolling back stale transaction ${txId}:`, e);
        }
        this.transactionMeta.delete(txId);
      }
    }
  }

  // Application-level lock management
  public async acquireApplicationLock(lockName: string, transactionId: string, timeoutMs: number = this.LOCK_TIMEOUT_MS): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const existingLock = this.applicationLocks.get(lockName);

      if (!existingLock) {
        // No existing lock, acquire it
        this.applicationLocks.set(lockName, {
          transactionId,
          acquiredAt: Date.now()
        });

        const meta = this.transactionMeta.get(transactionId);
        if (meta) {
          meta.resourceLocks.add(lockName);
        }

        ailogger.info(chalk.blue(`Application lock acquired: ${lockName} by transaction ${transactionId}`));
        return true;
      } else if (existingLock.transactionId === transactionId) {
        // Same transaction already holds the lock
        return true;
      }

      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    ailogger.warn(chalk.yellow(`Failed to acquire application lock: ${lockName} within ${timeoutMs}ms`));
    return false;
  }

  public releaseApplicationLock(lockName: string, transactionId: string): void {
    const lock = this.applicationLocks.get(lockName);
    if (lock && lock.transactionId === transactionId) {
      this.applicationLocks.delete(lockName);

      const meta = this.transactionMeta.get(transactionId);
      if (meta) {
        meta.resourceLocks.delete(lockName);
      }

      ailogger.info(chalk.blue(`Application lock released: ${lockName} by transaction ${transactionId}`));
    }
  }

  private cleanupApplicationLocks(transactionId: string): void {
    const meta = this.transactionMeta.get(transactionId);
    if (meta) {
      for (const lockName of meta.resourceLocks) {
        this.releaseApplicationLock(lockName, transactionId);
      }
    }
  }

  // Helper methods to detect various MySQL errors
  private isDeadlockError(error: any): boolean {
    return error && (error.code === 'ER_LOCK_DEADLOCK' || error.errno === 1213 || error.message?.includes('Deadlock found when trying to get lock'));
  }

  private isLockTimeoutError(error: any): boolean {
    return error && (error.code === 'ER_LOCK_WAIT_TIMEOUT' || error.errno === 1205 || error.message?.includes('Lock wait timeout exceeded'));
  }

  private isConnectionError(error: any): boolean {
    return (
      error &&
      (error.code === 'ECONNRESET' ||
        error.code === 'PROTOCOL_CONNECTION_LOST' ||
        error.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR' ||
        error.code === 'ER_CONNECTION_KILLED' ||
        error.errno === 1927 || // Connection was killed
        error.errno === 2013 || // Lost connection to MySQL server during query
        error.message?.includes('Connection lost') ||
        error.message?.includes('server has gone away') ||
        error.message?.includes('Connection was killed'))
    );
  }

  // Acquire a connection for the current operation
  private async acquireConnectionInternal(): Promise<PoolConnection> {
    try {
      const connection = await getConn(); // Reuse getConn from processormacros
      await connection.ping(); // Validate connection
      // console.log(chalk.green('Connection validated.'));
      return connection;
    } catch (error: any) {
      ailogger.error(chalk.red('Error acquiring or validating connection:', error));
      throw error;
    }
  }
}

patchConnectionManager(ConnectionManager.getInstance());

export default ConnectionManager;
