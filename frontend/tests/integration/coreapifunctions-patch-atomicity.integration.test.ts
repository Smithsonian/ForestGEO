/**
 * Regression: coreapifunctions PATCH write atomicity + single-connection scoping.
 *
 * This proves the two properties that routing the PATCH handler's writes through
 * ConnectionManager.withTransaction(tx => tx.query(...)) buys, instead of bare
 * connectionManager.executeQuery(...):
 *
 *   1. ATOMICITY — the handler used to call executeQuery WITHOUT a transaction id,
 *      so each write ran on its own autocommit pool connection and the surrounding
 *      transaction wrapped nothing. Here we drive the SAME write shape the handler
 *      now uses (an INSERT followed by a deliberately-failing statement inside one
 *      withTransaction) and assert the INSERT is rolled back.
 *
 *   2. ONE CONNECTION — the handler issues its mutation AND its unifiedchangelog
 *      write inside the same withTransaction. That is what makes the audit entry
 *      atomic with the change it describes: a rolled-back edit must leave no log
 *      row, and a log row must always correspond to a committed change. If the
 *      changelog write ever drifted back to a fresh pool connection it would
 *      autocommit independently, and a rolled-back edit would still be logged.
 *      We assert an uncommitted changelog row is visible on the transaction's own
 *      connection and INVISIBLE to a fresh pool connection until commit.
 *
 * This file previously described property 2 as feeding a session variable
 * (`SET @CURRENT_CENSUS_ID`) to "the changelog trigger". No trigger has existed
 * on any schema since 2025-05-12, and the SET was removed along with that claim.
 * The connection-scoping property it proved is real and now has a live consumer.
 *
 * SAFETY: identical guard to connectionmanager.integration.test.ts — the suite
 * HARD-FAILS before any write if the ConnectionManager pool host is not local.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ConnectionManager from '@/lib/db/connectionmanager';
import { ChangelogOperation, recordMutation } from '@/lib/changelog/record-mutation';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestDatabaseConfig } from '../setup/local-db-setup';
import type { Connection } from 'mysql2/promise';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;
const TARGET_TABLE = 'patch_atomicity_probe';
const CHANGELOG_TABLE = 'unifiedchangelog';

// Sentinel labels keep a leaked row from one test from masquerading as another.
const ATOMICITY_LABEL = 'atomicity-insert-should-roll-back';
const MID_SEQUENCE_FAILURE = 'intentional-mid-sequence-failure';
const SCOPING_RECORD_ID = 'connection-scoping-probe';
const HANDLER_SHAPE_RECORD_ID = 'handler-shape-probe';
const TEST_CHANGED_BY = 'atomicity-suite@si.edu';

let setupConnection: Connection | null = null;
let config: TestDatabaseConfig;
let schema: string;

const connectionManager = ConnectionManager.getInstance();

/** Row count read OUTSIDE any transaction (fresh pool connection). */
async function countLabelRows(label: string): Promise<number> {
  const rows = await connectionManager.executeQuery(`SELECT COUNT(*) AS total FROM \`${schema}\`.${TARGET_TABLE} WHERE Label = ?`, [label]);
  return Number(rows[0].total);
}

/** Changelog row count read OUTSIDE any transaction (fresh pool connection). */
async function countChangelogRows(recordID: string): Promise<number> {
  const rows = await connectionManager.executeQuery(`SELECT COUNT(*) AS total FROM \`${schema}\`.${CHANGELOG_TABLE} WHERE RecordID = ?`, [recordID]);
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

  // FK-free target table so commit/rollback is the only thing under test,
  // mirroring the handler's "mutate then log" shape.
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

describe('coreapifunctions PATCH write sequence — atomicity + single-connection scoping', () => {
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

  it('keeps an uncommitted changelog write on the transaction connection, invisible to a fresh pool connection', async () => {
    expect(await countChangelogRows(SCOPING_RECORD_ID)).toBe(0);

    await connectionManager.withTransaction(async tx => {
      await recordMutation({
        tx,
        schema,
        tableName: TARGET_TABLE,
        recordID: SCOPING_RECORD_ID,
        operation: ChangelogOperation.UPDATE,
        oldRowState: { Label: 'before' },
        newRowState: { Label: 'after' },
        changedBy: TEST_CHANGED_BY
      });

      // Same connection => visible.
      const inTx = await tx.query(`SELECT COUNT(*) AS total FROM \`${schema}\`.${CHANGELOG_TABLE} WHERE RecordID = ?`, [SCOPING_RECORD_ID]);
      expect(Number(inTx[0].total)).toBe(1);

      // Fresh pool connection => NOT visible. This is the property that makes the
      // audit entry atomic with the mutation: an independently-autocommitting
      // changelog write would already be readable here, and would survive a
      // rollback of the edit it claims to describe.
      expect(await countChangelogRows(SCOPING_RECORD_ID)).toBe(0);
    });

    // Only after commit does the rest of the pool see it.
    expect(await countChangelogRows(SCOPING_RECORD_ID)).toBe(1);
  });

  it('drives the full handler write shape (mutate then log) on one connection and persists both', async () => {
    // Seed a row OUTSIDE the transaction, then drive the same two-step sequence
    // the PATCH handler now uses: the UPDATE followed by the changelog write,
    // both on tx (same connection). Proves the log entry lands with the change.
    const seedLabel = 'handler-shape-seed';
    const updatedLabel = 'handler-shape-updated';
    await connectionManager.executeQuery(`INSERT INTO \`${schema}\`.${TARGET_TABLE} (Label) VALUES (?)`, [seedLabel]);

    await connectionManager.withTransaction(async tx => {
      await tx.query(`UPDATE \`${schema}\`.${TARGET_TABLE} SET Label = ? WHERE Label = ?`, [updatedLabel, seedLabel]);
      await recordMutation({
        tx,
        schema,
        tableName: TARGET_TABLE,
        recordID: HANDLER_SHAPE_RECORD_ID,
        operation: ChangelogOperation.UPDATE,
        oldRowState: { Label: seedLabel },
        newRowState: { Label: updatedLabel },
        changedBy: TEST_CHANGED_BY
      });
    });

    expect(await countLabelRows(seedLabel)).toBe(0);
    expect(await countLabelRows(updatedLabel)).toBe(1);
    expect(await countChangelogRows(HANDLER_SHAPE_RECORD_ID)).toBe(1);
  });
});
