/**
 * COMMIT / ROLLBACK / KILL deadlines against a REAL server whose replies are withheld (#563 Integration B: P1–P4).
 *
 * ConnectionManager talks to MySQL through a pausable proxy. poolmonitorsingleton reads AZURE_SQL_PORT when it is
 * evaluated, so this file imports the connection manager, pool monitor and primitives only AFTER pointing the env at
 * the proxy (isolate: true gives the file its own module registry). Raw TEST_DB_* connections (direct to 3306) do
 * setup and every assertion read.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql, { type Connection, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import type ConnectionManagerClass from '@/lib/db/connectionmanager';
import type { getPoolMonitorInstance as GetPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import { TransactionCallbackTimeoutError, TransactionCommitOutcomeUnknownError } from '@/lib/db/transactionerrors';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestDatabaseConfig } from '../setup/local-db-setup';
import { testDbServerOptions } from '../setup/test-db-connection';
import { startPausableMysqlProxy, type PausableMysqlProxy } from './helpers/pausable-mysql-proxy';
import { outcomeOf, waitFor, withinBound } from './helpers/async-bounds';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;
const PROBE_TABLE = 'txn_step_deadline_probe';
const ROW = { D: 1, D2: 2, E2: 3 } as const;
const INITIAL_VALUE = 0;
const SENTINEL_VALUE = 5_631;

const SHORT_STEP_DEADLINE_MS = 1_500;
const P2_COMMIT_DEADLINE_MS = 5_000;
const COMMIT_VISIBILITY_BOUND_MS = 2_000;
const P4_CALLBACK_TIMEOUT_MS = 2_000;
const USER_LOCK_WAIT_SECONDS = 30;
const SETTLE_SLACK_MS = 2_000;
const TIMER_TOLERANCE_MS = 250;
const CLIENT_CLOSE_BOUND_MS = 1_000;
const LOCK_GRANT_BOUND_MS = 2_000;
const WAIT_STATE_BOUND_MS = 5_000;
const AWAIT_BOUND_MS = 20_000;
const PROBE_LOCK_WAIT_SECONDS = 5;
const TEST_TIMEOUT_MS = 45_000;
const USER_LOCK_PROCESSLIST_STATE = 'User lock';
const TRANSPORT_LOSS_CODES = ['PROTOCOL_CONNECTION_LOST', 'ECONNRESET'];

type ManagerInternals = {
  transactionConnections: Map<string, unknown>;
  startingTransactions: number;
  commitDeadlineMs: number;
  rollbackDeadlineMs: number;
};

let ConnectionManager: typeof ConnectionManagerClass;
let getPoolMonitorInstance: typeof GetPoolMonitorInstance;
let KILL_STATEMENT_DEADLINE_MS: number;
let proxy: PausableMysqlProxy;
let directPort: string | undefined;
let setupConnection: Connection;
let config: TestDatabaseConfig;
let originalDeadlines: { commit: number; rollback: number };
let transactionsOpenedByTest: { transactionId: string; clientPort: number }[] = [];

function manager() {
  return ConnectionManager.getInstance();
}

function internals(): ManagerInternals {
  return manager() as unknown as ManagerInternals;
}

function occupancy(): number {
  return internals().transactionConnections.size + internals().startingTransactions;
}

/** mysql2's socket local port equals the proxy-side client socket's remotePort. */
function localPortOf(connection: unknown): number {
  return (connection as { connection: { stream: { localPort: number } } }).connection.stream.localPort;
}

function transactionConnection(transactionId: string): unknown {
  const connection = internals().transactionConnections.get(transactionId);
  if (!connection) throw new Error(`No live connection for transaction ${transactionId}`);
  return connection;
}

function updateProbeSql(): string {
  return safeFormatQuery(config.database, `UPDATE ??.${PROBE_TABLE} SET v = ? WHERE id = ?`);
}

async function readValue(rowId: number): Promise<number> {
  const [rows] = await setupConnection.query<RowDataPacket[]>(`SELECT v FROM ${PROBE_TABLE} WHERE id = ?`, [rowId]);
  return Number(rows[0].v);
}

async function processlistState(threadId: number): Promise<string | null> {
  const [rows] = await setupConnection.query<RowDataPacket[]>('SELECT STATE FROM information_schema.PROCESSLIST WHERE ID = ?', [threadId]);
  return rows.length > 0 ? String(rows[0].STATE ?? '') : null;
}

async function rawConnection(): Promise<Connection> {
  return mysql.createConnection({ ...testDbServerOptions(), database: config.database });
}

/** Begins a direct transaction through the proxy and sets `rowId` to the sentinel inside it. */
async function beginWithSentinel(rowId: number): Promise<{ transactionId: string; clientPort: number; threadId: number }> {
  const transactionId = await manager().beginTransaction();
  await manager().executeQuery(updateProbeSql(), [SENTINEL_VALUE, rowId], transactionId);
  const connection = transactionConnection(transactionId);
  const clientPort = localPortOf(connection);
  transactionsOpenedByTest.push({ transactionId, clientPort });
  return { transactionId, clientPort, threadId: (connection as { threadId: number }).threadId };
}

/** Severs the connection first: a withheld reply would otherwise make the rollback wait out its whole deadline. */
async function abandonOpenTransactions(): Promise<void> {
  for (const { transactionId, clientPort } of transactionsOpenedByTest) {
    proxy.sever(clientPort);
    if (internals().transactionConnections.has(transactionId)) await outcomeOf(manager().rollbackTransaction(transactionId));
  }
  transactionsOpenedByTest = [];
}

beforeAll(async () => {
  const host = process.env.AZURE_SQL_SERVER;
  console.log(`[step-deadlines-proxy] ConnectionManager host = '${host}'`);
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid touching a real database.`);
  }
  const setup = await setupTestDatabase(DEFAULT_TEST_CONFIG);
  setupConnection = setup.connection;
  config = setup.config;
  await setupConnection.query(`CREATE TABLE IF NOT EXISTS ${PROBE_TABLE} (id INT PRIMARY KEY, v INT NOT NULL)`);

  directPort = process.env.AZURE_SQL_PORT;
  proxy = await startPausableMysqlProxy({ host, port: Number(directPort) });
  process.env.AZURE_SQL_PORT = String(proxy.port);
  ({ default: ConnectionManager } = await import('@/lib/db/connectionmanager'));
  ({ getPoolMonitorInstance } = await import('@/lib/db/poolmonitorsingleton'));
  ({ KILL_STATEMENT_DEADLINE_MS } = await import('@/lib/db/primitives'));
  originalDeadlines = { commit: internals().commitDeadlineMs, rollback: internals().rollbackDeadlineMs };
  console.log(`[step-deadlines-proxy] proxy on ${proxy.port} → ${host}:${directPort}`);
}, 90_000);

beforeEach(async () => {
  await setupConnection.query(`DELETE FROM ${PROBE_TABLE}`);
  await setupConnection.query(
    `INSERT INTO ${PROBE_TABLE} (id, v) VALUES ${Object.values(ROW)
      .map(() => '(?, ?)')
      .join(', ')}`,
    Object.values(ROW).flatMap(id => [id, INITIAL_VALUE])
  );
});

afterEach(async () => {
  await abandonOpenTransactions();
  internals().commitDeadlineMs = originalDeadlines.commit;
  internals().rollbackDeadlineMs = originalDeadlines.rollback;
  vi.restoreAllMocks();
});

afterAll(async () => {
  // Restore the port first so nothing later in this process can reach the proxy by accident; every handle is guarded
  // because beforeAll may have failed part-way.
  if (directPort !== undefined) process.env.AZURE_SQL_PORT = directPort;
  try {
    if (getPoolMonitorInstance) await getPoolMonitorInstance().closeAllConnections();
  } finally {
    try {
      if (proxy) await proxy.close();
    } finally {
      if (setupConnection) await teardownTestDatabase(setupConnection, config);
    }
  }
});

describe('step deadlines with withheld server replies (#563 R7)', () => {
  it(
    'P1: a COMMIT whose reply is withheld reports an unknown outcome at its deadline — and the row IS committed',
    async () => {
      internals().commitDeadlineMs = SHORT_STEP_DEADLINE_MS;
      const occupancyBefore = occupancy();
      const { transactionId, clientPort } = await beginWithSentinel(ROW.D);
      const rollbackSpy = vi.spyOn(manager(), 'rollbackTransaction');
      proxy.pauseResponses(clientPort);

      const startedAt = Date.now();
      const outcome = await withinBound(outcomeOf(manager().commitTransaction(transactionId)), AWAIT_BOUND_MS, 'commit with a withheld reply');
      const elapsedMs = Date.now() - startedAt;
      await waitFor(() => proxy.isClientClosed(clientPort), CLIENT_CLOSE_BOUND_MS, 'tx connection was not closed (released instead of quarantined?)');
      let committedValue = INITIAL_VALUE;
      await waitFor(async () => (committedValue = await readValue(ROW.D)) === SENTINEL_VALUE, LOCK_GRANT_BOUND_MS, 'row D never showed the committed sentinel');
      console.log('[P1]', {
        outcome: (outcome as Error)?.name,
        trigger: (outcome as TransactionCommitOutcomeUnknownError)?.trigger,
        elapsedMs,
        committedValue
      });
      console.log('[P1] documented outcome: the caller was told "unknown" and the row IS committed; "rolled back" would have been false.');

      expect(outcome).toBeInstanceOf(TransactionCommitOutcomeUnknownError);
      expect((outcome as TransactionCommitOutcomeUnknownError).trigger).toBe('deadline_exceeded');
      expect(elapsedMs).toBeLessThan(SHORT_STEP_DEADLINE_MS + SETTLE_SLACK_MS);
      expect(rollbackSpy, 'no ROLLBACK may follow a sent COMMIT').not.toHaveBeenCalled();
      expect(committedValue).toBe(SENTINEL_VALUE);
      expect(occupancy()).toBe(occupancyBefore);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'P2: a COMMIT the server applied, whose connection is then severed, is an unknown outcome caused by the transport loss',
    async () => {
      internals().commitDeadlineMs = P2_COMMIT_DEADLINE_MS;
      const occupancyBefore = occupancy();
      const { transactionId, clientPort } = await beginWithSentinel(ROW.D2);
      proxy.pauseResponses(clientPort);

      const startedAt = Date.now();
      const commit = outcomeOf(manager().commitTransaction(transactionId));
      const visibleAfterMs = await waitFor(
        async () => (await readValue(ROW.D2)) === SENTINEL_VALUE,
        COMMIT_VISIBILITY_BOUND_MS,
        'the server never applied the withheld COMMIT, so severing could not prove a lost reply'
      );
      proxy.sever(clientPort);
      const outcome = await withinBound(commit, AWAIT_BOUND_MS, 'commit after sever');
      const elapsedMs = Date.now() - startedAt;
      const causeCode = ((outcome as TransactionCommitOutcomeUnknownError)?.cause as { code?: string } | undefined)?.code;
      console.log('[P2]', {
        visibleAfterMs,
        outcome: (outcome as Error)?.name,
        trigger: (outcome as TransactionCommitOutcomeUnknownError)?.trigger,
        causeCode,
        elapsedMs
      });

      expect(outcome, 'a transport loss after COMMIT was sent is never a definitive rejection (R2)').toBeInstanceOf(TransactionCommitOutcomeUnknownError);
      expect((outcome as TransactionCommitOutcomeUnknownError).trigger).toBe('connection_lost');
      expect(TRANSPORT_LOSS_CODES).toContain(causeCode);
      expect(elapsedMs, 'must settle on the transport loss, before the 5 s deadline').toBeLessThan(P2_COMMIT_DEADLINE_MS);
      expect(await readValue(ROW.D2)).toBe(SENTINEL_VALUE);
      expect(occupancy()).toBe(occupancyBefore);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'P3: a ROLLBACK whose reply is withheld resolves at its deadline, quarantined, with the row unchanged and unlocked',
    async () => {
      internals().rollbackDeadlineMs = SHORT_STEP_DEADLINE_MS;
      const occupancyBefore = occupancy();
      const { transactionId, clientPort, threadId } = await beginWithSentinel(ROW.E2);
      proxy.pauseResponses(clientPort);

      const startedAt = Date.now();
      const outcome = await withinBound(outcomeOf(manager().rollbackTransaction(transactionId)), AWAIT_BOUND_MS, 'rollback with a withheld reply');
      const elapsedMs = Date.now() - startedAt;
      await waitFor(() => proxy.isClientClosed(clientPort), CLIENT_CLOSE_BOUND_MS, 'tx connection was not closed (released instead of quarantined?)');
      const abandonedThreadState = await processlistState(threadId);
      console.log('[P3] tx thread still in PROCESSLIST after abandonment:', abandonedThreadState !== null, 'state:', abandonedThreadState);
      const probe = await rawConnection();
      try {
        // Raw text protocol: `?` is interpolated client-side (rule 12 is about execute()).
        await probe.query('SET SESSION innodb_lock_wait_timeout = ?', [PROBE_LOCK_WAIT_SECONDS]);
        await probe.beginTransaction();
        const probeStartedAt = Date.now();
        const [rows] = await withinBound(
          probe.query<RowDataPacket[]>(`SELECT v FROM ${PROBE_TABLE} WHERE id = ? FOR UPDATE`, [ROW.E2]),
          AWAIT_BOUND_MS,
          'probe on row E2'
        );
        const probeDelayMs = Date.now() - probeStartedAt;
        console.log('[P3]', { outcome, elapsedMs, probeDelayMs, value: rows[0].v });

        expect(outcome).toEqual({ resolved: undefined });
        expect(elapsedMs).toBeLessThan(SHORT_STEP_DEADLINE_MS + SETTLE_SLACK_MS);
        expect(probeDelayMs).toBeLessThan(LOCK_GRANT_BOUND_MS);
        expect(Number(rows[0].v)).toBe(INITIAL_VALUE);
        await probe.rollback();
      } finally {
        await probe.end();
      }
      expect(occupancy()).toBe(occupancyBefore);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'P4: a KILL whose reply is withheld is abandoned at its deadline and its connection quarantined, not pooled',
    async () => {
      const occupancyBefore = occupancy();
      const lockName = `${config.database}:p4-user-lock`;
      const blocker = await rawConnection();
      let pausedPorts: number[] = [];
      try {
        const [blockerLock] = await blocker.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
        expect(Number(blockerLock[0].acquired), 'precondition: the blocker holds the user lock').toBe(1);

        // Warm two idle pooled connections; the transaction takes one, so the KILL will reuse the other (paused below).
        const monitor = getPoolMonitorInstance();
        const warmed: PoolConnection[] = [await monitor.getConnection(), await monitor.getConnection()];
        warmed.forEach(connection => connection.release());
        const tryAcquireSpy = vi.spyOn(monitor, 'tryAcquireConnection');
        let callbackTransactionId: string | undefined;

        const startedAt = Date.now();
        const outcome = outcomeOf(
          manager().withTransaction(
            async tx => {
              callbackTransactionId = tx.id;
              await tx.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, USER_LOCK_WAIT_SECONDS]);
            },
            { timeoutMs: P4_CALLBACK_TIMEOUT_MS }
          )
        );
        await waitFor(() => callbackTransactionId !== undefined, WAIT_STATE_BOUND_MS, 'callback never started');
        const txConnection = transactionConnection(callbackTransactionId!) as { threadId: number };
        const txThread = txConnection.threadId;
        const txPort = localPortOf(txConnection);
        await waitFor(async () => (await processlistState(txThread)) === USER_LOCK_PROCESSLIST_STATE, WAIT_STATE_BOUND_MS, 'GET_LOCK never started waiting');
        pausedPorts = proxy.pauseResponsesExcept([txPort]);

        const settled = await withinBound(outcome, AWAIT_BOUND_MS, 'withTransaction whose KILL reply is withheld');
        const elapsedMs = Date.now() - startedAt;
        const acquisition = (await tryAcquireSpy.mock.results[0]?.value) as { status: string; connection?: unknown } | undefined;
        const killPort = acquisition?.status === 'acquired' ? localPortOf(acquisition.connection) : undefined;
        const txThreadState = await processlistState(txThread);
        console.log('[P4]', {
          settled: (settled as Error)?.name,
          elapsedMs,
          pausedPorts,
          killPort,
          txThreadStillListed: txThreadState !== null,
          txThreadState
        });

        expect(settled).toBeInstanceOf(TransactionCallbackTimeoutError);
        expect(killPort, 'the KILL must have gone over a connection whose replies were withheld').toBeDefined();
        expect(pausedPorts).toContain(killPort);
        expect(elapsedMs, 'the KILL deadline path must have run').toBeGreaterThanOrEqual(
          P4_CALLBACK_TIMEOUT_MS + KILL_STATEMENT_DEADLINE_MS - TIMER_TOLERANCE_MS
        );
        expect(elapsedMs).toBeLessThan(P4_CALLBACK_TIMEOUT_MS + KILL_STATEMENT_DEADLINE_MS + SETTLE_SLACK_MS);
        await waitFor(() => proxy.isClientClosed(killPort!), CLIENT_CLOSE_BOUND_MS, 'the kill connection was returned to the pool instead of quarantined');
        expect(occupancy()).toBe(occupancyBefore);
      } finally {
        pausedPorts.forEach(port => proxy.sever(port));
        await blocker.query('SELECT RELEASE_LOCK(?)', [lockName]);
        await blocker.end();
      }
    },
    TEST_TIMEOUT_MS
  );
});
