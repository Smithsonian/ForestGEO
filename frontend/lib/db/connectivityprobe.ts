import type { Socket } from 'node:net';
import { createConnection, type Connection, type QueryError } from 'mysql2';
import ailogger from '@/ailogger';
import { buildSqlConnectionOptions } from '@/lib/db/sqlconnectionoptions';

export const HEALTH_DB_PROBE_TIMEOUT_MS = 5000;
export const HEALTH_DEEP_CACHE_MS = 10000;
const PROBE_QUERY = 'SELECT 1';
const PROBE_DEADLINE = Symbol('probe-deadline');

export type DatabaseConnectivityFailureReason = 'timeout' | 'unreachable';
export type DatabaseConnectivityOutcome =
  | { status: 'pass'; latencyMs: number }
  | { status: 'fail'; reason: DatabaseConnectivityFailureReason; latencyMs: number };

type ProbeStep = 'connect' | 'query';

interface ProbeCacheEntry {
  outcome: Promise<DatabaseConnectivityOutcome>;
  settledAt: number | null;
}

// Per process: each App Service instance and dev server has its own, and a restart empties it.
let currentProbe: ProbeCacheEntry | null = null;

/**
 * Whether this instance can open a NEW connection and run SELECT 1. It doesn't measure the app pool.
 * Single flight; a settled outcome, pass or fail, is reused for HEALTH_DEEP_CACHE_MS. Never rejects.
 */
export function probeDatabaseConnectivity(): Promise<DatabaseConnectivityOutcome> {
  if (currentProbe && (currentProbe.settledAt === null || Date.now() - currentProbe.settledAt < HEALTH_DEEP_CACHE_MS)) {
    return currentProbe.outcome;
  }
  const startedAt = Date.now();
  const entry: ProbeCacheEntry = {
    settledAt: null,
    outcome: runProbe()
      .catch(unexpectedError => recordUnexpectedFailure(unexpectedError, Date.now() - startedAt))
      .finally(() => {
        entry.settledAt = Date.now();
      })
  };
  currentProbe = entry;
  return entry.outcome;
}

/** Test seam, like resetUploadSessionReplacementMarkerCacheForTests. */
export function resetDatabaseConnectivityCacheForTests(): void {
  currentProbe = null;
}

/**
 * mysql2's Connection.destroy() only half-closes, so destroy the transport itself. That also
 * takes down a TLS wrapper and makes mysql2 fail any pending step with PROTOCOL_CONNECTION_LOST.
 */
function destroyTransport(connection: Connection): void {
  (connection as unknown as { stream: Socket }).stream.destroy();
}

function waitForHandshake(connection: Connection): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.once('connect', () => resolve());
    // `on`, not `once`, and never removed: mysql2 emits 'error' again after teardown, and an unheard 'error' throws.
    connection.on('error', reject);
  });
}

function runProbeQuery(connection: Connection): Promise<void> {
  // No mysql2 `timeout` option: the probe's deadline bounds the query, and the driver's timer can outlive a transport error.
  return new Promise((resolve, reject) => {
    connection.query(PROBE_QUERY, (error: QueryError | null) => (error ? reject(error) : resolve()));
  });
}

async function runProbe(): Promise<DatabaseConnectivityOutcome> {
  const startedAt = Date.now();
  const elapsedMs = () => Date.now() - startedAt;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof PROBE_DEADLINE>(resolve => {
    deadlineTimer = setTimeout(() => resolve(PROBE_DEADLINE), HEALTH_DB_PROBE_TIMEOUT_MS);
  });
  let connection: Connection | null = null;
  let step: ProbeStep = 'connect';
  try {
    // Inside the try: createConnection throws synchronously on a bad option.
    connection = createConnection(buildSqlConnectionOptions());
    if ((await Promise.race([waitForHandshake(connection), deadline])) === PROBE_DEADLINE) {
      return recordTimeout(connection, step, elapsedMs());
    }
    step = 'query';
    if ((await Promise.race([runProbeQuery(connection), deadline])) === PROBE_DEADLINE) {
      return recordTimeout(connection, step, elapsedMs());
    }
    // COM_QUIT is best effort: destroying the socket right after can discard it; the SELECT 1 result stands.
    connection.end();
    destroyTransport(connection);
    return { status: 'pass', latencyMs: elapsedMs() };
  } catch (driverError: unknown) {
    ailogger.error(`Database connectivity probe failed during ${step}`, driverError instanceof Error ? driverError : new Error(String(driverError)), { step });
    if (connection) destroyTransport(connection);
    return { status: 'fail', reason: 'unreachable', latencyMs: elapsedMs() };
  } finally {
    clearTimeout(deadlineTimer);
  }
}

function recordTimeout(connection: Connection, step: ProbeStep, latencyMs: number): DatabaseConnectivityOutcome {
  destroyTransport(connection);
  ailogger.error(`Database connectivity probe timed out during ${step} after ${HEALTH_DB_PROBE_TIMEOUT_MS} ms`, undefined, { step });
  return { status: 'fail', reason: 'timeout', latencyMs };
}

function recordUnexpectedFailure(unexpectedError: unknown, latencyMs: number): DatabaseConnectivityOutcome {
  ailogger.error('Database connectivity probe failed unexpectedly', unexpectedError instanceof Error ? unexpectedError : new Error(String(unexpectedError)));
  return { status: 'fail', reason: 'unreachable', latencyMs };
}
