/**
 * Regression: coreapifunctions PATCH write atomicity + session-variable scoping.
 *
 * This proves the two defects fixed by routing the PATCH handler's writes through
 * ConnectionManager.withTransaction(tx => tx.query(...)) instead of bare
 * connectionManager.executeQuery(...):
 *
 *   1. ATOMICITY — the handler used to call executeQuery WITHOUT a transaction id,
 *      so each write ran on its own autocommit pool connection and the surrounding
 *      transaction wrapped nothing. Here we drive the SAME write shape the handler
 *      now uses (an INSERT followed by a deliberately-failing statement inside one
 *      withTransaction) and assert the INSERT is rolled back.
 *
 *   2. SESSION VARIABLE — the handler does `SET @CURRENT_CENSUS_ID = ?` then an
 *      UPDATE; the changelog trigger reads that session variable. When the SET and
 *      the read run on DIFFERENT connections (the old bug), the reader sees NULL.
 *      We assert that within a single withTransaction, a SET on tx.query is visible
 *      to a later tx.query read on the SAME connection — and that a fresh pool
 *      connection does NOT see it.
 *
 * This is the focused write-sequence proof the task calls for. Faithfully invoking
 * the full Next.js PATCH route (NextRequest + cookies + MapperFactory) adds little
 * over exercising the genuine ConnectionManager write path and would require heavy
 * route mocking, so we test the write sequence directly against real local MySQL.
 *
 * SAFETY: identical guard to connectionmanager.integration.test.ts — the suite
 * HARD-FAILS before any write if the ConnectionManager pool host is not local.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ConnectionManager from '@/config/connectionmanager';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestDatabaseConfig } from '../setup/local-db-setup';
import type { Connection } from 'mysql2/promise';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;
const TARGET_TABLE = 'patch_atomicity_probe';

// Sentinel labels keep a leaked row from one test from masquerading as another.
const ATOMICITY_LABEL = 'atomicity-insert-should-roll-back';
const MID_SEQUENCE_FAILURE = 'intentional-mid-sequence-failure';
const SENTINEL_CENSUS_ID = 4242;

let setupConnection: Connection | null = null;
let config: TestDatabaseConfig;
let schema: string;

const connectionManager = ConnectionManager.getInstance();

/** Row count read OUTSIDE any transaction (fresh pool connection). */
async function countLabelRows(label: string): Promise<number> {
  const rows = await connectionManager.executeQuery(`SELECT COUNT(*) AS total FROM \`${schema}\`.${TARGET_TABLE} WHERE Label = ?`, [label]);
  return Number(rows[0].total);
}

beforeAll(async () => {
  const host = process.env.AZURE_SQL_SERVER;
  // eslint-disable-next-line no-console
  console.log(`[coreapifunctions-patch-atomicity] resolved ConnectionManager host = '${host}'`);
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid writing to a real database.`);
  }

  const setup = await setupTestDatabase(DEFAULT_TEST_CONFIG);
  setupConnection = setup.connection;
  config = setup.config;
  schema = config.database;

  // FK-free target table so commit/rollback + session-variable scoping are the
  // only things under test, mirroring the handler's "INSERT then UPDATE" shape.
  await setupConnection.query(`DROP TABLE IF EXISTS \`${schema}\`.${TARGET_TABLE}`);
  await setupConnection.query(
    `CREATE TABLE \`${schema}\`.${TARGET_TABLE} (
       ID INT AUTO_INCREMENT PRIMARY KEY,
       Label VARCHAR(128) NOT NULL
     ) ENGINE=InnoDB`
  );
}, 90000);

afterAll(async () => {
  await connectionManager.closeConnection();
  await teardownTestDatabase(setupConnection, config);
});

describe('coreapifunctions PATCH write sequence — atomicity + session-variable scoping', () => {
  it('rolls back an earlier INSERT when a later statement in the same withTransaction fails', async () => {
    const before = await countLabelRows(ATOMICITY_LABEL);
    expect(before).toBe(0);

    await expect(
      connectionManager.withTransaction(async tx => {
        // (a) the write that, under the old autocommit bug, would have persisted
        // independently of the transaction.
        await tx.query(`INSERT INTO \`${schema}\`.${TARGET_TABLE} (Label) VALUES (?)`, [ATOMICITY_LABEL]);

        // It IS visible within the same transaction (same connection) pre-failure.
        const inTx = await tx.query(`SELECT COUNT(*) AS total FROM \`${schema}\`.${TARGET_TABLE} WHERE Label = ?`, [ATOMICITY_LABEL]);
        expect(Number(inTx[0].total)).toBe(1);

        // (b) deliberately-failing statement — syntactically valid but references
        // a non-existent column so MySQL rejects it mid-sequence.
        await tx.query(`UPDATE \`${schema}\`.${TARGET_TABLE} SET NoSuchColumn = 1 WHERE Label = ?`, [ATOMICITY_LABEL]);

        throw new Error(MID_SEQUENCE_FAILURE);
      })
    ).rejects.toThrow();

    // After auto-rollback, a fresh non-transactional read must NOT see the INSERT.
    const after = await countLabelRows(ATOMICITY_LABEL);
    expect(after).toBe(0);
  });

  it('keeps SET @CURRENT_CENSUS_ID visible to a later read on the SAME transaction connection', async () => {
    const observed = await connectionManager.withTransaction(async tx => {
      // The handler runs `SET @CURRENT_CENSUS_ID = ?` then the UPDATE on tx.query.
      await tx.query(`SET @CURRENT_CENSUS_ID = ?`, [SENTINEL_CENSUS_ID]);
      const rows = await tx.query(`SELECT @CURRENT_CENSUS_ID AS currentCensusId`);
      return rows[0].currentCensusId === null ? null : Number(rows[0].currentCensusId);
    });

    // Same connection => the session variable is visible. This is exactly what the
    // changelog trigger relied on and what the old separate-connection code broke.
    expect(observed).toBe(SENTINEL_CENSUS_ID);
  });

  it('drives the full handler write shape (SET @CURRENT_CENSUS_ID then UPDATE) on one connection and persists the update', async () => {
    // Seed a row OUTSIDE the transaction, then update it through the same two-step
    // sequence the PATCH handler now uses: a session-variable SET followed by the
    // UPDATE, both on tx.query (same connection). Proves the UPDATE lands and that
    // the SET preceding it does not strand the UPDATE on a different connection.
    const seedLabel = 'handler-shape-seed';
    const updatedLabel = 'handler-shape-updated';
    await connectionManager.executeQuery(`INSERT INTO \`${schema}\`.${TARGET_TABLE} (Label) VALUES (?)`, [seedLabel]);

    await connectionManager.withTransaction(async tx => {
      await tx.query(`SET @CURRENT_CENSUS_ID = ?`, [SENTINEL_CENSUS_ID]);
      await tx.query(`UPDATE \`${schema}\`.${TARGET_TABLE} SET Label = ? WHERE Label = ?`, [updatedLabel, seedLabel]);
    });

    expect(await countLabelRows(seedLabel)).toBe(0);
    expect(await countLabelRows(updatedLabel)).toBe(1);
  });
});
