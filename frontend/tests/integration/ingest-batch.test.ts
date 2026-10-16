/**
 * ingestBatch — Integration Tests
 *
 * Exercises the extracted batch-ingestion mechanism (lib/uploads/ingest-batch.ts)
 * against a real local MySQL instance running the actual bulkingestionprocess
 * stored procedure. Rows are staged through the shared stageMeasurementChunk
 * mechanism, exactly like the production upload pipeline.
 *
 * Covered semantics:
 *   1. Happy path — staged rows ingest into coremeasurements with upload
 *      tracking columns, uploadmetrics lands at status='completed', and
 *      temporarymeasurements drains.
 *   2. Idempotent skip — re-running the same file/batch after completion is a
 *      no-op: the procedure's uploadmetrics 'completed' check skips re-ingestion
 *      and drains the re-staged rows (CoreMeasurementIDs unchanged).
 *   3. Stale-state recovery (first census) — a batch stuck at
 *      status='processing' with no completed uploads triggers the
 *      failed-initial-census recovery preflight, wiping the dirty state before
 *      a clean re-ingest.
 *   4. Stale-state self-heal (procedure branch) — when recovery preflight is
 *      not applicable (another completed upload exists for the census), the
 *      procedure itself deletes the partial rows for the stale batch and
 *      re-ingests cleanly.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/ingest-batch.test.ts
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
    `[ingest-batch] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops and recreates its test schema and must only run against a local test database.`
  );
}

// ---------------------------------------------------------------------------
// Shared state bridge — hoisted so the ConnectionManager mock closure can read
// the live test connection after beforeAll wires it up.
// ---------------------------------------------------------------------------

const TRANSACTION_ID_PREFIX = 'ingest-batch-tx-';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0
}));

// ConnectionManager mock — routes every DB call (including the stored procedure
// CALL, withTransaction, and GET_LOCK application locking) to the shared real
// MySQL connection so the production sequence runs against real MySQL state.
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
import { ingestBatch, IngestBatchAbortedError, type IngestBatchResult } from '@/lib/uploads/ingest-batch';
import { BatchFamilyScopeError } from '@/lib/uploads/batch-family';
import { ChangelogWriteError } from '@/lib/changelog/record-mutation';
import { auditCoreMeasurementsScopeDiff, snapshotCoreMeasurementsScope } from '@/lib/changelog/ingestion-audit';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const FILE_NAME = 'ingest-batch-fixture.csv';
const BATCH_ID = 'ingest-batch-0001';
const UPLOAD_SESSION_ID = 'ingest-batch-int-test-session';
const CHANGED_BY = 'ingest-batch-test@forestgeo.test';
const CSV_DELIMITER = ',';
const CSV_HEADERS = ['tag', 'stemtag', 'spcode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'];
const MEASUREMENT_DATE = '2024-03-15';

const EXPECTED_ROW_COUNT = 5;

const UPLOADMETRICS_STATUS_COMPLETED = 'completed';
const UPLOADMETRICS_STATUS_PROCESSING = 'processing';

/** The error MySQL raises on the client whose statement was aborted by KILL QUERY. */
const MYSQL_CODE_QUERY_INTERRUPTED = 'ER_QUERY_INTERRUPTED';
const MYSQL_ERRNO_QUERY_INTERRUPTED = 1317;
const MYSQL_SQLSTATE_QUERY_INTERRUPTED = '70100';
const MYSQL_QUERY_INTERRUPTED_MESSAGE = 'Query execution was interrupted';

/**
 * Five clean fixture rows: valid species, quadrats, attribute codes, and dates
 * inside the seeded census window — the procedure should ingest all of them.
 */
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
    row('IB001', '1', 'ACERRU', 'Q01', '1.5', '2.5', '10.5', 'A'),
    row('IB002', '1', 'QUERCO', 'Q01', '3.5', '4.5', '20.4', 'A;R'),
    row('IB003', '1', 'PINUST', 'Q02', '5.5', '6.5', '30.1', 'A'),
    row('IB004', '1', 'FAGUGR', 'Q02', '7.5', '8.5', '15.2', 'A'),
    row('IB005', '1', 'BETUAL', 'Q03', '9.5', '0.5', '25.8', 'A')
  ];
}

// ---------------------------------------------------------------------------
// Suite lifecycle
// ---------------------------------------------------------------------------

describe('ingestBatch — integration', () => {
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

  async function stageFixtureRows(fileName: string = FILE_NAME): Promise<void> {
    const transactionID = await connectionManager.beginTransaction();
    const params: StageMeasurementChunkParams = {
      schema,
      fileName,
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
      firstRowOrdinal: null,
      changedBy: CHANGED_BY
    };
    const result = await stageMeasurementChunk(connectionManager, params);
    await connectionManager.commitTransaction(transactionID);
    console.log(`[stage] insertedCount=${result.insertedCount} invalidRows=${result.invalidRows.length} droppedCount=${result.droppedCount}`);
    expect(result.insertedCount).toBe(EXPECTED_ROW_COUNT);
    expect(result.invalidRows).toHaveLength(0);
  }

  async function runIngestBatch(fileName: string = FILE_NAME, changedBy?: string): Promise<IngestBatchResult> {
    const result = await ingestBatch(connectionManager, { schema, fileID: fileName, batchID: BATCH_ID, expectedScope: { plotID, censusID }, changedBy });
    console.log(
      `[ingestBatch] processedSubBatches=${result.processedSubBatches} totalRows=${result.totalRows} recovered=${result.recovered} ` +
        `noDataFound=${result.noDataFound} totalDurationMs=${result.totalDurationMs}`
    );
    for (const sub of result.subBatchResults) {
      console.log(
        `[ingestBatch] sub-batch ${sub.subBatchID}: attempts=${sub.attemptsNeeded} failedButHandled=${sub.batchFailedButHandled} message=${sub.message}`
      );
    }
    return result;
  }

  async function fetchBatchMeasurements(fileName: string = FILE_NAME): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID, StemGUID, CensusID, UploadFileID, UploadBatchID,
              CAST(MeasuredDBH AS CHAR) AS DBHText, CAST(MeasurementDate AS CHAR) AS MeasurementDateText
       FROM coremeasurements
       WHERE UploadFileID = ? AND UploadBatchID = ?
       ORDER BY CoreMeasurementID`,
      [fileName, BATCH_ID]
    );
    return rows;
  }

  async function fetchUploadMetrics(): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT uploadId, fileID, batchID, status, sourceRecords, processedRecords, failedRecords FROM uploadmetrics WHERE batchID = ? ORDER BY id',
      [BATCH_ID]
    );
    return rows;
  }

  /** Distinct ingestion error codes currently attached to this file's unresolved rows. */
  async function fetchIngestionErrorCodes(fileName: string = FILE_NAME): Promise<string[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT DISTINCT me.ErrorCode
       FROM measurement_error_log mel
       JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
       JOIN coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
       WHERE cm.UploadFileID = ? AND me.ErrorSource = 'ingestion'
       ORDER BY me.ErrorCode`,
      [fileName]
    );
    return rows.map(row => String(row.ErrorCode));
  }

  async function countTemporaryRows(): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM temporarymeasurements WHERE FileID = ? AND BatchID = ?', [
      FILE_NAME,
      BATCH_ID
    ]);
    return Number(rows[0].count);
  }

  it('rejects a caller scope that differs from the staged family before changing staging or metrics', async () => {
    await stageFixtureRows();
    const before = await countTemporaryRows();
    await expect(
      ingestBatch(connectionManager, {
        schema,
        fileID: FILE_NAME,
        batchID: BATCH_ID,
        expectedScope: { plotID, censusID: censusID + 100_000 }
      })
    ).rejects.toBeInstanceOf(BatchFamilyScopeError);
    expect(await countTemporaryRows()).toBe(before);
    expect(await fetchUploadMetrics()).toHaveLength(0);
  });

  it('rejects missing or invalid expected scope at the shared boundary', async () => {
    const before = await countTemporaryRows();
    await expect(ingestBatch(connectionManager, { schema, fileID: FILE_NAME, batchID: BATCH_ID } as any)).rejects.toThrow(/expectedScope/);
    await expect(ingestBatch(connectionManager, { schema, fileID: FILE_NAME, batchID: BATCH_ID, expectedScope: { plotID: 0, censusID } })).rejects.toThrow(
      /expectedScope/
    );
    expect(await countTemporaryRows()).toBe(before);
  });

  async function countCensusMeasurements(): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM coremeasurements WHERE CensusID = ?', [censusID]);
    return Number(rows[0].count);
  }

  /**
   * unifiedchangelog rows filed against this file's CURRENT coremeasurements
   * rows (#507). Scoped through coremeasurements rather than a fixed ID list
   * so it reads correctly whether the IDs in play came from a fresh ingest or
   * survived unchanged through an idempotent-skip re-run.
   */
  async function fetchAuditOperationCounts(fileName: string = FILE_NAME): Promise<Record<string, number>> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT ucl.Operation, COUNT(*) AS count
       FROM unifiedchangelog ucl
       WHERE ucl.TableName = 'coremeasurements'
         AND ucl.RecordID IN (SELECT CoreMeasurementID FROM coremeasurements WHERE UploadFileID = ?)
       GROUP BY ucl.Operation`,
      [fileName]
    );
    const counts: Record<string, number> = {};
    for (const row of rows) counts[String(row.Operation)] = Number(row.count);
    return counts;
  }

  function assertCleanRowSet(measurements: RowDataPacket[]): void {
    expect(measurements).toHaveLength(EXPECTED_ROW_COUNT);
    for (const row of measurements) {
      console.log(
        `[db row] CoreMeasurementID=${row.CoreMeasurementID} StemGUID=${row.StemGUID} DBH=${row.DBHText} Date=${row.MeasurementDateText} ` +
          `UploadFileID=${row.UploadFileID} UploadBatchID=${row.UploadBatchID}`
      );
      expect(row.StemGUID).not.toBeNull(); // StemGUID=NULL would mean a failed/unresolved row
      expect(row.UploadFileID).toBe(FILE_NAME);
      expect(row.UploadBatchID).toBe(BATCH_ID);
      expect(row.CensusID).toBe(censusID);
    }
  }

  // -------------------------------------------------------------------------
  // 1. Happy path
  // -------------------------------------------------------------------------

  it('ingests staged rows through the real bulkingestionprocess into coremeasurements', async () => {
    await stageFixtureRows();

    const result = await runIngestBatch();

    expect(result.noDataFound).toBe(false);
    expect(result.recovered).toBe(false);
    expect(result.processedSubBatches).toBe(1);
    expect(result.totalRows).toBe(EXPECTED_ROW_COUNT);
    expect(result.subBatchResults).toHaveLength(1);
    expect(result.subBatchResults[0].subBatchID).toBe(BATCH_ID); // 5 rows ≪ 10K: no sub-batch split
    expect(result.subBatchResults[0].attemptsNeeded).toBe(1);
    expect(result.subBatchResults[0].batchFailedButHandled).toBe(false);

    const measurements = await fetchBatchMeasurements();
    assertCleanRowSet(measurements);

    const metrics = await fetchUploadMetrics();
    console.log(`[uploadmetrics] ${JSON.stringify(metrics)}`);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].status).toBe(UPLOADMETRICS_STATUS_COMPLETED);
    expect(Number(metrics[0].sourceRecords)).toBe(EXPECTED_ROW_COUNT);
    expect(Number(metrics[0].failedRecords)).toBe(0);

    const remainingTemp = await countTemporaryRows();
    console.log(`[temporarymeasurements] remaining=${remainingTemp}`);
    expect(remainingTemp).toBe(0);

    // #507: the CALL and its audit commit in the SAME transaction — a fresh
    // ingest must leave exactly one INSERT-operation changelog row per
    // committed coremeasurements row, no DELETE rows (nothing was removed).
    const auditCounts = await fetchAuditOperationCounts();
    console.log(`[audit] operation counts=${JSON.stringify(auditCounts)}`);
    expect(auditCounts.INSERT).toBe(EXPECTED_ROW_COUNT);
    expect(auditCounts.DELETE).toBeUndefined();
  }, 60000);

  // -------------------------------------------------------------------------
  // 2. Idempotent skip via uploadmetrics 'completed'
  // -------------------------------------------------------------------------

  it('skips re-ingestion of a completed batch: same CoreMeasurementIDs, re-staged rows drained', async () => {
    await stageFixtureRows();
    const firstRun = await runIngestBatch();
    expect(firstRun.subBatchResults[0].batchFailedButHandled).toBe(false);

    const firstMeasurements = await fetchBatchMeasurements();
    assertCleanRowSet(firstMeasurements);
    const firstIDs = firstMeasurements.map(row => Number(row.CoreMeasurementID));
    console.log(`[idempotent] first-run CoreMeasurementIDs=${JSON.stringify(firstIDs)}`);

    // #507 baseline: the first (real) commit audited exactly one INSERT row
    // per committed coremeasurements row.
    const firstAudit = await fetchAuditOperationCounts();
    console.log(`[idempotent] first-run audit counts=${JSON.stringify(firstAudit)}`);
    expect(firstAudit.INSERT).toBe(EXPECTED_ROW_COUNT);

    // Re-stage the identical rows under the same file/batch, then re-run.
    await stageFixtureRows();
    expect(await countTemporaryRows()).toBe(EXPECTED_ROW_COUNT);

    const secondRun = await runIngestBatch();
    expect(secondRun.noDataFound).toBe(false);
    expect(secondRun.recovered).toBe(false);
    expect(secondRun.processedSubBatches).toBe(1);
    expect(secondRun.subBatchResults[0].batchFailedButHandled).toBe(false);
    // Exactly one attempt: the diff-based audit must not have thrown a
    // mismatch error on the genuine no-op (which would have forced a retry).
    expect(secondRun.subBatchResults[0].attemptsNeeded).toBe(1);
    // The procedure's uploadmetrics keystone: completed batches are skipped.
    expect(String(secondRun.subBatchResults[0].message)).toContain('already processed, skipped');

    const secondMeasurements = await fetchBatchMeasurements();
    const secondIDs = secondMeasurements.map(row => Number(row.CoreMeasurementID));
    console.log(`[idempotent] second-run CoreMeasurementIDs=${JSON.stringify(secondIDs)}`);
    expect(secondIDs).toEqual(firstIDs); // not just same count — the exact same rows survive

    expect(await countCensusMeasurements()).toBe(EXPECTED_ROW_COUNT);
    expect(await countTemporaryRows()).toBe(0); // skip branch still drains the re-staged rows

    // #507 regression target: the procedure's noop branch left the SAME
    // coremeasurements rows in place (never touched them), but ingestBatch
    // still calls recordCommittedCoreMeasurementsAudit after every CALL. Without
    // the "already audited" guard in ingestion-audit.ts, this second run would
    // double the INSERT count to 2×EXPECTED_ROW_COUNT — a duplicate changelog
    // entry for data that never actually changed. It must stay exactly as it
    // was after the first run.
    const secondAudit = await fetchAuditOperationCounts();
    console.log(`[idempotent] second-run audit counts=${JSON.stringify(secondAudit)}`);
    expect(secondAudit.INSERT).toBe(EXPECTED_ROW_COUNT);
    expect(secondAudit.DELETE).toBeUndefined();

    const metrics = await fetchUploadMetrics();
    console.log(`[uploadmetrics] ${JSON.stringify(metrics)}`);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].status).toBe(UPLOADMETRICS_STATUS_COMPLETED);
  }, 60000);

  // -------------------------------------------------------------------------
  // 3. Stale 'processing' state — failed-initial-census recovery preflight
  // -------------------------------------------------------------------------

  it('recovers a stale processing batch on a first census via the recovery preflight (one clean row set)', async () => {
    await stageFixtureRows();
    await runIngestBatch(FILE_NAME, CHANGED_BY);
    const firstRunMeasurements = await fetchBatchMeasurements();
    assertCleanRowSet(firstRunMeasurements);
    const firstRunIDs = firstRunMeasurements.map(row => Number(row.CoreMeasurementID));

    // Simulate a crash that left the batch stuck mid-processing.
    await connection.query('UPDATE uploadmetrics SET status = ?, endTime = NULL WHERE batchID = ?', [UPLOADMETRICS_STATUS_PROCESSING, BATCH_ID]);
    await stageFixtureRows();

    const result = await runIngestBatch(FILE_NAME, CHANGED_BY);

    // No completed uploads remain for the census, so the dirty first-load
    // recovery preflight must fire and wipe the residual state.
    expect(result.recovered).toBe(true);
    expect(result.noDataFound).toBe(false);
    expect(result.subBatchResults[0].batchFailedButHandled).toBe(false);

    const measurements = await fetchBatchMeasurements();
    assertCleanRowSet(measurements);
    expect(await countCensusMeasurements()).toBe(EXPECTED_ROW_COUNT); // census-wide: exactly one row set, no duplicates
    expect(await countTemporaryRows()).toBe(0);

    const metrics = await fetchUploadMetrics();
    console.log(`[uploadmetrics] ${JSON.stringify(metrics)}`);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].status).toBe(UPLOADMETRICS_STATUS_COMPLETED);

    // recoverFailedInitialCensusIfNeeded's coremeasurements delete now goes
    // through deleteCoreMeasurementsInBoundedChunksWithAudit (#507), so every
    // row the FIRST run committed must have a DELETE audit entry carrying its
    // exact prior state and the trusted actor threaded through ingestBatch —
    // never a raw, unaudited DELETE.
    for (const oldRow of firstRunMeasurements) {
      const oldRowID = Number(oldRow.CoreMeasurementID);
      const [deleteAuditRows] = await connection.query<RowDataPacket[]>(
        `SELECT OldRowState, ChangedBy FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND Operation = 'DELETE' AND RecordID = ?`,
        [oldRowID]
      );
      expect(deleteAuditRows, `recovery must audit the DELETE of first-run row ${oldRowID}`).toHaveLength(1);
      expect(deleteAuditRows[0].ChangedBy, 'the recovery delete must carry the trusted actor ingestBatch was given').toBe(CHANGED_BY);
      const oldState = typeof deleteAuditRows[0].OldRowState === 'string' ? JSON.parse(deleteAuditRows[0].OldRowState) : deleteAuditRows[0].OldRowState;
      expect(Number(oldState.CoreMeasurementID)).toBe(oldRowID);
      expect(oldState.MeasurementDate).toBe(oldRow.MeasurementDateText);
    }
    // The recovered census must not contain any of the first run's own IDs —
    // every surviving row came from the SECOND ingest.
    const survivingIDs = measurements.map(row => Number(row.CoreMeasurementID));
    expect(
      survivingIDs.some(id => firstRunIDs.includes(id)),
      'none of the first run’s rows may survive the recovery delete'
    ).toBe(false);
  }, 60000);

  it('rolls back the recovery delete entirely when its audit fails, leaving the stale first-run data intact (#507)', async () => {
    await stageFixtureRows();
    await runIngestBatch(FILE_NAME, CHANGED_BY);
    const firstRunMeasurements = await fetchBatchMeasurements();
    expect(firstRunMeasurements.length).toBeGreaterThan(0);

    await connection.query('UPDATE uploadmetrics SET status = ?, endTime = NULL WHERE batchID = ?', [UPLOADMETRICS_STATUS_PROCESSING, BATCH_ID]);
    await stageFixtureRows();

    const AUDIT_FAILURE_MESSAGE = 'Simulated unifiedchangelog write failure during first-census recovery';
    const realExecuteQuery = connectionManager.executeQuery.bind(connectionManager);
    const auditFailureSpy = vi
      .spyOn(connectionManager, 'executeQuery')
      .mockImplementation(async (query: string, params?: unknown[], transactionId?: string) => {
        if (typeof query === 'string' && query.includes('.unifiedchangelog') && query.includes('OldRowState') && !query.includes('NewRowState')) {
          throw new Error(AUDIT_FAILURE_MESSAGE);
        }
        return realExecuteQuery(query, params, transactionId);
      });

    try {
      await expect(runIngestBatch(FILE_NAME, CHANGED_BY)).rejects.toThrow();

      // The setup transaction (recovery + its audit) must have rolled back
      // together: the stale first-run data survives, byte-identical.
      const survivingMeasurements = await fetchBatchMeasurements();
      expect(survivingMeasurements.map(row => Number(row.CoreMeasurementID))).toEqual(firstRunMeasurements.map(row => Number(row.CoreMeasurementID)));
      expect(survivingMeasurements.map(row => row.MeasurementDateText)).toEqual(firstRunMeasurements.map(row => row.MeasurementDateText));
    } finally {
      auditFailureSpy.mockRestore();
    }
  }, 60000);

  // -------------------------------------------------------------------------
  // 4. Stale 'processing' state — procedure-level self-heal branch
  // -------------------------------------------------------------------------

  it('self-heals a stale processing batch inside the procedure when recovery preflight does not apply', async () => {
    await stageFixtureRows();
    await runIngestBatch();
    const firstMeasurements = await fetchBatchMeasurements();
    assertCleanRowSet(firstMeasurements);
    const firstIDs = firstMeasurements.map(row => Number(row.CoreMeasurementID));

    await connection.query('UPDATE uploadmetrics SET status = ?, endTime = NULL WHERE batchID = ?', [UPLOADMETRICS_STATUS_PROCESSING, BATCH_ID]);
    await stageFixtureRows();

    // A completed upload from another batch in the same census disables the
    // first-census recovery preflight, forcing the procedure's own stale-state
    // branch (delete partial rows for the batch, reset uploadmetrics, re-ingest).
    await connection.query(
      `INSERT INTO uploadmetrics (uploadId, fileID, batchID, schema_name, plotID, censusID, sourceRecords, status, startTime)
       VALUES ('ingest-batch-dummy-completed', 'some-other-file.csv', 'some-other-batch', ?, ?, ?, 1, ?, NOW())`,
      [schema, plotID, censusID, UPLOADMETRICS_STATUS_COMPLETED]
    );

    const result = await runIngestBatch();

    expect(result.recovered).toBe(false); // preflight must NOT have fired
    expect(result.noDataFound).toBe(false);
    expect(result.subBatchResults[0].batchFailedButHandled).toBe(false);

    const secondMeasurements = await fetchBatchMeasurements();
    assertCleanRowSet(secondMeasurements);
    const secondIDs = secondMeasurements.map(row => Number(row.CoreMeasurementID));
    console.log(`[self-heal] firstIDs=${JSON.stringify(firstIDs)} secondIDs=${JSON.stringify(secondIDs)}`);
    // The stale partial rows were deleted and re-ingested, not skipped.
    expect(secondIDs).not.toEqual(firstIDs);

    expect(await countCensusMeasurements()).toBe(EXPECTED_ROW_COUNT); // exactly one clean row set, no duplicates
    expect(await countTemporaryRows()).toBe(0);

    const metrics = await fetchUploadMetrics();
    console.log(`[uploadmetrics] ${JSON.stringify(metrics)}`);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].status).toBe(UPLOADMETRICS_STATUS_COMPLETED);

    // #507: a net row-COUNT delta across the self-heal (5 old rows deleted,
    // 5 new ones inserted under the SAME UploadFileID/UploadBatchID) nets to
    // zero — proving the audit is NOT driven by that delta, every one of the
    // 5 new rows must still have its own INSERT audit, and the 5 removed
    // stale rows must have their own DELETE audit (the procedure's internal
    // cleanup is a real mutation on data this app already committed once).
    const [insertAuditRows] = await connection.query<RowDataPacket[]>(
      `SELECT RecordID FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND Operation = 'INSERT' AND RecordID IN (${secondIDs.map(() => '?').join(',')})`,
      secondIDs
    );
    console.log(`[self-heal] INSERT audit rows for secondIDs: ${JSON.stringify(insertAuditRows)}`);
    expect(insertAuditRows, 'every genuinely new row from the self-heal must have its own INSERT audit').toHaveLength(EXPECTED_ROW_COUNT);

    const [deleteAuditRows] = await connection.query<RowDataPacket[]>(
      `SELECT RecordID, OldRowState FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND Operation = 'DELETE' AND RecordID IN (${firstIDs.map(() => '?').join(',')})`,
      firstIDs
    );
    console.log(`[self-heal] DELETE audit rows for firstIDs: ${JSON.stringify(deleteAuditRows)}`);
    expect(deleteAuditRows, 'every stale residue row the self-heal removed must have its own DELETE audit').toHaveLength(EXPECTED_ROW_COUNT);
    for (const row of deleteAuditRows) {
      const oldState = typeof row.OldRowState === 'string' ? JSON.parse(row.OldRowState) : row.OldRowState;
      expect(Number(oldState.CoreMeasurementID)).toBe(Number(row.RecordID));
    }

    // No fabricated INSERT history for the OLD (now-deleted) rows, and no
    // fabricated DELETE history for the NEW (still-live) rows.
    const [insertAuditForOldRows] = await connection.query<RowDataPacket[]>(
      `SELECT RecordID FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND Operation = 'INSERT' AND RecordID IN (${firstIDs.map(() => '?').join(',')})`,
      firstIDs
    );
    expect(insertAuditForOldRows, 'the old rows already had their own INSERT audit from the first ingest — this self-heal must not duplicate it').toHaveLength(
      EXPECTED_ROW_COUNT
    );
  }, 60000);

  // -------------------------------------------------------------------------
  // 4b. Matched same-file unresolved-failure cleanup audits what it removes (#507)
  //
  // cleanupMatchedUnresolvedIngestionFailuresForBatch (ingest-batch.ts Phase 1
  // setup) removes stale unresolved coremeasurements rows that match the
  // currently staged file before the real ingest runs. Every row it removes
  // is a real committed write this app made earlier, so the DELETE must be
  // audited with the row's actual OldRowState, not just silently removed.
  // -------------------------------------------------------------------------

  it("audits the same-file unresolved-failure cleanup it runs before ingesting, with the row's actual OldRowState (#507)", async () => {
    const PRIOR_BATCH_ID = 'ingest-batch-prior-failed-batch';

    // Stage FIRST: stageFixtureRows runs CLEAN_REUPLOAD's own census-wide
    // cleanupPreviousFileUploads, which would otherwise delete a row seeded
    // BEFORE staging as collateral damage — leaving nothing for ingestBatch's
    // own cleanupMatchedUnresolvedIngestionFailuresForBatch to find, and
    // misattributing whatever DELETE audit this test observes to staging's
    // actor instead.
    await stageFixtureRows();

    // A stale unresolved row left by an earlier, DIFFERENT batch of the SAME
    // file — exactly what cleanupMatchedUnresolvedIngestionFailuresForBatch's
    // same-file branch targets (StemGUID NULL, same UploadFileID, a batchID
    // outside the incoming family). Seeded AFTER staging, so it is still here
    // when ingestBatch's own matched-cleanup runs.
    const [priorInsertResult]: any = await connection.query(
      `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
         UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
       VALUES (?, NULL, FALSE, '2024-03-15', 1.0, 1.0, ?, ?, 'STALE-TAG', 1, 1)`,
      [censusID, FILE_NAME, PRIOR_BATCH_ID]
    );
    const priorRowID = Number(priorInsertResult.insertId);

    // Prove the candidate actually reaches ingestBatch's matched-cleanup: it
    // must be present and carry zero audit history immediately before ingest.
    const [candidateBeforeIngest] = await connection.query<RowDataPacket[]>('SELECT CoreMeasurementID FROM coremeasurements WHERE CoreMeasurementID = ?', [
      priorRowID
    ]);
    expect(candidateBeforeIngest, 'setup: the stale row must survive staging and still be present before ingestBatch runs').toHaveLength(1);
    const [candidateAuditBeforeIngest] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND RecordID = ?`,
      [priorRowID]
    );
    expect(Number(candidateAuditBeforeIngest[0].count), 'setup: the stale row must be unaudited before ingestBatch runs its matched-cleanup').toBe(0);

    const result = await runIngestBatch();

    assertCleanRowSet(await fetchBatchMeasurements());
    expect(result.subBatchResults[0].batchFailedButHandled).toBe(false);

    // The stale row must be gone before the real ingest proceeded...
    const [survivingPriorRow] = await connection.query<RowDataPacket[]>('SELECT CoreMeasurementID FROM coremeasurements WHERE CoreMeasurementID = ?', [
      priorRowID
    ]);
    expect(survivingPriorRow, 'the stale same-file unresolved row must have been removed before ingestion').toHaveLength(0);

    // ...and audited as a DELETE with its actual prior state, not fabricated.
    const [deleteAuditRows] = await connection.query<RowDataPacket[]>(
      `SELECT RecordID, OldRowState, ChangedBy FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND Operation = 'DELETE' AND RecordID = ?`,
      [priorRowID]
    );
    console.log(`[matched-cleanup] delete audit rows: ${JSON.stringify(deleteAuditRows)}`);
    expect(deleteAuditRows, 'the removed row must have exactly one DELETE audit entry').toHaveLength(1);
    // runIngestBatch's test helper does not pass changedBy, so NULL here is
    // the correctly-propagated value, not a missed attribution.
    expect(deleteAuditRows[0].ChangedBy).toBeNull();
    const oldState = typeof deleteAuditRows[0].OldRowState === 'string' ? JSON.parse(deleteAuditRows[0].OldRowState) : deleteAuditRows[0].OldRowState;
    expect(Number(oldState.CoreMeasurementID)).toBe(priorRowID);
    expect(oldState.RawTreeTag).toBe('STALE-TAG');
    expect(oldState.UploadBatchID).toBe(PRIOR_BATCH_ID);
  }, 60000);

  // -------------------------------------------------------------------------
  // 4b-cross. Matched CROSS-file unresolved-failure cleanup — same plot/census
  // scope, a DIFFERENT filename, exact OldRowState, plus scope isolation
  // (#507)
  //
  // The cross-file branch of cleanupMatchedUnresolvedIngestionFailuresForBatch
  // matches by RAW CONTENT (TreeTag/StemTag/SpeciesCode/Quadrat/coords/DBH/
  // HOM/date/Codes/Comments), not by filename — a real parked ingestion
  // failure needs its own linked measurement_error_log row to even be a
  // candidate (the join requires it), not just StemGUID IS NULL.
  // -------------------------------------------------------------------------

  async function seedCrossFileCandidateRow(fileID: string, batchID: string, targetCensusID: number): Promise<number> {
    const [insertResult]: any = await connection.query(
      `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
         UploadFileID, UploadBatchID, RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, SourceRowIndex, IsActive)
       VALUES (?, NULL, FALSE, ?, 10.5, 1.3, ?, ?, 'IB001', '1', 'ACERRU', 'Q01', 1.5, 2.5, 'A', 1, 1)`,
      [targetCensusID, MEASUREMENT_DATE, fileID, batchID]
    );
    const rowID = Number(insertResult.insertId);
    await connection.query(
      `INSERT INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage) VALUES ('ingestion', 'SQL_EXCEPTION', 'Ingestion SQL exception')
       ON DUPLICATE KEY UPDATE ErrorID = LAST_INSERT_ID(ErrorID)`
    );
    const [errorRows] = await connection.query<RowDataPacket[]>(
      `SELECT ErrorID FROM measurement_errors WHERE ErrorSource = 'ingestion' AND ErrorCode = 'SQL_EXCEPTION' LIMIT 1`
    );
    await connection.query(`INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved, CreatedAt) VALUES (?, ?, FALSE, NOW())`, [
      rowID,
      errorRows[0].ErrorID
    ]);
    return rowID;
  }

  it("audits the CROSS-file unresolved-failure cleanup it runs before ingesting, with the row's actual OldRowState (#507)", async () => {
    const CROSS_FILE_ID = 'ingest-batch-cross-file-prior.csv';
    const CROSS_FILE_BATCH_ID = 'ingest-batch-cross-file-prior-batch';

    // Stage FIRST — see the same-file test's comment above: staging's own
    // CLEAN_REUPLOAD census-wide cleanup would otherwise remove a same-census
    // candidate seeded beforehand, before ingestBatch's own matched-cleanup
    // ever gets to see (and audit) it.
    await stageFixtureRows();

    const crossFileRowID = await seedCrossFileCandidateRow(CROSS_FILE_ID, CROSS_FILE_BATCH_ID, censusID);

    const [candidateBeforeIngest] = await connection.query<RowDataPacket[]>('SELECT CoreMeasurementID FROM coremeasurements WHERE CoreMeasurementID = ?', [
      crossFileRowID
    ]);
    expect(candidateBeforeIngest, 'setup: the cross-file candidate must survive staging and still be present before ingestBatch runs').toHaveLength(1);
    const [candidateAuditBeforeIngest] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND RecordID = ?`,
      [crossFileRowID]
    );
    expect(Number(candidateAuditBeforeIngest[0].count), 'setup: the cross-file candidate must be unaudited before ingestBatch runs').toBe(0);

    const result = await runIngestBatch();

    assertCleanRowSet(await fetchBatchMeasurements());
    expect(result.subBatchResults[0].batchFailedButHandled).toBe(false);

    const [survivingCrossFileRow] = await connection.query<RowDataPacket[]>('SELECT CoreMeasurementID FROM coremeasurements WHERE CoreMeasurementID = ?', [
      crossFileRowID
    ]);
    expect(survivingCrossFileRow, 'the cross-file row matching the staged content must have been removed').toHaveLength(0);

    const [deleteAuditRows] = await connection.query<RowDataPacket[]>(
      `SELECT OldRowState FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND Operation = 'DELETE' AND RecordID = ?`,
      [crossFileRowID]
    );
    expect(deleteAuditRows, 'the removed cross-file row must have exactly one DELETE audit entry').toHaveLength(1);
    const oldState = typeof deleteAuditRows[0].OldRowState === 'string' ? JSON.parse(deleteAuditRows[0].OldRowState) : deleteAuditRows[0].OldRowState;
    expect(Number(oldState.CoreMeasurementID)).toBe(crossFileRowID);
    expect(oldState.RawTreeTag).toBe('IB001');
    expect(oldState.UploadFileID).toBe(CROSS_FILE_ID);
  }, 60000);

  it('does NOT delete or audit a matching-content unresolved row scoped to a DIFFERENT census (#507)', async () => {
    const otherCensusID = testData.census.length > 1 ? testData.census[1].censusID : (await createSecondCensusForScopeTest()).censusID;
    const CROSS_FILE_ID = 'ingest-batch-other-census-prior.csv';
    // UploadBatchID is varchar(36) (db/sql/tablestructures.sql) — this fixture's
    // identity must fit, or the seed INSERT itself fails/truncates before the
    // scope-isolation assertion below ever runs.
    const CROSS_FILE_BATCH_ID = 'ib-other-census-prior-batch';
    const otherCensusRowID = await seedCrossFileCandidateRow(CROSS_FILE_ID, CROSS_FILE_BATCH_ID, otherCensusID);

    // Scoped to a DIFFERENT census than the one being staged, so staging's
    // own census-wide cleanup (scoped to THIS census) can never reach it
    // regardless of seed order — still assert presence/no-audit explicitly
    // immediately before ingest, matching the other matched-cleanup fixtures.
    const [candidateBeforeIngest] = await connection.query<RowDataPacket[]>('SELECT CoreMeasurementID FROM coremeasurements WHERE CoreMeasurementID = ?', [
      otherCensusRowID
    ]);
    expect(candidateBeforeIngest, 'setup: the other-census candidate must be present before staging/ingest run').toHaveLength(1);

    await stageFixtureRows();
    await runIngestBatch();

    const [survivingRow] = await connection.query<RowDataPacket[]>('SELECT CoreMeasurementID FROM coremeasurements WHERE CoreMeasurementID = ?', [
      otherCensusRowID
    ]);
    expect(survivingRow, 'a matching-content row scoped to a DIFFERENT census must survive — scope is CensusID, not just raw content').toHaveLength(1);

    const [auditRows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND RecordID = ?`,
      [otherCensusRowID]
    );
    expect(Number(auditRows[0].count), 'a row outside this census scope must never be audited by this cleanup').toBe(0);
  }, 60000);

  it('does NOT delete or audit a same-file unresolved row with a NULL UploadBatchID (legacy CTFS-migrated shape) (#507)', async () => {
    // Stage FIRST: cleanupPreviousFileUploads' own "NOT incoming family"
    // predicate treats a NULL UploadBatchID as belonging to no family (see
    // buildNotIncomingFamilyPredicate's NULL-safe `<=>`/`IS NULL` branch), so
    // a NULL-batch row seeded BEFORE staging would be swept up and deleted by
    // staging's census-wide cleanup before this test ever reaches
    // ingestBatch's own matched-cleanup — the row vanishing here is a
    // staging-cleanup artifact, not proof the matched-cleanup preserves it.
    await stageFixtureRows();
    // Isolate matched-row cleanup from the separate first-census recovery.
    await connection.query(
      `INSERT INTO uploadmetrics (uploadId, fileID, batchID, schema_name, plotID, censusID, sourceRecords, status, startTime)
       VALUES ('legacy-completed', 'prior.csv', 'prior-completed', ?, ?, ?, 1, 'completed', NOW())`,
      [schema, plotID, censusID]
    );

    const [legacyInsertResult]: any = await connection.query(
      `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
         UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
       VALUES (?, NULL, FALSE, '2024-03-15', 1.0, 1.0, ?, NULL, 'LEGACY-NULL-BATCH', 1, 1)`,
      [censusID, FILE_NAME]
    );
    const legacyRowID = Number(legacyInsertResult.insertId);

    const [candidateBeforeIngest] = await connection.query<RowDataPacket[]>('SELECT CoreMeasurementID FROM coremeasurements WHERE CoreMeasurementID = ?', [
      legacyRowID
    ]);
    expect(candidateBeforeIngest, 'setup: the NULL-batch row must survive staging and still be present before ingestBatch runs').toHaveLength(1);
    const [candidateAuditBeforeIngest] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND RecordID = ?`,
      [legacyRowID]
    );
    expect(Number(candidateAuditBeforeIngest[0].count), 'setup: the NULL-batch row must be unaudited before ingestBatch runs').toBe(0);

    await runIngestBatch();

    const [survivingRow] = await connection.query<RowDataPacket[]>('SELECT CoreMeasurementID FROM coremeasurements WHERE CoreMeasurementID = ?', [legacyRowID]);
    expect(survivingRow, 'a NULL-UploadBatchID row under the same file must survive — NULL belongs to no family, not the incoming one').toHaveLength(1);

    const [auditRows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND RecordID = ?`,
      [legacyRowID]
    );
    expect(Number(auditRows[0].count), 'an untouched row must never be audited').toBe(0);
  }, 60000);

  async function createSecondCensusForScopeTest(): Promise<{ censusID: number }> {
    await connection.query(`INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive) VALUES (?, 99, '2020-01-01', '2020-12-31', 1)`, [
      plotID
    ]);
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT CensusID FROM census WHERE PlotID = ? AND PlotCensusNumber = 99`, [plotID]);
    return { censusID: Number(rows[0].CensusID) };
  }

  // -------------------------------------------------------------------------
  // 4c. Partial-prior-commit CALL accounting (#507)
  //
  // auditCoreMeasurementsScopeDiff itself, exercised directly against real
  // rows: a scope that already contains a row with ONLY an UPDATE audit
  // entry (no INSERT ever recorded for it — exactly the shape the old
  // NOT-EXISTS-only guard could mistake for "already audited, matches a
  // historical write") must NOT get a fabricated INSERT when a genuinely new
  // row lands in the SAME scope. Only the new row is audited.
  // -------------------------------------------------------------------------

  it('auditCoreMeasurementsScopeDiff only INSERT-audits the genuinely new row; a pre-existing row with only UPDATE history is left alone (#507)', async () => {
    const [legacyInsertResult]: any = await connection.query(
      `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
         UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
       VALUES (?, NULL, FALSE, '2024-03-15', 1.0, 1.0, ?, ?, 'LEGACY-ROW', 1, 1)`,
      [censusID, FILE_NAME, BATCH_ID]
    );
    const legacyRowID = Number(legacyInsertResult.insertId);
    await connection.query(
      `INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
       VALUES ('coremeasurements', ?, 'UPDATE', JSON_OBJECT('CoreMeasurementID', ?), JSON_OBJECT('CoreMeasurementID', ?), NOW(), 'legacy-audit-seed', ?, ?)`,
      [legacyRowID, legacyRowID, legacyRowID, plotID, censusID]
    );

    const transactionID = await connectionManager.beginTransaction();
    const tx = { query: (sql: string, params?: unknown[]) => connectionManager.executeQuery(sql, params, transactionID) };
    try {
      const before = await snapshotCoreMeasurementsScope(tx, schema, FILE_NAME, BATCH_ID);
      expect(before.has(legacyRowID), 'setup: the legacy row must already be in scope before the diff').toBe(true);

      // ConnectionManager.executeQuery returns the unwrapped mysql2 result
      // directly (an OkPacket-shaped object with .insertId), NOT a
      // [result, fields] tuple the way raw mysql2 connections do — array
      // destructuring it throws "is not iterable".
      const newInsertResult: any = await connectionManager.executeQuery(
        `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
           UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
         VALUES (?, NULL, FALSE, '2024-03-15', 1.0, 1.0, ?, ?, 'GENUINELY-NEW-ROW', 2, 1)`,
        [censusID, FILE_NAME, BATCH_ID],
        transactionID
      );
      const newRowID = Number(newInsertResult.insertId);

      const diff = await auditCoreMeasurementsScopeDiff({ tx, schema, fileID: FILE_NAME, batchID: BATCH_ID, before, changedBy: null, plotID, censusID });
      console.log(`[partial-commit-accounting] insertedCount=${diff.insertedCount} updatedCount=${diff.updatedCount} deletedCount=${diff.deletedCount}`);
      expect(diff.insertedCount, 'only the genuinely new row must be audited as INSERT').toBe(1);
      expect(diff.updatedCount).toBe(0);
      expect(diff.deletedCount).toBe(0);

      await connectionManager.commitTransaction(transactionID);

      const [legacyAuditRows] = await connection.query<RowDataPacket[]>(
        `SELECT Operation FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND RecordID = ?`,
        [legacyRowID]
      );
      console.log(`[partial-commit-accounting] legacy row audit history: ${JSON.stringify(legacyAuditRows)}`);
      expect(
        legacyAuditRows.map(row => row.Operation),
        'the legacy row must still have ONLY its original UPDATE entry — no fabricated INSERT'
      ).toEqual(['UPDATE']);

      const [newRowAuditRows] = await connection.query<RowDataPacket[]>(
        `SELECT Operation FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND RecordID = ?`,
        [newRowID]
      );
      expect(newRowAuditRows.map(row => row.Operation)).toEqual(['INSERT']);
    } catch (error) {
      await connectionManager.rollbackTransaction(transactionID);
      throw error;
    }
  });

  it('auditCoreMeasurementsScopeDiff does not fabricate an INSERT for a pre-existing row with NO audit history at all, only for the genuinely new row (#507)', async () => {
    // A row older than this mechanism (#507) — committed before any audit
    // trail existed, so it carries zero unifiedchangelog rows. This is the
    // "already audited" exclusion's own precondition: CoreMeasurementID being
    // an AUTO_INCREMENT PK is only exact if an in-scope row with no history at
    // all is correctly left alone rather than treated as "missing its audit".
    const [legacyInsertResult]: any = await connection.query(
      `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
         UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
       VALUES (?, NULL, FALSE, '2024-03-15', 1.0, 1.0, ?, ?, 'NO-HISTORY-ROW', 1, 1)`,
      [censusID, FILE_NAME, BATCH_ID]
    );
    const legacyRowID = Number(legacyInsertResult.insertId);

    const transactionID = await connectionManager.beginTransaction();
    const tx = { query: (sql: string, params?: unknown[]) => connectionManager.executeQuery(sql, params, transactionID) };
    try {
      const before = await snapshotCoreMeasurementsScope(tx, schema, FILE_NAME, BATCH_ID);
      expect(before.has(legacyRowID), 'setup: the no-history row must already be in scope before the diff').toBe(true);

      const newInsertResult: any = await connectionManager.executeQuery(
        `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
           UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
         VALUES (?, NULL, FALSE, '2024-03-15', 1.0, 1.0, ?, ?, 'GENUINELY-NEW-ROW-2', 2, 1)`,
        [censusID, FILE_NAME, BATCH_ID],
        transactionID
      );
      const newRowID = Number(newInsertResult.insertId);

      const diff = await auditCoreMeasurementsScopeDiff({ tx, schema, fileID: FILE_NAME, batchID: BATCH_ID, before, changedBy: null, plotID, censusID });
      expect(diff.insertedCount, 'only the genuinely new row must be audited as INSERT — the no-history row is bounded out by `before`').toBe(1);
      expect(diff.updatedCount).toBe(0);
      expect(diff.deletedCount).toBe(0);

      await connectionManager.commitTransaction(transactionID);

      const [legacyAuditRows] = await connection.query<RowDataPacket[]>(
        `SELECT Operation FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND RecordID = ?`,
        [legacyRowID]
      );
      expect(legacyAuditRows, 'a pre-existing row with zero audit history must get NO fabricated INSERT').toHaveLength(0);

      const [newRowAuditRows] = await connection.query<RowDataPacket[]>(
        `SELECT Operation FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND RecordID = ?`,
        [newRowID]
      );
      expect(newRowAuditRows.map(row => row.Operation)).toEqual(['INSERT']);
    } catch (error) {
      await connectionManager.rollbackTransaction(transactionID);
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // 5. Between-batches abort: isAborted=true from the start
  //
  // With isAborted returning true immediately, the between-batches check in
  // ingestBatch fires before the first processSubBatch call and throws
  // IngestBatchAbortedError (midBatch=false). Rows stay in temporarymeasurements
  // because the procedure was never called — the caller is expected to retry.
  // -------------------------------------------------------------------------

  it('throws IngestBatchAbortedError and leaves rows staged when abort fires before the first sub-batch', async () => {
    await stageFixtureRows();
    expect(await countTemporaryRows()).toBe(EXPECTED_ROW_COUNT);

    let thrownError: unknown;
    try {
      await ingestBatch(connectionManager, {
        schema,
        fileID: FILE_NAME,
        batchID: BATCH_ID,
        expectedScope: { plotID, censusID },
        isAborted: () => true
      });
    } catch (err) {
      thrownError = err;
    }

    console.log(`[abort-before] thrownError=${thrownError instanceof Error ? thrownError.message : String(thrownError)}`);
    expect(thrownError).toBeInstanceOf(IngestBatchAbortedError);
    const abortError = thrownError as IngestBatchAbortedError;
    expect(abortError.midBatch).toBe(false); // propagates to caller — not handled internally

    // Staged rows must remain so a retry can resume without data loss.
    const remainingTemp = await countTemporaryRows();
    console.log(`[abort-before] temporarymeasurements remaining=${remainingTemp}`);
    expect(remainingTemp).toBe(EXPECTED_ROW_COUNT);

    // No coremeasurements rows should have been created.
    const [unresolvedRows] = await connection.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NULL',
      [FILE_NAME]
    );
    expect(Number(unresolvedRows[0].count)).toBe(0);
  }, 60000);

  it('ingests a 50-character filename through the real hashed GET_LOCK and stored procedure path', async () => {
    const fileName = `${'f'.repeat(46)}.csv`;
    expect(fileName).toHaveLength(50);
    await stageFixtureRows(fileName);

    const result = await runIngestBatch(fileName);

    expect(result.noDataFound).toBe(false);
    expect(result.subBatchResults[0].batchFailedButHandled).toBe(false);
    expect(await fetchBatchMeasurements(fileName)).toHaveLength(EXPECTED_ROW_COUNT);
  }, 60000);

  // -------------------------------------------------------------------------
  // 6. Mid-retry abort: isAborted flips to true inside processSubBatch
  //
  // The abort probe returns false on the first call (the between-batches check
  // in ingestBatch) and true on subsequent calls (the per-attempt check inside
  // processSubBatch). With a single sub-batch this means the between-batches
  // guard passes, processSubBatch is entered, and the abort is detected at the
  // top of the retry loop before the procedure is called.
  //
  // Expected outcome: IngestBatchAbortedError (midBatch=true) is caught
  // internally, staged rows are moved to unresolved coremeasurements, and
  // ingestBatch returns normally (no exception propagates to the caller).
  // -------------------------------------------------------------------------

  it('handles a mid-retry abort internally: rows moved to unresolved coremeasurements, no exception propagates', async () => {
    await stageFixtureRows();
    expect(await countTemporaryRows()).toBe(EXPECTED_ROW_COUNT);

    // Setup checks once before commit and the between-batches guard checks once;
    // the next call is inside processSubBatch's retry loop.
    let abortCallCount = 0;
    const isAborted = () => {
      abortCallCount++;
      const shouldAbort = abortCallCount > 2;
      console.log(`[abort-mid] isAborted call #${abortCallCount} → ${shouldAbort}`);
      return shouldAbort;
    };

    const result = await ingestBatch(connectionManager, {
      schema,
      fileID: FILE_NAME,
      batchID: BATCH_ID,
      expectedScope: { plotID, censusID },
      isAborted
    });

    console.log(
      `[abort-mid] result: processedSubBatches=${result.processedSubBatches} totalRows=${result.totalRows} ` +
        `noDataFound=${result.noDataFound} subBatchResults=${JSON.stringify(result.subBatchResults)}`
    );

    // ingestBatch must return (not throw) — mid-batch abort is handled internally.
    expect(result.noDataFound).toBe(false);
    expect(result.processedSubBatches).toBe(1);
    expect(result.subBatchResults).toHaveLength(1);
    const subResult = result.subBatchResults[0];
    expect(subResult.batchFailedButHandled).toBe(true);
    // rowCount reflects how many rows were moved to unresolved coremeasurements.
    expect(subResult.rowCount).toBe(EXPECTED_ROW_COUNT);
    expect(subResult.message).toContain('unresolved coremeasurements');

    // temporarymeasurements must be drained — rows were moved, not abandoned.
    const remainingTemp = await countTemporaryRows();
    console.log(`[abort-mid] temporarymeasurements remaining=${remainingTemp}`);
    expect(remainingTemp).toBe(0);

    // Rows must have landed in coremeasurements with StemGUID=NULL (unresolved/failed).
    const [unresolvedRows] = await connection.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NULL',
      [FILE_NAME]
    );
    console.log(`[abort-mid] unresolved coremeasurements rows=${unresolvedRows[0].count}`);
    expect(Number(unresolvedRows[0].count)).toBe(EXPECTED_ROW_COUNT);

    // #507: moveSubBatchToFailedMeasurementsWithAudit binds the fallback move
    // AND its audit to the SAME transaction as the give-up path's commit —
    // the parked (StemGUID=NULL) rows this abort produced must be audited
    // exactly like a successful ingest row, not silently skipped because the
    // row never reached the stored procedure's success path.
    const auditCounts = await fetchAuditOperationCounts();
    console.log(`[abort-mid] audit operation counts=${JSON.stringify(auditCounts)}`);
    expect(auditCounts.INSERT).toBe(EXPECTED_ROW_COUNT);

    // A mid-retry abort is an interruption, not a data defect — the row was
    // never judged by the procedure. It must carry INTERRUPTED_UPLOAD, not
    // SQL_EXCEPTION, regardless of how the failure text happens to read.
    const errorCodes = await fetchIngestionErrorCodes();
    console.log(`[abort-mid] ingestion error codes=${JSON.stringify(errorCodes)}`);
    expect(errorCodes).toEqual(['INTERRUPTED_UPLOAD']);
  }, 60000);

  // -------------------------------------------------------------------------
  // 7. KILLed procedure call: ER_QUERY_INTERRUPTED is a deliberate abort
  //
  // During the 2026-07-28 Harvard incident, an operator KILL QUERY of a
  // pathological 25-minute bulkingestionprocess call surfaced here as a
  // generic-retryable error, and the retry loop immediately started the same
  // statement over. An interrupted statement means someone (an operator, or the
  // DB layer's timeout kill) deliberately stopped it — re-running it verbatim
  // is never right.
  //
  // Expected outcome: exactly ONE procedure attempt (no retries, no backoff),
  // the sub-batch's rows moved to unresolved coremeasurements, and ingestBatch
  // returns normally.
  // -------------------------------------------------------------------------

  it('abandons a sub-batch after a single attempt when the procedure call is KILLed (ER_QUERY_INTERRUPTED)', async () => {
    await stageFixtureRows();
    expect(await countTemporaryRows()).toBe(EXPECTED_ROW_COUNT);

    // Reject ONLY the procedure CALL with the error shape mysql2 raises for a
    // KILL QUERY; every other statement passes through to the real DB. The
    // shape is asserted for real — against an actual KILL — in
    // tests/integration/ingest-batch-kill-boundary.test.ts; this one keeps the
    // classifier covered without needing a slow statement.
    const interruptError = Object.assign(new Error(MYSQL_QUERY_INTERRUPTED_MESSAGE), {
      code: MYSQL_CODE_QUERY_INTERRUPTED,
      errno: MYSQL_ERRNO_QUERY_INTERRUPTED,
      sqlState: MYSQL_SQLSTATE_QUERY_INTERRUPTED
    });
    const realExecuteQuery = connectionManager.executeQuery.bind(connectionManager);
    const executeQuerySpy = vi
      .spyOn(connectionManager, 'executeQuery')
      .mockImplementation(async (query: string, params?: unknown[], transactionId?: string) => {
        if (query.includes('bulkingestionprocess')) {
          console.log('[kill-interrupt] rejecting procedure CALL with ER_QUERY_INTERRUPTED');
          throw interruptError;
        }
        return realExecuteQuery(query, params, transactionId);
      });

    try {
      const result = await runIngestBatch();

      const procedureAttempts = executeQuerySpy.mock.calls.filter(([query]) => typeof query === 'string' && query.includes('bulkingestionprocess')).length;
      console.log(`[kill-interrupt] procedure CALL attempts=${procedureAttempts}`);
      expect(procedureAttempts, 'a KILLed statement must never be re-run').toBe(1);

      expect(result.subBatchResults).toHaveLength(1);
      const subResult = result.subBatchResults[0];
      expect(subResult.attemptsNeeded, 'gave up after the first interrupted attempt').toBe(1);
      expect(subResult.batchFailedButHandled).toBe(true);
      expect(subResult.rowCount, 'all staged rows moved to unresolved').toBe(EXPECTED_ROW_COUNT);

      // temporarymeasurements drained; rows preserved as unresolved, not lost.
      expect(await countTemporaryRows()).toBe(0);
      const [unresolvedRows] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS count FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NULL',
        [FILE_NAME]
      );
      console.log(`[kill-interrupt] unresolved coremeasurements rows=${unresolvedRows[0].count}`);
      expect(Number(unresolvedRows[0].count)).toBe(EXPECTED_ROW_COUNT);

      // #507: processSubBatch's give-up path (moveSubBatchToFailedMeasurementsWithAudit)
      // commits the fallback move and its audit in the SAME transaction.
      const auditCounts = await fetchAuditOperationCounts();
      console.log(`[kill-interrupt] audit operation counts=${JSON.stringify(auditCounts)}`);
      expect(auditCounts.INSERT).toBe(EXPECTED_ROW_COUNT);

      // A KILLed procedure call is a system failure, not a per-row data
      // defect — it must carry SQL_EXCEPTION.
      const errorCodes = await fetchIngestionErrorCodes();
      console.log(`[kill-interrupt] ingestion error codes=${JSON.stringify(errorCodes)}`);
      expect(errorCodes).toEqual(['SQL_EXCEPTION']);
    } finally {
      executeQuerySpy.mockRestore();
    }
  }, 60000);

  // -------------------------------------------------------------------------
  // 7b. Ordinary unrecoverable error (outer-catch "else" branch): the sub-batch
  // is abandoned after a single KILLed attempt (fast path to the giving-up
  // code), and the FIRST attempt to move its rows to unresolved coremeasurements
  // itself throws with a message that contains NO SQL keyword — proving the
  // code is still SQL_EXCEPTION because the caller declared that kind
  // explicitly, not because prose inference happened to match. ingestBatch's
  // outer catch then retries the move (this time for real) and completes
  // normally.
  // -------------------------------------------------------------------------

  it('classifies the outer-catch unrecoverable-error branch as SQL_EXCEPTION even when the thrown message has no SQL keyword', async () => {
    await stageFixtureRows();
    expect(await countTemporaryRows()).toBe(EXPECTED_ROW_COUNT);

    const interruptError = Object.assign(new Error(MYSQL_QUERY_INTERRUPTED_MESSAGE), {
      code: MYSQL_CODE_QUERY_INTERRUPTED,
      errno: MYSQL_ERRNO_QUERY_INTERRUPTED,
      sqlState: MYSQL_SQLSTATE_QUERY_INTERRUPTED
    });
    const NO_SQL_KEYWORD_MESSAGE = 'Unexpected condition while finalizing sub-batch cleanup';
    let coreMeasurementsInsertAttempts = 0;
    const realExecuteQuery = connectionManager.executeQuery.bind(connectionManager);
    const executeQuerySpy = vi
      .spyOn(connectionManager, 'executeQuery')
      .mockImplementation(async (query: string, params?: unknown[], transactionId?: string) => {
        if (query.includes('bulkingestionprocess')) {
          throw interruptError;
        }
        // Unique to moveTemporaryBatchToFailedMeasurements's INSERT ... SELECT
        // (RawTreeTag <- tm.TreeTag) — reject only its FIRST occurrence so the
        // giving-up code inside processSubBatch fails and propagates to
        // ingestBatch's outer catch, which then retries for real.
        if (query.includes('INSERT INTO') && query.includes('coremeasurements') && query.includes('tm.TreeTag')) {
          coreMeasurementsInsertAttempts++;
          if (coreMeasurementsInsertAttempts === 1) {
            throw new Error(NO_SQL_KEYWORD_MESSAGE);
          }
        }
        return realExecuteQuery(query, params, transactionId);
      });

    try {
      const result = await runIngestBatch();

      console.log(`[unrecoverable] coreMeasurementsInsertAttempts=${coreMeasurementsInsertAttempts}`);
      expect(coreMeasurementsInsertAttempts, 'the injected failure must have been hit once before the real retry').toBeGreaterThanOrEqual(2);

      expect(result.subBatchResults).toHaveLength(1);
      expect(result.subBatchResults[0].batchFailedButHandled).toBe(true);
      expect(result.subBatchResults[0].rowCount).toBe(EXPECTED_ROW_COUNT);

      expect(await countTemporaryRows()).toBe(0);
      const [unresolvedRows] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS count FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NULL',
        [FILE_NAME]
      );
      expect(Number(unresolvedRows[0].count)).toBe(EXPECTED_ROW_COUNT);

      // #507: the FIRST move+audit attempt (processSubBatch's own give-up
      // path) failed before recordCommittedCoreMeasurementsAudit ever ran —
      // moveTemporaryBatchToFailedMeasurements itself threw — so that whole
      // transaction rolled back with nothing to audit. ingestBatch's outer
      // catch then retried the SAME bound move+audit via
      // moveSubBatchToFailedMeasurementsWithAudit and this time both
      // succeeded together. Exactly one audit row per row, not zero (the
      // first attempt's rollback silently eating the audit) and not doubled
      // (the retry re-auditing rows the failed first attempt never committed).
      const auditCounts = await fetchAuditOperationCounts();
      console.log(`[unrecoverable] audit operation counts=${JSON.stringify(auditCounts)}`);
      expect(auditCounts.INSERT).toBe(EXPECTED_ROW_COUNT);

      const errorCodes = await fetchIngestionErrorCodes();
      console.log(`[unrecoverable] ingestion error codes=${JSON.stringify(errorCodes)}`);
      expect(errorCodes).toEqual(['SQL_EXCEPTION']);
    } finally {
      executeQuerySpy.mockRestore();
    }
  }, 60000);

  // -------------------------------------------------------------------------
  // 7c. The fallback AUDIT write itself fails, not the move (#507)
  //
  // Mirrors 7b but injects the failure into recordCommittedCoreMeasurementsAudit's
  // own INSERT instead of moveTemporaryBatchToFailedMeasurements's. The move
  // runs successfully first; the audit that MUST commit with it in the same
  // transaction then fails, and moveSubBatchToFailedMeasurementsWithAudit must
  // propagate that failure so processSubBatch's give-up code rolls back the
  // WHOLE transaction — undoing the already-run move along with the failed
  // audit, not leaving unaudited rows committed.
  //
  // A fallback audit failure is now classified as non-transient (#507): it is
  // propagated all the way out of ingestBatch rather than hidden behind an
  // automatic internal retry (the OLD contract this suite used to assert) —
  // see processSubBatch's isNonTransientAuditFailure classification. Recovery
  // is proven by an EXPLICIT second call in the next test, not implicitly here.
  // -------------------------------------------------------------------------

  it('propagates a fallback audit-write failure with exact rollback, leaving rows staged for recovery (#507)', async () => {
    await stageFixtureRows();
    expect(await countTemporaryRows()).toBe(EXPECTED_ROW_COUNT);

    const interruptError = Object.assign(new Error(MYSQL_QUERY_INTERRUPTED_MESSAGE), {
      code: MYSQL_CODE_QUERY_INTERRUPTED,
      errno: MYSQL_ERRNO_QUERY_INTERRUPTED,
      sqlState: MYSQL_SQLSTATE_QUERY_INTERRUPTED
    });
    const AUDIT_WRITE_FAILURE_MESSAGE = 'Simulated unifiedchangelog write failure';
    let auditInsertAttempts = 0;
    const realExecuteQuery = connectionManager.executeQuery.bind(connectionManager);
    const executeQuerySpy = vi
      .spyOn(connectionManager, 'executeQuery')
      .mockImplementation(async (query: string, params?: unknown[], transactionId?: string) => {
        if (query.includes('bulkingestionprocess')) {
          throw interruptError;
        }
        // recordCommittedCoreMeasurementsAudit's own INSERT ... SELECT into
        // unifiedchangelog — the give-up path's own attempt, AFTER the move
        // already ran.
        if (query.includes('INSERT INTO') && query.includes('unifiedchangelog')) {
          auditInsertAttempts++;
          throw new Error(AUDIT_WRITE_FAILURE_MESSAGE);
        }
        return realExecuteQuery(query, params, transactionId);
      });

    try {
      let thrown: unknown;
      try {
        await runIngestBatch();
      } catch (error) {
        thrown = error;
      }

      console.log(`[audit-write-failure] auditInsertAttempts=${auditInsertAttempts} thrown=${thrown instanceof Error ? thrown.message : String(thrown)}`);
      expect(thrown, 'the give-up path must propagate the fallback audit failure, not hide it behind an automatic retry').toBeInstanceOf(ChangelogWriteError);
      expect((thrown as Error).message).toContain(AUDIT_WRITE_FAILURE_MESSAGE);
      expect(auditInsertAttempts, 'a non-transient audit failure must be attempted exactly once, not retried').toBe(1);

      // Exact rollback: the already-run move (INSERT into coremeasurements,
      // DELETE from temporarymeasurements) rolled back together with its
      // failed audit — nothing committed, nothing partially written.
      expect(await countTemporaryRows(), 'the rows must still be staged, recoverable').toBe(EXPECTED_ROW_COUNT);
      const [unresolvedRows] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS count FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NULL',
        [FILE_NAME]
      );
      expect(Number(unresolvedRows[0].count), 'the failed move must have left no coremeasurements rows behind').toBe(0);
      const auditCountsAfterFailure = await fetchAuditOperationCounts();
      console.log(`[audit-write-failure] audit operation counts after failure=${JSON.stringify(auditCountsAfterFailure)}`);
      expect(auditCountsAfterFailure.INSERT ?? 0, 'the failed audit must have left no audit rows behind').toBe(0);
    } finally {
      executeQuerySpy.mockRestore();
    }
  }, 60000);

  // Explicit second call, not an automatic internal retry: the fault above
  // only fires on the FIRST unifiedchangelog INSERT attempt, so by the time
  // this test calls ingestBatch again the audit path is clear — proving the
  // rows the prior failure left staged are genuinely recoverable, not merely
  // theoretically so.
  it('recovers on an explicit retry after a fallback audit failure clears (#507)', async () => {
    await stageFixtureRows();

    const interruptError = Object.assign(new Error(MYSQL_QUERY_INTERRUPTED_MESSAGE), {
      code: MYSQL_CODE_QUERY_INTERRUPTED,
      errno: MYSQL_ERRNO_QUERY_INTERRUPTED,
      sqlState: MYSQL_SQLSTATE_QUERY_INTERRUPTED
    });
    let auditInsertAttempts = 0;
    const realExecuteQuery = connectionManager.executeQuery.bind(connectionManager);
    const executeQuerySpy = vi
      .spyOn(connectionManager, 'executeQuery')
      .mockImplementation(async (query: string, params?: unknown[], transactionId?: string) => {
        if (query.includes('bulkingestionprocess')) {
          throw interruptError;
        }
        if (query.includes('INSERT INTO') && query.includes('unifiedchangelog')) {
          auditInsertAttempts++;
          if (auditInsertAttempts === 1) {
            throw new Error('Simulated unifiedchangelog write failure');
          }
        }
        return realExecuteQuery(query, params, transactionId);
      });

    try {
      await expect(runIngestBatch()).rejects.toThrow(ChangelogWriteError);
      expect(await countTemporaryRows()).toBe(EXPECTED_ROW_COUNT);

      // Second, EXPLICIT call — the injected fault was one-shot, so the audit
      // path is clear now: this is real recovery, not a hidden retry.
      const result = await runIngestBatch();

      console.log(`[audit-retry-recovery] auditInsertAttempts=${auditInsertAttempts}`);
      expect(result.subBatchResults).toHaveLength(1);
      expect(result.subBatchResults[0].batchFailedButHandled).toBe(true);
      expect(result.subBatchResults[0].rowCount).toBe(EXPECTED_ROW_COUNT);
      expect(await countTemporaryRows()).toBe(0);

      const [unresolvedRows] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS count FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NULL',
        [FILE_NAME]
      );
      expect(Number(unresolvedRows[0].count)).toBe(EXPECTED_ROW_COUNT);

      const auditCounts = await fetchAuditOperationCounts();
      console.log(`[audit-retry-recovery] audit operation counts=${JSON.stringify(auditCounts)}`);
      expect(auditCounts.INSERT).toBe(EXPECTED_ROW_COUNT);

      const errorCodes = await fetchIngestionErrorCodes();
      console.log(`[audit-retry-recovery] ingestion error codes=${JSON.stringify(errorCodes)}`);
      expect(errorCodes).toEqual(['SQL_EXCEPTION']);
    } finally {
      executeQuerySpy.mockRestore();
    }
  }, 60000);

  // -------------------------------------------------------------------------
  // 7d. An audit outage after an earlier sub-batch already committed
  // propagates instead of being treated as a data rejection (#507)
  //
  // The FIRST sub-batch's audit succeeds for real and commits. The SECOND
  // sub-batch's CALL also succeeds (real, good data), but its audit INSERT
  // fails — a non-transient audit failure is never retried (see
  // isNonTransientAuditFailure), so processSubBatch fails fast on this ONE
  // attempt and propagates rather than moving those rows into unresolved
  // coremeasurements; ingestBatch propagates too rather than moving every
  // remaining sub-batch's rows to failed as well.
  // -------------------------------------------------------------------------

  it.each([3, 4])('aborts on snapshot read %i without losing earlier committed sub-batches', async failedRead => {
    const original = process.env.INGESTION_SUB_BATCH_ROWS;
    process.env.INGESTION_SUB_BATCH_ROWS = '2';
    const sentinel = new Error('audit snapshot unavailable');
    await stageFixtureRows();
    const execute = connectionManager.executeQuery.bind(connectionManager);
    let reads = 0;
    let calls = 0;
    let rowsAtFault = 0;
    const spy = vi.spyOn(connectionManager, 'executeQuery').mockImplementation(async (sql, params, tx) => {
      if (sql.trimStart().startsWith('CALL') && sql.includes('bulkingestionprocess')) calls++;
      if (sql.trimStart().startsWith('SELECT CoreMeasurementID, StemGUID, CensusID') && sql.includes('WHERE UploadFileID = ? AND UploadBatchID = ?')) {
        reads++;
        if (reads === failedRead) {
          const current = await execute(`SELECT COUNT(*) AS count FROM \`${schema}\`.coremeasurements WHERE UploadFileID = ?`, [FILE_NAME], tx);
          rowsAtFault = Number(current[0].count);
          throw sentinel;
        }
      }
      return execute(sql, params, tx);
    });
    try {
      const thrown = await runIngestBatch().then(
        () => null,
        error => error
      );
      expect(thrown).toBeInstanceOf(ChangelogWriteError);
      expect(thrown.cause).toBe(sentinel);
      expect(reads).toBe(failedRead);
      expect(calls).toBe(failedRead === 3 ? 1 : 2);
      expect(rowsAtFault).toBe(failedRead === 3 ? 2 : 4);
      const [remaining] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM temporarymeasurements WHERE FileID = ?', [FILE_NAME]);
      expect(Number(remaining[0].count)).toBe(EXPECTED_ROW_COUNT - 2);
      expect((await fetchAuditOperationCounts()).INSERT).toBe(2);
      const [failed] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NULL', [
        FILE_NAME
      ]);
      expect(Number(failed[0].count)).toBe(0);
    } finally {
      spy.mockRestore();
      if (original === undefined) delete process.env.INGESTION_SUB_BATCH_ROWS;
      else process.env.INGESTION_SUB_BATCH_ROWS = original;
    }
  });

  it('propagates a persistent audit-infrastructure failure instead of moving good rows to unresolved coremeasurements (#507)', async () => {
    const originalSubBatchRows = process.env.INGESTION_SUB_BATCH_ROWS;
    process.env.INGESTION_SUB_BATCH_ROWS = '2';

    await stageFixtureRows();
    const [stagedBefore] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM temporarymeasurements WHERE FileID = ?', [FILE_NAME]);
    expect(Number(stagedBefore[0].count)).toBe(EXPECTED_ROW_COUNT);

    const AUDIT_OUTAGE_MESSAGE = 'Simulated persistent unifiedchangelog outage';
    let auditInsertCount = 0;
    const realExecuteQuery = connectionManager.executeQuery.bind(connectionManager);
    const executeQuerySpy = vi
      .spyOn(connectionManager, 'executeQuery')
      .mockImplementation(async (query: string, params?: unknown[], transactionId?: string) => {
        // auditCoreMeasurementsScopeDiff's INSERT classification writes via
        // recordSnapshotRowsAudit (lib/changelog/ingestion-audit.ts), which
        // serializes caller-supplied before/after snapshots directly rather
        // than the old whole-scope `INSERT ... SELECT ... NOT EXISTS` shape —
        // match THAT statement's distinctive column list (both OldRowState
        // and NewRowState together is unique to it among every other
        // unifiedchangelog write processSubBatch issues).
        if (typeof query === 'string' && query.includes('.unifiedchangelog') && query.includes('OldRowState') && query.includes('NewRowState')) {
          auditInsertCount++;
          // Let sub-batch 1's audit (2 rows) succeed for real; fail sub-batch
          // 2's.
          if (auditInsertCount > 1) {
            throw new Error(AUDIT_OUTAGE_MESSAGE);
          }
        }
        return realExecuteQuery(query, params, transactionId);
      });

    try {
      let thrown: unknown;
      try {
        await runIngestBatch();
      } catch (error) {
        thrown = error;
      }

      console.log(`[persistent-audit-outage] auditInsertCount=${auditInsertCount} thrown=${thrown instanceof Error ? thrown.message : String(thrown)}`);
      expect(thrown, 'ingestBatch must reject, not return a handled result, on an audit outage').toBeInstanceOf(ChangelogWriteError);
      expect((thrown as Error).message).toContain(AUDIT_OUTAGE_MESSAGE);
      // A non-transient audit failure is attempted exactly once per
      // sub-batch, never retried: sub-batch 1 succeeds (1), sub-batch 2 fails
      // once and propagates immediately (2) — not five generic backoffs.
      expect(auditInsertCount, 'the stalled sub-batch must fail fast, not retry').toBe(2);

      // Sub-batch 1 (2 rows) committed and was audited before the outage began — untouched by the later failure.
      const [ingestedRows] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS count FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NOT NULL',
        [FILE_NAME]
      );
      expect(Number(ingestedRows[0].count)).toBe(2);
      const auditCounts = await fetchAuditOperationCounts();
      console.log(`[persistent-audit-outage] audit operation counts=${JSON.stringify(auditCounts)}`);
      expect(auditCounts.INSERT).toBe(2);

      // No fabricated failure rows: the give-up path must never have run
      // moveSubBatchToFailedMeasurementsWithAudit for the stalled sub-batch.
      const [unresolvedRows] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS count FROM coremeasurements WHERE UploadFileID = ? AND StemGUID IS NULL',
        [FILE_NAME]
      );
      expect(Number(unresolvedRows[0].count)).toBe(0);

      // The remaining 3 rows (the stalled sub-batch's 2 + the never-attempted
      // third sub-batch's 1) are still staged in temporarymeasurements,
      // recoverable once the audit path is restored — not discarded.
      const [remainingTemp] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM temporarymeasurements WHERE FileID = ?', [FILE_NAME]);
      expect(Number(remainingTemp[0].count)).toBe(3);
    } finally {
      executeQuerySpy.mockRestore();
      if (originalSubBatchRows === undefined) delete process.env.INGESTION_SUB_BATCH_ROWS;
      else process.env.INGESTION_SUB_BATCH_ROWS = originalSubBatchRows;
    }
  }, 60000);

  // -------------------------------------------------------------------------
  // 8. Negative local coordinates ingest normally (Task 6)
  //
  // A stem mapped just outside its quadrat (negative LocalX/LocalY) is no
  // longer a hard-fail INVALID_COORDINATE ingestion error — it materializes
  // like any other row, and out-of-bounds placement is caught post-ingest by
  // validation 8 (ValidateFindStemsOutsidePlots).
  // -------------------------------------------------------------------------

  it('ingests a negative local coordinate instead of hard-failing it', async () => {
    const fileName = 'ingest-batch-negative-coord.csv';
    const transactionID = await connectionManager.beginTransaction();
    const params: StageMeasurementChunkParams = {
      schema,
      fileName,
      batchID: BATCH_ID,
      plotID,
      censusID,
      uploadMode: UploadMode.CLEAN_REUPLOAD,
      sourceFormat: SourceFormat.csv,
      rawRows: [
        { tag: '9001', stemtag: '9001', spcode: 'ACERRU', quadrat: 'Q01', lx: '-0.5', ly: '4.2', dbh: '12.3', hom: '1.3', date: MEASUREMENT_DATE, codes: 'A' }
      ],
      csvHeaders: CSV_HEADERS,
      delimiter: CSV_DELIMITER,
      uploadSessionID: UPLOAD_SESSION_ID,
      transactionID,
      firstRowOrdinal: null,
      changedBy: CHANGED_BY
    };
    const stageResult = await stageMeasurementChunk(connectionManager, params);
    await connectionManager.commitTransaction(transactionID);
    console.log(`[negative-coord] insertedCount=${stageResult.insertedCount} invalidRows=${stageResult.invalidRows.length}`);
    expect(stageResult.insertedCount).toBe(1);
    expect(stageResult.invalidRows).toHaveLength(0);

    const result = await ingestBatch(connectionManager, { schema, fileID: fileName, batchID: BATCH_ID, expectedScope: { plotID, censusID } });
    console.log(`[negative-coord] subBatchResults=${JSON.stringify(result.subBatchResults)}`);
    expect(result.subBatchResults[0].batchFailedButHandled).toBe(false);

    const [cmRows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID, StemGUID, CAST(RawX AS CHAR) AS RawXText
         FROM coremeasurements
        WHERE UploadFileID = ? AND UploadBatchID = ? AND RawTreeTag = '9001'`,
      [fileName, BATCH_ID]
    );
    expect(cmRows, 'the row must materialize, not be parked as a hard failure').toHaveLength(1);
    expect(cmRows[0].StemGUID, 'StemGUID NULL means the row failed ingestion').not.toBeNull();
    expect(Number(cmRows[0].RawXText)).toBe(-0.5);

    const [errorRows] = await connection.query<RowDataPacket[]>(
      `SELECT e.ErrorCode
         FROM measurement_error_log l
         JOIN measurement_errors e ON e.ErrorID = l.ErrorID
        WHERE l.MeasurementID = ?`,
      [cmRows[0].CoreMeasurementID]
    );
    const errorCodes = errorRows.map(row => row.ErrorCode);
    console.log(`[negative-coord] errorCodes=${JSON.stringify(errorCodes)}`);
    expect(errorCodes).not.toContain('INVALID_COORDINATE');
  }, 60000);
});
