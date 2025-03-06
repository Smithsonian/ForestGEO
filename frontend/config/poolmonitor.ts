import { createPool, Pool, PoolConnection, PoolOptions } from 'mysql2/promise';
import chalk from 'chalk';

export class PoolMonitor {
  public pool: Pool;
  private readonly config: PoolOptions;
  private inactivityTimer: NodeJS.Timeout | null = null;
  private poolClosed = false;
  private reinitializing = false;

  constructor(config: PoolOptions) {
    this.config = config;
    this.pool = createPool(config);
    this.poolClosed = false;

    // console.log(chalk.green('PoolMonitor initialized.'));
    this.monitorPoolHealth();
    this.resetInactivityTimer();
  }

  public async getConnection(): Promise<PoolConnection> {
    try {
      if (this.poolClosed) {
        // console.log(chalk.yellow('Reinitializing pool for new activity.'));
        await this.reinitializePool();
        ``;
      }

      // console.log(chalk.cyan('Requesting new connection...'));
      const connection = await this.pool.getConnection();
      // console.log(chalk.green(`Connection acquired: ${connection.threadId}`));
      this.resetInactivityTimer(); // Reset inactivity timer on new activity
      return connection;
    } catch (error) {
      console.error(chalk.red('Error acquiring connection:', error));
      console.warn(chalk.yellow('Reinitializing pool due to connection error.'));
      await this.reinitializePool();
      throw error;
    }
  }

  public async closeAllConnections(): Promise<void> {
    try {
      if (this.poolClosed) {
        console.log(chalk.yellow('Pool already closed.'));
        return;
      }
      console.log(chalk.yellow('Ending pool connections...'));
      await this.pool.end();
      this.poolClosed = true;
      console.log(chalk.yellow('Pool connections ended.'));
    } catch (error) {
      console.error(chalk.red('Error closing connections:', error));
      throw error;
    }
  }

  public isPoolClosed(): boolean {
    return this.poolClosed;
  }

  private async reinitializePool(): Promise<void> {
    if (this.reinitializing) return; // Prevent concurrent reinitialization
    this.reinitializing = true;

    try {
      // console.log(chalk.cyan('Reinitializing connection pool...'));
      await this.closeAllConnections();
      this.pool = createPool(this.config);
      this.poolClosed = false;
      // console.log(chalk.cyan('Connection pool reinitialized.'));
    } catch (error) {
      console.error(chalk.red('Error during reinitialization:', error));
    } finally {
      this.reinitializing = false;
    }
  }

  private async logAndReturnConnections(): Promise<{ sleeping: number[]; live: number[] }> {
    const bufferTime = 120;
    try {
      const [rows]: any[] = await this.pool.query('SELECT * FROM information_schema.processlist WHERE TIME > 60;');
      if (rows.length > 0) {
        // console.log(chalk.cyan('Active MySQL Processes:'));
        // console.table(rows);

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
      return { sleeping: [], live: [] };
    } catch (error) {
      console.error(chalk.red('Error fetching process list:', error));
      return { sleeping: [], live: [] };
    }
  }

  private async terminateSleepingConnections(): Promise<void> {
    const { sleeping } = await this.logAndReturnConnections();
    for (const id of sleeping) {
      try {
        await this.pool.query(`KILL ${id}`);
        console.log(chalk.red(`Terminated sleeping connection: ${id}`));
      } catch (error) {
        console.error(chalk.red(`Error terminating connection ${id}:`, error));
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
        console.log(chalk.red('Inactivity period exceeded and no active connections found. Initiating graceful shutdown...'));
        await this.closeAllConnections();
        // console.log(chalk.red('Graceful shutdown complete.'));
      }
    }, 3600000); // 1 hour in milliseconds
  }

  private monitorPoolHealth(): void {
    setInterval(async () => {
      try {
        const { sleeping } = await this.logAndReturnConnections();
        if (sleeping.length > 0) {
          console.log(chalk.cyan('Pool Health Check:'));
          console.log(chalk.yellow(`Sleeping connections: ${sleeping.length}`));

          if (sleeping.length > 50) {
            // Example threshold for excessive sleeping connections
            console.warn(chalk.red('Too many sleeping connections. Reinitializing pool.'));
            await this.reinitializePool();
          } else {
            await this.terminateSleepingConnections();
          }
        }
      } catch (error) {
        console.error(chalk.red('Error during pool health check:', error));
        console.warn(chalk.yellow('Attempting to reinitialize pool.'));
        await this.reinitializePool();
      }
    }, 10000); // Poll every 10 seconds
  }
}
