/**
 * Background upload worker: unknown staging COMMIT outcome (#563 C4)
 *
 * Pins spec decision (a): when the first staging chunk's COMMIT committed but reported
 * TransactionCommitOutcomeUnknownError, the worker parks the job in waiting_retry and the
 * retry (cleanupBatchArtifacts, then restage) ingests every row exactly once.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/upload-worker-commit-outcome-unknown.test.ts
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

// ---------------------------------------------------------------------------
// Shared state bridge — hoisted so the mock closures can read live handles
// after beforeAll wires them up.
// ---------------------------------------------------------------------------

const TRANSACTION_ID_PREFIX = 'upload-worker-tx-';

const sharedState = vi.hoisted(() => ({
  connection: null as import('mysql2/promise').Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0,
  heldLocks: new Set<string>(),
  catalogPool: null as import('mysql2/promise').Pool | null,
  // Test hook: awaited before every schema-side query so a test can inject
  // state changes (e.g. flip the job to cancel_requested) at a deterministic
  // point inside the worker's pipeline. Reset to null in beforeEach.
  onSchemaQuery: null as null | ((query: string, params: unknown[]) => Promise<void> | void),
  // Every schema-side statement in issue order, with the transaction it ran in (null = autocommit).
  statementLog: [] as Array<{ transactionID: string | null; sql: string }>,
  commitFault: null as null | 'committed_then_lost',
  commitFaultsInjected: 0
}));

// ConnectionManager mock — mirrors the ingest-batch/collapse-census pattern.
// Routes every schema-side DB call to the shared real MySQL connection.
vi.mock('@/lib/db/connectionmanager', async () => {
  const { TransactionCommitOutcomeUnknownError } = await vi.importActual<typeof import('@/lib/db/transactionerrors')>('@/lib/db/transactionerrors');
  const STAGING_INSERT = /INSERT\s+(?:IGNORE\s+)?INTO\s+`?\w*`?\.?`?temporarymeasurements`?\s*\(/i;
  const INJECTED_COMMIT_DEADLINE_MS = 30_000;
  const releaseLocks = async () => {
    for (const name of sharedState.heldLocks) await sharedState.connection!.query('SELECT RELEASE_LOCK(?)', [name]);
    sharedState.heldLocks.clear();
  };
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      sharedState.statementLog.push({ transactionID: transactionID ?? null, sql: query });
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
      await releaseLocks();
      sharedState.activeTransactionID = null;
      const ranStagingInsert = sharedState.statementLog.some(entry => entry.transactionID === transactionID && STAGING_INSERT.test(entry.sql));
      if (sharedState.commitFault === 'committed_then_lost' && ranStagingInsert) {
        sharedState.commitFault = null;
        sharedState.commitFaultsInjected += 1;
        const transportLoss = Object.assign(new Error('Connection lost: The server closed the connection.'), {
          code: 'PROTOCOL_CONNECTION_LOST',
          sqlMessage: undefined
        });
        throw new TransactionCommitOutcomeUnknownError(transactionID, 'connection_lost', INJECTED_COMMIT_DEADLINE_MS, { cause: transportLoss });
      }
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (sharedState.activeTransactionID === null) return; // finalized, like the real manager
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: rollback transactionID mismatch');
      await sharedState.connection.rollback();
      await releaseLocks();
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
      if (_transactionID !== sharedState.activeTransactionID) throw new Error('Unknown lock transaction');
      if (sharedState.heldLocks.has(lockName)) return true;
      const [rows] = await sharedState.connection.query<import('mysql2/promise').RowDataPacket[]>('SELECT GET_LOCK(?, ?) as acquired', [
        lockName,
        Math.ceil(timeoutMs / 1000)
      ]);
      const acquired = (rows as import('mysql2/promise').RowDataPacket[])[0]?.acquired === 1;
      if (acquired) sharedState.heldLocks.add(lockName);
      return acquired;
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});

// PoolMonitor mock — the worker reads the catalog pool from
// getPoolMonitorInstance().getUsablePool(), and config/uploadsessiontracker's getConn()
// path acquires pooled connections from the same monitor. Both are routed to
// the local catalog pool (no default database; all session queries are
// schema-qualified).
vi.mock('@/lib/db/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: () => {
    if (!sharedState.catalogPool) throw new Error('Test catalog pool not initialized');
    const pool = sharedState.catalogPool;
    return {
      pool,
      getUsablePool: async () => pool,
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
import { seedCatalogTables } from './admin-provision/_shared';
import { createUploadBackgroundJob, getBackgroundJob } from '@/lib/background-jobs/repository';
import { runJobIfClaimable, type WorkerDeps } from '@/lib/background-jobs/worker';
import type { BackgroundJobFileRecord } from '@/lib/background-jobs/types';
import { ensureUploadSessionsTable } from '@/config/uploadsessiontracker';
import { FormType, SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { buildSubBatchPattern, LIKE_ESCAPE_CLAUSE } from '@/lib/uploads/batch-family';
import { testDbServerOptions } from '../setup/test-db-connection';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const TEST_USER = 'upload-worker-test@forestgeo.test';
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
      ...testDbServerOptions(),
      connectionLimit: 5
    });
    sharedState.catalogPool = catalogPool;
    await seedCatalogTables(catalogPool);
    await applyCatalogMigrationsForTests();
    await catalogPool.query(`DELETE FROM catalog.sites WHERE SchemaName = ?`, [schema]);
    await catalogPool.query(
      `INSERT INTO catalog.sites
         (SiteName, SchemaName, SQDimX, SQDimY, DefaultUOMDBH, DefaultUOMHOM, DoubleDataEntry)
       VALUES ('Upload Worker Test Site', ?, 20, 20, 'cm', 'm', 0)`,
      [schema]
    );

    // upload_sessions must exist before beforeEach's cleanup runs; create it
    // via the production bootstrap (the worker also calls this itself).
    await ensureUploadSessionsTable(schema);

    console.log(`[setup] schema=${schema} plotID=${plotID} censusID=${censusID}`);
  }, 120000);

  afterAll(async () => {
    sharedState.catalogPool = null;
    if (catalogPool) {
      await catalogPool.query(`DELETE FROM catalog.sites WHERE SchemaName = ?`, [schema]);
      await catalogPool.end();
    }
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    sharedState.onSchemaQuery = null;
    sharedState.statementLog = [];
    sharedState.commitFault = null;
    sharedState.commitFaultsInjected = 0;
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

  /** Metric statuses for the whole batch family; staging pre-partitions, so a small file's metric lives under `__sub001`. */
  async function fetchUploadMetricsStatus(batchID: string): Promise<string[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT status FROM uploadmetrics WHERE batchID = ? OR batchID LIKE ? ${LIKE_ESCAPE_CLAUSE} ORDER BY batchID`,
      [batchID, buildSubBatchPattern(batchID)]
    );
    return rows.map(row => String(row.status));
  }
  it('a staging COMMIT that committed but reported an unknown outcome is retried by the job, and the retry ingests every row exactly once', async () => {
    const jobID = await createTwoFileJob();
    sharedState.commitFault = 'committed_then_lost';

    await runJobIfClaimable(jobID, healthyDeps());
    const parked = await getBackgroundJob(catalogPool, jobID);
    const stagedAfterRun1 = await countTempRows(FILE1_NAME);
    console.log(`[C4] run 1: status=${parked?.status} retryCount=${parked?.retryCount} lastError=${parked?.lastError} staged(file1)=${stagedAfterRun1}`);
    expect(sharedState.commitFaultsInjected, 'the fault must have hit a real staging commit').toBe(1);
    expect(parked!.status, 'the job retry is the designed recovery (decision a); a non-retryable error would fail the job').toBe('waiting_retry');
    expect(parked!.retryCount).toBe(1);

    await setNextAttemptPast(jobID);
    await runJobIfClaimable(jobID, healthyDeps());
    const finished = await getBackgroundJob(catalogPool, jobID);
    const file1Ingested = await fetchIngestedIDs(FILE1_NAME);
    const file1Rejects = await fetchRejectIDs(FILE1_NAME);
    const file2Ingested = await fetchIngestedIDs(FILE2_NAME);
    const [auditRows] = await connection.query<RowDataPacket[]>(
      `SELECT RecordID, COUNT(*) AS inserts FROM unifiedchangelog
       WHERE TableName = 'coremeasurements' AND Operation = 'INSERT'
         AND RecordID IN (SELECT CoreMeasurementID FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NOT NULL)
       GROUP BY RecordID`,
      [FILE1_NAME]
    );
    console.log(
      `[C4] run 2: status=${finished?.status} file1=${file1Ingested.length} rejects=${file1Rejects.length} file2=${file2Ingested.length} ` +
        `staged=${await countTempRows()} audits=${JSON.stringify(auditRows)}`
    );

    expect(finished!.status).toBe('completed');
    expect(file1Ingested, 'cleanupBatchArtifacts must remove the first attempt’s committed staged rows').toHaveLength(FILE1_VALID_ROW_COUNT);
    expect(file1Rejects).toHaveLength(FILE1_REJECT_ROW_COUNT);
    expect(file2Ingested).toHaveLength(FILE2_VALID_ROW_COUNT);
    expect(await countTempRows()).toBe(0);
    expect(await fetchUploadMetricsStatus(await batchIDForFile(jobID, FILE1_NAME))).toEqual([UPLOADMETRICS_STATUS_COMPLETED]);
    expect(await fetchUploadMetricsStatus(await batchIDForFile(jobID, FILE2_NAME))).toEqual([UPLOADMETRICS_STATUS_COMPLETED]);
    expect(auditRows).toHaveLength(FILE1_VALID_ROW_COUNT);
    auditRows.forEach(row => expect(Number(row.inserts), `measurement ${row.RecordID} audited more than once`).toBe(1));
  }, 240_000);
});
