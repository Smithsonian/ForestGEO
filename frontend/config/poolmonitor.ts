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
  private reinitializing = false;
  private unreleasedConnections: Set<number> = new Set();
  private activeConnectionMap: Map<number, PoolConnection> = new Map();

  constructor(config: PoolOptions) {
    this.config = config;
    this.pool = createPool(config);
    this.poolClosed = false;

    // this.pool.on('acquire', connection => {
    //   if (!this.acquiredConnectionIds.has(connection.threadId)) {
    //     this.acquiredConnectionIds.add(connection.threadId);
    //     this.activeConnections = this.acquiredConnectionIds.size;
    //   }
    //   if (this.waitingForConnection > 0) {
    //     --this.waitingForConnection;
    //   }
    //   this.logPoolStatus();
    // });

    this.pool.on('release', connection => {
      if (this.acquiredConnectionIds.has(connection.threadId)) {
        this.acquiredConnectionIds.delete(connection.threadId);
        this.activeConnections = this.acquiredConnectionIds.size;
        this.trackConnectionRelease(connection); // Track released connection
        console.log(chalk.blue(`Released: ${connection.threadId}`));
        this.logPoolStatus();
        this.resetInactivityTimer();
      }
    });

    this.pool.on('connection', connection => {
      if (!this.acquiredConnectionIds.has(connection.threadId)) {
        this.acquiredConnectionIds.add(connection.threadId);
        this.activeConnections = this.acquiredConnectionIds.size;
      }
      if (this.waitingForConnection > 0) {
        --this.waitingForConnection;
      }
      ++this.totalConnectionsCreated;
      console.log(chalk.yellow(`New: ${connection.threadId}`));
      this.logPoolStatus();
      this.resetInactivityTimer();
    });

    this.pool.on('enqueue', () => {
      ++this.waitingForConnection; // Increment when a request is queued
      console.log(chalk.magenta('Enqueued.'));
      this.logPoolStatus();
    });

    this.monitorPoolHealth();
    this.monitorUnreleasedConnections();
    this.resetInactivityTimer();
  }

  public async getConnection(): Promise<PoolConnection> {
    try {
      console.log(chalk.cyan('Requesting new connection...'));
      const connection = await this.pool.getConnection();
      this.trackConnectionAcquire(connection);
      console.log(chalk.green(`Connection acquired: ${connection.threadId}`));
      return connection;
    } catch (error) {
      console.error(chalk.red('Error acquiring connection:', error));
      throw error;
    }
  }

  getPoolStatus() {
    return `Active: ${this.activeConnections} | Total: ${this.totalConnectionsCreated} | Queued: ${this.waitingForConnection}`;
  }

  logPoolStatus() {
    console.log(chalk.gray(this.getPoolStatus()));
  }

  async closeAllConnections(): Promise<void> {
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

  async reinitializePool(): Promise<void> {
    if (this.reinitializing) return; // Prevent concurrent reinitialization
    this.reinitializing = true;

    try {
      console.log(chalk.cyan('Reinitializing connection pool...'));
      await this.closeAllConnections(); // Ensure old pool is closed
      this.pool = createPool(this.config);
      this.poolClosed = false;
      this.acquiredConnectionIds.clear(); // Clear active connection tracking
      this.unreleasedConnections.clear(); // Clear unreleased connections
      console.log(chalk.cyan('Connection pool reinitialized.'));
    } catch (error) {
      console.error(chalk.red('Error during reinitialization:', error));
    } finally {
      this.reinitializing = false;
    }
  }

  public trackConnectionAcquire(connection: PoolConnection): void {
    this.unreleasedConnections.add(connection.threadId);
    this.activeConnectionMap.set(connection.threadId, connection);
    console.log(chalk.green(`Connection acquired and tracked: ${connection.threadId}`));
  }

  public trackConnectionRelease(connection: PoolConnection): void {
    if (this.unreleasedConnections.has(connection.threadId)) {
      this.unreleasedConnections.delete(connection.threadId);
      this.activeConnectionMap.delete(connection.threadId);
      console.log(chalk.blue(`Connection released: ${connection.threadId}`));
    } else {
      console.warn(chalk.yellow(`Connection ${connection.threadId} was not tracked or already released.`));
    }
  }

  public logUnreleasedConnections(): void {
    if (this.unreleasedConnections.size > 0) {
      console.warn(chalk.red(`Unreleased connections: ${Array.from(this.unreleasedConnections).join(', ')}`));
    }
  }

  public monitorPoolHealth(): void {
    setInterval(() => {
      this.logPoolStatus();
      this.logUnreleasedConnections();
    }, 10000); // Log every 10 seconds
  }

  public monitorUnreleasedConnections(): void {
    setInterval(() => {
      if (this.unreleasedConnections.size > 0) {
        console.warn(chalk.red(`Unreleased connections detected: ${Array.from(this.unreleasedConnections).join(', ')}`));
        for (const threadId of this.unreleasedConnections) {
          const connection = this.activeConnectionMap.get(threadId);
          if (connection) {
            console.warn(chalk.yellow(`Force-closing connection: ${threadId}`));
            connection.destroy(); // Immediately terminate the connection
            this.trackConnectionRelease(connection); // Ensure it is removed from tracking
          }
        }
      }
    }, 60000); // Check every 1 minute
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
