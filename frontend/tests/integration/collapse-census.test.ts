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
 *   1a. Zero-fixup strict — inject a lone zero-DBH/HOM measurement (the only
 *       row for its stem) → collapseCensus → assert it survives with both fields
 *       IS NULL. No alternate outcome.
 *   1b. TreeTag+StemTag dedup strict — inject a same-tag row with a different
 *       MeasurementDate (bypasses StemGUID+Date dedup) → collapseCensus → assert
 *       the lower-ID original survives, the higher-ID duplicate is deleted, and a
 *       COLLAPSER_DEDUPLICATION alert containing 'same TreeTag+StemTag in census'
 *       is logged.
 *   2. StemGUID+Date dedup — manually insert a coremeasurements row sharing
 *      (StemGUID, MeasurementDate) with an existing row; assert the duplicate is
 *      removed and a COLLAPSER_DEDUPLICATION alert is logged.
 *   3. Idempotency proof — run collapseCensus twice on the same census; capture
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
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT type, message, severity, sourceRecords, processedRecords, failedRecords FROM uploadintegrityalerts WHERE censusID = ? ORDER BY id`,
      [censusID]
    );
    return rows;
  }

  // -------------------------------------------------------------------------
  // 1a. Zero-fixup strict
  //
  // Insert a stem whose ONLY coremeasurement in the census has MeasuredDBH=0
  // and MeasuredHOM=0. Because it uses a date that cannot appear in any ingested
  // row (far-future) AND a distinct StemGUID, it is skipped by both dedup passes.
  // After collapse the row must survive with MeasuredDBH IS NULL and
  // MeasuredHOM IS NULL — no if/else, no alternate outcome.
  // -------------------------------------------------------------------------

  it('zero→NULL fixup: a lone zero-DBH/HOM measurement survives collapse with both fields nullified', async () => {
    await stageAndIngestFixtureRows();

    // Pick the StemGUID of the first ingested stem so we have a valid foreign
    // key. We then DELETE its ingested coremeasurements row and replace it with
    // a zero-valued row on a date the other 4 stems never use. That guarantees
    // this StemGUID has exactly one census measurement and it is zero-valued.
    const ZERO_ROW_DATE = '2099-12-31';

    const [stemRows] = await connection.query<RowDataPacket[]>(
      `SELECT s.StemGUID
       FROM stems s
       WHERE s.CensusID = ?
       ORDER BY s.StemGUID
       LIMIT 1`,
      [censusID]
    );
    expect(stemRows.length).toBeGreaterThan(0);
    const isolatedStemGUID = stemRows[0].StemGUID;

    // Remove the ingested measurement for this stem so it has no prior row in
    // the census. This prevents the TreeTag+StemTag dedup from treating our
    // zero row as the duplicate (the ingested row would be the lower-ID survivor
    // and our zero row the one removed).
    await connection.query(`DELETE FROM coremeasurements WHERE CensusID = ? AND StemGUID = ?`, [censusID, isolatedStemGUID]);

    const [insertResult] = await connection.query<any>(
      `INSERT INTO coremeasurements (CensusID, StemGUID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated)
       VALUES (?, ?, 0, 0, ?, FALSE)`,
      [censusID, isolatedStemGUID, ZERO_ROW_DATE]
    );
    const zeroRowID = Number(insertResult.insertId);
    console.log(`[zero-fixup] Inserted sole zero-DBH/HOM row CoreMeasurementID=${zeroRowID} stemGUID=${isolatedStemGUID} date=${ZERO_ROW_DATE}`);

    // 4 remaining ingested rows + 1 zero row
    const beforeCount = await countCensusMeasurements();
    expect(beforeCount).toBe(EXPECTED_CLEAN_ROW_COUNT);

    await collapseCensus(connectionManager, { schema, censusID });

    // The zero row is the ONLY measurement for its stem — no dedup can remove it.
    const [fixupRows] = await connection.query<RowDataPacket[]>(`SELECT MeasuredDBH, MeasuredHOM FROM coremeasurements WHERE CoreMeasurementID = ?`, [
      zeroRowID
    ]);
    console.log(`[zero-fixup] Post-collapse row: ${JSON.stringify(fixupRows[0] ?? '(absent)')}`);
    expect(fixupRows).toHaveLength(1);
    expect(fixupRows[0].MeasuredDBH).toBeNull();
    expect(fixupRows[0].MeasuredHOM).toBeNull();

    // Total row count stays at EXPECTED_CLEAN_ROW_COUNT: 4 survivors + the zero row (now nullified).
    const afterCount = await countCensusMeasurements();
    expect(afterCount).toBe(EXPECTED_CLEAN_ROW_COUNT);
  }, 60000);

  // -------------------------------------------------------------------------
  // 1b. TreeTag+StemTag dedup strict
  //
  // Ingest the 5 fixture rows normally. Then insert a second coremeasurements
  // row for one of those stems using a DIFFERENT MeasurementDate, so that the
  // StemGUID+Date dedup pass does NOT remove it. The TreeTag+StemTag dedup pass
  // must then remove the higher-ID row (our injected duplicate), keep the
  // lower-ID original, and log a COLLAPSER_DEDUPLICATION alert whose message
  // contains the marker text 'same TreeTag+StemTag in census'.
  // -------------------------------------------------------------------------

  it('TreeTag+StemTag dedup: injected same-tag duplicate (different date) is removed with a COLLAPSER_DEDUPLICATION alert', async () => {
    await stageAndIngestFixtureRows();

    // Pick the lowest-ID ingested measurement so we know which CoreMeasurementID
    // will survive (the procedure keeps the lowest ID per TreeTag+StemTag).
    const [existingRows] = await connection.query<RowDataPacket[]>(
      `SELECT cm.CoreMeasurementID, cm.StemGUID, cm.MeasurementDate, t.TreeTag, s.StemTag
       FROM coremeasurements cm
       INNER JOIN stems s ON cm.StemGUID = s.StemGUID AND s.CensusID = cm.CensusID
       INNER JOIN trees t ON s.TreeID = t.TreeID AND t.CensusID = cm.CensusID
       WHERE cm.CensusID = ? AND cm.StemGUID IS NOT NULL
       ORDER BY cm.CoreMeasurementID
       LIMIT 1`,
      [censusID]
    );
    expect(existingRows.length).toBe(1);

    const { CoreMeasurementID: survivorID, StemGUID: targetStemGUID, TreeTag: targetTreeTag, StemTag: targetStemTag } = existingRows[0];
    console.log(`[tag-dedup] Target: CoreMeasurementID=${survivorID} TreeTag=${targetTreeTag} StemTag=${targetStemTag} StemGUID=${targetStemGUID}`);

    // Insert a duplicate that shares the same StemGUID (and therefore same
    // TreeTag+StemTag) but uses a different date, bypassing the StemGUID+Date
    // dedup partition. The higher CoreMeasurementID marks it as the duplicate.
    const DUPLICATE_DATE = '2025-06-01';
    const [insertResult] = await connection.query<any>(
      `INSERT INTO coremeasurements (CensusID, StemGUID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated)
       VALUES (?, ?, 12.0, 1.3, ?, FALSE)`,
      [censusID, targetStemGUID, DUPLICATE_DATE]
    );
    const duplicateID = Number(insertResult.insertId);
    console.log(`[tag-dedup] Inserted duplicate CoreMeasurementID=${duplicateID} date=${DUPLICATE_DATE}`);

    // Verify the duplicate has a higher ID than the survivor so the partition
    // keeps the right row (this is guaranteed by AUTO_INCREMENT ordering, but
    // assert explicitly for debuggability).
    expect(duplicateID).toBeGreaterThan(Number(survivorID));

    const beforeCount = await countCensusMeasurements();
    expect(beforeCount).toBe(EXPECTED_CLEAN_ROW_COUNT + 1);

    await collapseCensus(connectionManager, { schema, censusID });

    const afterCount = await countCensusMeasurements();
    console.log(`[tag-dedup] After collapse: ${afterCount} rows`);
    // Detection-only contract (dev commit a5626b04, 2026-07-16): the census-wide
    // collapser must NOT choose a winner between persisted measurements. Both rows
    // stay so a user can review the conflict.
    expect(afterCount).toBe(EXPECTED_CLEAN_ROW_COUNT + 1);

    // BOTH rows must survive — the collapser is forbidden from deleting either.
    const [survivorCheck] = await connection.query<RowDataPacket[]>(`SELECT CoreMeasurementID FROM coremeasurements WHERE CoreMeasurementID = ?`, [survivorID]);
    const [duplicateCheck] = await connection.query<RowDataPacket[]>(`SELECT CoreMeasurementID FROM coremeasurements WHERE CoreMeasurementID = ?`, [
      duplicateID
    ]);
    console.log(`[tag-dedup] Original present: ${survivorCheck.length === 1}, Duplicate preserved: ${duplicateCheck.length === 1}`);
    expect(survivorCheck).toHaveLength(1);
    expect(duplicateCheck).toHaveLength(1);

    // The conflict must be surfaced as a warning alert instead of a silent delete.
    const alerts = await fetchIntegrityAlerts();
    console.log(`[tag-dedup] Integrity alerts: ${JSON.stringify(alerts)}`);
    const tagConflictAlerts = alerts.filter(a => a.type === 'COLLAPSER_TREE_STEM_TAG_CONFLICT');
    expect(tagConflictAlerts.length).toBe(1);
    expect(tagConflictAlerts[0].message).toContain('same TreeTag+StemTag in the census');
    expect(tagConflictAlerts[0].message).toContain('preserved for user review');
    expect(tagConflictAlerts[0].severity).toBe('warning');
    // One extra row beyond the first in the conflicting group.
    expect(Number(tagConflictAlerts[0].sourceRecords)).toBe(1);
    expect(Number(tagConflictAlerts[0].failedRecords)).toBe(0);
  }, 60000);

  // -------------------------------------------------------------------------
  // 2. Idempotency proof
  // -------------------------------------------------------------------------

  it('IDEMPOTENCY: running collapseCensus twice produces identical coremeasurements state', async () => {
    await stageAndIngestFixtureRows();

    // --- First collapse ---
    await collapseCensus(connectionManager, { schema, censusID });

    const afterFirstRun = await fetchCollapserSnapshot();
    // Guard against a vacuous '' === '' pass if ingestion ever regresses to zero rows.
    expect(afterFirstRun.length).toBeGreaterThan(0);
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
  // preserve both rows and raise a COLLAPSER_STEM_DATE_CONFLICT warning.
  // -------------------------------------------------------------------------

  it('preserves coremeasurements rows with the same StemGUID+MeasurementDate, logging a conflict alert', async () => {
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
    // Detection-only contract (dev commit a5626b04, 2026-07-16): historical
    // StemGUID+MeasurementDate conflicts stay available for user review.
    expect(afterCount).toBe(EXPECTED_CLEAN_ROW_COUNT + 1);

    // BOTH rows must survive — the collapser is forbidden from deleting either.
    const [survivorRows] = await connection.query<RowDataPacket[]>(`SELECT CoreMeasurementID FROM coremeasurements WHERE StemGUID = ? AND CensusID = ?`, [
      targetStemGUID,
      censusID
    ]);
    const survivorIDs = survivorRows.map(r => Number(r.CoreMeasurementID));
    console.log(`[dedup] Surviving IDs for StemGUID ${targetStemGUID}: ${JSON.stringify(survivorIDs)}`);
    expect(survivorIDs).toContain(originalID);
    expect(survivorIDs).toContain(duplicateID);

    // The conflict must be surfaced as a warning alert instead of a silent delete.
    const alerts = await fetchIntegrityAlerts();
    console.log(`[dedup] Integrity alerts: ${JSON.stringify(alerts)}`);
    const stemDateConflictAlerts = alerts.filter(a => a.type === 'COLLAPSER_STEM_DATE_CONFLICT');
    expect(stemDateConflictAlerts.length).toBe(1);
    expect(stemDateConflictAlerts[0].message).toContain('same StemGUID+MeasurementDate');
    expect(stemDateConflictAlerts[0].message).toContain('preserved for user review');
    expect(stemDateConflictAlerts[0].severity).toBe('warning');
    expect(Number(stemDateConflictAlerts[0].sourceRecords)).toBe(1);
    expect(Number(stemDateConflictAlerts[0].failedRecords)).toBe(0);
  }, 60000);
});
