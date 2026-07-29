/**
 * runQuery timeout quarantine — REAL server-side kill semantics against local MySQL.
 *
 * ── The bug this guards against (the Harvard 106k-row incident) ───────────────
 * runQuery raced the statement against an 11-minute JS timer and, on timeout,
 * rejected the caller WITHOUT killing the statement. MySQL kept executing it
 * (MAX_EXECUTION_TIME applies only to top-level SELECTs — a CALL or
 * INSERT ... SELECT has NO server-side limit), and the still-busy connection
 * was released back to the pool. mysql2 serializes commands per connection, so
 * the next borrower — including the retry of the same sub-batch — queued
 * behind the runaway statement, and a CALL managing its own transaction could
 * still COMMIT long after the caller had given up on it.
 *
 * ── The fix (in runQuery) ─────────────────────────────────────────────────────
 * On timeout: issue KILL QUERY <threadId> from a SEPARATE pooled connection,
 * then destroy() the timed-out connection so it can never re-enter the pool.
 * This suite proves, against a real server:
 *   1. runQuery settles at ~timeout, not at the statement's natural end.
 *   2. The server-side statement is actually gone well before it would have
 *      finished on its own — for both the execute() path and the CALL path.
 *   3. The timed-out connection is out of the pool (destroy() nulled its pool
 *      backref), a later release() is a harmless no-op, and no subsequent
 *      pool acquisition ever hands back the poisoned thread.
 *
 * CRITICAL SAFETY: ConnectionManager's pool host is process.env.AZURE_SQL_SERVER,
 * which defaults to PRODUCTION Azure MySQL. vitest.integration.config.mts pins
 * that env to the local docker container (127.0.0.1) for ALL integration tests.
 * The beforeAll guard below HARD-FAILS before anything runs if the host is not
 * local, so this suite can never touch a real database even if the config
 * regresses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection, PoolConnection } from 'mysql2/promise';
import ConnectionManager from '@/lib/db/connectionmanager';
import { getConn, QueryTimeoutError, runQuery } from '@/lib/db/primitives';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestDatabaseConfig } from '../setup/local-db-setup';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;

// A short runQuery timeout paired with a much longer server-side statement, so
// "settled at ~timeout" and "statement killed early" are unambiguous.
const SLEEP_SECONDS = 15;
const RUNQUERY_TIMEOUT_MS = 1500;
// Timeout + slack for acquiring the kill connection and the KILL round-trip.
const MAX_SETTLE_MS = RUNQUERY_TIMEOUT_MS + 3500;
// The killed statement must be gone from the processlist well before its
// natural completion at SLEEP_SECONDS.
const KILL_CONFIRM_DEADLINE_MS = 8000;
const PROCESSLIST_POLL_MS = 250;
const POOL_SWEEP_ACQUISITIONS = 3;
const SLEEPY_PROCEDURE = 'runquery_timeout_probe_sleepy';

let setupConnection: Connection | null = null;
let config: TestDatabaseConfig;
let schema: string;

const connectionManager = ConnectionManager.getInstance();
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type QuarantinedConnection = PoolConnection & { threadId?: number; connection?: { _pool: unknown } };

/** True while `threadId` still has the probe statement in flight server-side. */
async function statementStillRunning(threadId: number): Promise<boolean> {
  const rows = await connectionManager.executeQuery(`SELECT COUNT(*) AS running FROM information_schema.PROCESSLIST WHERE ID = ? AND INFO LIKE '%SLEEP%'`, [
    threadId
  ]);
  return Number(rows[0].running) > 0;
}

/** Polls until the statement on `threadId` is gone; returns how long that took. */
async function confirmStatementKilled(threadId: number): Promise<number> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < KILL_CONFIRM_DEADLINE_MS) {
    if (!(await statementStillRunning(threadId))) {
      return Date.now() - startedAt;
    }
    await wait(PROCESSLIST_POLL_MS);
  }
  throw new Error(
    `Statement on thread ${threadId} was still running ${KILL_CONFIRM_DEADLINE_MS}ms after the timeout — KILL QUERY did not land; ` +
      `it would have run to its natural end at ${SLEEP_SECONDS * 1000}ms (the pre-fix behavior).`
  );
}

/**
 * Full contract check shared by both statement shapes: settle time, server-side
 * kill, and pool quarantine of the timed-out connection.
 */
async function expectTimeoutKillAndQuarantine(query: string, params: unknown[]): Promise<void> {
  const connection = (await getConn()) as QuarantinedConnection;
  const threadId = connection.threadId;
  expect(typeof threadId).toBe('number');

  const startedAt = Date.now();
  const rejection = await runQuery(connection, query, params, RUNQUERY_TIMEOUT_MS).then(
    () => {
      throw new Error(`runQuery resolved — the ${SLEEP_SECONDS}s statement should have timed out at ${RUNQUERY_TIMEOUT_MS}ms`);
    },
    (err: unknown) => err
  );
  const settledMs = Date.now() - startedAt;
  // eslint-disable-next-line no-console
  console.log(`[runquery-timeout] '${query}' settled in ${settledMs}ms (timeout ${RUNQUERY_TIMEOUT_MS}ms, natural end ${SLEEP_SECONDS * 1000}ms)`);

  expect(rejection).toBeInstanceOf(QueryTimeoutError);
  expect((rejection as QueryTimeoutError).threadId).toBe(threadId);
  expect(settledMs).toBeLessThan(MAX_SETTLE_MS);

  const killConfirmMs = await confirmStatementKilled(threadId!);
  // eslint-disable-next-line no-console
  console.log(`[runquery-timeout] statement on thread ${threadId} confirmed gone ${killConfirmMs}ms after settle`);

  // destroy() nulls the mysql2 pool backref — the connection can never be
  // handed out again (white-box on mysql2's BasePoolConnection._removeFromPool,
  // which is exactly the mechanism release() checks before re-pooling).
  expect(connection.connection?._pool ?? null).toBeNull();

  // Callers' `finally { connection.release() }` blocks still run after the
  // timeout; on a destroyed connection that must be a harmless no-op.
  expect(() => connection.release()).not.toThrow();

  // Behavioral proof: the pool never hands the poisoned thread back out.
  const sweep: QuarantinedConnection[] = [];
  try {
    for (let i = 0; i < POOL_SWEEP_ACQUISITIONS; i++) {
      sweep.push((await getConn()) as QuarantinedConnection);
    }
    const sweepThreadIds = sweep.map(c => c.threadId);
    // eslint-disable-next-line no-console
    console.log(`[runquery-timeout] post-timeout pool sweep threads: ${sweepThreadIds.join(', ')} (poisoned: ${threadId})`);
    expect(sweepThreadIds).not.toContain(threadId);
  } finally {
    sweep.forEach(c => c.release());
  }
}

beforeAll(async () => {
  const host = process.env.AZURE_SQL_SERVER;
  // eslint-disable-next-line no-console
  console.log(`[runquery-timeout] resolved ConnectionManager host = '${host}'`);
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid touching a real database.`);
  }

  const setup = await setupTestDatabase(DEFAULT_TEST_CONFIG);
  setupConnection = setup.connection;
  config = setup.config;
  schema = config.database;

  // Mirrors the incident's statement shape: a CALL whose long-running work has
  // no server-side timeout. The statement after SLEEP proves the kill flag
  // aborts the whole CALL, not just the statement it interrupted.
  await setupConnection.query(`DROP PROCEDURE IF EXISTS \`${schema}\`.${SLEEPY_PROCEDURE}`);
  await setupConnection.query(
    `CREATE PROCEDURE \`${schema}\`.${SLEEPY_PROCEDURE}(IN sleep_seconds INT)
     BEGIN
       SELECT SLEEP(sleep_seconds) AS slept;
       SELECT 1 AS after_sleep;
     END`
  );
}, 90000);

afterAll(async () => {
  await connectionManager.closeConnection();
  await teardownTestDatabase(setupConnection, config);
});

describe('runQuery timeout — server-side kill + pool quarantine (real MySQL)', () => {
  it('kills a timed-out execute()-path statement and quarantines its connection', async () => {
    await expectTimeoutKillAndQuarantine('SELECT SLEEP(?) AS slept', [SLEEP_SECONDS]);
  }, 30000);

  it('kills a timed-out CALL (no MAX_EXECUTION_TIME backstop exists for CALL) and quarantines its connection', async () => {
    await expectTimeoutKillAndQuarantine(`CALL \`${schema}\`.${SLEEPY_PROCEDURE}(?)`, [SLEEP_SECONDS]);
  }, 30000);

  it('leaves the connection pooled and reusable after an ordinary (non-timeout) query error', async () => {
    const connection = (await getConn()) as QuarantinedConnection;
    try {
      await expect(runQuery(connection, `SELECT * FROM \`${schema}\`.table_that_does_not_exist_xyz`, [])).rejects.toSatisfy(
        (err: unknown) => !(err instanceof QueryTimeoutError)
      );
      // Still attached to the pool and still usable — ordinary errors must not
      // trigger the quarantine path.
      expect(connection.connection?._pool ?? null).not.toBeNull();
      const rows = await runQuery(connection, 'SELECT 1 AS ok', []);
      expect(Number(rows[0].ok)).toBe(1);
    } finally {
      connection.release();
    }
  }, 30000);
});
