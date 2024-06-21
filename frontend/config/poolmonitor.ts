import { Pool, PoolConnection, PoolOptions, createPool } from 'mysql2/promise';

export class PoolMonitor {
  public pool: Pool; // Make pool public to access it in shutdown script
  private activeConnections = 0;
  private totalConnectionsCreated = 0;
  private waitingForConnection = 0;

  constructor(config: PoolOptions) {
    this.pool = createPool(config);

    this.pool.on('acquire', (connection) => {
      this.activeConnections++;
      this.totalConnectionsCreated++;
      console.log(`Acquired: ${connection.threadId}`);
      console.log('Connection state:', this.getPoolStatus());
    });

    this.pool.on('release', (connection) => {
      if (this.activeConnections > 0) {
        this.activeConnections--;
      }
      console.log(`Released: ${connection.threadId}`);
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
    try {
      console.log('Requesting new connection...');
      const connection = await this.pool.getConnection();
      console.log('Connection acquired');
      return connection;
    } catch (error) {
      console.error('Error getting connection from pool:', error);
      throw error;
    }
  }

  getPoolStatus() {
    return `active: ${this.activeConnections} | total: ${this.totalConnectionsCreated} | waiting: ${this.waitingForConnection}`;
  }
}

const sqlConfig: PoolOptions = {
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  host: process.env.AZURE_SQL_SERVER,
  port: parseInt(process.env.AZURE_SQL_PORT!, 10),
  database: process.env.AZURE_SQL_CATALOG_SCHEMA,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

export const poolMonitor = new PoolMonitor(sqlConfig);
