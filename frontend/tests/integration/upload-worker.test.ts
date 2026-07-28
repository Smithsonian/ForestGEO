/**
 * runJobIfClaimable — Integration Tests (async upload worker, Task 10)
 *
 * Exercises the in-process background upload worker (lib/background-jobs/worker.ts)
 * end-to-end against a real local MySQL instance: catalog job tables, the real
 * bulkingestionprocess / bulkingestioncollapser stored procedures, the
 * sitespecificvalidations-driven validation orchestrator, and upload-session
 * serialization. fetchFileText is injected with fixture CSV text so no Azure
 * Blob access happens.
 *
 * Covered semantics:
 *   1. Happy path — a 2-file job completes: coremeasurements populated for both
 *      files, parse reject recorded, job at completed/100%, per-file counts,
 *      validation_runs completed, upload session released.
 *   2. Retry matrix — file 2's blob fetch fails: job parks waiting_retry with
 *      RetryCount=1 while file 1's batch is 'completed' in uploadmetrics. A
 *      re-run with healthy deps completes WITHOUT touching file 1 (uploadmetrics
 *      completed guard: no re-fetch, identical CoreMeasurementIDs, parse reject
 *      not duplicated, zero duplicate rows anywhere).
 *   3. Budget exhaustion — an always-failing fetch drives the job through
 *      UPLOAD_JOB_MAX_RETRIES fenced transitions into terminal 'failed'.
 *   4. Cancellation — cancel_requested set mid-run (during file 2's fetch):
 *      job finalizes 'cancelled', file 2's non-completed batch is cleaned,
 *      file 1's completed batch is untouched. A second scenario cancels a
 *      RETRY attempt before it reaches file 2 and asserts the cleanup also
 *      covers file 2's prior-attempt batch (persisted BatchID union).
 *   5. Session conflict — an active interactive upload session for the same
 *      plot/census parks the job waiting_retry WITHOUT a RetryCount increment.
 *   6. Lease loss — the sweeper (finalizeJobAsSystem) reclaims the job after
 *      claim; the worker's next fenced write aborts silently and the job is
 *      claimable again.
 *   7. Crash recovery mid-ingestion — file 1's uploadmetrics row stuck at
 *      'processing' with stale staged temp rows and already-written ingested/
 *      reject rows; the re-run produces exactly one clean row set.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/upload-worker.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql, { type Connection, type Pool, type RowDataPacket } from 'mysql2/promise';
import { cleanupTestMeasurements, setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

// ---------------------------------------------------------------------------
// Safety guard — setupTestDatabase DROPs/CREATEs its schema and this suite
// DELETEs from the shared catalog schema; never run remote.
// ---------------------------------------------------------------------------

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';

if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(
    `[upload-worker] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops/recreates its test schema and clears catalog.background_jobs; it must only run locally.`
  );
}

const TEST_DB_PORT = Number(process.env.TEST_DB_PORT || 3306);
const TEST_DB_USER = process.env.TEST_DB_USER || 'root';
const TEST_DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'testpassword';

// ---------------------------------------------------------------------------
// Shared state bridge — hoisted so the mock closures can read live handles
// after beforeAll wires them up.
// ---------------------------------------------------------------------------

const TRANSACTION_ID_PREFIX = 'upload-worker-tx-';

const sharedState = vi.hoisted(() => ({
  connection: null as import('mysql2/promise').Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0,
  catalogPool: null as import('mysql2/promise').Pool | null,
  // Test hook: awaited before every schema-side query so a test can inject
  // state changes (e.g. flip the job to cancel_requested) at a deterministic
  // point inside the worker's pipeline. Reset to null in beforeEach.
  onSchemaQuery: null as null | ((query: string, params: unknown[]) => Promise<void> | void)
}));

// ConnectionManager mock — mirrors the ingest-batch/collapse-census pattern.
// Routes every schema-side DB call to the shared real MySQL connection.
vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      if (sharedState.onSchemaQuery) await sharedState.onSchemaQuery(query, (params as unknown[]) ?? []);
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
      const [rows] = await sharedState.connection.query<import('mysql2/promise').RowDataPacket[]>('SELECT GET_LOCK(?, ?) as acquired', [
        lockName,
        Math.ceil(timeoutMs / 1000)
      ]);
      return (rows as import('mysql2/promise').RowDataPacket[])[0]?.acquired === 1;
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});

// PoolMonitor mock — the worker reads the catalog pool from
// getPoolMonitorInstance().pool, and config/uploadsessiontracker's getConn()
// path acquires pooled connections from the same monitor. Both are routed to
// the local catalog pool (no default database; all session queries are
// schema-qualified).
vi.mock('@/lib/db/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: () => {
    if (!sharedState.catalogPool) throw new Error('Test catalog pool not initialized');
    const pool = sharedState.catalogPool;
    return {
      pool,
      getConnection: () => pool.getConnection(),
      signalActivity: () => undefined
    };
  }
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: (msg: string) => console.log(`[ailogger.info] ${msg}`),
    warn: (msg: string) => console.log(`[ailogger.warn] ${msg}`),
    error: (msg: string, ...rest: unknown[]) => console.log(`[ailogger.error] ${msg}`, ...rest)
  }
}));

import { applyCatalogMigrationsForTests } from '../setup/catalog-migrations';
import {
  claimBackgroundJobForWorker,
  createUploadBackgroundJob,
  finalizeJobAsSystem,
  getBackgroundJob,
  getBackgroundJobWithDetails
} from '@/lib/background-jobs/repository';
import { runJobIfClaimable, SESSION_CONFLICT_RETRY_DELAY_SECONDS, type WorkerDeps } from '@/lib/background-jobs/worker';
import { UPLOAD_JOB_MAX_RETRIES, type BackgroundJobFileRecord } from '@/lib/background-jobs/types';
import { createUploadSession, ensureUploadSessionsTable } from '@/config/uploadsessiontracker';
import { FormType, SourceFormat, type FileRow } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import ConnectionManager from '@/lib/db/connectionmanager';
import { recordInvalidRows } from '@/lib/uploads/record-invalid-rows';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const TEST_USER = 'upload-worker-test@forestgeo.test';
const INTERACTIVE_USER = 'interactive-user@forestgeo.test';
const BLOB_CONTAINER = 'upload-worker-test-container';

const FILE1_NAME = 'worker-file-one.csv';
const FILE2_NAME = 'worker-file-two.csv';

const CSV_HEADER = 'tag,stemtag,spcode,quadrat,lx,ly,dbh,hom,date,codes';
const MEASUREMENT_DATE = '2024-03-15';

// File 1: 5 valid rows + 1 parse reject (missing required quadrat).
const FILE1_VALID_ROW_COUNT = 5;
const FILE1_REJECT_ROW_COUNT = 1;
const FILE1_CSV = [
  CSV_HEADER,
  `W1001,1,ACERRU,Q01,1.5,2.5,10.5,1.3,${MEASUREMENT_DATE},A`,
  `W1002,1,QUERCO,Q01,3.5,4.5,20.4,1.3,${MEASUREMENT_DATE},A`,
  `W1003,1,PINUST,Q02,5.5,6.5,30.1,1.3,${MEASUREMENT_DATE},A`,
  `W1004,1,FAGUGR,Q02,7.5,8.5,15.2,1.3,${MEASUREMENT_DATE},A`,
  `W1005,1,BETUAL,Q03,9.5,0.5,25.8,1.3,${MEASUREMENT_DATE},A`,
  `W1006,1,ACERRU,,2.5,3.5,11.1,1.3,${MEASUREMENT_DATE},A`
].join('\n');

// File 2: 4 valid rows, all distinct tags from file 1 (no collapser dedup).
const FILE2_VALID_ROW_COUNT = 4;
const FILE2_CSV = [
  CSV_HEADER,
  `W2001,1,ACERRU,Q01,0.5,1.5,12.5,1.3,${MEASUREMENT_DATE},A`,
  `W2002,1,QUERCO,Q02,2.5,9.5,22.4,1.3,${MEASUREMENT_DATE},A`,
  `W2003,1,PINUST,Q03,4.5,7.5,32.1,1.3,${MEASUREMENT_DATE},A`,
  `W2004,1,FAGUGR,Q01,6.5,5.5,17.2,1.3,${MEASUREMENT_DATE},A`
].join('\n');

const FIXTURE_TEXTS: Record<string, string> = {
  [FILE1_NAME]: FILE1_CSV,
  [FILE2_NAME]: FILE2_CSV
};

const UPLOADMETRICS_STATUS_COMPLETED = 'completed';

// ---------------------------------------------------------------------------
// Suite lifecycle
// ---------------------------------------------------------------------------

describe('runJobIfClaimable — integration', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let schema: string;
  let plotID: number;
  let censusID: number;
  let catalogPool: Pool;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    schema = setup.config.database;
    plotID = testData.plots[0].plotID;
    censusID = testData.census[0].censusID;
    sharedState.connection = connection;

    catalogPool = mysql.createPool({
      host: TEST_DB_HOST,
      port: TEST_DB_PORT,
      user: TEST_DB_USER,
      password: TEST_DB_PASSWORD,
      connectionLimit: 5
    });
    sharedState.catalogPool = catalogPool;
    await applyCatalogMigrationsForTests();

    // validation_runs is defined in tablestructures.sql but loadSchema's
    // semicolon-split filter silently skips it (the statement chunk begins
    // with a '--' comment block). Same workaround as validation-orchestrator.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${schema}\`.validation_runs (
        RunID          INT AUTO_INCREMENT PRIMARY KEY,
        PlotID         INT NOT NULL,
        CensusID       INT NOT NULL,
        Status         ENUM ('running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'running',
        TotalSteps     INT NOT NULL DEFAULT 0,
        CompletedSteps INT NOT NULL DEFAULT 0,
        FailedSteps    INT NOT NULL DEFAULT 0,
        CurrentStep    VARCHAR(100) NULL,
        ErrorMessages  JSON NULL,
        StartedAt      DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        CompletedAt    DATETIME NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // upload_sessions suffers the same loadSchema filter skip; create it via
    // the production bootstrap (the worker also calls this, but beforeEach's
    // cleanup needs the table to exist before the first run).
    await ensureUploadSessionsTable(schema);

    console.log(`[setup] schema=${schema} plotID=${plotID} censusID=${censusID}`);
  }, 120000);

  afterAll(async () => {
    sharedState.catalogPool = null;
    if (catalogPool) await catalogPool.end();
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    sharedState.onSchemaQuery = null;
    if (sharedState.activeTransactionID) {
      await connection.rollback();
      sharedState.activeTransactionID = null;
    }
    await cleanupTestMeasurements(connection, testData, {
      additionalTables: ['unifiedchangelog', 'upload_sessions', 'validation_runs']
    });
    // Catalog rows in FK-safe order: events → files → jobs.
    await catalogPool.query(`DELETE FROM catalog.background_job_events`);
    await catalogPool.query(`DELETE FROM catalog.background_job_files`);
    await catalogPool.query(`DELETE FROM catalog.background_jobs`);
    console.log('[beforeEach] cleared measurement tables, sessions, validation runs, and catalog rows');
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  async function createTwoFileJob(): Promise<number> {
    const job = await createUploadBackgroundJob(
      catalogPool,
      {
        schema,
        plotID,
        censusID,
        uploadMode: UploadMode.CLEAN_REUPLOAD,
        sourceFormat: SourceFormat.csv,
        formType: FormType.measurements,
        payload: { selectedDelimiters: { [FILE1_NAME]: ',', [FILE2_NAME]: ',' } },
        files: [
          { fileName: FILE1_NAME, blobContainer: BLOB_CONTAINER, blobName: `uploads/${FILE1_NAME}`, expectedRows: 6 },
          { fileName: FILE2_NAME, blobContainer: BLOB_CONTAINER, blobName: `uploads/${FILE2_NAME}`, expectedRows: 4 }
        ]
      },
      TEST_USER
    );
    console.log(`[helper] created jobID=${job.jobID}`);
    return job.jobID;
  }

  function healthyDeps(callLog?: string[]): WorkerDeps {
    return {
      fetchFileText: async (file: BackgroundJobFileRecord) => {
        callLog?.push(file.fileName);
        const text = FIXTURE_TEXTS[file.fileName];
        if (text === undefined) throw new Error(`[test deps] no fixture text for ${file.fileName}`);
        return text;
      }
    };
  }

  async function setNextAttemptPast(jobID: number): Promise<void> {
    await catalogPool.query(`UPDATE catalog.background_jobs SET NextAttemptAt = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE JobID = ?`, [jobID]);
  }

  async function batchIDForFile(jobID: number, fileName: string): Promise<string> {
    const [rows]: any = await catalogPool.query(`SELECT BatchID FROM catalog.background_job_files WHERE JobID = ? AND FileName = ?`, [jobID, fileName]);
    expect(rows.length).toBe(1);
    return String(rows[0].BatchID);
  }

  async function fetchIngestedIDs(fileName: string): Promise<number[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NOT NULL ORDER BY CoreMeasurementID`,
      [fileName]
    );
    return rows.map(row => Number(row.CoreMeasurementID));
  }

  async function fetchRejectIDs(fileName: string): Promise<number[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NULL ORDER BY CoreMeasurementID`,
      [fileName]
    );
    return rows.map(row => Number(row.CoreMeasurementID));
  }

  async function countTempRows(fileName?: string): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(
      fileName ? `SELECT COUNT(*) AS count FROM temporarymeasurements WHERE FileID = ?` : `SELECT COUNT(*) AS count FROM temporarymeasurements`,
      fileName ? [fileName] : []
    );
    return Number(rows[0].count);
  }

  async function fetchUploadMetricsStatus(batchID: string): Promise<string[]> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT status FROM uploadmetrics WHERE batchID = ?`, [batchID]);
    return rows.map(row => String(row.status));
  }

  async function fetchWorkerSessionStates(jobID: number): Promise<string[]> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT state FROM upload_sessions WHERE file_id = ? ORDER BY created_at`, [`async-job-${jobID}`]);
    return rows.map(row => String(row.state));
  }

  /** Inserts a staged temporarymeasurements row, simulating a prior attempt's staging output. */
  async function insertStagedTempRow(fileName: string, batchID: string, tag: string, quadrat: string, dbh: number): Promise<void> {
    await connection.query(
      `INSERT INTO temporarymeasurements
         (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes)
       VALUES (?, ?, ?, ?, ?, '1', 'ACERRU', ?, 1.5, 2.5, ?, 1.3, ?, 'A')`,
      [fileName, batchID, plotID, censusID, tag, quadrat, dbh, MEASUREMENT_DATE]
    );
  }

  // -------------------------------------------------------------------------
  // 1. Happy path
  // -------------------------------------------------------------------------

  it('completes a 2-file job: rows ingested, reject recorded, validations run, session released', async () => {
    const jobID = await createTwoFileJob();
    const fetchCalls: string[] = [];

    await runJobIfClaimable(jobID, healthyDeps(fetchCalls));

    const job = await getBackgroundJob(catalogPool, jobID);
    console.log(
      `[happy] job status=${job?.status} phase=${job?.phase} pct=${job?.percentComplete} processedRows=${job?.processedRows} failedRows=${job?.failedRows}`
    );
    expect(fetchCalls).toEqual([FILE1_NAME, FILE2_NAME]);
    expect(job!.status).toBe('completed');
    expect(job!.phase).toBe('completed');
    expect(job!.percentComplete).toBe(100);
    expect(job!.processedRows).toBe(FILE1_VALID_ROW_COUNT + FILE2_VALID_ROW_COUNT);
    expect(job!.failedRows).toBe(FILE1_REJECT_ROW_COUNT);
    expect(job!.finishedAt).toBeInstanceOf(Date);

    // coremeasurements populated for both files; parse reject recorded once.
    const file1IDs = await fetchIngestedIDs(FILE1_NAME);
    const file2IDs = await fetchIngestedIDs(FILE2_NAME);
    const file1Rejects = await fetchRejectIDs(FILE1_NAME);
    console.log(`[happy] file1 ingested=${JSON.stringify(file1IDs)} rejects=${JSON.stringify(file1Rejects)} file2 ingested=${JSON.stringify(file2IDs)}`);
    expect(file1IDs).toHaveLength(FILE1_VALID_ROW_COUNT);
    expect(file2IDs).toHaveLength(FILE2_VALID_ROW_COUNT);
    expect(file1Rejects).toHaveLength(FILE1_REJECT_ROW_COUNT);
    expect(await countTempRows()).toBe(0);

    // Per-file catalog records carry processed/failed counts.
    const details = await getBackgroundJobWithDetails(catalogPool, jobID);
    const file1Record = details!.files.find(f => f.fileName === FILE1_NAME)!;
    const file2Record = details!.files.find(f => f.fileName === FILE2_NAME)!;
    console.log(`[happy] file1 record: status=${file1Record.status} processed=${file1Record.processedRows} failed=${file1Record.failedRows}`);
    console.log(`[happy] file2 record: status=${file2Record.status} processed=${file2Record.processedRows} failed=${file2Record.failedRows}`);
    expect(file1Record.status).toBe('processed');
    expect(file1Record.processedRows).toBe(FILE1_VALID_ROW_COUNT);
    expect(file1Record.failedRows).toBe(FILE1_REJECT_ROW_COUNT);
    expect(file2Record.status).toBe('processed');
    expect(file2Record.processedRows).toBe(FILE2_VALID_ROW_COUNT);
    expect(file2Record.failedRows).toBe(0);

    // Both batches completed in uploadmetrics.
    const batch1 = await batchIDForFile(jobID, FILE1_NAME);
    const batch2 = await batchIDForFile(jobID, FILE2_NAME);
    expect(await fetchUploadMetricsStatus(batch1)).toEqual([UPLOADMETRICS_STATUS_COMPLETED]);
    expect(await fetchUploadMetricsStatus(batch2)).toEqual([UPLOADMETRICS_STATUS_COMPLETED]);

    // Validation run completed.
    const [validationRuns] = await connection.query<RowDataPacket[]>(`SELECT RunID, Status, FailedSteps FROM validation_runs ORDER BY RunID`);
    console.log(`[happy] validation_runs: ${JSON.stringify(validationRuns)}`);
    expect(validationRuns.length).toBeGreaterThan(0);
    expect(String(validationRuns[validationRuns.length - 1].Status)).toBe('completed');

    // Upload session released as completed.
    const sessionStates = await fetchWorkerSessionStates(jobID);
    console.log(`[happy] worker session states: ${JSON.stringify(sessionStates)}`);
    expect(sessionStates).toEqual(['completed']);
  }, 180000);

  // -------------------------------------------------------------------------
  // 2. Retry matrix — uploadmetrics-keyed recovery
  // -------------------------------------------------------------------------

  it('parks waiting_retry when file 2 fetch fails, then recovers without touching file 1 (completed guard)', async () => {
    const jobID = await createTwoFileJob();
    const FETCH_FAILURE_MESSAGE = 'simulated blob outage for file two';

    const failingOnFile2: WorkerDeps = {
      fetchFileText: async file => {
        if (file.fileName === FILE2_NAME) throw new Error(FETCH_FAILURE_MESSAGE);
        return FIXTURE_TEXTS[file.fileName];
      }
    };

    await runJobIfClaimable(jobID, failingOnFile2);

    const parked = await getBackgroundJob(catalogPool, jobID);
    console.log(`[retry] after run 1: status=${parked?.status} retryCount=${parked?.retryCount} lastError=${parked?.lastError}`);
    expect(parked!.status).toBe('waiting_retry');
    expect(parked!.retryCount).toBe(1);
    expect(parked!.lastError).toContain(FETCH_FAILURE_MESSAGE);
    expect(parked!.workerID).toBeNull();

    // File 1 fully completed in run 1.
    const batch1 = await batchIDForFile(jobID, FILE1_NAME);
    expect(await fetchUploadMetricsStatus(batch1)).toEqual([UPLOADMETRICS_STATUS_COMPLETED]);
    const file1IDsAfterRun1 = await fetchIngestedIDs(FILE1_NAME);
    const file1RejectsAfterRun1 = await fetchRejectIDs(FILE1_NAME);
    expect(file1IDsAfterRun1).toHaveLength(FILE1_VALID_ROW_COUNT);
    expect(file1RejectsAfterRun1).toHaveLength(FILE1_REJECT_ROW_COUNT);
    console.log(`[retry] run1 file1 IDs=${JSON.stringify(file1IDsAfterRun1)} rejects=${JSON.stringify(file1RejectsAfterRun1)}`);

    // Re-run with healthy deps after the retry delay elapses.
    await setNextAttemptPast(jobID);
    const run2FetchCalls: string[] = [];
    await runJobIfClaimable(jobID, healthyDeps(run2FetchCalls));

    const recovered = await getBackgroundJob(catalogPool, jobID);
    console.log(`[retry] after run 2: status=${recovered?.status} pct=${recovered?.percentComplete} fetchCalls=${JSON.stringify(run2FetchCalls)}`);
    expect(recovered!.status).toBe('completed');
    expect(recovered!.percentComplete).toBe(100);

    // Completed guard: file 1 was never re-fetched (skipped entirely).
    expect(run2FetchCalls).toEqual([FILE2_NAME]);

    // File 1's rows were not re-staged or re-ingested: identical CoreMeasurementIDs.
    const file1IDsAfterRun2 = await fetchIngestedIDs(FILE1_NAME);
    expect(file1IDsAfterRun2).toEqual(file1IDsAfterRun1);

    // The SP-side failure surface (parse reject under file 1's completed batch)
    // was NOT destroyed or duplicated by the retry.
    const file1RejectsAfterRun2 = await fetchRejectIDs(FILE1_NAME);
    expect(file1RejectsAfterRun2).toEqual(file1RejectsAfterRun1);

    // Zero duplicates anywhere: temp drained, exact census row count.
    expect(await countTempRows()).toBe(0);
    const file2IDs = await fetchIngestedIDs(FILE2_NAME);
    expect(file2IDs).toHaveLength(FILE2_VALID_ROW_COUNT);
    const [censusRows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM coremeasurements WHERE CensusID = ? AND StemGUID IS NOT NULL`, [
      censusID
    ]);
    expect(Number(censusRows[0].count)).toBe(FILE1_VALID_ROW_COUNT + FILE2_VALID_ROW_COUNT);

    // uploadmetrics still has exactly one completed row per batch (no re-ingest).
    expect(await fetchUploadMetricsStatus(batch1)).toEqual([UPLOADMETRICS_STATUS_COMPLETED]);
  }, 180000);

  // -------------------------------------------------------------------------
  // 3. Budget exhaustion
  // -------------------------------------------------------------------------

  it('fails permanently after UPLOAD_JOB_MAX_RETRIES transitions with always-failing deps', async () => {
    const jobID = await createTwoFileJob();
    const alwaysFailing: WorkerDeps = {
      fetchFileText: async () => {
        throw new Error('persistent blob outage');
      }
    };

    for (let attempt = 1; attempt <= UPLOAD_JOB_MAX_RETRIES; attempt++) {
      if (attempt > 1) await setNextAttemptPast(jobID);
      await runJobIfClaimable(jobID, alwaysFailing);
      const snapshot = await getBackgroundJob(catalogPool, jobID);
      console.log(`[budget] attempt ${attempt}: status=${snapshot?.status} retryCount=${snapshot?.retryCount}`);
      if (attempt < UPLOAD_JOB_MAX_RETRIES) {
        expect(snapshot!.status).toBe('waiting_retry');
        expect(snapshot!.retryCount).toBe(attempt);
      }
    }

    const finalJob = await getBackgroundJob(catalogPool, jobID);
    console.log(`[budget] final: status=${finalJob?.status} retryCount=${finalJob?.retryCount} lastError=${finalJob?.lastError}`);
    expect(finalJob!.status).toBe('failed');
    expect(finalJob!.phase).toBe('failed');
    expect(finalJob!.retryCount).toBe(UPLOAD_JOB_MAX_RETRIES);
    expect(finalJob!.lastError).toContain('persistent blob outage');
    expect(finalJob!.finishedAt).toBeInstanceOf(Date);
  }, 180000);

  // -------------------------------------------------------------------------
  // 4. Cancellation mid-run
  // -------------------------------------------------------------------------

  it('cancels mid-run: non-completed batch cleaned, completed batch untouched', async () => {
    const jobID = await createTwoFileJob();

    const cancellingDeps: WorkerDeps = {
      fetchFileText: async file => {
        if (file.fileName === FILE2_NAME) {
          // User cancels while the worker is mid-run (file 1 already completed).
          await catalogPool.query(`UPDATE catalog.background_jobs SET Status = 'cancel_requested' WHERE JobID = ? AND Status = 'running'`, [jobID]);
          console.log('[cancel] cancel_requested set during file 2 fetch');
        }
        return FIXTURE_TEXTS[file.fileName];
      }
    };

    await runJobIfClaimable(jobID, cancellingDeps);

    const job = await getBackgroundJob(catalogPool, jobID);
    console.log(`[cancel] job status=${job?.status} phase=${job?.phase}`);
    expect(job!.status).toBe('cancelled');
    expect(job!.phase).toBe('cancelled');

    // File 1's completed batch is untouched: ingested rows AND its recorded
    // parse reject survive (cleaning would have destroyed the reject).
    const batch1 = await batchIDForFile(jobID, FILE1_NAME);
    expect(await fetchUploadMetricsStatus(batch1)).toEqual([UPLOADMETRICS_STATUS_COMPLETED]);
    expect(await fetchIngestedIDs(FILE1_NAME)).toHaveLength(FILE1_VALID_ROW_COUNT);
    expect(await fetchRejectIDs(FILE1_NAME)).toHaveLength(FILE1_REJECT_ROW_COUNT);

    // File 2's non-completed batch is fully cleaned: no temp rows, no
    // unresolved coremeasurements, no ingested rows.
    expect(await countTempRows(FILE2_NAME)).toBe(0);
    expect(await fetchIngestedIDs(FILE2_NAME)).toHaveLength(0);
    expect(await fetchRejectIDs(FILE2_NAME)).toHaveLength(0);

    // Session released (failed = inactive, scope lock freed).
    const sessionStates = await fetchWorkerSessionStates(jobID);
    console.log(`[cancel] worker session states: ${JSON.stringify(sessionStates)}`);
    expect(sessionStates).toEqual(['failed']);
  }, 180000);

  it('cancel during a retry attempt also cleans prior-attempt batches the attempt never reached', async () => {
    const jobID = await createTwoFileJob();

    // Attempt 1: file 1 fully completes; file 2's fetch crashes AFTER its
    // BatchID was durably assigned in the catalog.
    await runJobIfClaimable(jobID, {
      fetchFileText: async file => {
        if (file.fileName === FILE2_NAME) throw new Error('simulated crash after file 2 batch assignment');
        return FIXTURE_TEXTS[file.fileName];
      }
    });
    const parked = await getBackgroundJob(catalogPool, jobID);
    console.log(`[cancel-prior-attempt] after attempt 1: status=${parked?.status} retryCount=${parked?.retryCount}`);
    expect(parked!.status).toBe('waiting_retry');

    const batch1 = await batchIDForFile(jobID, FILE1_NAME);
    const batch2 = await batchIDForFile(jobID, FILE2_NAME);

    // Simulate attempt 1 having staged file 2 before it crashed: leftover
    // temporarymeasurements rows plus a recorded parse reject under file 2's
    // persisted batch (the worker records rejects in the negative index
    // namespace, mirrored here).
    await insertStagedTempRow(FILE2_NAME, batch2, 'W2001', 'Q01', 12.5);
    await insertStagedTempRow(FILE2_NAME, batch2, 'W2002', 'Q02', 22.4);
    const priorAttemptReject: FileRow = {
      tag: 'W2099',
      stemtag: '1',
      spcode: 'ACERRU',
      quadrat: null,
      lx: '1.0',
      ly: '1.0',
      dbh: '9.9',
      hom: '1.3',
      date: MEASUREMENT_DATE,
      codes: 'A',
      failureReason: 'Missing required field: quadrat'
    };
    await recordInvalidRows(ConnectionManager.getInstance(), { schema, plotID, censusID, fileName: FILE2_NAME, batchID: batch2, sourceRowIndexOffset: -2 }, [
      priorAttemptReject
    ]);
    expect(await countTempRows(FILE2_NAME)).toBe(2);
    expect(await fetchRejectIDs(FILE2_NAME)).toHaveLength(1);

    // Attempt 2: the user cancels while the worker is probing completed
    // file 1 — BEFORE file 2's iteration starts, so file 2's batch is never
    // assigned in this run and ordinary per-file retry hygiene never touches
    // its prior-attempt artifacts. Only the cancellation cleanup can.
    await setNextAttemptPast(jobID);
    let cancelTriggered = false;
    sharedState.onSchemaQuery = async (query, params) => {
      if (!cancelTriggered && query.includes('uploadmetrics') && query.includes(`status = 'completed'`) && params.includes(batch1)) {
        cancelTriggered = true;
        await catalogPool.query(`UPDATE catalog.background_jobs SET Status = 'cancel_requested' WHERE JobID = ? AND Status = 'running'`, [jobID]);
        console.log('[cancel-prior-attempt] cancel_requested set during file 1 completed-probe');
      }
    };
    const fetchCalls: string[] = [];
    try {
      await runJobIfClaimable(jobID, healthyDeps(fetchCalls));
    } finally {
      sharedState.onSchemaQuery = null;
    }

    expect(cancelTriggered).toBe(true);
    // File 1 was skipped via the completed guard and file 2 was never reached.
    expect(fetchCalls).toEqual([]);

    const job = await getBackgroundJob(catalogPool, jobID);
    console.log(`[cancel-prior-attempt] job status=${job?.status} phase=${job?.phase}`);
    expect(job!.status).toBe('cancelled');
    expect(job!.phase).toBe('cancelled');

    // File 2's prior-attempt artifacts are cleaned even though THIS attempt
    // never assigned its batch — the cleanup unioned the persisted BatchID.
    expect(await countTempRows(FILE2_NAME)).toBe(0);
    expect(await fetchRejectIDs(FILE2_NAME)).toHaveLength(0);

    // File 1's completed batch remains untouched.
    expect(await fetchUploadMetricsStatus(batch1)).toEqual([UPLOADMETRICS_STATUS_COMPLETED]);
    expect(await fetchIngestedIDs(FILE1_NAME)).toHaveLength(FILE1_VALID_ROW_COUNT);
    expect(await fetchRejectIDs(FILE1_NAME)).toHaveLength(FILE1_REJECT_ROW_COUNT);
  }, 180000);

  // -------------------------------------------------------------------------
  // 5. Session conflict — parks WITHOUT RetryCount increment
  // -------------------------------------------------------------------------

  it('parks waiting_retry without burning retry budget when an interactive session owns the scope', async () => {
    // Pre-create an active interactive session for the same plot/census.
    const interactiveSession = await createUploadSession(schema, plotID, censusID, INTERACTIVE_USER, 'interactive-upload.csv', 3);
    console.log(`[session-conflict] interactive session ${interactiveSession.sessionId} state=${interactiveSession.state}`);

    const jobID = await createTwoFileJob();
    const fetchCalls: string[] = [];
    await runJobIfClaimable(jobID, healthyDeps(fetchCalls));

    const job = await getBackgroundJob(catalogPool, jobID);
    console.log(`[session-conflict] job status=${job?.status} retryCount=${job?.retryCount} nextAttemptAt=${job?.nextAttemptAt?.toISOString()}`);
    expect(job!.status).toBe('waiting_retry');
    expect(job!.retryCount).toBe(0); // no budget burn for external contention
    expect(job!.workerID).toBeNull();
    expect(job!.lastError).toContain(interactiveSession.sessionId);
    expect(job!.nextAttemptAt).toBeInstanceOf(Date);

    // The park delay is the short session-conflict delay (allowing DB clock skew margin).
    const deltaSeconds = (job!.nextAttemptAt!.getTime() - Date.now()) / 1000;
    console.log(`[session-conflict] nextAttemptAt delta=${deltaSeconds.toFixed(1)}s (configured ${SESSION_CONFLICT_RETRY_DELAY_SECONDS}s)`);
    expect(deltaSeconds).toBeLessThanOrEqual(SESSION_CONFLICT_RETRY_DELAY_SECONDS + 60);

    // Nothing was processed: no blob fetches, no staged rows.
    expect(fetchCalls).toHaveLength(0);
    expect(await countTempRows()).toBe(0);
  }, 120000);

  // -------------------------------------------------------------------------
  // 6. Lease loss — sweeper reclaim during the run
  // -------------------------------------------------------------------------

  it('abandons silently when the sweeper reclaims the job mid-run; job is claimable again', async () => {
    const jobID = await createTwoFileJob();

    const reclaimedDuringFetch: WorkerDeps = {
      fetchFileText: async file => {
        if (file.fileName === FILE1_NAME) {
          // Simulate the sweeper deciding this worker's lease went stale.
          const reclaimed = await finalizeJobAsSystem(catalogPool, jobID, 'waiting_retry', 'sweeper: heartbeat expired');
          console.log(`[lease-loss] finalizeJobAsSystem during file 1 fetch → ${reclaimed}`);
          expect(reclaimed).toBe(true);
        }
        return FIXTURE_TEXTS[file.fileName];
      }
    };

    // Must resolve without throwing — the stale worker's fenced write aborts silently.
    await expect(runJobIfClaimable(jobID, reclaimedDuringFetch)).resolves.toBeUndefined();

    const job = await getBackgroundJob(catalogPool, jobID);
    console.log(`[lease-loss] post-run: status=${job?.status} workerID=${job?.workerID} retryCount=${job?.retryCount} lastError=${job?.lastError}`);
    // The sweeper's state stands — the stale worker did not stomp it.
    expect(job!.status).toBe('waiting_retry');
    expect(job!.workerID).toBeNull();
    expect(job!.retryCount).toBe(1); // finalizeJobAsSystem increments
    expect(job!.lastError).toBe('sweeper: heartbeat expired');

    // The job is claimable by a fresh worker.
    const reclaim = await claimBackgroundJobForWorker(catalogPool, jobID, `${process.pid}:lease-loss-reclaim-check`);
    console.log(`[lease-loss] re-claim result: workerID=${reclaim?.workerID} status=${reclaim?.status}`);
    expect(reclaim).not.toBeNull();
    expect(reclaim!.status).toBe('running');
  }, 120000);

  // -------------------------------------------------------------------------
  // 7. Crash recovery mid-ingestion — uploadmetrics 'processing' + stale rows
  // -------------------------------------------------------------------------

  it('recovers a crash mid-ingestion of file 1: exactly one clean row set, no duplicate rows or rejects', async () => {
    const jobID = await createTwoFileJob();

    // Phase 1: run the job partially — file 1 stages AND ingests fully, then
    // the attempt halts at file 2's fetch so file 1's real post-ingest state
    // (ingested rows, recorded reject, completed uploadmetrics) exists.
    await runJobIfClaimable(jobID, {
      fetchFileText: async file => {
        if (file.fileName === FILE2_NAME) throw new Error('halt before file 2 to isolate file 1 state');
        return FIXTURE_TEXTS[file.fileName];
      }
    });
    const batch1 = await batchIDForFile(jobID, FILE1_NAME);
    expect(await fetchUploadMetricsStatus(batch1)).toEqual([UPLOADMETRICS_STATUS_COMPLETED]);
    const ingestedAfterAttempt1 = await fetchIngestedIDs(FILE1_NAME);
    expect(ingestedAfterAttempt1).toHaveLength(FILE1_VALID_ROW_COUNT);
    expect(await fetchRejectIDs(FILE1_NAME)).toHaveLength(FILE1_REJECT_ROW_COUNT);

    // Phase 2: simulate the worker dying MID-INGESTION of file 1 — the
    // uploadmetrics row never reached 'completed', undrained staged temp rows
    // linger, and rows the interrupted run already wrote (ingested rows and
    // the recorded reject) are still present.
    await connection.query(`UPDATE uploadmetrics SET status = 'processing' WHERE batchID = ?`, [batch1]);
    await insertStagedTempRow(FILE1_NAME, batch1, 'W1004', 'Q02', 15.2);
    await insertStagedTempRow(FILE1_NAME, batch1, 'W1005', 'Q03', 25.8);
    await catalogPool.query(
      `UPDATE catalog.background_jobs SET Status = 'queued', NextAttemptAt = NULL, WorkerID = NULL, WorkerHeartbeatAt = NULL WHERE JobID = ?`,
      [jobID]
    );
    console.log(`[crash-recovery] simulated mid-ingestion crash: batch1=${batch1} → status=processing, 2 stale temp rows re-staged`);

    // Phase 3: re-run the worker with healthy deps.
    await runJobIfClaimable(jobID, healthyDeps());

    const job = await getBackgroundJob(catalogPool, jobID);
    console.log(`[crash-recovery] post-recovery: status=${job?.status} pct=${job?.percentComplete} processed=${job?.processedRows} failed=${job?.failedRows}`);
    expect(job!.status).toBe('completed');
    expect(job!.percentComplete).toBe(100);

    // Exactly one clean row set: no duplicates anywhere.
    expect(await countTempRows()).toBe(0);
    const file1Ingested = await fetchIngestedIDs(FILE1_NAME);
    const file1Rejects = await fetchRejectIDs(FILE1_NAME);
    const file2Ingested = await fetchIngestedIDs(FILE2_NAME);
    console.log(
      `[crash-recovery] file1 ingested=${JSON.stringify(file1Ingested)} rejects=${JSON.stringify(file1Rejects)} file2 ingested=${JSON.stringify(file2Ingested)}`
    );
    expect(file1Ingested).toHaveLength(FILE1_VALID_ROW_COUNT);
    expect(file1Rejects).toHaveLength(FILE1_REJECT_ROW_COUNT);
    expect(file2Ingested).toHaveLength(FILE2_VALID_ROW_COUNT);

    // Census-wide row count proves no duplicate measurements survived.
    const [censusRows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM coremeasurements WHERE CensusID = ? AND StemGUID IS NOT NULL`, [
      censusID
    ]);
    expect(Number(censusRows[0].count)).toBe(FILE1_VALID_ROW_COUNT + FILE2_VALID_ROW_COUNT);
    const [tagDupRows] = await connection.query<RowDataPacket[]>(
      `SELECT t.TreeTag, COUNT(*) AS count
       FROM coremeasurements cm
       JOIN stems s ON s.StemGUID = cm.StemGUID
       JOIN trees t ON t.TreeID = s.TreeID
       WHERE cm.CensusID = ?
       GROUP BY t.TreeTag HAVING COUNT(*) > 1`,
      [censusID]
    );
    console.log(`[crash-recovery] duplicate tags: ${JSON.stringify(tagDupRows)}`);
    expect(tagDupRows).toHaveLength(0);

    // uploadmetrics: file 1's batch is completed again, exactly once.
    expect(await fetchUploadMetricsStatus(batch1)).toEqual([UPLOADMETRICS_STATUS_COMPLETED]);
  }, 180000);

  // -------------------------------------------------------------------------
  // 9. Split-batch recycle recovery (2026-07-27 Harvard Forest incident)
  //
  // A file large enough to split is ingested as `<batchID>__subNNN`. Everything
  // keyed on the unsuffixed BatchID — the uploadmetrics completion probe and the
  // retry cleanup — then looks at an ID that owns no rows and no metrics. These
  // tests force a split with a low threshold and prove the worker reasons about
  // the whole family.
  //
  // Measured scope of each test (verified by reverting buildSubBatchPattern to
  // bare-ID semantics and re-running):
  //   - 'recycled after every sub-batch completed' FAILS without the
  //     family-scoped completion probe. This is the load-bearing regression:
  //     a fully-ingested split file is otherwise re-staged and re-ingested.
  //   - 'recycled mid-family' still passes under bare-ID semantics, because
  //     stageMeasurementChunk's own stale-batch cleanup and the procedure's
  //     per-sub-batch idempotency already cover that path. It is kept as an
  //     end-to-end guard, not as proof of the family-cleanup change; the
  //     discriminating cover for family-scoped unresolved-row deletion lives in
  //     tests/integration/record-invalid-rows.test.ts.
  // -------------------------------------------------------------------------

  describe('split-batch recycle recovery', () => {
    /** Forces FILE1's 5 valid rows into 3 sub-batches (2 + 2 + 1). */
    const SPLIT_THRESHOLD_ROWS = 2;
    const EXPECTED_SUB_BATCH_COUNT = Math.ceil(FILE1_VALID_ROW_COUNT / SPLIT_THRESHOLD_ROWS);

    let previousThreshold: string | undefined;

    beforeEach(() => {
      previousThreshold = process.env.INGESTION_SUB_BATCH_ROWS;
      process.env.INGESTION_SUB_BATCH_ROWS = String(SPLIT_THRESHOLD_ROWS);
    });

    afterEach(() => {
      if (previousThreshold === undefined) delete process.env.INGESTION_SUB_BATCH_ROWS;
      else process.env.INGESTION_SUB_BATCH_ROWS = previousThreshold;
    });

    async function createSingleFileJob(): Promise<number> {
      const job = await createUploadBackgroundJob(
        catalogPool,
        {
          schema,
          plotID,
          censusID,
          uploadMode: UploadMode.CLEAN_REUPLOAD,
          sourceFormat: SourceFormat.csv,
          formType: FormType.measurements,
          payload: { selectedDelimiters: { [FILE1_NAME]: ',' } },
          files: [{ fileName: FILE1_NAME, blobContainer: BLOB_CONTAINER, blobName: `uploads/${FILE1_NAME}`, expectedRows: 6 }]
        },
        TEST_USER
      );
      return job.jobID;
    }

    /** Every uploadmetrics row in the batch family, keyed by batch ID. */
    async function fetchFamilyMetrics(batchID: string): Promise<Record<string, string>> {
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT batchID, status FROM uploadmetrics WHERE batchID = ? OR batchID LIKE ? ESCAPE '\\\\' ORDER BY batchID`,
        [batchID, `${batchID}\\_\\_sub%`]
      );
      return Object.fromEntries(rows.map(row => [String(row.batchID), String(row.status)]));
    }

    async function countFamilyTempRows(batchID: string): Promise<number> {
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM temporarymeasurements WHERE BatchID = ? OR BatchID LIKE ? ESCAPE '\\\\'`,
        [batchID, `${batchID}\\_\\_sub%`]
      );
      return Number(rows[0].count);
    }

    async function requeueJob(jobID: number): Promise<void> {
      await catalogPool.query(
        `UPDATE catalog.background_jobs SET Status = 'queued', NextAttemptAt = NULL, WorkerID = NULL, WorkerHeartbeatAt = NULL WHERE JobID = ?`,
        [jobID]
      );
    }

    async function fetchIngestedTags(): Promise<string[]> {
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT t.TreeTag FROM coremeasurements cm
         JOIN stems s ON s.StemGUID = cm.StemGUID
         JOIN trees t ON t.TreeID = s.TreeID
         WHERE cm.UploadFileID = ? AND cm.CensusID = ?
         ORDER BY t.TreeTag`,
        [FILE1_NAME, censusID]
      );
      return rows.map(row => String(row.TreeTag));
    }

    it('splits the file and records one completed uploadmetrics row per sub-batch', async () => {
      const jobID = await createSingleFileJob();

      await runJobIfClaimable(jobID, healthyDeps());

      const batchID = await batchIDForFile(jobID, FILE1_NAME);
      const familyMetrics = await fetchFamilyMetrics(batchID);
      console.log(`[split] batchID=${batchID} familyMetrics=${JSON.stringify(familyMetrics)}`);

      // Precondition for the recycle tests below: the split really happened, so
      // the unsuffixed ID owns no metric of its own.
      expect(Object.keys(familyMetrics)).toHaveLength(EXPECTED_SUB_BATCH_COUNT);
      expect(familyMetrics[batchID]).toBeUndefined();
      expect(Object.values(familyMetrics).every(status => status === UPLOADMETRICS_STATUS_COMPLETED)).toBe(true);
      expect(await countFamilyTempRows(batchID)).toBe(0);
      expect(await fetchIngestedIDs(FILE1_NAME)).toHaveLength(FILE1_VALID_ROW_COUNT);
    }, 180000);

    it('recycled mid-family: resumes the staged sub-batches without duplicating the completed one', async () => {
      const jobID = await createSingleFileJob();
      await runJobIfClaimable(jobID, healthyDeps());
      const batchID = await batchIDForFile(jobID, FILE1_NAME);

      const subBatchIDs = Object.keys(await fetchFamilyMetrics(batchID)).sort();
      expect(subBatchIDs).toHaveLength(EXPECTED_SUB_BATCH_COUNT);
      const [firstSubBatch, ...remainingSubBatches] = subBatchIDs;

      // Rewrite history into "attempt died after the first sub-batch": only
      // that sub-batch's metric survives as completed, the later sub-batches
      // never finished, and their rows are still staged.
      //
      // The stranded rows carry tags that appear NOWHERE in the fixture CSV.
      // That makes the family cleanup observable: if the retry only cleans the
      // unsuffixed BatchID, these rows survive under `__subNNN`, get swept up
      // when the re-split reuses those same sub-batch names, and show up as
      // extra ingested tags. Family-scoped cleanup removes them first.
      const ingestedBefore = await fetchIngestedTags();
      const STRANDED_TAGS = ['W1091', 'W1092', 'W1093'];
      await connection.query(`DELETE FROM uploadmetrics WHERE batchID IN (?)`, [remainingSubBatches]);
      await connection.query(
        `DELETE cm FROM coremeasurements cm
         JOIN stems s ON s.StemGUID = cm.StemGUID
         JOIN trees t ON t.TreeID = s.TreeID
         WHERE cm.UploadFileID = ? AND cm.CensusID = ? AND t.TreeTag IN ('W1003', 'W1004', 'W1005')`,
        [FILE1_NAME, censusID]
      );
      await insertStagedTempRow(FILE1_NAME, remainingSubBatches[0], STRANDED_TAGS[0], 'Q02', 30.1);
      await insertStagedTempRow(FILE1_NAME, remainingSubBatches[0], STRANDED_TAGS[1], 'Q02', 15.2);
      await insertStagedTempRow(FILE1_NAME, remainingSubBatches[1] ?? remainingSubBatches[0], STRANDED_TAGS[2], 'Q03', 25.8);
      await requeueJob(jobID);
      console.log(
        `[split-recycle] simulated death after ${firstSubBatch}; ${remainingSubBatches.length} sub-batch(es) left staged ` +
          `(${await countFamilyTempRows(batchID)} temp rows), ingestedBefore=${JSON.stringify(ingestedBefore)}`
      );

      // The completion probe must NOT declare this family finished, and the
      // retry must clean and resume the whole family rather than the bare ID.
      await runJobIfClaimable(jobID, healthyDeps());

      const job = await getBackgroundJob(catalogPool, jobID);
      const familyMetricsAfter = await fetchFamilyMetrics(batchID);
      const ingestedAfter = await fetchIngestedTags();
      console.log(
        `[split-recycle] status=${job?.status} familyMetrics=${JSON.stringify(familyMetricsAfter)} ` +
          `tempRows=${await countFamilyTempRows(batchID)} ingestedAfter=${JSON.stringify(ingestedAfter)}`
      );

      expect(job!.status).toBe('completed');
      // No family rows may be stranded in staging.
      expect(await countFamilyTempRows(batchID)).toBe(0);
      expect(await countTempRows()).toBe(0);
      // The dead attempt's stranded sub-batch rows were cleaned, not ingested.
      for (const strandedTag of STRANDED_TAGS) {
        expect(ingestedAfter).not.toContain(strandedTag);
      }
      // Exactly one clean row set — every source tag present exactly once.
      expect(ingestedAfter).toEqual(ingestedBefore);
      expect(new Set(ingestedAfter).size).toBe(ingestedAfter.length);
      expect(ingestedAfter).toHaveLength(FILE1_VALID_ROW_COUNT);
      // Every family metric ends completed; none left processing/failed.
      expect(Object.values(familyMetricsAfter).every(status => status === UPLOADMETRICS_STATUS_COMPLETED)).toBe(true);
    }, 180000);

    it('recycled after every sub-batch completed: recognizes family completion and does not re-ingest', async () => {
      const jobID = await createSingleFileJob();
      await runJobIfClaimable(jobID, healthyDeps());
      const batchID = await batchIDForFile(jobID, FILE1_NAME);

      const ingestedIDsBefore = await fetchIngestedIDs(FILE1_NAME);
      const rejectIDsBefore = await fetchRejectIDs(FILE1_NAME);
      const familyMetricsBefore = await fetchFamilyMetrics(batchID);
      expect(Object.keys(familyMetricsBefore)).toHaveLength(EXPECTED_SUB_BATCH_COUNT);

      // The worker died AFTER ingestion drained every sub-batch but BEFORE the
      // post-ingestion phases, so the job is runnable again with the whole
      // family already complete.
      await requeueJob(jobID);

      const fetchedFiles: string[] = [];
      await runJobIfClaimable(jobID, healthyDeps(fetchedFiles));

      const job = await getBackgroundJob(catalogPool, jobID);
      const ingestedIDsAfter = await fetchIngestedIDs(FILE1_NAME);
      console.log(
        `[split-complete-recycle] status=${job?.status} refetchedFiles=${JSON.stringify(fetchedFiles)} ` +
          `idsBefore=${JSON.stringify(ingestedIDsBefore)} idsAfter=${JSON.stringify(ingestedIDsAfter)}`
      );

      expect(job!.status).toBe('completed');
      // Identical CoreMeasurementIDs prove the rows were never deleted and
      // re-inserted — the completed family was skipped, not redone.
      expect(ingestedIDsAfter).toEqual(ingestedIDsBefore);
      expect(await fetchRejectIDs(FILE1_NAME)).toEqual(rejectIDsBefore);
      // No re-staging, and no extra uploadmetrics rows appeared.
      expect(await countFamilyTempRows(batchID)).toBe(0);
      expect(await fetchFamilyMetrics(batchID)).toEqual(familyMetricsBefore);
    }, 180000);
  });
});
