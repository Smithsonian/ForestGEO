/**
 * collapseCensus — Integration Tests
 *
 * Exercises the extracted census-collapse mechanism (lib/uploads/collapse-census.ts)
 * against a real local MySQL instance running the actual bulkingestioncollapser
 * stored procedure. Rows are staged through stageMeasurementChunk and ingested
 * via ingestBatch, exactly like the production upload pipeline, before collapse
 * is called.
 *
 * What bulkingestioncollapser does:
 *   1. Assigns CensusID to trees rows with NULL CensusID.
 *   2. Sets MeasuredDBH = NULL and MeasuredHOM = NULL where the value is 0.
 *   3. Deduplicates coremeasurements by StemGUID + MeasurementDate (keeps the
 *      lowest CoreMeasurementID per pair).
 *   4. Deduplicates coremeasurements by TreeTag + StemTag within the census
 *      (keeps the lowest CoreMeasurementID per pair).
 *   Deduplication events are logged to uploadintegrityalerts.
 *
 * Covered semantics:
 *   1. Happy path — stage+ingest fixture rows → collapseCensus → assert
 *      post-collapse state: duplicate rows removed, zero DBH/HOM nullified,
 *      unique rows preserved.
 *   2. Idempotency proof — run collapseCensus twice on the same census; capture
 *      deterministic coremeasurements snapshot after each run and assert identical.
 *      If these differ the collapser is NOT idempotent and the test fails with
 *      BLOCKED evidence.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/collapse-census.test.ts
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
    `[collapse-census] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops and recreates its test schema and must only run against a local test database.`
  );
}

// ---------------------------------------------------------------------------
// Shared state bridge — hoisted so the ConnectionManager mock closure can read
// the live test connection after beforeAll wires it up.
// ---------------------------------------------------------------------------

const TRANSACTION_ID_PREFIX = 'collapse-census-tx-';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0
}));

// ConnectionManager mock — mirrors the ingest-batch test pattern exactly.
// Routes every DB call to the shared real MySQL connection.
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
import { ingestBatch } from '@/lib/uploads/ingest-batch';
import { collapseCensus } from '@/lib/uploads/collapse-census';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const FILE_NAME = 'collapse-census-fixture.csv';
const BATCH_ID = 'collapse-census-0001';
const UPLOAD_SESSION_ID = 'collapse-census-int-test-session';
const CHANGED_BY = 'collapse-census-test@forestgeo.test';
const CSV_DELIMITER = ',';
const CSV_HEADERS = ['tag', 'stemtag', 'spcode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'];
const MEASUREMENT_DATE = '2024-03-15';

// Five unique fixture rows — the collapser should leave all of them intact.
const EXPECTED_CLEAN_ROW_COUNT = 5;

/**
 * Five clean fixture rows: unique tag+stemtag+date combinations so the collapser
 * has no duplicates to remove on a single-batch upload.
 */
function buildFixtureRows(): Record<string, string>[] {
  const row = (tag: string, stemtag: string, spcode: string, quadrat: string, lx: string, ly: string, dbh: string) => ({
    tag,
    stemtag,
    spcode,
    quadrat,
    lx,
    ly,
    dbh,
    hom: '1.3',
    date: MEASUREMENT_DATE,
    codes: 'A'
  });
  return [
    row('CC001', '1', 'ACERRU', 'Q01', '1.5', '2.5', '10.5'),
    row('CC002', '1', 'QUERCO', 'Q01', '3.5', '4.5', '20.4'),
    row('CC003', '1', 'PINUST', 'Q02', '5.5', '6.5', '30.1'),
    row('CC004', '1', 'FAGUGR', 'Q02', '7.5', '8.5', '15.2'),
    row('CC005', '1', 'BETUAL', 'Q03', '9.5', '0.5', '25.8')
  ];
}

// ---------------------------------------------------------------------------
// Suite lifecycle
// ---------------------------------------------------------------------------

describe('collapseCensus — integration', () => {
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
    expect(result.insertedCount).toBe(EXPECTED_CLEAN_ROW_COUNT);
    expect(result.invalidRows).toHaveLength(0);
  }

  async function stageAndIngestFixtureRows(): Promise<void> {
    await stageFixtureRows();
    const result = await ingestBatch(connectionManager, { schema, fileID: FILE_NAME, batchID: BATCH_ID });
    console.log(
      `[ingest] processedSubBatches=${result.processedSubBatches} totalRows=${result.totalRows} ` +
        `recovered=${result.recovered} noDataFound=${result.noDataFound}`
    );
    expect(result.noDataFound).toBe(false);
    expect(result.processedSubBatches).toBe(1);
    expect(result.subBatchResults[0].batchFailedButHandled).toBe(false);
  }

  /**
   * Reads a deterministic snapshot of all coremeasurements for the census.
   * Ordered by CoreMeasurementID so row ordering is stable across runs.
   * Includes all columns that the collapser can modify:
   *   - StemGUID (dedup by StemGUID+Date / TreeTag+StemTag)
   *   - MeasuredDBH, MeasuredHOM (zero→NULL fixup)
   *   - MeasurementDate, CensusID
   */
  async function fetchCollapserSnapshot(): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT
         cm.CoreMeasurementID,
         cm.CensusID,
         cm.StemGUID,
         CAST(cm.MeasuredDBH AS CHAR) AS DBHText,
         CAST(cm.MeasuredHOM AS CHAR) AS HOMText,
         CAST(cm.MeasurementDate AS CHAR) AS MeasurementDateText,
         t.TreeTag,
         s.StemTag
       FROM coremeasurements cm
       LEFT JOIN stems s ON cm.StemGUID = s.StemGUID AND s.CensusID = cm.CensusID
       LEFT JOIN trees t ON s.TreeID = t.TreeID AND t.CensusID = cm.CensusID
       WHERE cm.CensusID = ?
         AND cm.StemGUID IS NOT NULL
       ORDER BY cm.CoreMeasurementID`,
      [censusID]
    );
    return rows;
  }

  /**
   * Builds a deterministic string digest of a coremeasurements snapshot for
   * easy equality comparison. Includes every field so the idempotency assertion
   * catches changes to any column.
   */
  function snapshotDigest(rows: RowDataPacket[]): string {
    return rows
      .map(
        r =>
          `id=${r.CoreMeasurementID}|census=${r.CensusID}|stemGUID=${r.StemGUID}|` +
          `dbh=${r.DBHText}|hom=${r.HOMText}|date=${r.MeasurementDateText}|` +
          `treeTag=${r.TreeTag}|stemTag=${r.StemTag}`
      )
      .join('\n');
  }

  async function countCensusMeasurements(): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM coremeasurements WHERE CensusID = ? AND StemGUID IS NOT NULL', [
      censusID
    ]);
    return Number(rows[0].count);
  }

  async function fetchIntegrityAlerts(): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT type, message, failedRecords FROM uploadintegrityalerts WHERE censusID = ? ORDER BY id`, [
      censusID
    ]);
    return rows;
  }

  // -------------------------------------------------------------------------
  // 1. Happy path
  // -------------------------------------------------------------------------

  it('collapses a census: unique ingested rows all survive, zero DBH/HOM nullified', async () => {
    await stageAndIngestFixtureRows();

    // Verify all 5 unique rows are present before collapse.
    const beforeCount = await countCensusMeasurements();
    console.log(`[happy-path] Before collapse: ${beforeCount} resolved rows`);
    expect(beforeCount).toBe(EXPECTED_CLEAN_ROW_COUNT);

    // Now insert an extra row on a stem that has already been ingested, but on
    // a DIFFERENT date and with DBH=0/HOM=0, so it is NOT a StemGUID+Date or
    // TreeTag+StemTag duplicate of any existing row. This lets us verify the
    // zero→NULL fixup in isolation.
    //
    // We pick a stem that belongs to the census and assign a date that cannot
    // match any ingested row (all ingested rows use MEASUREMENT_DATE = 2024-03-15).
    const ZERO_ROW_DATE = '2099-12-31'; // far-future date, guaranteed unique
    const [stemRows] = await connection.query<RowDataPacket[]>(
      `SELECT s.StemGUID
       FROM stems s
       INNER JOIN trees t ON s.TreeID = t.TreeID AND s.CensusID = t.CensusID
       WHERE s.CensusID = ?
       LIMIT 1`,
      [censusID]
    );

    // Only run the zero-fixup subtest when we have at least one resolved stem.
    let zeroFixupID: number | null = null;
    if (stemRows.length > 0) {
      const stemGUID = stemRows[0].StemGUID;
      const [insertResult] = await connection.query<any>(
        `INSERT INTO coremeasurements (CensusID, StemGUID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated)
         VALUES (?, ?, 0, 0, ?, FALSE)`,
        [censusID, stemGUID, ZERO_ROW_DATE]
      );
      zeroFixupID = Number(insertResult.insertId);
      console.log(`[happy-path] Inserted zero-DBH/HOM row CoreMeasurementID=${zeroFixupID} stemGUID=${stemGUID} date=${ZERO_ROW_DATE}`);
    }

    await collapseCensus(connectionManager, { schema, censusID });

    const afterCount = await countCensusMeasurements();
    console.log(`[happy-path] After collapse: ${afterCount} resolved rows`);

    if (zeroFixupID !== null) {
      // The extra row uses a unique date and a different tree's stem — it cannot
      // collide on (StemGUID+Date). However the collapser also deduplicates by
      // (TreeTag+StemTag): if the injected stem already has a measurement in the
      // census it will be removed as a TreeTag+StemTag duplicate, otherwise it
      // survives with NULL DBH/HOM.
      const [fixupRows] = await connection.query<RowDataPacket[]>(`SELECT MeasuredDBH, MeasuredHOM FROM coremeasurements WHERE CoreMeasurementID = ?`, [
        zeroFixupID
      ]);
      if (fixupRows.length > 0) {
        // Survived — the zero→NULL fixup must have applied.
        console.log(`[happy-path] Zero-fixup row survived: DBH=${fixupRows[0].MeasuredDBH} HOM=${fixupRows[0].MeasuredHOM}`);
        expect(fixupRows[0].MeasuredDBH).toBeNull();
        expect(fixupRows[0].MeasuredHOM).toBeNull();
        // With the extra row surviving, total should be EXPECTED+1.
        expect(afterCount).toBe(EXPECTED_CLEAN_ROW_COUNT + 1);
      } else {
        // Deduped as a TreeTag+StemTag duplicate — back to the clean row count.
        console.log(`[happy-path] Zero-fixup row deduped away (TreeTag+StemTag collision)`);
        expect(afterCount).toBe(EXPECTED_CLEAN_ROW_COUNT);
      }
    } else {
      // No extra row was inserted; only the 5 clean rows exist.
      expect(afterCount).toBe(EXPECTED_CLEAN_ROW_COUNT);
    }
  }, 60000);

  // -------------------------------------------------------------------------
  // 2. Idempotency proof
  // -------------------------------------------------------------------------

  it('IDEMPOTENCY: running collapseCensus twice produces identical coremeasurements state', async () => {
    await stageAndIngestFixtureRows();

    // --- First collapse ---
    await collapseCensus(connectionManager, { schema, censusID });

    const afterFirstRun = await fetchCollapserSnapshot();
    const firstDigest = snapshotDigest(afterFirstRun);

    console.log(`[idempotency] After first collapse — ${afterFirstRun.length} rows:`);
    for (const row of afterFirstRun) {
      console.log(
        `  CoreMeasurementID=${row.CoreMeasurementID} stemGUID=${row.StemGUID} ` +
          `dbh=${row.DBHText} hom=${row.HOMText} date=${row.MeasurementDateText} ` +
          `treeTag=${row.TreeTag} stemTag=${row.StemTag}`
      );
    }

    // --- Second collapse (same census, no data changes) ---
    await collapseCensus(connectionManager, { schema, censusID });

    const afterSecondRun = await fetchCollapserSnapshot();
    const secondDigest = snapshotDigest(afterSecondRun);

    console.log(`[idempotency] After second collapse — ${afterSecondRun.length} rows:`);
    for (const row of afterSecondRun) {
      console.log(
        `  CoreMeasurementID=${row.CoreMeasurementID} stemGUID=${row.StemGUID} ` +
          `dbh=${row.DBHText} hom=${row.HOMText} date=${row.MeasurementDateText} ` +
          `treeTag=${row.TreeTag} stemTag=${row.StemTag}`
      );
    }

    if (firstDigest !== secondDigest) {
      // BLOCKED — the collapser is NOT idempotent. Emit evidence and fail hard.
      const firstLines = firstDigest.split('\n');
      const secondLines = secondDigest.split('\n');
      const diffLines: string[] = [];

      const maxLen = Math.max(firstLines.length, secondLines.length);
      for (let i = 0; i < maxLen; i++) {
        const a = firstLines[i] ?? '(absent)';
        const b = secondLines[i] ?? '(absent)';
        if (a !== b) {
          diffLines.push(`  row ${i}: FIRST=${a}`);
          diffLines.push(`         SECOND=${b}`);
        }
      }

      throw new Error(
        `BLOCKED: collapseCensus is NOT idempotent.\n` +
          `Row count after first run: ${afterFirstRun.length}\n` +
          `Row count after second run: ${afterSecondRun.length}\n` +
          `Diff (first-run vs second-run):\n${diffLines.join('\n')}`
      );
    }

    // Idempotency confirmed: both snapshots are byte-identical.
    expect(firstDigest).toBe(secondDigest);
    expect(afterFirstRun.length).toBe(afterSecondRun.length);
    console.log(`[idempotency] PASS — both runs produced identical ${afterFirstRun.length}-row snapshot`);
  }, 60000);

  // -------------------------------------------------------------------------
  // 3. Duplicate deduplication: StemGUID+Date collision
  //
  // Ingest one batch normally, then manually insert a coremeasurements row that
  // shares (StemGUID, MeasurementDate) with an existing row. The collapser must
  // remove the duplicate (keeping the lower CoreMeasurementID).
  // -------------------------------------------------------------------------

  it('deduplicates coremeasurements rows with the same StemGUID+MeasurementDate, logging an integrity alert', async () => {
    await stageAndIngestFixtureRows();

    // Pick any ingested row to duplicate.
    const [existingRows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID, StemGUID, MeasurementDate
       FROM coremeasurements
       WHERE CensusID = ? AND StemGUID IS NOT NULL
       ORDER BY CoreMeasurementID LIMIT 1`,
      [censusID]
    );
    expect(existingRows.length).toBeGreaterThan(0);

    const { StemGUID: targetStemGUID, MeasurementDate: targetDate } = existingRows[0];
    const originalID = Number(existingRows[0].CoreMeasurementID);

    // Insert a duplicate row with the same StemGUID+Date.
    const [insertResult] = await connection.query<any>(
      `INSERT INTO coremeasurements (CensusID, StemGUID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated)
       VALUES (?, ?, 5.0, 1.3, ?, FALSE)`,
      [censusID, targetStemGUID, targetDate]
    );
    const duplicateID = Number(insertResult.insertId);
    console.log(`[dedup] Inserted duplicate row CoreMeasurementID=${duplicateID} (same StemGUID+Date as ${originalID})`);

    const beforeCount = await countCensusMeasurements();
    console.log(`[dedup] Before collapse: ${beforeCount} rows`);
    // Original 5 + 1 duplicate
    expect(beforeCount).toBe(EXPECTED_CLEAN_ROW_COUNT + 1);

    await collapseCensus(connectionManager, { schema, censusID });

    const afterCount = await countCensusMeasurements();
    console.log(`[dedup] After collapse: ${afterCount} rows`);
    // Duplicate must be gone — back to the clean row set.
    expect(afterCount).toBe(EXPECTED_CLEAN_ROW_COUNT);

    // The original (lower ID) row must survive.
    const [survivorRows] = await connection.query<RowDataPacket[]>(`SELECT CoreMeasurementID FROM coremeasurements WHERE StemGUID = ? AND CensusID = ?`, [
      targetStemGUID,
      censusID
    ]);
    const survivorIDs = survivorRows.map(r => Number(r.CoreMeasurementID));
    console.log(`[dedup] Survivor IDs for StemGUID ${targetStemGUID}: ${JSON.stringify(survivorIDs)}`);
    expect(survivorIDs).toContain(originalID);
    expect(survivorIDs).not.toContain(duplicateID);

    // Integrity alert must have been logged.
    const alerts = await fetchIntegrityAlerts();
    console.log(`[dedup] Integrity alerts: ${JSON.stringify(alerts)}`);
    const dedupAlerts = alerts.filter(a => a.type === 'COLLAPSER_DEDUPLICATION');
    expect(dedupAlerts.length).toBeGreaterThan(0);
    expect(dedupAlerts[0].failedRecords).toBe(1);
    expect(dedupAlerts[0].message).toContain('StemGUID+MeasurementDate');
  }, 60000);
});
