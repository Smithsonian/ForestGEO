/**
 * ConnectionManager.withTransaction — TIMEOUT CANCELLATION (regression guard).
 *
 * This suite pins down the behavior of `withTransaction(fn, { timeoutMs })` when
 * `fn` is still running a slow server-side statement at the moment the timeout
 * fires. It asserts the contract — "the timeout returns control and frees
 * resources at ~timeoutMs" — and guards the fix that makes that true.
 *
 * ── The bug this guards against (regressed behavior) ──────────────────────────
 * withTransaction races fn against a timeout (connectionmanager.ts: Promise.race
 * at the `await Promise.race([fnPromise, timeoutPromise])` line). When the
 * timeout wins, the catch block rolls back via `await connection.rollback()`.
 * But mysql2 serializes every command on a single connection through a FIFO
 * queue, so a bare ROLLBACK is enqueued BEHIND the still-in-flight statement fn
 * already submitted — it cannot execute, and the connection cannot be released
 * nor the slot reclaimed, until the slow statement finishes on its own. Without
 * the fix the timeout neither returns early nor frees the slot:
 *   (1) withTransaction returns only when the runaway query finishes
 *       (here ~SLEEP_SECONDS), defeating the timeout.
 *   (2) The transaction slot / connection stays occupied past the timeout —
 *       under load the MAX_CONCURRENT_TRANSACTIONS pool fills with zombies while
 *       every caller believes its request already timed out.
 *
 * ── The fix (in withTransaction) ──────────────────────────────────────────────
 * On timeout, withTransaction issues `KILL QUERY <threadId>` from a SEPARATE
 * connection (killRunningQuery) to abort the running statement, so the queued
 * ROLLBACK/release proceed promptly. An AbortSignal cannot substitute: mysql2
 * has no protocol-level statement abort, so the server-side statement runs to
 * completion and the connection stays poisoned until it is KILLed. This suite
 * fails if that KILL path is ever removed or regressed.
 *
 * CRITICAL SAFETY: ConnectionManager's pool host is process.env.AZURE_SQL_SERVER,
 * which defaults to PRODUCTION Azure MySQL. vitest.integration.config.mts pins
 * that env to the local docker container (127.0.0.1) for ALL integration tests.
 * The beforeAll guard below HARD-FAILS before anything runs if the host is not
 * local, so this suite can never touch a real database even if the config
 * regresses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ConnectionManager from '@/config/connectionmanager';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestDatabaseConfig } from '../setup/local-db-setup';
import type { Connection } from 'mysql2/promise';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;

// A short transaction timeout paired with a much longer server-side statement,
// so the gap between "timeout fired" and "statement finished" is unambiguous.
const TX_TIMEOUT_MS = 2000;
const SLEEP_SECONDS = 8;
const SLEEP_MS = SLEEP_SECONDS * 1000;

// If cancellation worked, withTransaction would settle within the timeout plus a
// generous slack for rollback + release. The buggy path settles at ~SLEEP_MS,
// which is well beyond this bound — that difference is what fails the assertion.
const CANCELLATION_SLACK_MS = 2500;
const EXPECTED_MAX_SETTLE_MS = TX_TIMEOUT_MS + CANCELLATION_SLACK_MS;

// When we sample slot occupancy: comfortably after the timeout has fired but
// comfortably before the runaway SLEEP could finish on its own.
const SAMPLE_AFTER_TIMEOUT_MS = TX_TIMEOUT_MS + 1000;

// Per-test ceiling must exceed the buggy ~SLEEP_MS settle time plus teardown.
const TEST_TIMEOUT_MS = 20000;

let setupConnection: Connection | null = null;
let config: TestDatabaseConfig;

const connectionManager = ConnectionManager.getInstance();

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

beforeAll(async () => {
  const host = process.env.AZURE_SQL_SERVER;
  // eslint-disable-next-line no-console
  console.log(`[withtransaction-timeout.integration] resolved ConnectionManager host = '${host}'`);
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid touching a real database.`);
  }

  const setup = await setupTestDatabase(DEFAULT_TEST_CONFIG);
  setupConnection = setup.connection;
  config = setup.config;
}, 90000);

afterAll(async () => {
  // Release the ConnectionManager's pooled connections so the test process can
  // exit cleanly, then drop the isolated schema.
  await connectionManager.closeConnection();
  await teardownTestDatabase(setupConnection, config);
});

describe('ConnectionManager.withTransaction — timeout must cancel the runaway query', () => {
  it(
    'returns control at the timeout, NOT when the runaway query finishes',
    async () => {
      const start = Date.now();

      // fn runs an 8s server-side SLEEP; the transaction timeout is 2s. The
      // timeout fires first and withTransaction rejects with a timeout error —
      // but the question is WHEN that rejection is delivered to the caller.
      await expect(
        connectionManager.withTransaction(
          async tx => {
            await tx.query(`SELECT SLEEP(?)`, [SLEEP_SECONDS]);
          },
          { timeoutMs: TX_TIMEOUT_MS }
        )
      ).rejects.toThrow(/timed out/i);

      const elapsedMs = Date.now() - start;
      // eslint-disable-next-line no-console
      console.log(`[withtransaction-timeout] settled after ${elapsedMs}ms (timeout was ${TX_TIMEOUT_MS}ms, sleep was ${SLEEP_MS}ms)`);

      // WITH THE FIX: the timeout KILLs the statement and control returns at
      //   ~TX_TIMEOUT_MS.
      // WITHOUT THE FIX: rollback queues behind the un-cancelled SLEEP, so the
      //   caller is blocked until the statement drains — elapsed ≈ SLEEP_MS.
      expect(elapsedMs).toBeLessThan(EXPECTED_MAX_SETTLE_MS);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'frees the transaction slot at the timeout, not when the query finishes',
    async () => {
      expect(connectionManager.hasActiveTransactions()).toBe(false);

      // Start the slow transaction but do NOT await it yet. Its timeout will
      // fire at TX_TIMEOUT_MS; the SLEEP keeps the connection busy until SLEEP_MS.
      const slow = connectionManager
        .withTransaction(
          async tx => {
            await tx.query(`SELECT SLEEP(?)`, [SLEEP_SECONDS]);
          },
          { timeoutMs: TX_TIMEOUT_MS }
        )
        .catch(() => {
          /* timeout rejection is expected and asserted in the test above */
        });

      // Sample after the timeout has fired but before the SLEEP could finish.
      await delay(SAMPLE_AFTER_TIMEOUT_MS);
      const activeAfterTimeout = connectionManager.hasActiveTransactions();
      // eslint-disable-next-line no-console
      console.log(
        `[withtransaction-timeout] hasActiveTransactions ${SAMPLE_AFTER_TIMEOUT_MS}ms after start (timeout at ${TX_TIMEOUT_MS}ms) = ${activeAfterTimeout}`
      );

      // WITH THE FIX: the timeout reclaimed the slot/connection → no active tx.
      // WITHOUT THE FIX: the connection is still pinned by the un-cancelled
      //   SLEEP, so the slot is a zombie until the query drains at ~SLEEP_MS.
      expect(activeAfterTimeout).toBe(false);

      // Drain the orphan so afterAll can release/teardown cleanly.
      await slow;
    },
    TEST_TIMEOUT_MS
  );
});
