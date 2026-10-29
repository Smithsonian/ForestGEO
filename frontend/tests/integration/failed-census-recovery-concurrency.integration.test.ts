/**
 * Failed-first-census recovery against concurrent writers (#562) — Integration Tests
 *
 * The recovery runs in separately committed transactions. Each takes the census row FOR UPDATE before its guard,
 * so a writer of the census (which holds a shared lock on the census row through its foreign keys) either
 * finishes first and is seen by the guard, or waits until the recovery transaction commits. These tests run the
 * real ConnectionManager (one pooled connection per transaction) against local MySQL.
 *   I5  a census writer started between a recovery transaction's guard and its commit waits, and none of its rows is deleted or cascaded
 *   I8  two unbarriered runners of one census finish without a lock error and every row is audited exactly once
 *   I12 ingestion's CALL waits on a recovery transaction's census lock before it writes anything, then completes once
 *   I14 the failure transfer (give-up, mid-batch cleanup) waits on a recovery transaction's census lock before its snapshot and audits once
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
import {
  ingestBatch,
  recoverFailedInitialCensusInBoundedTransactions,
  type FailedCensusRecoveryResult,
  type IngestBatchResult
} from '@/lib/uploads/ingest-batch';
import { WINDOW_WALK_STATEMENT } from '../setup/core-measurement-window-statements';
import {
  createStatementHarness,
  deadlockShapedError,
  matching,
  runBarrierScenario,
  waitForLockWait,
  withinDeadline
} from '../setup/core-measurement-window-harness';
import {
  CLEAN_FIXTURE_ROW_COUNT,
  countOf,
  deleteAuditCounts,
  fixtureUploadID,
  openSideConnection,
  seedIntegrityAlert,
  seedUnresolvedMeasurements,
  seedUploadMetric,
  stageCleanFixtureRows,
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
const CLEAN_FILE = 'concurrency-clean.csv';
const CLEAN_BATCH = 'concurrency-clean-batch';
const COMPLETED_FILE = 'concurrency-completed.csv';
const COMPLETED_BATCH = 'concurrency-completed-batch';
const COREMEASUREMENTS_TABLE = 'coremeasurements';
const INSERT_OPERATION = 'INSERT';
const NO_BACKOFF_JITTER = 0;
const SEED_SPECIES_CODE = 'ACERRU';
const SEED_QUADRAT_NAME = 'Q01';
const SUB_BATCH_CENSUS_SHARE_LOCK = /^\s*SELECT CensusID FROM\s+\S+\.census WHERE CensusID = \? FOR SHARE\s*$/;
const G_STALE_ROWS = 3;
const NO_STALE_ROWS = 0;
const I12_OTHER_FAILED_FILE = 'concurrency-i12-failed.csv';
const I12_OTHER_FAILED_BATCH = 'concurrency-i12-failed__sub001';
const TABLE_LOCK_TYPE = 'TABLE';
const RECORD_LOCK_TYPE = 'RECORD';
const INTENTION_SHARED_LOCK_MODE = 'IS';
const SHARED_RECORD_LOCK_MODE = 'S,REC_NOT_GAP';
const GRANTED_LOCK_STATUS = 'GRANTED';
const WAITING_LOCK_STATUS = 'WAITING';
const PRIMARY_INDEX = 'PRIMARY';
const KILLED_STATEMENT_ERROR_CODE = 'ER_QUERY_INTERRUPTED';
const KILLED_STATEMENT_ERRNO = 1317;
const SUB_BATCH_ATTEMPT_STATEMENTS_BEFORE_TRANSFER = 2;

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

  /** The shared clean rows (tests/setup/unresolved-measurement-fixtures.ts) staged as one family through the production path. */
  async function stageCleanFamily(): Promise<void> {
    const inserted = await stageCleanFixtureRows(realManager, { schema, fileName: CLEAN_FILE, batchID: CLEAN_BATCH, plotID, censusID, changedBy: CHANGED_BY });
    expect(inserted).toBe(CLEAN_FIXTURE_ROW_COUNT);
  }

  /** Every lock (granted and waiting) the transaction holds or requests, from performance_schema.data_locks. */
  async function locksOf(
    trxID: string
  ): Promise<Array<{ table: string; index: string | null; type: string; mode: string; status: string; data: string | null }>> {
    const [locks] = await connection.query<RowDataPacket[]>(
      `SELECT OBJECT_NAME, INDEX_NAME, LOCK_TYPE, LOCK_MODE, LOCK_STATUS, LOCK_DATA FROM performance_schema.data_locks
       WHERE ENGINE_TRANSACTION_ID = ? AND OBJECT_SCHEMA = ? ORDER BY LOCK_TYPE, OBJECT_NAME, INDEX_NAME`,
      [trxID, schema]
    );
    return locks.map(lock => ({
      table: String(lock.OBJECT_NAME),
      index: lock.INDEX_NAME === null ? null : String(lock.INDEX_NAME),
      type: String(lock.LOCK_TYPE),
      mode: String(lock.LOCK_MODE),
      status: String(lock.LOCK_STATUS),
      data: lock.LOCK_DATA === null ? null : String(lock.LOCK_DATA)
    }));
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

  it.each([
    ['window 1, after its DELETE-audit insert', WINDOW_WALK_STATEMENT.DELETE_AUDIT, 2 * WINDOW + HELD_BACK_ROWS],
    ['the final transaction, after its stems DELETE', WINDOW_WALK_STATEMENT.STEMS_DELETE, 2 * WINDOW + HELD_BACK_ROWS]
  ] as const)(
    'I13(a) recovery is the victim at %s: that whole transaction re-runs from the census lock and the census ends recovered with one audit per row (catches: no recovery retry; replay inside the rolled-back transaction; double audit)',
    async (label, injectedAfter, seededRows) => {
      const dirtyIDs = await seedDueCensus(seededRows);
      const harness = createStatementHarness(realManager);
      let result: FailedCensusRecoveryResult | undefined;
      let injection!: { fired(): boolean };
      await runBarrierScenario(harness, async () => {
        injection = harness.injectAfter(matching(injectedAfter), 1, deadlockShapedError);
        result = await withinDeadline(harness.track(recover()), `recovery with a deadlock at ${label}`, harness.renderStatementLog);
      });
      const victimTransaction = harness.transactionsRunning(matching(injectedAfter))[0];
      const audits = await deleteAuditCounts(connection, censusID);
      console.log(
        `[I13a ${label}] result=${JSON.stringify(result)} fired=${injection.fired()} victim=${victimTransaction} rollbacks=${JSON.stringify(harness.rollbackOrder)}\n${harness.renderStatementLog()}`
      );
      expect(injection.fired(), 'the injection fired on the named statement').toBe(true);
      expect(harness.rollbackOrder, 'the victim transaction was rolled back').toContain(victimTransaction);
      expect(result, `recovery result: ${JSON.stringify(result)}`).toMatchObject({ outcome: 'recovered', deletedRows: dirtyIDs.length, deadlockRetries: 1 });
      expect(
        dirtyIDs.every(id => audits.get(id)?.count === 1),
        'every dirty row is audited exactly once'
      ).toBe(true);
      expect(audits.size, 'DELETE audits exist only for the dirty rows').toBe(dirtyIDs.length);
      expect(
        await countOf(connection, "SELECT COUNT(*) AS total FROM uploadmetrics WHERE censusID = ? AND status IN ('failed', 'processing')", [censusID]),
        'incomplete upload metrics are gone'
      ).toBe(0);
    },
    CONCURRENCY_TEST_TIMEOUT_MS
  );

  it(
    'I13(b) ingestion is the victim after its CALL returned: processSubBatch rolls the attempt back and retries, the sub-batch is ingested once, staging consumed once, audits unique (catches: lost staging; double audit; a retry path regression)',
    async () => {
      await seedUploadMetric(connection, { schema, plotID, censusID, fileID: COMPLETED_FILE, batchID: COMPLETED_BATCH, status: UPLOAD_STATUS.COMPLETED });
      await stageCleanFamily();
      const harness = createStatementHarness(realManager);
      let result: IngestBatchResult | undefined;
      let injection!: { fired(): boolean };
      vi.spyOn(Math, 'random').mockReturnValue(NO_BACKOFF_JITTER);
      await runBarrierScenario(harness, async () => {
        injection = harness.injectAfter(matching(WINDOW_WALK_STATEMENT.BULK_INGESTION_CALL), 1, deadlockShapedError);
        result = await withinDeadline(
          harness.track(
            ingestBatch(realManager, { schema, fileID: CLEAN_FILE, batchID: CLEAN_BATCH, expectedScope: { plotID, censusID }, changedBy: CHANGED_BY })
          ),
          'ingestBatch with a deadlock after its CALL',
          harness.renderStatementLog
        );
      });
      const resolved = await countOf(connection, 'SELECT COUNT(*) AS total FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NOT NULL', [
        CLEAN_FILE
      ]);
      const unresolved = await countOf(connection, 'SELECT COUNT(*) AS total FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NULL', [CLEAN_FILE]);
      const staged = await countOf(connection, 'SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ?', [CLEAN_FILE]);
      const [insertAudits] = await connection.query<RowDataPacket[]>(
        `SELECT RecordID, COUNT(*) AS auditRows FROM unifiedchangelog WHERE TableName = ? AND Operation = ? AND CensusID = ? GROUP BY RecordID`,
        [COREMEASUREMENTS_TABLE, INSERT_OPERATION, censusID]
      );
      console.log(
        `[I13b] fired=${injection.fired()} subBatches=${JSON.stringify(result?.subBatchResults)} resolved=${resolved} unresolved=${unresolved} staged=${staged} insertAudits=${JSON.stringify(insertAudits)}\n${harness.renderStatementLog()}`
      );
      expect(injection.fired(), 'the injection fired after the CALL returned').toBe(true);
      expect(result!.subBatchResults[0].attemptsNeeded, 'the first attempt was rolled back and the second succeeded').toBe(2);
      expect(resolved, 'rows resolved for the file').toBe(CLEAN_FIXTURE_ROW_COUNT);
      expect(unresolved, 'no row moved to unresolved').toBe(0);
      expect(staged, 'staged rows consumed').toBe(0);
      expect(insertAudits, `INSERT audit RecordIDs: ${JSON.stringify(insertAudits)}`).toHaveLength(CLEAN_FIXTURE_ROW_COUNT);
      expect(
        insertAudits.every(row => Number(row.auditRows) === 1),
        'each INSERT audit RecordID appears once'
      ).toBe(true);
    },
    CONCURRENCY_TEST_TIMEOUT_MS
  );

  it.each([
    ['a', 'window 1', 'superseded', WINDOW, NO_STALE_ROWS],
    ['b', 'the final transaction', 'recovered', HELD_BACK_ROWS, NO_STALE_ROWS],
    ['c', "window 1, which also holds the ingesting family's own stale rows", 'superseded', WINDOW, G_STALE_ROWS]
  ] as const)(
    'I12(%s) serialization: ingestion sub-batch transaction waits on the census row, before its snapshot and holding no lock, while a recovery transaction in %s holds it; after the commit it snapshots, completes once and audits each row once (catches: a snapshot taken before the census lock; a lost or doubly-ingested family; double audit)',
    async (variant, label, expectedOutcome, expectedDeleted, ingestingFamilyStaleRows) => {
      await stageCleanFamily();
      await seedUploadMetric(connection, { schema, plotID, censusID, fileID: CLEAN_FILE, batchID: CLEAN_BATCH, status: UPLOAD_STATUS.FAILED });
      const harness = createStatementHarness(realManager);
      let ingestion!: Promise<IngestBatchResult>;
      let recovery!: Promise<FailedCensusRecoveryResult>;
      const residueIDs: number[] = [];
      await runBarrierScenario(harness, async () => {
        const beforeCensusShare = harness.placeBarrier(matching(SUB_BATCH_CENSUS_SHARE_LOCK), FIRST_GUARD_OCCURRENCE, 'before');
        ingestion = harness.track(
          ingestBatch(realManager, { schema, fileID: CLEAN_FILE, batchID: CLEAN_BATCH, expectedScope: { plotID, censusID }, changedBy: CHANGED_BY })
        );
        await withinDeadline(beforeCensusShare.reached, "ingestion parked before its sub-batch transaction's census lock", harness.renderStatementLog);
        const ingestionTransactionID = harness.statements.at(-1)!.transactionID!;
        const [threadRow] = (await realManager.executeQuery('SELECT CONNECTION_ID() AS threadID', [], ingestionTransactionID)) as Array<{ threadID: number }>;
        const ingestionThreadID = Number(threadRow.threadID);

        if (ingestingFamilyStaleRows > NO_STALE_ROWS) {
          residueIDs.push(
            ...(await seedUnresolvedMeasurements(connection, {
              censusID,
              fileID: CLEAN_FILE,
              batchID: CLEAN_BATCH,
              count: ingestingFamilyStaleRows,
              tagPrefix: 'GSTALE'
            }))
          );
        }
        residueIDs.push(
          ...(await seedUnresolvedMeasurements(connection, {
            censusID,
            fileID: I12_OTHER_FAILED_FILE,
            batchID: I12_OTHER_FAILED_BATCH,
            count: (variant === 'b' ? HELD_BACK_ROWS : WINDOW + HELD_BACK_ROWS) - ingestingFamilyStaleRows,
            tagPrefix: 'I12F'
          }))
        );

        const afterGuard = harness.placeBarrier(matching(WINDOW_WALK_STATEMENT.COMPLETED_UPLOADS_GUARD), FIRST_GUARD_OCCURRENCE, 'after');
        recovery = harness.track(
          recoverFailedInitialCensusInBoundedTransactions(realManager, {
            schema,
            fileID: CLEAN_FILE,
            batchID: CLEAN_BATCH,
            plotID,
            censusID,
            changedBy: CHANGED_BY
          })
        );
        await withinDeadline(afterGuard.reached, `recovery past its guard in ${label}`, harness.renderStatementLog);

        beforeCensusShare.release();
        const waiting = await waitForLockWait(
          connection,
          { schema, table: 'census', lockData: String(censusID), threadID: ingestionThreadID },
          harness,
          'ingestion waiting on census.PRIMARY'
        );
        const ingestionStatements = harness.statements.filter(statement => statement.transactionID === ingestionTransactionID);
        expect(
          ingestionStatements.some(
            statement => WINDOW_WALK_STATEMENT.BULK_INGESTION_CALL.test(statement.sql) || WINDOW_WALK_STATEMENT.PRE_CALL_SNAPSHOT.test(statement.sql)
          ),
          'ingestion has neither snapshotted nor issued its CALL: it waits on the first statement of its transaction'
        ).toBe(false);
        const locksHeldWhileWaiting = await locksOf(String(waiting.trx_id));
        console.log(
          `[I12 ${variant}] ingestionTx=${ingestionTransactionID} thread=${ingestionThreadID} waiting=${JSON.stringify(waiting)}\n` +
            `locks=${JSON.stringify(locksHeldWhileWaiting)}`
        );
        expect(waiting.LOCK_MODE, 'ingestion requests a shared record lock on the census row').toBe(SHARED_RECORD_LOCK_MODE);
        expect(locksHeldWhileWaiting, 'ingestion holds no row lock and no write lock yet: only the census intention lock and its waiting request').toEqual([
          { table: 'census', index: PRIMARY_INDEX, type: RECORD_LOCK_TYPE, mode: SHARED_RECORD_LOCK_MODE, status: WAITING_LOCK_STATUS, data: String(censusID) },
          { table: 'census', index: null, type: TABLE_LOCK_TYPE, mode: INTENTION_SHARED_LOCK_MODE, status: GRANTED_LOCK_STATUS, data: null }
        ]);

        afterGuard.release();
        await withinDeadline(Promise.allSettled([ingestion, recovery]), 'both sides to settle', harness.renderStatementLog);
      });

      const [ingestionSettled, recoverySettled] = await Promise.allSettled([ingestion, recovery]);
      console.log(`[I12 ${variant}] settled ingestion=${ingestionSettled.status} recovery=${recoverySettled.status}`);
      expect([ingestionSettled.status, recoverySettled.status], 'neither side failed (no 1213 or other error)').toEqual(['fulfilled', 'fulfilled']);
      const ingestionResult = (ingestionSettled as PromiseFulfilledResult<IngestBatchResult>).value;
      const recoveryResult = (recoverySettled as PromiseFulfilledResult<FailedCensusRecoveryResult>).value;
      const deleteAudits = await deleteAuditCounts(connection, censusID);
      const [insertAudits] = await connection.query<RowDataPacket[]>(
        `SELECT RecordID, COUNT(*) AS auditRows FROM unifiedchangelog WHERE TableName = ? AND Operation = ? AND CensusID = ? GROUP BY RecordID`,
        [COREMEASUREMENTS_TABLE, INSERT_OPERATION, censusID]
      );
      console.log(
        `[I12 ${variant}] recovery=${JSON.stringify(recoveryResult)} ingestionAttempts=${ingestionResult.subBatchResults[0].attemptsNeeded} ` +
          `deleteAudits=${JSON.stringify([...deleteAudits])}\n${harness.renderStatementLog()}`
      );
      expect(ingestionResult.subBatchResults[0].attemptsNeeded, 'ingestion needed no retry').toBe(1);
      expect(recoveryResult.deadlockRetries, 'recovery met no deadlock').toBe(0);
      expect(
        { outcome: recoveryResult.outcome, deletedRows: recoveryResult.deletedRows },
        `recovery result in ${label}: ${JSON.stringify(recoveryResult)}`
      ).toEqual({
        outcome: expectedOutcome,
        deletedRows: expectedDeleted
      });
      expect(
        await countOf(connection, 'SELECT COUNT(*) AS total FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NOT NULL', [CLEAN_FILE]),
        'G ingested once'
      ).toBe(CLEAN_FIXTURE_ROW_COUNT);
      expect(
        await countOf(connection, 'SELECT COUNT(*) AS total FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NULL', [CLEAN_FILE]),
        'no unresolved row left for G'
      ).toBe(0);
      expect(await countOf(connection, 'SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ?', [CLEAN_FILE]), 'G staging consumed').toBe(0);
      expect(
        [...deleteAudits.values()].every(audit => audit.count === 1),
        `DELETE-audit RecordIDs unique: ${JSON.stringify([...deleteAudits])}`
      ).toBe(true);
      expect(insertAudits, `INSERT audit RecordIDs: ${JSON.stringify(insertAudits)}`).toHaveLength(CLEAN_FIXTURE_ROW_COUNT);
      expect(
        insertAudits.every(row => Number(row.auditRows) === 1),
        'INSERT-audit RecordIDs unique'
      ).toBe(true);
      const recoveredResidueIDs = residueIDs.slice(0, expectedDeleted);
      const survivingResidueIDs = residueIDs.slice(expectedDeleted);
      for (const id of recoveredResidueIDs) {
        expect(
          await countOf(connection, 'SELECT COUNT(*) AS total FROM coremeasurements WHERE CoreMeasurementID = ?', [id]),
          `recovered residue ${id} is gone`
        ).toBe(0);
        expect(deleteAudits.get(id)?.count, `recovered residue ${id} has exactly one DELETE audit`).toBe(1);
      }
      for (const id of survivingResidueIDs) {
        expect(await countOf(connection, 'SELECT COUNT(*) AS total FROM coremeasurements WHERE CoreMeasurementID = ?', [id]), `residue ${id} survives`).toBe(1);
        expect(deleteAudits.has(id), `residue ${id} was never audited as deleted`).toBe(false);
      }
    },
    CONCURRENCY_TEST_TIMEOUT_MS
  );

  it.each([
    ['give-up', 'the CALL is KILLed, so processSubBatch gives up and moves the sub-batch'],
    ['cleanup', 'the attempt fails and the upload is aborted, so ingestBatch moves the remaining sub-batches']
  ] as const)(
    "I14(%s) the failure transfer waits on the census row before its snapshot while a recovery window that deletes the family's own stale rows holds it, then moves the rows once and audits each row once (catches: a transfer snapshot taken before the census lock, which audits the recovery's DELETEs a second time and fails the transfer)",
    async (route, routeDescription) => {
      await stageCleanFamily();
      await seedUploadMetric(connection, { schema, plotID, censusID, fileID: CLEAN_FILE, batchID: CLEAN_BATCH, status: UPLOAD_STATUS.FAILED });
      const harness = createStatementHarness(realManager);
      let abortRequested = false;
      const failTheCall = (): Error =>
        route === 'give-up'
          ? Object.assign(new Error('Query execution was interrupted'), { code: KILLED_STATEMENT_ERROR_CODE, errno: KILLED_STATEMENT_ERRNO })
          : ((abortRequested = true), deadlockShapedError());
      vi.spyOn(Math, 'random').mockReturnValue(NO_BACKOFF_JITTER);
      let ingestion!: Promise<IngestBatchResult>;
      let recovery!: Promise<FailedCensusRecoveryResult>;
      const residueIDs: number[] = [];
      await runBarrierScenario(harness, async () => {
        const injection = harness.injectAfter(matching(WINDOW_WALK_STATEMENT.BULK_INGESTION_CALL), 1, failTheCall);
        const beforeTransferFirstStatement = harness.placeBarrier(
          statement => SUB_BATCH_CENSUS_SHARE_LOCK.test(statement.sql) || WINDOW_WALK_STATEMENT.PRE_CALL_SNAPSHOT.test(statement.sql),
          SUB_BATCH_ATTEMPT_STATEMENTS_BEFORE_TRANSFER + 1,
          'before'
        );
        ingestion = harness.track(
          ingestBatch(realManager, {
            schema,
            fileID: CLEAN_FILE,
            batchID: CLEAN_BATCH,
            expectedScope: { plotID, censusID },
            changedBy: CHANGED_BY,
            isAborted: () => abortRequested
          })
        );
        await withinDeadline(
          beforeTransferFirstStatement.reached,
          `ingestion parked before the first statement of its failure transfer (${routeDescription})`,
          harness.renderStatementLog
        );
        expect(injection.fired(), 'the CALL ran and was failed before the transfer began').toBe(true);
        const transferTransactionID = harness.statements.at(-1)!.transactionID!;
        const [threadRow] = (await realManager.executeQuery('SELECT CONNECTION_ID() AS threadID', [], transferTransactionID)) as Array<{ threadID: number }>;
        const transferThreadID = Number(threadRow.threadID);

        residueIDs.push(
          ...(await seedUnresolvedMeasurements(connection, { censusID, fileID: CLEAN_FILE, batchID: CLEAN_BATCH, count: G_STALE_ROWS, tagPrefix: 'GSTALE' })),
          ...(await seedUnresolvedMeasurements(connection, {
            censusID,
            fileID: I12_OTHER_FAILED_FILE,
            batchID: I12_OTHER_FAILED_BATCH,
            count: WINDOW + HELD_BACK_ROWS - G_STALE_ROWS,
            tagPrefix: 'I12F'
          }))
        );

        const afterGuard = harness.placeBarrier(matching(WINDOW_WALK_STATEMENT.COMPLETED_UPLOADS_GUARD), FIRST_GUARD_OCCURRENCE, 'after');
        recovery = harness.track(
          recoverFailedInitialCensusInBoundedTransactions(realManager, {
            schema,
            fileID: CLEAN_FILE,
            batchID: CLEAN_BATCH,
            plotID,
            censusID,
            changedBy: CHANGED_BY
          })
        );
        await withinDeadline(afterGuard.reached, 'recovery past its guard in window 1', harness.renderStatementLog);

        beforeTransferFirstStatement.release();
        const waiting = await waitForLockWait(
          connection,
          { schema, table: 'census', lockData: String(censusID), threadID: transferThreadID },
          harness,
          'failure transfer waiting on census.PRIMARY'
        );
        const transferStatements = harness.statements.filter(statement => statement.transactionID === transferTransactionID);
        console.log(
          `[I14 ${route}] transferTx=${transferTransactionID} thread=${transferThreadID} waiting=${JSON.stringify(waiting)}\n${harness.renderStatementLog()}`
        );
        expect(
          transferStatements.some(statement => WINDOW_WALK_STATEMENT.PRE_CALL_SNAPSHOT.test(statement.sql)),
          'the transfer has not snapshotted: it waits on the first statement of its transaction'
        ).toBe(false);
        expect(waiting.LOCK_MODE, 'the transfer requests a shared record lock on the census row').toBe(SHARED_RECORD_LOCK_MODE);

        afterGuard.release();
        await withinDeadline(Promise.allSettled([ingestion, recovery]), 'both sides to settle', harness.renderStatementLog);
      });

      const [ingestionSettled, recoverySettled] = await Promise.allSettled([ingestion, recovery]);
      console.log(`[I14 ${route}] settled ingestion=${JSON.stringify(ingestionSettled)} recovery=${JSON.stringify(recoverySettled)}`);
      expect([ingestionSettled.status, recoverySettled.status], `neither side failed: ${JSON.stringify([ingestionSettled, recoverySettled])}`).toEqual([
        'fulfilled',
        'fulfilled'
      ]);
      const ingestionResult = (ingestionSettled as PromiseFulfilledResult<IngestBatchResult>).value;
      const recoveryResult = (recoverySettled as PromiseFulfilledResult<FailedCensusRecoveryResult>).value;
      const movedRowIDs = (
        await connection.query<RowDataPacket[]>('SELECT CoreMeasurementID FROM coremeasurements WHERE UploadFileID = ? AND UploadBatchID = ?', [
          CLEAN_FILE,
          CLEAN_BATCH
        ])
      )[0].map(row => Number(row.CoreMeasurementID));
      const deleteAudits = await deleteAuditCounts(connection, censusID);
      const [insertAudits] = await connection.query<RowDataPacket[]>(
        `SELECT RecordID, COUNT(*) AS auditRows FROM unifiedchangelog WHERE TableName = ? AND Operation = ? AND CensusID = ? GROUP BY RecordID`,
        [COREMEASUREMENTS_TABLE, INSERT_OPERATION, censusID]
      );
      console.log(
        `[I14 ${route}] ingestion=${JSON.stringify(ingestionResult.subBatchResults)} recovery=${JSON.stringify(recoveryResult)} movedRowIDsLeft=${JSON.stringify(movedRowIDs)} ` +
          `deleteAudits=${JSON.stringify([...deleteAudits])} insertAudits=${JSON.stringify(insertAudits)}\n${harness.renderStatementLog()}`
      );
      expect(ingestionResult.subBatchResults[0], 'the sub-batch was moved to unresolved by the failure transfer').toMatchObject({
        batchFailedButHandled: true,
        rowCount: CLEAN_FIXTURE_ROW_COUNT
      });
      expect(recoveryResult.deadlockRetries, 'recovery met no deadlock').toBe(0);
      expect(recoveryResult.outcome, `recovery result: ${JSON.stringify(recoveryResult)}`).toBe('recovered');
      expect(insertAudits, `INSERT audit RecordIDs: ${JSON.stringify(insertAudits)}`).toHaveLength(CLEAN_FIXTURE_ROW_COUNT);
      expect(
        insertAudits.every(row => Number(row.auditRows) === 1),
        'each moved row is audited as inserted once'
      ).toBe(true);
      expect(
        [...deleteAudits.values()].every(audit => audit.count === 1),
        `DELETE-audit RecordIDs unique: ${JSON.stringify([...deleteAudits])}`
      ).toBe(true);
      for (const id of residueIDs) expect(deleteAudits.get(id)?.count, `residue ${id} was deleted by the recovery and audited once`).toBe(1);
      expect(
        await countOf(connection, 'SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ?', [CLEAN_FILE]),
        'the transfer consumed the staged rows'
      ).toBe(0);
    },
    CONCURRENCY_TEST_TIMEOUT_MS
  );
});
