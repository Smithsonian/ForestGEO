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

/** ER_QUERY_INTERRUPTED — the statement was KILLed (KILL QUERY, or our own timeout kill). */
export const MYSQL_ERRNO_QUERY_INTERRUPTED = 1317;

/** ER_CONNECTION_KILLED — the whole connection was KILLed; the session is gone. */
export const MYSQL_ERRNO_CONNECTION_KILLED = 1927;

/**
 * Deadline for acquiring the out-of-band connection that issues KILL QUERY.
 * The kill is best-effort: waiting longer than this for a spare connection
 * would reintroduce the unbounded wait this bound exists to prevent, and the
 * timed-out connection has already been destroyed by then anyway.
 */
const KILL_CONNECTION_ACQUIRE_TIMEOUT_MS = 5_000;

export type KillQueryOutcome =
  /** KILL QUERY was accepted by the server. */
  | { status: 'killed' }
  /** The server rejected the KILL — almost always because the statement had just finished. */
  | { status: 'statement_already_settled'; message: string }
  /** No connection was available to issue the KILL from; the statement runs on server-side. */
  | { status: 'no_kill_connection'; reason: 'timeout' | 'failed'; message: string };

/** True for the error MySQL reports on the client whose statement was KILLed. */
export function isKilledStatementError(error: unknown): boolean {
  const mysqlError = error as { code?: string; errno?: number } | null;
  return mysqlError?.code === 'ER_QUERY_INTERRUPTED' || mysqlError?.errno === MYSQL_ERRNO_QUERY_INTERRUPTED;
}

/** True for the error MySQL reports when the whole CONNECTION was KILLed. */
export function isKilledConnectionError(error: unknown): boolean {
  const mysqlError = error as { code?: string; errno?: number } | null;
  return mysqlError?.code === 'ER_CONNECTION_KILLED' || mysqlError?.errno === MYSQL_ERRNO_CONNECTION_KILLED;
}

/**
 * Abort the statement running on `threadId` by issuing KILL QUERY from a
 * SEPARATE pooled connection. Destroying the client socket alone is not
 * enough: the server may not notice the closed socket until the statement
 * finishes on its own (and, inside a CALL, commits its work). KILL QUERY stops
 * only the active statement and leaves the thread alive.
 *
 * The connection comes from PoolMonitor.tryAcquireConnection, not getConnection:
 * this path runs precisely when the pool may be saturated by stuck statements,
 * where an unbounded acquisition would hang forever and a failed one would
 * pointlessly reinitialize the whole pool.
 *
 * KILL is not preparable in MySQL, so this uses the text protocol with a
 * numeric thread id (never user input) rather than a bound parameter.
 */
export async function killQueryOnThread(threadId: number, context: string): Promise<KillQueryOutcome> {
  if (!Number.isInteger(threadId)) {
    const message = `Refusing to KILL: thread id ${threadId} is not an integer (${context})`;
    ailogger.error(message);
    return { status: 'no_kill_connection', reason: 'failed', message };
  }

  const acquisition = await getPoolMonitorInstance().tryAcquireConnection(KILL_CONNECTION_ACQUIRE_TIMEOUT_MS);

  if (acquisition.status !== 'acquired') {
    // Operationally serious: the statement keeps running server-side and keeps
    // holding its locks. This is an error, distinct from the benign "KILL raced
    // a statement that had already finished" case below.
    const detail =
      acquisition.status === 'timeout'
        ? `no pooled connection became available within ${KILL_CONNECTION_ACQUIRE_TIMEOUT_MS}ms`
        : `pool could not supply a connection: ${acquisition.error instanceof Error ? acquisition.error.message : String(acquisition.error)}`;
    const message =
      `Could not KILL QUERY thread ${threadId} (${context}): ${detail}. ` + `The statement is still executing on the server and still holds its locks.`;
    ailogger.error(chalk.red(message));
    return { status: 'no_kill_connection', reason: acquisition.status, message };
  }

  const killConnection: PoolConnection = acquisition.connection;
  try {
    await killConnection.query(`KILL QUERY ${threadId}`);
    ailogger.warn(chalk.yellow(`KILL QUERY issued for thread ${threadId} (${context})`));
    return { status: 'killed' };
  } catch (killError: unknown) {
    // Expected race, not a failure: the statement finished between the timeout
    // firing and the KILL landing, so the thread is no longer running a query.
    const message = killError instanceof Error ? killError.message : String(killError);
    ailogger.info(`KILL QUERY for thread ${threadId} was rejected — the statement had already settled (${context}): ${message}`);
    return { status: 'statement_already_settled', message };
  } finally {
    killConnection.release();
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
      // settlement either way, so it can never surface as an unhandled
      // rejection AND so the killed-too-late case is visible.
      inFlight?.then(
        () => {
          ailogger.warn(
            chalk.yellow(
              `Orphaned statement COMPLETED after query timeout — the KILL landed too late and the server ` +
                `committed its work (thread ${threadId ?? 'unknown'}). Anything that treats the timeout as ` +
                `"did not happen" is wrong for this statement. Query: ${query}`
            )
          );
        },
        (orphanError: unknown) => {
          const message = orphanError instanceof Error ? orphanError.message : String(orphanError);
          ailogger.warn(`Orphaned statement settled after query timeout (expected after KILL): ${message}`);
        }
      );
      // Quarantine BEFORE the kill, not after. destroy() frees this connection's
      // pool slot, so the KILL acquisition below is not competing with the very
      // saturation that produced the timeout — and the poisoned connection can
      // never re-enter the pool even if the KILL path throws. A later release()
      // on a destroyed connection is a safe no-op.
      connection.destroy();
      if (typeof threadId === 'number') {
        await killQueryOnThread(threadId, 'query timeout');
      }
    } else if (isKilledStatementError(error) || isKilledConnectionError(error)) {
      // A KILLed statement leaves the session in an unknown state: a stored
      // procedure's EXIT HANDLER did not complete, so its internal
      // START TRANSACTION may still be open and holding locks. Releasing that
      // connection would hand the next borrower an uncommitted transaction and
      // make the caller's very next statement lock-wait on the zombie. Quarantine
      // it here, at the DB boundary, so ConnectionManager's finally-release
      // becomes a no-op and no caller ever has to manage the raw connection.
      // A killed CONNECTION (1927) is already gone; destroying makes that explicit.
      connection.destroy();
      ailogger.warn(chalk.yellow(`Destroyed a connection whose statement was KILLed (thread ${threadId ?? 'unknown'}); it will not return to the pool.`));
    }
    ailogger.error(chalk.red(`Error executing query: ${query}`));
    ailogger.error(chalk.red('Error message:', error.message));
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
    getPoolMonitorInstance().signalActivity();
  }
}
