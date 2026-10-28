/**
 * ingestBatch — unknown COMMIT outcome (#563 §5.2, C1)
 *
 * A COMMIT whose reply is lost leaves the caller unable to tell "committed" from "rolled back". ingestBatch must
 * neither replay the sub-batch in-loop nor move its valid staged rows to unresolved coremeasurements; it propagates
 * TransactionCommitOutcomeUnknownError and leaves the rows staged so the outer retry can re-check uploadmetrics.
 *
 * The ConnectionManager mock below commits (or rolls back) for real and THEN throws the unknown-outcome error, which
 * reproduces both worlds a caller cannot distinguish after a lost COMMIT reply.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/ingest-batch-commit-outcome-unknown.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { cleanupTestMeasurements, setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';
import { SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';

if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(
    `[ingest-batch-commit-outcome-unknown] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops and recreates its test schema and must only run against a local test database.`
  );
}

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0,
  activeTransactionRanBulkIngestion: false,
  bulkIngestionCalls: 0,
  commitFault: null as null | 'committed_then_lost' | 'rolled_back_then_lost',
  commitFaultsInjected: 0
}));

// Routes every DB call to one real MySQL connection. A commit whose transaction ran bulkingestionprocess can be
// made to commit (or roll back) for real and THEN throw TransactionCommitOutcomeUnknownError — the two worlds a
// caller cannot tell apart after a lost COMMIT reply.
vi.mock('@/lib/db/connectionmanager', async () => {
  const { TransactionCommitOutcomeUnknownError } = await vi.importActual<typeof import('@/lib/db/transactionerrors')>('@/lib/db/transactionerrors');
  const TRANSACTION_ID_PREFIX = 'ingest-commit-unknown-tx-';
  const BULK_INGESTION_CALL = /CALL\s+\S*bulkingestionprocess/i;
  const INJECTED_COMMIT_DEADLINE_MS = 30_000;
  const transportLoss = () =>
    Object.assign(new Error('Connection lost: The server closed the connection.'), { code: 'PROTOCOL_CONNECTION_LOST', fatal: true, sqlMessage: undefined });

  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      if (transactionID && BULK_INGESTION_CALL.test(query)) {
        sharedState.activeTransactionRanBulkIngestion = true;
        sharedState.bulkIngestionCalls += 1;
      }
      const [rows] = await sharedState.connection.query(query, (params as unknown[]) ?? []);
      return rows;
    },
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (sharedState.activeTransactionID) throw new Error('ConnectionManager mock: transaction already active');
      await sharedState.connection.beginTransaction();
      sharedState.transactionCounter += 1;
      sharedState.activeTransactionRanBulkIngestion = false;
      const id = `${TRANSACTION_ID_PREFIX}${sharedState.transactionCounter}`;
      sharedState.activeTransactionID = id;
      return id;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: commit transactionID mismatch');
      const fault = sharedState.activeTransactionRanBulkIngestion ? sharedState.commitFault : null;
      if (fault === null) {
        await sharedState.connection.commit();
        sharedState.activeTransactionID = null;
        return;
      }
      sharedState.commitFault = null;
      sharedState.commitFaultsInjected += 1;
      if (fault === 'committed_then_lost') await sharedState.connection.commit();
      else await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
      throw new TransactionCommitOutcomeUnknownError(transactionID, 'connection_lost', INJECTED_COMMIT_DEADLINE_MS, { cause: transportLoss() });
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      // Like the real manager: rolling back an already-finalized transaction is a no-op.
      if (sharedState.activeTransactionID === null) return;
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: rollback transactionID mismatch');
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
    },
    withTransaction: async <T>(fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<any>; readonly id: string }) => Promise<T>): Promise<T> => {
      const id = await manager.beginTransaction();
      try {
        const result = await fn({ id, query: (sql: string, params?: unknown[]) => manager.executeQuery(sql, params, id) });
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
    cleanupStaleTransactions: async () => 0,
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
import {
  replaceCensusForCleanReupload,
  stageMeasurementChunk,
  type CensusReplacementParams,
  type StageMeasurementChunkParams
} from '@/lib/uploads/stage-measurements';
import { ensureUploadSessionsTable } from '@/config/uploadsessiontracker';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import { startFreshUploadSession } from '../setup/upload-session-fixtures';
import { ingestBatch } from '@/lib/uploads/ingest-batch';
import { TransactionCommitOutcomeUnknownError } from '@/lib/db/transactionerrors';

const FILE_NAME = 'ingest-commit-unknown.csv';
const BATCH_ID = 'ingest-commit-unknown-0001';
const UPLOAD_SESSION_ID = 'ingest-commit-unknown-session';
const CHANGED_BY = 'ingest-commit-unknown-test@forestgeo.test';
const CSV_DELIMITER = ',';
const CSV_HEADERS = ['tag', 'stemtag', 'spcode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'];
const MEASUREMENT_DATE = '2024-03-15';

const EXPECTED_ROW_COUNT = 5;
const UPLOADMETRICS_STATUS_COMPLETED = 'completed';
const TEST_TIMEOUT_MS = 120_000;
const SETUP_TIMEOUT_MS = 120_000;

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
    row('IC001', '1', 'ACERRU', 'Q01', '1.5', '2.5', '10.5', 'A'),
    row('IC002', '1', 'QUERCO', 'Q01', '3.5', '4.5', '20.4', 'A;R'),
    row('IC003', '1', 'PINUST', 'Q02', '5.5', '6.5', '30.1', 'A'),
    row('IC004', '1', 'FAGUGR', 'Q02', '7.5', '8.5', '15.2', 'A'),
    row('IC005', '1', 'BETUAL', 'Q03', '9.5', '0.5', '25.8', 'A')
  ];
}

describe('ingestBatch — unknown COMMIT outcome (#563 C1)', () => {
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
    await ensureUploadSessionsTable(schema);
    console.log(`[setup] schema=${schema} plotID=${plotID} censusID=${censusID}`);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    sharedState.connection = null;
    try {
      await getPoolMonitorInstance().closeAllConnections();
    } finally {
      await teardownTestDatabase(connection, config);
    }
  });

  beforeEach(async () => {
    if (sharedState.activeTransactionID) {
      await connection.rollback();
      sharedState.activeTransactionID = null;
    }
    sharedState.commitFault = null;
    sharedState.commitFaultsInjected = 0;
    sharedState.bulkIngestionCalls = 0;
    await cleanupTestMeasurements(connection, testData, { additionalTables: ['unifiedchangelog'] });
    console.log('[beforeEach] cleared measurement tables + unifiedchangelog');
  });

  async function stageFixtureRows(): Promise<void> {
    const replacementParams: CensusReplacementParams = {
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
      firstRowOrdinal: null,
      changedBy: CHANGED_BY
    };
    await startFreshUploadSession(connection, { schema, sessionID: UPLOAD_SESSION_ID, plotID, censusID });
    const replacement = await replaceCensusForCleanReupload(connectionManager, replacementParams);
    console.log(`[replace] outcome=${replacement.outcome} deletedRows=${replacement.deletedRows} windowCount=${replacement.windowCount}`);
    const transactionID = await connectionManager.beginTransaction();
    const params: StageMeasurementChunkParams = { ...replacementParams, transactionID };
    const result = await stageMeasurementChunk(connectionManager, params);
    await connectionManager.commitTransaction(transactionID);
    console.log(`[stage] insertedCount=${result.insertedCount} invalidRows=${result.invalidRows.length} droppedCount=${result.droppedCount}`);
    expect(result.insertedCount).toBe(EXPECTED_ROW_COUNT);
    expect(result.invalidRows).toHaveLength(0);
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

  async function fetchAuditOperationCounts(): Promise<Record<string, number>> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT ucl.Operation, COUNT(*) AS count
       FROM unifiedchangelog ucl
       WHERE ucl.TableName = 'coremeasurements'
         AND ucl.RecordID IN (SELECT CoreMeasurementID FROM coremeasurements WHERE UploadFileID = ?)
       GROUP BY ucl.Operation`,
      [FILE_NAME]
    );
    const counts: Record<string, number> = {};
    for (const row of rows) counts[String(row.Operation)] = Number(row.count);
    return counts;
  }

  async function countRowsForFile(stemGUIDCondition: 'IS NULL' | 'IS NOT NULL'): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM coremeasurements WHERE UploadFileID = ? AND StemGUID ${stemGUIDCondition}`,
      [FILE_NAME]
    );
    return Number(rows[0].count);
  }

  async function snapshot(label: string) {
    const state = {
      ingested: await countRowsForFile('IS NOT NULL'),
      unresolved: await countRowsForFile('IS NULL'),
      staged: await countTemporaryRows(),
      metrics: (await fetchUploadMetrics()).map(row => String(row.status)),
      audits: await fetchAuditOperationCounts()
    };
    console.log(`[C1 ${label}]`, JSON.stringify(state));
    return state;
  }

  function runIngestBatch() {
    return ingestBatch(connectionManager, { schema, fileID: FILE_NAME, batchID: BATCH_ID, expectedScope: { plotID, censusID } });
  }

  it.each(['rolled_back_then_lost', 'committed_then_lost'] as const)(
    '%s: ingestBatch stops after one attempt with the unknown outcome, moves nothing to unresolved, and the outer retry converges to one copy',
    async fault => {
      await stageFixtureRows();
      sharedState.commitFault = fault;

      const outcome = await runIngestBatch().then(
        () => 'resolved',
        (error: unknown) => error
      );
      const afterFault = await snapshot(`${fault} after first run`);
      console.log(`[C1 ${fault}] outcome:`, outcome, 'bulkingestion calls:', sharedState.bulkIngestionCalls);

      expect(outcome, 'an unknown COMMIT outcome must propagate, not be retried or absorbed').toBeInstanceOf(TransactionCommitOutcomeUnknownError);
      expect(sharedState.commitFaultsInjected).toBe(1);
      expect(sharedState.bulkIngestionCalls, 'no in-loop replay: the original may still be committing').toBe(1);
      expect(afterFault.unresolved, 'valid staged rows must never be moved to unresolved after an unknown outcome').toBe(0);
      if (fault === 'rolled_back_then_lost') {
        expect(afterFault.staged).toBe(EXPECTED_ROW_COUNT);
        expect(afterFault.ingested).toBe(0);
      } else {
        expect(afterFault.ingested).toBe(EXPECTED_ROW_COUNT);
        expect(afterFault.metrics).toEqual([UPLOADMETRICS_STATUS_COMPLETED]);
        // The worker retry re-stages the file before ingesting again.
        await stageFixtureRows();
      }

      await runIngestBatch();
      const afterRetry = await snapshot(`${fault} after retry`);
      expect(afterRetry.ingested).toBe(EXPECTED_ROW_COUNT);
      expect(afterRetry.unresolved).toBe(0);
      expect(afterRetry.staged).toBe(0);
      expect(afterRetry.metrics).toEqual([UPLOADMETRICS_STATUS_COMPLETED]);
      expect(afterRetry.audits.INSERT, 'exactly one INSERT audit per measurement').toBe(EXPECTED_ROW_COUNT);
    },
    TEST_TIMEOUT_MS
  );
});
