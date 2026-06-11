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
 *      file 1's completed batch is untouched.
 *   5. Session conflict — an active interactive upload session for the same
 *      plot/census parks the job waiting_retry WITHOUT a RetryCount increment.
 *   6. Lease loss — the sweeper (finalizeJobAsSystem) reclaims the job after
 *      claim; the worker's next fenced write aborts silently and the job is
 *      claimable again.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/upload-worker.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  catalogPool: null as import('mysql2/promise').Pool | null
}));

// ConnectionManager mock — mirrors the ingest-batch/collapse-census pattern.
// Routes every schema-side DB call to the shared real MySQL connection.
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
vi.mock('@/config/poolmonitorsingleton', () => ({
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

import { ensureBackgroundJobCatalogTables } from '@/lib/background-jobs/catalog';
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
import { FormType, SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';

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
    await ensureBackgroundJobCatalogTables(catalogPool);

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
});
