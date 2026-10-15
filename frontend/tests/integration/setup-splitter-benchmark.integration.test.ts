/**
 * Deterministic local setup-splitter benchmark. Routine runs use 25,000 rows;
 * SETUP_BENCHMARK_ROWS=412421 opts into the full incident size. It measures the
 * legacy LIMIT loop and scoped keyset walk on
 * identical staging IDs, records both plans, and verifies exact membership.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { type Connection, type RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';
import ConnectionManager from '../../lib/db/connectionmanager';
import { buildIngestionLockName, ingestBatch, IngestBatchAbortedError, type SetupDiagnostic } from '../../lib/uploads/ingest-batch';
import { safeFormatQuery } from '../../lib/db/sqlsecurity';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
const ROWS = Number(process.env.SETUP_BENCHMARK_ROWS ?? 25_000);
const BATCH_SIZE = 10_000;
const RUNS = 3;
const HISTORY_ROWS = Number(process.env.SETUP_BENCHMARK_HISTORY_ROWS ?? 0);
const STATS_MODE = process.env.SETUP_BENCHMARK_STATS_MODE ?? 'frozen';
const ACCEPTANCE_MODE = process.env.SETUP_BENCHMARK_ACCEPTANCE === '1';

let connection: Connection;
let testData: TestData;
let config: TestDatabaseConfig;
let fileID: string;
let historyFileID: string;
let batchID: string;

function assertLocal(): void {
  const appHost = process.env.AZURE_SQL_SERVER;
  if (!appHost || !LOCAL_HOSTS.includes(appHost)) throw new Error(`REFUSING benchmark: application DB host is '${appHost}', not local`);
  if (!LOCAL_HOSTS.includes(DEFAULT_TEST_CONFIG.host)) throw new Error(`REFUSING benchmark: test DB host is '${DEFAULT_TEST_CONFIG.host}', not local`);
}

async function stageFixture(): Promise<number> {
  const started = performance.now();
  const file = fileID;
  const batch = batchID;
  const plotID = testData.plots[0].plotID;
  const censusID = testData.census[0].censusID;
  const species = testData.species[0].SpeciesCode;
  const quadrat = testData.quadrats[0].QuadratName;
  const chunkSize = 500;
  for (let offset = 0; offset < ROWS; offset += chunkSize) {
    const count = Math.min(chunkSize, ROWS - offset);
    const values: unknown[] = [];
    const tuples: string[] = [];
    const addRow = (rowFile: string, rowBatch: string, treeTag: string, sourceRow: number) => {
      tuples.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      values.push(
        rowFile,
        rowBatch,
        plotID,
        censusID,
        treeTag,
        '1',
        species,
        quadrat,
        sourceRow % 100,
        sourceRow % 100,
        10 + (sourceRow % 100),
        1.3,
        '2024-03-15',
        null,
        null,
        null
      );
    };
    for (let i = 0; i < count; i++) {
      const sourceRow = offset + i;
      addRow(file, batch, `SB${sourceRow.toString().padStart(10, '0')}`, sourceRow);
      const historyBefore = Math.floor((sourceRow * HISTORY_ROWS) / ROWS);
      const historyAfter = Math.floor(((sourceRow + 1) * HISTORY_ROWS) / ROWS);
      for (let historyIndex = historyBefore; historyIndex < historyAfter; historyIndex++) {
        addRow(historyFileID, 'benchmark-history', `H${historyIndex.toString().padStart(10, '0')}`, historyIndex);
      }
    }
    await connection.query(
      `INSERT INTO temporarymeasurements
       (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments, PublishedStemID)
       VALUES ${tuples.join(',')}`,
      values
    );
  }
  return performance.now() - started;
}

async function readMembership(): Promise<string[]> {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT CAST(id AS CHAR) AS rowID, BatchID FROM temporarymeasurements WHERE FileID = ? ORDER BY temporarymeasurements.id',
    [fileID]
  );
  return rows.map(row => `${row.rowID}:${row.BatchID}`);
}

async function readHistoryMembership(): Promise<string[]> {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT CAST(id AS CHAR) AS rowID, BatchID FROM temporarymeasurements WHERE FileID = ? ORDER BY temporarymeasurements.id',
    [historyFileID]
  );
  return rows.map(row => `${row.rowID}:${row.BatchID}`);
}

async function freezeTableStatistics(): Promise<void> {
  await connection.query('ALTER TABLE temporarymeasurements STATS_AUTO_RECALC = 0');
  await connection.query('ANALYZE TABLE temporarymeasurements');
}

async function legacySplit(): Promise<number> {
  const manager = ConnectionManager.getInstance();
  const expected = { plotID: testData.plots[0].plotID, censusID: testData.census[0].censusID };
  const started = performance.now();
  await manager.withTransaction(
    async tx => {
      const lockName = buildIngestionLockName(config.database, fileID, expected.plotID, expected.censusID);
      if (!(await manager.acquireApplicationLock(lockName, tx.id, 120_000))) throw new Error('Could not acquire legacy benchmark setup lock');
      const count = Math.ceil(ROWS / BATCH_SIZE);
      for (let i = 1; i <= count; i++) {
        await manager.executeQuery(
          safeFormatQuery(config.database, `UPDATE ??.temporarymeasurements SET BatchID = ? WHERE FileID = ? AND BatchID = ? ORDER BY id LIMIT ${BATCH_SIZE}`),
          [`${batchID}__sub${String(i).padStart(3, '0')}`, fileID, batchID],
          tx.id
        );
      }
    },
    { timeoutMs: 120_000 }
  );
  return performance.now() - started;
}

async function productionSetupSplit(): Promise<{ diagnostic: SetupDiagnostic[]; setupDurationMs: number }> {
  const diagnostics: SetupDiagnostic[] = [];
  let setupCommitted = false;
  try {
    await ingestBatch(ConnectionManager.getInstance(), {
      schema: config.database,
      fileID,
      batchID,
      expectedScope: { plotID: testData.plots[0].plotID, censusID: testData.census[0].censusID },
      isAborted: () => setupCommitted,
      onSetupProgress: event => {
        diagnostics.push(event);
        if (event.terminal && event.outcome === 'committed') setupCommitted = true;
      }
    });
  } catch (error) {
    if (!(error instanceof IngestBatchAbortedError)) throw error;
  }
  const terminal = diagnostics.findLast(event => event.terminal);
  if (!terminal || !setupCommitted) throw new Error('Production setup did not commit before the controlled pre-procedure abort');
  return { diagnostic: diagnostics, setupDurationMs: terminal.elapsedMs };
}

describe('setup splitter benchmark (local MySQL only)', () => {
  beforeAll(async () => {
    assertLocal();
    if (!Number.isSafeInteger(ROWS) || ROWS < 1) throw new Error('SETUP_BENCHMARK_ROWS must be a positive safe integer');
    if (!Number.isSafeInteger(HISTORY_ROWS) || HISTORY_ROWS < 0) throw new Error('SETUP_BENCHMARK_HISTORY_ROWS must be a non-negative safe integer');
    if (!['fresh', 'frozen'].includes(STATS_MODE)) throw new Error('SETUP_BENCHMARK_STATS_MODE must be fresh or frozen');
    if (ACCEPTANCE_MODE && ROWS !== 412_421) throw new Error('Acceptance mode requires SETUP_BENCHMARK_ROWS=412421');
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    fileID = `setup_bench_${process.pid}`;
    historyFileID = `${fileID}_history`;
    batchID = 'benchmark-original';
    if (STATS_MODE === 'frozen') await freezeTableStatistics();
  }, 120_000);

  afterAll(async () => {
    if (connection) {
      await connection.query('DELETE FROM temporarymeasurements WHERE FileID IN (?, ?)', [fileID, historyFileID]);
      await teardownTestDatabase(connection, config);
    }
  }, 120_000);

  it('compares three identical legacy/keyset runs and verifies exact assignments', async () => {
    const stageMs = await stageFixture();
    if (STATS_MODE === 'fresh') await connection.query('ANALYZE TABLE temporarymeasurements');
    const historyBefore = await readHistoryMembership();
    expect(historyBefore).toHaveLength(HISTORY_ROWS);
    const [upperRows] = await connection.query<RowDataPacket[]>(
      'SELECT CAST(MAX(id) AS CHAR) AS upperID FROM temporarymeasurements WHERE FileID = ? AND BatchID = ?',
      [fileID, batchID]
    );
    const upperID = String(upperRows[0].upperID);
    const windows: Array<{ cursor: string; lastID: string }> = [];
    let cursor = '0';
    for (let i = 0; i < Math.ceil(ROWS / BATCH_SIZE); i++) {
      const [idRows] = await connection.query<RowDataPacket[]>(
        `SELECT CAST(id AS CHAR) AS rowID FROM temporarymeasurements WHERE FileID = ? AND BatchID = ? AND PlotID = ? AND CensusID = ? AND id > CAST(? AS UNSIGNED) AND id <= CAST(? AS UNSIGNED) ORDER BY temporarymeasurements.id LIMIT ${BATCH_SIZE}`,
        [fileID, batchID, testData.plots[0].plotID, testData.census[0].censusID, cursor, upperID]
      );
      const lastID = String(idRows[idRows.length - 1].rowID);
      windows.push({ cursor, lastID });
      cursor = lastID;
    }
    const plans: Array<{ cursor: string; lastID: string; selectPlan: unknown; updatePlan: unknown }> = [];
    for (const window of [windows[0], windows[windows.length - 1]]) {
      const [selectPlan] = await connection.query<RowDataPacket[]>(
        `EXPLAIN FORMAT=JSON SELECT CAST(id AS CHAR) AS rowID FROM temporarymeasurements WHERE FileID = ? AND BatchID = ? AND PlotID = ? AND CensusID = ? AND id > CAST(? AS UNSIGNED) AND id <= CAST(? AS UNSIGNED) ORDER BY temporarymeasurements.id LIMIT ${BATCH_SIZE}`,
        [fileID, batchID, testData.plots[0].plotID, testData.census[0].censusID, window.cursor, upperID]
      );
      const [updatePlan] = await connection.query<RowDataPacket[]>(
        'EXPLAIN FORMAT=JSON UPDATE temporarymeasurements SET BatchID = ? WHERE FileID = ? AND BatchID = ? AND PlotID = ? AND CensusID = ? AND id > CAST(? AS UNSIGNED) AND id <= CAST(? AS UNSIGNED)',
        [`${batchID}__sub001`, fileID, batchID, testData.plots[0].plotID, testData.census[0].censusID, window.cursor, window.lastID]
      );
      plans.push({ ...window, selectPlan: selectPlan[0]?.['EXPLAIN'], updatePlan: updatePlan[0]?.['EXPLAIN'] });
    }
    const legacyMs: number[] = [];
    const keysetMs: number[] = [];
    let reference: string[] | undefined;
    const runOrder: string[] = [];
    for (let run = 0; run < RUNS; run++) {
      const order = run % 2 === 0 ? (['legacy', 'keyset'] as const) : (['keyset', 'legacy'] as const);
      const runDetails: Record<string, unknown> = {};
      for (const variant of order) {
        await connection.query('UPDATE temporarymeasurements SET BatchID = ? WHERE FileID = ?', [batchID, fileID]);
        if (variant === 'legacy') {
          const elapsed = await legacySplit();
          legacyMs.push(elapsed);
          const membership = await readMembership();
          if (reference && JSON.stringify(membership) !== JSON.stringify(reference)) throw new Error('legacy run produced non-deterministic membership');
          reference = membership;
          runDetails.legacySplitterMs = elapsed;
        } else {
          const production = await productionSetupSplit();
          keysetMs.push(production.setupDurationMs);
          const membership = await readMembership();
          expect(membership).toEqual(reference);
          runDetails.productionSetupMs = production.setupDurationMs;
          runDetails.diagnostics = production.diagnostic;
        }
      }
      expect(await readHistoryMembership()).toEqual(historyBefore);
      runOrder.push(order.join('->'));
      const optimizer = await connection.query('SELECT @@optimizer_switch AS optimizer_switch, @@innodb_stats_persistent AS stats_persistent');
      console.log(
        JSON.stringify({
          benchmark: 'setup-splitter-v1',
          run: run + 1,
          runOrder: order,
          rows: ROWS,
          historyRows: HISTORY_ROWS,
          indexes: 'existing',
          statsMode: STATS_MODE,
          cacheCondition: 'shared local MySQL instance; alternating warm paired runs; no buffer-pool reset',
          optimizer,
          stageMs,
          ...runDetails,
          plans
        })
      );
    }
    const [tableDefinition] = await connection.query<RowDataPacket[]>('SHOW CREATE TABLE temporarymeasurements');
    const [indexDefinitions] = await connection.query<RowDataPacket[]>('SHOW INDEX FROM temporarymeasurements');
    const [serverMetadata] = await connection.query<RowDataPacket[]>(
      'SELECT VERSION() AS mysqlVersion, @@innodb_buffer_pool_size AS bufferPoolBytes, @@optimizer_switch AS optimizerSwitch, @@innodb_stats_persistent AS persistentStats'
    );
    const seed = `setup-splitter-v1|${fileID}|${batchID}|rows=${ROWS}|history=${HISTORY_ROWS}|row=i+1`;
    const legacyMedianMs = [...legacyMs].sort((a, b) => a - b)[Math.floor(RUNS / 2)];
    const keysetMedianMs = [...keysetMs].sort((a, b) => a - b)[Math.floor(RUNS / 2)];
    const medianRatio = keysetMedianMs / legacyMedianMs;
    console.log(
      JSON.stringify({
        benchmarkSummary: 'setup-splitter-v1',
        rows: ROWS,
        historyRowsConfigured: HISTORY_ROWS,
        statsMode: STATS_MODE,
        acceptanceMode: ACCEPTANCE_MODE,
        runs: RUNS,
        runOrder,
        fixtureSeed: seed,
        fixtureSeedSha256: createHash('sha256').update(seed).digest('hex'),
        legacyMedianMs,
        keysetMedianMs,
        medianRatio,
        serverMetadata,
        tableDefinition: tableDefinition[0]?.['Create Table'],
        indexDefinitions
      })
    );
    if (ACCEPTANCE_MODE) expect(medianRatio).toBeLessThanOrEqual(0.5);
    expect(reference).toHaveLength(ROWS);
  }, 1_800_000);
});
