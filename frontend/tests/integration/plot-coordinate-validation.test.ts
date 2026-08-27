/**
 * Plot-coordinate read-model projection + RunPlotCoordinateConsistencyValidation — Integration Tests
 *
 * Proves the Task 9 read-model change: measurementssummary and viewfulltable
 * expose StemPlotX/StemPlotY, preferring the row-level upload snapshot
 * (coremeasurements.RawPlotX/RawPlotY) over the stem's canonical value
 * (stems.PlotX/PlotY) — the deliberate reverse of the StemLocalX/StemLocalY
 * precedence, documented in
 * docs/superpowers/plans/2026-08-26-plot-coordinate-ingest.md (Task 9).
 *
 * Also proves the Task 11 validation: RunPlotCoordinateConsistencyValidation
 * converts each row's supplied plot coordinate to metres, compares it against
 * its OWN quadrat's median offset (not against a fixed tolerance), and flags
 * rows more than PLOT_COORDINATE_OUTLIER_METRES (1.0m) away.
 *
 * Exercises the application-side scoped refresh builders in
 * lib/measurementviewrefresh.ts (refreshMeasurementsSummaryForScope /
 * refreshViewFullTableForScope) — the path validation/upload orchestration
 * actually calls — not the standalone stored procedures.
 *
 * Covered acceptance criteria (Task 9 read-model):
 *   1. Both read models carry StemPlotX/StemPlotY.
 *   2. The value is COALESCE(cm.RawPlotX, stem.PlotX) — the row snapshot wins
 *      even when it disagrees with an already-populated stem.
 *   3. A failed row (StemGUID NULL) still shows its raw plot coordinates.
 *
 * Covered acceptance criteria (Task 11 validation, see plan for full list):
 *   - constant non-zero offset -> zero errors (the median, not a fixed
 *     tolerance, is the baseline)
 *   - a single row displaced by a quadrat width is flagged alone
 *   - fewer than 3 contributors -> quadrat skipped entirely
 *   - a row missing either raw upload axis never contributes, even when
 *     stems.PlotX/PlotY are populated
 *   - X and Y medians are independent even when their central ranks land on
 *     different rows
 *   - centimetres and metres produce identical results (unit scaling)
 *   - unknown/NULL DefaultDimensionUnits fails loudly instead of guessing
 *   - the procedure's EXIT HANDLER cleans up both temp tables and RESIGNALs
 *     on failure, so a retry is never blocked by stale temp tables
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/plot-coordinate-validation.test.ts
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
    `[plot-coordinate-validation] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops and recreates its test schema and must only run against a local test database.`
  );
}

// ---------------------------------------------------------------------------
// Shared state bridge — hoisted so the ConnectionManager mock closure can read
// the live test connection after beforeAll wires it up. Mirrors
// tests/integration/plot-coordinate-ingest.test.ts, which exercises the same
// real stored-procedure + application-side refresh paths.
// ---------------------------------------------------------------------------

const TRANSACTION_ID_PREFIX = 'plot-coord-validation-tx-';

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
import { refreshMeasurementsSummaryForScope, refreshViewFullTableForScope } from '@/lib/measurementviewrefresh';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const CSV_HEADERS = ['tag', 'stemtag', 'spcode', 'quadrat', 'lx', 'ly', 'px', 'py', 'dbh', 'hom', 'date', 'codes'];
const CSV_DELIMITER = ',';
const CHANGED_BY = 'plot-coordinate-validation-test@forestgeo.test';
const QUADRAT_NAME = 'Q01';
const SPECIES_CODE = 'ACERRU';

describe('plot-coordinate-validation — integration', () => {
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

    // tablestructures.sql and corequeries.sql now seed the measurement_errors
    // and sitespecificvalidations rows for validation 19
    // (ValidatePlotCoordinateConsistency) on every fresh schema, so this insert
    // is normally a no-op. It stays as a defensive INSERT IGNORE so this suite
    // doesn't depend on that seed order: RunPlotCoordinateConsistencyValidation
    // only reads measurement_errors (not sitespecificvalidations), so this row
    // alone is sufficient for these tests even if the seed above ever regresses.
    await connection.query(
      `INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
       VALUES ('validation', '19', 'Validation ValidatePlotCoordinateConsistency')`
    );

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
    await cleanupTestMeasurements(connection, testData, { additionalTables: ['unifiedchangelog', 'measurementssummary', 'viewfulltable'] });
    // Several validation-19 tests mutate plots.DefaultDimensionUnits (cm
    // equivalence, unknown-unit failure). Reset to the schema default before
    // every test so units set by one test never leak into the next.
    await connection.query(`UPDATE plots SET DefaultDimensionUnits = 'm' WHERE PlotID = ?`, [plotID]);
    console.log('[beforeEach] cleared measurement tables + unifiedchangelog + summary views, reset plot units to m');
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function buildRow(opts: {
    tag: string;
    stemtag: string;
    spcode?: string;
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
    return {
      tag: opts.tag,
      stemtag: opts.stemtag,
      spcode: opts.spcode ?? SPECIES_CODE,
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
   * `expectPartialFailure` allows sub.batchFailedButHandled to be true — used
   * by the deliberately-hard-failing fixture (invalid species code) below.
   */
  async function runIngest(fileName: string, batchID: string, expectPartialFailure = false): Promise<IngestBatchResult> {
    const result = await ingestBatch(connectionManager, { schema, fileID: fileName, batchID });
    console.log(`[ingestBatch] fileName=${fileName} batchID=${batchID} processedSubBatches=${result.processedSubBatches} totalRows=${result.totalRows}`);
    for (const sub of result.subBatchResults) {
      console.log(
        `[ingestBatch] sub-batch ${sub.subBatchID}: attempts=${sub.attemptsNeeded} failedButHandled=${sub.batchFailedButHandled} message=${sub.message}`
      );
      if (!expectPartialFailure) {
        expect(sub.batchFailedButHandled, `sub-batch must not silently fail: ${sub.message}`).toBe(false);
      }
    }
    return result;
  }

  /** Runs both scoped refresh builders under test — the app-side path
   * validation/upload orchestration actually calls (as opposed to calling the
   * standalone RefreshMeasurementsSummary/RefreshViewFullTable procedures
   * directly). */
  async function refreshReadModelsForScope(): Promise<void> {
    const transactionID = await connectionManager.beginTransaction();
    await refreshMeasurementsSummaryForScope(connectionManager, schema, plotID, censusID, transactionID);
    await refreshViewFullTableForScope(connectionManager, schema, plotID, censusID, transactionID);
    await connectionManager.commitTransaction(transactionID);
  }

  async function fetchSummaryStemPlotCoords(stemTag: string): Promise<{ x: number | null; y: number | null }> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT CAST(StemPlotX AS CHAR) AS StemPlotXText, CAST(StemPlotY AS CHAR) AS StemPlotYText
       FROM measurementssummary WHERE CensusID = ? AND StemTag = ?`,
      [censusID, stemTag]
    );
    expect(rows, `exactly one measurementssummary row must exist for StemTag=${stemTag}`).toHaveLength(1);
    return {
      x: rows[0].StemPlotXText === null ? null : Number(rows[0].StemPlotXText),
      y: rows[0].StemPlotYText === null ? null : Number(rows[0].StemPlotYText)
    };
  }

  async function fetchViewFullTableStemPlotCoords(stemTag: string): Promise<{ x: number | null; y: number | null }> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT CAST(StemPlotX AS CHAR) AS StemPlotXText, CAST(StemPlotY AS CHAR) AS StemPlotYText
       FROM viewfulltable WHERE CensusID = ? AND StemTag = ?`,
      [censusID, stemTag]
    );
    expect(rows, `exactly one viewfulltable row must exist for StemTag=${stemTag}`).toHaveLength(1);
    return {
      x: rows[0].StemPlotXText === null ? null : Number(rows[0].StemPlotXText),
      y: rows[0].StemPlotYText === null ? null : Number(rows[0].StemPlotYText)
    };
  }

  // -------------------------------------------------------------------------
  // AC2: the row-level snapshot wins over the stem's canonical value.
  // -------------------------------------------------------------------------

  it('shows the row-level raw plot coordinate, not the stem value', async () => {
    const FILE_NAME = 'plot-coord-validation-row-wins.csv';
    const BATCH_ID = 'pcv-row-wins-batch';
    const STEM_TAG = '7';
    const TREE_TAG = 'TREE-7';

    await stageRows(
      [buildRow({ tag: TREE_TAG, stemtag: STEM_TAG, lx: '1', ly: '1', px: '10', py: '20', dbh: '10', date: '2024-01-05' })],
      FILE_NAME,
      BATCH_ID,
      UploadMode.CLEAN_REUPLOAD
    );
    await runIngest(FILE_NAME, BATCH_ID);

    // Simulate a stem whose canonical PlotX/PlotY has since been corrected...
    await connection.query(`UPDATE stems SET PlotX = 42, PlotY = 42 WHERE StemTag = ? AND CensusID = ?`, [STEM_TAG, censusID]);
    // ...while the ingested row's own raw snapshot disagrees with it.
    await connection.query(`UPDATE coremeasurements SET RawPlotX = 777, RawPlotY = 888 WHERE CensusID = ? AND RawStemTag = ?`, [censusID, STEM_TAG]);

    await refreshReadModelsForScope();

    const summaryCoords = await fetchSummaryStemPlotCoords(STEM_TAG);
    console.log(`[row-wins] measurementssummary=${JSON.stringify(summaryCoords)}`);
    expect(summaryCoords.x, 'View Errors must show what the file supplied, not the stem canonical').toBe(777);
    expect(summaryCoords.y, 'View Errors must show what the file supplied, not the stem canonical').toBe(888);

    const viewFullTableCoords = await fetchViewFullTableStemPlotCoords(STEM_TAG);
    console.log(`[row-wins] viewfulltable=${JSON.stringify(viewFullTableCoords)}`);
    expect(viewFullTableCoords.x, 'viewfulltable must show what the file supplied, not the stem canonical').toBe(777);
    expect(viewFullTableCoords.y, 'viewfulltable must show what the file supplied, not the stem canonical').toBe(888);
  }, 60000);

  // -------------------------------------------------------------------------
  // AC3: a failed row (StemGUID NULL) still shows its raw plot coordinates.
  // -------------------------------------------------------------------------

  it('shows raw plot coordinates for a failed row with no resolved stem', async () => {
    const FILE_NAME = 'plot-coord-validation-hard-fail.csv';
    const BATCH_ID = 'pcv-hard-fail-batch';
    const TREE_TAG = 'TREE-PXVFAIL1';
    const STEM_TAG = 'PXVFAIL1';

    await stageRows(
      [buildRow({ tag: TREE_TAG, stemtag: STEM_TAG, spcode: 'NOSUCH', lx: '1', ly: '1', px: '-0.271', py: '267.5', dbh: '10', date: '2024-01-05' })],
      FILE_NAME,
      BATCH_ID,
      UploadMode.CLEAN_REUPLOAD
    );

    // An invalid species code never resolves to a stem — StemGUID stays NULL.
    await runIngest(FILE_NAME, BATCH_ID, true);

    const [cmRows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID, StemGUID FROM coremeasurements WHERE CensusID = ? AND UploadFileID = ? AND UploadBatchID = ? AND RawTreeTag = ?`,
      [censusID, FILE_NAME, BATCH_ID, TREE_TAG]
    );
    expect(cmRows, 'the invalid-species row must still materialize as a hard failure').toHaveLength(1);
    expect(cmRows[0].StemGUID, 'invalid species code should still hard-fail (no stem to prefer over)').toBeNull();

    await refreshReadModelsForScope();

    const [summaryRows] = await connection.query<RowDataPacket[]>(
      `SELECT StemGUID, CAST(StemPlotX AS CHAR) AS StemPlotXText, CAST(StemPlotY AS CHAR) AS StemPlotYText
       FROM measurementssummary WHERE CoreMeasurementID = ?`,
      [cmRows[0].CoreMeasurementID]
    );
    expect(summaryRows, 'a failed row must still appear in measurementssummary').toHaveLength(1);
    expect(summaryRows[0].StemGUID, 'a failed row has no resolved stem').toBeNull();
    expect(Number(summaryRows[0].StemPlotXText), 'a failed row must fall back to its own raw snapshot (no stem to prefer)').toBe(-0.271);
    expect(Number(summaryRows[0].StemPlotYText), 'a failed row must fall back to its own raw snapshot (no stem to prefer)').toBe(267.5);

    const [viewFullTableRows] = await connection.query<RowDataPacket[]>(
      `SELECT StemGUID, CAST(StemPlotX AS CHAR) AS StemPlotXText, CAST(StemPlotY AS CHAR) AS StemPlotYText
       FROM viewfulltable WHERE CoreMeasurementID = ?`,
      [cmRows[0].CoreMeasurementID]
    );
    expect(viewFullTableRows, 'a failed row must still appear in viewfulltable').toHaveLength(1);
    expect(viewFullTableRows[0].StemGUID, 'a failed row has no resolved stem').toBeNull();
    expect(Number(viewFullTableRows[0].StemPlotXText), 'a failed row must fall back to its own raw snapshot (no stem to prefer)').toBe(-0.271);
    expect(Number(viewFullTableRows[0].StemPlotYText), 'a failed row must fall back to its own raw snapshot (no stem to prefer)').toBe(267.5);
  }, 60000);

  // ===========================================================================
  // Task 11: RunPlotCoordinateConsistencyValidation
  // ===========================================================================
  //
  // These tests bypass the CSV staging/ingest pipeline (stageRows/runIngest
  // above) and insert directly into trees/stems/coremeasurements/quadrats.
  // The validation only cares about the final resolved shape — a stem with a
  // known QuadratID/LocalX/LocalY and a coremeasurements row carrying
  // RawPlotX/RawPlotY — and direct insertion gives exact, deterministic
  // control over StartX/StartY/LocalX/LocalY/RawPlotX/RawPlotY, which the
  // constant-offset and median-independence scenarios below depend on.

  describe('RunPlotCoordinateConsistencyValidation', () => {
    let autoTagSeq = 0;
    const quadratIDByName = new Map<string, number>();

    /** Finds or creates a quadrat with the exact StartX/StartY the test needs.
     * The default fixture quadrats (Q01..Q10, seeded by setupTestDatabase) are
     * a fixed 20x20 grid unrelated to the offsets these tests construct, so
     * every scenario below uses its own quadrat name. Quadrats are not wiped
     * by cleanupTestMeasurements (only measurement tables are), so this cache
     * also protects against re-creating (and unique-constraint colliding on)
     * the same quadrat name across tests in this describe block. */
    async function getOrCreateQuadrat(name: string, startX: number, startY: number): Promise<number> {
      const cached = quadratIDByName.get(name);
      if (cached !== undefined) return cached;

      const [existing] = await connection.query<RowDataPacket[]>(`SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ? AND IsActive = 1`, [
        name,
        plotID
      ]);
      if (existing.length > 0) {
        quadratIDByName.set(name, existing[0].QuadratID);
        return existing[0].QuadratID;
      }

      await connection.query(
        `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape)
         VALUES (?, ?, ?, ?, 20, 20, 400, 'square')`,
        [plotID, name, startX, startY]
      );
      const [created] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS QuadratID');
      const quadratID = created[0].QuadratID;
      quadratIDByName.set(name, quadratID);
      return quadratID;
    }

    interface InsertResolvedStemOptions {
      quadrat: string;
      startX?: number;
      startY?: number;
      localX?: number;
      localY?: number;
      /** Shorthand: sets both the raw upload snapshot AND the stem's canonical
       * value to the same number. Use rawPlotX/rawPlotY and/or
       * stemPlotX/stemPlotY directly when a scenario needs them to disagree
       * (or one to be present and the other absent). */
      plotX?: number | null;
      plotY?: number | null;
      rawPlotX?: number | null;
      rawPlotY?: number | null;
      stemPlotX?: number | null;
      stemPlotY?: number | null;
      tag?: string;
    }

    /** Directly materializes one resolved stem + coremeasurements row: a
     * quadrat (created on first use), a tree, a stem with LocalX/LocalY and
     * canonical PlotX/PlotY, and a coremeasurements row carrying
     * RawPlotX/RawPlotY — the row-level upload snapshot the validation
     * actually reads. */
    async function insertResolvedStem(opts: InsertResolvedStemOptions): Promise<{ coreMeasurementID: number; stemGUID: number; tag: string }> {
      autoTagSeq += 1;
      const tag = opts.tag ?? `AUTO-${autoTagSeq}`;
      const startX = opts.startX ?? 0;
      const startY = opts.startY ?? 0;
      const localX = opts.localX ?? 0;
      const localY = opts.localY ?? 0;
      const rawPlotX = opts.rawPlotX !== undefined ? opts.rawPlotX : (opts.plotX ?? null);
      const rawPlotY = opts.rawPlotY !== undefined ? opts.rawPlotY : (opts.plotY ?? null);
      const stemPlotX = opts.stemPlotX !== undefined ? opts.stemPlotX : (opts.plotX ?? null);
      const stemPlotY = opts.stemPlotY !== undefined ? opts.stemPlotY : (opts.plotY ?? null);

      const quadratID = await getOrCreateQuadrat(opts.quadrat, startX, startY);

      const [speciesRows] = await connection.query<RowDataPacket[]>(`SELECT SpeciesID FROM species WHERE SpeciesCode = ?`, [SPECIES_CODE]);
      expect(speciesRows, `fixture species ${SPECIES_CODE} must exist`).toHaveLength(1);
      const speciesID = speciesRows[0].SpeciesID;

      await connection.query(`INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)`, [`TREE-${tag}`, speciesID, censusID]);
      const [treeRows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS TreeID');
      const treeID = treeRows[0].TreeID;

      await connection.query(
        `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, PlotX, PlotY, IsActive)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [treeID, quadratID, censusID, tag, localX, localY, stemPlotX, stemPlotY]
      );
      const [stemRows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS StemGUID');
      const stemGUID = stemRows[0].StemGUID;

      await connection.query(
        `INSERT INTO coremeasurements
           (CensusID, StemGUID, MeasuredDBH, MeasuredHOM, MeasurementDate, RawPlotX, RawPlotY, RawTreeTag, RawStemTag, IsActive)
         VALUES (?, ?, 10, 1.3, '2024-01-05', ?, ?, ?, ?, 1)`,
        [censusID, stemGUID, rawPlotX, rawPlotY, `TREE-${tag}`, tag]
      );
      const [cmRows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS CoreMeasurementID');

      return { coreMeasurementID: cmRows[0].CoreMeasurementID, stemGUID, tag };
    }

    /** Sugar over insertResolvedStem for tests that want to control the offset
     * (RawPlotX - (StartX+LocalX)) directly: a quadrat pinned at the origin
     * with LocalX/LocalY = 0 makes RawPlotX/RawPlotY equal to the offset. */
    async function insertOffsets(quadrat: string, entries: { tag: string; x: number; y: number }[]): Promise<void> {
      for (const entry of entries) {
        await insertResolvedStem({ quadrat, startX: 0, startY: 0, localX: 0, localY: 0, plotX: entry.x, plotY: entry.y, tag: entry.tag });
      }
    }

    async function setPlotUnits(units: string): Promise<void> {
      await connection.query(`UPDATE plots SET DefaultDimensionUnits = ? WHERE PlotID = ?`, [units, plotID]);
    }

    async function runValidation19(): Promise<void> {
      await connection.query('CALL RunPlotCoordinateConsistencyValidation(?, ?)', [censusID, plotID]);
    }

    /** Count of unresolved validation-19 links across the whole test census —
     * every scenario below uses its own quadrat, so this doubles as "how many
     * rows did THIS test's call flag" without needing to scope by quadrat. */
    async function validation19Count(): Promise<number> {
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt
         FROM measurement_error_log l
         JOIN measurement_errors me ON me.ErrorID = l.ErrorID
         WHERE me.ErrorSource = 'validation' AND me.ErrorCode = '19' AND l.IsResolved = FALSE`
      );
      return Number(rows[0].cnt);
    }

    /** StemTags of every row currently flagged by validation 19, sorted for
     * deterministic assertions. */
    async function flaggedTags(): Promise<string[]> {
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT s.StemTag
         FROM measurement_error_log l
         JOIN measurement_errors me ON me.ErrorID = l.ErrorID
         JOIN coremeasurements cm ON cm.CoreMeasurementID = l.MeasurementID
         JOIN stems s ON s.StemGUID = cm.StemGUID
         WHERE me.ErrorSource = 'validation' AND me.ErrorCode = '19' AND l.IsResolved = FALSE
         ORDER BY s.StemTag`
      );
      return rows.map(row => row.StemTag as string);
    }

    /** Counts rows in the given quadrat that satisfy the procedure's own
     * "supplied both raw upload axes" contributor condition — computed
     * independently of the procedure's (dropped-on-exit) temp tables, so this
     * proves what actually fed the median rather than re-reading the
     * procedure's own intermediate state. */
    async function contributorCount(quadratName: string): Promise<number> {
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt
         FROM coremeasurements cm
         JOIN census c   ON c.CensusID = cm.CensusID AND c.IsActive IS TRUE
         JOIN stems s    ON s.StemGUID = cm.StemGUID AND s.CensusID = cm.CensusID AND s.IsActive IS TRUE
         JOIN quadrats q ON q.QuadratID = s.QuadratID AND q.IsActive IS TRUE
         WHERE cm.IsActive IS TRUE
           AND cm.RawPlotX IS NOT NULL AND cm.RawPlotY IS NOT NULL
           AND s.LocalX IS NOT NULL AND s.LocalY IS NOT NULL
           AND q.StartX IS NOT NULL AND q.StartY IS NOT NULL
           AND q.QuadratName = ? AND q.PlotID = ? AND cm.CensusID = ?`,
        [quadratName, plotID, censusID]
      );
      return Number(rows[0].cnt);
    }

    /** Reads the validation-19 measurement_error_log link for one
     * CoreMeasurementID, if one exists. Used to observe the resolve/re-open
     * transition directly (IsResolved + ResolvedAt) rather than only the
     * unresolved count, which cleanupTestMeasurements' beforeEach DELETE FROM
     * measurement_error_log would make trivially true for either an
     * always-inserting or an always-resolving implementation. */
    async function fetchValidation19Link(coreMeasurementID: number): Promise<{ isResolved: boolean; resolvedAt: Date | null } | null> {
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT l.IsResolved, l.ResolvedAt
         FROM measurement_error_log l
         JOIN measurement_errors me ON me.ErrorID = l.ErrorID
         WHERE me.ErrorSource = 'validation' AND me.ErrorCode = '19' AND l.MeasurementID = ?`,
        [coreMeasurementID]
      );
      if (rows.length === 0) return null;
      return { isResolved: Boolean(rows[0].IsResolved), resolvedAt: rows[0].ResolvedAt };
    }

    it('does not flag a quadrat whose rows share a constant non-zero offset', async () => {
      // Mirrors Cooks Branch: nominal origins, every row offset by the same 1.5 m.
      for (let i = 1; i <= 10; i++) {
        await insertResolvedStem({ quadrat: 'A01', startX: 0, startY: 0, localX: i, localY: i, plotX: i + 1.5, plotY: i + 1.5 });
      }
      await runValidation19();
      expect(await validation19Count(), 'a constant offset is the quadrat baseline, not an error').toBe(0);
    });

    it('flags exactly the row displaced by a quadrat width', async () => {
      for (let i = 1; i <= 10; i++) {
        await insertResolvedStem({ quadrat: 'B02', startX: 20, startY: 20, localX: i, localY: i, plotX: 20 + i + 1.5, plotY: 20 + i + 1.5 });
      }
      await insertResolvedStem({
        quadrat: 'B02',
        startX: 20,
        startY: 20,
        localX: 5,
        localY: 5,
        plotX: 20 + 5 + 1.5 + 20,
        plotY: 20 + 5 + 1.5,
        tag: 'BAD'
      });
      await runValidation19();
      const flagged = await flaggedTags();
      expect(flagged, 'only the displaced row').toEqual(['BAD']);
    });

    it('clears the stale link on re-run after correction, and re-opens the SAME link on regression', async () => {
      // Same displaced-row shape as above: nine rows at a constant 1.5 m
      // offset establish the quadrat baseline, one row is off by a quadrat
      // width. This test's point is the transition across two CALLs on the
      // same connection, not the flagging itself (covered above).
      const GOOD_OFFSET = 1.5;
      for (let i = 1; i <= 9; i++) {
        await insertResolvedStem({ quadrat: 'G07', startX: 20, startY: 20, localX: i, localY: i, plotX: 20 + i + GOOD_OFFSET, plotY: 20 + i + GOOD_OFFSET });
      }
      const bad = await insertResolvedStem({
        quadrat: 'G07',
        startX: 20,
        startY: 20,
        localX: 5,
        localY: 5,
        plotX: 20 + 5 + GOOD_OFFSET + 20,
        plotY: 20 + 5 + GOOD_OFFSET,
        tag: 'BAD'
      });

      await runValidation19();
      let link = await fetchValidation19Link(bad.coreMeasurementID);
      expect(link, 'the displaced row must be linked after the first run').not.toBeNull();
      expect(link!.isResolved, 'a fresh link starts unresolved').toBe(false);
      expect(link!.resolvedAt, 'a fresh link has no ResolvedAt').toBeNull();

      // Correct the row to the quadrat's established offset, then re-run the
      // SAME procedure on the SAME connection — this is the actual behavior
      // under review: does the stale-clear UPDATE resolve the existing link?
      await connection.query(`UPDATE coremeasurements SET RawPlotX = ?, RawPlotY = ? WHERE CoreMeasurementID = ?`, [
        20 + 5 + GOOD_OFFSET,
        20 + 5 + GOOD_OFFSET,
        bad.coreMeasurementID
      ]);
      await runValidation19();

      link = await fetchValidation19Link(bad.coreMeasurementID);
      expect(link, 'the link row must persist (resolved, not deleted) after correction').not.toBeNull();
      expect(link!.isResolved, 'the link must resolve once the row matches the quadrat median').toBe(true);
      expect(link!.resolvedAt, 'ResolvedAt must be stamped when the link resolves').not.toBeNull();

      // Regress the same row and re-run again: the upsert must re-open the
      // SAME (MeasurementID, ErrorID) link rather than leaving it stuck resolved.
      await connection.query(`UPDATE coremeasurements SET RawPlotX = ?, RawPlotY = ? WHERE CoreMeasurementID = ?`, [
        20 + 5 + GOOD_OFFSET + 20,
        20 + 5 + GOOD_OFFSET,
        bad.coreMeasurementID
      ]);
      await runValidation19();

      link = await fetchValidation19Link(bad.coreMeasurementID);
      expect(link, 'the link row must still exist after regressing').not.toBeNull();
      expect(link!.isResolved, 'a regression must re-open the same link').toBe(false);
      expect(link!.resolvedAt, 'ResolvedAt must be cleared when the link re-opens').toBeNull();
    });

    it('skips a quadrat with fewer than three contributors', async () => {
      await insertResolvedStem({ quadrat: 'C03', startX: 40, startY: 40, localX: 1, localY: 1, plotX: 999, plotY: 999 });
      await insertResolvedStem({ quadrat: 'C03', startX: 40, startY: 40, localX: 2, localY: 2, plotX: 42, plotY: 42 });
      await runValidation19();
      expect(await validation19Count(), 'two rows cannot establish a baseline').toBe(0);
    });

    it('produces the same result in centimetres as in metres', async () => {
      await setPlotUnits('cm');
      // Same geometry, expressed in cm: offsets scale by 100.
      for (let i = 1; i <= 10; i++) {
        await insertResolvedStem({ quadrat: 'A01', startX: 0, startY: 0, localX: i * 100, localY: i * 100, plotX: i * 100 + 150, plotY: i * 100 + 150 });
      }
      await runValidation19();
      expect(await validation19Count()).toBe(0);
    });

    it('fails loudly on unknown dimension units', async () => {
      // plots.DefaultDimensionUnits is NOT NULL under this schema's strict SQL
      // mode, so an UPDATE ... = NULL is itself rejected before it ever
      // reaches the procedure. Assigning NULL under a relaxed session mode is
      // the only way to reach an actually-unrecognized value: MySQL silently
      // coerces it to the enum's implicit blank ('') rather than storing NULL,
      // which exercises the exact same "unrecognized unit" branch in the
      // procedure's CASE/ELSE as a genuine NULL would (v_scale ends up NULL
      // either way) — the SIGNAL fires from the same v_scale IS NULL check.
      const [[{ sqlMode: originalSqlMode }]] = (await connection.query(`SELECT @@SESSION.sql_mode AS sqlMode`)) as unknown as [RowDataPacket[]];
      await connection.query(`SET SESSION sql_mode = ''`);
      try {
        await connection.query(`UPDATE plots SET DefaultDimensionUnits = NULL WHERE PlotID = ?`, [plotID]);
      } finally {
        await connection.query(`SET SESSION sql_mode = ?`, [originalSqlMode]);
      }

      await expect(runValidation19()).rejects.toThrow(/dimension unit/i);
    });

    it('does not substitute canonical stem coordinates for a missing raw upload axis', async () => {
      await insertResolvedStem({ quadrat: 'D04', rawPlotX: null, rawPlotY: null, stemPlotX: 10, stemPlotY: 10 });
      await insertResolvedStem({ quadrat: 'D04', rawPlotX: 20, rawPlotY: 20, stemPlotX: 20, stemPlotY: 20 });
      await insertResolvedStem({ quadrat: 'D04', rawPlotX: 21, rawPlotY: 21, stemPlotX: 21, stemPlotY: 21 });
      await runValidation19();
      expect(await contributorCount('D04'), 'only rows that supplied both raw axes contribute').toBe(2);
      expect(await validation19Count()).toBe(0); // fewer than three actual contributors
    });

    it('computes X and Y medians independently when their rank sets do not intersect', async () => {
      // Anti-correlated offsets make the X-middle and Y-middle positions belong to different rows.
      await insertOffsets('E05', [
        { tag: 'A', x: 0, y: 40 },
        { tag: 'B', x: 10, y: 30 },
        { tag: 'C', x: 20, y: 0 },
        { tag: 'D', x: 30, y: 20 },
        { tag: 'E', x: 40, y: 10 }
      ]);
      await runValidation19();
      expect(await flaggedTags(), 'an empty X/Y rank intersection must not erase the quadrat median').toEqual(['A', 'B', 'C', 'D', 'E']);
    });

    it('cleans up both temp tables and re-signals the original error, so a retry is never blocked', async () => {
      // Real content in the temp tables at the moment of failure — not just an
      // empty CTAS — so this proves the handler actually cleaned up state, not
      // that there was never anything to clean.
      await insertResolvedStem({ quadrat: 'F06', startX: 0, startY: 0, localX: 1, localY: 1, plotX: 1, plotY: 1 });
      await insertResolvedStem({ quadrat: 'F06', startX: 0, startY: 0, localX: 2, localY: 2, plotX: 2, plotY: 2 });
      await insertResolvedStem({ quadrat: 'F06', startX: 0, startY: 0, localX: 3, localY: 3, plotX: 3, plotY: 3 });

      await connection.query('RENAME TABLE measurement_error_log TO measurement_error_log_renamed_for_test');
      try {
        // The offsets/medians temp tables are built successfully; only the
        // final INSERT INTO measurement_error_log fails, inside the
        // procedure's EXIT HANDLER FOR SQLEXCEPTION.
        await expect(runValidation19()).rejects.toThrow(/measurement_error_log/i);
      } finally {
        await connection.query('RENAME TABLE measurement_error_log_renamed_for_test TO measurement_error_log');
      }

      // Succeeds only if the handler dropped both temp tables before
      // RESIGNAL-ing: CREATE TEMPORARY TABLE with no IF EXISTS/DROP first
      // fails outright if a same-named temp table from the failed CALL is
      // still open on this connection.
      await connection.query('CREATE TEMPORARY TABLE plot_coord_offsets (probe INT)');
      await connection.query('CREATE TEMPORARY TABLE plot_coord_medians (probe INT)');
      await connection.query('DROP TEMPORARY TABLE plot_coord_offsets');
      await connection.query('DROP TEMPORARY TABLE plot_coord_medians');
    });
  });
});
