// poolmonitor.ts
import { createPool, Pool, PoolConnection, PoolOptions } from 'mysql2/promise';
import chalk from 'chalk';
import ailogger from '@/ailogger';

export class PoolMonitor {
  public pool: Pool;
  private readonly config: PoolOptions;
  private inactivityTimer: NodeJS.Timeout | null = null;
  private healthMonitorIntervalId: NodeJS.Timeout | null = null;
  private poolClosed = false;
  private reinitializePromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;

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
    pool.on('connection', async (conn: PoolConnection) => {
      try {
        conn.query(`SET SESSION wait_timeout=600, interactive_timeout=600`);
      } catch (e: any) {
        ailogger.warn(chalk.yellow('Could not set session timeout on new conn'), e);
      }
      this.resetInactivityTimer();
    });
  }

  private async acquireConnectionFromCurrentPool(): Promise<PoolConnection> {
    const connection = await this.pool.getConnection();
    connection.on('query', () => this.resetInactivityTimer());
    connection.on('release', () => this.resetInactivityTimer());
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

  private async terminateSleepingConnections(): Promise<void> {
    const { sleeping } = await this.logAndReturnConnections();
    for (const id of sleeping) {
      try {
        await this.pool.query(`KILL ${id}`);
        ailogger.info(chalk.red(`Terminated sleeping connection: ${id}`));
      } catch (error: any) {
        ailogger.error(chalk.red(`Error terminating connection ${id}:`, error));
      }
    }
  }

  private resetInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }

    this.inactivityTimer = setTimeout(async () => {
      const { live } = await this.logAndReturnConnections();
      if (live.length === 0) {
        ailogger.info(chalk.red('Inactivity period exceeded and no active connections found. Initiating graceful shutdown...'));
        await this.closeAllConnections();
        ailogger.info(chalk.red('Graceful shutdown complete.'));
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
        const { sleeping } = await this.logAndReturnConnections();
        if (sleeping.length > 0) {
          ailogger.info(chalk.cyan('Pool Health Check:'));
          ailogger.info(chalk.yellow(`Sleeping connections: ${sleeping.length}`));

          if (sleeping.length > 10) {
            // Lowered threshold from 50 to 10 for more aggressive cleanup
            ailogger.warn(chalk.red('Too many sleeping connections. Reinitializing pool.'));
            await this.reinitializePool();
          } else if (sleeping.length > 0) {
            await this.terminateSleepingConnections();
          }
        }
      } catch (error: any) {
        ailogger.error(chalk.red('Error during pool health check:', error));
        ailogger.warn(chalk.yellow('Attempting to reinitialize pool.'));
        await this.reinitializePool();
      }
    }, 30000); // Poll every 30 seconds
  }
}
