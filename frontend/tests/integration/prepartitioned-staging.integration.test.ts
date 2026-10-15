/**
 * Pre-partitioned staging primitives — Integration Tests
 *
 * Exercises the family-aware primitives in lib/ingestion/temporary-measurements.ts
 * against a real local MySQL instance: per-row BatchIDs on insert, stale-batch
 * cleanup that spares every member of the incoming batch family, and the
 * family-wide "already staged" probe.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/prepartitioned-staging.integration.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';
import { SourceFormat } from '@/config/macros/formdetails';

// ---------------------------------------------------------------------------
// Safety guard — setupTestDatabase DROPs/CREATEs its schema; never run remote.
// ---------------------------------------------------------------------------

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';

if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(
    `[prepartitioned-staging] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops and recreates its test schema and must only run against a local test database.`
  );
}

// ---------------------------------------------------------------------------
// Shared state bridge — hoisted so the ConnectionManager mock closure can read
// the live test connection after beforeAll wires it up.
// ---------------------------------------------------------------------------

const TRANSACTION_ID_PREFIX = 'prepartitioned-staging-tx-';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      const [rows] = await sharedState.connection.query(query, (params as unknown[]) ?? []);
      return rows;
    },
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (sharedState.activeTransactionID) throw new Error('ConnectionManager mock: transaction already active');
      await sharedState.connection.beginTransaction();
      sharedState.transactionCounter += 1;
      const id = `${TRANSACTION_ID_PREFIX}${sharedState.transactionCounter}`;
      sharedState.activeTransactionID = id;
      return id;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: commit transactionID mismatch');
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: rollback transactionID mismatch');
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({
  default: {
    info: (msg: string) => console.log(`[ailogger.info] ${msg}`),
    warn: (msg: string) => console.log(`[ailogger.warn] ${msg}`),
    error: (msg: string) => console.log(`[ailogger.error] ${msg}`)
  }
}));

import ConnectionManager from '@/lib/db/connectionmanager';
import {
  cleanupStaleMeasurementBatchesForFile,
  familyHasStagedRows,
  findDroppedMeasurementCandidates,
  insertTemporaryMeasurementsInBatches,
  StagingBatchIDCountMismatchError
} from '@/lib/ingestion/temporary-measurements';

const INCOMING_FAMILY = 'fam';
const INCOMING_FAMILY_PREFIX_ONLY = 'fa';
const OTHER_FAMILY = 'other';
const VALID_DATE = '2024-03-15';
// A sibling whose `__` separator is replaced by other characters. An unescaped
// LIKE pattern treats `_` as a single-character wildcard and would spare it.
const UNESCAPED_UNDERSCORE_LOOKALIKE = `${INCOMING_FAMILY}XYsub001`;
// Above the ~11k rows a fixed-width MEMORY table holds under the default 16 MiB max_heap_table_size.
const LARGE_CANDIDATE_ROW_COUNT = 15000;
const LARGE_AUDIT_TIMEOUT_MS = 120000;

describe('pre-partitioned staging primitives — integration', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
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
    sharedState.connection = connection;
    console.log(`[setup] schema=${schema} plotID=${plotID} censusID=${censusID}`);
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    if (sharedState.activeTransactionID) {
      await connection.rollback();
      sharedState.activeTransactionID = null;
    }
    await connection.query('DELETE FROM temporarymeasurements');
    console.log('[beforeEach] cleared temporarymeasurements');
  });

  async function stageRawRow(fileID: string, batchID: string, treeTag: string): Promise<void> {
    await connection.query(
      `INSERT INTO temporarymeasurements (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, DBH, HOM, MeasurementDate)
       VALUES (?, ?, ?, ?, ?, '1', ?, ?, 10, 1.3, ?)`,
      [fileID, batchID, plotID, censusID, treeTag, testData.species[0].SpeciesCode, testData.quadrats[0].QuadratName, VALID_DATE]
    );
  }

  async function stagedBatchIDs(fileID: string): Promise<string[]> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT DISTINCT BatchID FROM temporarymeasurements WHERE FileID = ? ORDER BY BatchID', [fileID]);
    return rows.map(row => String(row.BatchID));
  }

  function measurementRow(treeTag: string) {
    return {
      tag: treeTag,
      stemtag: '1',
      spcode: testData.species[0].SpeciesCode,
      quadrat: testData.quadrats[0].QuadratName,
      dbh: '10',
      hom: '1.3',
      date: VALID_DATE
    };
  }

  it('stale-batch cleanup keeps every member of the incoming family and removes other families (spec test 4)', async () => {
    const FILE = 'prepart_cleanup.csv';
    for (const batchID of [
      INCOMING_FAMILY,
      `${INCOMING_FAMILY}__sub001`,
      `${INCOMING_FAMILY}__sub002`,
      UNESCAPED_UNDERSCORE_LOOKALIKE,
      OTHER_FAMILY,
      `${OTHER_FAMILY}__sub001`
    ]) {
      await stageRawRow(FILE, batchID, `T-${batchID}`);
    }
    console.log('[cleanup] before:', await stagedBatchIDs(FILE));

    const transactionID = await connectionManager.beginTransaction();
    const deleted = await cleanupStaleMeasurementBatchesForFile(connectionManager, schema, FILE, INCOMING_FAMILY, plotID, censusID, transactionID);
    await connectionManager.commitTransaction(transactionID);

    const after = await stagedBatchIDs(FILE);
    console.log(`[cleanup] deleted=${deleted} after:`, after);
    expect(after).toEqual([INCOMING_FAMILY, `${INCOMING_FAMILY}__sub001`, `${INCOMING_FAMILY}__sub002`]);
    expect(after, `${UNESCAPED_UNDERSCORE_LOOKALIKE} is not in the family and must be deleted`).not.toContain(UNESCAPED_UNDERSCORE_LOOKALIKE);
    expect(deleted).toBe(3);
  });

  it('treats a family holding only a later sub-batch as already staged', async () => {
    const FILE = 'prepart_exists.csv';
    await stageRawRow(FILE, `${INCOMING_FAMILY}__sub003`, 'T1');
    console.log('[exists] staged:', await stagedBatchIDs(FILE));

    const transactionID = await connectionManager.beginTransaction();
    let incomingFamilyStaged: boolean;
    let prefixFamilyStaged: boolean;
    try {
      incomingFamilyStaged = await familyHasStagedRows(connectionManager, schema, FILE, INCOMING_FAMILY, transactionID);
      prefixFamilyStaged = await familyHasStagedRows(connectionManager, schema, FILE, INCOMING_FAMILY_PREFIX_ONLY, transactionID);
    } finally {
      await connectionManager.rollbackTransaction(transactionID);
    }
    console.log(`[exists] ${INCOMING_FAMILY}=${incomingFamilyStaged} ${INCOMING_FAMILY_PREFIX_ONLY}=${prefixFamilyStaged}`);
    expect(incomingFamilyStaged).toBe(true);
    expect(prefixFamilyStaged).toBe(false);
  });

  it('insertTemporaryMeasurementsInBatches writes each row under its own BatchID and returns the inserted count', async () => {
    const FILE = 'prepart_insert.csv';
    const rows = ['T1', 'T2', 'T3'].map(measurementRow);
    const rowBatchIDs = [`${INCOMING_FAMILY}__sub001`, `${INCOMING_FAMILY}__sub001`, `${INCOMING_FAMILY}__sub002`];

    const transactionID = await connectionManager.beginTransaction();
    const inserted = await insertTemporaryMeasurementsInBatches(
      connectionManager,
      schema,
      rows,
      FILE,
      rowBatchIDs,
      null,
      SourceFormat.csv,
      plotID,
      censusID,
      transactionID
    );
    await connectionManager.commitTransaction(transactionID);

    const [staged] = await connection.query<RowDataPacket[]>('SELECT TreeTag, BatchID FROM temporarymeasurements WHERE FileID = ? ORDER BY id', [FILE]);
    console.log(`[insert] inserted=${inserted} staged:`, staged);
    expect(inserted).toBe(3);
    expect(staged.map(row => [row.TreeTag, row.BatchID])).toEqual([
      ['T1', `${INCOMING_FAMILY}__sub001`],
      ['T2', `${INCOMING_FAMILY}__sub001`],
      ['T3', `${INCOMING_FAMILY}__sub002`]
    ]);
  });

  it('rejects a BatchID list that does not match the rows', async () => {
    const transactionID = await connectionManager.beginTransaction();
    try {
      await expect(
        insertTemporaryMeasurementsInBatches(
          connectionManager,
          schema,
          [measurementRow('T1')],
          'x.csv',
          [],
          null,
          SourceFormat.csv,
          plotID,
          censusID,
          transactionID
        )
      ).rejects.toThrow(/1 row\(s\) but 0 BatchID/);
      await expect(
        insertTemporaryMeasurementsInBatches(
          connectionManager,
          schema,
          [measurementRow('T1')],
          'x.csv',
          [],
          null,
          SourceFormat.csv,
          plotID,
          censusID,
          transactionID
        )
      ).rejects.toBeInstanceOf(StagingBatchIDCountMismatchError);
    } finally {
      await connectionManager.rollbackTransaction(transactionID);
    }
  });

  it('matches each dropped-row candidate against its own BatchID, not the first row of the chunk', async () => {
    const FILE = 'prepart_dropped.csv';
    const rows = ['T1', 'T2'].map(measurementRow);
    const rowBatchIDs = [`${INCOMING_FAMILY}__sub001`, `${INCOMING_FAMILY}__sub002`];
    await stageRawRow(FILE, `${INCOMING_FAMILY}__sub001`, 'T1');
    await stageRawRow(FILE, `${INCOMING_FAMILY}__sub002`, 'T2');
    console.log('[dropped] staged:', await stagedBatchIDs(FILE));

    const transactionID = await connectionManager.beginTransaction();
    try {
      const candidatesWithOwnBatchIDs = await findDroppedMeasurementCandidates(
        connectionManager,
        schema,
        FILE,
        rowBatchIDs,
        plotID,
        censusID,
        rows,
        transactionID
      );
      const candidatesWithSwappedBatchIDs = await findDroppedMeasurementCandidates(
        connectionManager,
        schema,
        FILE,
        [...rowBatchIDs].reverse(),
        plotID,
        censusID,
        rows,
        transactionID
      );
      console.log('[dropped] own BatchIDs:', candidatesWithOwnBatchIDs, 'swapped BatchIDs:', candidatesWithSwappedBatchIDs);
      expect(candidatesWithOwnBatchIDs).toEqual([]);
      expect(candidatesWithSwappedBatchIDs.map(candidate => Number(candidate.rowOrdinal))).toEqual([1, 2]);
    } finally {
      await connectionManager.rollbackTransaction(transactionID);
    }
  });

  it(
    'audits a whole-file chunk larger than an in-memory temporary table can hold',
    async () => {
      const FILE = 'prepart_large_audit.csv';
      const rows = Array.from({ length: LARGE_CANDIDATE_ROW_COUNT }, (_, index) => measurementRow(`L${index + 1}`));
      const rowBatchIDs = rows.map(() => `${INCOMING_FAMILY}__sub001`);
      const [[heapLimit]] = await connection.query<RowDataPacket[]>('SELECT @@session.max_heap_table_size AS maxHeapTableSize');
      console.log(`[large audit] rows=${rows.length} max_heap_table_size=${heapLimit.maxHeapTableSize}`);

      const transactionID = await connectionManager.beginTransaction();
      try {
        const startedAt = Date.now();
        const candidates = await findDroppedMeasurementCandidates(connectionManager, schema, FILE, rowBatchIDs, plotID, censusID, rows, transactionID);
        console.log(`[large audit] candidates=${candidates.length} durationMs=${Date.now() - startedAt}`);
        expect(candidates).toHaveLength(LARGE_CANDIDATE_ROW_COUNT);
        expect(Number(candidates[0].rowOrdinal)).toBe(1);
        expect(Number(candidates[LARGE_CANDIDATE_ROW_COUNT - 1].rowOrdinal)).toBe(LARGE_CANDIDATE_ROW_COUNT);
      } finally {
        await connectionManager.rollbackTransaction(transactionID);
      }
    },
    LARGE_AUDIT_TIMEOUT_MS
  );
});
