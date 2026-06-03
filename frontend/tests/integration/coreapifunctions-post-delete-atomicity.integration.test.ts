/**
 * Regression: coreapifunctions POST + DELETE write atomicity.
 *
 * Mirrors coreapifunctions-patch-atomicity.integration.test.ts. Both handlers
 * previously called connectionManager.executeQuery WITHOUT a transaction id
 * inside a manual beginTransaction/commitTransaction wrapper, so each write
 * ran on its own autocommit pool connection and the surrounding "transaction"
 * wrapped nothing. The fix routes their writes through
 * ConnectionManager.withTransaction(tx => tx.query(...)) — the same shape Task
 * 5 introduced for PATCH.
 *
 * Here we drive the exact write shape the fixed POST and DELETE handlers now
 * use (an INSERT/DELETE followed by a deliberately-failing statement inside
 * one withTransaction) and assert the earlier write is rolled back. Faithfully
 * invoking the full Next.js routes adds little over exercising the real
 * ConnectionManager write path and would require heavy route mocking, so we
 * test the write sequences directly against real local MySQL.
 *
 * SAFETY: identical guard to coreapifunctions-patch-atomicity — the suite
 * HARD-FAILS before any write if the ConnectionManager pool host is not local.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ConnectionManager from '@/config/connectionmanager';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestDatabaseConfig } from '../setup/local-db-setup';
import type { Connection } from 'mysql2/promise';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;
const TARGET_TABLE = 'post_delete_atomicity_probe';

const POST_ATOMICITY_LABEL = 'post-atomicity-insert-should-roll-back';
const DELETE_ATOMICITY_LABEL = 'delete-atomicity-row-should-survive';
const MID_SEQUENCE_FAILURE = 'intentional-mid-sequence-failure';

let setupConnection: Connection | null = null;
let config: TestDatabaseConfig;
let schema: string;

const connectionManager = ConnectionManager.getInstance();

async function countLabelRows(label: string): Promise<number> {
  const rows = await connectionManager.executeQuery(`SELECT COUNT(*) AS total FROM \`${schema}\`.${TARGET_TABLE} WHERE Label = ?`, [label]);
  return Number(rows[0].total);
}

beforeAll(async () => {
  const host = process.env.AZURE_SQL_SERVER;
  // eslint-disable-next-line no-console
  console.log(`[coreapifunctions-post-delete-atomicity] resolved ConnectionManager host = '${host}'`);
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid writing to a real database.`);
  }

  const setup = await setupTestDatabase(DEFAULT_TEST_CONFIG);
  setupConnection = setup.connection;
  config = setup.config;
  schema = config.database;

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

describe('coreapifunctions POST write sequence — atomicity', () => {
  it('rolls back an earlier INSERT when a later statement in the same withTransaction fails', async () => {
    const before = await countLabelRows(POST_ATOMICITY_LABEL);
    expect(before).toBe(0);

    await expect(
      connectionManager.withTransaction(async tx => {
        // (a) the INSERT that, under the old autocommit bug in POST, would have
        // persisted independently of the surrounding "transaction".
        await tx.query(`INSERT INTO \`${schema}\`.${TARGET_TABLE} (Label) VALUES (?)`, [POST_ATOMICITY_LABEL]);

        // It IS visible within the same transaction (same connection) pre-failure.
        const inTx = await tx.query(`SELECT COUNT(*) AS total FROM \`${schema}\`.${TARGET_TABLE} WHERE Label = ?`, [POST_ATOMICITY_LABEL]);
        expect(Number(inTx[0].total)).toBe(1);

        // (b) deliberately-failing statement — syntactically valid but references
        // a non-existent column so MySQL rejects it mid-sequence.
        await tx.query(`UPDATE \`${schema}\`.${TARGET_TABLE} SET NoSuchColumn = 1 WHERE Label = ?`, [POST_ATOMICITY_LABEL]);

        throw new Error(MID_SEQUENCE_FAILURE);
      })
    ).rejects.toThrow();

    // After auto-rollback, a fresh non-transactional read must NOT see the INSERT.
    const after = await countLabelRows(POST_ATOMICITY_LABEL);
    expect(after).toBe(0);
  });
});

describe('coreapifunctions DELETE write sequence — atomicity', () => {
  it('rolls back an earlier DELETE when a later statement in the same withTransaction fails', async () => {
    // Seed a row OUTSIDE any transaction so the DELETE has something real to remove.
    await connectionManager.executeQuery(`INSERT INTO \`${schema}\`.${TARGET_TABLE} (Label) VALUES (?)`, [DELETE_ATOMICITY_LABEL]);
    expect(await countLabelRows(DELETE_ATOMICITY_LABEL)).toBe(1);

    await expect(
      connectionManager.withTransaction(async tx => {
        // (a) the DELETE that, under the old autocommit bug in DELETE, would have
        // persisted independently of the surrounding "transaction".
        await tx.query(`DELETE FROM \`${schema}\`.${TARGET_TABLE} WHERE Label = ?`, [DELETE_ATOMICITY_LABEL]);

        // The row is gone within the same transaction (same connection) pre-failure.
        const inTx = await tx.query(`SELECT COUNT(*) AS total FROM \`${schema}\`.${TARGET_TABLE} WHERE Label = ?`, [DELETE_ATOMICITY_LABEL]);
        expect(Number(inTx[0].total)).toBe(0);

        // (b) deliberately-failing statement — non-existent column rejects.
        await tx.query(`DELETE FROM \`${schema}\`.${TARGET_TABLE} WHERE NoSuchColumn = ?`, [DELETE_ATOMICITY_LABEL]);

        throw new Error(MID_SEQUENCE_FAILURE);
      })
    ).rejects.toThrow();

    // After auto-rollback, a fresh non-transactional read MUST still see the row.
    expect(await countLabelRows(DELETE_ATOMICITY_LABEL)).toBe(1);
  });
});
