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
  counter: 0,
  /** Every statement the code under test issued, so chunk-loop iteration counts are observable. */
  statements: [] as string[]
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (sql: string, params?: unknown[], _transactionID?: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      sharedState.statements.push(sql);
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
    },
    withTransaction: async <T>(fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<any>; readonly id: string }) => Promise<T>): Promise<T> => {
      const id = await manager.beginTransaction();
      try {
        const result = await fn({ id, query: (sql: string, params?: unknown[]) => manager.executeQuery(sql, params, id) });
        await manager.commitTransaction();
        return result;
      } catch (error) {
        await manager.rollbackTransaction();
        throw error;
      }
    }
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import ConnectionManager from '@/lib/db/connectionmanager';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import { CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE, cleanupPreviousFileUploads } from '@/lib/ingestion/temporary-measurements';
import { completeCensusReplacement, replaceCensusForCleanReupload, type CensusReplacementParams } from '@/lib/uploads/stage-measurements';
import { CENSUS_REPLACEMENT_MARKER_COLUMN, resetUploadSessionReplacementMarkerCacheForTests } from '@/lib/uploads/upload-session-replacement-marker';
import { ensureUploadSessionsTable } from '@/config/uploadsessiontracker';
import { SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { CENSUS_REPLACEMENT_STATEMENT } from '../setup/census-replacement-statement-patterns';
import { startFreshUploadSession } from '../setup/upload-session-fixtures';

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

/** CTFS-migrated rows: real data, but no UploadBatchID was ever recorded. */
const LEGACY_MIGRATED_FILE = 'ctfs-migration';

const CONTROL_FILE = 'control.csv';

/** Attributes every DELETE-audit row this suite's cleanup runs write (#507). */
const TEST_CHANGED_BY = 'clean-reupload-integration-test';

/** NULL-UploadBatchID legacy rows seeded into each CONTROL census. */
const CONTROL_NULL_BATCH_ROW_COUNT = 2;

/** NULL-UploadBatchID legacy rows seeded into the TARGET census. */
const TARGET_NULL_BATCH_ROW_COUNT = 3;

/**
 * Rows the incoming upload has already written for itself before a re-entrant
 * cleanup call: some under the bare batch id, some under split children.
 */
const INCOMING_OWN_PARKED_ROWS = 2;
const INCOMING_OWN_SUB_BATCH = `${INCOMING_BATCH}__sub001`;
const INCOMING_OWN_SUB_BATCH_PARKED_ROWS = 3;
const INCOMING_OWN_INGESTED_SUB_BATCH = `${INCOMING_BATCH}__sub002`;

/** One window of the bounded replacement; a seeded census is sized relative to it. */
const WINDOW_SIZE = CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE;

const SESSION_ID = {
  I2: 'clean-reupload-i2-session',
  I3: 'clean-reupload-i3-session',
  I4: 'clean-reupload-i4-session',
  I5: 'clean-reupload-i5-session',
  I5B: 'clean-reupload-i5b-session',
  I8: 'clean-reupload-i8-session'
} as const;

const REPLACEMENT_CSV_HEADERS = ['treetag', 'stemtag', 'speciescode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'];
const REPLACEMENT_RAW_ROW = {
  treetag: 'I2T1',
  stemtag: '1',
  speciescode: 'ACERRU',
  quadrat: 'Q01',
  lx: '1',
  ly: '1',
  dbh: '10',
  hom: '1.3',
  date: '2021-06-01',
  codes: ''
};
const CSV_DELIMITER = ',';

const SURVIVING_WINDOW_REMAINDER = 137;
const I4_EXTRA_PRIOR_ROWS = 10;
const I5B_EXTRA_PRIOR_ROWS = 50;
const I8_PRIOR_MEASUREMENT_ROWS = 3;
const I8_PRIOR_METRIC_REMAINDER = 25;
const I8_FAMILY_METRIC_COUNT = 2;
const SECOND_FILE_FAILURE = { fileID: 'second-file.csv', batchID: 'second-file-batch' } as const;
const SECOND_WINDOW = 2;
const BULK_PRIOR_BATCH = 'bulk-prior-batch';
const FIRST_WINDOW = 1;
const REPLACEMENT_OUTCOME = { REPLACED: 'replaced', COMPLETED_BY_PEER: 'completed_by_peer' } as const;

class InjectedWindowFailure extends Error {
  constructor(statementPattern: RegExp, occurrence: number) {
    super(`injected failure on occurrence ${occurrence} of ${statementPattern}`);
    this.name = 'InjectedWindowFailure';
  }
}

const BARRIER_DEADLINE_MS = 15_000;
/** INNODB_TRX is served from a cache that refreshes only after 100 ms without a read, so a tighter poll never sees a new waiter. */
const LOCK_WAIT_POLL_INTERVAL_MS = 150;
const SESSION_LOCK_PATTERN = CENSUS_REPLACEMENT_STATEMENT.SESSION_LOCK;
const LOCK_CONTENTION_ERROR = /Deadlock|Lock wait timeout/;
const BARRIER_TEST_TIMEOUT_MS = 120_000;
const PEER_FINISHED_OUTCOMES: readonly string[] = ['replaced', 'completed_by_peer', 'already_completed'];

interface Barrier {
  reached: Promise<void>;
  gate: Promise<void>;
  markReached(): void;
  release(): void;
}
type BarrierPlacement = 'before' | 'after';
interface RecordedStatement {
  transactionID: string | undefined;
  sql: string;
}

function createBarrier(): Barrier {
  let markReached!: () => void;
  let release!: () => void;
  const reached = new Promise<void>(resolve => (markReached = resolve));
  const gate = new Promise<void>(resolve => (release = resolve));
  return { reached, gate, markReached, release };
}

class BarrierDeadlineError extends Error {
  constructor(label: string, statementLog: string) {
    super(`${label} not reached within ${BARRIER_DEADLINE_MS} ms. Statements:\n${statementLog}`);
    this.name = 'BarrierDeadlineError';
  }
}

async function withinDeadline<T>(promise: Promise<T>, label: string, renderStatementLog: () => string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BarrierDeadlineError(label, renderStatementLog())), BARRIER_DEADLINE_MS);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
 * Test-side wrapper around a real ConnectionManager. It records every statement and parks the runner's
 * session-lock statements at barriers, so a peer can be started while the runner holds the session row.
 * Product code carries no hook; the barriers live entirely in this spy.
 */
function createSessionLockHarness(manager: ConnectionManager) {
  const recordedStatements: RecordedStatement[] = [];
  const commitOrder: string[] = [];
  const barriers = new Map<string, Barrier>();
  const runnerTransactionIDs: string[] = [];
  const peerTransactionIDs = new Set<string>();
  const trackedPromises: Promise<unknown>[] = [];
  let runnerLockCount = 0;
  let peerStarted = false;

  const originalExecuteQuery = manager.executeQuery.bind(manager);
  const originalCommitTransaction = manager.commitTransaction.bind(manager);
  const barrierKey = (runnerLock: number, placement: BarrierPlacement) => `${runnerLock}:${placement}`;

  const executeQuerySpy = vi.spyOn(manager, 'executeQuery').mockImplementation(async (sql: string, params?: unknown[], transactionID?: string) => {
    recordedStatements.push({ transactionID, sql });
    if (!SESSION_LOCK_PATTERN.test(sql) || transactionID === undefined) return originalExecuteQuery(sql, params, transactionID);

    const isPeerLock = peerTransactionIDs.has(transactionID) || (peerStarted && peerTransactionIDs.size === 0 && !runnerTransactionIDs.includes(transactionID));
    if (isPeerLock) {
      peerTransactionIDs.add(transactionID);
      return originalExecuteQuery(sql, params, transactionID);
    }

    runnerLockCount += 1;
    const runnerLock = runnerLockCount;
    runnerTransactionIDs.push(transactionID);
    const before = barriers.get(barrierKey(runnerLock, 'before'));
    if (before) {
      before.markReached();
      await before.gate;
    }
    const result = await originalExecuteQuery(sql, params, transactionID);
    const after = barriers.get(barrierKey(runnerLock, 'after'));
    if (after) {
      after.markReached();
      await after.gate;
    }
    return result;
  });
  const commitSpy = vi.spyOn(manager, 'commitTransaction').mockImplementation(async (transactionID: string) => {
    await originalCommitTransaction(transactionID);
    commitOrder.push(transactionID);
  });

  const renderStatementLog = () =>
    recordedStatements.map(({ transactionID, sql }) => `${transactionID ?? 'no-tx'} ${sql.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n');

  return {
    recordedStatements,
    commitOrder,
    runnerTransactionIDs,
    peerTransactionIDs,
    renderStatementLog,
    placeBarrier(runnerLock: number, placement: BarrierPlacement): Barrier {
      const barrier = createBarrier();
      barriers.set(barrierKey(runnerLock, placement), barrier);
      return barrier;
    },
    markPeerAboutToStart(): void {
      peerStarted = true;
    },
    track<T>(promise: Promise<T>): Promise<T> {
      trackedPromises.push(promise);
      promise.catch(() => undefined);
      return promise;
    },
    async settleAndRestore(scenarioFailed: boolean): Promise<void> {
      barriers.forEach(barrier => barrier.release());
      try {
        await withinDeadline(Promise.allSettled(trackedPromises), 'runner and peer to settle', renderStatementLog);
      } catch (settleError: unknown) {
        if (!scenarioFailed) throw settleError;
        console.error(
          `[barrier cleanup] runner/peer did not settle while the scenario was already failing; keeping the scenario's error: ${String(settleError)}`
        );
      } finally {
        executeQuerySpy.mockRestore();
        commitSpy.mockRestore();
      }
    }
  };
}
type SessionLockHarness = ReturnType<typeof createSessionLockHarness>;

async function runBarrierScenario(harness: SessionLockHarness, scenario: () => Promise<void>): Promise<void> {
  let scenarioFailed = false;
  try {
    await scenario();
  } catch (scenarioError: unknown) {
    scenarioFailed = true;
    throw scenarioError;
  } finally {
    await harness.settleAndRestore(scenarioFailed);
  }
}

const REPLACEMENT_IMPLEMENTATIONS = [
  { label: 'cleanupPreviousFileUploads (ArcGIS, one caller transaction)', run: 'one_transaction' },
  { label: 'replaceCensusForCleanReupload (bounded, one transaction per window)', run: 'bounded' }
] as const;

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
    await ensureUploadSessionsTable(schema);
    resetUploadSessionReplacementMarkerCacheForTests();

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
    try {
      await getPoolMonitorInstance().closeAllConnections();
    } finally {
      await teardownTestDatabase(connection, config);
    }
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

  /**
   * Rows with a NULL UploadBatchID. `coremeasurements.UploadBatchID` is
   * nullable and the CTFS migration inserts never populate it, so any census
   * assembled from a legacy import is entirely this shape.
   */
  async function seedNullBatchRows(fileID: string, censusID: number, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      rowIndexCounter += 1;
      await connection.query(
        `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
           UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
         VALUES (?, NULL, FALSE, '2024-03-15', 1.0, 1.0, ?, NULL, ?, ?, 1)`,
        [censusID, fileID, `L${rowIndexCounter}`, rowIndexCounter]
      );
    }
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

    // Legacy CTFS-migrated rows with a NULL UploadBatchID.
    await seedNullBatchRows(LEGACY_MIGRATED_FILE, targetCensusID, TARGET_NULL_BATCH_ROW_COUNT);

    // The incoming upload's own metric row — must SURVIVE (it is the new upload).
    await seedMetric(INCOMING_FILE, INCOMING_BATCH, plotID, targetCensusID, 'processing');

    // --- CONTROL 1: same plot, different census ---
    await seedMetric(CONTROL_FILE, 'control1-batch', plotID, samePlotOtherCensusID);
    await seedParkedRows(CONTROL_FILE, 'control1-batch', samePlotOtherCensusID, 3);
    await seedParkedRows(CONTROL_FILE, 'control1-orphan__sub001', samePlotOtherCensusID, 2);
    // NULL-batch legacy rows OUTSIDE the target census. The NULL-safety fix
    // makes a NULL UploadBatchID "belongs to no incoming family" — which is only
    // half the contract. The census predicate still has to keep that from
    // reaching another census's legacy rows.
    await seedNullBatchRows(LEGACY_MIGRATED_FILE, samePlotOtherCensusID, CONTROL_NULL_BATCH_ROW_COUNT);

    // --- CONTROL 2: different plot and census ---
    await seedMetric(CONTROL_FILE, 'control2-batch', otherPlotID, otherPlotCensusID);
    await seedParkedRows(CONTROL_FILE, 'control2-batch', otherPlotCensusID, 3);
    await seedNullBatchRows(LEGACY_MIGRATED_FILE, otherPlotCensusID, CONTROL_NULL_BATCH_ROW_COUNT);

    return { control1: await scopeDigest(samePlotOtherCensusID), control2: await scopeDigest(otherPlotCensusID) };
  }

  async function runCleanupInOneTransaction(): Promise<void> {
    const transactionID = await connectionManager.beginTransaction();
    await cleanupPreviousFileUploads(connectionManager, schema, INCOMING_FILE, INCOMING_BATCH, plotID, targetCensusID, TEST_CHANGED_BY, transactionID);
    await connectionManager.commitTransaction(transactionID);
  }

  function buildReplacementParams(uploadSessionID: string): CensusReplacementParams {
    return {
      schema,
      fileName: INCOMING_FILE,
      batchID: INCOMING_BATCH,
      plotID,
      censusID: targetCensusID,
      uploadMode: UploadMode.CLEAN_REUPLOAD,
      sourceFormat: SourceFormat.csv,
      rawRows: [REPLACEMENT_RAW_ROW],
      csvHeaders: REPLACEMENT_CSV_HEADERS,
      delimiter: CSV_DELIMITER,
      uploadSessionID,
      firstRowOrdinal: 0,
      changedBy: TEST_CHANGED_BY
    };
  }

  function startSession(sessionID: string): Promise<void> {
    return startFreshUploadSession(connection, { schema, sessionID, plotID, censusID: targetCensusID });
  }

  async function runBoundedReplacement(): Promise<void> {
    await startSession(SESSION_ID.I2);
    const result = await replaceCensusForCleanReupload(connectionManager, buildReplacementParams(SESSION_ID.I2));
    console.log(`[bounded replacement] outcome=${result.outcome} deletedRows=${result.deletedRows} windows=${result.windowCount}`);
    expect(result.outcome).toBe(REPLACEMENT_OUTCOME.REPLACED);
  }

  const REPLACEMENT_RUNNERS = {
    one_transaction: runCleanupInOneTransaction,
    bounded: runBoundedReplacement
  } as const;

  /** The DELETE-audit rows #507 adds for the coremeasurements deletes this suite's cleanup runs. */
  async function deleteAuditRows(censusID: number): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT RecordID, OldRowState, ChangedBy FROM unifiedchangelog
       WHERE TableName = 'coremeasurements' AND Operation = 'DELETE' AND CensusID = ?
       ORDER BY RecordID`,
      [censusID]
    );
    return rows;
  }

  /** The mysql2 driver may hand back a JSON column already parsed, or as text. */
  function rowState(value: unknown): Record<string, unknown> {
    return typeof value === 'string' ? JSON.parse(value) : (value as Record<string, unknown>);
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
    // Every DELETE-audit test below reads unifiedchangelog scoped only by
    // CensusID (#507) — this census id is reused across every `it()` in this
    // file, so without clearing it here, an earlier test's audit rows for the
    // SAME census silently inflate a later test's count (the data they
    // describe is already gone via the DELETE above, but the audit rows
    // describing it were never cleared).
    await connection.query(`DELETE FROM unifiedchangelog`);
    await connection.query(`DELETE FROM upload_sessions`);
    rowIndexCounter = 0;
    sharedState.statements.length = 0;
  });

  describe.each(REPLACEMENT_IMPLEMENTATIONS)('$label', ({ run: runnerKey }) => {
    const run = REPLACEMENT_RUNNERS[runnerKey];
    // -------------------------------------------------------------------------
    // 1. The core contract
    // -------------------------------------------------------------------------

    it('removes EVERY prior row in the target census, including batches with no uploadmetrics row', async () => {
      await seedFixture();

      const before = await countRows(targetCensusID, 'all');
      const beforeParked = await countRows(targetCensusID, 'parked');
      const beforeIngested = await countRows(targetCensusID, 'ingested');
      console.log(`[target] before: total=${before} parked=${beforeParked} ingested=${beforeIngested}`);
      expect(before).toBe(3 + 1 + ORPHAN_SUB_BATCHES.length * 4 + 2 + TARGET_NULL_BATCH_ROW_COUNT); // 17

      await run();

      const after = await countRows(targetCensusID, 'all');
      console.log(`[target] after: total=${after}`);

      // Census replacement means ZERO prior rows survive — ingested or parked.
      expect(await countRows(targetCensusID, 'parked')).toBe(0);
      expect(await countRows(targetCensusID, 'ingested')).toBe(0);
      expect(after).toBe(0);
    }, 120000);

    it('removes orphaned __subNNN rows specifically (the Harvard shape)', async () => {
      await seedFixture();

      await run();

      const [orphanRows] = await connection.query<RowDataPacket[]>(
        `SELECT UploadBatchID, COUNT(*) AS count FROM coremeasurements WHERE UploadBatchID LIKE ? ESCAPE '\\\\' GROUP BY UploadBatchID`,
        [`${ORPHAN_BASE_BATCH}\\_\\_sub%`]
      );
      console.log(`[orphans] surviving: ${JSON.stringify(orphanRows)}`);
      expect(orphanRows).toHaveLength(0);
    }, 120000);

    /**
     * `NOT (col <=> ?) AND NOT (col LIKE ?)` looks NULL-safe because of the <=>,
     * but the LIKE arm returns NULL for a NULL column, and `TRUE AND NULL` is
     * NULL — so every legacy row silently survived a replacement that reported
     * success, leaving the census duplicated with no way to ever clean it.
     */
    it('removes legacy rows whose UploadBatchID is NULL', async () => {
      await seedFixture();

      const [before] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM coremeasurements WHERE CensusID = ? AND UploadBatchID IS NULL`, [
        targetCensusID
      ]);
      console.log(`[null-batch] before: ${before[0].count} row(s) with UploadBatchID IS NULL`);
      expect(Number(before[0].count)).toBe(TARGET_NULL_BATCH_ROW_COUNT);

      await run();

      const [after] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM coremeasurements WHERE CensusID = ? AND UploadBatchID IS NULL`, [
        targetCensusID
      ]);
      console.log(`[null-batch] after: ${after[0].count}`);
      expect(Number(after[0].count)).toBe(0);
    }, 120000);

    /**
     * The other half of the NULL-batch contract. A NULL UploadBatchID matches no
     * incoming family, so the family predicate alone would happily delete every
     * legacy row in the database — only the census/plot scope stops it. Without a
     * control-census NULL row, a regression that widened the scope would still
     * pass every assertion above.
     */
    it('leaves NULL-UploadBatchID rows in OTHER censuses untouched', async () => {
      await seedFixture();

      async function countNullBatchRows(censusID: number): Promise<number> {
        const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM coremeasurements WHERE CensusID = ? AND UploadBatchID IS NULL`, [
          censusID
        ]);
        return Number(rows[0].count);
      }

      expect(await countNullBatchRows(samePlotOtherCensusID)).toBe(CONTROL_NULL_BATCH_ROW_COUNT);
      expect(await countNullBatchRows(otherPlotCensusID)).toBe(CONTROL_NULL_BATCH_ROW_COUNT);

      await run();

      const survivingSamePlot = await countNullBatchRows(samePlotOtherCensusID);
      const survivingOtherPlot = await countNullBatchRows(otherPlotCensusID);
      console.log(`[null-batch controls] samePlotOtherCensus=${survivingSamePlot} otherPlotCensus=${survivingOtherPlot}`);
      expect(survivingSamePlot).toBe(CONTROL_NULL_BATCH_ROW_COUNT);
      expect(survivingOtherPlot).toBe(CONTROL_NULL_BATCH_ROW_COUNT);
      // And the target's own NULL rows are still gone — the scope narrowed, it did not stop working.
      expect(await countNullBatchRows(targetCensusID)).toBe(0);
    }, 120000);

    /**
     * The "spare the incoming family" arm of the delete predicate exists for the
     * RE-ENTRANT case: this upload already split into `batch__subNNN` and wrote
     * rows of its own, and cleanup runs again (a chunk retry, a worker recycle).
     * Deleting those rows would destroy the in-flight upload's own work. Until
     * this test, the arm was pinned only by textual SQL assertions — no DB row
     * ever exercised it.
     */
    it('spares coremeasurements already written under the INCOMING batch family', async () => {
      await seedFixture();

      await seedParkedRows(INCOMING_FILE, INCOMING_BATCH, targetCensusID, INCOMING_OWN_PARKED_ROWS);
      await seedParkedRows(INCOMING_FILE, INCOMING_OWN_SUB_BATCH, targetCensusID, INCOMING_OWN_SUB_BATCH_PARKED_ROWS);
      const incomingIngestedID = await seedIngestedRow(INCOMING_FILE, INCOMING_OWN_INGESTED_SUB_BATCH, targetCensusID, plotID, 'INCOMING-INGESTED');
      await seedErrorLink(incomingIngestedID);

      const expectedSurvivors = INCOMING_OWN_PARKED_ROWS + INCOMING_OWN_SUB_BATCH_PARKED_ROWS + 1;

      await run();

      const [survivors] = await connection.query<RowDataPacket[]>(
        `SELECT UploadBatchID, COUNT(*) AS count FROM coremeasurements WHERE CensusID = ? GROUP BY UploadBatchID ORDER BY UploadBatchID`,
        [targetCensusID]
      );
      console.log(`[incoming-family] survivors: ${JSON.stringify(survivors)}`);

      expect(survivors.map(row => [String(row.UploadBatchID), Number(row.count)])).toEqual([
        [INCOMING_BATCH, INCOMING_OWN_PARKED_ROWS],
        [INCOMING_OWN_SUB_BATCH, INCOMING_OWN_SUB_BATCH_PARKED_ROWS],
        [INCOMING_OWN_INGESTED_SUB_BATCH, 1]
      ]);
      expect(await countRows(targetCensusID, 'all')).toBe(expectedSurvivors);
      // The incoming row's error link rides along with the row it belongs to.
      expect(await errorLinkCount(targetCensusID)).toBe(1);
    }, 120000);

    /**
     * The deletes are issued as `DELETE ... LIMIT n` in a loop so no single
     * statement locks an entire 100k-row census. The loop has to keep going past
     * the first window — a seeded set larger than one chunk proves it does, and
     * that it terminates.
     */
    it('deletes a census larger than one delete chunk, not just the first window', async () => {
      const overOneChunk = CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE + 137;
      // Generated set-wise: 5137 single-row INSERTs would dominate the suite.
      // The server default caps recursive CTEs at 1000 iterations.
      await connection.query(`SET SESSION cte_max_recursion_depth = ?`, [overOneChunk + 1]);
      await connection.query(
        `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
           UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
         WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
         SELECT ?, NULL, FALSE, '2024-03-15', 1.0, 1.0, ?, 'bulk-prior-batch', CONCAT('B', n), n, 1 FROM seq`,
        [overOneChunk, targetCensusID, PRIOR_FILE_WITH_METRICS]
      );
      expect(await countRows(targetCensusID, 'all')).toBe(overOneChunk);

      await run();

      const surviving = await countRows(targetCensusID, 'all');
      console.log(`[chunked-delete] seeded=${overOneChunk} chunk=${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE} surviving=${surviving}`);
      expect(surviving).toBe(0);
    }, 180000);

    it('removes prior rows under a DIFFERENT UploadFileID (census replacement, not filename replacement)', async () => {
      await seedFixture();

      await run();

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

      await run();

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

      await run();

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

      await run();

      const after = await scopeDigest(samePlotOtherCensusID);
      console.log(`[control1 same-plot-other-census] before=${JSON.stringify(control1)} after=${JSON.stringify(after)}`);
      expect(after.count).toBe(control1.count);
      expect(after.digest).toBe(control1.digest);
      // Its metric rows — including its own orphan-shaped batch — survive too.
      expect(await metricBatches(samePlotOtherCensusID)).toEqual(['control1-batch']);
    }, 120000);

    it('leaves a DIFFERENT plot/census byte-identical', async () => {
      const { control2 } = await seedFixture();

      await run();

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

      await run();
      expect(await countRows(targetCensusID, 'all')).toBe(0);
    }, 120000);

    // -------------------------------------------------------------------------
    // 5. DELETE-audit trail (#507) — cleanupPreviousFileUploads' own
    //    deleteCoreMeasurementsInBoundedChunksWithAudit must leave Recent
    //    Changes a record of every row it removed, not just remove the row.
    // -------------------------------------------------------------------------

    it("writes one DELETE-audit row per deleted coremeasurements row, with the row's actual prior state (#507)", async () => {
      await seedFixture();
      const before = await countRows(targetCensusID, 'all'); // 17 — see test #1 above
      expect(before).toBeGreaterThan(0);

      await run();

      const auditRows = await deleteAuditRows(targetCensusID);
      console.log(`[delete-audit] target census: ${auditRows.length} audit row(s) for ${before} deleted coremeasurements row(s)`);
      // One audit row per deleted row — not fewer (a dropped row) and not more
      // (a duplicate audit for the same physical delete).
      expect(auditRows).toHaveLength(before);

      const recordIDs = new Set(auditRows.map(row => Number(row.RecordID)));
      expect(recordIDs.size).toBe(before); // every RecordID distinct — no duplicate CoreMeasurementID

      for (const row of auditRows) {
        expect(row.ChangedBy).toBe(TEST_CHANGED_BY);
        const state = rowState(row.OldRowState);
        // OldRowState is the row's OWN last state, not a placeholder: its
        // CoreMeasurementID must match the RecordID it was filed under, and
        // its CensusID must be the census this cleanup actually targeted.
        expect(Number(state.CoreMeasurementID)).toBe(Number(row.RecordID));
        expect(Number(state.CensusID)).toBe(targetCensusID);
      }

      // The one seeded row that was fully ingested (seedIngestedRow) has a
      // non-null StemGUID; its audit entry must carry that forward, proving
      // OldRowState was read from the live row and not synthesized generically.
      const ingestedAudit = auditRows.find(row => rowState(row.OldRowState).StemGUID !== null);
      expect(ingestedAudit).toBeDefined();
      // And at least one parked (failed-ingestion) row's RawTreeTag survives
      // into the audit trail — the parked-row shape, not just the ingested shape.
      const parkedAudit = auditRows.find(row => rowState(row.OldRowState).RawTreeTag !== null);
      expect(parkedAudit).toBeDefined();
    }, 120000);

    it('writes NO DELETE-audit rows for censuses this cleanup did not touch (#507 isolation)', async () => {
      await seedFixture();

      await run();

      const sameplotAudit = await deleteAuditRows(samePlotOtherCensusID);
      const otherPlotAudit = await deleteAuditRows(otherPlotCensusID);
      console.log(`[delete-audit isolation] samePlotOtherCensus=${sameplotAudit.length} otherPlotCensus=${otherPlotAudit.length}`);
      expect(sameplotAudit).toHaveLength(0);
      expect(otherPlotAudit).toHaveLength(0);
    }, 120000);

    it('audits deletes past a single chunk window, not just the first (#507)', async () => {
      const overOneChunk = CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE + 137;
      await connection.query(`SET SESSION cte_max_recursion_depth = ?`, [overOneChunk + 1]);
      await connection.query(
        `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
           UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
         WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
         SELECT ?, NULL, FALSE, '2024-03-15', 1.0, 1.0, ?, 'bulk-prior-batch', CONCAT('A', n), n, 1 FROM seq`,
        [overOneChunk, targetCensusID, PRIOR_FILE_WITH_METRICS]
      );
      expect(await countRows(targetCensusID, 'all')).toBe(overOneChunk);

      await run();

      const auditRows = await deleteAuditRows(targetCensusID);
      console.log(`[delete-audit chunking] seeded=${overOneChunk} chunk=${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE} audited=${auditRows.length}`);
      // Every row across BOTH chunk windows got audited — not just the first
      // CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE-row window the loop processes first.
      expect(auditRows).toHaveLength(overOneChunk);
      expect(await countRows(targetCensusID, 'all')).toBe(0);
    }, 180000);
  });

  // Window-statement shape is pinned on the ArcGIS arm: it runs every window on one caller transaction, so the statement log is one flat sequence.
  describe('cleanupPreviousFileUploads window statements', () => {
    /**
     * Each measurement window deletes its error links by the window's own ids, so no statement
     * scans the census-wide set. A census one window and a remainder long needs exactly two link deletes.
     */
    it("deletes error links per window, by the window's own ids (no census-wide subquery)", async () => {
      const overOneChunk = CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE + 137;
      await connection.query(`SET SESSION cte_max_recursion_depth = ?`, [overOneChunk + 1]);
      await connection.query(
        `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
           UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
         WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
         SELECT ?, NULL, FALSE, '2024-03-15', 1.0, 1.0, ?, 'bulk-prior-batch', CONCAT('E', n), n, 1 FROM seq`,
        [overOneChunk, targetCensusID, PRIOR_FILE_WITH_METRICS]
      );

      await connection.query(
        `INSERT INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage) VALUES ('ingestion','SQL_EXCEPTION','Ingestion SQL exception')
         ON DUPLICATE KEY UPDATE ErrorID = LAST_INSERT_ID(ErrorID)`
      );
      const [errRows] = await connection.query<RowDataPacket[]>(
        `SELECT ErrorID FROM measurement_errors WHERE ErrorSource='ingestion' AND ErrorCode='SQL_EXCEPTION' LIMIT 1`
      );
      await connection.query(
        `INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved, CreatedAt)
         SELECT CoreMeasurementID, ?, FALSE, NOW() FROM coremeasurements WHERE CensusID = ?`,
        [errRows[0].ErrorID, targetCensusID]
      );
      expect(await errorLinkCount(targetCensusID)).toBe(overOneChunk);

      sharedState.statements.length = 0;
      await runCleanupInOneTransaction();

      const errorLinkDeleteStatements = sharedState.statements.filter(sql => /DELETE\s+FROM\s+`[^`]+`\.measurement_error_log/.test(sql));
      const expectedWindows = Math.ceil(overOneChunk / CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE);
      console.log(
        `[error-link chunking] seeded=${overOneChunk} chunk=${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE} ` +
          `statements=${errorLinkDeleteStatements.length} expected=${expectedWindows}`,
        errorLinkDeleteStatements.map(sql => sql.replace(/\s+/g, ' ').slice(0, 120))
      );
      expect(errorLinkDeleteStatements.length, 'one link delete per non-empty window').toBe(expectedWindows);
      for (const statement of errorLinkDeleteStatements) {
        expect(statement, 'link delete must not carry a census-wide subquery').not.toMatch(/SELECT/i);
      }
      expect(await errorLinkCount(targetCensusID)).toBe(0);
      expect(await countRows(targetCensusID, 'all')).toBe(0);
    }, 180000);
  });

  // -------------------------------------------------------------------------
  // 6. Interruption and resume (I3, I8): every window is its own commit
  // -------------------------------------------------------------------------

  async function seedBulkPriorRows(rowCount: number, tagPrefix: string): Promise<void> {
    await connection.query(`SET SESSION cte_max_recursion_depth = ?`, [rowCount + 1]);
    await connection.query(
      `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
         UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
       WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
       SELECT ?, NULL, FALSE, '2024-03-15', 1.0, 1.0, ?, ?, CONCAT(?, n), n, 1 FROM seq`,
      [rowCount, targetCensusID, PRIOR_FILE_WITH_METRICS, BULK_PRIOR_BATCH, tagPrefix]
    );
  }

  async function seedErrorLinkForEveryRowOfTargetCensus(): Promise<void> {
    await connection.query(
      `INSERT INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage) VALUES ('ingestion','SQL_EXCEPTION','Ingestion SQL exception')
       ON DUPLICATE KEY UPDATE ErrorID = LAST_INSERT_ID(ErrorID)`
    );
    const [errorRows] = await connection.query<RowDataPacket[]>(
      `SELECT ErrorID FROM measurement_errors WHERE ErrorSource='ingestion' AND ErrorCode='SQL_EXCEPTION' LIMIT 1`
    );
    await connection.query(
      `INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved, CreatedAt)
       SELECT CoreMeasurementID, ?, FALSE, NOW() FROM coremeasurements WHERE CensusID = ?`,
      [errorRows[0].ErrorID, targetCensusID]
    );
  }

  async function targetCensusMeasurementIDs(): Promise<number[]> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT CoreMeasurementID FROM coremeasurements WHERE CensusID = ? ORDER BY CoreMeasurementID`, [
      targetCensusID
    ]);
    return rows.map(row => Number(row.CoreMeasurementID));
  }

  async function countRowsInBatch(batchID: string): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM coremeasurements WHERE CensusID = ? AND UploadBatchID = ?`, [
      targetCensusID,
      batchID
    ]);
    return Number(rows[0].count);
  }

  async function countSurvivorsWithoutErrorLink(): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM coremeasurements cm
       WHERE cm.CensusID = ? AND NOT EXISTS (SELECT 1 FROM measurement_error_log mel WHERE mel.MeasurementID = cm.CoreMeasurementID)`,
      [targetCensusID]
    );
    return Number(rows[0].count);
  }

  async function sessionMarker(sessionID: string): Promise<unknown> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT ${CENSUS_REPLACEMENT_MARKER_COLUMN} AS marker FROM upload_sessions WHERE session_id = ?`, [
      sessionID
    ]);
    return rows[0].marker;
  }

  async function countPriorMetrics(): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM uploadmetrics WHERE censusID = ? AND batchID LIKE 'prior-%'`, [
      targetCensusID
    ]);
    return Number(rows[0].count);
  }

  function failOnOccurrenceOfStatement(statementPattern: RegExp, occurrence: number) {
    const originalExecuteQuery = connectionManager.executeQuery.bind(connectionManager);
    let matches = 0;
    const spy = vi.spyOn(connectionManager, 'executeQuery').mockImplementation(async (sql: string, params?: unknown[], transactionID?: string) => {
      if (statementPattern.test(sql)) {
        matches += 1;
        if (matches === occurrence) throw new InjectedWindowFailure(statementPattern, occurrence);
      }
      return originalExecuteQuery(sql, params, transactionID);
    });
    return { restore: () => spy.mockRestore() };
  }

  it(
    'I3: interrupted at window 2 commits window 1 with its audits; a retry finishes without a double audit (catches: one transaction for everything; double audit on resume)',
    async () => {
      const seededRowCount = WINDOW_SIZE + SURVIVING_WINDOW_REMAINDER;
      await seedBulkPriorRows(seededRowCount, 'I3T');
      await seedErrorLinkForEveryRowOfTargetCensus();
      await seedMetric(PRIOR_FILE_WITH_METRICS, PRIOR_BATCH_WITH_METRICS, plotID, targetCensusID);
      const seededIDs = await targetCensusMeasurementIDs();
      expect(seededIDs).toHaveLength(seededRowCount);
      await startSession(SESSION_ID.I3);
      const params = buildReplacementParams(SESSION_ID.I3);

      const injection = failOnOccurrenceOfStatement(CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_DELETE, SECOND_WINDOW);
      try {
        await expect(replaceCensusForCleanReupload(connectionManager, params)).rejects.toBeInstanceOf(InjectedWindowFailure);
      } finally {
        injection.restore();
      }

      const survivingIDs = await targetCensusMeasurementIDs();
      const auditedAfterFailure = (await deleteAuditRows(targetCensusID)).map(row => Number(row.RecordID));
      console.log(
        `[I3 after failure] seeded=${seededRowCount} surviving=${survivingIDs.length} audited=${auditedAfterFailure.length} ` +
          `survivorsWithoutLink=${await countSurvivorsWithoutErrorLink()} priorMetrics=${await countPriorMetrics()} marker=${await sessionMarker(SESSION_ID.I3)}`
      );
      expect(survivingIDs, 'window 1 committed, window 2 rolled back').toHaveLength(SURVIVING_WINDOW_REMAINDER);
      expect(auditedAfterFailure, 'audit rows are exactly the W lowest seeded ids').toEqual(seededIDs.slice(0, WINDOW_SIZE));
      expect(
        auditedAfterFailure.filter(recordID => survivingIDs.includes(recordID)),
        'no audit row for a surviving id'
      ).toEqual([]);
      expect(await countSurvivorsWithoutErrorLink(), 'every survivor keeps its error link').toBe(0);
      expect(await countPriorMetrics(), 'the metric is intact until the metrics unit').toBe(1);
      expect(await sessionMarker(SESSION_ID.I3), 'marker stays unset after an interrupted replacement').toBeNull();

      const retry = await replaceCensusForCleanReupload(connectionManager, params);
      const auditedAfterRetry = (await deleteAuditRows(targetCensusID)).map(row => Number(row.RecordID));
      console.log(`[I3 after retry] outcome=${retry.outcome} audited=${auditedAfterRetry.length} distinct=${new Set(auditedAfterRetry).size}`);
      expect(retry.outcome).toBe(REPLACEMENT_OUTCOME.REPLACED);
      expect(auditedAfterRetry, 'one audit row per deleted row, no double audit on resume').toHaveLength(seededRowCount);
      expect(new Set(auditedAfterRetry).size).toBe(seededRowCount);
      expect(await countRows(targetCensusID, 'all')).toBe(0);
      expect(await sessionMarker(SESSION_ID.I3)).not.toBeNull();
    },
    BARRIER_TEST_TIMEOUT_MS
  );

  it(
    'I8: metrics interruption and resume (catches: all metrics in one transaction; marker before the last metrics window; metrics scope losing the family exclusion)',
    async () => {
      const priorMetricCount = WINDOW_SIZE + I8_PRIOR_METRIC_REMAINDER;
      await seedParkedRows(PRIOR_FILE_WITH_METRICS, PRIOR_BATCH_WITH_METRICS, targetCensusID, I8_PRIOR_MEASUREMENT_ROWS);
      await connection.query(`SET SESSION cte_max_recursion_depth = ?`, [priorMetricCount + 1]);
      await connection.query(
        `INSERT INTO uploadmetrics (uploadId, fileID, batchID, schema_name, plotID, censusID, sourceRecords, processedRecords, failedRecords, status, startTime)
       WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
       SELECT CONCAT('upload-prior-metric-', n), ?, CONCAT('prior-metric-', n), ?, ?, ?, 1, 1, 0, 'completed', NOW() FROM seq`,
        [priorMetricCount, PRIOR_FILE_WITH_METRICS, schema, plotID, targetCensusID]
      );
      await seedMetric(INCOMING_FILE, INCOMING_BATCH, plotID, targetCensusID, 'processing');
      await seedMetric(INCOMING_FILE, INCOMING_OWN_SUB_BATCH, plotID, targetCensusID, 'processing');
      expect(await countPriorMetrics()).toBe(priorMetricCount);
      await startSession(SESSION_ID.I8);
      const params = buildReplacementParams(SESSION_ID.I8);

      const injection = failOnOccurrenceOfStatement(CENSUS_REPLACEMENT_STATEMENT.METRICS_DELETE, SECOND_WINDOW);
      try {
        await expect(replaceCensusForCleanReupload(connectionManager, params)).rejects.toBeInstanceOf(InjectedWindowFailure);
      } finally {
        injection.restore();
      }

      console.log(
        `[I8 after failure] measurements=${await countRows(targetCensusID, 'all')} priorMetrics=${await countPriorMetrics()} ` +
          `metricBatches=${(await metricBatches(targetCensusID)).filter(batch => !batch.startsWith('prior-')).join(',')} marker=${await sessionMarker(SESSION_ID.I8)}`
      );
      expect(await countRows(targetCensusID, 'all'), 'the measurement unit committed before the metrics unit failed').toBe(0);
      expect(await countPriorMetrics(), 'only the first metrics window committed').toBe(I8_PRIOR_METRIC_REMAINDER);
      expect((await metricBatches(targetCensusID)).filter(batch => !batch.startsWith('prior-'))).toHaveLength(I8_FAMILY_METRIC_COUNT);
      expect(await sessionMarker(SESSION_ID.I8), 'marker stays unset until the last metrics window committed').toBeNull();

      const retry = await replaceCensusForCleanReupload(connectionManager, params);
      console.log(`[I8 after retry] outcome=${retry.outcome} metricBatches=${JSON.stringify(await metricBatches(targetCensusID))}`);
      expect(retry.outcome).toBe(REPLACEMENT_OUTCOME.REPLACED);
      expect(await countPriorMetrics()).toBe(0);
      expect((await metricBatches(targetCensusID)).sort()).toEqual([INCOMING_BATCH, INCOMING_OWN_SUB_BATCH]);
      expect(await sessionMarker(SESSION_ID.I8)).not.toBeNull();
    },
    BARRIER_TEST_TIMEOUT_MS
  );

  // -------------------------------------------------------------------------
  // 7. The session lock, under the real ConnectionManager (I4, I5, I5b)
  // -------------------------------------------------------------------------

  describe('session lock under a real ConnectionManager', () => {
    let realManager: ConnectionManager;

    beforeAll(async () => {
      const { default: RealConnectionManager } = await vi.importActual<typeof import('@/lib/db/connectionmanager')>('@/lib/db/connectionmanager');
      const host = process.env.AZURE_SQL_SERVER;
      if (!host || !['127.0.0.1', 'localhost', '::1'].includes(host)) {
        throw new Error(`[clean-reupload] Refusing to run: ConnectionManager host "${host}" is not local.`);
      }
      realManager = RealConnectionManager.getInstance();
    });

    async function insertSecondFileFailureRow(): Promise<void> {
      await seedParkedRows(SECOND_FILE_FAILURE.fileID, SECOND_FILE_FAILURE.batchID, targetCensusID, 1);
    }

    async function settle<T>(promise: Promise<T>, label: string, harness: SessionLockHarness): Promise<PromiseSettledResult<T>> {
      const [settled] = await withinDeadline(Promise.allSettled([promise]), label, harness.renderStatementLog);
      return settled;
    }

    async function waitForPeerInSessionRowLockWait(harness: SessionLockHarness): Promise<void> {
      const deadlineAt = Date.now() + BARRIER_DEADLINE_MS;
      while (Date.now() < deadlineAt) {
        const [waiting] = await connection.query<RowDataPacket[]>(
          `SELECT trx_state, trx_query FROM information_schema.INNODB_TRX WHERE trx_state = 'LOCK WAIT' AND trx_query LIKE '%upload_sessions%FOR UPDATE%'`
        );
        if (waiting.length > 0) return;
        await sleep(LOCK_WAIT_POLL_INTERVAL_MS);
      }
      const [openTransactions] = await connection.query<RowDataPacket[]>(`SELECT trx_id, trx_state, trx_query FROM information_schema.INNODB_TRX`);
      console.log(`[I5] open InnoDB transactions at the deadline: ${JSON.stringify(openTransactions)}`);
      throw new BarrierDeadlineError('peer in LOCK WAIT on the session row', harness.renderStatementLog());
    }

    it(
      'I4: a window that finds the marker set under the lock deletes nothing (catches: relying on the preliminary read alone)',
      async () => {
        const seededRowCount = WINDOW_SIZE + I4_EXTRA_PRIOR_ROWS;
        await seedBulkPriorRows(seededRowCount, 'I4T');
        await startSession(SESSION_ID.I4);
        const harness = createSessionLockHarness(realManager);

        await runBarrierScenario(harness, async () => {
          const beforeFirstLock = harness.placeBarrier(FIRST_WINDOW, 'before');
          const runner = harness.track(replaceCensusForCleanReupload(realManager, buildReplacementParams(SESSION_ID.I4)));
          await withinDeadline(beforeFirstLock.reached, 'runner reaching its first session lock', harness.renderStatementLog);

          await connection.query(`UPDATE upload_sessions SET ${CENSUS_REPLACEMENT_MARKER_COLUMN} = CURRENT_TIMESTAMP WHERE session_id = ?`, [SESSION_ID.I4]);
          await insertSecondFileFailureRow();
          beforeFirstLock.release();

          const settled = await settle(runner, 'runner to finish', harness);
          const measurementDeletes = harness.recordedStatements.filter(({ sql }) => CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_DELETE.test(sql));
          const priorRows = await countRowsInBatch(BULK_PRIOR_BATCH);
          const failureRows = await countRowsInBatch(SECOND_FILE_FAILURE.batchID);
          const auditRows = await deleteAuditRows(targetCensusID);
          console.log(
            `[I4] runner=${JSON.stringify(settled)} measurementDeletes=${measurementDeletes.length} priorRows=${priorRows} failureRows=${failureRows} ` +
              `auditRows=${auditRows.length}\n${harness.renderStatementLog()}`
          );
          expect(settled.status).toBe('fulfilled');
          expect(settled.status === 'fulfilled' && settled.value.outcome).toBe(REPLACEMENT_OUTCOME.COMPLETED_BY_PEER);
          expect(measurementDeletes, 'no measurement DELETE once the marker is set').toHaveLength(0);
          expect(priorRows).toBe(seededRowCount);
          expect(failureRows, "the other file's failure row survives").toBe(1);
          expect(auditRows).toHaveLength(0);
        });
      },
      BARRIER_TEST_TIMEOUT_MS
    );

    it(
      "I5: a peer's completion waits for the window holding the session lock, and a later window deletes nothing (catches: a session lock taken with a plain read or not at all; no marker check inside the window)",
      async () => {
        const seededRowCount = WINDOW_SIZE + I4_EXTRA_PRIOR_ROWS;
        await seedBulkPriorRows(seededRowCount, 'I5T');
        await startSession(SESSION_ID.I5);
        const scope = { schema, plotID, censusID: targetCensusID, uploadSessionID: SESSION_ID.I5 };
        const harness = createSessionLockHarness(realManager);

        await runBarrierScenario(harness, async () => {
          const afterFirstLock = harness.placeBarrier(FIRST_WINDOW, 'after');
          const runner = harness.track(replaceCensusForCleanReupload(realManager, buildReplacementParams(SESSION_ID.I5)));
          await withinDeadline(afterFirstLock.reached, 'runner holding its first session lock', harness.renderStatementLog);

          harness.markPeerAboutToStart();
          let peerSettled = false;
          const peer = harness.track(completeCensusReplacement(realManager, scope).finally(() => (peerSettled = true)));
          await waitForPeerInSessionRowLockWait(harness);
          expect(await sessionMarker(SESSION_ID.I5), 'the peer is blocked, so the marker is still unset').toBeNull();
          expect(peerSettled, 'the peer is blocked behind the runner').toBe(false);

          const beforeSecondLock = harness.placeBarrier(SECOND_WINDOW, 'before');
          afterFirstLock.release();
          const peerOutcome = await settle(peer, 'peer to set the marker', harness);
          const runnerFirstTransaction = harness.runnerTransactionIDs[0];
          const peerTransaction = [...harness.peerTransactionIDs][0];
          console.log(
            `[I5] peer=${JSON.stringify(peerOutcome)} commitOrder=${JSON.stringify(harness.commitOrder)} ` +
              `runnerFirstTx=${runnerFirstTransaction} peerTx=${peerTransaction}`
          );
          expect(peerOutcome.status).toBe('fulfilled');
          expect(peerOutcome.status === 'fulfilled' && peerOutcome.value).toBe(REPLACEMENT_OUTCOME.REPLACED);
          expect(harness.commitOrder.indexOf(runnerFirstTransaction), "the runner's window committed").toBeGreaterThanOrEqual(0);
          expect(harness.commitOrder.indexOf(runnerFirstTransaction), "the runner's window committed before the peer's marker").toBeLessThan(
            harness.commitOrder.indexOf(peerTransaction)
          );

          await withinDeadline(beforeSecondLock.reached, 'runner reaching its second session lock', harness.renderStatementLog);
          await insertSecondFileFailureRow();
          beforeSecondLock.release();
          const runnerOutcome = await settle(runner, 'runner to finish', harness);

          const priorRows = await countRowsInBatch(BULK_PRIOR_BATCH);
          const failureRows = await countRowsInBatch(SECOND_FILE_FAILURE.batchID);
          const auditRows = await deleteAuditRows(targetCensusID);
          console.log(
            `[I5] runner=${JSON.stringify(runnerOutcome)} priorRows=${priorRows} failureRows=${failureRows} auditRows=${auditRows.length}\n` +
              harness.renderStatementLog()
          );
          const rejectionMessages = [peerOutcome, runnerOutcome].flatMap(outcome => (outcome.status === 'rejected' ? [String(outcome.reason)] : []));
          expect(rejectionMessages.filter(message => LOCK_CONTENTION_ERROR.test(message))).toEqual([]);
          expect(runnerOutcome.status).toBe('fulfilled');
          expect(runnerOutcome.status === 'fulfilled' && runnerOutcome.value.outcome).toBe(REPLACEMENT_OUTCOME.COMPLETED_BY_PEER);
          expect(failureRows, "the other file's failure row survives").toBe(1);
          expect(priorRows, 'only the first window deleted').toBe(I4_EXTRA_PRIOR_ROWS);
          expect(auditRows).toHaveLength(WINDOW_SIZE);
        });
      },
      BARRIER_TEST_TIMEOUT_MS
    );

    it(
      'I5b: two unbarriered runners of one session stay consistent (end-to-end regression only: windows serialize on the session lock, so this cannot isolate the window FOR UPDATE; U1/U2 pin that)',
      async () => {
        const seededRowCount = 2 * WINDOW_SIZE + I5B_EXTRA_PRIOR_ROWS;
        await seedBulkPriorRows(seededRowCount, 'I5BT');
        await startSession(SESSION_ID.I5B);
        const params = buildReplacementParams(SESSION_ID.I5B);

        const settled = await Promise.allSettled([replaceCensusForCleanReupload(realManager, params), replaceCensusForCleanReupload(realManager, params)]);
        const auditRecordIDs = (await deleteAuditRows(targetCensusID)).map(row => Number(row.RecordID));
        const outcomes = settled.map(result => (result.status === 'fulfilled' ? result.value.outcome : `rejected: ${String(result.reason)}`));
        console.log(
          `[I5b] outcomes=${JSON.stringify(outcomes)} audited=${auditRecordIDs.length} distinct=${new Set(auditRecordIDs).size} ` +
            `remaining=${await countRows(targetCensusID, 'all')} marker=${await sessionMarker(SESSION_ID.I5B)}`
        );
        expect(settled.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
        expect(outcomes.every(outcome => PEER_FINISHED_OUTCOMES.includes(outcome))).toBe(true);
        expect(outcomes).toContain(REPLACEMENT_OUTCOME.REPLACED);
        expect(auditRecordIDs).toHaveLength(seededRowCount);
        expect(new Set(auditRecordIDs).size).toBe(seededRowCount);
        expect(await countRows(targetCensusID, 'all')).toBe(0);
        expect(await sessionMarker(SESSION_ID.I5B)).not.toBeNull();
      },
      BARRIER_TEST_TIMEOUT_MS
    );
  });
});
