/**
 * Pins the optimizer plan of the three setup statements that scan a batch family on a frozen-statistics table.
 *
 * What this proves: each statement carries an optimizer hint that MySQL honours (the plan's key is FAMILY_SCAN_INDEX,
 * and SHOW WARNINGS reports no unknown or ignored hint), and FAMILY_SCAN_INDEX is an index the schema contract guarantees.
 *
 * What this does NOT prove: that the unhinted statement is mis-planned. The local optimizer may pick the same index
 * without the hint, so a green run here says nothing about the Azure mis-plan on the 412k-row Mpala table. The unhinted
 * key is logged for comparison only; the Azure harness is the evidence for the mis-plan.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import ConnectionManager from '../../lib/db/connectionmanager';
import { REQUIRED_INDEXES_BY_TABLE } from '../../lib/db/schema-contract';
import { buildSubBatchPattern, discoverBatchFamily, FAMILY_SCAN_INDEX } from '../../lib/uploads/batch-family';
import { buildFallbackSplitSelectSQL, ingestBatch, IngestBatchAbortedError } from '../../lib/uploads/ingest-batch';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];
const FAMILY_ROW_COUNT = 3000;
const OTHER_CENSUS_ROW_COUNT = 3000;
const INSERT_CHUNK_ROWS = 500;
const SMALL_FAMILY_ROW_COUNT = 9;
const SMALL_SUB_BATCH_ROWS = '4';
const FILE_ID = 'fallback_plan_family.csv';
const BATCH_ID = 'fallback_plan_batch';
const OTHER_CENSUS_FILE_ID = 'fallback_plan_other_census.csv';
const CAPTURE_FILE_ID = 'fallback_plan_capture.csv';
const CAPTURE_BATCH_ID = 'fallback_plan_capture_batch';
const OTHER_CENSUS_ID = 9_999;
const LOWEST_ROW_ID = '0';
const HIGHEST_ROW_ID = String(Number.MAX_SAFE_INTEGER);
const HINT_PATTERN = /\/\*\+[^*]*\*\//;
const PLAN_ECHO_LEVEL = 'Note';
const BOUND_QUERY_MARKER = /MAX\(tm\.id\)/;

type ExplainNode = Record<string, unknown>;
type RecordedStatement = { sql: string; params: unknown[] };

let connection: Connection;
let testData: TestData;
let config: TestDatabaseConfig;
let oldBatchSize: string | undefined;

function assertLocalHost(): void {
  const host = process.env.AZURE_SQL_SERVER;
  if (!host || !LOCAL_HOSTS.includes(host)) throw new Error(`REFUSING plan test on non-local app host '${host}'`);
  if (!LOCAL_HOSTS.includes(DEFAULT_TEST_CONFIG.host)) throw new Error(`REFUSING plan test on non-local test host '${DEFAULT_TEST_CONFIG.host}'`);
}

async function seedRows(fileID: string, batchID: string, censusID: number, rowCount: number): Promise<void> {
  for (let start = 0; start < rowCount; start += INSERT_CHUNK_ROWS) {
    const values: unknown[][] = [];
    for (let index = start; index < Math.min(start + INSERT_CHUNK_ROWS, rowCount); index++) {
      values.push([
        fileID,
        batchID,
        testData.plots[0].plotID,
        censusID,
        `FP${String(index).padStart(9, '0')}`,
        '1',
        testData.species[0].SpeciesCode,
        testData.quadrats[0].QuadratName,
        index,
        index,
        10,
        1.3,
        '2024-03-15'
      ]);
    }
    await connection.query(
      `INSERT INTO temporarymeasurements
       (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate)
       VALUES ?`,
      [values]
    );
  }
}

/** Finds the key MySQL chose for the table aliased `tm`, wherever the plan nests it (grouping, ordering, duplicates removal). */
function findTableKey(node: unknown, alias: string): string | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const key = findTableKey(child, alias);
      if (key !== undefined) return key;
    }
    return undefined;
  }
  if (typeof node !== 'object' || node === null) return undefined;
  const record = node as ExplainNode;
  const table = record.table as ExplainNode | undefined;
  if (table && table.table_name === alias && typeof table.key === 'string') return table.key;
  for (const value of Object.values(record)) {
    const key = findTableKey(value, alias);
    if (key !== undefined) return key;
  }
  return undefined;
}

async function explainKey(label: string, sql: string, params: unknown[]): Promise<{ key: string | undefined; warnings: string[] }> {
  const [rows] = await connection.query<RowDataPacket[]>(`EXPLAIN FORMAT=JSON ${sql}`, params);
  const rawPlan = String(rows[0].EXPLAIN);
  const key = findTableKey(JSON.parse(rawPlan), 'tm');
  const [warningRows] = await connection.query<RowDataPacket[]>('SHOW WARNINGS');
  const warnings = warningRows.map(row => `${row.Level} ${row.Code}: ${row.Message}`);
  if (key === undefined) console.log(`[fallback-plan] ${label}: no key found, raw plan: ${rawPlan}`);
  console.log(`[fallback-plan] ${label}: key=${key} warnings=${JSON.stringify(warnings)}`);
  return { key, warnings };
}

async function expectHintHonoured(label: string, hintedSQL: string, params: unknown[]): Promise<void> {
  expect(hintedSQL, `${label} must carry the hint`).toContain(`/*+ INDEX(tm ${FAMILY_SCAN_INDEX}) */`);
  const unhinted = await explainKey(`${label} UNHINTED`, hintedSQL.replace(HINT_PATTERN, ''), params);
  const hinted = await explainKey(`${label} HINTED`, hintedSQL, params);
  console.log(`[fallback-plan] ${label}: hinted key=${hinted.key} unhinted key=${unhinted.key}`);
  expect(hinted.key, `${label} hinted plan key`).toBe(FAMILY_SCAN_INDEX);
  expect(
    hinted.warnings.filter(warning => !warning.startsWith(PLAN_ECHO_LEVEL)),
    `${label} optimizer warnings (an unknown or ignored hint is reported at Warning level)`
  ).toEqual([]);
}

async function captureBoundQuery(): Promise<RecordedStatement> {
  const recorded: RecordedStatement[] = [];
  const realManager = ConnectionManager.getInstance();
  const recordingManager = new Proxy(realManager, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property !== 'executeQuery') return typeof value === 'function' ? value.bind(target) : value;
      return (sql: string, params?: unknown[], transactionID?: string) => {
        recorded.push({ sql, params: params ?? [] });
        return target.executeQuery(sql, params, transactionID);
      };
    }
  });

  let setupCommitted = false;
  try {
    await ingestBatch(recordingManager, {
      schema: config.database,
      fileID: CAPTURE_FILE_ID,
      batchID: CAPTURE_BATCH_ID,
      expectedScope: { plotID: testData.plots[0].plotID, censusID: testData.census[0].censusID },
      isAborted: () => setupCommitted,
      onSetupProgress: diagnostic => {
        if (diagnostic.terminal && diagnostic.outcome === 'committed') setupCommitted = true;
      }
    });
  } catch (error) {
    if (!(error instanceof IngestBatchAbortedError) || !setupCommitted) throw error;
  }
  const bound = recorded.find(statement => BOUND_QUERY_MARKER.test(statement.sql));
  if (!bound) throw new Error(`Setup never issued the fallback bound query; recorded ${recorded.length} statement(s)`);
  return bound;
}

describe('setup family-scan plans on frozen statistics (real local MySQL)', () => {
  beforeAll(async () => {
    assertLocalHost();
    oldBatchSize = process.env.INGESTION_SUB_BATCH_ROWS;
    process.env.INGESTION_SUB_BATCH_ROWS = SMALL_SUB_BATCH_ROWS;
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;

    await seedRows(FILE_ID, BATCH_ID, testData.census[0].censusID, FAMILY_ROW_COUNT);
    await seedRows(OTHER_CENSUS_FILE_ID, BATCH_ID, OTHER_CENSUS_ID, OTHER_CENSUS_ROW_COUNT);
    await seedRows(CAPTURE_FILE_ID, CAPTURE_BATCH_ID, testData.census[0].censusID, SMALL_FAMILY_ROW_COUNT);
    await connection.query('ALTER TABLE temporarymeasurements STATS_AUTO_RECALC = 0');
    await connection.query('ANALYZE TABLE temporarymeasurements');
  }, 120_000);

  afterAll(async () => {
    if (connection) {
      await connection.query('ALTER TABLE temporarymeasurements STATS_AUTO_RECALC = DEFAULT');
      await teardownTestDatabase(connection, config);
    }
    if (oldBatchSize === undefined) delete process.env.INGESTION_SUB_BATCH_ROWS;
    else process.env.INGESTION_SUB_BATCH_ROWS = oldBatchSize;
  }, 120_000);

  it('names an index the schema contract guarantees', () => {
    expect(REQUIRED_INDEXES_BY_TABLE.temporarymeasurements).toContain(FAMILY_SCAN_INDEX);
  });

  it('honours the hint on the fallback keyset select', async () => {
    const sql = buildFallbackSplitSelectSQL(config.database, 10_000);
    const params = [FILE_ID, BATCH_ID, testData.plots[0].plotID, testData.census[0].censusID, LOWEST_ROW_ID, HIGHEST_ROW_ID];
    await expectHintHonoured('fallback select', sql, params);
  });

  it.each([
    ['non-locking', false],
    ['FOR UPDATE', true]
  ])('honours the hint on family discovery (%s)', async (_label, currentRead) => {
    const recorded: RecordedStatement[] = [];
    await discoverBatchFamily(
      async (sql, params) => {
        recorded.push({ sql, params });
        return [];
      },
      config.database,
      FILE_ID,
      BATCH_ID,
      { currentRead }
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0].params).toEqual([FILE_ID, BATCH_ID, buildSubBatchPattern(BATCH_ID)]);
    await expectHintHonoured(`discovery ${currentRead ? 'FOR UPDATE' : 'non-locking'}`, recorded[0].sql, recorded[0].params);
  });

  it('honours the hint on the fallback bound query captured from a real setup run', async () => {
    const bound = await captureBoundQuery();
    const params = [FILE_ID, BATCH_ID, testData.plots[0].plotID, testData.census[0].censusID];
    console.log(`[fallback-plan] captured bound query params from setup: ${JSON.stringify(bound.params)}`);
    await expectHintHonoured('fallback bound', bound.sql, params);
  });
});
