/**
 * Setup split benchmark (opt-in, never part of test:integration).
 *
 * Stages SETUP_BENCH_ROWS rows twice through the real stageMeasurementChunk:
 *   - pre-partitioned: firstRowOrdinal = chunkIndex * chunk size, rows land under their final __subNNN members;
 *   - legacy: firstRowOrdinal = null, rows land under the original BatchID and setup runs the hinted fallback split.
 * Then times ingestBatch setup only (aborted right after the setup commit, so no procedure CALL runs) and counts
 * the BatchID rewrite statements each path issues.
 *
 * Usage:
 *   cd frontend && SETUP_BENCH_ROWS=100000 npm run bench:setup-split
 *
 * Requires: local MySQL via docker compose (port 3306, root/testpassword)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import ConnectionManager from '../../lib/db/connectionmanager';
import { UploadMode } from '../../config/uploadmodes';
import { SourceFormat } from '../../config/macros/formdetails';
import { ingestBatch, IngestBatchAbortedError } from '../../lib/uploads/ingest-batch';
import { stageMeasurementChunk } from '../../lib/uploads/stage-measurements';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];
const SETUP_BENCH_ROWS_ENV = 'SETUP_BENCH_ROWS';
const DEFAULT_BENCH_ROWS = 100_000;
const BROWSER_CHUNK_ROWS = 5000;
const CSV_DELIMITER = ',';
const CSV_HEADERS = ['treetag', 'stemtag', 'speciescode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date'];
const MEASUREMENT_DATE = '2024-03-15';
const BATCH_ID_REWRITE = /UPDATE[\s\S]*temporarymeasurements[\s\S]*SET\s+BatchID/i;
const BENCH_TIMEOUT_MS = 30 * 60 * 1000;
const SETUP_HOOK_TIMEOUT_MS = 120_000;

const FAMILIES = {
  prepartitioned: { label: 'pre-partitioned', fileID: 'setup_bench_prepartitioned.csv', batchID: 'bench_prepartitioned', treeTagPrefix: 'P' },
  legacy: { label: 'legacy (fallback split)', fileID: 'setup_bench_legacy.csv', batchID: 'bench_legacy', treeTagPrefix: 'L' }
} as const;
type Family = (typeof FAMILIES)[keyof typeof FAMILIES];

let connection: Connection;
let testData: TestData;
let config: TestDatabaseConfig;

function assertLocalHostOrRefuse(): void {
  const appHost = process.env.AZURE_SQL_SERVER;
  if (!appHost || !LOCAL_HOSTS.includes(appHost)) throw new Error(`REFUSING TO RUN: ConnectionManager host is '${appHost}', not local.`);
  if (!LOCAL_HOSTS.includes(DEFAULT_TEST_CONFIG.host)) throw new Error(`REFUSING TO RUN: TEST_DB_HOST is '${DEFAULT_TEST_CONFIG.host}', not local.`);
}

function benchRowCount(): number {
  const raw = process.env[SETUP_BENCH_ROWS_ENV];
  if (raw === undefined) return DEFAULT_BENCH_ROWS;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${SETUP_BENCH_ROWS_ENV} must be a positive integer; received '${raw}'`);
  return parsed;
}

async function freezeTableStatistics(): Promise<void> {
  const [tables] = await connection.query<RowDataPacket[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND ENGINE = 'InnoDB'`
  );
  for (const { TABLE_NAME: tableName } of tables) {
    await connection.query(`ALTER TABLE ?? STATS_AUTO_RECALC = 0`, [tableName]);
    await connection.query(`ANALYZE TABLE ??`, [tableName]);
  }
}

function buildChunk(family: Family, firstRowIndex: number, rowCount: number): Record<string, string>[] {
  const quadratName = testData.quadrats[0].QuadratName;
  const speciesCode = testData.species[0].SpeciesCode;
  return Array.from({ length: rowCount }, (_, offset) => {
    const rowIndex = firstRowIndex + offset;
    return {
      treetag: `${family.treeTagPrefix}${String(rowIndex).padStart(9, '0')}`,
      stemtag: '1',
      speciescode: speciesCode,
      quadrat: quadratName,
      lx: String((rowIndex % 500) / 10),
      ly: String((rowIndex % 700) / 10),
      dbh: String(10 + (rowIndex % 900) / 10),
      hom: '1.3',
      date: MEASUREMENT_DATE
    };
  });
}

async function stageFamily(family: Family, totalRows: number, prePartitioned: boolean): Promise<number> {
  const manager = ConnectionManager.getInstance();
  const startedAt = performance.now();
  for (let firstRowIndex = 0; firstRowIndex < totalRows; firstRowIndex += BROWSER_CHUNK_ROWS) {
    const rowsInChunk = Math.min(BROWSER_CHUNK_ROWS, totalRows - firstRowIndex);
    const transactionID = await manager.beginTransaction();
    try {
      const result = await stageMeasurementChunk(manager, {
        schema: config.database,
        fileName: family.fileID,
        batchID: family.batchID,
        plotID: testData.plots[0].plotID,
        censusID: testData.census[0].censusID,
        uploadMode: UploadMode.REVISIONS,
        sourceFormat: SourceFormat.csv,
        rawRows: buildChunk(family, firstRowIndex, rowsInChunk),
        csvHeaders: CSV_HEADERS,
        delimiter: CSV_DELIMITER,
        uploadSessionID: null,
        transactionID,
        firstRowOrdinal: prePartitioned ? firstRowIndex : null
      });
      expect(result.insertedCount, `chunk at row ${firstRowIndex} of ${family.fileID} staged fewer rows than sent`).toBe(rowsInChunk);
      await manager.commitTransaction(transactionID);
    } catch (error) {
      await manager.rollbackTransaction(transactionID);
      throw error;
    }
  }
  return performance.now() - startedAt;
}

async function timeSetupOnly(family: Family): Promise<{ setupMs: number; batchIdRewrites: number }> {
  const executeQuerySpy = vi.spyOn(ConnectionManager.getInstance(), 'executeQuery');
  let setupCommitted = false;
  const startedAt = performance.now();
  try {
    await ingestBatch(ConnectionManager.getInstance(), {
      schema: config.database,
      fileID: family.fileID,
      batchID: family.batchID,
      expectedScope: { plotID: testData.plots[0].plotID, censusID: testData.census[0].censusID },
      isAborted: () => setupCommitted,
      onSetupProgress: diagnostic => {
        if (diagnostic.terminal && diagnostic.outcome === 'committed') setupCommitted = true;
      }
    });
    throw new Error(`Setup-only run for ${family.fileID} unexpectedly reached procedure completion`);
  } catch (error) {
    if (!(error instanceof IngestBatchAbortedError) || !setupCommitted) throw error;
  }
  const setupMs = performance.now() - startedAt;
  const batchIdRewrites = executeQuerySpy.mock.calls.filter(([sql]) => BATCH_ID_REWRITE.test(String(sql))).length;
  executeQuerySpy.mockRestore();
  return { setupMs, batchIdRewrites };
}

async function distinctBatchIDCount(family: Family): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT COUNT(DISTINCT BatchID) AS batchCount FROM temporarymeasurements WHERE FileID = ?', [
    family.fileID
  ]);
  return Number(rows[0].batchCount);
}

describe('setup split benchmark (opt-in, real local MySQL)', () => {
  beforeAll(async () => {
    assertLocalHostOrRefuse();
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    await freezeTableStatistics();
  }, SETUP_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    if (connection) await teardownTestDatabase(connection, config);
  }, SETUP_HOOK_TIMEOUT_MS);

  it(
    'times staging and setup for a pre-partitioned and a legacy family',
    async () => {
      const totalRows = benchRowCount();

      const prepartitionedStagingMs = await stageFamily(FAMILIES.prepartitioned, totalRows, true);
      const legacyStagingMs = await stageFamily(FAMILIES.legacy, totalRows, false);
      expect(await distinctBatchIDCount(FAMILIES.legacy), 'legacy rows must still sit under the original BatchID before setup').toBe(1);

      const prepartitioned = await timeSetupOnly(FAMILIES.prepartitioned);
      const legacy = await timeSetupOnly(FAMILIES.legacy);

      console.table([
        {
          path: FAMILIES.prepartitioned.label,
          rows: totalRows,
          stagingMs: Math.round(prepartitionedStagingMs),
          setupMs: Math.round(prepartitioned.setupMs),
          batchIdUpdates: prepartitioned.batchIdRewrites,
          subBatches: await distinctBatchIDCount(FAMILIES.prepartitioned)
        },
        {
          path: FAMILIES.legacy.label,
          rows: totalRows,
          stagingMs: Math.round(legacyStagingMs),
          setupMs: Math.round(legacy.setupMs),
          batchIdUpdates: legacy.batchIdRewrites,
          subBatches: await distinctBatchIDCount(FAMILIES.legacy)
        }
      ]);

      expect(prepartitioned.batchIdRewrites, 'pre-partitioned setup must not rewrite BatchID').toBe(0);
    },
    BENCH_TIMEOUT_MS
  );
});
