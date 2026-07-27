/**
 * ingestBatch — Integration Tests
 *
 * Exercises the extracted batch-ingestion mechanism (lib/uploads/ingest-batch.ts)
 * against a real local MySQL instance running the actual bulkingestionprocess
 * stored procedure. Rows are staged through the shared stageMeasurementChunk
 * mechanism, exactly like the production upload pipeline.
 *
 * Covered semantics:
 *   1. Happy path — staged rows ingest into coremeasurements with upload
 *      tracking columns, uploadmetrics lands at status='completed', and
 *      temporarymeasurements drains.
 *   2. Idempotent skip — re-running the same file/batch after completion is a
 *      no-op: the procedure's uploadmetrics 'completed' check skips re-ingestion
 *      and drains the re-staged rows (CoreMeasurementIDs unchanged).
 *   3. Stale-state recovery (first census) — a batch stuck at
 *      status='processing' with no completed uploads triggers the
 *      failed-initial-census recovery preflight, wiping the dirty state before
 *      a clean re-ingest.
 *   4. Stale-state self-heal (procedure branch) — when recovery preflight is
 *      not applicable (another completed upload exists for the census), the
 *      procedure itself deletes the partial rows for the stale batch and
 *      re-ingests cleanly.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/ingest-batch.test.ts
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
    `[ingest-batch] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops and recreates its test schema and must only run against a local test database.`
  );
}

// ---------------------------------------------------------------------------
// Shared state bridge — hoisted so the ConnectionManager mock closure can read
// the live test connection after beforeAll wires it up.
// ---------------------------------------------------------------------------

const TRANSACTION_ID_PREFIX = 'ingest-batch-tx-';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0
}));

// ConnectionManager mock — routes every DB call (including the stored procedure
// CALL, withTransaction, and GET_LOCK application locking) to the shared real
// MySQL connection so the production sequence runs against real MySQL state.
vi.mock('@/config/connectionmanager', () => {
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

import ConnectionManager from '@/config/connectionmanager';
import { stageMeasurementChunk, type StageMeasurementChunkParams } from '@/lib/uploads/stage-measurements';
import { ingestBatch, IngestBatchAbortedError, type IngestBatchResult } from '@/lib/uploads/ingest-batch';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const FILE_NAME = 'ingest-batch-fixture.csv';
const BATCH_ID = 'ingest-batch-0001';
const UPLOAD_SESSION_ID = 'ingest-batch-int-test-session';
const CHANGED_BY = 'ingest-batch-test@forestgeo.test';
const CSV_DELIMITER = ',';
const CSV_HEADERS = ['tag', 'stemtag', 'spcode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'];
const MEASUREMENT_DATE = '2024-03-15';

const EXPECTED_ROW_COUNT = 5;

const UPLOADMETRICS_STATUS_COMPLETED = 'completed';
const UPLOADMETRICS_STATUS_PROCESSING = 'processing';

/**
 * Five clean fixture rows: valid species, quadrats, attribute codes, and dates
 * inside the seeded census window — the procedure should ingest all of them.
 */
function buildFixtureRows(): Record<string, string>[] {
  const row = (tag: string, stemtag: string, spcode: string, quadrat: string, lx: string, ly: string, dbh: string, codes: string) => ({
    tag,
    stemtag,
    spcode,
    quadrat,
    lx,
    ly,
    dbh,
    hom: '1.3',
    date: MEASUREMENT_DATE,
    codes
  });
  return [
    row('IB001', '1', 'ACERRU', 'Q01', '1.5', '2.5', '10.5', 'A'),
    row('IB002', '1', 'QUERCO', 'Q01', '3.5', '4.5', '20.4', 'A;R'),
    row('IB003', '1', 'PINUST', 'Q02', '5.5', '6.5', '30.1', 'A'),
    row('IB004', '1', 'FAGUGR', 'Q02', '7.5', '8.5', '15.2', 'A'),
    row('IB005', '1', 'BETUAL', 'Q03', '9.5', '0.5', '25.8', 'A')
  ];
}

// ---------------------------------------------------------------------------
// Suite lifecycle
// ---------------------------------------------------------------------------

describe('ingestBatch — integration', () => {
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

  async function stageFixtureRows(): Promise<void> {
    const transactionID = await connectionManager.beginTransaction();
    const params: StageMeasurementChunkParams = {
      schema,
      fileName: FILE_NAME,
      batchID: BATCH_ID,
      plotID,
      censusID,
      uploadMode: UploadMode.CLEAN_REUPLOAD,
      sourceFormat: SourceFormat.csv,
      rawRows: buildFixtureRows(),
      csvHeaders: CSV_HEADERS,
      delimiter: CSV_DELIMITER,
      uploadSessionID: UPLOAD_SESSION_ID,
      transactionID,
      changedBy: CHANGED_BY
    };
    const result = await stageMeasurementChunk(connectionManager, params);
    await connectionManager.commitTransaction(transactionID);
    console.log(`[stage] insertedCount=${result.insertedCount} invalidRows=${result.invalidRows.length} droppedCount=${result.droppedCount}`);
    expect(result.insertedCount).toBe(EXPECTED_ROW_COUNT);
    expect(result.invalidRows).toHaveLength(0);
  }

  async function runIngestBatch(): Promise<IngestBatchResult> {
    const result = await ingestBatch(connectionManager, { schema, fileID: FILE_NAME, batchID: BATCH_ID });
    console.log(
      `[ingestBatch] processedSubBatches=${result.processedSubBatches} totalRows=${result.totalRows} recovered=${result.recovered} ` +
        `noDataFound=${result.noDataFound} totalDurationMs=${result.totalDurationMs}`
    );
    for (const sub of result.subBatchResults) {
      console.log(
        `[ingestBatch] sub-batch ${sub.subBatchID}: attempts=${sub.attemptsNeeded} failedButHandled=${sub.batchFailedButHandled} message=${sub.message}`
      );
    }
    return result;
  }

  async function fetchBatchMeasurements(): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID, StemGUID, CensusID, UploadFileID, UploadBatchID,
              CAST(MeasuredDBH AS CHAR) AS DBHText, CAST(MeasurementDate AS CHAR) AS MeasurementDateText
       FROM coremeasurements
       WHERE UploadFileID = ? AND UploadBatchID = ?
       ORDER BY CoreMeasurementID`,
      [FILE_NAME, BATCH_ID]
    );
    return rows;
  }

  async function fetchUploadMetrics(): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT uploadId, fileID, batchID, status, sourceRecords, processedRecords, failedRecords FROM uploadmetrics WHERE batchID = ? ORDER BY id',
      [BATCH_ID]
    );
    return rows;
  }

  async function countTemporaryRows(): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM temporarymeasurements WHERE FileID = ? AND BatchID = ?', [
      FILE_NAME,
      BATCH_ID
    ]);
    return Number(rows[0].count);
  }

  async function countCensusMeasurements(): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM coremeasurements WHERE CensusID = ?', [censusID]);
    return Number(rows[0].count);
  }

  function assertCleanRowSet(measurements: RowDataPacket[]): void {
    expect(measurements).toHaveLength(EXPECTED_ROW_COUNT);
    for (const row of measurements) {
      console.log(
        `[db row] CoreMeasurementID=${row.CoreMeasurementID} StemGUID=${row.StemGUID} DBH=${row.DBHText} Date=${row.MeasurementDateText} ` +
          `UploadFileID=${row.UploadFileID} UploadBatchID=${row.UploadBatchID}`
      );
      expect(row.StemGUID).not.toBeNull(); // StemGUID=NULL would mean a failed/unresolved row
      expect(row.UploadFileID).toBe(FILE_NAME);
      expect(row.UploadBatchID).toBe(BATCH_ID);
      expect(row.CensusID).toBe(censusID);
    }
  }

  // -------------------------------------------------------------------------
  // 1. Happy path
  // -------------------------------------------------------------------------

  it('ingests staged rows through the real bulkingestionprocess into coremeasurements', async () => {
    await stageFixtureRows();

    const result = await runIngestBatch();

    expect(result.noDataFound).toBe(false);
    expect(result.recovered).toBe(false);
    expect(result.processedSubBatches).toBe(1);
    expect(result.totalRows).toBe(EXPECTED_ROW_COUNT);
    expect(result.subBatchResults).toHaveLength(1);
    expect(result.subBatchResults[0].subBatchID).toBe(BATCH_ID); // 5 rows ≪ 10K: no sub-batch split
    expect(result.subBatchResults[0].attemptsNeeded).toBe(1);
    expect(result.subBatchResults[0].batchFailedButHandled).toBe(false);

    const measurements = await fetchBatchMeasurements();
    assertCleanRowSet(measurements);

    const metrics = await fetchUploadMetrics();
    console.log(`[uploadmetrics] ${JSON.stringify(metrics)}`);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].status).toBe(UPLOADMETRICS_STATUS_COMPLETED);
    expect(Number(metrics[0].sourceRecords)).toBe(EXPECTED_ROW_COUNT);
    expect(Number(metrics[0].failedRecords)).toBe(0);

    const remainingTemp = await countTemporaryRows();
    console.log(`[temporarymeasurements] remaining=${remainingTemp}`);
    expect(remainingTemp).toBe(0);
  }, 60000);

  // -------------------------------------------------------------------------
  // 2. Idempotent skip via uploadmetrics 'completed'
  // -------------------------------------------------------------------------

  it('skips re-ingestion of a completed batch: same CoreMeasurementIDs, re-staged rows drained', async () => {
    await stageFixtureRows();
    const firstRun = await runIngestBatch();
    expect(firstRun.subBatchResults[0].batchFailedButHandled).toBe(false);

    const firstMeasurements = await fetchBatchMeasurements();
    assertCleanRowSet(firstMeasurements);
    const firstIDs = firstMeasurements.map(row => Number(row.CoreMeasurementID));
    console.log(`[idempotent] first-run CoreMeasurementIDs=${JSON.stringify(firstIDs)}`);

    // Re-stage the identical rows under the same file/batch, then re-run.
    await stageFixtureRows();
    expect(await countTemporaryRows()).toBe(EXPECTED_ROW_COUNT);

    const secondRun = await runIngestBatch();
    expect(secondRun.noDataFound).toBe(false);
    expect(secondRun.recovered).toBe(false);
    expect(secondRun.processedSubBatches).toBe(1);
    expect(secondRun.subBatchResults[0].batchFailedButHandled).toBe(false);
    // The procedure's uploadmetrics keystone: completed batches are skipped.
    expect(String(secondRun.subBatchResults[0].message)).toContain('already processed, skipped');

    const secondMeasurements = await fetchBatchMeasurements();
    const secondIDs = secondMeasurements.map(row => Number(row.CoreMeasurementID));
    console.log(`[idempotent] second-run CoreMeasurementIDs=${JSON.stringify(secondIDs)}`);
    expect(secondIDs).toEqual(firstIDs); // not just same count — the exact same rows survive

    expect(await countCensusMeasurements()).toBe(EXPECTED_ROW_COUNT);
    expect(await countTemporaryRows()).toBe(0); // skip branch still drains the re-staged rows

    const metrics = await fetchUploadMetrics();
    console.log(`[uploadmetrics] ${JSON.stringify(metrics)}`);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].status).toBe(UPLOADMETRICS_STATUS_COMPLETED);
  }, 60000);

  // -------------------------------------------------------------------------
  // 3. Stale 'processing' state — failed-initial-census recovery preflight
  // -------------------------------------------------------------------------

  it('recovers a stale processing batch on a first census via the recovery preflight (one clean row set)', async () => {
    await stageFixtureRows();
    await runIngestBatch();
    assertCleanRowSet(await fetchBatchMeasurements());

    // Simulate a crash that left the batch stuck mid-processing.
    await connection.query('UPDATE uploadmetrics SET status = ?, endTime = NULL WHERE batchID = ?', [UPLOADMETRICS_STATUS_PROCESSING, BATCH_ID]);
    await stageFixtureRows();

    const result = await runIngestBatch();

    // No completed uploads remain for the census, so the dirty first-load
    // recovery preflight must fire and wipe the residual state.
    expect(result.recovered).toBe(true);
    expect(result.noDataFound).toBe(false);
    expect(result.subBatchResults[0].batchFailedButHandled).toBe(false);

    const measurements = await fetchBatchMeasurements();
    assertCleanRowSet(measurements);
    expect(await countCensusMeasurements()).toBe(EXPECTED_ROW_COUNT); // census-wide: exactly one row set, no duplicates
    expect(await countTemporaryRows()).toBe(0);

    const metrics = await fetchUploadMetrics();
    console.log(`[uploadmetrics] ${JSON.stringify(metrics)}`);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].status).toBe(UPLOADMETRICS_STATUS_COMPLETED);
  }, 60000);

  // -------------------------------------------------------------------------
  // 4. Stale 'processing' state — procedure-level self-heal branch
  // -------------------------------------------------------------------------

  it('self-heals a stale processing batch inside the procedure when recovery preflight does not apply', async () => {
    await stageFixtureRows();
    await runIngestBatch();
    const firstMeasurements = await fetchBatchMeasurements();
    assertCleanRowSet(firstMeasurements);
    const firstIDs = firstMeasurements.map(row => Number(row.CoreMeasurementID));

    await connection.query('UPDATE uploadmetrics SET status = ?, endTime = NULL WHERE batchID = ?', [UPLOADMETRICS_STATUS_PROCESSING, BATCH_ID]);
    await stageFixtureRows();

    // A completed upload from another batch in the same census disables the
    // first-census recovery preflight, forcing the procedure's own stale-state
    // branch (delete partial rows for the batch, reset uploadmetrics, re-ingest).
    await connection.query(
      `INSERT INTO uploadmetrics (uploadId, fileID, batchID, schema_name, plotID, censusID, sourceRecords, status, startTime)
       VALUES ('ingest-batch-dummy-completed', 'some-other-file.csv', 'some-other-batch', ?, ?, ?, 1, ?, NOW())`,
      [schema, plotID, censusID, UPLOADMETRICS_STATUS_COMPLETED]
    );

    const result = await runIngestBatch();

    expect(result.recovered).toBe(false); // preflight must NOT have fired
    expect(result.noDataFound).toBe(false);
    expect(result.subBatchResults[0].batchFailedButHandled).toBe(false);

    const secondMeasurements = await fetchBatchMeasurements();
    assertCleanRowSet(secondMeasurements);
    const secondIDs = secondMeasurements.map(row => Number(row.CoreMeasurementID));
    console.log(`[self-heal] firstIDs=${JSON.stringify(firstIDs)} secondIDs=${JSON.stringify(secondIDs)}`);
    // The stale partial rows were deleted and re-ingested, not skipped.
    expect(secondIDs).not.toEqual(firstIDs);

    expect(await countCensusMeasurements()).toBe(EXPECTED_ROW_COUNT); // exactly one clean row set, no duplicates
    expect(await countTemporaryRows()).toBe(0);

    const metrics = await fetchUploadMetrics();
    console.log(`[uploadmetrics] ${JSON.stringify(metrics)}`);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].status).toBe(UPLOADMETRICS_STATUS_COMPLETED);
  }, 60000);

  // -------------------------------------------------------------------------
  // 5. Between-batches abort: isAborted=true from the start
  //
  // With isAborted returning true immediately, the between-batches check in
  // ingestBatch fires before the first processSubBatch call and throws
  // IngestBatchAbortedError (midBatch=false). Rows stay in temporarymeasurements
  // because the procedure was never called — the caller is expected to retry.
  // -------------------------------------------------------------------------

  it('throws IngestBatchAbortedError and leaves rows staged when abort fires before the first sub-batch', async () => {
    await stageFixtureRows();
    expect(await countTemporaryRows()).toBe(EXPECTED_ROW_COUNT);

    let thrownError: unknown;
    try {
      await ingestBatch(connectionManager, {
        schema,
        fileID: FILE_NAME,
        batchID: BATCH_ID,
        isAborted: () => true
      });
    } catch (err) {
      thrownError = err;
    }

    console.log(`[abort-before] thrownError=${thrownError instanceof Error ? thrownError.message : String(thrownError)}`);
    expect(thrownError).toBeInstanceOf(IngestBatchAbortedError);
    const abortError = thrownError as IngestBatchAbortedError;
    expect(abortError.midBatch).toBe(false); // propagates to caller — not handled internally

    // Staged rows must remain so a retry can resume without data loss.
    const remainingTemp = await countTemporaryRows();
    console.log(`[abort-before] temporarymeasurements remaining=${remainingTemp}`);
    expect(remainingTemp).toBe(EXPECTED_ROW_COUNT);

    // No coremeasurements rows should have been created.
    const [unresolvedRows] = await connection.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NULL',
      [FILE_NAME]
    );
    expect(Number(unresolvedRows[0].count)).toBe(0);
  }, 60000);

  // -------------------------------------------------------------------------
  // 6. Mid-retry abort: isAborted flips to true inside processSubBatch
  //
  // The abort probe returns false on the first call (the between-batches check
  // in ingestBatch) and true on subsequent calls (the per-attempt check inside
  // processSubBatch). With a single sub-batch this means the between-batches
  // guard passes, processSubBatch is entered, and the abort is detected at the
  // top of the retry loop before the procedure is called.
  //
  // Expected outcome: IngestBatchAbortedError (midBatch=true) is caught
  // internally, staged rows are moved to unresolved coremeasurements, and
  // ingestBatch returns normally (no exception propagates to the caller).
  // -------------------------------------------------------------------------

  it('handles a mid-retry abort internally: rows moved to unresolved coremeasurements, no exception propagates', async () => {
    await stageFixtureRows();
    expect(await countTemporaryRows()).toBe(EXPECTED_ROW_COUNT);

    // First call to isAborted: the between-batches guard in ingestBatch (returns false → proceed).
    // All subsequent calls: inside processSubBatch's retry loop (returns true → throw midBatch abort).
    let abortCallCount = 0;
    const isAborted = () => {
      abortCallCount++;
      const shouldAbort = abortCallCount > 1;
      console.log(`[abort-mid] isAborted call #${abortCallCount} → ${shouldAbort}`);
      return shouldAbort;
    };

    const result = await ingestBatch(connectionManager, {
      schema,
      fileID: FILE_NAME,
      batchID: BATCH_ID,
      isAborted
    });

    console.log(
      `[abort-mid] result: processedSubBatches=${result.processedSubBatches} totalRows=${result.totalRows} ` +
        `noDataFound=${result.noDataFound} subBatchResults=${JSON.stringify(result.subBatchResults)}`
    );

    // ingestBatch must return (not throw) — mid-batch abort is handled internally.
    expect(result.noDataFound).toBe(false);
    expect(result.processedSubBatches).toBe(1);
    expect(result.subBatchResults).toHaveLength(1);
    const subResult = result.subBatchResults[0];
    expect(subResult.batchFailedButHandled).toBe(true);
    // rowCount reflects how many rows were moved to unresolved coremeasurements.
    expect(subResult.rowCount).toBe(EXPECTED_ROW_COUNT);
    expect(subResult.message).toContain('unresolved coremeasurements');

    // temporarymeasurements must be drained — rows were moved, not abandoned.
    const remainingTemp = await countTemporaryRows();
    console.log(`[abort-mid] temporarymeasurements remaining=${remainingTemp}`);
    expect(remainingTemp).toBe(0);

    // Rows must have landed in coremeasurements with StemGUID=NULL (unresolved/failed).
    const [unresolvedRows] = await connection.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NULL',
      [FILE_NAME]
    );
    console.log(`[abort-mid] unresolved coremeasurements rows=${unresolvedRows[0].count}`);
    expect(Number(unresolvedRows[0].count)).toBe(EXPECTED_ROW_COUNT);
  }, 60000);
});
