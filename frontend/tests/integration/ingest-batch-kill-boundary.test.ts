/**
 * ingestBatch — real KILL boundary
 *
 * The existing kill coverage in ingest-batch.test.ts injects a fabricated
 * ER_QUERY_INTERRUPTED object ABOVE ConnectionManager. That proves the classifier
 * handles one error shape someone wrote down; it structurally cannot catch a kill
 * that reaches the caller as a DIFFERENT shape, which is exactly how both escapes
 * survived the previous fix:
 *
 *   - the DB layer's own timeout raises QueryTimeoutError, which the old
 *     substring test ("timed out") routed into the retry budget, and
 *   - an operator's `KILL <id>` never produces 1317 at all.
 *
 * So this suite kills for real: a genuinely slow `bulkingestionprocess` CALL runs
 * against local MySQL on its own connection, and a SECOND connection issues the
 * kill while the CALL is executing. Whatever mysql2 raises is whatever the
 * classifier gets — no hand-written error objects.
 *
 * Measured shapes (MySQL 8.0.36, mysql2, 2026-07-29):
 *   KILL QUERY <id> -> code ER_QUERY_INTERRUPTED, errno 1317, sqlState 70100
 *   KILL <id>       -> code PROTOCOL_CONNECTION_LOST, errno undefined
 *
 * The second one is why 1927/ER_CONNECTION_KILLED alone is not enough.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/ingest-batch-kill-boundary.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { cleanupTestMeasurements, DEFAULT_TEST_CONFIG, setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(`[ingest-batch-kill] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not local. This suite issues KILL statements.`);
}

const PROCEDURE_MARKER = 'bulkingestionprocess';

const sharedState = vi.hoisted(() => ({
  connection: null as import('mysql2/promise').Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0,
  /**
   * Opens the connection each `bulkingestionprocess` CALL runs on. Production
   * gives the CALL its own pooled connection and destroys it when the statement
   * is killed; a disposable connection per attempt models that, and — unlike the
   * suite-wide shared connection — lets `KILL <id>` be tested without taking
   * every other statement down with it.
   */
  openProcedureConnection: null as null | (() => Promise<import('mysql2/promise').Connection>),
  /** Thread id of each CALL attempt, in order. Length = number of attempts. */
  procedureThreadIDs: [] as number[]
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const requireConnection = () => {
    if (!sharedState.connection) throw new Error('Test DB connection not initialized');
    return sharedState.connection;
  };

  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (sharedState.openProcedureConnection && query.includes(PROCEDURE_MARKER)) {
        const procedureConnection = await sharedState.openProcedureConnection();
        sharedState.procedureThreadIDs.push((procedureConnection as Connection & { threadId: number }).threadId);
        try {
          const [rows] = await procedureConnection.query(query, params ?? []);
          return rows;
        } finally {
          // Mirrors the DB layer's quarantine: a connection whose statement was
          // KILLed never goes back into circulation.
          try {
            await procedureConnection.end();
          } catch {
            procedureConnection.destroy();
          }
        }
      }
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      const [rows] = await requireConnection().query(query, params ?? []);
      return rows;
    },
    beginTransaction: async () => {
      await requireConnection().beginTransaction();
      sharedState.transactionCounter += 1;
      sharedState.activeTransactionID = `kill-boundary-tx-${sharedState.transactionCounter}`;
      return sharedState.activeTransactionID;
    },
    commitTransaction: async () => {
      await requireConnection().commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async () => {
      await requireConnection().rollback();
      sharedState.activeTransactionID = null;
    },
    withTransaction: async <T>(fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown>; readonly id: string }) => Promise<T>): Promise<T> => {
      const id = await manager.beginTransaction();
      try {
        const result = await fn({ id, query: (sql: string, params?: unknown[]) => manager.executeQuery(sql, params, id) });
        await manager.commitTransaction();
        return result;
      } catch (error) {
        await manager.rollbackTransaction();
        throw error;
      }
    },
    acquireApplicationLock: async (lockName: string, _transactionID: string, timeoutMs: number) => {
      const [rows] = await requireConnection().query<RowDataPacket[]>('SELECT GET_LOCK(?, ?) as acquired', [lockName, Math.ceil(timeoutMs / 1000)]);
      return rows[0]?.acquired === 1;
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
import { ingestBatch } from '@/lib/uploads/ingest-batch';

const FILE_NAME = 'kill-boundary-fixture.csv';
const BATCH_ID = 'kill-boundary-0001';

/**
 * Enough rows that the CALL reliably takes long enough to be killed
 * mid-statement. At the benchmarked ~10k rows / 2s, this is a ~600ms window —
 * hundreds of poll iterations wide. The test fails loudly rather than silently
 * passing if the kill never lands.
 */
const FIXTURE_ROW_COUNT = 3000;
const STAGING_CHUNK_SIZE = 1000;

/** How long to keep looking for the CALL to appear as an executing statement. */
const KILL_WATCH_TIMEOUT_MS = 20_000;
const KILL_POLL_INTERVAL_MS = 2;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('ingestBatch — a really-KILLed procedure call is never replayed', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let schema: string;
  let plotID: number;
  let censusID: number;

  const connectionManager = ConnectionManager.getInstance();

  function procedureConnectionConfig() {
    return {
      host: DEFAULT_TEST_CONFIG.host,
      port: DEFAULT_TEST_CONFIG.port,
      user: DEFAULT_TEST_CONFIG.user,
      password: DEFAULT_TEST_CONFIG.password,
      database: schema
    };
  }

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
    sharedState.openProcedureConnection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    if (sharedState.activeTransactionID) {
      await connection.rollback();
      sharedState.activeTransactionID = null;
    }
    await cleanupTestMeasurements(connection, testData, { additionalTables: ['unifiedchangelog'] });
    sharedState.procedureThreadIDs.length = 0;
    sharedState.openProcedureConnection = () => mysql.createConnection(procedureConnectionConfig());
  });

  async function stageFixtureRows(): Promise<void> {
    const speciesCode = testData.species[0].SpeciesCode;
    const quadratName = testData.quadrats[0].QuadratName;
    const rows: unknown[][] = [];
    for (let i = 1; i <= FIXTURE_ROW_COUNT; i++) {
      rows.push([
        FILE_NAME,
        BATCH_ID,
        plotID,
        censusID,
        `KB${String(i).padStart(6, '0')}`,
        '1',
        speciesCode,
        quadratName,
        (i % 500) / 10,
        (i % 700) / 10,
        10 + (i % 900) / 10,
        1.3,
        '2024-03-15',
        null,
        null,
        null
      ]);
    }
    for (let offset = 0; offset < rows.length; offset += STAGING_CHUNK_SIZE) {
      await connection.query(
        `INSERT INTO temporarymeasurements
           (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName,
            LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments, PublishedStemID)
         VALUES ?`,
        [rows.slice(offset, offset + STAGING_CHUNK_SIZE)]
      );
    }
  }

  async function countTemporaryRows(): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM temporarymeasurements WHERE FileID = ?', [FILE_NAME]);
    return Number(rows[0].count);
  }

  async function countUnresolvedRows(): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NULL', [
      FILE_NAME
    ]);
    return Number(rows[0].count);
  }

  /**
   * Waits until the first CALL attempt is genuinely executing on the server,
   * then issues `killVerb` against it from an independent connection.
   * Throws — rather than quietly doing nothing — if the CALL never appears, so a
   * mistimed test can never masquerade as a passing one.
   */
  async function killProcedureCallWhenRunning(killVerb: 'KILL QUERY' | 'KILL'): Promise<number> {
    const killer = await mysql.createConnection(procedureConnectionConfig());
    try {
      const deadline = Date.now() + KILL_WATCH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const threadID = sharedState.procedureThreadIDs[0];
        if (threadID !== undefined) {
          const [processes] = await killer.query<RowDataPacket[]>('SELECT COMMAND, INFO FROM information_schema.processlist WHERE ID = ?', [threadID]);
          const info = processes[0]?.INFO;
          if (typeof info === 'string' && info.includes(PROCEDURE_MARKER)) {
            await killer.query(`${killVerb} ${threadID}`);
            console.log(`[kill-boundary] issued "${killVerb} ${threadID}" while it was executing: ${info.slice(0, 80)}`);
            return threadID;
          }
        }
        await sleep(KILL_POLL_INTERVAL_MS);
      }
      throw new Error(
        `Never observed the ${PROCEDURE_MARKER} CALL executing within ${KILL_WATCH_TIMEOUT_MS}ms — the kill was never issued, so this test proved nothing.`
      );
    } finally {
      await killer.end().catch(() => undefined);
    }
  }

  it.each([
    { killVerb: 'KILL QUERY' as const, shape: 'ER_QUERY_INTERRUPTED / 1317' },
    { killVerb: 'KILL' as const, shape: 'PROTOCOL_CONNECTION_LOST (no errno)' }
  ])(
    'abandons the sub-batch after ONE attempt when "$killVerb" aborts the call ($shape)',
    async ({ killVerb }) => {
      await stageFixtureRows();
      expect(await countTemporaryRows()).toBe(FIXTURE_ROW_COUNT);

      const killed = killProcedureCallWhenRunning(killVerb);
      const result = await ingestBatch(connectionManager, { schema, fileID: FILE_NAME, batchID: BATCH_ID });
      const killedThreadID = await killed;

      console.log(
        `[kill-boundary] verb="${killVerb}" thread=${killedThreadID} attempts=${sharedState.procedureThreadIDs.length} ` +
          `subBatches=${result.subBatchResults.length} message=${result.subBatchResults[0]?.message}`
      );

      // The whole point: one attempt. Not 3 (the old timeout budget), not 5.
      expect(sharedState.procedureThreadIDs, 'a KILLed procedure call must never be re-run').toHaveLength(1);

      expect(result.subBatchResults).toHaveLength(1);
      const subResult = result.subBatchResults[0];
      expect(subResult.attemptsNeeded).toBe(1);
      expect(subResult.batchFailedButHandled).toBe(true);

      // Rows are conserved: nothing left staged, everything preserved as an
      // unresolved failure the user can see and re-upload.
      expect(subResult.rowCount).toBe(FIXTURE_ROW_COUNT);
      expect(await countTemporaryRows()).toBe(0);
      expect(await countUnresolvedRows()).toBe(FIXTURE_ROW_COUNT);

      // And the recorded reason names the kill and the real attempt count, rather
      // than the old shared "exhausted all 5 attempts" text.
      expect(subResult.message).toMatch(/KILL|timed out/i);
      expect(subResult.message).not.toMatch(/all 5 attempts/i);
    },
    120000
  );
});
