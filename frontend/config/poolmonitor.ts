import { createPool, Pool, PoolConnection, PoolOptions } from 'mysql2/promise';
import chalk from 'chalk';

export class PoolMonitor {
  public pool: Pool;
  private activeConnections = 0;
  private totalConnectionsCreated = 0;
  private waitingForConnection = 0;
  private inactivityTimer: NodeJS.Timeout | null = null;
  private readonly config: PoolOptions;
  private poolClosed = false;
  private acquiredConnectionIds: Set<number> = new Set();

  constructor(config: PoolOptions) {
    this.config = config;
    this.pool = createPool(config);
    this.poolClosed = false;

    this.pool.on('acquire', connection => {
      if (!this.acquiredConnectionIds.has(connection.threadId)) {
        this.acquiredConnectionIds.add(connection.threadId);
        ++this.activeConnections;
        ++this.totalConnectionsCreated;
        console.log(chalk.green(`Acquired: ${connection.threadId}`));
        this.logPoolStatus();
        this.resetInactivityTimer();
      }
    });

    this.pool.on('release', connection => {
      if (this.acquiredConnectionIds.has(connection.threadId)) {
        this.acquiredConnectionIds.delete(connection.threadId);
        if (this.activeConnections > 0) {
          --this.activeConnections;
        }
        console.log(chalk.blue(`Released: ${connection.threadId}`));
        this.logPoolStatus();
        this.resetInactivityTimer();
      }
    });

    this.pool.on('connection', connection => {
      ++this.totalConnectionsCreated;
      console.log(chalk.yellow(`New: ${connection.threadId}`));
      this.logPoolStatus();
      this.resetInactivityTimer();
    });

    this.pool.on('enqueue', () => {
      ++this.waitingForConnection;
      console.log(chalk.magenta('Enqueued.'));
      this.logPoolStatus();
      this.resetInactivityTimer();
    });

    // Initialize inactivity timer
    this.resetInactivityTimer();
  }

  async getConnection(): Promise<PoolConnection> {
    if (this.poolClosed) {
      throw new Error('Connection pool is closed');
    }

    try {
      console.log(chalk.cyan('Requesting new connection...'));
      const connection = await this.pool.getConnection();
      console.log(chalk.green('Connection acquired'));
      this.resetInactivityTimer();
      return connection;
    } catch (error) {
      console.error(chalk.red('Error getting connection from pool:', error));
      throw error;
    }
  }

  getPoolStatus() {
    return `Active: ${this.activeConnections} | Total: ${this.totalConnectionsCreated} | Waiting: ${this.waitingForConnection}`;
  }

  logPoolStatus() {
    console.log(chalk.gray(this.getPoolStatus()));
  }

  async closeAllConnections(): Promise<void> {
    try {
      console.log(chalk.yellow('Ending pool connections...'));
      await this.pool.end();
      this.poolClosed = true;
      console.log(chalk.yellow('Pool connections ended.'));
    } catch (error) {
      console.error(chalk.red('Error closing connections:', error));
      throw error;
    }
  }

  public reinitializePool() {
    console.log(chalk.cyan('Reinitializing connection pool...'));
    this.pool = createPool(this.config);
    this.poolClosed = false;
    this.acquiredConnectionIds.clear();
    console.log(chalk.cyan('Connection pool reinitialized.'));
  }

  public isPoolClosed(): boolean {
    return this.poolClosed;
  }

  private resetInactivityTimer() {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }

    this.inactivityTimer = setTimeout(async () => {
      if (this.activeConnections === 0) {
        console.log(chalk.red('Inactivity period exceeded. Initiating graceful shutdown...'));
        await this.closeAllConnections();
        console.log(chalk.red('Graceful shutdown complete.'));
      }
    }, 3600000); // 1 hour in milliseconds
  }
}
