import { Pool, PoolConnection, PoolOptions, createPool } from 'mysql2/promise';

export class PoolMonitor {
  public pool: Pool;
  private activeConnections = 0;
  private totalConnectionsCreated = 0;
  private waitingForConnection = 0;
  private inactivityTimer: NodeJS.Timeout | null = null;
  private config: PoolOptions;
  private poolClosed = false;

  constructor(config: PoolOptions) {
    this.config = config;
    this.pool = createPool(config);
    this.poolClosed = false;

    this.pool.on('acquire', (connection) => {
      ++this.activeConnections;
      ++this.totalConnectionsCreated;
      console.log(`Acquired: ${connection.threadId}`);
      console.log('Connection state:', this.getPoolStatus());
      this.resetInactivityTimer();
    });

    this.pool.on('release', (connection) => {
      if (this.activeConnections > 0) {
        --this.activeConnections;
      }
      console.log(`Released: ${connection.threadId}`);
      console.log('Connection state:', this.getPoolStatus());
      this.resetInactivityTimer();
    });

    this.pool.on('connection', (connection) => {
      ++this.totalConnectionsCreated;
      console.log(`New: ${connection.threadId}`);
      console.log('Connection state:', this.getPoolStatus());
      this.resetInactivityTimer();
    });

    this.pool.on('enqueue', () => {
      ++this.waitingForConnection;
      console.log(`Enqueued.`);
      console.log('Connection state:', this.getPoolStatus());
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
      console.log('Requesting new connection...');
      const connection = await this.pool.getConnection();
      console.log('Connection acquired');
      this.resetInactivityTimer();
      return connection;
    } catch (error) {
      console.error('Error getting connection from pool:', error);
      throw error;
    }
  }

  getPoolStatus() {
    return `active: ${this.activeConnections} | total: ${this.totalConnectionsCreated} | waiting: ${this.waitingForConnection}`;
  }

  async closeAllConnections(): Promise<void> {
    try {
      console.log('Ending pool connections...');
      await this.pool.end();
      this.poolClosed = true;
      console.log('Pool connections ended.');
    } catch (error) {
      console.error('Error closing connections:', error);
      throw error;
    }
  }

  private resetInactivityTimer() {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }

    this.inactivityTimer = setTimeout(async () => {
      if (this.activeConnections === 0) {
        console.log('Inactivity period exceeded. Initiating graceful shutdown...');
        await this.closeAllConnections();
        console.log('Graceful shutdown complete.');
      }
    }, 3600000); // 1 hour in milliseconds
  }

  // New method to reinitialize the pool
  public reinitializePool() {
    console.log('Reinitializing connection pool...');
    this.pool = createPool(this.config);
    this.poolClosed = false;
    console.log('Connection pool reinitialized.');
  }

  // New method to check if the pool is closed
  public isPoolClosed(): boolean {
    return this.poolClosed;
  }
}
