import { createHash } from 'node:crypto';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { DEFAULT_TEST_CONFIG } from '../../setup/local-db-setup';

export const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '::1'];
export const CONNECTION_CHARSET = 'UTF8MB4_0900_AI_CI';
const SCHEMA_OWNER_LOCK_NO_WAIT_SECONDS = 0;
const LOCK_ACQUIRED = 1;
const MYSQL_NO_SUCH_THREAD = 'ER_NO_SUCH_THREAD';
const SQL_PREVIEW_LENGTH = 100;

export interface BenchmarkSchemaSession {
  readonly schema: string;
  readonly lockName: string;
  readonly logPrefix: string;
  setupConnection: Connection | null;
  schemaOwnerConnection: Connection | null;
  readonly rawConnections: Connection[];
  readonly extraThreadIds: () => number[];
}

export function createBenchmarkSchemaSession(options: {
  schema: string;
  lockName: string;
  logPrefix: string;
  extraThreadIds?: () => number[];
}): BenchmarkSchemaSession {
  return { ...options, setupConnection: null, schemaOwnerConnection: null, rawConnections: [], extraThreadIds: options.extraThreadIds ?? (() => []) };
}

// Settling (spec Benchmark §2): all three readings under their thresholds for three consecutive polls.
const SETTLE_POLL_INTERVAL_MS = 10_000;
const SETTLE_DEADLINE_MS = 15 * 60 * 1000;
const SETTLE_CONSECUTIVE_POLLS = 3;
const SETTLE_MAX_FRACTION_OF_POOL = 0.01;
const SETTLE_MAX_HISTORY_LENGTH = 1_000;
const SETTLE_METRICS = ['ibuf_size', 'trx_rseg_history_len', 'buffer_pool_pages_dirty', 'buffer_pool_pages_total'] as const;

// A session doing anything but sleeping on the shared MySQL would skew the timings.
const IDLE_COMMANDS = ['Sleep', 'Daemon'];
const DAEMON_USERS = ['event_scheduler', 'system user'];

export interface SettleReading {
  ibufSizePages: number;
  historyLength: number;
  dirtyPages: number;
  poolPages: number;
}

export function assertLocalHostsOrRefuse(): void {
  const appHost = process.env.AZURE_SQL_SERVER;
  if (!appHost || !LOCAL_HOSTS.includes(appHost)) throw new Error(`REFUSING TO RUN: AZURE_SQL_SERVER is '${appHost}', not local.`);
  if (!LOCAL_HOSTS.includes(DEFAULT_TEST_CONFIG.host)) throw new Error(`REFUSING TO RUN: TEST_DB_HOST is '${DEFAULT_TEST_CONFIG.host}', not local.`);
}

export async function acquireBenchSchemaOwnership(session: BenchmarkSchemaSession): Promise<void> {
  const ownerConnection = await mysql.createConnection({
    host: DEFAULT_TEST_CONFIG.host,
    port: DEFAULT_TEST_CONFIG.port,
    user: DEFAULT_TEST_CONFIG.user,
    password: DEFAULT_TEST_CONFIG.password
  });
  try {
    const [[lockRow]] = await ownerConnection.query<RowDataPacket[]>('SELECT GET_LOCK(?, ?) AS acquired', [
      session.lockName,
      SCHEMA_OWNER_LOCK_NO_WAIT_SECONDS
    ]);
    if (lockRow.acquired !== LOCK_ACQUIRED) {
      throw new Error(
        `REFUSING TO RUN: another benchmark holds the '${session.lockName}' lock, so it owns ${session.schema}; dropping it would destroy that run (GET_LOCK returned ${String(lockRow.acquired)})`
      );
    }
  } catch (error: unknown) {
    ownerConnection.destroy();
    throw error;
  }
  session.schemaOwnerConnection = ownerConnection;
}

export async function openRawConnection(session: BenchmarkSchemaSession): Promise<Connection> {
  const connection = await mysql.createConnection({
    host: DEFAULT_TEST_CONFIG.host,
    port: DEFAULT_TEST_CONFIG.port,
    user: DEFAULT_TEST_CONFIG.user,
    password: DEFAULT_TEST_CONFIG.password,
    timezone: DEFAULT_TEST_CONFIG.timezone,
    database: session.schema,
    charset: CONNECTION_CHARSET
  });
  session.rawConnections.push(connection);
  return connection;
}

function isNoSuchThreadError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === MYSQL_NO_SUCH_THREAD;
}

// Every step runs even if an earlier one throws; the errors are collected and rethrown together, never swallowed.
// Only the lock owner may touch session.schema, and the lock is released last so no other run can start while this one drops it.
export async function killDropAndClose(session: BenchmarkSchemaSession, closeExtra?: () => Promise<void>): Promise<void> {
  const cleanupErrors: unknown[] = [];
  try {
    if (session.setupConnection && session.schemaOwnerConnection) {
      for (const threadId of [...session.rawConnections.map(connection => connection.threadId), ...session.extraThreadIds()]) {
        try {
          await session.setupConnection.query('KILL ?', [threadId]);
        } catch (error: unknown) {
          if (!isNoSuchThreadError(error)) cleanupErrors.push(error);
        }
      }
      try {
        await session.setupConnection.query('DROP DATABASE IF EXISTS ??', [session.schema]);
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
    }
  } finally {
    session.setupConnection?.destroy();
    for (const connection of session.rawConnections) connection.destroy();
  }
  if (closeExtra) {
    try {
      await closeExtra();
    } catch (error: unknown) {
      cleanupErrors.push(error);
    }
  }
  if (session.schemaOwnerConnection) {
    try {
      await session.schemaOwnerConnection.query('SELECT RELEASE_LOCK(?)', [session.lockName]);
    } catch (error: unknown) {
      cleanupErrors.push(error);
    } finally {
      session.schemaOwnerConnection.destroy();
      session.schemaOwnerConnection = null;
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `Benchmark cleanup failed; check for a leftover ${session.schema} schema on the local MySQL`);
  }
}

export function harnessThreadIds(session: BenchmarkSchemaSession): number[] {
  return [session.setupConnection, session.schemaOwnerConnection, ...session.rawConnections]
    .filter((connection): connection is Connection => connection !== null)
    .map(connection => connection.threadId)
    .concat(session.extraThreadIds());
}

export async function assertNoOtherActiveSession(session: BenchmarkSchemaSession, conn: Connection): Promise<void> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT ID, USER, DB, COMMAND, TIME, STATE, LEFT(INFO, ?) AS INFO
       FROM information_schema.PROCESSLIST
      WHERE COMMAND NOT IN (?) AND USER NOT IN (?) AND ID NOT IN (?)`,
    [SQL_PREVIEW_LENGTH, IDLE_COMMANDS, DAEMON_USERS, harnessThreadIds(session)]
  );
  if (rows.length > 0) throw new Error(`REFUSING TO RUN: other sessions are active on the local MySQL: ${JSON.stringify(rows)}`);
}

// Reading each secondary index once merges the change buffer for its pages.
export async function readSecondaryIndexes(conn: Connection, tables: readonly string[]): Promise<void> {
  const [indexes] = await conn.query<RowDataPacket[]>(
    `SELECT DISTINCT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) AND INDEX_NAME <> 'PRIMARY'`,
    [tables]
  );
  for (const { TABLE_NAME: tableName, INDEX_NAME: indexName } of indexes) {
    await conn.query('SELECT COUNT(*) AS n FROM ?? FORCE INDEX (??)', [tableName, indexName]);
  }
}

export async function freezeTableStatistics(conn: Connection): Promise<void> {
  const [tables] = await conn.query<RowDataPacket[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND ENGINE = 'InnoDB'`
  );
  for (const { TABLE_NAME: tableName } of tables) {
    await conn.query(`ALTER TABLE ?? STATS_AUTO_RECALC = 0`, [tableName]);
    await conn.query(`ANALYZE TABLE ??`, [tableName]);
  }
}

async function readSettleMetrics(conn: Connection): Promise<SettleReading> {
  const [rows] = await conn.query<RowDataPacket[]>('SELECT NAME, COUNT FROM information_schema.INNODB_METRICS WHERE NAME IN (?)', [SETTLE_METRICS]);
  const counts = new Map(rows.map(row => [String(row.NAME), Number(row.COUNT)]));
  const missing = SETTLE_METRICS.filter(name => !counts.has(name));
  if (missing.length > 0) throw new Error(`INNODB_METRICS does not report ${missing.join(', ')}; enable them before benchmarking`);
  return {
    ibufSizePages: counts.get('ibuf_size') as number,
    historyLength: counts.get('trx_rseg_history_len') as number,
    dirtyPages: counts.get('buffer_pool_pages_dirty') as number,
    poolPages: counts.get('buffer_pool_pages_total') as number
  };
}

function isSettled(reading: SettleReading): boolean {
  const poolLimit = reading.poolPages * SETTLE_MAX_FRACTION_OF_POOL;
  return reading.ibufSizePages <= poolLimit && reading.dirtyPages <= poolLimit && reading.historyLength <= SETTLE_MAX_HISTORY_LENGTH;
}

export async function waitForSettledInnoDb(conn: Connection, logPrefix: string): Promise<SettleReading[]> {
  const readings: SettleReading[] = [];
  const deadline = Date.now() + SETTLE_DEADLINE_MS;
  let consecutiveSettled = 0;
  for (;;) {
    const reading = await readSettleMetrics(conn);
    readings.push(reading);
    consecutiveSettled = isSettled(reading) ? consecutiveSettled + 1 : 0;
    console.log(`${logPrefix} settle poll ${readings.length}: ${JSON.stringify(reading)} settled ${consecutiveSettled}/${SETTLE_CONSECUTIVE_POLLS}`);
    if (consecutiveSettled >= SETTLE_CONSECUTIVE_POLLS) return readings;
    if (Date.now() + SETTLE_POLL_INTERVAL_MS > deadline) {
      throw new Error(`InnoDB did not settle within ${SETTLE_DEADLINE_MS} ms; last readings ${JSON.stringify(readings.slice(-SETTLE_CONSECUTIVE_POLLS))}`);
    }
    await new Promise(resolve => setTimeout(resolve, SETTLE_POLL_INTERVAL_MS));
  }
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function roundedMs(ms: number): number {
  return Math.round(ms);
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
