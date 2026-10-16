/**
 * recordAuditedIngestionFailureRows — Integration Tests
 *
 * Exercises the shared bounded, audited failure-persistence helper
 * (lib/changelog/ingestion-failure-audit.ts, issue #507) against a real local
 * MySQL instance: insertIngestionFailureRows' real upsert SQL, plus the keyed
 * before/after audit (lib/changelog/ingestion-audit.ts) that wraps it.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/ingestion-failure-audit.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';
import type { IngestionFailureRowInput } from '@/config/measurementerrors';

// ---------------------------------------------------------------------------
// Safety guard — setupTestDatabase DROPs/CREATEs its schema; never run remote.
// ---------------------------------------------------------------------------

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';

if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST) || !['localhost', '127.0.0.1'].includes(process.env.AZURE_SQL_SERVER ?? '')) {
  throw new Error(
    `[ingestion-failure-audit] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops and recreates its test schema and must only run against a local test database.`
  );
}

vi.mock('@/ailogger', () => ({
  default: {
    info: (msg: string) => console.log(`[ailogger.info] ${msg}`),
    warn: (msg: string) => console.log(`[ailogger.warn] ${msg}`),
    error: (msg: string) => console.log(`[ailogger.error] ${msg}`)
  }
}));

import ConnectionManager from '@/lib/db/connectionmanager';
import { recordAuditedIngestionFailureRows, buildIngestionFailureBatchLockName } from '@/lib/changelog/ingestion-failure-audit';
import { ChangelogWriteError } from '@/lib/changelog/record-mutation';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const FILE_NAME = 'ingestion-failure-audit-fixture.csv';
const BATCH_ID = 'failure-audit-batch-0001';
const CHANGED_BY = 'failure-audit-test@forestgeo.test';

function buildFailureRow(
  overrides: Partial<IngestionFailureRowInput> & { sourceRowIndex: number; plotID: number; censusID: number }
): IngestionFailureRowInput {
  return {
    tag: `T${overrides.sourceRowIndex}`,
    stemTag: '1',
    spCode: 'ACERRU',
    quadrat: 'Q01',
    x: 1.5,
    y: 2.5,
    dbh: 10.5,
    hom: 1.3,
    date: '2024-03-15',
    codes: null,
    comments: null,
    failureReason: 'Duplicate measurement row detected',
    fileID: FILE_NAME,
    batchID: BATCH_ID,
    ...overrides
  };
}

describe('recordAuditedIngestionFailureRows — integration', () => {
  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;
  let schema: string;
  let plotID: number;
  let censusID: number;

  const connectionManager = ConnectionManager.getInstance();

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    schema = setup.config.database;
    plotID = testData.plots[0].plotID;
    censusID = testData.census[0].censusID;

    console.log(`[setup] schema=${schema} plotID=${plotID} censusID=${censusID}`);
  }, 90000);

  afterAll(async () => {
    await connectionManager.closeConnection();
    await teardownTestDatabase(connection, config);
  });

  const activeTransactions = new Set<string>();
  beforeEach(async () => {
    const begin = connectionManager.beginTransaction.bind(connectionManager);
    vi.spyOn(connectionManager, 'beginTransaction').mockImplementation(async () => {
      const id = await begin();
      activeTransactions.add(id);
      return id;
    });
    await connection.query('DELETE FROM unifiedchangelog');
    await connection.query('DELETE FROM measurement_error_log');
    await connection.query('DELETE FROM coremeasurements');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const id of activeTransactions) await connectionManager.rollbackTransaction(id);
    activeTransactions.clear();
  });

  async function withTx<T>(fn: (transactionID: string) => Promise<T>): Promise<T> {
    const transactionID = await connectionManager.beginTransaction();
    try {
      const result = await fn(transactionID);
      await connectionManager.commitTransaction(transactionID);
      return result;
    } catch (error) {
      await connectionManager.rollbackTransaction(transactionID);
      throw error;
    }
  }

  async function auditRowsFor(sourceRowIndex: number): Promise<RowDataPacket[]> {
    const [measurementRows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID FROM coremeasurements WHERE UploadFileID = ? AND UploadBatchID = ? AND SourceRowIndex = ?`,
      [FILE_NAME, BATCH_ID, sourceRowIndex]
    );
    if (measurementRows.length === 0) return [];
    const [auditRows] = await connection.query<RowDataPacket[]>(
      `SELECT Operation, OldRowState, NewRowState, ChangedBy FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND RecordID = ? ORDER BY ChangeID ASC`,
      [measurementRows[0].CoreMeasurementID]
    );
    return auditRows;
  }

  it('persists brand-new dropped rows and audits each one as its own INSERT, returning a measurementID per row', async () => {
    const rows = [buildFailureRow({ sourceRowIndex: 1, plotID, censusID }), buildFailureRow({ sourceRowIndex: 2, plotID, censusID, tag: 'T2' })];

    const result = await withTx(transactionID =>
      recordAuditedIngestionFailureRows({ connectionManager, schema, rows, transactionID, changedBy: CHANGED_BY, plotID, censusID })
    );

    expect(result.measurementIDs).toHaveLength(2);
    expect(result.insertedCount).toBe(2);
    expect(result.updatedCount).toBe(0);
    expect(result.unchangedCount).toBe(0);

    for (const sourceRowIndex of [1, 2]) {
      const auditRows = await auditRowsFor(sourceRowIndex);
      expect(auditRows, `row ${sourceRowIndex} must have exactly one audit entry`).toHaveLength(1);
      expect(auditRows[0].Operation).toBe('INSERT');
      expect(auditRows[0].OldRowState).toBeNull();
      expect(auditRows[0].ChangedBy, 'the audit row must record the trusted actor the caller supplied, not an unattributed write').toBe(CHANGED_BY);
      const newState = typeof auditRows[0].NewRowState === 'string' ? JSON.parse(auditRows[0].NewRowState) : auditRows[0].NewRowState;
      expect(newState.SourceRowIndex).toBe(sourceRowIndex);
      expect(newState.StemGUID).toBeNull();
    }
  });

  it('a retry with byte-identical content persists nothing new and audits nothing (no-op)', async () => {
    const rows = [buildFailureRow({ sourceRowIndex: 1, plotID, censusID })];

    await withTx(transactionID =>
      recordAuditedIngestionFailureRows({ connectionManager, schema, rows, transactionID, changedBy: CHANGED_BY, plotID, censusID })
    );
    const retryResult = await withTx(transactionID =>
      recordAuditedIngestionFailureRows({ connectionManager, schema, rows, transactionID, changedBy: CHANGED_BY, plotID, censusID })
    );

    expect(retryResult.insertedCount).toBe(0);
    expect(retryResult.updatedCount).toBe(0);
    expect(retryResult.unchangedCount).toBe(1);

    const auditRows = await auditRowsFor(1);
    expect(auditRows, 'an unchanged retry must not add a second audit entry').toHaveLength(1);
    expect(auditRows[0].Operation).toBe('INSERT');
  });

  it('a retry with changed content updates the row and audits exactly one UPDATE carrying real before/after values', async () => {
    const original = buildFailureRow({ sourceRowIndex: 1, plotID, censusID, failureReason: 'Duplicate measurement row detected' });
    await withTx(transactionID =>
      recordAuditedIngestionFailureRows({ connectionManager, schema, rows: [original], transactionID, changedBy: CHANGED_BY, plotID, censusID })
    );

    const changed = buildFailureRow({ sourceRowIndex: 1, plotID, censusID, dbh: 99.9, failureReason: 'Data validation failed: invalid DBH value' });
    const updateResult = await withTx(transactionID =>
      recordAuditedIngestionFailureRows({ connectionManager, schema, rows: [changed], transactionID, changedBy: CHANGED_BY, plotID, censusID })
    );

    expect(updateResult.insertedCount).toBe(0);
    expect(updateResult.updatedCount).toBe(1);
    expect(updateResult.unchangedCount).toBe(0);

    const auditRows = await auditRowsFor(1);
    expect(auditRows).toHaveLength(2);
    expect(auditRows[1].Operation).toBe('UPDATE');
    const oldState = typeof auditRows[1].OldRowState === 'string' ? JSON.parse(auditRows[1].OldRowState) : auditRows[1].OldRowState;
    const newState = typeof auditRows[1].NewRowState === 'string' ? JSON.parse(auditRows[1].NewRowState) : auditRows[1].NewRowState;
    expect(Number(oldState.MeasuredDBH)).toBeCloseTo(10.5, 1);
    expect(Number(newState.MeasuredDBH)).toBeCloseTo(99.9, 1);
  });

  it('is bounded to its own keys: persisting one chunk of rows never touches or audits a different chunk sharing the same batchID', async () => {
    const otherChunkRow = buildFailureRow({ sourceRowIndex: 100, plotID, censusID, tag: 'OTHER-CHUNK' });
    await withTx(transactionID =>
      recordAuditedIngestionFailureRows({ connectionManager, schema, rows: [otherChunkRow], transactionID, changedBy: CHANGED_BY, plotID, censusID })
    );
    const otherChunkAuditRowsBefore = await auditRowsFor(100);
    expect(otherChunkAuditRowsBefore).toHaveLength(1);

    const thisChunkRow = buildFailureRow({ sourceRowIndex: 1, plotID, censusID });
    await withTx(transactionID =>
      recordAuditedIngestionFailureRows({ connectionManager, schema, rows: [thisChunkRow], transactionID, changedBy: CHANGED_BY, plotID, censusID })
    );

    const otherChunkAuditRowsAfter = await auditRowsFor(100);
    expect(otherChunkAuditRowsAfter, 'a different chunk sharing the same batchID must be left untouched — no new audit entry').toHaveLength(1);
    expect(otherChunkAuditRowsAfter[0].Operation).toBe('INSERT');

    const [otherChunkRowState] = await connection.query<RowDataPacket[]>(`SELECT RawTreeTag FROM coremeasurements WHERE SourceRowIndex = 100`, []);
    expect(otherChunkRowState[0].RawTreeTag, 'the other chunk row itself must be untouched').toBe('OTHER-CHUNK');
  });

  it('propagates a ChangelogWriteError when the audit write itself fails, rather than a data-persistence error', async () => {
    const realExecuteQuery = connectionManager.executeQuery.bind(connectionManager);
    const auditFailureSpy = vi
      .spyOn(connectionManager, 'executeQuery')
      .mockImplementation(async (query: string, params?: unknown[], transactionID?: string) => {
        if (typeof query === 'string' && query.includes('.unifiedchangelog') && query.includes('OldRowState') && query.includes('NewRowState')) {
          throw new Error('Simulated unifiedchangelog write failure');
        }
        return realExecuteQuery(query, params, transactionID);
      });

    try {
      const rows = [buildFailureRow({ sourceRowIndex: 1, plotID, censusID })];
      await expect(
        withTx(transactionID => recordAuditedIngestionFailureRows({ connectionManager, schema, rows, transactionID, changedBy: CHANGED_BY, plotID, censusID }))
      ).rejects.toBeInstanceOf(ChangelogWriteError);

      const [coreRows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM coremeasurements WHERE UploadFileID = ?`, [FILE_NAME]);
      expect(Number(coreRows[0].total), 'the data write must roll back together with its failed audit').toBe(0);
    } finally {
      auditFailureSpy.mockRestore();
    }
  });

  it('rejects a row whose plotID/censusID disagrees with the supplied scope, before any write', async () => {
    const row = buildFailureRow({ sourceRowIndex: 1, plotID, censusID: censusID + 999 });
    await expect(
      withTx(transactionID =>
        recordAuditedIngestionFailureRows({ connectionManager, schema, rows: [row], transactionID, changedBy: CHANGED_BY, plotID, censusID })
      )
    ).rejects.toBeInstanceOf(ChangelogWriteError);

    const [coreRows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM coremeasurements WHERE UploadFileID = ?`, [FILE_NAME]);
    expect(Number(coreRows[0].total), 'a scope-mismatched row must never be persisted').toBe(0);
  });

  it('rejects a (batchID, sourceRowIndex) key that already belongs to a DIFFERENT file, leaving that row byte-identical and unaudited', async () => {
    const sharedBatchID = 'cross-file-collision-batch';
    const foreignFileName = 'other-file.csv';
    const sourceRowIndex = 7;
    await connection.query(
      `INSERT INTO coremeasurements
        (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description,
         UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
       VALUES (?, NULL, FALSE, '2024-01-01', 5, 1, 'Pre-existing foreign row', ?, ?, 'FOREIGN', ?, 1)`,
      [censusID, foreignFileName, sharedBatchID, sourceRowIndex]
    );

    const row = buildFailureRow({ sourceRowIndex, plotID, censusID, batchID: sharedBatchID, tag: 'MINE' });
    await expect(
      withTx(transactionID =>
        recordAuditedIngestionFailureRows({ connectionManager, schema, rows: [row], transactionID, changedBy: CHANGED_BY, plotID, censusID })
      )
    ).rejects.toBeInstanceOf(ChangelogWriteError);

    const [foreignRows] = await connection.query<RowDataPacket[]>(
      `SELECT UploadFileID, RawTreeTag FROM coremeasurements WHERE UploadBatchID = ? AND SourceRowIndex = ?`,
      [sharedBatchID, sourceRowIndex]
    );
    expect(foreignRows, 'the foreign row must still exist, untouched').toHaveLength(1);
    expect(foreignRows[0].UploadFileID, 'the foreign row must not have been overwritten').toBe(foreignFileName);
    expect(foreignRows[0].RawTreeTag, 'the foreign row content must be byte-identical').toBe('FOREIGN');
  });

  it('a duplicate (batchID, sourceRowIndex) within the SAME input array is audited exactly once', async () => {
    const row = buildFailureRow({ sourceRowIndex: 1, plotID, censusID });
    const duplicateRow = buildFailureRow({ sourceRowIndex: 1, plotID, censusID });
    const result = await withTx(transactionID =>
      recordAuditedIngestionFailureRows({
        connectionManager,
        schema,
        rows: [row, duplicateRow],
        transactionID,
        changedBy: CHANGED_BY,
        plotID,
        censusID
      })
    );
    expect(result.insertedCount, 'one physical row, inserted once, must be counted once').toBe(1);

    const auditRows = await auditRowsFor(1);
    expect(auditRows, 'exactly one history row for one physical measurement, not one per repeated input entry').toHaveLength(1);
  });

  it('audits every row exactly once when the keyed snapshot spans more than one chunk (>250 rows)', async () => {
    const ROW_COUNT = 260;
    const rows = Array.from({ length: ROW_COUNT }, (_, index) => buildFailureRow({ sourceRowIndex: index + 1, plotID, censusID, tag: `BULK${index + 1}` }));
    const result = await withTx(transactionID =>
      recordAuditedIngestionFailureRows({ connectionManager, schema, rows, transactionID, changedBy: CHANGED_BY, plotID, censusID })
    );
    expect(result.insertedCount).toBe(ROW_COUNT);
    expect(result.measurementIDs).toHaveLength(ROW_COUNT);

    const [auditCountRows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND Operation = 'INSERT' AND PlotID = ? AND CensusID = ?`,
      [plotID, censusID]
    );
    expect(Number(auditCountRows[0].total)).toBe(ROW_COUNT);
  }, 20000);

  it.each([
    ['commit', (transactionID: string) => connectionManager.commitTransaction(transactionID)],
    ['rollback', (transactionID: string) => connectionManager.rollbackTransaction(transactionID)]
  ])(
    'calling the helper twice within ONE transaction then finalizing via %s releases the batch lock exactly once (no refcount leak)',
    async (_label, finalize) => {
      const transactionID = await connectionManager.beginTransaction();
      await recordAuditedIngestionFailureRows({
        connectionManager,
        schema,
        rows: [buildFailureRow({ sourceRowIndex: 1, plotID, censusID })],
        transactionID,
        changedBy: CHANGED_BY,
        plotID,
        censusID
      });
      await recordAuditedIngestionFailureRows({
        connectionManager,
        schema,
        rows: [buildFailureRow({ sourceRowIndex: 2, plotID, censusID, tag: 'T2' })],
        transactionID,
        changedBy: CHANGED_BY,
        plotID,
        censusID
      });
      await finalize(transactionID);

      const lockName = buildIngestionFailureBatchLockName(schema, BATCH_ID);
      const connB = await mysql.createConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database
      });
      try {
        const [rows] = await connB.query('SELECT GET_LOCK(?, ?) as acquired', [lockName, 5]);
        expect(
          (rows as { acquired: number }[])[0].acquired,
          'a second connection must acquire the lock immediately — two in-TX acquires must not need two releases'
        ).toBe(1);
        await connB.query('SELECT RELEASE_LOCK(?) as released', [lockName]);
      } finally {
        await connB.end();
      }
    },
    20000
  );

  // ---------------------------------------------------------------------------
  // Cross-connection serialization — a genuinely separate physical MySQL
  // session, not an emulation, so GET_LOCK contention between it and the
  // suite's shared connection is real.
  // ---------------------------------------------------------------------------

  it('a second physical connection cannot acquire the SAME batch lock while the first transaction holds it, and can immediately after it commits', async () => {
    const connB = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database
    });
    try {
      const lockName = buildIngestionFailureBatchLockName(schema, 'cross-conn-lock-batch');
      const txA = await connectionManager.beginTransaction();
      const acquiredA = await connectionManager.acquireApplicationLock(lockName, txA, 5000);
      expect(acquiredA).toBe(true);

      const [blockedRows] = await connB.query('SELECT GET_LOCK(?, ?) as acquired', [lockName, 1]);
      expect((blockedRows as { acquired: number }[])[0].acquired, 'a different connection must not acquire the lock while A holds it').toBe(0);

      await connectionManager.commitTransaction(txA);

      const [unblockedRows] = await connB.query('SELECT GET_LOCK(?, ?) as acquired', [lockName, 5]);
      expect((unblockedRows as { acquired: number }[])[0].acquired, 'the lock must be free once A finalizes').toBe(1);
      await connB.query('SELECT RELEASE_LOCK(?) as released', [lockName]);
    } finally {
      await connB.end();
    }
  }, 20000);

  it('two transactions racing to persist an identical first row create exactly one INSERT audit', async () => {
    const txA = await connectionManager.beginTransaction();
    const txB = await connectionManager.beginTransaction();
    try {
      const lockName = buildIngestionFailureBatchLockName(schema, BATCH_ID);
      expect(await connectionManager.acquireApplicationLock(lockName, txA, 1000)).toBe(true);
      const pendingB = recordAuditedIngestionFailureRows({
        connectionManager,
        schema,
        rows: [buildFailureRow({ sourceRowIndex: 1, plotID, censusID })],
        transactionID: txB,
        changedBy: CHANGED_BY,
        plotID,
        censusID
      });
      const resultA = await recordAuditedIngestionFailureRows({
        connectionManager,
        schema,
        rows: [buildFailureRow({ sourceRowIndex: 1, plotID, censusID })],
        transactionID: txA,
        changedBy: CHANGED_BY,
        plotID,
        censusID
      });
      await connectionManager.commitTransaction(txA);
      const resultB = await pendingB;
      await connectionManager.commitTransaction(txB);
      expect(resultA.insertedCount).toBe(1);
      expect(resultB.unchangedCount).toBe(1);
      expect(await auditRowsFor(1)).toHaveLength(1);
    } finally {
      await connectionManager.rollbackTransaction(txA);
      await connectionManager.rollbackTransaction(txB);
    }
  });

  it.each(['commit', 'rollback'] as const)('concurrent acquisition on one transaction releases every lock after %s', async finish => {
    const tx = await connectionManager.beginTransaction();
    const lockName = buildIngestionFailureBatchLockName(schema, BATCH_ID);
    try {
      expect(
        await Promise.all([connectionManager.acquireApplicationLock(lockName, tx, 1000), connectionManager.acquireApplicationLock(lockName, tx, 1000)])
      ).toEqual([true, true]);
      await (finish === 'commit' ? connectionManager.commitTransaction(tx) : connectionManager.rollbackTransaction(tx));
      const [peer] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
      expect(peer[0].acquired).toBe(1);
      await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
    } finally {
      await connectionManager.rollbackTransaction(tx);
    }
  });

  it('rejects an unknown transaction without acquiring a lock', async () => {
    const lockName = buildIngestionFailureBatchLockName(schema, BATCH_ID);
    expect(await connectionManager.acquireApplicationLock(lockName, 'unknown-transaction', 1000)).toBe(false);
    const [rows] = await connection.query<RowDataPacket[]>('SELECT IS_USED_LOCK(?) AS owner', [lockName]);
    expect(rows[0].owner).toBeNull();
  });

  it.each([
    [1, 1],
    [260, 1],
    [1, 2]
  ])('restores %i partial rows after %i failed attempts in the same transaction', async (count, attempts) => {
    const tx = await connectionManager.beginTransaction();
    const rows = Array.from({ length: count }, (_, index) => buildFailureRow({ sourceRowIndex: index + 1, plotID, censusID }));
    const realQuery = connectionManager.executeQuery.bind(connectionManager);
    const sentinel = new Error('late error-link failure');
    let linkWrites = 0;
    let rowsPresentAtFault = 0;
    const faultOnLinkWrite = count > 250 ? 2 : 1;
    const spy = vi.spyOn(connectionManager, 'executeQuery').mockImplementation(async (sql, params, transactionID) => {
      if (/^\s*INSERT INTO .*measurement_error_log/i.test(sql) && ++linkWrites <= faultOnLinkWrite * attempts && linkWrites % faultOnLinkWrite === 0) {
        const current = await realQuery(`SELECT COUNT(*) AS total FROM \`${schema}\`.coremeasurements WHERE UploadBatchID = ?`, [BATCH_ID], transactionID);
        rowsPresentAtFault = Number(current[0].total);
        throw sentinel;
      }
      return realQuery(sql, params, transactionID);
    });
    try {
      const params = { connectionManager, schema, rows, transactionID: tx, changedBy: CHANGED_BY, plotID, censusID };
      for (let attempt = 0; attempt < attempts; attempt++) {
        await expect(recordAuditedIngestionFailureRows(params)).rejects.toBe(sentinel);
        expect(rowsPresentAtFault).toBe(count);
        const restored = await realQuery(`SELECT COUNT(*) AS total FROM \`${schema}\`.coremeasurements WHERE UploadBatchID = ?`, [BATCH_ID], tx);
        expect(Number(restored[0].total)).toBe(0);
      }
      const result = await recordAuditedIngestionFailureRows(params);
      expect(result.insertedCount).toBe(count);
      await connectionManager.commitTransaction(tx);
      const [audit] = await connection.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS total FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND Operation = 'INSERT'"
      );
      expect(Number(audit[0].total)).toBe(count);
      const [links] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM measurement_error_log');
      expect(Number(links[0].total)).toBeGreaterThanOrEqual(count);
    } finally {
      spy.mockRestore();
      await connectionManager.rollbackTransaction(tx);
    }
  });
});
