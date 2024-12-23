import { PoolConnection, PoolOptions } from 'mysql2/promise';
import { PoolMonitor } from '@/config/poolmonitor';

const sqlConfig: PoolOptions = {
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  host: process.env.AZURE_SQL_SERVER,
  port: parseInt(process.env.AZURE_SQL_PORT!),
  database: process.env.AZURE_SQL_CATALOG_SCHEMA,
  waitForConnections: true,
  connectionLimit: 150, // increased from 10 to prevent bottlenecks
  queueLimit: 20,
  keepAliveInitialDelay: 10000, // 0 by default.
  enableKeepAlive: true, // false by default.
  connectTimeout: 20000 // 10 seconds by default.
};
export const poolMonitor = new PoolMonitor(sqlConfig);

export async function getSqlConnection(tries: number): Promise<PoolConnection> {
  try {
    console.log(`Attempting to get SQL connection. Try number: ${tries + 1}`);

    // Check if the pool is closed and reinitialize if necessary
    if (poolMonitor.isPoolClosed()) {
      console.log('Connection pool is closed. Reinitializing...');
      await poolMonitor.reinitializePool();
    }

    const connection = await poolMonitor.getConnection();
    await connection.ping(); // Use ping to check the connection
    console.log('Connection successful');
    return connection; // Resolve the connection when successful
  } catch (err) {
    console.error(`Connection attempt ${tries + 1} failed:`, err);
    if (tries == 5) {
      console.error('!!! Cannot connect !!! Error:', err);
      throw err;
    } else {
      console.log('Retrying connection...');
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait a bit before retrying
      return getSqlConnection(tries + 1); // Retry and return the promise
    }
  }
}

export async function getConn() {
  let conn: PoolConnection | null = null;
  try {
    const i = 0;
    conn = await getSqlConnection(i);
  } catch (error: any) {
    console.error('Error processing files:', error.message);
    throw new Error(error.message);
  }
  if (!conn) {
    throw new Error('conn empty');
  }
  return conn;
}

export async function runQuery(connection: PoolConnection, query: string, params?: any[]): Promise<any> {
  try {
    // If params exist, replace any undefined values with null
    if (params) {
      params = params.map(param => (param === undefined ? null : param));
    }

    // Check if the query is for calling a stored procedure
    if (query.trim().startsWith('CALL')) {
      // Use `connection.query` for stored procedures
      const [rows] = await connection.query(query, params);
      return rows;
    } else {
      // Use `connection.execute` for standard SQL queries
      const [rows, _fields] = await connection.execute(query, params);

      // Check if the query is an INSERT, UPDATE, or DELETE
      if (query.trim().startsWith('INSERT') || query.trim().startsWith('UPDATE') || query.trim().startsWith('DELETE')) {
        return rows; // This will include insertId, affectedRows, etc.
      }
      return rows; // This is for SELECT queries and will return RowDataPacket[]
    }
  } catch (error: any) {
    console.error('Error executing query:', error.message);
    throw error;
  }
}

// process.on('SIGTERM', async () => {
//   console.log('Received SIGTERM. Closing connections...');
//   await poolMonitor.closeAllConnections();
//   process.exit(0);
// });

// process.on('SIGINT', async () => {
//   console.log('Received SIGINT. Closing connections...');
//   await poolMonitor.closeAllConnections();
//   process.exit(0);
// });
