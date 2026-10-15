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
import { TEST_DB_NAME_PREFIX } from '../setup/test-db-connection';
import ConnectionManager from '../../lib/db/connectionmanager';
import { buildIngestionLockName, ingestBatch, IngestBatchAbortedError, type SetupDiagnostic } from '../../lib/uploads/ingest-batch';
import { safeFormatQuery } from '../../lib/db/sqlsecurity';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
const ROWS = Number(process.env.SETUP_BENCHMARK_ROWS ?? 25_000);
const BATCH_SIZE = 10_000;
const RUNS = 3;
const HISTORY_ROWS = Number(process.env.SETUP_BENCHMARK_HISTORY_ROWS ?? 50_000);
const STATS_MODE = process.env.SETUP_BENCHMARK_STATS_MODE ?? 'frozen';
const ACCEPTANCE_MODE = process.env.SETUP_BENCHMARK_ACCEPTANCE === '1';
const COMPARE_CANDIDATE_INDEX = process.env.SETUP_BENCHMARK_COMPARE_INDEX_C === '1';
const CANDIDATE_INDEX = 'idx_tmpm_file_batch_id';
const ORIGINAL_INGESTION_SUB_BATCH_ROWS = process.env.INGESTION_SUB_BATCH_ROWS;

let connection: Connection;
let testData: TestData;
let config: TestDatabaseConfig;
let fileID: string;
let historyFileID: string;
let batchID: string;
let statementHistoryAvailable = false;

function assertLocal(): void {
  const appHost = process.env.AZURE_SQL_SERVER;
  if (!appHost || !LOCAL_HOSTS.includes(appHost)) throw new Error(`REFUSING benchmark: application DB host is '${appHost}', not local`);
  if (!LOCAL_HOSTS.includes(DEFAULT_TEST_CONFIG.host)) throw new Error(`REFUSING benchmark: test DB host is '${DEFAULT_TEST_CONFIG.host}', not local`);
}

function assertDedicatedTestDatabase(): void {
  if (config.database !== DEFAULT_TEST_CONFIG.database || !config.database.startsWith(TEST_DB_NAME_PREFIX) || !LOCAL_HOSTS.includes(config.host)) {
    throw new Error(`REFUSING benchmark fixture reset outside its dedicated local test database: ${config.database}`);
  }
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

async function readHistoryMembership(): Promise<string[]> {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT CAST(id AS CHAR) AS rowID, BatchID FROM temporarymeasurements WHERE FileID = ? ORDER BY temporarymeasurements.id',
    [historyFileID]
  );
  return rows.map(row => `${row.rowID}:${row.BatchID}`);
}

async function readFullMembership(): Promise<string[]> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT CAST(id AS CHAR) AS rowID, FileID, BatchID FROM temporarymeasurements ORDER BY id');
  return rows.map(row => `${row.rowID}:${row.FileID}:${row.BatchID}`);
}

async function configureCandidateIndex(enabled: boolean): Promise<void> {
  const [indexes] = await connection.query<RowDataPacket[]>('SHOW INDEX FROM temporarymeasurements WHERE Key_name = ?', [CANDIDATE_INDEX]);
  if (enabled && indexes.length === 0) {
    await connection.query(`ALTER TABLE temporarymeasurements ADD INDEX \`${CANDIDATE_INDEX}\` (FileID, BatchID, id)`);
  } else if (!enabled && indexes.length > 0) {
    await connection.query(`ALTER TABLE temporarymeasurements DROP INDEX \`${CANDIDATE_INDEX}\``);
  }
}

async function resetFixture(candidateIndex: boolean): Promise<void> {
  // This benchmark requires its own namespace and local MySQL guard. TRUNCATE is
  // intentionally table-wide so every arm restarts AUTO_INCREMENT at the same ID.
  assertDedicatedTestDatabase();
  await connection.query('TRUNCATE TABLE temporarymeasurements');
  await configureCandidateIndex(candidateIndex);
  await connection.query('ALTER TABLE temporarymeasurements STATS_AUTO_RECALC = 0');
  if (STATS_MODE === 'frozen') await connection.query('ANALYZE TABLE temporarymeasurements');
}

async function analyzeStagedFixture(): Promise<number> {
  if (STATS_MODE !== 'fresh') return 0;
  const started = performance.now();
  // Fresh cardinality for each independently staged arm; disabling auto-recalc
  // keeps those statistics stable for the duration of the measured transaction.
  await connection.query('ANALYZE TABLE temporarymeasurements');
  return performance.now() - started;
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

async function captureQueryPlans(): Promise<{ legacyUpdate: unknown; keysetWindows: unknown[] }> {
  const plotID = testData.plots[0].plotID;
  const censusID = testData.census[0].censusID;
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
      [fileID, batchID, plotID, censusID, cursor, upperID]
    );
    if (idRows.length === 0) throw new Error(`Missing expected keyset benchmark window at cursor ${cursor}`);
    const lastID = String(idRows[idRows.length - 1].rowID);
    windows.push({ cursor, lastID });
    cursor = lastID;
  }

  const [legacyPlanRows] = await connection.query<RowDataPacket[]>(
    `EXPLAIN FORMAT=JSON UPDATE temporarymeasurements SET BatchID = ? WHERE FileID = ? AND BatchID = ? ORDER BY id LIMIT ${BATCH_SIZE}`,
    [`${batchID}__sub001`, fileID, batchID]
  );
  const keysetWindows: unknown[] = [];
  for (const window of [windows[0], windows[windows.length - 1]]) {
    const params = [fileID, batchID, plotID, censusID, window.cursor, upperID];
    const [selectPlan] = await connection.query<RowDataPacket[]>(
      `EXPLAIN FORMAT=JSON SELECT CAST(id AS CHAR) AS rowID FROM temporarymeasurements WHERE FileID = ? AND BatchID = ? AND PlotID = ? AND CensusID = ? AND id > CAST(? AS UNSIGNED) AND id <= CAST(? AS UNSIGNED) ORDER BY temporarymeasurements.id LIMIT ${BATCH_SIZE}`,
      params
    );
    const [updatePlan] = await connection.query<RowDataPacket[]>(
      'EXPLAIN FORMAT=JSON UPDATE temporarymeasurements SET BatchID = ? WHERE FileID = ? AND BatchID = ? AND PlotID = ? AND CensusID = ? AND id > CAST(? AS UNSIGNED) AND id <= CAST(? AS UNSIGNED)',
      [`${batchID}__sub001`, fileID, batchID, plotID, censusID, window.cursor, window.lastID]
    );
    keysetWindows.push({
      ...window,
      select: selectPlan[0]?.['EXPLAIN'],
      update: updatePlan[0]?.['EXPLAIN']
    });
  }
  return { legacyUpdate: legacyPlanRows[0]?.['EXPLAIN'], keysetWindows };
}

type StatementEventSnapshot = Map<string, bigint>;

async function captureStatementEventSnapshot(): Promise<StatementEventSnapshot | null> {
  if (!statementHistoryAvailable) return null;
  try {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT THREAD_ID, MAX(EVENT_ID) AS maxEventID FROM performance_schema.events_statements_history_long GROUP BY THREAD_ID'
    );
    return new Map(rows.map(row => [String(row.THREAD_ID), BigInt(String(row.maxEventID))]));
  } catch {
    return null;
  }
}

async function runWithTransactionThreadCapture<T>(
  work: () => Promise<T>
): Promise<{ result: T; threadID: string | null; captureQueryMs: number; captureReason: string | null }> {
  const manager = ConnectionManager.getInstance();
  const originalWithTransaction = manager.withTransaction;
  let threadID: string | null = null;
  let captureQueryMs = 0;
  let captureReason: string | null = statementHistoryAvailable ? null : 'statement_history_unavailable';
  manager.withTransaction = (async (callback, options) =>
    originalWithTransaction.call(
      manager,
      async tx => {
        if (!statementHistoryAvailable) return callback(tx);
        const started = performance.now();
        try {
          const connectionRows = await tx.query<RowDataPacket[]>('SELECT CONNECTION_ID() AS connectionID');
          const connectionID = connectionRows[0]?.connectionID;
          if (connectionID != null) {
            const [threadRows] = await connection.query<RowDataPacket[]>('SELECT THREAD_ID FROM performance_schema.threads WHERE PROCESSLIST_ID = ?', [
              connectionID
            ]);
            threadID = threadRows[0]?.THREAD_ID == null ? null : String(threadRows[0].THREAD_ID);
          }
          if (!threadID) captureReason = 'transaction_thread_id_query_returned_no_row';
        } catch (error) {
          captureReason = error instanceof Error && 'code' in error ? `thread_id_query_failed:${String(error.code)}` : 'thread_id_query_failed';
        } finally {
          captureQueryMs = performance.now() - started;
        }
        return callback(tx);
      },
      options
    )) as typeof manager.withTransaction;
  try {
    return { result: await work(), threadID, captureQueryMs, captureReason };
  } finally {
    manager.withTransaction = originalWithTransaction;
  }
}

async function collectStatementEvents(snapshot: StatementEventSnapshot | null, threadID: string | null): Promise<unknown> {
  if (!snapshot || !statementHistoryAvailable) return { available: false, reason: 'history_consumer_disabled_or_unavailable' };
  if (!threadID) return { available: false, reason: 'transaction_thread_id_unavailable' };
  try {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT THREAD_ID, EVENT_ID, EVENT_NAME, SQL_TEXT, TIMER_WAIT, ROWS_EXAMINED, ROWS_AFFECTED
       FROM performance_schema.events_statements_history_long
       WHERE THREAD_ID = ?`,
      [threadID]
    );
    const events = rows
      .filter(row => BigInt(String(row.EVENT_ID)) > (snapshot.get(threadID) ?? BigInt(0)))
      .sort((left, right) => (BigInt(String(left.EVENT_ID)) < BigInt(String(right.EVENT_ID)) ? -1 : 1));
    if (events.length === 0) {
      return { available: false, reason: 'no_matching_statement_history_events_observed' };
    }
    return {
      available: true,
      transactionThreadID: threadID,
      eventSemantics: 'raw statement history sequence for captured transaction thread; SQL_TEXT may be NULL for prepared execute events',
      statements: events.map(row => ({
        eventID: row.EVENT_ID,
        eventName: row.EVENT_NAME,
        durationMs: Number(row.TIMER_WAIT) / 1_000_000_000,
        rowsExamined: row.ROWS_EXAMINED,
        rowsAffected: row.ROWS_AFFECTED,
        sql: row.SQL_TEXT == null ? null : String(row.SQL_TEXT).slice(0, 500)
      }))
    };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error && 'code' in error ? String(error.code) : 'performance_schema_read_failed'
    };
  }
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
    assertDedicatedTestDatabase();
    fileID = `setup_bench_${process.pid}`;
    historyFileID = `${fileID}_history`;
    batchID = 'benchmark-original';
    process.env.INGESTION_SUB_BATCH_ROWS = String(BATCH_SIZE);
    const [performanceSchemaRows] = await connection.query<RowDataPacket[]>('SELECT @@performance_schema AS enabled');
    if (Number(performanceSchemaRows[0]?.enabled) === 1) {
      const [consumers] = await connection.query<RowDataPacket[]>(
        "SELECT NAME, ENABLED FROM performance_schema.setup_consumers WHERE NAME IN ('global_instrumentation', 'thread_instrumentation', 'events_statements_history_long')"
      );
      const [instruments] = await connection.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS enabledCount FROM performance_schema.setup_instruments WHERE NAME LIKE 'statement/%' AND ENABLED = 'YES'"
      );
      const enabledConsumers = new Map(consumers.map(row => [String(row.NAME), String(row.ENABLED)]));
      statementHistoryAvailable =
        enabledConsumers.get('global_instrumentation') === 'YES' &&
        enabledConsumers.get('thread_instrumentation') === 'YES' &&
        enabledConsumers.get('events_statements_history_long') === 'YES' &&
        Number(instruments[0]?.enabledCount) > 0;
    }
  }, 120_000);

  afterAll(async () => {
    try {
      if (connection) {
        try {
          assertDedicatedTestDatabase();
          await configureCandidateIndex(false);
          await connection.query('TRUNCATE TABLE temporarymeasurements');
        } finally {
          await teardownTestDatabase(connection, config);
        }
      }
    } finally {
      if (ORIGINAL_INGESTION_SUB_BATCH_ROWS === undefined) delete process.env.INGESTION_SUB_BATCH_ROWS;
      else process.env.INGESTION_SUB_BATCH_ROWS = ORIGINAL_INGESTION_SUB_BATCH_ROWS;
    }
  }, 120_000);

  it('compares paired splitter runs on independently staged, reset-ID fixtures', async () => {
    const candidateArms = COMPARE_CANDIDATE_INDEX ? (['C'] as const) : ([] as const);
    const indexVariants = ['B', ...candidateArms] as const;
    const timings: Record<string, { legacyMs: number[]; keysetMs: number[]; stageInsertMs: number[]; fixtureSetupMs: number[] }> = {
      B: { legacyMs: [], keysetMs: [], stageInsertMs: [], fixtureSetupMs: [] },
      C: { legacyMs: [], keysetMs: [], stageInsertMs: [], fixtureSetupMs: [] }
    };
    let stagedReference: string[] | undefined;
    let finalMembershipReference: string[] | undefined;
    let historyReference: string[] | undefined;
    const runOrder: string[] = [];
    let observedIndexes: RowDataPacket[] = [];

    for (const indexVariant of indexVariants) {
      for (let run = 0; run < RUNS; run++) {
        const splitterOrder = run % 2 === 0 ? (['legacy', 'keyset'] as const) : (['keyset', 'legacy'] as const);
        const arms = splitterOrder.map(splitter => ({ indexVariant, splitter }));
        for (const arm of arms) {
          const fixtureStarted = performance.now();
          await resetFixture(indexVariant === 'C');
          const stageInsertMs = await stageFixture();
          const statsAnalysisMs = await analyzeStagedFixture();
          const fixtureSetupMs = performance.now() - fixtureStarted;
          const staged = await readFullMembership();
          expect(staged).toHaveLength(ROWS + HISTORY_ROWS);
          if (stagedReference) expect(staged).toEqual(stagedReference);
          else stagedReference = staged;
          const historyBefore = await readHistoryMembership();
          expect(historyBefore).toHaveLength(HISTORY_ROWS);
          if (historyReference) expect(historyBefore).toEqual(historyReference);
          else historyReference = historyBefore;

          const plans = await captureQueryPlans();
          const statementEventSnapshot = await captureStatementEventSnapshot();
          const started = performance.now();
          let diagnostics: SetupDiagnostic[] | undefined;
          const capturedRun = await runWithTransactionThreadCapture(async () => {
            if (arm.splitter === 'legacy') return legacySplit();
            const production = await productionSetupSplit();
            diagnostics = production.diagnostic;
            return production.setupDurationMs;
          });
          const splitterMs = capturedRun.result;
          const wallMs = performance.now() - started;
          const statementMetrics = await collectStatementEvents(statementEventSnapshot, capturedRun.threadID);
          const membership = await readFullMembership();
          if (finalMembershipReference) expect(membership).toEqual(finalMembershipReference);
          else finalMembershipReference = membership;
          expect(await readHistoryMembership()).toEqual(historyBefore);
          const armLabel = arm.indexVariant === 'B' ? (arm.splitter === 'legacy' ? 'A-legacy' : 'B-keyset') : `C-${arm.splitter}`;
          timings[arm.indexVariant][arm.splitter === 'legacy' ? 'legacyMs' : 'keysetMs'].push(splitterMs);
          timings[arm.indexVariant].stageInsertMs.push(stageInsertMs);
          timings[arm.indexVariant].fixtureSetupMs.push(fixtureSetupMs);
          runOrder.push(armLabel);
          const [optimizer] = await connection.query<RowDataPacket[]>(
            'SELECT @@optimizer_switch AS optimizer_switch, @@innodb_stats_persistent AS stats_persistent'
          );
          const [indexes] = await connection.query<RowDataPacket[]>('SHOW INDEX FROM temporarymeasurements');
          observedIndexes = indexes;
          console.log(
            JSON.stringify({
              benchmark: 'setup-splitter-v2',
              run: run + 1,
              arm: armLabel,
              rows: ROWS,
              historyRows: HISTORY_ROWS,
              exactStagedMembershipSha256: createHash('sha256').update(staged.join('\n')).digest('hex'),
              exactFinalMembershipSha256: createHash('sha256').update(membership.join('\n')).digest('hex'),
              stageInsertMs,
              statsAnalysisMs,
              fixtureSetupMs,
              instrumentationOverheadMs: capturedRun.captureQueryMs,
              transactionThreadCapture: capturedRun.captureReason,
              clientStatementShape:
                arm.splitter === 'legacy'
                  ? `repeated UPDATE temporarymeasurements WHERE FileID+BatchID ORDER BY id LIMIT ${BATCH_SIZE}`
                  : `keyset scoped SELECT id windows + interval UPDATEs, then final family revalidation`,
              splitterMs,
              wallMs,
              statsMode: STATS_MODE,
              statistics:
                STATS_MODE === 'frozen'
                  ? 'auto-recalc disabled; analyzed while empty after truncate, before staging'
                  : 'auto-recalc disabled; freshly analyzed after each arm staging',
              cacheCondition: 'warm-after-staging paired runs; shared local MySQL buffer pool; no cold-cache claim',
              timingNote: 'measured wall includes one transaction-thread capture SELECT when PFS history is available; its duration is reported separately',
              optimizer,
              plans,
              actualStatementMetrics: statementMetrics,
              diagnostics,
              indexes
            })
          );
        }
      }
    }

    const [tableDefinition] = await connection.query<RowDataPacket[]>('SHOW CREATE TABLE temporarymeasurements');
    const [serverMetadata] = await connection.query<RowDataPacket[]>(
      'SELECT VERSION() AS mysqlVersion, @@innodb_buffer_pool_size AS bufferPoolBytes, @@optimizer_switch AS optimizerSwitch, @@innodb_stats_persistent AS persistentStats'
    );
    const seed = `setup-splitter-v2|${fileID}|${batchID}|rows=${ROWS}|history=${HISTORY_ROWS}|row=i+1`;
    const median = (samples: number[]) => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
    const bLegacyMedianMs = median(timings.B.legacyMs);
    const bKeysetMedianMs = median(timings.B.keysetMs);
    const medianRatio = bKeysetMedianMs / bLegacyMedianMs;
    console.log(
      JSON.stringify({
        benchmarkSummary: 'setup-splitter-v2',
        rows: ROWS,
        historyRowsConfigured: HISTORY_ROWS,
        statsMode: STATS_MODE,
        acceptanceMode: ACCEPTANCE_MODE,
        candidateIndexCompared: COMPARE_CANDIDATE_INDEX,
        runsPerArm: RUNS,
        runOrder,
        fixtureSeed: seed,
        fixtureSeedSha256: createHash('sha256').update(seed).digest('hex'),
        existingIndexLegacyMedianMs: bLegacyMedianMs,
        existingIndexKeysetMedianMs: bKeysetMedianMs,
        existingIndexMedianRatio: medianRatio,
        candidateIndexLegacyMedianMs: COMPARE_CANDIDATE_INDEX ? median(timings.C.legacyMs) : undefined,
        candidateIndexKeysetMedianMs: COMPARE_CANDIDATE_INDEX ? median(timings.C.keysetMs) : undefined,
        stageInsertMsByIndex: { B: timings.B.stageInsertMs, C: COMPARE_CANDIDATE_INDEX ? timings.C.stageInsertMs : undefined },
        fixtureSetupMsByIndex: { B: timings.B.fixtureSetupMs, C: COMPARE_CANDIDATE_INDEX ? timings.C.fixtureSetupMs : undefined },
        splitterMsByIndex: {
          A_legacy: timings.B.legacyMs,
          B_keyset: timings.B.keysetMs,
          C_legacy: COMPARE_CANDIDATE_INDEX ? timings.C.legacyMs : undefined,
          C_keyset: COMPARE_CANDIDATE_INDEX ? timings.C.keysetMs : undefined
        },
        serverMetadata,
        tableDefinition: tableDefinition[0]?.['Create Table'],
        indexDefinitions: observedIndexes
      })
    );
    if (ACCEPTANCE_MODE) expect(medianRatio).toBeLessThanOrEqual(0.5);
    expect(finalMembershipReference).toHaveLength(ROWS + HISTORY_ROWS);
    expect(stagedReference).toHaveLength(ROWS + HISTORY_ROWS);
  }, 7_200_000);
});
