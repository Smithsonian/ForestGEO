// poolmonitor.ts
import { createPool, Pool, PoolConnection, PoolOptions } from 'mysql2/promise';
import chalk from 'chalk';
import ailogger from '@/ailogger';

/** Sentinel the acquisition race resolves with when the deadline wins. */
const ACQUISITION_DEADLINE = Symbol('acquisition-deadline');

/**
 * Result of {@link PoolMonitor.tryAcquireConnection}. `timeout` and `failed` are
 * kept distinct because they mean different things operationally: a timeout is
 * the pool being saturated (expected under the very conditions the kill path
 * runs in), a failure is the pool being unable to hand out connections at all.
 */
export type BoundedAcquisition = { status: 'acquired'; connection: PoolConnection } | { status: 'timeout' } | { status: 'failed'; error: unknown };

export class PoolMonitor {
  public pool: Pool;
  private readonly config: PoolOptions;
  private inactivityTimer: NodeJS.Timeout | null = null;
  private healthMonitorIntervalId: NodeJS.Timeout | null = null;
  private poolClosed = false;
  private reinitializePromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  // mysql2 recycles physical PoolConnection objects across acquire/release, so guard
  // against re-attaching the same 'query'/'release' listeners on every acquire (which
  // would accumulate without bound -> MaxListenersExceededWarning + memory leak). A
  // WeakSet lets GC'd/destroyed connections drop out automatically.
  private readonly connectionsWithListeners = new WeakSet<PoolConnection>();

  constructor(config: PoolOptions) {
    this.config = config;
    this.pool = this.createManagedPool();
    this.poolClosed = false;
    ailogger.info(chalk.cyan('PoolMonitor initialized.'));
    this.attachPoolListeners(this.pool);

    this.monitorPoolHealth();
    this.resetInactivityTimer();
  }

  public async getConnection(): Promise<PoolConnection> {
    let connection: PoolConnection | null = null;
    let connectionAcquired = false;

    try {
      if (this.poolClosed) {
        await this.reinitializePool();
      }

      connection = await this.acquireConnectionFromCurrentPool();
      connectionAcquired = true;

      connectionAcquired = false; // Successfully returning, caller now responsible
      return connection;
    } catch (error: any) {
      ailogger.error(chalk.red('Error acquiring connection:', error));

      // Release connection if we acquired it but failed to configure it
      if (connectionAcquired && connection) {
        try {
          connection.release();
        } catch (releaseError) {
          ailogger.error(chalk.red('Error releasing failed connection:', releaseError));
        }
      }

      ailogger.warn(chalk.yellow('Reinitializing pool due to connection error.'));
      await this.reinitializePool();

      connection = await this.acquireConnectionFromCurrentPool();
      return connection;
    }
  }

  /**
   * Acquire a connection for an OUT-OF-BAND statement — today, the `KILL QUERY`
   * that aborts a timed-out statement — under a hard deadline, and deliberately
   * WITHOUT {@link getConnection}'s recovery behaviour.
   *
   * Two properties this has and getConnection does not:
   *
   *  - **Bounded.** `createManagedPool` forces `queueLimit: 0` (unlimited wait),
   *    so when every pooled connection is checked out on stuck statements — the
   *    exact regime the kill path exists for — `getConnection()` queues forever
   *    and the caller hangs with it.
   *  - **No pool reinitialization.** getConnection() treats an acquisition
   *    failure as pool sickness and reinitializes the whole pool. Failing to get
   *    a spare connection for a best-effort KILL is an expected outcome under
   *    saturation, not evidence that the pool is broken; tearing it down would
   *    punish every healthy in-flight query.
   *
   * A losing acquisition is NOT abandoned: mysql2 keeps it queued and will hand
   * it a real connection later, which nothing would ever release. The late
   * arrival is returned to the pool instead.
   */
  public async tryAcquireConnection(timeoutMs: number): Promise<BoundedAcquisition> {
    if (this.poolClosed) {
      return { status: 'failed', error: new Error('Pool is closed; not acquiring an out-of-band connection.') };
    }

    let deadlinePassed = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    const acquisition = this.pool.getConnection();

    // Attached BEFORE the race so this handler runs first when the acquisition
    // wins: deadlinePassed is still false then, and the connection is handed to
    // the caller rather than released out from under it.
    void acquisition.then(
      connection => {
        if (deadlinePassed) this.disposeLateAcquisition(connection);
      },
      () => undefined // a rejection after the deadline is already reported below
    );

    try {
      const timer = new Promise<typeof ACQUISITION_DEADLINE>(resolve => {
        timeoutHandle = setTimeout(() => resolve(ACQUISITION_DEADLINE), timeoutMs);
      });
      const winner = await Promise.race([acquisition, timer]);
      if (winner === ACQUISITION_DEADLINE) {
        deadlinePassed = true;
        return { status: 'timeout' };
      }
      return { status: 'acquired', connection: winner };
    } catch (error: unknown) {
      deadlinePassed = true;
      return { status: 'failed', error };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private disposeLateAcquisition(connection: PoolConnection): void {
    try {
      connection.release();
      ailogger.info(chalk.cyan('Released an out-of-band connection that arrived after its acquisition deadline.'));
    } catch (releaseError: unknown) {
      ailogger.warn(chalk.yellow(`Could not release a late out-of-band connection; destroying it: ${releaseError}`));
      try {
        connection.destroy();
      } catch {
        // Nothing further to do: the connection is unreachable either way.
      }
    }
  }

  public async closeAllConnections(): Promise<void> {
    // Race condition fix: if close is already in progress, wait for it
    if (this.closePromise) {
      await this.closePromise;
      return;
    }

    // Atomic check-and-set for poolClosed flag
    if (this.poolClosed) {
      ailogger.info(chalk.yellow('Pool already closed.'));
      return;
    }

    // Store the close promise so concurrent calls wait
    this.closePromise = this._doCloseAllConnections();

    try {
      await this.closePromise;
    } finally {
      this.closePromise = null;
    }
  }

  private async _doCloseAllConnections(): Promise<void> {
    try {
      // Clear health monitor interval to prevent memory leak
      if (this.healthMonitorIntervalId) {
        clearInterval(this.healthMonitorIntervalId);
        this.healthMonitorIntervalId = null;
      }

      // Clear inactivity timer
      if (this.inactivityTimer) {
        clearTimeout(this.inactivityTimer);
        this.inactivityTimer = null;
      }

      ailogger.info(chalk.yellow('Ending pool connections...'));
      await this.pool.end();
      ailogger.info(chalk.yellow('Pool connections ended.'));
    } catch (error: any) {
      if (this.isPoolClosedError(error)) {
        ailogger.warn(chalk.yellow('Pool was already closed while ending connections.'));
      } else {
        ailogger.error(chalk.red('Error closing connections:', error));
        throw error;
      }
    } finally {
      this.poolClosed = true;
    }
  }

  public isPoolClosed(): boolean {
    return this.poolClosed;
  }

  public signalActivity() {
    this.resetInactivityTimer();
  }

  private async reinitializePool(): Promise<void> {
    // Race condition fix: if reinitialize is already in progress, wait for it
    if (this.reinitializePromise) {
      await this.reinitializePromise;
      return;
    }

    // Store the reinitialize promise so concurrent calls wait
    this.reinitializePromise = this._doReinitializePool();

    try {
      await this.reinitializePromise;
    } finally {
      this.reinitializePromise = null;
    }
  }

  private async _doReinitializePool(): Promise<void> {
    try {
      ailogger.info(chalk.cyan('Reinitializing connection pool...'));
      await this.closeAllConnections();
      this.pool = this.createManagedPool();
      this.poolClosed = false;
      this.attachPoolListeners(this.pool);
      this.monitorPoolHealth();
      this.resetInactivityTimer();
      ailogger.info(chalk.cyan('Connection pool reinitialized.'));
    } catch (error: any) {
      ailogger.error(chalk.red('Error during reinitialization:', error));
      throw error;
    }
  }

  private createManagedPool(): Pool {
    return createPool({
      ...this.config,
      waitForConnections: true,
      connectionLimit: this.config.connectionLimit ?? 30,
      queueLimit: 0
    });
  }

  private attachPoolListeners(pool: Pool): void {
    // mysql2's PromisePool forwards the underlying callback-style connection
    // to this event. Awaiting conn.query() here calls .then() on a Query object
    // and emits mysql2's "use promise wrapper" warning on every new session.
    pool.on('connection', (conn: PoolConnection) => {
      const callbackConnection = conn as unknown as {
        query: (sql: string, callback: (error?: Error | null) => void) => void;
      };
      callbackConnection.query(`SET SESSION wait_timeout=600, interactive_timeout=600`, error => {
        if (error) ailogger.warn(chalk.yellow('Could not set session timeout on new conn'), error);
      });
      this.resetInactivityTimer();
    });
  }

  private async acquireConnectionFromCurrentPool(): Promise<PoolConnection> {
    const connection = await this.pool.getConnection();
    if (!this.connectionsWithListeners.has(connection)) {
      connection.on('query', () => this.resetInactivityTimer());
      connection.on('release', () => this.resetInactivityTimer());
      this.connectionsWithListeners.add(connection);
    }
    return connection;
  }

  private isPoolClosedError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('Pool is closed');
  }

  private async logAndReturnConnections(): Promise<{ sleeping: number[]; live: number[] }> {
    const bufferTime = 120; // 2 minutes - reasonable time after transaction completion
    try {
      if (!this.isPoolClosed() && process.env.AZURE_SQL_SERVER !== '127.0.0.1') {
        // resolving econnrefused error
        // only log if pool is not closed
        const [rows]: any[] = await this.pool.query(`SELECT * FROM information_schema.processlist WHERE INFO IS NULL AND USER <> 'event_scheduler';`);
        if (rows.length > 0) {
          ailogger.info(chalk.cyan(`Active MySQL Processes: ${rows.length}`));

          const { liveIds, sleepingIds } = rows.reduce(
            (acc: any, process: any) => {
              if (process.COMMAND !== 'Sleep') {
                acc.liveIds.push(process.ID);
              } else if (process.COMMAND === 'Sleep' && process.TIME > bufferTime) {
                acc.sleepingIds.push(process.ID);
              }
              return acc;
            },
            { liveIds: [], sleepingIds: [] }
          );

          return { sleeping: sleepingIds, live: liveIds };
        }
      }
      return { sleeping: [], live: [] };
    } catch (error: any) {
      ailogger.error(chalk.red('Error fetching process list:', error));
      return { sleeping: [], live: [] };
    }
  }

  private resetInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }

    this.inactivityTimer = setTimeout(async () => {
      const { live } = await this.logAndReturnConnections();

      // Check ConnectionManager for active transactions — a long-running stored
      // procedure (e.g. cross-census validation on 200K+ rows) won't appear in the
      // processlist query (INFO IS NULL filter excludes executing queries) but still
      // holds a transaction that must not be interrupted by pool shutdown.
      let hasActiveTransactions = false;
      try {
        const ConnectionManager = (await import('./connectionmanager')).default;
        hasActiveTransactions = ConnectionManager.getInstance().hasActiveTransactions();
      } catch {
        // ConnectionManager not available — proceed with processlist check only.
      }

      if (live.length === 0 && !hasActiveTransactions) {
        ailogger.info(chalk.red('Inactivity period exceeded and no active connections found. Initiating graceful shutdown...'));
        await this.closeAllConnections();
        ailogger.info(chalk.red('Graceful shutdown complete.'));
      } else if (hasActiveTransactions) {
        ailogger.info(chalk.yellow('Inactivity timer fired but active transactions exist — deferring shutdown.'));
        this.resetInactivityTimer();
      }
    }, 3600000); // 1 hour in milliseconds
  }

  private monitorPoolHealth(): void {
    // Clear any existing health monitor interval before creating a new one
    if (this.healthMonitorIntervalId) {
      clearInterval(this.healthMonitorIntervalId);
    }

    // Store interval ID for cleanup
    this.healthMonitorIntervalId = setInterval(async () => {
      try {
        const { sleeping, live } = await this.logAndReturnConnections();
        if (sleeping.length > 0) {
          ailogger.info(chalk.cyan('Pool Health Check:'));
          ailogger.info(chalk.yellow(`Sleeping connections: ${sleeping.length}`));
          ailogger.info(chalk.cyan(`Live connections: ${live.length}`));
        }
      } catch (error: any) {
        ailogger.error(chalk.red('Error during pool health check:', error));
        if (this.poolClosed || this.isPoolClosedError(error)) {
          ailogger.warn(chalk.yellow('Pool health check found a closed pool. Reinitializing pool.'));
          await this.reinitializePool();
        }
      }
    }, 30000); // Poll every 30 seconds
  }
}
