import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import mysql, { type Connection, type Pool, type RowDataPacket } from 'mysql2/promise';
import { DEFAULT_ERROR_EXPLORER_FILTERS, ERROR_EXPLORER_PRESETS, type ErrorExplorerFilters } from '@/config/errorsexplorer';
import * as current from '@/app/api/errors/explorer/_shared';
import { mergeSignatureRows } from '@/app/api/errors/explorer/errorsetcounts';
import { ERROR_EXPLORER_STATEMENT_LABELS, type ErrorSignatureRow } from '@/app/api/errors/explorer/errorsetsql';
import * as oracle from '../oracles/errors-explorer-legacy';
import { classifyStatement, describeCensusScope, lastPageNumber, pastTheEndPageNumber, UNLABELLED_STATEMENT } from '../setup/errorsetstatements';
import { EQUIVALENCE_GROUP_CONCAT_MAX_LEN } from '../integration/helpers/errorsexplorerfixtures';
import { DEFAULT_TEST_CONFIG, loadSchema } from '../setup/local-db-setup';
import { runQueryDispatch } from '../setup/runquerydispatch';
import {
  acquireBenchSchemaOwnership,
  assertLocalHostsOrRefuse,
  assertNoOtherActiveSession,
  CONNECTION_CHARSET,
  createBenchmarkDatabase,
  createBenchmarkSchemaSession,
  freezeTableStatistics,
  killDropAndClose,
  median,
  openRawConnection,
  readSecondaryIndexes,
  sha256,
  waitForSettledInnoDb
} from './lib/benchmarkharness';
import { runMembershipProbe, type MembershipProbeRow } from './lib/membershipprobe';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/ailogger', () => ({ default: { info: () => undefined, warn: () => undefined, error: () => undefined } }));

const SCHEMA = 'forestgeo_bench_errors_explorer';
const SCHEMA_OWNER_LOCK_NAME = 'forestgeo_bench_errors_explorer_schema_owner';
const LOG_PREFIX = '[#544 bench]';
const SUMMARY_LINE_PREFIX = 'ERRORS_EXPLORER_BENCH_SUMMARY';
const ROWS_ENV = 'ERRORS_EXPLORER_BENCH_ROWS';
const PROFILE_ENV = 'ERRORS_EXPLORER_BENCH_PROFILE';
const STATS_ENV = 'ERRORS_EXPLORER_BENCH_STATS';
const ARMS_ENV = 'ERRORS_EXPLORER_BENCH_ARMS';
const LABEL_ENV = 'ERRORS_EXPLORER_BENCH_LABEL';
const DEFAULT_ROWS = 466_500;
const MIN_ROWS = 10_000;
const ROW_MULTIPLE = 500;
const POOL_SIZE = 4;
const PAGE_SIZE = 25;
const WARM_UP_CALLS = 1;
const MEASURED_CALLS = 5;
const STATEMENT_TEXT_LIMIT = 9;
const HISTOGRAM_WITH_FLAGS_LABEL = ERROR_EXPLORER_STATEMENT_LABELS.histogramWithFlags;
const HISTOGRAM_WITHOUT_FLAGS_LABEL = ERROR_EXPLORER_STATEMENT_LABELS.histogramWithoutFlags;
const ORACLE_DUPLICATE_GROUPS_CLASS = 'duplicate-groups';
const ORACLE_SAME_BATCH_GROUPS_CLASS = 'same-batch-groups';
const MEASURED_PLOT_ID = 1;
const MEASURED_CENSUS_IDS = [2];
const TEST_TIMEOUT_MS = 45 * 60 * 1000;
const HOOK_TIMEOUT_MS = 5 * 60 * 1000;
const SEEDED_TABLES = ['census', 'sitespecificvalidations', 'measurement_errors', 'coremeasurements', 'measurementssummary', 'measurement_error_log'];
const PREDICTIONS = `At typical/settled, from #557's 500k numbers and the plans in Evidence:

| Scenario | Today (predicted) | New (predicted) | Falsified if new is |
|---|---|---|---|
| \`details\` | 2–4 s (full rebuild) | ≤ 0.1 s | > 0.25 s |
| \`query\` page 0 | 2–4 s | 0.3–1.0 s | > 0.5 × today |
| \`facets\` | 2–4 s | 0.3–1.0 s | > 0.5 × today |
| page load (query ∥ facets) | 3–6 s | 0.5–1.5 s | > 0.5 × today |
| \`messageCounts\` | 1.3–2.3 s | 0.2–0.8 s | > 0.8 × today |
| \`query\` with quick search | 2–4 s | 1.5–3.5 s | > today |
| rows into Node per \`query\` | ≈ 42,000 occurrences, ≈ 10 MB | ≤ 2,000 rows, ≤ 1 MB | above either bound |

At dense, new is predicted at 0.6–1.0 × today: the flags work grows with the error set.`;

class BenchmarkConfigError extends Error {}
function choice<T extends string>(name: string, values: readonly T[], fallback: T): T {
  const value = process.env[name] ?? fallback;
  if (!values.includes(value as T)) throw new BenchmarkConfigError(`${name} must be one of ${values.join(', ')}; received '${value}'`);
  return value as T;
}
function config() {
  const raw = process.env[ROWS_ENV] ?? String(DEFAULT_ROWS);
  const rows = Number(raw);
  if (!Number.isSafeInteger(rows) || rows < MIN_ROWS || rows % ROW_MULTIPLE !== 0)
    throw new BenchmarkConfigError(`${ROWS_ENV} must be a multiple of ${ROW_MULTIPLE} and at least ${MIN_ROWS}; received '${raw}'`);
  return {
    rows,
    profile: choice(PROFILE_ENV, ['typical', 'dense'] as const, 'typical'),
    stats: choice(STATS_ENV, ['settled', 'stale'] as const, 'settled'),
    arms: choice(ARMS_ENV, ['oracle-current', 'oracle-oracle'] as const, 'oracle-current'),
    label: process.env[LABEL_ENV] ?? 'unlabelled'
  };
}

type BenchStatement = {
  classification: string;
  sql: string;
  params: unknown[];
  ms: number;
  rows: number;
  jsonBytes: number;
  /** Kept for the signature histograms only, so their chunks can be merged. */
  histogramRows?: ErrorSignatureRow[];
};
type BenchCall = { wallMs: number; hash: string; statements: BenchStatement[] };
const isHistogram = (classification: string) => classification === HISTOGRAM_WITH_FLAGS_LABEL || classification === HISTOGRAM_WITHOUT_FLAGS_LABEL;

function distinctSignatureCount(statements: readonly BenchStatement[], classification: string): number | null {
  const chunks = statements.filter(statement => statement.classification === classification).map(statement => statement.histogramRows ?? []);
  return chunks.length > 0 ? mergeSignatureRows(chunks).length : null;
}
function statementP50Ms(calls: readonly BenchCall[], classification: string): number | null {
  const perCallMs = calls
    .map(call => call.statements.filter(statement => statement.classification === classification))
    .filter(matching => matching.length > 0)
    .map(matching => matching.reduce((sum, statement) => sum + statement.ms, 0));
  return perCallMs.length > 0 ? median(perCallMs) : null;
}
function difference(minuend: number | null, subtrahend: number | null): number | null {
  return minuend === null || subtrahend === null ? null : minuend - subtrahend;
}
function createBenchExecutor(pool: Pool) {
  const statements: BenchStatement[] = [];
  return {
    statements,
    executeQuery: async (sql: string, params: unknown[] = []) => {
      const started = performance.now();
      const rows = (await runQueryDispatch(pool, sql, params)) as unknown[];
      const classification = classifyStatement(sql);
      statements.push({
        classification,
        sql,
        params,
        ms: performance.now() - started,
        rows: rows.length,
        jsonBytes: Buffer.byteLength(JSON.stringify(rows)),
        ...(isHistogram(classification) && { histogramRows: rows as ErrorSignatureRow[] })
      });
      return rows;
    }
  };
}
type BenchExecutor = ReturnType<typeof createBenchExecutor>;
interface ExplorerArm {
  name: 'oracle' | 'current';
  queryErrorExplorer: typeof oracle.queryErrorExplorer;
  buildErrorExplorerFacets: typeof oracle.buildErrorExplorerFacets;
  buildErrorExplorerDetails: typeof oracle.buildErrorExplorerDetails;
  buildErrorMessageCounts: typeof oracle.buildErrorMessageCounts;
  exportRows: (executor: BenchExecutor, schema: string, plotID: number, censusIDs: number[], filters: ErrorExplorerFilters) => Promise<oracle.ErrorExportRow[]>;
}
const ORACLE_ARM: ExplorerArm = {
  name: 'oracle',
  queryErrorExplorer: oracle.queryErrorExplorer,
  buildErrorExplorerFacets: oracle.buildErrorExplorerFacets,
  buildErrorExplorerDetails: oracle.buildErrorExplorerDetails,
  buildErrorMessageCounts: oracle.buildErrorMessageCounts,
  exportRows: async (executor, schema, plotID, censusIDs, filters) =>
    oracle.buildErrorExportRows(await oracle.fetchGroupedErrorRows(executor, schema, plotID, censusIDs), filters)
};
const CURRENT_ARM: ExplorerArm = {
  name: 'current',
  queryErrorExplorer: (executor, request) => current.queryErrorExplorer(executor as unknown as Parameters<typeof current.queryErrorExplorer>[0], request),
  buildErrorExplorerFacets: (executor, request) =>
    current.buildErrorExplorerFacets(executor as unknown as Parameters<typeof current.buildErrorExplorerFacets>[0], request),
  buildErrorExplorerDetails: (executor, request, id, type) =>
    current.buildErrorExplorerDetails(executor as unknown as Parameters<typeof current.buildErrorExplorerDetails>[0], request, id, type),
  buildErrorMessageCounts: (executor, request) =>
    current.buildErrorMessageCounts(executor as unknown as Parameters<typeof current.buildErrorMessageCounts>[0], request),
  exportRows: async (executor, schema, plotID, censusIDs, filters) =>
    current.buildErrorExportRows(
      await current.fetchGroupedErrorRows(executor as unknown as Parameters<typeof current.fetchGroupedErrorRows>[0], schema, plotID, censusIDs),
      filters
    )
};

const poolThreadIds = new Set<number>();
const session = createBenchmarkSchemaSession({
  schema: SCHEMA,
  lockName: SCHEMA_OWNER_LOCK_NAME,
  logPrefix: LOG_PREFIX,
  extraThreadIds: () => [...poolThreadIds]
});
let work: Connection;
let pool: Pool | undefined;

async function seed(conn: Connection, options: ReturnType<typeof config>) {
  await loadSchema(conn);
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  await conn.query('SET SESSION sql_log_bin = 0');
  try {
    if (options.stats === 'stale') await freezeTableStatistics(conn);
    await conn.query('CREATE TABLE bench_numbers (n INT NOT NULL PRIMARY KEY)');
    await conn.query('SET SESSION cte_max_recursion_depth = ?', [options.rows + 1]);
    await conn.query('INSERT INTO bench_numbers (n) WITH RECURSIVE seq (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?) SELECT n FROM seq', [
      options.rows
    ]);
    await conn.query('INSERT INTO census (CensusID, PlotID, PlotCensusNumber) SELECT n, 1, n FROM bench_numbers WHERE n <= 2');
    await conn.query('DELETE FROM measurement_errors');
    await conn.query(`INSERT INTO measurement_errors (ErrorID, ErrorSource, ErrorCode, ErrorMessage)
      SELECT n, IF(n <= 20, 'validation', 'ingestion'), IF(n <= 20, CAST(n AS CHAR), CONCAT('BENCH_INGESTION_', n)), CONCAT('Benchmark error ', n) FROM bench_numbers WHERE n <= 30`);
    await conn.query(`INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria)
      SELECT n, CONCAT('BenchValidation', n), CASE WHEN n IN (3, 4) THEN 'Shared benchmark message' WHEN n = 5 THEN 'First condition; second condition' ELSE CONCAT('Benchmark validation ', n) END,
      CASE WHEN n = 6 THEN 'treeTag;stemTag' WHEN n = 7 THEN '' ELSE 'measuredDBH' END FROM bench_numbers WHERE n <= 20`);
    for (const census of [1, 2]) {
      const base = census === 1 ? 0 : 1_000_000;
      const step = options.profile === 'typical' ? 25 : 10;
      const invalid = options.profile === 'typical' ? 20 : 2;
      await conn.query(
        `INSERT INTO coremeasurements (CoreMeasurementID, CensusID, StemGUID, IsValidated, MeasurementDate, UploadFileID, UploadBatchID, IsActive)
        SELECT ? + n, ?, IF(MOD(n,100)=0,NULL,?+n), IF(?=1, MOD(n,10)<>0, NOT (MOD(n,?)=0 AND MOD(n,?)<>0)), IF(MOD(n,100)=50,NULL,DATE_ADD('2024-06-01', INTERVAL MOD(n,30) DAY)), IF(?=2,'bench-file',NULL), IF(?=2,CONCAT('batch-',FLOOR((n-1)/10000)),NULL), 1 FROM bench_numbers`,
        [base, census, base, census, invalid, step, census, census]
      );
      await conn.query(
        `INSERT INTO measurementssummary (CoreMeasurementID, StemGUID, PlotID, CensusID, SpeciesCode, TreeTag, StemTag, QuadratName, MeasurementDate, IsValidated)
        SELECT ?+n, ?+n, 1, ?, CONCAT('SP',MOD(n,300)), CONCAT('T',n), '1', CONCAT('Q',MOD(n,1250)), IF(MOD(n,100)=50,NULL,DATE_ADD('2024-06-01',INTERVAL MOD(n,30) DAY)), IF(?=1,MOD(n,10)<>0,NOT (MOD(n,?)=0 AND MOD(n,?)<>0)) FROM bench_numbers`,
        [base, base, census, census, invalid, step]
      );
      if (census === 1) {
        await conn.query(
          'INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) SELECT ?+n, 1+MOD(n,30), 0 FROM bench_numbers WHERE MOD(n,10)=0',
          [base]
        );
      } else {
        await conn.query(
          'INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) SELECT ?+n, 1+MOD(n DIV ?,30), 0 FROM bench_numbers WHERE MOD(n,?)=0',
          [base, step, step]
        );
        await conn.query(
          'INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) SELECT ?+n, 1+MOD(n DIV ?+7,30), 0 FROM bench_numbers WHERE MOD(n,?)=0',
          [base, step, options.profile === 'typical' ? 100 : 50]
        );
        await conn.query(
          'INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) SELECT ?+n, 1+MOD(n DIV 30,30), 1 FROM bench_numbers WHERE MOD(n,30)=0 AND MOD(n,?)<>0',
          [base, step]
        );
      }
      // Duplicate witnesses override all profile-derived error states for both members.
      await conn.query(
        `UPDATE measurementssummary ms JOIN bench_numbers b ON ms.CoreMeasurementID=?+b.n SET ms.TreeTag=CONCAT('T',b.n+1) WHERE MOD(b.n,1000)=1`,
        [base]
      );
      await conn.query(`DELETE mel FROM measurement_error_log mel JOIN bench_numbers b ON mel.MeasurementID=?+b.n WHERE MOD(b.n,1000) IN (1,2)`, [base]);
      await conn.query(`UPDATE measurementssummary ms JOIN bench_numbers b ON ms.CoreMeasurementID=?+b.n SET ms.IsValidated=1 WHERE MOD(b.n,1000) IN (1,2)`, [
        base
      ]);
      await conn.query(
        `UPDATE coremeasurements cm JOIN bench_numbers b ON cm.CoreMeasurementID=?+b.n SET cm.IsValidated=1, cm.IsActive=IF(MOD(b.n,1000)=2 AND MOD(b.n DIV 1000,4)=3,0,1) WHERE MOD(b.n,1000) IN (1,2)`,
        [base]
      );
      await conn.query(
        `INSERT INTO measurement_error_log (MeasurementID,ErrorID,IsResolved) SELECT ?+n,1,0 FROM bench_numbers WHERE (MOD(n,1000)=1 AND MOD(n DIV 1000,4) IN (0,1,3)) OR (MOD(n,1000)=2 AND MOD(n DIV 1000,4)=0)`,
        [base]
      );
      if (census === 2)
        await conn.query(
          `UPDATE measurementssummary ms JOIN bench_numbers b ON ms.CoreMeasurementID=?+b.n SET ms.TreeTag=CONCAT('T',b.n-1), ms.StemTag='2', ms.SpeciesCode=CONCAT('SPX',b.n) WHERE MOD(b.n,2000)=501`,
          [base]
        );
    }
    await conn.query('DROP TABLE bench_numbers');
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  }
  if (options.stats === 'settled') {
    await freezeTableStatistics(conn);
    await readSecondaryIndexes(conn, SEEDED_TABLES);
    await waitForSettledInnoDb(conn, LOG_PREFIX);
  }
  for (const census of [1, 2]) {
    const [[counts]] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT cm.CoreMeasurementID) AS measurements, COUNT(*) AS occurrences FROM coremeasurements cm JOIN measurementssummary ms ON ms.CoreMeasurementID=cm.CoreMeasurementID LEFT JOIN measurement_error_log mel ON mel.MeasurementID=cm.CoreMeasurementID AND mel.IsResolved=0 WHERE cm.CensusID=? AND cm.IsActive=1 AND (mel.MeasurementID IS NOT NULL OR ms.IsValidated=0)`,
      [census]
    );
    console.log(`${LOG_PREFIX} census ${census}: ${JSON.stringify(counts)}`);
  }
}

describe('errors explorer benchmark (opt-in, local MySQL)', () => {
  beforeAll(async () => {
    config();
    assertLocalHostsOrRefuse();
    await acquireBenchSchemaOwnership(session);
    await createBenchmarkDatabase(session);
    work = await openRawConnection(session);
    pool = mysql.createPool({ ...DEFAULT_TEST_CONFIG, database: SCHEMA, connectionLimit: POOL_SIZE, charset: CONNECTION_CHARSET, timezone: 'Z' });
    pool.pool.on('connection', connection => {
      poolThreadIds.add(connection.threadId);
      connection.query(`SET SESSION group_concat_max_len = ${EQUIVALENCE_GROUP_CONCAT_MAX_LEN}`);
    });
    const connections = await Promise.all(Array.from({ length: POOL_SIZE }, () => pool!.getConnection()));
    try {
      for (const connection of connections) {
        const [[row]] = await connection.query<RowDataPacket[]>('SELECT @@session.group_concat_max_len AS value');
        if (Number(row.value) !== EQUIVALENCE_GROUP_CONCAT_MAX_LEN) throw new Error(`Unexpected group_concat_max_len on thread ${connection.threadId}`);
      }
    } finally {
      connections.forEach(connection => connection.release());
    }
    await assertNoOtherActiveSession(session, session.setupConnection as Connection);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await killDropAndClose(session, pool ? () => pool!.end() : undefined);
  }, HOOK_TIMEOUT_MS);
  it(
    'compares every scenario in alternating arms',
    async () => {
      const options = config();
      const benchPool = pool;
      if (!benchPool || !session.setupConnection) throw new Error('Benchmark connections not initialized');
      console.log(`${LOG_PREFIX} ${PREDICTIONS}`);
      await seed(work, options);
      await assertNoOtherActiveSession(session, session.setupConnection as Connection);
      const [[server]] = await work.query<RowDataPacket[]>('SELECT VERSION() AS version, @@innodb_buffer_pool_size AS bufferPoolBytes');
      const request = {
        schema: SCHEMA,
        plotID: MEASURED_PLOT_ID,
        censusID: MEASURED_CENSUS_IDS[0],
        censusIDs: MEASURED_CENSUS_IDS,
        page: 0,
        pageSize: PAGE_SIZE,
        filters: DEFAULT_ERROR_EXPLORER_FILTERS
      };
      const censusScope = describeCensusScope(MEASURED_CENSUS_IDS);
      console.log(`${LOG_PREFIX} scope: ${censusScope.censuses} censuses, ${censusScope.censusChunks} census chunks`);
      const setupExecutor = createBenchExecutor(benchPool);
      const [page, facets] = await Promise.all([
        ORACLE_ARM.queryErrorExplorer(setupExecutor, request),
        ORACLE_ARM.buildErrorExplorerFacets(setupExecutor, request)
      ]);
      const first = page.rows[0];
      const contradiction = page.rows.find(row => row.hasContradiction);
      const message = facets.messages[0];
      if (!first?.treeTag || first.coreMeasurementID == null || !contradiction || contradiction.coreMeasurementID == null || !message)
        throw new Error('Benchmark seed did not produce the required first row, contradiction, and message');
      const firstID = first.coreMeasurementID;
      const contradictionID = contradiction.coreMeasurementID;
      const preset = (id: string): ErrorExplorerFilters => {
        const found = ERROR_EXPLORER_PRESETS.find(item => item.id === id);
        if (!found) throw new Error(`Missing benchmark preset ${id}`);
        return found.filters;
      };
      const contradictionFilters = preset('contradictions');
      const scenarios: Record<string, (arm: ExplorerArm, executor: BenchExecutor) => Promise<unknown>> = {
        pageLoad: (arm, executor) => Promise.all([arm.queryErrorExplorer(executor, request), arm.buildErrorExplorerFacets(executor, request)]),
        queryPage0: (arm, executor) => arm.queryErrorExplorer(executor, request),
        queryLastPage: (arm, executor) => arm.queryErrorExplorer(executor, { ...request, page: lastPageNumber(page.totalRows, PAGE_SIZE) }),
        queryPastTheEnd: (arm, executor) => arm.queryErrorExplorer(executor, { ...request, page: pastTheEndPageNumber(page.totalRows, PAGE_SIZE) }),
        queryValidationOnly: (arm, executor) => arm.queryErrorExplorer(executor, { ...request, filters: preset('validation_only') }),
        queryContradictions: (arm, executor) => arm.queryErrorExplorer(executor, { ...request, filters: contradictionFilters }),
        queryMostCommonMessage: (arm, executor) =>
          arm.queryErrorExplorer(executor, { ...request, filters: { ...request.filters, exactMessages: [message.value] } }),
        queryQuickSearch: (arm, executor) =>
          arm.queryErrorExplorer(executor, { ...request, filters: { ...request.filters, quickSearch: first.treeTag!.slice(0, 3) } }),
        facetsDefault: (arm, executor) => arm.buildErrorExplorerFacets(executor, request),
        facetsContradictions: (arm, executor) => arm.buildErrorExplorerFacets(executor, { ...request, filters: contradictionFilters }),
        detailsFirstRow: (arm, executor) => arm.buildErrorExplorerDetails(executor, request, firstID),
        detailsFirstContradictionRow: (arm, executor) => arm.buildErrorExplorerDetails(executor, request, contradictionID),
        messageCounts: (arm, executor) => arm.buildErrorMessageCounts(executor, request),
        exportDefault: (arm, executor) => arm.exportRows(executor, SCHEMA, MEASURED_PLOT_ID, MEASURED_CENSUS_IDS, request.filters)
      };
      const arms = [ORACLE_ARM, options.arms === 'oracle-oracle' ? ORACLE_ARM : CURRENT_ARM];
      const explained = new Set<string>();
      const results: Record<string, unknown> = {};
      const callsByScenario: Record<string, BenchCall[][]> = {};
      const resultRows: string[] = [];
      for (const [name, scenario] of Object.entries(scenarios)) {
        const calls: BenchCall[][] = [[], []];
        callsByScenario[name] = calls;
        for (let round = -WARM_UP_CALLS; round < MEASURED_CALLS; round++) {
          for (const [index, arm] of arms.entries()) {
            const executor = createBenchExecutor(benchPool);
            const started = performance.now();
            const response = await scenario(arm, executor);
            const call = { wallMs: performance.now() - started, hash: sha256(response), statements: executor.statements };
            console.log(
              `${LOG_PREFIX} ${name} ${round < 0 ? 'warmup' : `run ${round + 1}`} arm ${index + 1} (${arm.name}) ${JSON.stringify({ wallMs: call.wallMs, hash: call.hash, statements: call.statements.map(({ classification, ms, rows, jsonBytes }) => ({ classification, ms, rows, jsonBytes })) })}`
            );
            if (round >= 0) calls[index].push(call);
            if (index === 1)
              for (const statement of call.statements) {
                if (!explained.has(statement.sql)) {
                  explained.add(statement.sql);
                  const plan = (await runQueryDispatch(work, `EXPLAIN FORMAT=TREE ${statement.sql}`, statement.params)) as RowDataPacket[];
                  console.log(`${LOG_PREFIX} EXPLAIN ${statement.classification}\n${statement.sql}\n${String(plan[0].EXPLAIN)}`);
                }
              }
          }
        }
        const hashes = calls.map(group => new Set(group.map(call => call.hash)));
        expect(hashes[0].size, `${name}: first arm response varies`).toBe(1);
        expect(hashes[1].size, `${name}: second arm response varies`).toBe(1);
        expect(calls[0][0].hash, `${name}: arm responses differ`).toBe(calls[1][0].hash);
        const armResults = calls.map((group, i) => {
          const times = group.map(call => call.wallMs);
          return {
            name: arms[i].name,
            p50Ms: median(times),
            minMs: Math.min(...times),
            maxMs: Math.max(...times),
            rows: group.map(call => call.statements.reduce((sum, statement) => sum + statement.rows, 0)),
            jsonBytes: group.map(call => call.statements.reduce((sum, statement) => sum + statement.jsonBytes, 0)),
            signatureCount:
              distinctSignatureCount(group[0].statements, HISTOGRAM_WITH_FLAGS_LABEL) ??
              distinctSignatureCount(group[0].statements, HISTOGRAM_WITHOUT_FLAGS_LABEL),
            sha256: group[0].hash
          };
        });
        const ratio = armResults[1].p50Ms / armResults[0].p50Ms;
        results[name] = { arms: armResults, ratio, hashesIdentical: true };
        const formatArm = (arm: (typeof armResults)[number]) => `${arm.p50Ms.toFixed(2)} / ${arm.minMs.toFixed(2)} / ${arm.maxMs.toFixed(2)}`;
        resultRows.push(`| ${name} | ${formatArm(armResults[0])} | ${formatArm(armResults[1])} | ${ratio.toFixed(2)} |`);
      }
      const allStatements = Object.values(callsByScenario).flatMap(groups => groups.flatMap(group => group.flatMap(call => call.statements)));
      const unlabelledStatements = allStatements.filter(statement => statement.classification === UNLABELLED_STATEMENT).length;
      const currentStatementTexts = new Set(
        Object.values(callsByScenario).flatMap(groups => groups[1].flatMap(call => call.statements.map(statement => statement.sql)))
      ).size;
      console.log(`${LOG_PREFIX} unlabelled statements: ${unlabelledStatements}; second-arm distinct statement texts: ${currentStatementTexts}`);
      expect(unlabelledStatements, 'every recorded statement carries an explorer label or matches an oracle shape').toBe(0);
      if (options.arms === 'oracle-current')
        expect(currentStatementTexts, 'the new implementation sends at most nine distinct texts').toBeLessThanOrEqual(STATEMENT_TEXT_LIMIT);

      const facetsDefaultCalls = callsByScenario.facetsDefault;
      const messageCountsCalls = callsByScenario.messageCounts;
      const histogramWithFlagsP50Ms = statementP50Ms(facetsDefaultCalls[1], HISTOGRAM_WITH_FLAGS_LABEL);
      const histogramWithoutFlagsP50Ms = statementP50Ms(messageCountsCalls[1], HISTOGRAM_WITHOUT_FLAGS_LABEL);
      const oracleDuplicateGroupsP50Ms = statementP50Ms(facetsDefaultCalls[0], ORACLE_DUPLICATE_GROUPS_CLASS);
      const oracleSameBatchGroupsP50Ms = statementP50Ms(facetsDefaultCalls[0], ORACLE_SAME_BATCH_GROUPS_CLASS);
      const m2 = {
        histogramWithFlagsP50Ms,
        histogramWithoutFlagsP50Ms,
        m2Delta: difference(histogramWithFlagsP50Ms, histogramWithoutFlagsP50Ms),
        oracleGroupsP50:
          oracleDuplicateGroupsP50Ms === null || oracleSameBatchGroupsP50Ms === null ? null : oracleDuplicateGroupsP50Ms + oracleSameBatchGroupsP50Ms
      };
      console.log(`${LOG_PREFIX} m2 inputs ${JSON.stringify(m2)}`);

      const m1 = await runMembershipProbe(
        { schema: SCHEMA, plotID: MEASURED_PLOT_ID, censusIDs: MEASURED_CENSUS_IDS },
        async statement => {
          const startedAt = performance.now();
          const rows = (await runQueryDispatch(benchPool, statement.sql, statement.params)) as MembershipProbeRow[];
          return { rows, sqlMs: performance.now() - startedAt };
        },
        { measuredRuns: MEASURED_CALLS }
      );
      console.log(`${LOG_PREFIX} m1Probe ${JSON.stringify(m1)}`);

      const distinctSignatures = {
        withFlags: distinctSignatureCount(facetsDefaultCalls[1][0]?.statements ?? [], HISTOGRAM_WITH_FLAGS_LABEL),
        withoutFlags: distinctSignatureCount(messageCountsCalls[1][0]?.statements ?? [], HISTOGRAM_WITHOUT_FLAGS_LABEL)
      };
      console.log(
        ['| Scenario | First p50 / min / max (ms) | Second p50 / min / max (ms) | Second / first |', '|---|---:|---:|---:|', ...resultRows].join('\n')
      );
      console.log(
        `${SUMMARY_LINE_PREFIX} ${JSON.stringify({
          ...options,
          serverVersion: String(server.version),
          bufferPoolBytes: Number(server.bufferPoolBytes),
          scopes: [{ name: 'measured', plotID: MEASURED_PLOT_ID, censusIDs: MEASURED_CENSUS_IDS, ...censusScope }],
          unlabelledStatements,
          secondArmStatementTexts: currentStatementTexts,
          distinctSignatures,
          m1,
          m2,
          scenarios: results
        })}`
      );
    },
    TEST_TIMEOUT_MS
  );
});
