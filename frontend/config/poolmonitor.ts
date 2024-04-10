import mysql, {Pool, PoolConnection, PoolOptions} from 'mysql2/promise';

export class PoolMonitor {
  private pool: Pool;
  private activeConnections = 0;
  private totalConnectionsCreated = 0;
  private waitingForConnection = 0;

  constructor(config: PoolOptions) {
    this.pool = mysql.createPool(config);

    this.pool.on('acquire', (connection) => {
      this.activeConnections++;
      console.log(`Connection ${connection.threadId} acquired. Active connections: ${this.activeConnections}`);
      console.log('Connection state: ', this.getPoolStatus());
    });

    this.pool.on('release', () => {
      this.activeConnections--;
      console.log(`Connection released. Active connections: ${this.activeConnections}`);
      console.log('Connection state: ', this.getPoolStatus());
    });

    this.pool.on('connection', (connection) => {
      this.totalConnectionsCreated++;
      console.log(`New connection ${connection.threadId} made. Total connections created: ${this.totalConnectionsCreated}`);
      console.log('Connection state: ', this.getPoolStatus());
    });

    this.pool.on('enqueue', () => {
      this.waitingForConnection++;
      console.log(`Connection request queued. Waiting for connection: ${this.waitingForConnection}`);
      console.log('Connection state: ', this.getPoolStatus());
    });
  }

  async getConnection(): Promise<PoolConnection> {
    this.waitingForConnection--;
    return await this.pool.getConnection();
  }

  getPoolStatus() {
    return {
      activeConnections: this.activeConnections,
      totalConnectionsCreated: this.totalConnectionsCreated,
      waitingForConnection: this.waitingForConnection
    };
  }
}
