/**
 * ArcGIS commit leftover-clearing windows S0 and F0 — Integration Tests (#561)
 *
 * S0 clears a file's staged rows in one plot/census, F0 clears a commit batch family's coremeasurements rows in one
 * census with their error links and DELETE-audit rows. Proves on MySQL:
 *   - each window removes only its scope (look-alike batches, other files and other censuses survive);
 *   - F0's id select walks idx_cm_uploadfile_batch_census_stem with no filesort (P22);
 *   - under READ COMMITTED one F0 window row-locks the window, not the whole remaining family (M6).
 *
 * Prerequisites: docker compose up -d mysql
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createConnection, type Connection, type RowDataPacket } from 'mysql2/promise';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { createAdditionalCensus, setupTestDatabase, teardownTestDatabase, type TestDatabaseConfig, type TestData } from '../setup/local-db-setup';
import {
  BATCH_FAMILY_SCAN_INDEX,
  CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE,
  deleteBatchFamilyRowsWindow,
  deleteStagedRowsForFileWindow
} from '@/lib/ingestion/temporary-measurements';
import { buildSubBatchID, deriveArcgisCommitBatchID } from '@/lib/uploads/batch-family';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];
const RESOLVED_HOSTS = [process.env.AZURE_SQL_SERVER, process.env.TEST_DB_HOST || 'localhost'];
for (const host of RESOLVED_HOSTS) {
  if (!host || !LOCAL_HOSTS.includes(host)) {
    throw new Error(`REFUSING TO RUN: host '${host}' is not local. This suite deletes rows.`);
  }
}

const IMPORT_SESSION_ID = '00000000-0000-4000-8000-000000000561';
const TARGET_FILE = 'a.xlsx';
const OTHER_FILE = 'b.xlsx';
const TEST_CHANGED_BY = 'leftover-windows-integration-test';
const TRANSACTION_ID = 'leftover-windows-tx';
const OTHER_CENSUS_NUMBER = 92;
const OTHER_CENSUS_START = '2021-01-01';
const OTHER_CENSUS_END = '2021-12-31';
const STAGED_WINDOW_LIMIT = 5;
const STAGED_TARGET_ROWS = 7;
const STAGED_OTHER_CENSUS_ROWS = 3;
const STAGED_OTHER_FILE_ROWS = 2;
const FAMILY_ROWS_UNDER_BASE = 2;
const FAMILY_ROWS_UNDER_SUB_BATCH = 2;
const FAMILY_ROWS_TOTAL = FAMILY_ROWS_UNDER_BASE + FAMILY_ROWS_UNDER_SUB_BATCH;
const F0_LOCK_PROBE_FAMILY_ROWS = 2_500;
const F0_LOCK_SLACK_ROWS = 2;
const F0_PLAN_PROBE_FAMILY_ROWS = 2_500;
const SUB_BATCH_ORDINAL = 1;
const FILESORT_MARKER = 'Using filesort';
const RECORD_LOCK_TYPE = 'RECORD';
const SEED_MEASUREMENT_DATE = '2024-03-15';
const SEED_MEASURED_VALUE = 1.0;

let setupConnection: Connection;
let lockObserverConnection: Connection;
let testData: TestData;
let config: TestDatabaseConfig;
let plotID: number;
let targetCensusID: number;
let otherCensusID: number;
let nextSourceRowIndex = 1;

const familyBatchID = deriveArcgisCommitBatchID(IMPORT_SESSION_ID);

function managerOver(connection: Connection): ConnectionManager {
  return {
    executeQuery: async (sql: string, params: unknown[] = []) => {
      const [result] = await connection.query(sql, params);
      return result;
    }
  } as unknown as ConnectionManager;
}

async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  const [rows] = await setupConnection.query<RowDataPacket[]>(sql, params);
  return Number(rows[0].total);
}

async function insertStagedRows(fileName: string, censusID: number, count: number): Promise<void> {
  const rows = Array.from({ length: count }, (_, index) => [fileName, `staged-${fileName}-${censusID}`, plotID, censusID, `T${index}`]);
  await setupConnection.query('INSERT INTO temporarymeasurements (FileID, BatchID, PlotID, CensusID, TreeTag) VALUES ?', [rows]);
}

async function insertCoreMeasurementRows(fileName: string, batchID: string, censusID: number, count: number): Promise<number[]> {
  const firstSourceRowIndex = nextSourceRowIndex;
  nextSourceRowIndex += count;
  await setupConnection.query('SET SESSION cte_max_recursion_depth = ?', [count + 1]);
  await setupConnection.query(
    `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
       UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
     WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
     SELECT ?, NULL, FALSE, ?, ?, ?, ?, ?, CONCAT('T', n), ? + n, 1 FROM seq`,
    [count, censusID, SEED_MEASUREMENT_DATE, SEED_MEASURED_VALUE, SEED_MEASURED_VALUE, fileName, batchID, firstSourceRowIndex]
  );
  const [rows] = await setupConnection.query<RowDataPacket[]>(
    'SELECT CoreMeasurementID FROM coremeasurements WHERE UploadFileID = ? AND UploadBatchID = ? AND CensusID = ? ORDER BY CoreMeasurementID',
    [fileName, batchID, censusID]
  );
  return rows.map(row => Number(row.CoreMeasurementID));
}

function countCoreMeasurementsOf(fileName: string, batchID: string, censusID: number): Promise<number> {
  return countRows('SELECT COUNT(*) AS total FROM coremeasurements WHERE UploadFileID = ? AND UploadBatchID = ? AND CensusID = ?', [
    fileName,
    batchID,
    censusID
  ]);
}

function countStagedRowsOf(fileName: string, censusID: number): Promise<number> {
  return countRows('SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ? AND PlotID = ? AND CensusID = ?', [fileName, plotID, censusID]);
}

describe('ArcGIS commit leftover windows S0 and F0 (#561)', () => {
  beforeAll(async () => {
    const setup = await setupTestDatabase();
    setupConnection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    plotID = testData.plots[0].plotID;
    targetCensusID = testData.census[0].censusID;
    otherCensusID = (
      await createAdditionalCensus(setupConnection, testData, {
        plotCensusNumber: OTHER_CENSUS_NUMBER,
        startDate: OTHER_CENSUS_START,
        endDate: OTHER_CENSUS_END
      })
    ).censusID;
    lockObserverConnection = await createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password
    });
    console.log(`[setup] schema=${config.database} plot=${plotID} targetCensus=${targetCensusID} otherCensus=${otherCensusID} familyBatch=${familyBatchID}`);
  }, 120000);

  beforeEach(async () => {
    await setupConnection.query('DELETE FROM measurement_error_log');
    await setupConnection.query('DELETE FROM coremeasurements');
    await setupConnection.query('DELETE FROM temporarymeasurements');
    await setupConnection.query('DELETE FROM unifiedchangelog');
  });

  afterAll(async () => {
    await lockObserverConnection?.end();
    await teardownTestDatabase(setupConnection, config);
  });

  it('S0 removes only the file rows of the plot/census, at most the window limit per call', async () => {
    await insertStagedRows(TARGET_FILE, targetCensusID, STAGED_TARGET_ROWS);
    await insertStagedRows(TARGET_FILE, otherCensusID, STAGED_OTHER_CENSUS_ROWS);
    await insertStagedRows(OTHER_FILE, targetCensusID, STAGED_OTHER_FILE_ROWS);
    const manager = managerOver(setupConnection);

    const firstWindow = await deleteStagedRowsForFileWindow(manager, config.database, TARGET_FILE, plotID, targetCensusID, STAGED_WINDOW_LIMIT, TRANSACTION_ID);
    const secondWindow = await deleteStagedRowsForFileWindow(
      manager,
      config.database,
      TARGET_FILE,
      plotID,
      targetCensusID,
      STAGED_WINDOW_LIMIT,
      TRANSACTION_ID
    );
    const thirdWindow = await deleteStagedRowsForFileWindow(manager, config.database, TARGET_FILE, plotID, targetCensusID, STAGED_WINDOW_LIMIT, TRANSACTION_ID);
    console.log(
      `[S0] windows=${firstWindow},${secondWindow},${thirdWindow} survivors: otherCensus=${await countStagedRowsOf(TARGET_FILE, otherCensusID)} ` +
        `otherFile=${await countStagedRowsOf(OTHER_FILE, targetCensusID)} target=${await countStagedRowsOf(TARGET_FILE, targetCensusID)}`
    );

    expect([firstWindow, secondWindow, thirdWindow]).toEqual([STAGED_WINDOW_LIMIT, STAGED_TARGET_ROWS - STAGED_WINDOW_LIMIT, 0]);
    expect(await countStagedRowsOf(TARGET_FILE, targetCensusID)).toBe(0);
    expect(await countStagedRowsOf(TARGET_FILE, otherCensusID)).toBe(STAGED_OTHER_CENSUS_ROWS);
    expect(await countStagedRowsOf(OTHER_FILE, targetCensusID)).toBe(STAGED_OTHER_FILE_ROWS);
  });

  it('F0 removes exactly the family rows of the file in the census, with their links and one DELETE-audit row each', async () => {
    const subBatchID = buildSubBatchID(familyBatchID, SUB_BATCH_ORDINAL);
    const lookAlikeBatchIDs = [
      `arb${familyBatchID.slice(3)}`,
      `${familyBatchID.slice(0, -1)}z`,
      familyBatchID.slice(0, -1),
      `${familyBatchID}x`,
      `${familyBatchID.slice(0, 10)}_${familyBatchID.slice(11)}`
    ];
    const baseIDs = await insertCoreMeasurementRows(TARGET_FILE, familyBatchID, targetCensusID, FAMILY_ROWS_UNDER_BASE);
    const subBatchIDs = await insertCoreMeasurementRows(TARGET_FILE, subBatchID, targetCensusID, FAMILY_ROWS_UNDER_SUB_BATCH);
    const familyIDs = [...baseIDs, ...subBatchIDs];
    for (const lookAlikeBatchID of lookAlikeBatchIDs) await insertCoreMeasurementRows(TARGET_FILE, lookAlikeBatchID, targetCensusID, 1);
    await insertCoreMeasurementRows(OTHER_FILE, familyBatchID, targetCensusID, 1);
    await insertCoreMeasurementRows(TARGET_FILE, familyBatchID, otherCensusID, 1);

    const [errorRows] = await setupConnection.query<RowDataPacket[]>('SELECT ErrorID FROM measurement_errors LIMIT 1');
    await setupConnection.query('INSERT INTO measurement_error_log (MeasurementID, ErrorID) VALUES (?, ?)', [familyIDs[0], errorRows[0].ErrorID]);
    const manager = managerOver(setupConnection);

    await setupConnection.query('BEGIN');
    const firstWindow = await deleteBatchFamilyRowsWindow(
      manager,
      config.database,
      TARGET_FILE,
      familyBatchID,
      plotID,
      targetCensusID,
      TEST_CHANGED_BY,
      TRANSACTION_ID
    );
    const secondWindow = await deleteBatchFamilyRowsWindow(
      manager,
      config.database,
      TARGET_FILE,
      familyBatchID,
      plotID,
      targetCensusID,
      TEST_CHANGED_BY,
      TRANSACTION_ID
    );
    await setupConnection.query('COMMIT');

    const survivorsByLookAlike = await Promise.all(lookAlikeBatchIDs.map(batchID => countCoreMeasurementsOf(TARGET_FILE, batchID, targetCensusID)));
    const auditedDeleteCount = await countRows(
      `SELECT COUNT(*) AS total FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND Operation = 'DELETE' AND RecordID IN (?)`,
      [familyIDs.map(String)]
    );
    const remainingLinks = await countRows('SELECT COUNT(*) AS total FROM measurement_error_log WHERE MeasurementID IN (?)', [familyIDs]);
    console.log(
      `[F0] windows=${firstWindow},${secondWindow} lookAlikeSurvivors=${survivorsByLookAlike.join(',')} audited=${auditedDeleteCount} remainingLinks=${remainingLinks}`
    );

    expect([firstWindow, secondWindow]).toEqual([FAMILY_ROWS_TOTAL, 0]);
    expect(await countCoreMeasurementsOf(TARGET_FILE, familyBatchID, targetCensusID)).toBe(0);
    expect(await countCoreMeasurementsOf(TARGET_FILE, subBatchID, targetCensusID)).toBe(0);
    expect(survivorsByLookAlike).toEqual(lookAlikeBatchIDs.map(() => 1));
    expect(await countCoreMeasurementsOf(OTHER_FILE, familyBatchID, targetCensusID)).toBe(1);
    expect(await countCoreMeasurementsOf(TARGET_FILE, familyBatchID, otherCensusID)).toBe(1);
    expect(auditedDeleteCount).toBe(FAMILY_ROWS_TOTAL);
    expect(remainingLinks).toBe(0);
  });

  it('F0 id select walks idx_cm_uploadfile_batch_census_stem and needs no filesort (P22)', async () => {
    await insertCoreMeasurementRows(TARGET_FILE, familyBatchID, targetCensusID, F0_PLAN_PROBE_FAMILY_ROWS);
    await setupConnection.query('ANALYZE TABLE coremeasurements');
    const capturedStatements: Array<{ sql: string; params: unknown[] }> = [];
    const recordingManager = {
      executeQuery: async (sql: string, params: unknown[] = []) => {
        capturedStatements.push({ sql, params });
        return [];
      }
    } as unknown as ConnectionManager;
    await deleteBatchFamilyRowsWindow(recordingManager, config.database, TARGET_FILE, familyBatchID, plotID, targetCensusID, TEST_CHANGED_BY, TRANSACTION_ID);
    const [idSelect] = capturedStatements;

    const [planRows] = await setupConnection.query<RowDataPacket[]>(`EXPLAIN FORMAT=TRADITIONAL ${idSelect.sql}`, idSelect.params);
    console.log(`[F0 plan] ${planRows.map(row => `table=${row.table} type=${row.type} key=${row.key} rows=${row.rows} Extra=${row.Extra}`).join(' | ')}`);

    expect(capturedStatements).toHaveLength(1);
    expect(planRows).toHaveLength(1);
    expect(planRows[0].key).toBe(BATCH_FAMILY_SCAN_INDEX);
    expect(String(planRows[0].Extra)).not.toContain(FILESORT_MARKER);
  });

  it('one F0 window row-locks about one window of the family under READ COMMITTED, not the whole remaining family (M6)', async () => {
    await insertCoreMeasurementRows(TARGET_FILE, familyBatchID, targetCensusID, F0_LOCK_PROBE_FAMILY_ROWS);
    await setupConnection.query('ANALYZE TABLE coremeasurements');
    let statementsSeen = 0;
    const selectOnlyManager = {
      executeQuery: async (sql: string, params: unknown[] = []) => {
        statementsSeen += 1;
        if (statementsSeen === 1) {
          const [rows] = await setupConnection.query(sql, params);
          return rows;
        }
        return { affectedRows: CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE };
      }
    } as unknown as ConnectionManager;

    await setupConnection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await setupConnection.query('BEGIN');
    try {
      await deleteBatchFamilyRowsWindow(
        selectOnlyManager,
        config.database,
        TARGET_FILE,
        familyBatchID,
        plotID,
        targetCensusID,
        TEST_CHANGED_BY,
        TRANSACTION_ID
      );
      const [lockRows] = await lockObserverConnection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM performance_schema.data_locks
         WHERE OBJECT_SCHEMA = ? AND OBJECT_NAME = 'coremeasurements' AND INDEX_NAME = ? AND LOCK_TYPE = ?`,
        [config.database, BATCH_FAMILY_SCAN_INDEX, RECORD_LOCK_TYPE]
      );
      const recordLocks = Number(lockRows[0].total);
      console.log(
        `[F0 locks] familyRows=${F0_LOCK_PROBE_FAMILY_ROWS} window=${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE} recordLocksOnIndex=${recordLocks} ` +
          `allowed<=${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE + F0_LOCK_SLACK_ROWS} statementsSeen=${statementsSeen}`
      );
      expect(recordLocks).toBeGreaterThan(0);
      expect(recordLocks).toBeLessThanOrEqual(CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE + F0_LOCK_SLACK_ROWS);
    } finally {
      await setupConnection.query('ROLLBACK');
    }
  });
});
