/**
 * The single-connection ConnectionManager mock must not leak an aborted test's open transaction or application locks
 * into the next test (#561): resetSingleConnectionState rolls back whatever is open and releases every lock it holds.
 *
 * Prerequisites: docker compose up -d mysql
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestDatabaseConfig } from '../setup/local-db-setup';
import {
  buildSingleConnectionManagerModule,
  createSingleConnectionState,
  resetSingleConnectionState,
  SINGLE_CONNECTION_TRANSACTION_PREFIX
} from '../setup/single-connection-manager-mock';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];
const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
if (!LOCAL_HOSTS.includes(TEST_DB_HOST)) {
  throw new Error(`REFUSING TO RUN: host '${TEST_DB_HOST}' is not local. This suite writes and deletes rows.`);
}

const SETUP_TIMEOUT_MS = 120_000;
const LEAKED_LOCK_NAME = 'single-connection-mock-leak-561';
const LOCK_TIMEOUT_MS = 1000;
const LEAKED_FILE = 'leaked-by-aborted-test.csv';
const LEAKED_BATCH = 'leak-batch';
const LEAKED_SOURCE_FORMAT = 'csv';
const NO_ROWS = 0;
const LOCK_IS_FREE = 1;

describe('resetSingleConnectionState after an aborted test (#561)', () => {
  let connection: Connection;
  let config: TestDatabaseConfig;
  let plotID: number;
  let censusID: number;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    config = setup.config;
    plotID = setup.testData.plots[0].plotID;
    censusID = setup.testData.census[0].censusID;
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  async function countLeakedRows(): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ?`, [LEAKED_FILE]);
    return Number(rows[0].total);
  }

  async function isLockFree(): Promise<boolean> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT IS_FREE_LOCK(?) AS isFree`, [LEAKED_LOCK_NAME]);
    return Number(rows[0].isFree) === LOCK_IS_FREE;
  }

  it('rolls back the open transaction, releases the held lock and lets the next test begin a transaction', async () => {
    const state = createSingleConnectionState();
    state.connection = connection;
    const manager = buildSingleConnectionManagerModule(state).default.getInstance();

    const leakedTransactionID = await manager.beginTransaction();
    await manager.executeQuery(
      `INSERT INTO temporarymeasurements (FileID, BatchID, SourceFormat, PlotID, CensusID) VALUES (?, ?, ?, ?, ?)`,
      [LEAKED_FILE, LEAKED_BATCH, LEAKED_SOURCE_FORMAT, plotID, censusID],
      leakedTransactionID
    );
    expect(await manager.acquireApplicationLock(LEAKED_LOCK_NAME, leakedTransactionID, LOCK_TIMEOUT_MS)).toBe(true);
    console.log(
      `[mock reset] before reset: tx=${state.activeTransactionID} heldLocks=${[...state.heldLocks].join(',')} leakedRows=${await countLeakedRows()} lockFree=${await isLockFree()}`
    );

    await resetSingleConnectionState(state);

    const leakedRowsAfter = await countLeakedRows();
    const lockFreeAfter = await isLockFree();
    console.log(
      `[mock reset] after reset: tx=${state.activeTransactionID} heldLocks=${state.heldLocks.size} leakedRows=${leakedRowsAfter} lockFree=${lockFreeAfter}`
    );
    expect(state.activeTransactionID).toBeNull();
    expect(state.heldLocks.size).toBe(NO_ROWS);
    expect(leakedRowsAfter, 'the aborted test’s uncommitted insert is rolled back').toBe(NO_ROWS);
    expect(lockFreeAfter, 'the aborted test’s application lock is released').toBe(true);

    const nextTransactionID = await manager.beginTransaction();
    expect(nextTransactionID.startsWith(SINGLE_CONNECTION_TRANSACTION_PREFIX)).toBe(true);
    await manager.rollbackTransaction(nextTransactionID);
  });

  it('is a no-op when nothing is open', async () => {
    const state = createSingleConnectionState();
    state.connection = connection;

    await expect(resetSingleConnectionState(state)).resolves.toBeUndefined();

    expect(state.activeTransactionID).toBeNull();
    expect(state.heldLocks.size).toBe(NO_ROWS);
  });
});
