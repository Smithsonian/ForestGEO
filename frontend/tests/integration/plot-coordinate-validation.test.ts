/**
 * Plot-coordinate read-model projection — Integration Tests
 *
 * Proves the Task 9 read-model change: measurementssummary and viewfulltable
 * expose StemPlotX/StemPlotY, preferring the row-level upload snapshot
 * (coremeasurements.RawPlotX/RawPlotY) over the stem's canonical value
 * (stems.PlotX/PlotY) — the deliberate reverse of the StemLocalX/StemLocalY
 * precedence, documented in
 * docs/superpowers/plans/2026-08-26-plot-coordinate-ingest.md (Task 9).
 *
 * Exercises the application-side scoped refresh builders in
 * lib/measurementviewrefresh.ts (refreshMeasurementsSummaryForScope /
 * refreshViewFullTableForScope) — the path validation/upload orchestration
 * actually calls — not the standalone stored procedures.
 *
 * Covered acceptance criteria:
 *   1. Both read models carry StemPlotX/StemPlotY.
 *   2. The value is COALESCE(cm.RawPlotX, stem.PlotX) — the row snapshot wins
 *      even when it disagrees with an already-populated stem.
 *   3. A failed row (StemGUID NULL) still shows its raw plot coordinates.
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
    console.log('[beforeEach] cleared measurement tables + unifiedchangelog + summary views');
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
});
