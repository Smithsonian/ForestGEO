import mysql, { Pool, PoolConnection, PoolOptions } from 'mysql2/promise';

export class PoolMonitor {
  private pool: Pool;
  private activeConnections = 0;
  private totalConnectionsCreated = 0;
  private waitingForConnection = 0;

  constructor(config: PoolOptions) {
    this.pool = mysql.createPool(config);

    this.pool.on('acquire', (connection) => {
      this.activeConnections++;
      this.totalConnectionsCreated++;
      console.log(`Acquired: ${connection.threadId}`);
      console.log('Connection state:', this.getPoolStatus());
    });

    this.pool.on('release', () => {
      if (this.activeConnections > 0) {
        this.activeConnections--;
      }
      console.log(`Released.`);
      console.log('Connection state:', this.getPoolStatus());
    });

    this.pool.on('connection', (connection) => {
      this.totalConnectionsCreated++;
      console.log(`New: ${connection.threadId}`);
      console.log('Connection state:', this.getPoolStatus());
    });

    this.pool.on('enqueue', () => {
      this.waitingForConnection++;
      console.log(`Enqueued.`);
      console.log('Connection state:', this.getPoolStatus());
    });
  }

  async getConnection(): Promise<PoolConnection> {
    const connection = await this.pool.getConnection();
    return connection;
  }

  getPoolStatus() {
    return `active: ${this.activeConnections} | total: ${this.totalConnectionsCreated} | waiting: ${this.waitingForConnection}`; 
  }
}
