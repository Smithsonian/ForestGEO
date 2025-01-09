import { PoolConnection, PoolOptions } from 'mysql2/promise';
import { PoolMonitor } from '@/config/poolmonitor';
import chalk from 'chalk';

const sqlConfig: PoolOptions = {
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  host: process.env.AZURE_SQL_SERVER,
  port: parseInt(process.env.AZURE_SQL_PORT!),
  database: process.env.AZURE_SQL_CATALOG_SCHEMA,
  waitForConnections: true,
  connectionLimit: 50, // Lower limit if 100 is excessive for your DB
  queueLimit: 0, // unlimited queue size
  keepAliveInitialDelay: 10000, // 0 by default.
  enableKeepAlive: true, // false by default.
  connectTimeout: 20000 // 10 seconds by default.
};
export const poolMonitor = new PoolMonitor(sqlConfig);

export async function getSqlConnection(tries: number): Promise<PoolConnection> {
  try {
    console.log(`Attempting to get SQL connection. Try number: ${tries + 1}`);

    // Acquire the connection and ping to validate it
    const connection = await poolMonitor.getConnection();
    await connection.ping(); // Use ping to check the connection
    console.log('Connection successful');
    return connection; // Resolve the connection when successful
  } catch (err) {
    console.error(`Connection attempt ${tries + 1} failed:`, err);

    if (tries === 5) {
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
  const timeout = 10000; // 10 seconds
  const timer = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Query execution timed out')), timeout));
  const startTime = Date.now();
  try {
    if (params) {
      params = params.map(param => (param === undefined ? null : param));
    }
    // Log query details
    console.log(chalk.cyan(`Executing query: ${query}`));
    if (params) {
      console.log(chalk.gray(`Query params: ${JSON.stringify(params)}`));
    }
    if (query.trim().startsWith('CALL')) {
      const [rows] = await Promise.race([connection.query(query, params), timer]);
      console.log(chalk.magenta(`CALL Query completed in ${Date.now() - startTime}ms`));
      return rows;
    } else {
      const [rows, _fields] = await Promise.race([connection.execute(query, params), timer]);
      console.log(chalk.magenta(`STANDARD Query completed in ${Date.now() - startTime}ms`));

      if (query.trim().startsWith('INSERT') || query.trim().startsWith('UPDATE') || query.trim().startsWith('DELETE')) {
        return rows;
      }
      return rows;
    }
  } catch (error: any) {
    console.error(chalk.red(`Error executing query: ${query}`));
    if (params) {
      console.error(chalk.red(`With params: ${JSON.stringify(params)}`));
    }
    console.error(chalk.red('Error message:', error.message));
    throw error;
  }
}

// process.on('SIGTERM', async () => {
//   console.log('Received SIGTERM. Closing connections...');
//   await poolMonitor.closeAllConnections();
//   process.exit(0);
// });

process.on('SIGINT', async () => {
  console.log('Received SIGINT. Closing connections...');
  await poolMonitor.closeAllConnections();
  process.exit(0);
});
