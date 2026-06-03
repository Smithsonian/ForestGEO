import { PoolConnection } from 'mysql2/promise';
import chalk from 'chalk';
import { escape } from 'mysql2';
import { getPoolMonitorInstance } from '@/config/poolmonitorsingleton';
import ailogger from '@/ailogger';

async function getSqlConnection(tries: number): Promise<PoolConnection> {
  let connection: PoolConnection | null = null;
  let connectionAcquired = false;
  try {
    // console.log(`Attempting to get SQL connection. Try number: ${tries + 1}`);

    // Acquire the connection. The query path handles stale connection failures
    // so read-heavy routes do not pay a ping round-trip before every statement.
    connection = await getPoolMonitorInstance().getConnection();
    connectionAcquired = true;
    const conn = connection;
    connectionAcquired = false; // Successfully returning, caller now responsible
    return conn; // Resolve the connection when successful
  } catch (err: any) {
    ailogger.error(`Connection attempt ${tries + 1} failed:`, err);

    // Release connection if we acquired it but failed
    if (connectionAcquired && connection) {
      try {
        connection.release();
      } catch (releaseError: any) {
        ailogger.error('Error releasing failed connection:', releaseError);
      }
      connectionAcquired = false;
    }

    if (tries === 5) {
      ailogger.error('!!! Cannot connect !!! Error:', err);
      throw err;
    } else {
      ailogger.info('Retrying connection...');
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
    ailogger.error('Error processing files:', error.message);
    throw new Error(error.message);
  }
  if (!conn) {
    throw new Error('conn empty');
  }
  return conn;
}

export async function runQuery(connection: PoolConnection, query: string, params?: any[]): Promise<any> {
  // Must exceed the longest MySQL MAX_EXECUTION_TIME (cross-census validations
  // use 10 min).  Set to 11 min so the MySQL-level timeout fires first with a
  // proper error instead of this generic JS-level rejection.
  const QUERY_TIMEOUT_MS = 660000; // 660 seconds (11 minutes)
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('Query execution timed out')), QUERY_TIMEOUT_MS);
  });
  try {
    if (params) {
      params = params.map(param => (param === undefined ? null : param));
    }
    if (query.trim().startsWith('CALL')) {
      const [rows] = await Promise.race([connection.query(query, params), timer]);
      return rows;
    } else {
      // mysql2's execute() uses prepared statements which don't support
      // bulk INSERT ... VALUES ? with nested arrays. Use query() for those.
      const hasBulkValues = params?.some(p => Array.isArray(p) && p.length > 0 && Array.isArray(p[0]));
      const method = hasBulkValues ? connection.query.bind(connection) : connection.execute.bind(connection);
      const [rows, _fields] = await Promise.race([method(query, params), timer]);

      return rows;
    }
  } catch (error: any) {
    ailogger.error(chalk.red(`Error executing query: ${query}`));
    ailogger.error(chalk.red('Error message:', error.message));
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
    getPoolMonitorInstance().signalActivity();
  }
}
