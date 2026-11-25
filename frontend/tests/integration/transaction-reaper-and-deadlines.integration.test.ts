/**
 * ConnectionManager reaper and step deadlines against REAL MySQL locks (#563: I0, I1, I2, I4, I5).
 *
 * Uses the real ConnectionManager singleton (vitest.integration.config.mts pins it to the local docker MySQL),
 * a probe table in the isolated test schema, and raw TEST_DB_* connections as blockers and probes. Every wait is
 * bounded, so a regression fails with a named bound instead of hanging. Lock names carry the test schema because
 * GET_LOCK names are server-global and sibling worktrees share this server.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql, { type Connection, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import ConnectionManager from '@/lib/db/connectionmanager';
import { TransactionCallbackTimeoutError, TransactionReapedError } from '@/lib/db/transactionerrors';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestDatabaseConfig } from '../setup/local-db-setup';
import { testDbServerOptions } from '../setup/test-db-connection';
import { delay, deferred, outcomeOf, waitFor, withinBound } from './helpers/async-bounds';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;
const PROBE_TABLE = 'txn_reaper_probe';
const ROW = { A: 1, B: 2, C: 3, E: 5, F: 6 } as const;
const INITIAL_VALUE = 0;
const OWNER_VALUE = 563;
const OLDER_TRANSACTION_VALUE = 777;

const REAPER_DEADLINE_MS = 1_000;
const I1_SWEEP_AFTER_BEGIN_MS = 1_600;
const I2_SWEEP_AFTER_BEGIN_MS = 1_500;
const I2_BLOCKER_RELEASE_AFTER_BEGIN_MS = 2_000;
const OLDER_WITH_TRANSACTION_TIMEOUT_MS = 10_000;
const OLDER_TRANSACTION_HEAD_START_MS = 100;
const SHORT_ROLLBACK_DEADLINE_MS = 1_500;
const I5_CALLBACK_TIMEOUT_MS = 2_000;
/** Unique to I0: pooled sessions keep their variables between borrowers, so a value another test also uses could be read off a reused connection even if the SETs were broken. */
const I0_CALLBACK_TIMEOUT_MS = 7_000;
/** withTransaction's session settings for a 7 s timeout: lock wait = ceil(7 s) capped at 300; idle timeouts = that + 300 s buffer. */
const I0_EXPECTED_LOCK_WAIT_SECONDS = 7;
const I0_EXPECTED_SESSION_TIMEOUT_SECONDS = 307;

const PROBE_LOCK_WAIT_SECONDS = 5;
const OWNER_LOCK_WAIT_SECONDS_I2 = 20;
const OWNER_LOCK_WAIT_SECONDS_I4 = 30;
const USER_LOCK_WAIT_SECONDS = 30;

const LOCK_GRANT_BOUND_MS = 2_000;
const SESSION_GONE_BOUND_MS = 2_000;
const SETTLE_SLACK_MS = 2_000;
const WAIT_STATE_BOUND_MS = 5_000;
const AWAIT_BOUND_MS = 40_000;
const HOARD_ACQUIRE_TIMEOUT_MS = 500;
const TEST_TIMEOUT_MS = 60_000;
const USER_LOCK_PROCESSLIST_STATE = 'User lock';
const INNODB_LOCK_WAIT_STATE = 'LOCK WAIT';
/** INNODB_TRX is served from a cache that refreshes only after 100 ms without any read, so polling faster than that returns stale rows indefinitely. */
const INNODB_TRX_POLL_INTERVAL_MS = 150;

type ManagerInternals = {
  transactionConnections: Map<string, unknown>;
  startingTransactions: number;
  rollbackDeadlineMs: number;
};

const connectionManager = ConnectionManager.getInstance();
const internals = connectionManager as unknown as ManagerInternals;
let setupConnection: Connection;
let config: TestDatabaseConfig;
let originalRollbackDeadlineMs: number;

function occupancy(): number {
  return internals.transactionConnections.size + internals.startingTransactions;
}

function threadIdOf(transactionId: string): number {
  const connection = internals.transactionConnections.get(transactionId) as { threadId?: number } | undefined;
  if (typeof connection?.threadId !== 'number') throw new Error(`No live connection for transaction ${transactionId}`);
  return connection.threadId;
}

function updateProbeSql(): string {
  return safeFormatQuery(config.database, `UPDATE ??.${PROBE_TABLE} SET v = ? WHERE id = ?`);
}

/** Keeps a failed test from leaving row locks that make the next test's beforeEach time out. */
async function rollBackIfStillOpen(transactionId: string): Promise<void> {
  if (internals.transactionConnections.has(transactionId)) await outcomeOf(connectionManager.rollbackTransaction(transactionId));
}

async function rawConnection(): Promise<Connection> {
  return mysql.createConnection({ ...testDbServerOptions(), database: config.database });
}

async function readValue(rowId: number): Promise<number> {
  const [rows] = await setupConnection.query<RowDataPacket[]>(`SELECT v FROM ${PROBE_TABLE} WHERE id = ?`, [rowId]);
  return Number(rows[0].v);
}

async function threadIsGone(threadId: number): Promise<boolean> {
  const [rows] = await setupConnection.query<RowDataPacket[]>('SELECT COUNT(*) AS present FROM information_schema.PROCESSLIST WHERE ID = ?', [threadId]);
  return Number(rows[0].present) === 0;
}

async function processlistState(threadId: number): Promise<string | null> {
  const [rows] = await setupConnection.query<RowDataPacket[]>('SELECT STATE FROM information_schema.PROCESSLIST WHERE ID = ?', [threadId]);
  return rows.length > 0 ? String(rows[0].STATE ?? '') : null;
}

async function isInRowLockWait(threadId: number): Promise<boolean> {
  const [rows] = await setupConnection.query<RowDataPacket[]>('SELECT trx_state FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id = ?', [threadId]);
  return rows.some(row => String(row.trx_state) === INNODB_LOCK_WAIT_STATE);
}

/** Opens a raw transaction holding `rowId` FOR UPDATE; the caller must roll it back and end it. */
async function holdRowLock(rowId: number): Promise<Connection> {
  const blocker = await rawConnection();
  await blocker.beginTransaction();
  await blocker.query(`SELECT v FROM ${PROBE_TABLE} WHERE id = ? FOR UPDATE`, [rowId]);
  return blocker;
}

/** Tries to lock `rowId` from a fresh raw session; resolves with when the lock was granted and the value seen. */
async function probeRowLock(rowId: number): Promise<{ probe: Connection; grant: Promise<unknown> }> {
  const probe = await rawConnection();
  // Raw text protocol: the driver interpolates the integer client-side, so `?` is safe here (rule 12 is about execute()).
  await probe.query('SET SESSION innodb_lock_wait_timeout = ?', [PROBE_LOCK_WAIT_SECONDS]);
  await probe.beginTransaction();
  const grant = probe.query<RowDataPacket[]>(`SELECT v FROM ${PROBE_TABLE} WHERE id = ? FOR UPDATE`, [rowId]).then(
    ([rows]) => ({ grantedAt: Date.now(), value: Number(rows[0].v) }),
    (error: unknown) => error
  );
  return { probe, grant };
}

beforeAll(async () => {
  const host = process.env.AZURE_SQL_SERVER;
  console.log(`[reaper-deadlines] ConnectionManager host = '${host}'`);
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid touching a real database.`);
  }
  const setup = await setupTestDatabase(DEFAULT_TEST_CONFIG);
  setupConnection = setup.connection;
  config = setup.config;
  await setupConnection.query(`CREATE TABLE IF NOT EXISTS ${PROBE_TABLE} (id INT PRIMARY KEY, v INT NOT NULL)`);
  originalRollbackDeadlineMs = internals.rollbackDeadlineMs;
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

afterEach(() => {
  internals.rollbackDeadlineMs = originalRollbackDeadlineMs;
  vi.restoreAllMocks();
});

afterAll(async () => {
  await getPoolMonitorInstance().closeAllConnections();
  await teardownTestDatabase(setupConnection, config);
});

describe('ConnectionManager reaper and step deadlines under real locks (#563)', () => {
  it(
    'I0: withTransaction really applies its session settings on the server (review P2-H)',
    async () => {
      const observed = await withinBound(
        connectionManager.withTransaction(
          async tx => {
            const rows = await tx.query(
              'SELECT @@session.innodb_lock_wait_timeout AS lockWaitSeconds, @@session.wait_timeout AS waitTimeoutSeconds, @@session.interactive_timeout AS interactiveTimeoutSeconds'
            );
            return rows[0] as { lockWaitSeconds: number; waitTimeoutSeconds: number; interactiveTimeoutSeconds: number };
          },
          { timeoutMs: I0_CALLBACK_TIMEOUT_MS }
        ),
        AWAIT_BOUND_MS,
        'withTransaction reading its session settings'
      );
      console.log('[I0] session settings inside the callback:', observed);

      expect(Number(observed.lockWaitSeconds), 'a `?`-bound SET fails with ER_WRONG_TYPE_FOR_VAR and is swallowed').toBe(I0_EXPECTED_LOCK_WAIT_SECONDS);
      expect(Number(observed.waitTimeoutSeconds)).toBe(I0_EXPECTED_SESSION_TIMEOUT_SECONDS);
      expect(Number(observed.interactiveTimeoutSeconds)).toBe(I0_EXPECTED_SESSION_TIMEOUT_SECONDS);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'I1: reaps only the idle transaction past its own deadline, frees its row lock at once, and lets an older withTransaction commit',
    async () => {
      const occupancyBefore = occupancy();
      const gate = deferred<void>();
      const older = outcomeOf(
        connectionManager.withTransaction(
          async tx => {
            await tx.query(updateProbeSql(), [OLDER_TRANSACTION_VALUE, ROW.B]);
            await gate.promise;
          },
          { timeoutMs: OLDER_WITH_TRANSACTION_TIMEOUT_MS }
        )
      );
      await delay(OLDER_TRANSACTION_HEAD_START_MS);

      const ownerBeganAt = Date.now();
      const ownerId = await connectionManager.beginTransaction({ reaperDeadlineMs: REAPER_DEADLINE_MS });
      await connectionManager.executeQuery(updateProbeSql(), [OWNER_VALUE, ROW.A], ownerId);
      const ownerThread = threadIdOf(ownerId);
      const { probe, grant } = await probeRowLock(ROW.A);
      try {
        await delay(Math.max(0, I1_SWEEP_AFTER_BEGIN_MS - (Date.now() - ownerBeganAt)));
        const sweptAt = Date.now();
        const reaped = await connectionManager.cleanupStaleTransactions();
        const probeOutcome = (await withinBound(grant, AWAIT_BOUND_MS, 'probe FOR UPDATE on row A')) as { grantedAt: number; value: number } | Error;
        console.log('[I1]', { reaped, ownerThread, probeOutcome, grantDelayMs: probeOutcome instanceof Error ? null : probeOutcome.grantedAt - sweptAt });

        expect(reaped, 'only the direct transaction is past its own deadline').toBe(1);
        expect(probeOutcome, 'the reaped session must release row A; today the probe hits its lock-wait timeout').not.toBeInstanceOf(Error);
        const granted = probeOutcome as { grantedAt: number; value: number };
        expect(granted.grantedAt - sweptAt).toBeLessThan(LOCK_GRANT_BOUND_MS);
        expect(granted.value, 'the reaped UPDATE must not be visible').toBe(INITIAL_VALUE);
        await probe.rollback();
      } finally {
        await probe.end();
      }

      const goneAfterMs = await waitFor(() => threadIsGone(ownerThread), SESSION_GONE_BOUND_MS, `reaped thread ${ownerThread} still in PROCESSLIST`);
      const ownerQuery = await outcomeOf(connectionManager.executeQuery(updateProbeSql(), [OWNER_VALUE, ROW.A], ownerId));
      const ownerCommit = await outcomeOf(connectionManager.commitTransaction(ownerId));
      const ownerRollback = await outcomeOf(connectionManager.rollbackTransaction(ownerId));
      gate.resolve();
      const olderOutcome = await withinBound(older, AWAIT_BOUND_MS, 'older withTransaction');
      console.log('[I1] after reap', {
        goneAfterMs,
        ownerQuery,
        ownerCommit,
        ownerRollback,
        olderOutcome,
        rowA: await readValue(ROW.A),
        rowB: await readValue(ROW.B)
      });

      expect(ownerQuery).toBeInstanceOf(TransactionReapedError);
      expect(ownerCommit, 'a resumed owner must never be told its reaped work committed').toBeInstanceOf(TransactionReapedError);
      expect(ownerRollback).toEqual({ resolved: undefined });
      expect(olderOutcome, 'the older withTransaction is within its own deadline and must survive the sweep').toEqual({ resolved: undefined });
      expect(await readValue(ROW.B)).toBe(OLDER_TRANSACTION_VALUE);
      expect(await readValue(ROW.A)).toBe(INITIAL_VALUE);
      expect(occupancy()).toBe(occupancyBefore);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'I2: never reaps a transaction whose statement is in a row-lock wait past its deadline; the owner then commits',
    async () => {
      const ownerBeganAt = Date.now();
      const ownerId = await connectionManager.beginTransaction({ reaperDeadlineMs: REAPER_DEADLINE_MS });
      // Interpolated constant, never `?`-bound: see ground rule 12.
      await connectionManager.executeQuery(`SET SESSION innodb_lock_wait_timeout = ${OWNER_LOCK_WAIT_SECONDS_I2}`, [], ownerId);
      const ownerThread = threadIdOf(ownerId);
      const blocker = await holdRowLock(ROW.C);
      try {
        const ownerUpdate = outcomeOf(connectionManager.executeQuery(updateProbeSql(), [OWNER_VALUE, ROW.C], ownerId));
        await waitFor(() => isInRowLockWait(ownerThread), WAIT_STATE_BOUND_MS, 'owner UPDATE never entered a row-lock wait', INNODB_TRX_POLL_INTERVAL_MS);
        console.log('[I2] owner PROCESSLIST state while waiting:', await processlistState(ownerThread));

        await delay(Math.max(0, I2_SWEEP_AFTER_BEGIN_MS - (Date.now() - ownerBeganAt)));
        const reaped = await connectionManager.cleanupStaleTransactions();
        await delay(Math.max(0, I2_BLOCKER_RELEASE_AFTER_BEGIN_MS - (Date.now() - ownerBeganAt)));
        await blocker.rollback();

        const updateOutcome = await withinBound(ownerUpdate, AWAIT_BOUND_MS, 'owner UPDATE after blocker release');
        const commitOutcome = await withinBound(outcomeOf(connectionManager.commitTransaction(ownerId)), AWAIT_BOUND_MS, 'owner commit');
        console.log('[I2]', { reaped, updateOutcome, commitOutcome, rowC: await readValue(ROW.C) });

        expect(reaped, 'a counted statement in flight means the owner is alive (§2.3)').toBe(0);
        expect(updateOutcome).not.toBeInstanceOf(Error);
        expect(commitOutcome).toEqual({ resolved: undefined });
        expect(await readValue(ROW.C)).toBe(OWNER_VALUE);
      } finally {
        await blocker.end();
        await rollBackIfStillOpen(ownerId);
      }
    },
    TEST_TIMEOUT_MS
  );

  it(
    'I4: a ROLLBACK queued behind a 30 s lock wait is abandoned at its deadline, ending the session and freeing its locks',
    async () => {
      internals.rollbackDeadlineMs = SHORT_ROLLBACK_DEADLINE_MS;
      const ownerId = await connectionManager.beginTransaction();
      await connectionManager.executeQuery(`SET SESSION innodb_lock_wait_timeout = ${OWNER_LOCK_WAIT_SECONDS_I4}`, [], ownerId);
      await connectionManager.executeQuery(updateProbeSql(), [OWNER_VALUE, ROW.E], ownerId);
      const ownerThread = threadIdOf(ownerId);
      const blocker = await holdRowLock(ROW.F);
      try {
        const orphanUpdate = outcomeOf(connectionManager.executeQuery(updateProbeSql(), [OWNER_VALUE, ROW.F], ownerId));
        await waitFor(
          () => isInRowLockWait(ownerThread),
          WAIT_STATE_BOUND_MS,
          'owner UPDATE of row F never entered a row-lock wait',
          INNODB_TRX_POLL_INTERVAL_MS
        );

        const rollbackStartedAt = Date.now();
        const rollbackOutcome = await withinBound(outcomeOf(connectionManager.rollbackTransaction(ownerId)), AWAIT_BOUND_MS, 'rollbackTransaction');
        const rollbackElapsedMs = Date.now() - rollbackStartedAt;
        const goneAfterMs = await waitFor(() => threadIsGone(ownerThread), SESSION_GONE_BOUND_MS, `thread ${ownerThread} survived the abandoned ROLLBACK`);
        const { probe, grant } = await probeRowLock(ROW.E);
        try {
          const probeStartedAt = Date.now();
          const probeOutcome = await withinBound(grant, AWAIT_BOUND_MS, 'probe FOR UPDATE on row E');
          const orphanOutcome = await withinBound(orphanUpdate, SETTLE_SLACK_MS, 'orphan UPDATE of row F');
          console.log('[I4]', {
            rollbackOutcome,
            rollbackElapsedMs,
            goneAfterMs,
            probeOutcome,
            probeDelayMs: Date.now() - probeStartedAt,
            orphan: (orphanOutcome as Error)?.name
          });

          expect(rollbackOutcome, 'the ROLLBACK deadline resolves (A10)').toEqual({ resolved: undefined });
          expect(rollbackElapsedMs, 'today the ROLLBACK waits out the 30 s lock wait').toBeLessThan(SHORT_ROLLBACK_DEADLINE_MS + SETTLE_SLACK_MS);
          expect(probeOutcome).not.toBeInstanceOf(Error);
          expect((probeOutcome as { value: number }).value, 'the abandoned transaction must have rolled back').toBe(INITIAL_VALUE);
          expect(orphanOutcome).toBeInstanceOf(Error);
          await probe.rollback();
        } finally {
          await probe.end();
        }
      } finally {
        await blocker.rollback();
        await blocker.end();
        await rollBackIfStillOpen(ownerId);
      }
    },
    TEST_TIMEOUT_MS
  );

  it(
    'I5: a callback timeout with the pool saturated quarantines then KILLs and returns within 2 s, without ROLLBACK',
    async () => {
      const occupancyBefore = occupancy();
      const lockName = `${config.database}:i5-user-lock`;
      const blocker = await rawConnection();
      const hoarded: PoolConnection[] = [];
      try {
        const [blockerLock] = await blocker.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
        expect(Number(blockerLock[0].acquired), 'precondition: the blocker holds the user lock').toBe(1);
        const rollbackSpy = vi.spyOn(connectionManager, 'rollbackTransaction');
        let callbackTransactionId: string | undefined;

        const startedAt = Date.now();
        const outcome = outcomeOf(
          connectionManager.withTransaction(
            async tx => {
              callbackTransactionId = tx.id;
              await tx.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, USER_LOCK_WAIT_SECONDS]);
            },
            { timeoutMs: I5_CALLBACK_TIMEOUT_MS }
          )
        );
        await waitFor(() => callbackTransactionId !== undefined, WAIT_STATE_BOUND_MS, 'callback never started');
        const txThread = threadIdOf(callbackTransactionId!);
        await waitFor(async () => (await processlistState(txThread)) === USER_LOCK_PROCESSLIST_STATE, WAIT_STATE_BOUND_MS, 'GET_LOCK never started waiting');

        const pool = await getPoolMonitorInstance().getUsablePool();
        const connectionLimit = (pool as unknown as { pool: { config: { connectionLimit: number } } }).pool.config.connectionLimit;
        while (hoarded.length < connectionLimit - 1) {
          const acquisition = await getPoolMonitorInstance().tryAcquireConnection(HOARD_ACQUIRE_TIMEOUT_MS);
          if (acquisition.status !== 'acquired') break;
          hoarded.push(acquisition.connection);
        }
        console.log(`[I5] connectionLimit=${connectionLimit} hoarded=${hoarded.length} elapsedBeforeTimeout=${Date.now() - startedAt}ms`);
        expect(hoarded.length, 'precondition: every other pooled connection is checked out').toBe(connectionLimit - 1);

        const settled = await withinBound(outcome, AWAIT_BOUND_MS, 'withTransaction under a saturated pool');
        const elapsedMs = Date.now() - startedAt;
        const goneAfterMs = await waitFor(() => threadIsGone(txThread), SESSION_GONE_BOUND_MS, `thread ${txThread} survived the callback timeout`);
        console.log('[I5]', { settled: (settled as Error)?.name, elapsedMs, goneAfterMs, rollbackCalls: rollbackSpy.mock.calls.length });

        expect(settled).toBeInstanceOf(TransactionCallbackTimeoutError);
        expect(elapsedMs, 'today KILL waits 5 s for a connection, then ROLLBACK queues behind the 30 s GET_LOCK').toBeLessThan(
          I5_CALLBACK_TIMEOUT_MS + SETTLE_SLACK_MS
        );
        expect(rollbackSpy, 'no ROLLBACK on a callback timeout (A11)').not.toHaveBeenCalled();
        expect(occupancy()).toBe(occupancyBefore);
      } finally {
        hoarded.forEach(connection => connection.release());
        await blocker.query('SELECT RELEASE_LOCK(?)', [lockName]);
        await blocker.end();
      }
    },
    TEST_TIMEOUT_MS
  );
});
