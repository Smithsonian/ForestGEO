/**
 * CLEAN_REUPLOAD census replacement — Integration Tests
 *
 * Pins the contract the code already documents: "Clean re-upload is census
 * replacement, not filename replacement." A CLEAN_REUPLOAD into a plot/census
 * must remove EVERY prior measurement row for that scope and nothing outside it.
 *
 * The bug these tests were written against (measured on live forestgeo_harvard,
 * 2026-07-28): cleanupPreviousFileUploads enumerates the batches to delete from
 * `uploadmetrics`:
 *
 *     SELECT batchID FROM uploadmetrics WHERE plotID = ? AND censusID = ? AND batchID <> ?
 *
 * A sub-batch whose ingestion died before the stored procedure wrote its metric
 * row is therefore INVISIBLE to the cleanup. On Harvard that leaves 96,227 of
 * 106,227 parked rows stranded forever, because only __sub001/__sub002 ever
 * recorded metrics while __sub003…__sub012 did not.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/clean-reupload-census-replacement.test.ts
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { cleanupTestMeasurements, createAdditionalCensus, setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(`[clean-reupload] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not local. This suite drops and recreates measurement rows.`);
}

// ---------------------------------------------------------------------------
// ConnectionManager bridge to the real test connection (same idiom as the other
// lib/uploads integration suites).
// ---------------------------------------------------------------------------

const sharedState = vi.hoisted(() => ({
  connection: null as import('mysql2/promise').Connection | null,
  activeTransactionID: null as string | null,
  counter: 0
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (sql: string, params?: unknown[]) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      const [rows] = await sharedState.connection.query(sql, params ?? []);
      return rows;
    },
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      await sharedState.connection.beginTransaction();
      sharedState.counter += 1;
      sharedState.activeTransactionID = `clean-reupload-tx-${sharedState.counter}`;
      return sharedState.activeTransactionID;
    },
    commitTransaction: async () => {
      await sharedState.connection!.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async () => {
      await sharedState.connection!.rollback();
      sharedState.activeTransactionID = null;
    }
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import ConnectionManager from '@/lib/db/connectionmanager';
import { cleanupPreviousFileUploads } from '@/lib/ingestion/temporary-measurements';

// ---------------------------------------------------------------------------
// Fixture vocabulary
// ---------------------------------------------------------------------------

/** The file the replacement upload arrives as. */
const INCOMING_FILE = 'replacement.csv';
const INCOMING_BATCH = 'incoming-batch-0001';

/** Prior upload in the target census that DID record an uploadmetrics row. */
const PRIOR_FILE_WITH_METRICS = 'prior-with-metrics.csv';
const PRIOR_BATCH_WITH_METRICS = 'prior-batch-0001';

/** Prior upload in the target census under a DIFFERENT filename — census
 *  replacement must remove it even though the name does not match. */
const PRIOR_FILE_DIFFERENT_NAME = 'assembled-from-another-file.TXT';
const PRIOR_BATCH_DIFFERENT_NAME = 'other-file-batch-0001';

/** Harvard-shaped orphans: split sub-batches whose ingestion died before the
 *  stored procedure recorded any uploadmetrics row. */
const ORPHAN_BASE_BATCH = 'ms3k5wnm-oc4mjrino5h';
const ORPHAN_SUB_BATCHES = [`${ORPHAN_BASE_BATCH}__sub003`, `${ORPHAN_BASE_BATCH}__sub004`];
const ORPHAN_FILE = 'harvard2014b.TXT';

const CONTROL_FILE = 'control.csv';

describe('CLEAN_REUPLOAD census replacement — integration', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let schema: string;
  let plotID: number;
  let targetCensusID: number;
  let samePlotOtherCensusID: number;
  let otherPlotID: number;
  let otherPlotCensusID: number;
  let connectionManager: ReturnType<typeof ConnectionManager.getInstance>;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    schema = setup.config.database;
    sharedState.connection = connection;
    connectionManager = ConnectionManager.getInstance();

    plotID = testData.plots[0].plotID;
    targetCensusID = testData.census[0].censusID;

    // CONTROL 1 — same plot, different census.
    const extra = await createAdditionalCensus(connection, testData, { plotCensusNumber: 90, startDate: '2020-01-01', endDate: '2020-12-31' });
    samePlotOtherCensusID = extra.censusID;

    // CONTROL 2 — a different plot entirely, with its own census.
    await connection.query(
      `INSERT INTO plots (PlotName, LocationName, CountryName, DimensionX, DimensionY, Area, PlotShape, PlotDescription)
       VALUES ('Control Plot', 'Elsewhere', 'Testland', 100, 100, 10000, 'square', 'isolation control')`
    );
    const [plotRows] = await connection.query<RowDataPacket[]>(`SELECT PlotID FROM plots WHERE PlotName = 'Control Plot'`);
    otherPlotID = Number(plotRows[0].PlotID);
    await connection.query(`INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive) VALUES (?, 1, '2021-01-01', '2021-12-31', 1)`, [
      otherPlotID
    ]);
    const [censusRows] = await connection.query<RowDataPacket[]>(`SELECT CensusID FROM census WHERE PlotID = ? AND PlotCensusNumber = 1`, [otherPlotID]);
    otherPlotCensusID = Number(censusRows[0].CensusID);

    console.log(
      `[setup] schema=${schema} plot=${plotID} targetCensus=${targetCensusID} ` +
        `samePlotOtherCensus=${samePlotOtherCensusID} otherPlot=${otherPlotID}/${otherPlotCensusID}`
    );
  }, 120000);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  // -------------------------------------------------------------------------
  // Seeding helpers — raw SQL so each row's (file, batch, census, resolved-ness)
  // is stated explicitly rather than inferred from a higher-level helper.
  // -------------------------------------------------------------------------

  let rowIndexCounter = 0;

  async function seedParkedRows(fileID: string, batchID: string, censusID: number, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      rowIndexCounter += 1;
      await connection.query(
        `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
           UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
         VALUES (?, NULL, FALSE, '2024-03-15', 1.0, 1.0, ?, ?, ?, ?, 1)`,
        [censusID, fileID, batchID, `T${rowIndexCounter}`, rowIndexCounter]
      );
    }
  }

  /** A fully ingested row (StemGUID NOT NULL) — replacement must remove these too. */
  async function seedIngestedRow(fileID: string, batchID: string, censusID: number, plotForQuadrat: number, tag: string): Promise<number> {
    const [treeResult]: any = await connection.query(`INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, NULL, ?, 1)`, [tag, censusID]);
    const [stemResult]: any = await connection.query(`INSERT INTO stems (TreeID, StemTag, LocalX, LocalY, CensusID, IsActive) VALUES (?, '1', 0, 0, ?, 1)`, [
      treeResult.insertId,
      censusID
    ]);
    rowIndexCounter += 1;
    const [cmResult]: any = await connection.query(
      `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
         UploadFileID, UploadBatchID, SourceRowIndex, IsActive)
       VALUES (?, ?, TRUE, '2024-03-15', 5.0, 1.3, ?, ?, ?, 1)`,
      [censusID, stemResult.insertId, fileID, batchID, rowIndexCounter]
    );
    void plotForQuadrat;
    return Number(cmResult.insertId);
  }

  async function seedMetric(fileID: string, batchID: string, forPlotID: number, censusID: number, status = 'completed'): Promise<void> {
    await connection.query(
      `INSERT INTO uploadmetrics (uploadId, fileID, batchID, schema_name, plotID, censusID, sourceRecords, processedRecords, failedRecords, status, startTime)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, 0, ?, NOW())`,
      [`upload-${batchID}`, fileID, batchID, schema, forPlotID, censusID, status]
    );
  }

  /** Links an ingestion error to a measurement so cascade behaviour is observable. */
  async function seedErrorLink(measurementID: number): Promise<void> {
    await connection.query(
      `INSERT INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage) VALUES ('ingestion','SQL_EXCEPTION','Ingestion SQL exception')
       ON DUPLICATE KEY UPDATE ErrorID = LAST_INSERT_ID(ErrorID)`
    );
    const [errRows] = await connection.query<RowDataPacket[]>(
      `SELECT ErrorID FROM measurement_errors WHERE ErrorSource='ingestion' AND ErrorCode='SQL_EXCEPTION' LIMIT 1`
    );
    await connection.query(`INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved, CreatedAt) VALUES (?, ?, FALSE, NOW())`, [
      measurementID,
      errRows[0].ErrorID
    ]);
  }

  // -------------------------------------------------------------------------
  // Observation helpers
  // -------------------------------------------------------------------------

  /** Count + order-independent-but-exact digest of a census's measurement rows. */
  async function scopeDigest(censusID: number): Promise<{ count: number; digest: string | null }> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count, SHA2(GROUP_CONCAT(CoreMeasurementID ORDER BY CoreMeasurementID), 256) AS digest
       FROM coremeasurements WHERE CensusID = ?`,
      [censusID]
    );
    return { count: Number(rows[0].count), digest: rows[0].digest === null ? null : String(rows[0].digest) };
  }

  async function countRows(censusID: number, resolved: 'all' | 'parked' | 'ingested'): Promise<number> {
    const predicate = resolved === 'parked' ? 'AND StemGUID IS NULL' : resolved === 'ingested' ? 'AND StemGUID IS NOT NULL' : '';
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM coremeasurements WHERE CensusID = ? ${predicate}`, [censusID]);
    return Number(rows[0].count);
  }

  async function metricBatches(censusID: number): Promise<string[]> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT batchID FROM uploadmetrics WHERE censusID = ? ORDER BY batchID`, [censusID]);
    return rows.map(row => String(row.batchID));
  }

  async function errorLinkCount(censusID: number): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM measurement_error_log mel JOIN coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID WHERE cm.CensusID = ?`,
      [censusID]
    );
    return Number(rows[0].count);
  }

  /**
   * Builds the full fixture:
   *   TARGET census  — metric-backed batch, orphaned sub-batches, a different
   *                    filename, and an already-ingested row
   *   CONTROL 1      — same plot, different census
   *   CONTROL 2      — different plot, different census
   */
  async function seedFixture(): Promise<{ control1: { count: number; digest: string | null }; control2: { count: number; digest: string | null } }> {
    // --- TARGET scope ---
    await seedMetric(PRIOR_FILE_WITH_METRICS, PRIOR_BATCH_WITH_METRICS, plotID, targetCensusID);
    await seedParkedRows(PRIOR_FILE_WITH_METRICS, PRIOR_BATCH_WITH_METRICS, targetCensusID, 3);
    const ingestedID = await seedIngestedRow(PRIOR_FILE_WITH_METRICS, PRIOR_BATCH_WITH_METRICS, targetCensusID, plotID, 'TGT-INGESTED');
    await seedErrorLink(ingestedID);

    // Orphans: rows exist, NO uploadmetrics row. This is the Harvard shape.
    for (const subBatch of ORPHAN_SUB_BATCHES) {
      await seedParkedRows(ORPHAN_FILE, subBatch, targetCensusID, 4);
    }

    // Different filename inside the same census — census replacement, not
    // filename replacement, so this must go too.
    await seedParkedRows(PRIOR_FILE_DIFFERENT_NAME, PRIOR_BATCH_DIFFERENT_NAME, targetCensusID, 2);

    // The incoming upload's own metric row — must SURVIVE (it is the new upload).
    await seedMetric(INCOMING_FILE, INCOMING_BATCH, plotID, targetCensusID, 'processing');

    // --- CONTROL 1: same plot, different census ---
    await seedMetric(CONTROL_FILE, 'control1-batch', plotID, samePlotOtherCensusID);
    await seedParkedRows(CONTROL_FILE, 'control1-batch', samePlotOtherCensusID, 3);
    await seedParkedRows(CONTROL_FILE, 'control1-orphan__sub001', samePlotOtherCensusID, 2);

    // --- CONTROL 2: different plot and census ---
    await seedMetric(CONTROL_FILE, 'control2-batch', otherPlotID, otherPlotCensusID);
    await seedParkedRows(CONTROL_FILE, 'control2-batch', otherPlotCensusID, 3);

    return { control1: await scopeDigest(samePlotOtherCensusID), control2: await scopeDigest(otherPlotCensusID) };
  }

  async function runCleanReupload(): Promise<void> {
    const transactionID = await connectionManager.beginTransaction();
    await cleanupPreviousFileUploads(connectionManager, schema, INCOMING_FILE, INCOMING_BATCH, plotID, targetCensusID, transactionID);
    await connectionManager.commitTransaction(transactionID);
  }

  beforeEach(async () => {
    if (sharedState.activeTransactionID) {
      await connection.rollback();
      sharedState.activeTransactionID = null;
    }
    await cleanupTestMeasurements(connection, testData, { additionalTables: ['uploadmetrics'] });
    await connection.query(`DELETE FROM coremeasurements`);
    await connection.query(`DELETE FROM stems`);
    await connection.query(`DELETE FROM trees`);
    await connection.query(`DELETE FROM uploadmetrics`);
    rowIndexCounter = 0;
  });

  // -------------------------------------------------------------------------
  // 1. The core contract
  // -------------------------------------------------------------------------

  it('removes EVERY prior row in the target census, including batches with no uploadmetrics row', async () => {
    await seedFixture();

    const before = await countRows(targetCensusID, 'all');
    const beforeParked = await countRows(targetCensusID, 'parked');
    const beforeIngested = await countRows(targetCensusID, 'ingested');
    console.log(`[target] before: total=${before} parked=${beforeParked} ingested=${beforeIngested}`);
    expect(before).toBe(3 + 1 + ORPHAN_SUB_BATCHES.length * 4 + 2); // 14

    await runCleanReupload();

    const after = await countRows(targetCensusID, 'all');
    console.log(`[target] after: total=${after}`);

    // Census replacement means ZERO prior rows survive — ingested or parked.
    expect(await countRows(targetCensusID, 'parked')).toBe(0);
    expect(await countRows(targetCensusID, 'ingested')).toBe(0);
    expect(after).toBe(0);
  }, 120000);

  it('removes orphaned __subNNN rows specifically (the Harvard shape)', async () => {
    await seedFixture();

    await runCleanReupload();

    const [orphanRows] = await connection.query<RowDataPacket[]>(
      `SELECT UploadBatchID, COUNT(*) AS count FROM coremeasurements WHERE UploadBatchID LIKE ? ESCAPE '\\\\' GROUP BY UploadBatchID`,
      [`${ORPHAN_BASE_BATCH}\\_\\_sub%`]
    );
    console.log(`[orphans] surviving: ${JSON.stringify(orphanRows)}`);
    expect(orphanRows).toHaveLength(0);
  }, 120000);

  it('removes prior rows under a DIFFERENT UploadFileID (census replacement, not filename replacement)', async () => {
    await seedFixture();

    await runCleanReupload();

    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM coremeasurements WHERE UploadFileID = ? AND CensusID = ?`, [
      PRIOR_FILE_DIFFERENT_NAME,
      targetCensusID
    ]);
    console.log(`[different-filename] surviving rows for ${PRIOR_FILE_DIFFERENT_NAME}: ${rows[0].count}`);
    expect(Number(rows[0].count)).toBe(0);
  }, 120000);

  it('cascades error links away with the rows they belonged to', async () => {
    await seedFixture();
    expect(await errorLinkCount(targetCensusID)).toBeGreaterThan(0);

    await runCleanReupload();

    expect(await errorLinkCount(targetCensusID)).toBe(0);
  }, 120000);

  // -------------------------------------------------------------------------
  // 2. uploadmetrics: prior scope cleared, incoming upload's own metric kept
  // -------------------------------------------------------------------------

  it('clears every PRIOR target-scope metric row while leaving the incoming upload its own', async () => {
    await seedFixture();
    const before = await metricBatches(targetCensusID);
    console.log(`[metrics] before: ${JSON.stringify(before)}`);
    expect(before).toContain(PRIOR_BATCH_WITH_METRICS);
    expect(before).toContain(INCOMING_BATCH);

    await runCleanReupload();

    const after = await metricBatches(targetCensusID);
    console.log(`[metrics] after: ${JSON.stringify(after)}`);
    // Not "empty": the replacement upload legitimately owns metric rows. Only
    // the PRIOR ones must be gone.
    expect(after).toEqual([INCOMING_BATCH]);
    expect(after).not.toContain(PRIOR_BATCH_WITH_METRICS);
  }, 120000);

  // -------------------------------------------------------------------------
  // 3. Isolation controls
  // -------------------------------------------------------------------------

  it('leaves the same plot’s OTHER census byte-identical', async () => {
    const { control1 } = await seedFixture();

    await runCleanReupload();

    const after = await scopeDigest(samePlotOtherCensusID);
    console.log(`[control1 same-plot-other-census] before=${JSON.stringify(control1)} after=${JSON.stringify(after)}`);
    expect(after.count).toBe(control1.count);
    expect(after.digest).toBe(control1.digest);
    // Its metric rows — including its own orphan-shaped batch — survive too.
    expect(await metricBatches(samePlotOtherCensusID)).toEqual(['control1-batch']);
  }, 120000);

  it('leaves a DIFFERENT plot/census byte-identical', async () => {
    const { control2 } = await seedFixture();

    await runCleanReupload();

    const after = await scopeDigest(otherPlotCensusID);
    console.log(`[control2 other-plot] before=${JSON.stringify(control2)} after=${JSON.stringify(after)}`);
    expect(after.count).toBe(control2.count);
    expect(after.digest).toBe(control2.digest);
    expect(await metricBatches(otherPlotCensusID)).toEqual(['control2-batch']);
  }, 120000);

  // -------------------------------------------------------------------------
  // 4. Harvard-shaped fixture (supplementary — proportional, not the contract)
  // -------------------------------------------------------------------------

  it('Harvard-shaped ratio: metric-backed rows are a minority of what must be removed', async () => {
    await seedFixture();

    const [metricBacked] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM coremeasurements
       WHERE CensusID = ? AND UploadBatchID IN (SELECT batchID FROM uploadmetrics WHERE plotID = ? AND censusID = ? AND batchID <> ?)`,
      [targetCensusID, plotID, targetCensusID, INCOMING_BATCH]
    );
    const total = await countRows(targetCensusID, 'all');
    const orphaned = total - Number(metricBacked[0].count);
    console.log(`[harvard-shape] total=${total} metricBacked=${metricBacked[0].count} orphaned=${orphaned}`);

    // Live Harvard measured 2026-07-28: 20,000 metric-backed, 96,227 orphaned
    // out of 116,227. The fixture reproduces the SHAPE — orphans outnumber the
    // metric-backed rows — so a metrics-only cleanup provably under-deletes.
    expect(orphaned).toBeGreaterThan(Number(metricBacked[0].count));

    await runCleanReupload();
    expect(await countRows(targetCensusID, 'all')).toBe(0);
  }, 120000);
});
