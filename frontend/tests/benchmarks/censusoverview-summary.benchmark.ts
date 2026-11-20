/**
 * Census Overview summary benchmark (#557; opt-in, never part of test:integration).
 *
 * Seeds two censuses of CENSUSOVERVIEW_BENCH_ROWS measurements each (default 500,000; each row has its own tree and
 * stem), settles InnoDB, then times the summary route's GET handler (one warm-up, five measured calls) and
 * checkFinishedCensus (one warm-up, three measured calls). Prints the server version, the buffer-pool size, the
 * settle readings, EXPLAIN FORMAT=TREE of every snapshot statement, and one CENSUSOVERVIEW_BENCH_SUMMARY {json} line
 * with medians. It drives only APIs that exist at 3eeddfe5, so the same file measures base and branch.
 * CENSUSOVERVIEW_BENCH_EXPLAIN_ANALYZE=1 adds EXPLAIN ANALYZE of every snapshot statement.
 *
 * Usage (AC power, no other Docker workload, no other suite on the local MySQL):
 *   cd frontend && CENSUSOVERVIEW_BENCH_LABEL=branch caffeinate -dimsu npm run bench:censusoverview-summary
 *
 * Requires: local MySQL via docker compose (port 3306, root/testpassword)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { type Connection, type RowDataPacket } from 'mysql2/promise';
import { checkFinishedCensus } from '@/lib/ctfs-export';
import { CENSUS_OVERVIEW_ERROR_CENSUS_IDS_PARAM, type CensusOverviewSummary } from '@/config/censusoverview';
import { HTTPResponses } from '@/config/macros';
import { loadSchema } from '../setup/local-db-setup';
import { loadAppDbSeed } from '../fixtures/ctfs-export/load-app-db-seed';
import {
  acquireBenchSchemaOwnership,
  assertLocalHostsOrRefuse,
  assertNoOtherActiveSession,
  createBenchmarkDatabase,
  createBenchmarkSchemaSession,
  freezeTableStatistics,
  killDropAndClose,
  median,
  openRawConnection,
  readSecondaryIndexes,
  roundedMs,
  sha256,
  waitForSettledInnoDb
} from './lib/benchmarkharness';

const ROWS_ENV = 'CENSUSOVERVIEW_BENCH_ROWS';
const LABEL_ENV = 'CENSUSOVERVIEW_BENCH_LABEL';
// Set to 1 to also run EXPLAIN ANALYZE of every snapshot statement (spec Benchmark §5: the response to a missed bar).
const EXPLAIN_ANALYZE_ENV = 'CENSUSOVERVIEW_BENCH_EXPLAIN_ANALYZE';
const EXPLAIN_ANALYZE_ENABLED = '1';
const DEFAULT_ROWS_PER_CENSUS = 500_000;
const DEFAULT_LABEL = 'unlabelled';
const CENSUSOVERVIEW_BENCH_SETUP_HOOK_TIMEOUT_MS = 120_000;
const CENSUSOVERVIEW_BENCH_TEST_TIMEOUT_MS = 45 * 60 * 1000;
const CENSUSOVERVIEW_BENCH_TEARDOWN_HOOK_TIMEOUT_MS = 5 * 60 * 1000;
// Fixed, not per-process: a run killed before afterAll leaves the schema behind, and the next run's setup drops it.
const SCHEMA = 'forestgeo_bench_censusoverview';
// MySQL advisory lock names are server-wide and at most 64 characters. Holding it is what entitles a run to drop SCHEMA.
const SCHEMA_OWNER_LOCK_NAME = 'forestgeo_bench_censusoverview_schema_owner';
const BENCH_USER_EMAIL = 'benchmark-runner@forestgeo.test';
const SUMMARY_ROUTE_PATH = '/api/censusoverview/summary';
const SUMMARY_LINE_PREFIX = 'CENSUSOVERVIEW_BENCH_SUMMARY';
const LOG_PREFIX = '[#557 bench]';
const REPEATABLE_READ_STATEMENT = 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ';
const SQL_PREVIEW_LENGTH = 100;

// Seed shape (spec Benchmark §2). Census 1 is app-db-seed's; census 2 is the one measured. Both get the same rows.
const PLOT_ID = 1;
const DECOY_CENSUS_ID = 1;
const MEASURED_CENSUS_ID = 2;
const MEASURED_PLOT_CENSUS_NUMBER = 2;
const CENSUS_IDS = [DECOY_CENSUS_ID, MEASURED_CENSUS_ID] as const;
const FIRST_GENERATED_ID = 1000; // generated IDs sit above app-db-seed's
const QUADRAT_COUNT = 1_250;
const SPECIES_COUNT = 300;
const SEED_GENUS_ID = 1;
const ACTIVE_ATTRIBUTE_CODE = 'LI';
const UNVALIDATED_EVERY = 20;
const FAILED_EVERY = 100; // a multiple of UNVALIDATED_EVERY: every failed row is also unvalidated
const UNRESOLVED_ERROR_EVERY = 25;
const UNVALIDATED_AND_UNRESOLVED_ERROR_EVERY = 100; // lcm(UNVALIDATED_EVERY, UNRESOLVED_ERROR_EVERY)
const ERROR_TYPE_COUNT = 20;
const QUADRAT_NAME_PREFIX = 'BQ';
const SPECIES_CODE_PREFIX = 'BS';
const ERROR_CODE_PREFIX = 'BENCH_';
const TREE_TAG_PREFIX = 'T';
// The numbers table holds rowsPerCensus rows and also seeds the quadrats, species and error types, so it must reach
// the largest of them; otherwise stems would point at quadrats that were never created.
const MIN_ROWS_PER_CENSUS = Math.max(QUADRAT_COUNT, SPECIES_COUNT, ERROR_TYPE_COUNT);
const FIRST_ERROR_ID = 9001;
const MEASUREMENT_DATE = '2024-06-03';
const CENSUS_START = '2025-01-01';
const CENSUS_END = '2025-12-31';
const HOM = 1.3;
const DBH_BASE = 10;
const DBH_SPREAD = 900;
const DBH_DIVISOR = 10;
const LOCAL_COORDINATE_SPAN = 20;
const QUADRAT_SIDE = 20;
const SEEDED_TABLES = ['quadrats', 'species', 'trees', 'stems', 'coremeasurements', 'cmattributes', 'measurement_error_log', 'measurementssummary'] as const;

const SETTLE_CONSECUTIVE_POLLS = 3;

const WARM_UP_CALLS = 1;
const MEASURED_ROUTE_CALLS = 5;
const MEASURED_GATE_CALLS = 3;

type StatementClass = 'isolation-level' | 'census-check' | 'related-rows-check' | 'exported-with-unresolved' | 'errors-scope-active' | 'measurement-graph';
const MEASUREMENT_GRAPH_CLASS: StatementClass = 'measurement-graph';
// Identical rules on base and branch. Whatever matches none of them walks the measurement graph: on base checks 6
// and 7, check 8's two counts and the skip reasons; on the branch the single pass.
const STATEMENT_CLASS_RULES: readonly { statementClass: StatementClass; pattern: RegExp }[] = [
  { statementClass: 'isolation-level', pattern: /^SET TRANSACTION/ },
  { statementClass: 'census-check', pattern: /^SELECT CensusID FROM/ },
  { statementClass: 'related-rows-check', pattern: /JOIN `[^`]+`\.(measurement_error_log mel|cmattributes cma) ON/ },
  { statementClass: 'exported-with-unresolved', pattern: /COUNT\(DISTINCT mel\.MeasurementID\)/ },
  { statementClass: 'errors-scope-active', pattern: /cm\.CensusID IN \(/ }
];

interface CapturedStatement {
  sql: string;
  params: unknown[];
  ms: number;
}
interface SnapshotCapture {
  statements: CapturedStatement[];
  firstQueryAt: number | null;
  releasedAt: number | null;
}
interface RouteCallTiming {
  wallMs: number;
  holdMs: number;
  statements: CapturedStatement[];
  body: CensusOverviewSummary;
}
const shared = vi.hoisted(() => ({
  facetsConnection: null as Connection | null,
  capture: { statements: [], firstQueryAt: null, releasedAt: null } as SnapshotCapture
}));
const mocks = vi.hoisted(() => ({ getConn: vi.fn() }));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: BENCH_USER_EMAIL, userStatus: 'global', sites: [] } }))
}));
vi.mock('@/lib/db/primitives', () => ({ getConn: mocks.getConn }));
vi.mock('@/lib/db/connectionmanager', async () => {
  const { runQueryDispatch } = await vi.importActual<typeof import('../setup/runquerydispatch')>('../setup/runquerydispatch');
  const manager = {
    executeQuery: async (query: string, params?: unknown[]) => {
      if (!shared.facetsConnection) throw new Error('Benchmark facets connection not initialized');
      return runQueryDispatch(shared.facetsConnection, query, params);
    },
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});
vi.mock('@/ailogger', () => ({ default: { info: () => undefined, warn: () => undefined, error: () => undefined } }));

const session = createBenchmarkSchemaSession({ schema: SCHEMA, lockName: SCHEMA_OWNER_LOCK_NAME, logPrefix: LOG_PREFIX });
let workConnection: Connection;
let snapshotConnection: Connection;
let gateConnection: Connection;

function benchRowsPerCensus(): number {
  const raw = process.env[ROWS_ENV];
  if (raw === undefined) return DEFAULT_ROWS_PER_CENSUS;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_ROWS_PER_CENSUS || parsed % FAILED_EVERY !== 0 || parsed % UNVALIDATED_AND_UNRESOLVED_ERROR_EVERY !== 0) {
    throw new Error(
      `${ROWS_ENV} must be a multiple of ${FAILED_EVERY} and ${UNVALIDATED_AND_UNRESOLVED_ERROR_EVERY} and at least ${MIN_ROWS_PER_CENSUS}; received '${raw}'`
    );
  }
  return parsed;
}

async function seedBenchmarkCensuses(conn: Connection, rowsPerCensus: number): Promise<void> {
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await conn.query(
      `INSERT INTO census (CensusID, PlotID, PlotCensusNumber, StartDate, EndDate, Description, IsActive) VALUES (?, ?, ?, ?, ?, 'Benchmark census', 1)`,
      [MEASURED_CENSUS_ID, PLOT_ID, MEASURED_PLOT_CENSUS_NUMBER, CENSUS_START, CENSUS_END]
    );
    await conn.query('CREATE TABLE bench_numbers (n INT NOT NULL PRIMARY KEY)');
    await conn.query('SET SESSION cte_max_recursion_depth = ?', [rowsPerCensus + 1]);
    await conn.query('INSERT INTO bench_numbers (n) WITH RECURSIVE seq (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?) SELECT n FROM seq', [
      rowsPerCensus
    ]);
    await conn.query(
      `INSERT INTO quadrats (QuadratID, PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, IsActive)
       SELECT ? + n, ?, CONCAT(?, n), n * ?, 0, ?, ?, ? * ?, 1 FROM bench_numbers WHERE n <= ?`,
      [FIRST_GENERATED_ID, PLOT_ID, QUADRAT_NAME_PREFIX, QUADRAT_SIDE, QUADRAT_SIDE, QUADRAT_SIDE, QUADRAT_SIDE, QUADRAT_SIDE, QUADRAT_COUNT]
    );
    await conn.query(
      `INSERT INTO species (SpeciesID, GenusID, SpeciesCode, SpeciesName, IDLevel, IsActive)
       SELECT ? + n, ?, CONCAT(?, n), CONCAT('bench ', n), 'species', 1 FROM bench_numbers WHERE n <= ?`,
      [FIRST_GENERATED_ID, SEED_GENUS_ID, SPECIES_CODE_PREFIX, SPECIES_COUNT]
    );
    await conn.query(
      `INSERT INTO measurement_errors (ErrorID, ErrorSource, ErrorCode, ErrorMessage) SELECT ? + n - 1, 'validation', CONCAT(?, n), CONCAT('Benchmark error ', n) FROM bench_numbers WHERE n <= ?`,
      [FIRST_ERROR_ID, ERROR_CODE_PREFIX, ERROR_TYPE_COUNT]
    );
    for (const [censusIndex, censusId] of CENSUS_IDS.entries()) {
      const firstId = FIRST_GENERATED_ID + censusIndex * rowsPerCensus;
      await conn.query(
        `INSERT INTO trees (TreeID, TreeTag, SpeciesID, CensusID, IsActive)
         SELECT ? + n, CONCAT(?, ? + n), ? + MOD(n, ?) + 1, ?, 1 FROM bench_numbers`,
        [firstId, TREE_TAG_PREFIX, firstId, FIRST_GENERATED_ID, SPECIES_COUNT, censusId]
      );
      await conn.query(
        `INSERT INTO stems (StemGUID, TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
         SELECT ? + n, ? + n, ? + MOD(n, ?) + 1, ?, '1', MOD(n, ?), MOD(n DIV ?, ?), 1 FROM bench_numbers`,
        [firstId, firstId, FIRST_GENERATED_ID, QUADRAT_COUNT, censusId, LOCAL_COORDINATE_SPAN, LOCAL_COORDINATE_SPAN, LOCAL_COORDINATE_SPAN]
      );
      await conn.query(
        `INSERT INTO coremeasurements (CoreMeasurementID, CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, IsActive)
         SELECT ? + n, ?, IF(MOD(n, ?) = 0, NULL, ? + n), MOD(n, ?) <> 0, ?, ? + MOD(n, ?) / ?, ?, 1 FROM bench_numbers`,
        [firstId, censusId, FAILED_EVERY, firstId, UNVALIDATED_EVERY, MEASUREMENT_DATE, DBH_BASE, DBH_SPREAD, DBH_DIVISOR, HOM]
      );
      await conn.query(`INSERT INTO cmattributes (CoreMeasurementID, Code) SELECT ? + n, ? FROM bench_numbers`, [firstId, ACTIVE_ATTRIBUTE_CODE]);
      await conn.query(
        `INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
         SELECT ? + n, ? + MOD(n DIV ?, ?), 0 FROM bench_numbers WHERE MOD(n, ?) = 0`,
        [firstId, FIRST_ERROR_ID, UNRESOLVED_ERROR_EVERY, ERROR_TYPE_COUNT, UNRESOLVED_ERROR_EVERY]
      );
      await conn.query(
        `INSERT INTO measurementssummary
           (CoreMeasurementID, StemGUID, TreeID, SpeciesID, QuadratID, PlotID, CensusID, SpeciesCode, TreeTag, StemTag, QuadratName,
            MeasurementDate, MeasuredDBH, MeasuredHOM, IsValidated)
         SELECT cm.CoreMeasurementID, cm.StemGUID, t.TreeID, t.SpeciesID, s.QuadratID, ?, cm.CensusID, sp.SpeciesCode, t.TreeTag, s.StemTag,
                q.QuadratName, cm.MeasurementDate, cm.MeasuredDBH, cm.MeasuredHOM, cm.IsValidated
           FROM coremeasurements cm
           JOIN stems s ON s.StemGUID = cm.CoreMeasurementID
           JOIN trees t ON t.TreeID = s.TreeID
           JOIN quadrats q ON q.QuadratID = s.QuadratID
           JOIN species sp ON sp.SpeciesID = t.SpeciesID
          WHERE cm.CensusID = ? AND cm.CoreMeasurementID > ?`,
        [PLOT_ID, censusId, FIRST_GENERATED_ID]
      );
    }
    await conn.query('DROP TABLE bench_numbers');
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

function buildTimedSnapshotConnection(real: Connection) {
  return {
    query: async (sql: string, params?: unknown[]) => {
      const startedAt = performance.now();
      shared.capture.firstQueryAt ??= startedAt;
      try {
        return await real.query(sql, params);
      } finally {
        shared.capture.statements.push({ sql, params: params ?? [], ms: performance.now() - startedAt });
      }
    },
    beginTransaction: () => real.beginTransaction(),
    rollback: () => real.rollback(),
    release: () => {
      shared.capture.releasedAt = performance.now();
    },
    destroy: () => real.destroy()
  };
}

function classifyStatement(sql: string): StatementClass {
  return STATEMENT_CLASS_RULES.find(rule => rule.pattern.test(sql))?.statementClass ?? MEASUREMENT_GRAPH_CLASS;
}

function msByClass(statements: readonly CapturedStatement[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const statement of statements) {
    const statementClass = classifyStatement(statement.sql);
    totals[statementClass] = (totals[statementClass] ?? 0) + statement.ms;
  }
  return totals;
}

async function callSummaryRouteTimed(): Promise<RouteCallTiming> {
  shared.capture = { statements: [], firstQueryAt: null, releasedAt: null };
  const { GET } = await import('@/app/api/censusoverview/summary/[schema]/[plotID]/[censusID]/route');
  const query = new URLSearchParams({ [CENSUS_OVERVIEW_ERROR_CENSUS_IDS_PARAM]: String(MEASURED_CENSUS_ID) }).toString();
  const startedAt = performance.now();
  const response = await GET(new NextRequest(`http://localhost${SUMMARY_ROUTE_PATH}/${SCHEMA}/${PLOT_ID}/${MEASURED_CENSUS_ID}?${query}`), {
    params: Promise.resolve({ schema: SCHEMA, plotID: String(PLOT_ID), censusID: String(MEASURED_CENSUS_ID) })
  });
  const wallMs = performance.now() - startedAt;
  const body = (await response.json()) as CensusOverviewSummary;
  expect(response.status, `summary route failed: ${JSON.stringify(body)}`).toBe(HTTPResponses.OK);
  const { firstQueryAt, releasedAt, statements } = shared.capture;
  if (firstQueryAt === null || releasedAt === null) throw new Error('The snapshot never ran a query or never released its connection');
  return { wallMs, holdMs: releasedAt - firstQueryAt, statements, body };
}

// As the CTFS export route runs it: inside a REPEATABLE READ transaction.
async function timeCheckFinishedCensus(): Promise<number> {
  await gateConnection.query(REPEATABLE_READ_STATEMENT);
  await gateConnection.beginTransaction();
  try {
    const startedAt = performance.now();
    const result = await checkFinishedCensus(gateConnection, { schema: SCHEMA, plotId: PLOT_ID, censusId: MEASURED_CENSUS_ID });
    const elapsedMs = performance.now() - startedAt;
    console.log(`${LOG_PREFIX} checkFinishedCensus ${roundedMs(elapsedMs)} ms -> ok=${result.ok} count=${result.count}/${result.totalActiveCount}`);
    return elapsedMs;
  } finally {
    await gateConnection.rollback();
  }
}

async function printExplainPlans(statements: readonly CapturedStatement[]): Promise<void> {
  for (const statement of statements) {
    const statementClass = classifyStatement(statement.sql);
    if (statementClass === 'isolation-level') continue;
    const [rows] = await gateConnection.query<RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${statement.sql}`, statement.params);
    console.log(`${LOG_PREFIX} EXPLAIN class=${statementClass}\n${statement.sql}\n${String(rows[0].EXPLAIN)}`);
    if (process.env[EXPLAIN_ANALYZE_ENV] === EXPLAIN_ANALYZE_ENABLED) {
      const [analyzed] = await gateConnection.query<RowDataPacket[]>(`EXPLAIN ANALYZE ${statement.sql}`, statement.params);
      console.log(`${LOG_PREFIX} EXPLAIN ANALYZE class=${statementClass}\n${String(analyzed[0].EXPLAIN)}`);
    }
  }
}

function expectedExportPreview(rowsPerCensus: number): CensusOverviewSummary['exportPreview'] {
  const unvalidatedRows = rowsPerCensus / UNVALIDATED_EVERY;
  const failedRows = rowsPerCensus / FAILED_EVERY;
  const unresolvedErrorRows = rowsPerCensus / UNRESOLVED_ERROR_EVERY;
  const unvalidatedErrorRows = rowsPerCensus / UNVALIDATED_AND_UNRESOLVED_ERROR_EVERY;
  return {
    totalActiveMeasurements: rowsPerCensus,
    exportableCount: rowsPerCensus - unvalidatedRows,
    skippedCount: unvalidatedRows,
    skipReasons: [
      { kind: 'not-validated', count: unvalidatedRows },
      { kind: 'no-stem-guid', count: failedRows },
      { kind: 'inactive-stem-or-tree', count: 0 },
      { kind: 'missing-link', count: 0 },
      { kind: 'other', count: 0 }
    ],
    exportedWithUnresolvedErrorCount: unresolvedErrorRows - unvalidatedErrorRows
  };
}

describe('census overview summary benchmark (opt-in, real local MySQL)', () => {
  beforeAll(async () => {
    assertLocalHostsOrRefuse();
    await acquireBenchSchemaOwnership(session);
    await createBenchmarkDatabase(session);
    workConnection = await openRawConnection(session);
    snapshotConnection = await openRawConnection(session);
    gateConnection = await openRawConnection(session);
    shared.facetsConnection = await openRawConnection(session);
    await assertNoOtherActiveSession(session, session.setupConnection as Connection);
  }, CENSUSOVERVIEW_BENCH_SETUP_HOOK_TIMEOUT_MS);

  // Runs after a pass, a failure or a timeout. vitest abandons a timed-out test without waiting for its statement,
  // so this kills the harness's other sessions first: a running statement would hold a metadata lock against DROP.
  afterAll(async () => {
    shared.facetsConnection = null;
    await killDropAndClose(session);
  }, CENSUSOVERVIEW_BENCH_TEARDOWN_HOOK_TIMEOUT_MS);

  it(
    'times the summary snapshot and the publish gate on a settled schema',
    async () => {
      const conn = workConnection;
      const rowsPerCensus = benchRowsPerCensus();
      const label = process.env[LABEL_ENV] ?? DEFAULT_LABEL;

      const seedStartedAt = performance.now();
      await conn.query('SET SESSION sql_log_bin = 0');
      await loadSchema(conn);
      await loadAppDbSeed(conn);
      await seedBenchmarkCensuses(conn, rowsPerCensus);
      console.log(`${LOG_PREFIX} seeded ${rowsPerCensus} rows per census in ${roundedMs(performance.now() - seedStartedAt)} ms`);

      await readSecondaryIndexes(conn, SEEDED_TABLES);
      await freezeTableStatistics(conn);
      const settleReadings = await waitForSettledInnoDb(conn, LOG_PREFIX);
      await assertNoOtherActiveSession(session, session.setupConnection as Connection);

      const [[server]] = await conn.query<RowDataPacket[]>('SELECT VERSION() AS version, @@innodb_buffer_pool_size AS bufferPoolBytes');
      console.log(`${LOG_PREFIX} server ${server.version}, buffer pool ${server.bufferPoolBytes} bytes`);

      mocks.getConn.mockImplementation(async () => buildTimedSnapshotConnection(snapshotConnection));
      for (let call = 0; call < WARM_UP_CALLS; call++) await callSummaryRouteTimed();
      const routeCalls: RouteCallTiming[] = [];
      for (let call = 0; call < MEASURED_ROUTE_CALLS; call++) {
        const timing = await callSummaryRouteTimed();
        console.log(
          `${LOG_PREFIX} route call ${call + 1}: wall ${roundedMs(timing.wallMs)} ms, snapshot hold ${roundedMs(timing.holdMs)} ms, ` +
            `statements ${JSON.stringify(timing.statements.map(statement => ({ class: classifyStatement(statement.sql), ms: roundedMs(statement.ms) })))}`
        );
        routeCalls.push(timing);
      }

      for (let call = 0; call < WARM_UP_CALLS; call++) await timeCheckFinishedCensus();
      const gateMs: number[] = [];
      for (let call = 0; call < MEASURED_GATE_CALLS; call++) gateMs.push(await timeCheckFinishedCensus());

      const lastCall = routeCalls[routeCalls.length - 1];
      await printExplainPlans(lastCall.statements);

      const classTotalsPerCall = routeCalls.map(call => msByClass(call.statements));
      const classes = [...new Set(classTotalsPerCall.flatMap(totals => Object.keys(totals)))];
      const summary = {
        label,
        rowsPerCensus,
        serverVersion: String(server.version),
        bufferPoolBytes: Number(server.bufferPoolBytes),
        settle: settleReadings.slice(-SETTLE_CONSECUTIVE_POLLS),
        routeWallMs: roundedMs(median(routeCalls.map(call => call.wallMs))),
        snapshotHoldMs: roundedMs(median(routeCalls.map(call => call.holdMs))),
        classMs: Object.fromEntries(
          classes.map(statementClass => [statementClass, roundedMs(median(classTotalsPerCall.map(totals => totals[statementClass] ?? 0)))])
        ),
        statements: lastCall.statements.map((statement, index) => ({
          class: classifyStatement(statement.sql),
          medianMs: roundedMs(median(routeCalls.map(call => call.statements[index]?.ms ?? 0))),
          sql: statement.sql.replace(/\s+/g, ' ').slice(0, SQL_PREVIEW_LENGTH)
        })),
        checkFinishedCensusMs: roundedMs(median(gateMs)),
        bodySha256: sha256(lastCall.body),
        runs: {
          routeWallMs: routeCalls.map(call => roundedMs(call.wallMs)),
          snapshotHoldMs: routeCalls.map(call => roundedMs(call.holdMs)),
          measurementGraphMs: classTotalsPerCall.map(totals => roundedMs(totals[MEASUREMENT_GRAPH_CLASS] ?? 0)),
          checkFinishedCensusMs: gateMs.map(roundedMs)
        }
      };
      console.log(`${SUMMARY_LINE_PREFIX} ${JSON.stringify(summary)}`);

      for (const call of routeCalls) {
        expect(call.body.exportPreview, 'export preview worked out from the seed').toEqual(expectedExportPreview(rowsPerCensus));
        expect(call.body.blockers, 'the seed has no blockers').toEqual([]);
        expect(call.body.errorOverview.totalActiveMeasurements, 'errors-scope active rows').toBe(rowsPerCensus);
      }
      expect(new Set(routeCalls.map(call => sha256(call.body))).size, 'every measured call returns the same body').toBe(1);
    },
    CENSUSOVERVIEW_BENCH_TEST_TIMEOUT_MS
  );
});
