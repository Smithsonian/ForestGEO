/**
 * Plot-coordinate ingestion — Integration Tests
 *
 * Proves PlotX/PlotY flow from temporarymeasurements through the real
 * bulkingestionprocess stored procedure into stems, with the deterministic
 * "lowest contributing temporarymeasurements.id, per axis independently"
 * materialization rule described in
 * docs/superpowers/plans/2026-08-26-plot-coordinate-ingest.md (Task 7).
 *
 * Covered acceptance criteria:
 *   1. A new stem receives each axis from the lowest temporarymeasurements.id
 *      that resolves to it and supplies that axis (independently per axis),
 *      and the result does not depend on physical INSERT order.
 *   2. An existing current-census stem fills each NULL axis independently
 *      from the lowest-ID row supplying that axis, in a later batch.
 *   3. A non-NULL stored PlotX/PlotY is never overwritten by a later batch.
 *   4. A batch with no plot coordinates leaves stems.PlotX/PlotY NULL.
 *   5. Re-running the same (now-completed) batch produces identical stem
 *      values — the procedure's uploadmetrics idempotency skip is a no-op on
 *      already-materialized coordinates.
 *
 * NOTE ON SCOPE: Task 8 (not this task) adds RawPlotX/RawPlotY to the
 * coremeasurements INSERTs inside bulkingestionprocess. Until that lands,
 * coremeasurements.RawPlotX/RawPlotY stay NULL for every row this procedure
 * writes, even though the column already exists on the table (see
 * db/sql/tablestructures.sql). This suite therefore asserts only the
 * stems-side behavior; it does not assert coremeasurements.RawPlotX/RawPlotY.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/plot-coordinate-ingest.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { cleanupTestMeasurements, setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';
import { SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';

// ---------------------------------------------------------------------------
// Safety guard — setupTestDatabase DROPs/CREATEs its schema; never run remote.
// ---------------------------------------------------------------------------

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';

if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(
    `[plot-coordinate-ingest] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops and recreates its test schema and must only run against a local test database.`
  );
}

// ---------------------------------------------------------------------------
// Shared state bridge — hoisted so the ConnectionManager mock closure can read
// the live test connection after beforeAll wires it up. Mirrors
// tests/integration/ingest-batch.test.ts, which exercises the same real
// stored-procedure path.
// ---------------------------------------------------------------------------

const TRANSACTION_ID_PREFIX = 'plot-coord-ingest-tx-';

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
    withTransaction: async <T>(fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<any>; readonly id: string }) => Promise<T>): Promise<T> => {
      const id = await manager.beginTransaction();
      try {
        const tx = {
          id,
          query: (sql: string, params?: unknown[]) => manager.executeQuery(sql, params, id)
        };
        const result = await fn(tx);
        await manager.commitTransaction(id);
        return result;
      } catch (error) {
        await manager.rollbackTransaction(id);
        throw error;
      }
    },
    acquireApplicationLock: async (lockName: string, _transactionID: string, timeoutMs: number) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      const [rows] = await sharedState.connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, ?) as acquired', [lockName, Math.ceil(timeoutMs / 1000)]);
      return (rows as RowDataPacket[])[0]?.acquired === 1;
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
import { stageMeasurementChunk, type StageMeasurementChunkParams } from '@/lib/uploads/stage-measurements';
import { ingestBatch, type IngestBatchResult } from '@/lib/uploads/ingest-batch';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const CSV_HEADERS = ['tag', 'stemtag', 'spcode', 'quadrat', 'lx', 'ly', 'px', 'py', 'dbh', 'hom', 'date', 'codes'];
const CSV_DELIMITER = ',';
const CHANGED_BY = 'plot-coordinate-ingest-test@forestgeo.test';
const QUADRAT_NAME = 'Q01';
const SPECIES_CODE = 'ACERRU';

describe('plot-coordinate-ingest — integration', () => {
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
  }, 120000);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    if (sharedState.activeTransactionID) {
      await connection.rollback();
      sharedState.activeTransactionID = null;
    }
    await cleanupTestMeasurements(connection, testData, { additionalTables: ['unifiedchangelog'] });
    console.log('[beforeEach] cleared measurement tables + unifiedchangelog');
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Row shape for the production stageMeasurementChunk path (header-resolved CSV rows). */
  function buildRow(opts: {
    tag: string;
    stemtag: string;
    lx: string;
    ly: string;
    px?: string;
    py?: string;
    dbh: string;
    date: string;
  }): Record<string, string> {
    // Every key in CSV_HEADERS must be present on every row (even as an empty
    // string) — resolveMeasurementChunk validates row shape by column COUNT
    // against csvHeaders.length, so an omitted optional column looks like a
    // malformed row rather than "no value supplied".
    const row: Record<string, string> = {
      tag: opts.tag,
      stemtag: opts.stemtag,
      spcode: SPECIES_CODE,
      quadrat: QUADRAT_NAME,
      lx: opts.lx,
      ly: opts.ly,
      px: opts.px ?? '',
      py: opts.py ?? '',
      dbh: opts.dbh,
      hom: '1.3',
      date: opts.date,
      codes: 'A'
    };
    return row;
  }

  async function stageRows(rows: Record<string, string>[], fileName: string, batchID: string, uploadMode: UploadMode): Promise<void> {
    const transactionID = await connectionManager.beginTransaction();
    const params: StageMeasurementChunkParams = {
      schema,
      fileName,
      batchID,
      plotID,
      censusID,
      uploadMode,
      sourceFormat: SourceFormat.csv,
      rawRows: rows,
      csvHeaders: CSV_HEADERS,
      delimiter: CSV_DELIMITER,
      uploadSessionID: `${batchID}-session`,
      transactionID,
      changedBy: CHANGED_BY
    };
    const result = await stageMeasurementChunk(connectionManager, params);
    await connectionManager.commitTransaction(transactionID);
    console.log(`[stage] fileName=${fileName} batchID=${batchID} insertedCount=${result.insertedCount} invalidRows=${result.invalidRows.length}`);
    expect(result.invalidRows, `staging must not reject any fixture row: ${JSON.stringify(result.invalidRows)}`).toHaveLength(0);
    expect(result.insertedCount).toBe(rows.length);
  }

  /**
   * `expectPartialFailure` allows sub.batchFailedButHandled to be true — that
   * flag is also set for a batch that partially (and correctly) fails some
   * rows as hard failures (e.g. duplicates), not only for a batch that failed
   * catastrophically. Tests that stage a row deliberately expected to fail
   * (e.g. a surviving-duplicate pick test) must opt in; every other caller
   * gets the stricter "nothing failed" check.
   */
  async function runIngest(fileName: string, batchID: string, expectPartialFailure = false): Promise<IngestBatchResult> {
    const result = await ingestBatch(connectionManager, { schema, fileID: fileName, batchID });
    console.log(
      `[ingestBatch] fileName=${fileName} batchID=${batchID} processedSubBatches=${result.processedSubBatches} totalRows=${result.totalRows} ` +
        `recovered=${result.recovered} noDataFound=${result.noDataFound}`
    );
    for (const sub of result.subBatchResults) {
      console.log(
        `[ingestBatch] sub-batch ${sub.subBatchID}: attempts=${sub.attemptsNeeded} failedButHandled=${sub.batchFailedButHandled} message=${sub.message}`
      );
      if (sub.batchFailedButHandled) {
        const [descRows] = await connection.query<RowDataPacket[]>(
          `SELECT SourceRowIndex, Description FROM coremeasurements WHERE UploadFileID = ? AND UploadBatchID = ?`,
          [fileName, batchID]
        );
        console.log(`[DEBUG failure reasons] ${JSON.stringify(descRows)}`);
      }
      if (!expectPartialFailure) {
        expect(sub.batchFailedButHandled, `sub-batch must not silently fail: ${sub.message}`).toBe(false);
      }
    }
    return result;
  }

  /**
   * Direct insert into temporarymeasurements with an explicit `id`, bypassing
   * stageMeasurementChunk (which lets the DB auto-assign `id` and therefore
   * cannot control INSERT order relative to id order). This is the only way
   * to prove the procedure picks by `id` value rather than by physical
   * INSERT/table-scan order — the contract under test in the determinism
   * criteria. `id` is BIGINT UNSIGNED AUTO_INCREMENT; explicitly setting it on
   * an INSERT is standard MySQL and does not collide with future
   * auto-assigned ids (the auto-increment counter is monotonic and this
   * table is cleared, not truncated, between tests).
   */
  async function insertRawMeasurementRow(row: {
    id: number;
    fileName: string;
    batchID: string;
    treeTag: string;
    stemTag: string;
    localX: number;
    localY: number;
    plotX: number | null;
    plotY: number | null;
    dbh: number;
    hom: number;
    date: string;
  }): Promise<void> {
    await connection.query(
      `INSERT INTO temporarymeasurements
         (id, FileID, BatchID, SourceFormat, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName,
          LocalX, LocalY, PlotX, PlotY, DBH, HOM, MeasurementDate, Codes)
       VALUES (?, ?, ?, 'csv', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.fileName,
        row.batchID,
        plotID,
        censusID,
        row.treeTag,
        row.stemTag,
        SPECIES_CODE,
        QUADRAT_NAME,
        row.localX,
        row.localY,
        row.plotX,
        row.plotY,
        row.dbh,
        row.hom,
        row.date,
        'A'
      ]
    );
  }

  async function fetchStemPlotCoords(stemTag: string): Promise<{ plotX: number | null; plotY: number | null; stemGUID: number }> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT s.StemGUID, CAST(s.PlotX AS CHAR) AS PlotXText, CAST(s.PlotY AS CHAR) AS PlotYText
       FROM stems s
       WHERE s.StemTag = ? AND s.CensusID = ?`,
      [stemTag, censusID]
    );
    expect(rows, `exactly one stem must exist for StemTag=${stemTag}`).toHaveLength(1);
    const row = rows[0];
    return {
      plotX: row.PlotXText === null ? null : Number(row.PlotXText),
      plotY: row.PlotYText === null ? null : Number(row.PlotYText),
      stemGUID: Number(row.StemGUID)
    };
  }

  // -------------------------------------------------------------------------
  // AC1 + AC5: new stem — independent per-axis lowest-id pick, order-
  // independent, and stable across a repeated (idempotent-skip) run.
  // -------------------------------------------------------------------------

  it('materializes a new stem PlotX/PlotY from the lowest id supplying each axis, independently per axis', async () => {
    const FILE_NAME = 'plot-coord-new-stem.csv';
    const BATCH_ID = 'plot-coord-new-stem-batch';
    const STEM_TAG = 'PXNEW1';
    const TREE_TAG = 'TREE-PXNEW1';

    // Three rows that are EXACT duplicates of the SAME measurement (identical
    // TreeTag/StemTag/SpeciesCode/QuadratName/LocalX/LocalY/DBH/HOM/
    // MeasurementDate) and disagree only on PlotX/PlotY, which is
    // deliberately NOT part of the dedup key. This is the only way multiple
    // temporarymeasurements rows for the SAME new stem can legitimately
    // reach the dedup aggregate within one batch: a pre-existing, unrelated
    // guard (Stage 2b, "within-batch TreeTag+StemTag collision detection")
    // hard-fails ANY rows that share TreeTag+StemTag but are NOT exact
    // duplicates on that key, specifically to avoid an ambiguous pick — so a
    // genuinely new stem can never legitimately arrive with multiple
    // DIFFERING (by DBH/HOM/date) measurement rows in a single batch.
    //
    // Physically inserted out of ascending-id order (id=30, then 10, then
    // 20). GROUP_CONCAT(... ORDER BY id) does not depend on physical
    // insertion/scan order, but this ordering would surface it if it did.
    const duplicateRows = [
      { id: 900030, plotX: 999, plotY: 999 as number | null },
      { id: 900010, plotX: 111, plotY: null as number | null }, // lowest id supplying PlotX -> must win
      { id: 900020, plotX: null as number | null, plotY: 222 } // lowest id supplying PlotY -> must win
    ];
    async function stageDuplicateRows(): Promise<void> {
      for (const row of duplicateRows) {
        await insertRawMeasurementRow({
          id: row.id,
          fileName: FILE_NAME,
          batchID: BATCH_ID,
          treeTag: TREE_TAG,
          stemTag: STEM_TAG,
          localX: 1,
          localY: 1,
          plotX: row.plotX,
          plotY: row.plotY,
          dbh: 10,
          hom: 1.3,
          date: '2024-01-05'
        });
      }
    }
    await stageDuplicateRows();

    // The two duplicate rows are EXPECTED to fail (DUPLICATE_ENTRY) — only
    // the id=900010-anchored aggregate row should survive to ingest cleanly.
    await runIngest(FILE_NAME, BATCH_ID, true);

    const firstRun = await fetchStemPlotCoords(STEM_TAG);
    console.log(`[new-stem] firstRun=${JSON.stringify(firstRun)}`);
    expect(firstRun.plotX, 'PlotX must come from id=900010 (lowest id supplying PlotX), not id=900030').toBe(111);
    expect(firstRun.plotY, 'PlotY must come from id=900020 (lowest id supplying PlotY), not id=900030').toBe(222);

    // The two non-surviving duplicate rows (900020, 900030) must still be
    // visible as failed/unresolved measurements, not silently dropped.
    const [failedRows] = await connection.query<RowDataPacket[]>(
      `SELECT SourceRowIndex FROM coremeasurements WHERE UploadFileID = ? AND UploadBatchID = ? AND StemGUID IS NULL ORDER BY SourceRowIndex`,
      [FILE_NAME, BATCH_ID]
    );
    console.log(`[new-stem] failed duplicate rows=${JSON.stringify(failedRows.map(row => row.SourceRowIndex))}`);
    expect(failedRows.map(row => Number(row.SourceRowIndex))).toEqual([900020, 900030]);

    // AC5: re-running the now-completed batch (idempotent skip branch) must
    // not change the already-materialized stem values. Mirrors
    // ingest-batch.test.ts's idempotent-skip case: re-stage the identical
    // rows under the same FileID/BatchID, then re-run — uploadmetrics'
    // 'completed' check skips re-ingestion and just drains the re-staged rows.
    await stageDuplicateRows();
    const secondRunResult = await runIngest(FILE_NAME, BATCH_ID, true);
    expect(secondRunResult.subBatchResults[0].message).toContain('already processed, skipped');
    const secondRun = await fetchStemPlotCoords(STEM_TAG);
    console.log(`[new-stem] secondRun (repeat of same batch)=${JSON.stringify(secondRun)}`);
    expect(secondRun.plotX).toBe(firstRun.plotX);
    expect(secondRun.plotY).toBe(firstRun.plotY);
  }, 60000);

  // -------------------------------------------------------------------------
  // AC2: existing current-census stem — fill-only, independent per axis.
  // -------------------------------------------------------------------------

  it('fills a NULL PlotX/PlotY on an existing current-census stem from a later batch', async () => {
    const FILE_A = 'plot-coord-existing-a.csv';
    const BATCH_A = 'plot-coord-existing-batch-a';
    const FILE_B = 'plot-coord-existing-b.csv';
    const BATCH_B = 'plot-coord-existing-batch-b';
    const STEM_TAG = 'PXFILL1';

    // Batch A: create the stem with no plot coordinates at all.
    await stageRows(
      [buildRow({ tag: 'TREE-PXFILL1', stemtag: STEM_TAG, lx: '2', ly: '2', dbh: '10', date: '2024-01-05' })],
      FILE_A,
      BATCH_A,
      UploadMode.CLEAN_REUPLOAD
    );
    await runIngest(FILE_A, BATCH_A);

    const afterFirstBatch = await fetchStemPlotCoords(STEM_TAG);
    console.log(`[existing-stem] afterFirstBatch=${JSON.stringify(afterFirstBatch)}`);
    expect(afterFirstBatch.plotX, 'stem must start with no PlotX').toBeNull();
    expect(afterFirstBatch.plotY, 'stem must start with no PlotY').toBeNull();

    // Batch B: a later, additive (REVISIONS) upload re-measures the same
    // stem and now supplies both plot coordinates. This must land through
    // the fill-only catch-up UPDATE, not the new-stem INSERT path (INSERT
    // IGNORE will skip — the stem already exists for this CensusID).
    await stageRows(
      [buildRow({ tag: 'TREE-PXFILL1', stemtag: STEM_TAG, lx: '2', ly: '2', px: '55', py: '66', dbh: '12', date: '2024-01-06' })],
      FILE_B,
      BATCH_B,
      UploadMode.REVISIONS
    );
    await runIngest(FILE_B, BATCH_B);

    const afterSecondBatch = await fetchStemPlotCoords(STEM_TAG);
    console.log(`[existing-stem] afterSecondBatch=${JSON.stringify(afterSecondBatch)}`);
    expect(afterSecondBatch.stemGUID, 'catch-up must fill the SAME stem row, not create a new one').toBe(afterFirstBatch.stemGUID);
    expect(afterSecondBatch.plotX, 'PlotX must be filled from the later batch').toBe(55);
    expect(afterSecondBatch.plotY, 'PlotY must be filled from the later batch').toBe(66);
  }, 60000);

  // -------------------------------------------------------------------------
  // AC3: a non-NULL stored PlotX/PlotY is never overwritten.
  // -------------------------------------------------------------------------

  it('never overwrites a non-NULL stored PlotX/PlotY on an existing stem', async () => {
    const FILE_A = 'plot-coord-preserve-a.csv';
    const BATCH_A = 'plot-coord-preserve-batch-a';
    const FILE_B = 'plot-coord-preserve-b.csv';
    const BATCH_B = 'plot-coord-preserve-batch-b';
    const STEM_TAG = 'PXKEEP1';

    await stageRows(
      [buildRow({ tag: 'TREE-PXKEEP1', stemtag: STEM_TAG, lx: '3', ly: '3', dbh: '10', date: '2024-01-05' })],
      FILE_A,
      BATCH_A,
      UploadMode.CLEAN_REUPLOAD
    );
    await runIngest(FILE_A, BATCH_A);

    // Simulate a previously-established, trusted plot coordinate (e.g. a
    // manual GPS correction) already stored on the stem.
    await connection.query(`UPDATE stems SET PlotX = 42, PlotY = 42 WHERE StemTag = ? AND CensusID = ?`, [STEM_TAG, censusID]);
    const beforeSecondBatch = await fetchStemPlotCoords(STEM_TAG);
    expect(beforeSecondBatch.plotX).toBe(42);
    expect(beforeSecondBatch.plotY).toBe(42);

    // A later upload disagrees with the stored value.
    await stageRows(
      [buildRow({ tag: 'TREE-PXKEEP1', stemtag: STEM_TAG, lx: '3', ly: '3', px: '777', py: '777', dbh: '13', date: '2024-01-06' })],
      FILE_B,
      BATCH_B,
      UploadMode.REVISIONS
    );
    await runIngest(FILE_B, BATCH_B);

    const afterSecondBatch = await fetchStemPlotCoords(STEM_TAG);
    console.log(`[preserve] beforeSecondBatch=${JSON.stringify(beforeSecondBatch)} afterSecondBatch=${JSON.stringify(afterSecondBatch)}`);
    expect(afterSecondBatch.plotX, 'stored PlotX must survive the disagreeing later batch').toBe(42);
    expect(afterSecondBatch.plotY, 'stored PlotY must survive the disagreeing later batch').toBe(42);

    // The incoming (disagreeing) measurement itself must still have been
    // ingested normally — the fill-only guard must not block the batch.
    //
    // NOTE: this deliberately does NOT assert coremeasurements.RawPlotX/
    // RawPlotY. Task 8 (not this task) wires bulkingestionprocess's
    // coremeasurements INSERTs to populate those columns; until it lands
    // they stay NULL even though the column already exists on the table.
    const [cmRows] = await connection.query<RowDataPacket[]>(
      `SELECT StemGUID, RawStemTag FROM coremeasurements WHERE CensusID = ? AND UploadFileID = ? AND UploadBatchID = ?`,
      [censusID, FILE_B, BATCH_B]
    );
    expect(cmRows, 'the disagreeing measurement itself must still ingest').toHaveLength(1);
    expect(cmRows[0].StemGUID, 'the ingested measurement must resolve to the existing stem').not.toBeNull();
    expect(cmRows[0].RawStemTag).toBe(STEM_TAG);
  }, 60000);

  // -------------------------------------------------------------------------
  // AC4: a batch with no plot coordinates leaves stems.PlotX/PlotY NULL.
  // -------------------------------------------------------------------------

  it('leaves stems.PlotX/PlotY NULL when the batch supplies no plot coordinates', async () => {
    const FILE_NAME = 'plot-coord-no-coords.csv';
    const BATCH_ID = 'plot-coord-no-coords-batch';
    const STEM_TAG = 'PXNONE1';

    await stageRows(
      [buildRow({ tag: 'TREE-PXNONE1', stemtag: STEM_TAG, lx: '4', ly: '4', dbh: '10', date: '2024-01-05' })],
      FILE_NAME,
      BATCH_ID,
      UploadMode.CLEAN_REUPLOAD
    );
    await runIngest(FILE_NAME, BATCH_ID);

    const stem = await fetchStemPlotCoords(STEM_TAG);
    console.log(`[no-coords] stem=${JSON.stringify(stem)}`);
    expect(stem.plotX).toBeNull();
    expect(stem.plotY).toBeNull();
  }, 60000);
});
