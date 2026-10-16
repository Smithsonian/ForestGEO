/**
 * Pre-partitioned staging primitives — Integration Tests
 *
 * Exercises the family-aware primitives in lib/ingestion/temporary-measurements.ts
 * against a real local MySQL instance: per-row BatchIDs on insert, stale-batch
 * cleanup that spares every member of the incoming batch family, and the
 * family-wide "already staged" probe. Then drives stageMeasurementChunk with a
 * firstRowOrdinal and checks that every row lands in its final sub-batch.
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
import { UploadMode } from '@/config/uploadmodes';

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
  transactionCounter: 0,
  /** GET_LOCK names taken inside the active transaction; released when it ends, as ConnectionManager does. */
  heldLockNames: [] as string[]
}));

async function releaseHeldLocks(): Promise<void> {
  for (const lockName of sharedState.heldLockNames.splice(0)) {
    await sharedState.connection!.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
  }
}

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
      await releaseHeldLocks();
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: rollback transactionID mismatch');
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
      await releaseHeldLocks();
    },
    // Real MySQL GET_LOCK (#507): staging serializes the file-upload summary per (schema, RecordID, CensusID) with it.
    acquireApplicationLock: async (lockName: string, transactionID: string, timeoutMs: number) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: lock transactionID mismatch');
      if (sharedState.heldLockNames.includes(lockName)) return true;
      const [rows] = await sharedState.connection.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, Math.ceil(timeoutMs / 1000)]);
      const acquired = (rows as { acquired: number }[])[0]?.acquired === 1;
      if (acquired) sharedState.heldLockNames.push(lockName);
      return acquired;
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
import * as temporaryMeasurements from '@/lib/ingestion/temporary-measurements';
import {
  cleanupStaleMeasurementBatchesForFile,
  familyHasStagedRows,
  findDroppedMeasurementCandidates,
  insertTemporaryMeasurementsInBatches,
  StagingBatchIDCountMismatchError,
  TEMPORARY_MEASUREMENT_INSERT_COLUMNS
} from '@/lib/ingestion/temporary-measurements';
import { countStagedRows, stageMeasurementChunk, type StageMeasurementChunkParams } from '@/lib/uploads/stage-measurements';
import { buildSubBatchID, MAX_ORIGINAL_BATCH_ID_LENGTH, OriginalBatchIDTooLongError } from '@/lib/uploads/batch-family';
import type { FileRow } from '@/config/macros/formdetails';

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
const SUB_BATCH_ROWS = 10_000;
const STAGING_CSV_HEADERS = ['tag', 'stemtag', 'spcode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'];
const CSV_DELIMITER = ',';
const ALIGNMENT_ROW_COUNT = 25_003;
const ALIGNMENT_CHUNK_SIZES = [5_000, 7_000];
const STAGING_CHUNK_ROWS = 5_000;
const STAGING_TIMEOUT_MS = 180000;
const TAG_PREFIX = 'P';
const TAG_ORDINAL_WIDTH = 7;
const ABANDONED_FAMILY = 'abandoned';
const BOUNDARY_STRADDLING_CHUNK_ROWS = 7_000;
const PRE_KEYED_RAW_ROW_COUNT = 21_000;
const PRE_KEYED_CHUNK_SIZES = [7_000, 10_000];
const CLIENT_DROP_EVERY = 7;
const CLIENT_DROP_REMAINDER = 3;

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
    await connection.query('DELETE FROM unifiedchangelog');
    await connection.query('DELETE FROM coremeasurements');
    console.log('[beforeEach] cleared temporarymeasurements + unifiedchangelog + coremeasurements');
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
  function tagForOrdinal(ordinal: number): string {
    return `${TAG_PREFIX}${String(ordinal).padStart(TAG_ORDINAL_WIDTH, '0')}`;
  }

  function ordinalOfTag(tag: string): number {
    return Number(tag.slice(TAG_PREFIX.length));
  }

  function buildRawRows(count: number, invalidOrdinals: ReadonlySet<number> = new Set()): Record<string, string>[] {
    return Array.from({ length: count }, (_, ordinal) => ({
      tag: invalidOrdinals.has(ordinal) ? '' : tagForOrdinal(ordinal),
      stemtag: '1',
      spcode: testData.species[0].SpeciesCode,
      quadrat: testData.quadrats[0].QuadratName,
      lx: '1',
      ly: '1',
      dbh: '10',
      hom: '1.3',
      date: VALID_DATE,
      codes: ''
    }));
  }

  function chunkParams(
    fileName: string,
    batchID: string,
    rawRows: Record<string, string>[],
    chunkRows: number,
    chunkIndex: number,
    transactionID: string
  ): StageMeasurementChunkParams {
    return {
      schema,
      fileName,
      batchID,
      plotID,
      censusID,
      uploadMode: UploadMode.CLEAN_REUPLOAD,
      suppressCensusReplacementCleanup: true,
      sourceFormat: SourceFormat.csv,
      rawRows: rawRows.slice(chunkIndex * chunkRows, (chunkIndex + 1) * chunkRows),
      csvHeaders: STAGING_CSV_HEADERS,
      delimiter: CSV_DELIMITER,
      uploadSessionID: null,
      transactionID,
      firstRowOrdinal: chunkIndex * chunkRows
    };
  }

  async function stageFileInChunks(fileName: string, batchID: string, rawRows: Record<string, string>[], chunkRows: number, chunkOrder?: number[]) {
    const chunkCount = Math.ceil(rawRows.length / chunkRows);
    const order = chunkOrder ?? Array.from({ length: chunkCount }, (_, index) => index);
    const results = [];
    for (const chunkIndex of order) {
      const transactionID = await connectionManager.beginTransaction();
      try {
        results.push(await stageMeasurementChunk(connectionManager, chunkParams(fileName, batchID, rawRows, chunkRows, chunkIndex, transactionID)));
        await connectionManager.commitTransaction(transactionID);
      } catch (error) {
        await connectionManager.rollbackTransaction(transactionID);
        throw error;
      }
    }
    return results;
  }

  async function membership(fileName: string): Promise<Array<[string, string]>> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT TreeTag, BatchID FROM temporarymeasurements WHERE FileID = ? ORDER BY TreeTag', [fileName]);
    return rows.map(row => [String(row.TreeTag), String(row.BatchID)]);
  }

  async function perMemberCounts(fileName: string): Promise<Array<[string, number]>> {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT BatchID, COUNT(*) AS rowCount FROM temporarymeasurements WHERE FileID = ? GROUP BY BatchID ORDER BY BatchID',
      [fileName]
    );
    return rows.map(row => [String(row.BatchID), Number(row.rowCount)]);
  }

  function expectedBatchFor(batchID: string, ordinal: number): string {
    return buildSubBatchID(batchID, Math.floor(ordinal / SUB_BATCH_ROWS) + 1);
  }

  /**
   * Stages pre-keyed chunks the way a legacy fileRowSet client sends them: the
   * client already dropped some rows, so each chunk is shorter than its raw
   * span, while firstRowOrdinal is still the chunk's RAW offset in the file.
   * Returns the membership the staging contract promises for that input.
   */
  async function stagePreKeyedFileInChunks(
    fileName: string,
    batchID: string,
    rawRows: FileRow[],
    chunkRows: number,
    isDroppedClientSide: (ordinal: number) => boolean
  ): Promise<{ expected: Array<[string, string]>; sentPerChunk: number[] }> {
    const expected: Array<[string, string]> = [];
    const sentPerChunk: number[] = [];
    for (let firstRowOrdinal = 0; firstRowOrdinal < rawRows.length; firstRowOrdinal += chunkRows) {
      const preKeyedRows = rawRows.slice(firstRowOrdinal, firstRowOrdinal + chunkRows).filter((_, offset) => !isDroppedClientSide(firstRowOrdinal + offset));
      preKeyedRows.forEach((row, position) => expected.push([String(row.tag), expectedBatchFor(batchID, firstRowOrdinal + position)]));
      sentPerChunk.push(preKeyedRows.length);
      const transactionID = await connectionManager.beginTransaction();
      try {
        await stageMeasurementChunk(connectionManager, {
          schema,
          fileName,
          batchID,
          plotID,
          censusID,
          uploadMode: UploadMode.REVISIONS,
          sourceFormat: SourceFormat.csv,
          rawRows: [],
          csvHeaders: [],
          delimiter: CSV_DELIMITER,
          preKeyedRows,
          uploadSessionID: null,
          transactionID,
          firstRowOrdinal
        });
        await connectionManager.commitTransaction(transactionID);
      } catch (error) {
        await connectionManager.rollbackTransaction(transactionID);
        throw error;
      }
    }
    expected.sort(([left], [right]) => left.localeCompare(right));
    return { expected, sentPerChunk };
  }

  it.each(ALIGNMENT_CHUNK_SIZES)(
    'assigns ordinal-derived sub-batches with %i-row chunks (spec test 1)',
    async chunkRows => {
      const FILE = `prepart_align_${chunkRows}.csv`;
      const BATCH = `align${chunkRows}`;
      const startedAt = Date.now();
      const results = await stageFileInChunks(FILE, BATCH, buildRawRows(ALIGNMENT_ROW_COUNT), chunkRows);
      const actual = await membership(FILE);
      const mismatches = actual.filter(([tag, batch]) => batch !== expectedBatchFor(BATCH, ordinalOfTag(tag)));
      console.log(
        `[align ${chunkRows}] chunks=${results.length} inserted=${results.map(result => result.insertedCount).join(',')} ` +
          `staged=${actual.length} mismatches=${mismatches.length} durationMs=${Date.now() - startedAt} sample=`,
        mismatches.slice(0, 5)
      );
      console.log(`[align ${chunkRows}] per-member counts:`, await perMemberCounts(FILE));
      expect(actual).toHaveLength(ALIGNMENT_ROW_COUNT);
      expect(mismatches).toEqual([]);
      expect(await perMemberCounts(FILE)).toEqual([
        [`${BATCH}__sub001`, SUB_BATCH_ROWS],
        [`${BATCH}__sub002`, SUB_BATCH_ROWS],
        [`${BATCH}__sub003`, ALIGNMENT_ROW_COUNT - 2 * SUB_BATCH_ROWS]
      ]);
    },
    STAGING_TIMEOUT_MS
  );

  it(
    'a rejected row shortens its own sub-batch without shifting later ordinals (spec test 2)',
    async () => {
      const FILE = 'prepart_reject.csv';
      const BATCH = 'reject';
      const MID_CHUNK_REJECT = 7_000;
      const REJECTED = new Set([MID_CHUNK_REJECT, 9_998, 9_999]);
      const results = await stageFileInChunks(FILE, BATCH, buildRawRows(2 * SUB_BATCH_ROWS, REJECTED), STAGING_CHUNK_ROWS);
      const counts = await perMemberCounts(FILE);
      console.log(
        '[reject] invalid per chunk:',
        results.map(result => result.invalidRows.length),
        'per-member counts:',
        counts
      );
      expect(results.map(result => result.invalidRows.length)).toEqual([0, REJECTED.size, 0, 0]);
      expect(counts).toEqual([
        [`${BATCH}__sub001`, SUB_BATCH_ROWS - REJECTED.size],
        [`${BATCH}__sub002`, SUB_BATCH_ROWS]
      ]);
      const staged = new Map(await membership(FILE));
      const afterMidChunkReject = staged.get(tagForOrdinal(MID_CHUNK_REJECT + 1));
      const lastOfFirst = staged.get(tagForOrdinal(9_997));
      const firstOfSecond = staged.get(tagForOrdinal(SUB_BATCH_ROWS));
      console.log(
        `[reject] ${tagForOrdinal(MID_CHUNK_REJECT + 1)}=${afterMidChunkReject} ${tagForOrdinal(9_997)}=${lastOfFirst} ` +
          `${tagForOrdinal(SUB_BATCH_ROWS)}=${firstOfSecond} rejected staged=${[...REJECTED].filter(ordinal => staged.has(tagForOrdinal(ordinal)))}`
      );
      expect(afterMidChunkReject).toBe(`${BATCH}__sub001`);
      expect(lastOfFirst).toBe(`${BATCH}__sub001`);
      expect(firstOfSecond).toBe(`${BATCH}__sub002`);
    },
    STAGING_TIMEOUT_MS
  );

  it(
    'a rejected row mid-chunk in a chunk that straddles a sub-batch boundary does not pull later rows back (spec test 2)',
    async () => {
      const FILE = 'prepart_reject_straddle.csv';
      const BATCH = 'straddle';
      const MID_CHUNK_REJECT = 9_000;
      const results = await stageFileInChunks(FILE, BATCH, buildRawRows(2 * SUB_BATCH_ROWS, new Set([MID_CHUNK_REJECT])), BOUNDARY_STRADDLING_CHUNK_ROWS);
      const counts = await perMemberCounts(FILE);
      const staged = new Map(await membership(FILE));
      console.log(
        '[straddle] invalid per chunk:',
        results.map(result => result.invalidRows.length),
        'per-member counts:',
        counts,
        `${tagForOrdinal(SUB_BATCH_ROWS - 1)}=${staged.get(tagForOrdinal(SUB_BATCH_ROWS - 1))} ${tagForOrdinal(SUB_BATCH_ROWS)}=${staged.get(tagForOrdinal(SUB_BATCH_ROWS))}`
      );
      expect(counts).toEqual([
        [`${BATCH}__sub001`, SUB_BATCH_ROWS - 1],
        [`${BATCH}__sub002`, SUB_BATCH_ROWS]
      ]);
      expect(staged.get(tagForOrdinal(SUB_BATCH_ROWS - 1))).toBe(`${BATCH}__sub001`);
      expect(staged.get(tagForOrdinal(SUB_BATCH_ROWS))).toBe(`${BATCH}__sub002`);
    },
    STAGING_TIMEOUT_MS
  );

  it.each(PRE_KEYED_CHUNK_SIZES)(
    'pre-keyed chunks of %i raw rows with client-side drops stay within the sub-batch size and re-stage identically',
    async chunkRows => {
      const FILE = `prepart_prekeyed_${chunkRows}.csv`;
      const BATCH = `prekeyed${chunkRows}`;
      const rawRows: FileRow[] = buildRawRows(PRE_KEYED_RAW_ROW_COUNT);
      const isDroppedClientSide = (ordinal: number) => ordinal % CLIENT_DROP_EVERY === CLIENT_DROP_REMAINDER;

      const { expected, sentPerChunk } = await stagePreKeyedFileInChunks(FILE, BATCH, rawRows, chunkRows, isDroppedClientSide);
      const first = await membership(FILE);
      const counts = await perMemberCounts(FILE);
      const mismatches = first.filter(([tag, batch], index) => expected[index]?.[0] !== tag || expected[index]?.[1] !== batch);
      console.log(
        `[prekeyed ${chunkRows}] sent per chunk=${sentPerChunk.join(',')} staged=${first.length} mismatches=${mismatches.length} member counts:`,
        counts
      );
      expect(first).toHaveLength(expected.length);
      expect(mismatches).toEqual([]);
      expect(counts.filter(([, rowCount]) => rowCount > SUB_BATCH_ROWS)).toEqual([]);

      await connection.query('DELETE FROM temporarymeasurements WHERE FileID = ?', [FILE]);
      await stagePreKeyedFileInChunks(FILE, BATCH, rawRows, chunkRows, isDroppedClientSide);
      const second = await membership(FILE);
      console.log(`[prekeyed ${chunkRows}] re-staged=${second.length} member counts:`, await perMemberCounts(FILE));
      expect(second).toEqual(first);
    },
    STAGING_TIMEOUT_MS
  );

  it('rejects an over-long batch ID before any statement even when every row of the chunk is rejected', async () => {
    const FILE = 'prepart_too_long.csv';
    const OVER_LONG_BATCH = 'b'.repeat(MAX_ORIGINAL_BATCH_ID_LENGTH + 1);
    const allRejected = buildRawRows(3, new Set([0, 1, 2]));
    const executeQuerySpy = vi.spyOn(connectionManager, 'executeQuery');
    const transactionID = await connectionManager.beginTransaction();
    let thrown: unknown;
    try {
      await stageMeasurementChunk(connectionManager, chunkParams(FILE, OVER_LONG_BATCH, allRejected, allRejected.length, 0, transactionID));
    } catch (error) {
      thrown = error;
    } finally {
      await connectionManager.rollbackTransaction(transactionID);
    }
    const statementsIssued = executeQuerySpy.mock.calls.map(([sql]) => String(sql));
    executeQuerySpy.mockRestore();
    const [stagedRows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS rowCount FROM temporarymeasurements WHERE FileID = ?', [FILE]);
    console.log(
      `[too-long] batchID length=${OVER_LONG_BATCH.length} threw=${thrown instanceof Error ? thrown.name : thrown} ` +
        `statements=${statementsIssued.length} staged=${stagedRows[0].rowCount}`
    );
    expect(thrown).toBeInstanceOf(OriginalBatchIDTooLongError);
    expect(statementsIssued).toEqual([]);
    expect(Number(stagedRows[0].rowCount)).toBe(0);
  });

  it(
    're-staging after a rollback reproduces identical membership (spec test 3)',
    async () => {
      const FILE = 'prepart_retry.csv';
      const BATCH = 'retry';
      const RETRY_ROW_COUNT = 12_000;
      const rawRows = buildRawRows(RETRY_ROW_COUNT);
      await stageFileInChunks(FILE, BATCH, rawRows, STAGING_CHUNK_ROWS);
      const first = await membership(FILE);
      await connection.query('DELETE FROM temporarymeasurements WHERE FileID = ?', [FILE]);
      await stageFileInChunks(FILE, BATCH, rawRows, STAGING_CHUNK_ROWS);
      const second = await membership(FILE);
      console.log(`[retry] first=${first.length} second=${second.length} members=`, await perMemberCounts(FILE));
      expect(first).toHaveLength(RETRY_ROW_COUNT);
      expect(second).toEqual(first);
    },
    STAGING_TIMEOUT_MS
  );

  it(
    'chunks staged out of order and retried keep every row and clean other families exactly once (spec test 5)',
    async () => {
      const FILE = 'prepart_order.csv';
      const BATCH = 'order';
      const ORDER_ROW_COUNT = 15_000;
      await connection.query(
        `INSERT INTO temporarymeasurements (FileID, BatchID, PlotID, CensusID, TreeTag) VALUES (?, ?, ?, ?, 'OLD1'), (?, ?, ?, ?, 'OLD2')`,
        [FILE, ABANDONED_FAMILY, plotID, censusID, FILE, `${ABANDONED_FAMILY}__sub001`, plotID, censusID]
      );
      const rawRows = buildRawRows(ORDER_ROW_COUNT);
      const cleanupSpy = vi.spyOn(temporaryMeasurements, 'cleanupStaleMeasurementBatchesForFile');

      try {
        await stageFileInChunks(FILE, BATCH, rawRows, STAGING_CHUNK_ROWS, [1]);
        console.log(`[order] after chunk 1: members=`, await perMemberCounts(FILE), `cleanupCalls=${cleanupSpy.mock.calls.length}`);

        const retryTransactionID = await connectionManager.beginTransaction();
        try {
          await stageMeasurementChunk(connectionManager, chunkParams(FILE, BATCH, rawRows, STAGING_CHUNK_ROWS, 0, retryTransactionID));
        } finally {
          await connectionManager.rollbackTransaction(retryTransactionID);
        }
        console.log(`[order] after rolled-back chunk 0: members=`, await perMemberCounts(FILE), `cleanupCalls=${cleanupSpy.mock.calls.length}`);

        await stageFileInChunks(FILE, BATCH, rawRows, STAGING_CHUNK_ROWS, [0, 2]);

        const staged = await membership(FILE);
        const missingOrdinals = Array.from({ length: ORDER_ROW_COUNT }, (_, ordinal) => ordinal).filter(
          ordinal => !staged.some(([tag]) => tag === tagForOrdinal(ordinal))
        );
        const members = await perMemberCounts(FILE);
        console.log(`[order] staged=${staged.length} cleanupCalls=${cleanupSpy.mock.calls.length} missing=${missingOrdinals.length} members=`, members);
        expect(
          staged.some(([tag]) => tag.startsWith('OLD')),
          'the abandoned family must be removed by the first chunk to land'
        ).toBe(false);
        expect(missingOrdinals).toEqual([]);
        expect(staged).toHaveLength(ORDER_ROW_COUNT);
        expect(members).toEqual([
          [`${BATCH}__sub001`, SUB_BATCH_ROWS],
          [`${BATCH}__sub002`, ORDER_ROW_COUNT - SUB_BATCH_ROWS]
        ]);
        expect(cleanupSpy, 'only the first chunk to land sees an empty family').toHaveBeenCalledTimes(1);
      } finally {
        cleanupSpy.mockRestore();
      }
    },
    STAGING_TIMEOUT_MS
  );

  // temporarymeasurements has no unique key (D1), so INSERT IGNORE never drops a
  // real duplicate. Stripping one VALUES tuple from the bulk INSERT reproduces
  // the effect a collision would have; every later step runs against MySQL.
  it('detects a silently dropped row from the inserted count without counting staged rows (spec test 6)', async () => {
    const FILE = 'prepart_drop.csv';
    const BATCH = 'drop';
    const KEPT_TAG = tagForOrdinal(0);
    const DROPPED_TAG = tagForOrdinal(1);
    const rawRows = buildRawRows(2);
    const columnCount = TEMPORARY_MEASUREMENT_INSERT_COLUMNS.length;
    const treeTagColumnIndex = TEMPORARY_MEASUREMENT_INSERT_COLUMNS.indexOf('TreeTag');

    const originalExecuteQuery = connectionManager.executeQuery.bind(connectionManager);
    const executeQuerySpy = vi
      .spyOn(connectionManager, 'executeQuery')
      .mockImplementation(async (query: string, params?: unknown[], transactionID?: string) => {
        if (typeof query === 'string' && query.includes('INSERT IGNORE INTO') && query.includes('.temporarymeasurements') && Array.isArray(params)) {
          const rowCount = params.length / columnCount;
          const dropRowIndex = Array.from({ length: rowCount }, (_, index) => index).find(
            index => params[index * columnCount + treeTagColumnIndex] === DROPPED_TAG
          );
          if (dropRowIndex !== undefined) {
            const [beforeValues, afterValues] = query.split(' VALUES ');
            const tuples = afterValues.match(/\([^()]*\)/g) ?? [];
            tuples.splice(dropRowIndex, 1);
            const strippedParams = [...params.slice(0, dropRowIndex * columnCount), ...params.slice((dropRowIndex + 1) * columnCount)];
            return originalExecuteQuery(`${beforeValues} VALUES ${tuples.join(', ')}`, strippedParams, transactionID);
          }
        }
        return originalExecuteQuery(query, params, transactionID);
      });

    try {
      const transactionID = await connectionManager.beginTransaction();
      const result = await stageMeasurementChunk(connectionManager, chunkParams(FILE, BATCH, rawRows, rawRows.length, 0, transactionID));
      await connectionManager.commitTransaction(transactionID);

      const temporaryCountStatements = executeQuerySpy.mock.calls
        .map(([sql]) => String(sql))
        .filter(sql => /SELECT COUNT\(\*\)[\s\S]*temporarymeasurements/i.test(sql));
      console.log(`[drop] insertedCount=${result.insertedCount} expectedCount=${result.expectedCount} droppedCount=${result.droppedCount}`);
      console.log('[no-count] COUNT statements against temporarymeasurements:', temporaryCountStatements);
      expect(result.expectedCount).toBe(2);
      expect(result.insertedCount).toBe(1);
      expect(result.droppedCount, 'the interception must have forced exactly one row to be dropped').toBe(1);
      expect(temporaryCountStatements).toEqual([]);

      const [failedRows] = await connection.query<RowDataPacket[]>('SELECT RawTreeTag FROM coremeasurements WHERE StemGUID IS NULL AND RawTreeTag = ?', [
        DROPPED_TAG
      ]);
      const staged = await membership(FILE);
      console.log('[drop] failure rows:', failedRows, 'staged:', staged);
      expect(failedRows, 'the dropped row must be recorded as an unresolved ingestion error').toHaveLength(1);
      expect(staged).toEqual([[KEPT_TAG, `${BATCH}__sub001`]]);
    } finally {
      executeQuerySpy.mockRestore();
    }
  });

  it('countStagedRows counts every member of the family and nothing outside it', async () => {
    const FILE = 'prepart_count.csv';
    for (const [batchID, tag] of [
      [INCOMING_FAMILY, 'C1'],
      [`${INCOMING_FAMILY}__sub001`, 'C2'],
      [`${INCOMING_FAMILY}__sub002`, 'C3'],
      [`${INCOMING_FAMILY}__sub002`, 'C4'],
      [UNESCAPED_UNDERSCORE_LOOKALIKE, 'C5'],
      [OTHER_FAMILY, 'C6']
    ]) {
      await stageRawRow(FILE, batchID, tag);
    }
    const familyCount = await countStagedRows(connectionManager, schema, FILE, INCOMING_FAMILY, plotID, censusID);
    const otherFamilyCount = await countStagedRows(connectionManager, schema, FILE, OTHER_FAMILY, plotID, censusID);
    const wrongCensusCount = await countStagedRows(connectionManager, schema, FILE, INCOMING_FAMILY, plotID, censusID + 1);
    console.log(`[countStagedRows] family=${familyCount} other=${otherFamilyCount} wrongCensus=${wrongCensusCount}`);
    expect(familyCount).toBe(4);
    expect(otherFamilyCount).toBe(1);
    expect(wrongCensusCount).toBe(0);
  });
});
