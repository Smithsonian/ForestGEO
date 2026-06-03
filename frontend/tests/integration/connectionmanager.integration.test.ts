/**
 * ConnectionManager.withTransaction — REAL transaction behavior against local MySQL.
 *
 * Unlike the editplan integration suites, this test does NOT mock
 * ConnectionManager. It exercises the genuine ConnectionManager singleton —
 * which acquires connections through getPoolMonitorInstance() — so it proves
 * that:
 *   1. withTransaction hands the callback a scoped TxExecutor whose `query`
 *      runs on the transaction's dedicated connection.
 *   2. A callback that throws causes a real ROLLBACK (writes discarded).
 *   3. A callback that returns normally causes a real COMMIT (writes persisted).
 *   4. tx.id is a stable, non-empty transaction identifier usable as the
 *      migration bridge to legacy string-id helpers.
 *
 * CRITICAL SAFETY: ConnectionManager's pool host is process.env.AZURE_SQL_SERVER,
 * which defaults to PRODUCTION Azure MySQL. vitest.integration.config.mts pins
 * that env to the local docker container (127.0.0.1) for ALL integration tests.
 * The beforeAll guard below HARD-FAILS before any write if the host is not local,
 * so this suite can never touch a real database even if the config regresses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ConnectionManager from '@/config/connectionmanager';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestDatabaseConfig } from '../setup/local-db-setup';
import type { Connection } from 'mysql2/promise';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;
const PROBE_TABLE = 'tx_probe';

// Distinct sentinel labels so a leaked row from one test can't masquerade as another.
const ROLLBACK_LABEL = 'rollback-should-not-persist';
const COMMIT_LABEL = 'commit-should-persist';
const ROLLBACK_FAILURE_MESSAGE = 'intentional-rollback-trigger';

let setupConnection: Connection | null = null;
let config: TestDatabaseConfig;
let schema: string;

const connectionManager = ConnectionManager.getInstance();

/** Fully-qualified probe-table read run OUTSIDE any transaction (fresh pool connection). */
async function countProbeRows(label: string): Promise<number> {
  const rows = await connectionManager.executeQuery(`SELECT COUNT(*) AS total FROM \`${schema}\`.${PROBE_TABLE} WHERE Label = ?`, [label]);
  return Number(rows[0].total);
}

beforeAll(async () => {
  const host = process.env.AZURE_SQL_SERVER;
  // eslint-disable-next-line no-console
  console.log(`[connectionmanager.integration] resolved ConnectionManager host = '${host}'`);
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid writing to a real database.`);
  }

  const setup = await setupTestDatabase(DEFAULT_TEST_CONFIG);
  setupConnection = setup.connection;
  config = setup.config;
  schema = config.database;

  // Minimal isolated table — no FK dependencies, so commit/rollback semantics
  // are the only thing under test. Created through the setup connection (the
  // same local docker MySQL the ConnectionManager pool targets).
  await setupConnection.query(`DROP TABLE IF EXISTS \`${schema}\`.${PROBE_TABLE}`);
  await setupConnection.query(
    `CREATE TABLE \`${schema}\`.${PROBE_TABLE} (
       ID INT AUTO_INCREMENT PRIMARY KEY,
       Label VARCHAR(128) NOT NULL
     ) ENGINE=InnoDB`
  );
}, 90000);

afterAll(async () => {
  // Release the ConnectionManager's pooled connections so the test process can
  // exit cleanly, then drop the isolated schema.
  await connectionManager.closeConnection();
  await teardownTestDatabase(setupConnection, config);
});

describe('ConnectionManager.withTransaction — real rollback/commit semantics', () => {
  it('rolls back writes when the callback throws (tx.query inside transaction)', async () => {
    const before = await countProbeRows(ROLLBACK_LABEL);
    expect(before).toBe(0);

    await expect(
      connectionManager.withTransaction(async tx => {
        await tx.query(`INSERT INTO \`${schema}\`.${PROBE_TABLE} (Label) VALUES (?)`, [ROLLBACK_LABEL]);

        // The write is visible WITHIN the same transaction (same connection)
        // before we deliberately abort.
        const inTx = await tx.query(`SELECT COUNT(*) AS total FROM \`${schema}\`.${PROBE_TABLE} WHERE Label = ?`, [ROLLBACK_LABEL]);
        expect(Number(inTx[0].total)).toBe(1);

        throw new Error(ROLLBACK_FAILURE_MESSAGE);
      })
    ).rejects.toThrow(ROLLBACK_FAILURE_MESSAGE);

    // After rollback, a fresh non-transactional read must NOT see the row.
    const after = await countProbeRows(ROLLBACK_LABEL);
    expect(after).toBe(0);
  });

  it('commits writes when the callback returns normally (tx.query inside transaction)', async () => {
    const before = await countProbeRows(COMMIT_LABEL);
    expect(before).toBe(0);

    const result = await connectionManager.withTransaction(async tx => {
      await tx.query(`INSERT INTO \`${schema}\`.${PROBE_TABLE} (Label) VALUES (?)`, [COMMIT_LABEL]);
      return { inserted: true };
    });

    expect(result).toEqual({ inserted: true });

    // After commit, a fresh non-transactional read MUST see exactly one row.
    const after = await countProbeRows(COMMIT_LABEL);
    expect(after).toBe(1);
  });

  it('exposes a non-empty tx.id usable as the legacy string-id migration bridge', async () => {
    let capturedId: string | undefined;

    await connectionManager.withTransaction(async tx => {
      capturedId = tx.id;
      expect(typeof tx.id).toBe('string');
      expect(tx.id.length).toBeGreaterThan(0);
      // The id maps to a live transaction connection: executing through the
      // same id via the manager's string-id path must succeed.
      const rows = await connectionManager.executeQuery('SELECT 1 AS ok', [], tx.id);
      expect(Number(rows[0].ok)).toBe(1);
    });

    expect(capturedId).toBeTruthy();
  });
});
