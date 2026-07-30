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
import { createConnection, type Connection, type PoolConnection } from 'mysql2/promise';
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
const KILL_CONFIRM_DEADLINE_MS = 20000;
const PROCESSLIST_POLL_MS = 25;
const POOL_SWEEP_ACQUISITIONS = 3;
const SLEEPY_PROCEDURE = 'runquery_timeout_probe_sleepy';

/** Matches lib/db/poolmonitorsingleton.ts — the number of stuck statements it takes to starve the pool. */
const POOL_CONNECTION_LIMIT = 15;
/** Long enough that a deadlocked kill path cannot finish by the statement ending on its own. */
const SATURATION_SLEEP_SECONDS = 60;
/**
 * Every timeout must settle within this: the runQuery timeout, plus the bounded
 * kill-connection acquisition, plus slack. Deliberately far below
 * SATURATION_SLEEP_SECONDS so "settled" cannot mean "the statement finished".
 */
const SATURATION_SETTLE_BUDGET_MS = 20_000;

/** Procedure that opens a transaction, writes, then grinds — killed mid-transaction. */
const TRANSACTIONAL_PROCEDURE = 'runquery_timeout_probe_txn';
const PROBE_TABLE = 'runquery_timeout_probe_rows';
const PROBE_ROW_ID = 1;
/**
 * The row the probe procedure blocks on.
 *
 * The procedure has to sit mid-transaction, holding its own row lock, long
 * enough to be killed — and the kill must surface as a real
 * ER_QUERY_INTERRUPTED. That rules out the obvious waits: SLEEP() and
 * BENCHMARK() both notice the kill flag and return a VALUE, so the procedure
 * sails on to COMMIT (measured 2026-07-29). A CPU grind does abort with 1317,
 * but its duration is a property of the host — CI ran a 700-row three-way
 * self-join to completion inside a 25ms poll while the same join took seconds
 * locally, so the test raced and failed having killed nothing.
 *
 * An InnoDB row-lock wait has neither problem: it is interrupted with 1317, and
 * it lasts until innodb_lock_wait_timeout no matter how fast the machine is.
 * The test holds the lock, so the window is deterministic rather than measured.
 */
const BLOCKING_ROW_ID = 2;
/** A follow-up statement blocked by a zombie transaction would wait innodb_lock_wait_timeout, not this. */
const FOLLOW_UP_MAX_MS = 5_000;

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

  // A procedure that holds an OPEN transaction across its sleep — the shape that
  // makes releasing a KILLed connection dangerous rather than merely untidy.
  await setupConnection.query(`DROP TABLE IF EXISTS \`${schema}\`.${PROBE_TABLE}`);
  await setupConnection.query(`CREATE TABLE \`${schema}\`.${PROBE_TABLE} (id INT PRIMARY KEY, note VARCHAR(64) NOT NULL)`);
  await setupConnection.query(`INSERT INTO \`${schema}\`.${PROBE_TABLE} (id, note) VALUES (?, 'initial')`, [PROBE_ROW_ID]);

  await setupConnection.query(`INSERT INTO \`${schema}\`.${PROBE_TABLE} (id, note) VALUES (?, 'blocking-row')`, [BLOCKING_ROW_ID]);

  await setupConnection.query(`DROP PROCEDURE IF EXISTS \`${schema}\`.${TRANSACTIONAL_PROCEDURE}`);
  await setupConnection.query(
    `CREATE PROCEDURE \`${schema}\`.${TRANSACTIONAL_PROCEDURE}()
     BEGIN
       DECLARE ignored VARCHAR(64);
       START TRANSACTION;
       UPDATE \`${schema}\`.${PROBE_TABLE} SET note = 'locked-by-procedure' WHERE id = ${PROBE_ROW_ID};
       -- Blocks on a row the test holds, so the procedure is parked
       -- mid-transaction for as long as the test needs, on any machine.
       SELECT note INTO ignored FROM \`${schema}\`.${PROBE_TABLE} WHERE id = ${BLOCKING_ROW_ID} FOR UPDATE;
       COMMIT;
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

  /**
   * The pool-exhaustion deadlock (B1). Every pooled connection is checked out on
   * a stuck statement — precisely the mass-long-CALL regime the kill path was
   * written for. Acquiring the kill connection BEFORE destroying meant every
   * firing timeout queued on getConnection() behind the saturation it was trying
   * to relieve (queueLimit is forced to 0 = wait forever), no destroy ever ran,
   * and every runQuery promise hung until the statements ended on their own.
   *
   * Destroying first frees a slot per timeout, so the kills proceed and the pool
   * drains. Pre-fix, this test does not fail with an assertion — it hangs until
   * the suite timeout, which is the same signal.
   */
  it('settles every runQuery and recovers the pool when ALL connections are stuck', async () => {
    const stuck: QuarantinedConnection[] = [];
    for (let i = 0; i < POOL_CONNECTION_LIMIT; i++) {
      stuck.push((await getConn()) as QuarantinedConnection);
    }
    const stuckThreadIds = stuck.map(connection => connection.threadId);
    // eslint-disable-next-line no-console
    console.log(`[runquery-timeout] saturated the pool with ${stuck.length} connections: ${stuckThreadIds.join(', ')}`);

    const startedAt = Date.now();
    const outcomes = await Promise.allSettled(
      stuck.map(connection => runQuery(connection, 'SELECT SLEEP(?) AS slept', [SATURATION_SLEEP_SECONDS], RUNQUERY_TIMEOUT_MS))
    );
    const settledMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.log(`[runquery-timeout] all ${outcomes.length} saturated timeouts settled in ${settledMs}ms (budget ${SATURATION_SETTLE_BUDGET_MS}ms)`);

    expect(outcomes.every(outcome => outcome.status === 'rejected' && outcome.reason instanceof QueryTimeoutError)).toBe(true);
    expect(settledMs, 'a timeout that waits on the saturated pool for its kill connection never settles').toBeLessThan(SATURATION_SETTLE_BUDGET_MS);

    // Every stuck statement is actually gone server-side, not merely abandoned.
    for (const threadId of stuckThreadIds) {
      await confirmStatementKilled(threadId!);
    }

    // The pool is usable again: if the kill path had leaked its acquisitions,
    // these would queue forever behind them.
    const recovered: QuarantinedConnection[] = [];
    try {
      for (let i = 0; i < POOL_SWEEP_ACQUISITIONS; i++) {
        recovered.push((await getConn()) as QuarantinedConnection);
      }
      const rows = await runQuery(recovered[0], 'SELECT 1 AS ok', []);
      expect(Number(rows[0].ok)).toBe(1);
      expect(recovered.map(connection => connection.threadId)).not.toEqual(expect.arrayContaining(stuckThreadIds));
    } finally {
      recovered.forEach(connection => connection.release());
    }
  }, 90000);

  /**
   * The zombie-transaction hazard (B3). When ER_QUERY_INTERRUPTED reaches the
   * client, the procedure's EXIT HANDLER never completed — its internal
   * START TRANSACTION may still be open, holding row locks. Before the fix that
   * connection was RELEASED (destroy only happened on runQuery's own timeout
   * path), so the caller's very next statement could block for
   * innodb_lock_wait_timeout on locks held by a transaction nobody owned, and
   * the next pool borrower silently joined an uncommitted transaction.
   */
  it('quarantines a connection KILLed mid-transaction so the next statement does not lock-wait', async () => {
    // A dedicated connection holds BLOCKING_ROW_ID so the procedure parks on it.
    // Not from the pool: this connection stays in an open transaction for the
    // duration and must never be handed to anything else.
    const blocker = await createConnection({ ...config, database: schema });
    // The blocker's open transaction holds row AND metadata locks on this
    // schema. If it outlives the test — which is exactly what happened when an
    // assertion above the old inline rollback threw — this worker process keeps
    // the transaction open across every later test file, and each file's
    // DROP DATABASE in createTestDatabase waits on the metadata lock until its
    // beforeAll times out. Measured in CI: three 35-minute runs, each a chain
    // of ~90s hook timeouts downstream of exactly this leak. Every exit path
    // must run releaseBlocker.
    let blockerReleased = false;
    const releaseBlocker = async () => {
      if (blockerReleased) return;
      blockerReleased = true;
      try {
        await blocker.rollback();
      } catch {
        // the connection is already dead — end/destroy below still frees the server thread
      }
      try {
        await blocker.end();
      } catch {
        blocker.destroy();
      }
    };

    try {
      await blocker.beginTransaction();
      await blocker.query(`UPDATE \`${schema}\`.${PROBE_TABLE} SET note = 'held-by-test' WHERE id = ?`, [BLOCKING_ROW_ID]);

      // Acquire the killer BEFORE launching the CALL. Acquiring afterwards put a
      // pool round-trip inside the race.
      const killer = (await getConn()) as QuarantinedConnection;

      let callSettled = false;
      const callPromise = connectionManager
        .executeQuery(`CALL \`${schema}\`.${TRANSACTIONAL_PROCEDURE}()`)
        .then(() => null)
        .catch((error: unknown) => error)
        .finally(() => {
          callSettled = true;
        });

      let killedThreadId: number | null = null;
      try {
        const deadline = Date.now() + KILL_CONFIRM_DEADLINE_MS;
        while (Date.now() < deadline && killedThreadId === null && !callSettled) {
          // PROCESSLIST.INFO shows the CALL text only during dispatch; once the
          // procedure reaches its inner statements, INFO is the innermost
          // statement, and while parked on the row lock that is the
          // `... FOR UPDATE` SELECT — which does not contain the procedure
          // name. Matching the procedure name alone therefore races the
          // dispatch window: fast machines usually win it, the 2-core CI
          // runner deterministically lost it (measured 2026-07-30 via this
          // test's own processlist dump). The second pattern matches the
          // parked statement, which stays visible for the entire lock wait.
          // `ID <> CONNECTION_ID()` and the PROCESSLIST exclusion are
          // load-bearing: this probe's own statement carries both LIKE
          // parameters, so without them the killer matches — and kills —
          // itself.
          const rows = await runQuery(
            killer,
            `SELECT ID FROM information_schema.PROCESSLIST
             WHERE ID <> CONNECTION_ID() AND (INFO LIKE ? OR INFO LIKE ?) AND INFO NOT LIKE '%PROCESSLIST%' LIMIT 1`,
            [`%${TRANSACTIONAL_PROCEDURE}%`, `%${PROBE_TABLE}%FOR UPDATE%`]
          );
          if (rows.length > 0) {
            killedThreadId = Number(rows[0].ID);
            await runQuery(killer, `KILL QUERY ${killedThreadId}`, []);
          } else {
            await wait(PROCESSLIST_POLL_MS);
          }
        }
        if (killedThreadId === null) {
          // A failure here is otherwise undiagnosable after the fact: dump what
          // the server actually had running so the next reader is not guessing.
          const processes = await runQuery(killer, `SELECT ID, COMMAND, STATE, LEFT(COALESCE(INFO, ''), 120) AS info FROM information_schema.PROCESSLIST`, []);
          // eslint-disable-next-line no-console
          console.log(`[runquery-timeout] processlist when the kill never landed: ${JSON.stringify(processes)}`);
        }
      } finally {
        killer.release();
      }
      expect(
        killedThreadId,
        callSettled
          ? `the ${TRANSACTIONAL_PROCEDURE} CALL settled before it could be killed — it should have been parked on ` +
              `row ${BLOCKING_ROW_ID}'s lock, so either the lock was not held or the procedure never reached the wait`
          : `never saw the ${TRANSACTIONAL_PROCEDURE} CALL executing within ${KILL_CONFIRM_DEADLINE_MS}ms — nothing was killed`
      ).not.toBeNull();

      const callError = await callPromise;
      // The killed procedure is gone; release the row so the follow-up write below
      // measures the ZOMBIE's lock, not the test's own.
      await releaseBlocker();
      // eslint-disable-next-line no-console
      console.log(`[runquery-timeout] killed thread ${killedThreadId}; CALL rejected with: ${(callError as Error | null)?.message}`);
      expect(callError, 'the KILLed CALL must reject, not resolve').toBeInstanceOf(Error);
      expect((callError as { errno?: number }).errno, 'the kill must reach the client as ER_QUERY_INTERRUPTED').toBe(1317);

      // The row the dead procedure had written is writable immediately. Measured
      // 2026-07-29: with the quarantine removed this particular row lock is NOT
      // retained (MySQL rolls back the interrupted statement), so this assertion
      // alone does not catch the defect — the open-transaction probe below is what
      // does. It is kept because a zombie holding a lock is the worse variant of
      // the same failure, and nothing else would notice it.
      const followUpStartedAt = Date.now();
      await connectionManager.executeQuery(`UPDATE \`${schema}\`.${PROBE_TABLE} SET note = 'after-kill' WHERE id = ?`, [PROBE_ROW_ID]);
      const followUpMs = Date.now() - followUpStartedAt;
      // eslint-disable-next-line no-console
      console.log(`[runquery-timeout] follow-up UPDATE completed in ${followUpMs}ms (budget ${FOLLOW_UP_MAX_MS}ms)`);
      expect(followUpMs).toBeLessThan(FOLLOW_UP_MAX_MS);

      // The decisive assertion. Pre-fix, the KILLed connection was RELEASED back
      // to the pool with the procedure's START TRANSACTION still open — verified
      // by removing the quarantine, which leaves exactly one row here. The next
      // borrower of that connection would have silently joined an uncommitted
      // transaction.
      const openTransactions = await connectionManager.executeQuery(
        `SELECT trx_id, trx_mysql_thread_id, trx_started FROM information_schema.innodb_trx WHERE trx_mysql_thread_id = ?`,
        [killedThreadId]
      );
      expect(openTransactions, `thread ${killedThreadId} still carries an open transaction`).toHaveLength(0);
    } finally {
      await releaseBlocker();
    }
  }, 90000);

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
