import { PoolConnection } from 'mysql2/promise';
import chalk from 'chalk';
import { escape } from 'mysql2';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import ailogger from '@/ailogger';

// JS-side backstop for statements MySQL cannot bound on its own:
// MAX_EXECUTION_TIME applies only to top-level SELECTs, so a long CALL or
// INSERT ... SELECT has NO server-side timeout. Kept above the longest
// legitimate statement (cross-census validation SELECTs run with a 10-minute
// MAX_EXECUTION_TIME) so the server-side limit still fires first where one exists.
const DEFAULT_QUERY_TIMEOUT_MS = 660000; // 660 seconds (11 minutes)

export class QueryTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly threadId: number | undefined;

  constructor(timeoutMs: number, threadId: number | undefined) {
    super(`Query execution timed out after ${timeoutMs}ms (thread ${threadId ?? 'unknown'})`);
    this.name = 'QueryTimeoutError';
    this.timeoutMs = timeoutMs;
    this.threadId = threadId;
  }
}

type PoolConnectionWithThreadId = PoolConnection & { threadId?: number };

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

/**
 * Abort the statement running on `threadId` by issuing KILL QUERY from a
 * SEPARATE pooled connection. Destroying the client socket alone is not
 * enough: the server may not notice the closed socket until the statement
 * finishes on its own (and, inside a CALL, commits its work). KILL QUERY stops
 * only the active statement and leaves the thread alive.
 *
 * KILL is not preparable in MySQL, so this uses the text protocol with a
 * numeric thread id (never user input) rather than a bound parameter.
 */
export async function killQueryOnThread(threadId: number, context: string): Promise<void> {
  if (!Number.isInteger(threadId)) return;
  let killConnection: PoolConnection | null = null;
  try {
    killConnection = await getPoolMonitorInstance().getConnection();
    await killConnection.query(`KILL QUERY ${threadId}`);
    ailogger.warn(chalk.yellow(`KILL QUERY issued for thread ${threadId} (${context})`));
  } catch (killError: unknown) {
    // The statement may have just finished (thread no longer running a query)
    // — KILL then errors harmlessly. Log and let the caller proceed regardless.
    const message = killError instanceof Error ? killError.message : String(killError);
    ailogger.warn(`KILL QUERY for thread ${threadId} failed (may have already completed): ${message}`);
  } finally {
    killConnection?.release();
  }
}

export async function runQuery(connection: PoolConnection, query: string, params?: any[], timeoutMs: number = DEFAULT_QUERY_TIMEOUT_MS): Promise<any> {
  const threadId = (connection as PoolConnectionWithThreadId).threadId;
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new QueryTimeoutError(timeoutMs, threadId)), timeoutMs);
  });
  let inFlight: Promise<unknown> | undefined;
  try {
    if (params) {
      params = params.map(param => (param === undefined ? null : param));
    }
    // mysql2's execute() uses prepared statements, which don't support
    // bulk INSERT ... VALUES ? with nested arrays or CALL. Use query() for those.
    const hasBulkValues = params?.some(p => Array.isArray(p) && p.length > 0 && Array.isArray(p[0]));
    const useTextProtocol = query.trim().startsWith('CALL') || hasBulkValues;
    inFlight = useTextProtocol ? connection.query(query, params) : connection.execute(query, params);
    const [rows] = (await Promise.race([inFlight, timer])) as [any, unknown];
    return rows;
  } catch (error: any) {
    if (error instanceof QueryTimeoutError) {
      // The raced statement is still executing server-side. Log its eventual
      // settlement (expected: ER_QUERY_INTERRUPTED from the KILL below) so it
      // can never surface as an unhandled rejection.
      inFlight?.catch((orphanError: unknown) => {
        const message = orphanError instanceof Error ? orphanError.message : String(orphanError);
        ailogger.warn(`Orphaned statement settled after query timeout (expected after KILL): ${message}`);
      });
      if (typeof threadId === 'number') {
        await killQueryOnThread(threadId, 'query timeout');
      }
      // Quarantine: a connection with a statement in flight must never re-enter
      // the pool — the next borrower's commands would queue behind it. destroy()
      // removes it from the pool; a later release() on it is a safe no-op.
      connection.destroy();
    }
    ailogger.error(chalk.red(`Error executing query: ${query}`));
    ailogger.error(chalk.red('Error message:', error.message));
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
    getPoolMonitorInstance().signalActivity();
  }
}
