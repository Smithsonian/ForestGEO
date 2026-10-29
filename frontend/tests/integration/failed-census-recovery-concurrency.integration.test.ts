/**
 * Failed-first-census recovery against concurrent writers (#562) — Integration Tests
 *
 * The recovery runs in separately committed transactions. Each takes the census row FOR UPDATE before its guard,
 * so a writer of the census (which holds a shared lock on the census row through its foreign keys) either
 * finishes first and is seen by the guard, or waits until the recovery transaction commits. These tests run the
 * real ConnectionManager (one pooled connection per transaction) against local MySQL.
 *   I5  a census writer started between a recovery transaction's guard and its commit waits, and none of its rows is deleted or cascaded
 *   I8  two unbarriered runners of one census finish without a lock error and every row is audited exactly once
 *
 * Prerequisites: docker compose up -d mysql. Run only through the relay's integration lock script.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import {
  cleanupTestMeasurements,
  createAdditionalCensus,
  setupTestDatabase,
  teardownTestDatabase,
  type TestData,
  type TestDatabaseConfig
} from '../setup/local-db-setup';
import { CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE } from '@/lib/ingestion/temporary-measurements';
import { recoverFailedInitialCensusInBoundedTransactions, type FailedCensusRecoveryResult } from '@/lib/uploads/ingest-batch';
import { WINDOW_WALK_STATEMENT } from '../setup/core-measurement-window-statements';
import { createStatementHarness, matching, runBarrierScenario, waitForLockWait, withinDeadline } from '../setup/core-measurement-window-harness';
import {
  countOf,
  deleteAuditCounts,
  fixtureUploadID,
  openSideConnection,
  seedIntegrityAlert,
  seedUnresolvedMeasurements,
  seedUploadMetric,
  stageIncomingRows,
  UPLOAD_STATUS
} from '../setup/unresolved-measurement-fixtures';

vi.mock('@/ailogger', () => ({
  default: {
    info: (message: string, context?: unknown) => console.log(`[ailogger.info] ${message} ${context ? JSON.stringify(context) : ''}`),
    warn: (message: string, context?: unknown) => console.log(`[ailogger.warn] ${message} ${context ? JSON.stringify(context) : ''}`),
    error: (message: string) => console.log(`[ailogger.error] ${message}`),
    debug: () => undefined
  }
}));

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];
for (const host of [process.env.AZURE_SQL_SERVER, process.env.TEST_DB_HOST || 'localhost']) {
  if (!host || !LOCAL_HOSTS.includes(host)) throw new Error(`REFUSING TO RUN: host '${host}' is not local. This suite writes and deletes measurement rows.`);
}

const WINDOW = CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE;
const HELD_BACK_ROWS = 5;
const ROWS_PAST_TWO_WINDOWS = 137;
const CONTROL_CENSUS_ROWS = 4;
const STALE_STAGED_ROWS = 2;
const INCOMING_STAGED_ROWS = 3;
const INCOMING_FILE = 'concurrency-incoming.csv';
const INCOMING_BATCH = 'concurrency-incoming-batch';
const FAILED_FIRST_LOAD_FILE = 'concurrency-failed-first-load.csv';
const FAILED_FIRST_LOAD_BATCH = 'concurrency-failed__sub001';
const CONTROL_CENSUS_BATCH = 'concurrency-control-census';
const WRITER_FILE = 'concurrency-writer.csv';
const WRITER_BATCH = 'concurrency-writer-batch';
const WRITER_TREE_TAG = 'I5TREE';
const WRITER_STEM_TAG = '1';
const WRITER_MEASUREMENT_DATE = '2024-03-15';
const WRITER_MEASURED_DBH = 5.0;
const WRITER_MEASURED_HOM = 1.3;
const CHANGED_BY = 'recovery-concurrency-test';
const WRITER_LOCK_WAIT_SECONDS = 30;
const CONCURRENCY_TEST_TIMEOUT_MS = 180_000;
const FIRST_GUARD_OCCURRENCE = 1;
const CONTROL_CENSUS = { plotCensusNumber: 95, startDate: '2023-01-01', endDate: '2023-12-31' };
const SEED_SPECIES_CODE = 'ACERRU';
const SEED_QUADRAT_NAME = 'Q01';

describe('failed-first-census recovery under concurrent census writers (#562)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;
  let schema: string;
  let plotID: number;
  let censusID: number;
  let controlCensusID: number;
  let speciesID: number;
  let quadratID: number;
  let realManager: ConnectionManager;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    schema = config.database;
    plotID = testData.plots[0].plotID;
    censusID = testData.census[0].censusID;
    controlCensusID = (await createAdditionalCensus(connection, testData, CONTROL_CENSUS)).censusID;
    const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species WHERE SpeciesCode = ?', [SEED_SPECIES_CODE]);
    speciesID = Number(speciesRows[0].SpeciesID);
    const [quadratRows] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ?', [
      SEED_QUADRAT_NAME,
      plotID
    ]);
    quadratID = Number(quadratRows[0].QuadratID);
    const { default: RealConnectionManager } = await vi.importActual<typeof import('@/lib/db/connectionmanager')>('@/lib/db/connectionmanager');
    realManager = RealConnectionManager.getInstance();
    console.log(`[setup] schema=${schema} plot=${plotID} census=${censusID} control=${controlCensusID} species=${speciesID} quadrat=${quadratID}`);
  }, 120_000);

  afterAll(async () => {
    try {
      await getPoolMonitorInstance().closeAllConnections();
    } finally {
      await teardownTestDatabase(connection, config);
    }
  });

  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData, { additionalTables: ['unifiedchangelog'] });
  });

  /** A failed first load of `censusID` (unresolved rows, a failed metric, an alert, stale staged rows) plus the incoming file's staged rows and a control census's rows. */
  async function seedDueCensus(rows: number): Promise<number[]> {
    const ids = await seedUnresolvedMeasurements(connection, {
      censusID,
      fileID: FAILED_FIRST_LOAD_FILE,
      batchID: FAILED_FIRST_LOAD_BATCH,
      count: rows,
      tagPrefix: 'DUE'
    });
    await seedUploadMetric(connection, {
      schema,
      plotID,
      censusID,
      fileID: FAILED_FIRST_LOAD_FILE,
      batchID: FAILED_FIRST_LOAD_BATCH,
      status: UPLOAD_STATUS.FAILED
    });
    await seedIntegrityAlert(connection, { plotID, censusID, fileID: FAILED_FIRST_LOAD_FILE, batchID: FAILED_FIRST_LOAD_BATCH });
    await stageIncomingRows(connection, {
      fileID: FAILED_FIRST_LOAD_FILE,
      batchID: FAILED_FIRST_LOAD_BATCH,
      plotID,
      censusID,
      count: STALE_STAGED_ROWS,
      tagPrefix: 'STALE'
    });
    await stageIncomingRows(connection, {
      fileID: INCOMING_FILE,
      batchID: INCOMING_BATCH,
      plotID,
      censusID,
      count: INCOMING_STAGED_ROWS,
      tagPrefix: 'IN'
    });
    await seedUnresolvedMeasurements(connection, {
      censusID: controlCensusID,
      fileID: FAILED_FIRST_LOAD_FILE,
      batchID: CONTROL_CENSUS_BATCH,
      count: CONTROL_CENSUS_ROWS,
      tagPrefix: 'CTRL'
    });
    return ids;
  }

  function recover(): Promise<FailedCensusRecoveryResult> {
    return recoverFailedInitialCensusInBoundedTransactions(realManager, {
      schema,
      fileID: INCOMING_FILE,
      batchID: INCOMING_BATCH,
      plotID,
      censusID,
      changedBy: CHANGED_BY
    });
  }

  /** A real writer of the census: tree, stem, resolved measurement and a completed upload metric, in one transaction it commits. */
  async function writeCompletedUpload(writer: Connection, treeInsertStarted: () => void): Promise<{ treeID: number; stemGUID: number; measurementID: number }> {
    await writer.beginTransaction();
    const treeInsert = writer.query<ResultSetHeader>('INSERT INTO trees (TreeTag, SpeciesID, CensusID) VALUES (?, ?, ?)', [
      WRITER_TREE_TAG,
      speciesID,
      censusID
    ]);
    treeInsertStarted();
    const [tree] = await treeInsert;
    const [stem] = await writer.query<ResultSetHeader>('INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY) VALUES (?, ?, ?, ?, 0, 0)', [
      tree.insertId,
      quadratID,
      censusID,
      WRITER_STEM_TAG
    ]);
    const [measurement] = await writer.query<ResultSetHeader>(
      `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, UploadFileID, UploadBatchID, IsActive)
       VALUES (?, ?, TRUE, ?, ?, ?, ?, ?, 1)`,
      [censusID, stem.insertId, WRITER_MEASUREMENT_DATE, WRITER_MEASURED_DBH, WRITER_MEASURED_HOM, WRITER_FILE, WRITER_BATCH]
    );
    await writer.query(
      'INSERT INTO uploadmetrics (uploadId, fileID, batchID, schema_name, plotID, censusID, status, startTime) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
      [fixtureUploadID('writer', WRITER_FILE, WRITER_BATCH), WRITER_FILE, WRITER_BATCH, schema, plotID, censusID, UPLOAD_STATUS.COMPLETED]
    );
    await writer.commit();
    return { treeID: Number(tree.insertId), stemGUID: Number(stem.insertId), measurementID: Number(measurement.insertId) };
  }

  it.each([
    ['(a) window 1', WINDOW + HELD_BACK_ROWS, 'superseded', WINDOW],
    ['(b) the final transaction', HELD_BACK_ROWS, 'recovered', HELD_BACK_ROWS]
  ] as const)(
    'I5 %s: a census writer started between the guard and the commit waits for the recovery transaction, and none of its rows is deleted or cascaded (catches: a guard without the census lock)',
    async (label, seededRows, expectedOutcome, expectedDeleted) => {
      const dirtyIDs = await seedDueCensus(seededRows);
      const writer = await openSideConnection(schema, WRITER_LOCK_WAIT_SECONDS);
      const harness = createStatementHarness(realManager);
      try {
        await runBarrierScenario(harness, async () => {
          const afterGuard = harness.placeBarrier(matching(WINDOW_WALK_STATEMENT.COMPLETED_UPLOADS_GUARD), FIRST_GUARD_OCCURRENCE, 'after');
          const recovery = harness.track(recover());
          await withinDeadline(afterGuard.reached, `recovery past its first guard in ${label}`, harness.renderStatementLog);
          let writerStarted = false;
          const writing = harness.track(
            writeCompletedUpload(writer, () => {
              writerStarted = true;
            })
          );
          await waitForLockWait(
            connection,
            { schema, table: 'census', lockData: String(censusID) },
            harness,
            `writer waiting on the census row during ${label}`
          );
          expect(writerStarted, 'the writer issued its tree insert before the lock wait was observed').toBe(true);
          afterGuard.release();
          const written = await withinDeadline(writing, `writer to commit in ${label}`, harness.renderStatementLog);
          const result = await withinDeadline(recovery, `recovery to finish in ${label}`, harness.renderStatementLog);
          const audits = await deleteAuditCounts(connection, censusID);
          const survivors = {
            tree: await countOf(connection, 'SELECT COUNT(*) AS total FROM trees WHERE TreeID = ?', [written.treeID]),
            stem: await countOf(connection, 'SELECT COUNT(*) AS total FROM stems WHERE StemGUID = ?', [written.stemGUID]),
            measurement: await countOf(connection, 'SELECT COUNT(*) AS total FROM coremeasurements WHERE CoreMeasurementID = ?', [written.measurementID]),
            control: await countOf(connection, 'SELECT COUNT(*) AS total FROM coremeasurements WHERE CensusID = ?', [controlCensusID])
          };
          console.log(
            `[I5 ${label}] result=${JSON.stringify(result)} written=${JSON.stringify(written)} survivors=${JSON.stringify(survivors)} commitOrder=${JSON.stringify(harness.commitOrder)}\n${harness.renderStatementLog()}`
          );
          expect(result.outcome, `recovery outcome in ${label}`).toBe(expectedOutcome);
          expect(result.deletedRows, `rows deleted by the recovery in ${label}`).toBe(expectedDeleted);
          expect(survivors, `the writer's tree, stem and measurement, and the control census, after ${label}`).toEqual({
            tree: 1,
            stem: 1,
            measurement: 1,
            control: CONTROL_CENSUS_ROWS
          });
          expect(audits.has(written.measurementID), 'the writer’s measurement is never audited as deleted').toBe(false);
          expect(
            dirtyIDs.slice(0, expectedDeleted).every(id => audits.get(id)?.count === 1),
            `each of the ${expectedDeleted} deleted rows has exactly one DELETE audit`
          ).toBe(true);
          expect(audits.size, 'DELETE audits exist only for the deleted rows').toBe(expectedDeleted);
        });
      } finally {
        await writer.end();
      }
    },
    CONCURRENCY_TEST_TIMEOUT_MS
  );

  it(
    'I8: two unbarriered recovery runners of one census both finish without a lock error and every row is audited once (catches: double audit; a runner deleting outside its lock)',
    async () => {
      const dirtyIDs = await seedDueCensus(2 * WINDOW + ROWS_PAST_TWO_WINDOWS);
      const [first, second] = await Promise.allSettled([recover(), recover()]);
      const audits = await deleteAuditCounts(connection, censusID);
      const evidence = {
        remaining: await countOf(connection, 'SELECT COUNT(*) AS total FROM coremeasurements WHERE CensusID = ?', [censusID]),
        incomplete: await countOf(connection, "SELECT COUNT(*) AS total FROM uploadmetrics WHERE censusID = ? AND status IN ('failed', 'processing')", [
          censusID
        ]),
        alerts: await countOf(connection, 'SELECT COUNT(*) AS total FROM uploadintegrityalerts WHERE censusID = ?', [censusID]),
        staleStaged: await countOf(connection, 'SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ?', [FAILED_FIRST_LOAD_FILE]),
        control: await countOf(connection, 'SELECT COUNT(*) AS total FROM coremeasurements WHERE CensusID = ?', [controlCensusID])
      };
      console.log(`[I8] first=${JSON.stringify(first)} second=${JSON.stringify(second)} evidence=${JSON.stringify(evidence)} audited=${audits.size}`);
      expect([first.status, second.status], `runner outcomes: ${JSON.stringify([first, second])}`).toEqual(['fulfilled', 'fulfilled']);
      const results = [first, second].map(settled => (settled as PromiseFulfilledResult<FailedCensusRecoveryResult>).value);
      expect(
        results.some(result => result.outcome === 'recovered'),
        'one runner recovered the census'
      ).toBe(true);
      expect(
        results.every(result => result.outcome === 'recovered' || result.outcome === 'not_due'),
        `the other runner recovered or found nothing due: ${JSON.stringify(results)}`
      ).toBe(true);
      expect(
        results.reduce((sum, result) => sum + result.deletedRows, 0),
        'rows deleted, summed over both runners'
      ).toBe(dirtyIDs.length);
      expect(audits.size, 'distinct audited RecordIDs').toBe(dirtyIDs.length);
      expect(
        dirtyIDs.every(id => audits.get(id)?.count === 1),
        'every deleted row has exactly one DELETE audit'
      ).toBe(true);
      expect(evidence).toEqual({ remaining: 0, incomplete: 0, alerts: 0, staleStaged: 0, control: CONTROL_CENSUS_ROWS });
    },
    CONCURRENCY_TEST_TIMEOUT_MS
  );
});
