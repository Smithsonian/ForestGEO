import path from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_ERROR_EXPLORER_FILTERS, ERROR_EXPLORER_PRESETS, type ErrorExplorerFilters } from '@/config/errorsexplorer';
import { fileURLToPath } from 'node:url';
import mysql, { type Connection, type ConnectionOptions } from 'mysql2/promise';
import { normalizeStatementParams, usesTextProtocol } from '@/lib/db/statementprotocol';
import { safeFormatQuery, validateSchemaOrThrow } from '@/lib/db/sqlsecurity';
import { AZURE_HOST, LOCAL_HOSTS, UnexpectedHostError, assertExpectedHost, discoverSiteSchemas } from './lib/schema-cli';
import * as oracle from '@/tests/oracles/errors-explorer-legacy';
import * as current from '@/app/api/errors/explorer/_shared';

const DEFAULT_MAX_STATEMENT_MS = 60_000;
const INTERRUPT_EXIT_CODE = 130;
const TIMEOUT_ERRNO = 3024;
const SHOW_BYTES = "SHOW SESSION STATUS LIKE 'Bytes_sent'";
const LEADING_COMMENTS = /^(?:\s*(?:\/\*[\s\S]*?\*\/|--[^\n]*\n))*\s*/;
const READ_STATEMENT_START = /^(?:SELECT|WITH)\b/i;
const FORBIDDEN_READ_CLAUSES = [/;/, /\bINTO\b/i, /\bFOR\s+UPDATE\b/i, /\bFOR\s+SHARE\b/i, /\bLOCK\s+IN\s+SHARE\s+MODE\b/i];
const SESSION_SETUP = {
  readOnly: 'SET SESSION transaction_read_only = ON',
  check: 'SELECT @@session.transaction_read_only AS readOnly',
  maxTime: 'SET SESSION max_execution_time = ?'
} as const;
const SAFE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ER_TABLEACCESS_DENIED_ERROR',
  'ER_PARSE_ERROR',
  'ER_QUERY_TIMEOUT',
  'ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION'
]);
const SAFE_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'AggregateError']);
const SAFE_CONTEXT = new Set([
  'test',
  'list-censuses',
  'read',
  'first',
  'second',
  'setup',
  'unlabelled',
  'discovery',
  'censuses',
  'active',
  'errors',
  'invalid',
  'duplicate',
  'batch',
  'group-limit',
  'shape',
  'raw-rows',
  'duplicate-groups',
  'same-batch-groups',
  'queryPage0',
  'queryLastPage',
  'queryValidationOnly',
  'queryContradictions',
  'queryMostCommonMessage',
  'queryQuickSearch',
  'facetsDefault',
  'facetsContradictions',
  'detailsFirstRow',
  'detailsFirstContradictionRow',
  'messageCounts',
  'exportDefault'
]);
const REQUIRED_ENV = ['AZURE_SQL_SERVER', 'AZURE_SQL_USER', 'AZURE_SQL_PASSWORD', 'AZURE_SQL_PORT'] as const;
const REQUIRED_TABLES = ['census', 'coremeasurements', 'measurement_error_log', 'measurementssummary'] as const;

type Environment = Record<string, string | undefined>;
type QueryConnection = Pick<Connection, 'query' | 'execute' | 'end' | 'destroy'>;
type TimingRecord = {
  label: string;
  operation: string;
  sql: string;
  params: readonly unknown[];
  instrumentationMs: number;
  issuedAt: number;
  startedAt: number;
  endedAt: number;
  rows: number;
  jsonBytes: number;
  bytesSent: number | null;
};

type WaveStatement = { issuedAt: number; startedAt: number; endedAt: number };
const STATEMENT_TEXT_LIMIT = 9;
export function groupIntoWaves<T extends WaveStatement>(statements: readonly T[]): T[][] {
  const waves: T[][] = [];
  for (const statement of statements) {
    const wave = waves[waves.length - 1];
    if (!wave || statement.issuedAt >= wave[0].endedAt) waves.push([statement]);
    else wave.push(statement);
  }
  return waves;
}
export function criticalPathEstimate(statements: readonly WaveStatement[], nodeMs: number): number {
  return groupIntoWaves(statements).reduce((sum, wave) => sum + Math.max(...wave.map(s => s.endedAt - s.startedAt)), nodeMs);
}
export function pageLoadEstimate(query: readonly WaveStatement[], facets: readonly WaveStatement[], queryNodeMs: number, facetsNodeMs: number): number {
  return Math.max(criticalPathEstimate(query, queryNodeMs), criticalPathEstimate(facets, facetsNodeMs));
}
export function groupKeysEqual(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;
}
export function textBudget(texts: Iterable<string>): { count: number; status: 'PASS' | 'FAIL' } {
  const count = new Set(texts).size;
  return { count, status: count <= STATEMENT_TEXT_LIMIT ? 'PASS' : 'FAIL' };
}
export function diffFieldPaths(a: unknown, b: unknown, path = '$'): string[] {
  if (Object.is(a, b)) return [];
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return [path];
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].flatMap(key => diffFieldPaths(left[key], right[key], Array.isArray(a) ? `${path}[${key}]` : `${path}.${key}`));
}

export function armOrder(run: number): readonly ['oracle', 'current'] | readonly ['current', 'oracle'] {
  return run % 2 === 1 ? ['oracle', 'current'] : ['current', 'oracle'];
}
export function redactExplainPlan(plan: string): string {
  return plan
    .split('\n')
    .map(line => {
      const indentation = line.match(/^\s*/)?.[0] ?? '';
      const operation =
        line.match(/->\s*(Filter|Index lookup|Table scan|Index scan|Nested loop|Hash|Sort|Limit|Aggregate|Materialize|Union|Remove duplicates)/i)?.[1] ??
        'Plan operation';
      const costs = line.match(/\(cost=[0-9.e+ -]+ rows=[0-9.e+ -]+\)/i)?.[0] ?? '';
      return `${indentation}-> ${operation}${costs ? `  ${costs}` : ''}`;
    })
    .join('\n');
}

export class ReadOnlyStatementRejectedError extends Error {
  constructor(readonly reason: string) {
    super('Statement rejected');
    this.name = 'ReadOnlyStatementRejectedError';
  }
}
export class TimingRunAbortedError extends Error {
  constructor() {
    super('Timing run aborted');
    this.name = 'TimingRunAbortedError';
  }
}
export class ExplainRefusedError extends Error {
  constructor() {
    super('Explain refused');
    this.name = 'ExplainRefusedError';
  }
}
export class ReadOnlySessionNotConfirmedError extends Error {
  constructor() {
    super('Read-only session not confirmed');
    this.name = 'ReadOnlySessionNotConfirmedError';
  }
}
class MissingExplorerTablesError extends Error {}

export function assertReadOnlyStatement(sql: string): void {
  const body = sql.replace(LEADING_COMMENTS, '');
  if (!READ_STATEMENT_START.test(body)) throw new ReadOnlyStatementRejectedError('not a SELECT or WITH');
  if (FORBIDDEN_READ_CLAUSES.some(pattern => pattern.test(body))) throw new ReadOnlyStatementRejectedError('forbidden clause');
}

export async function prepareReadOnlySession(connection: Pick<Connection, 'query'>, maxStatementMs: number): Promise<void> {
  await connection.query(SESSION_SETUP.readOnly);
  const [rows] = await connection.query<mysql.RowDataPacket[]>(SESSION_SETUP.check);
  if (Number(rows[0]?.readOnly) !== 1) throw new ReadOnlySessionNotConfirmedError();
  await connection.query(SESSION_SETUP.maxTime, [maxStatementMs]);
}

function classifyStatement(sql: string): string {
  if (/measurement_error_log\s+mel/i.test(sql)) return 'raw-rows';
  if (/GROUP_CONCAT\s*\(DISTINCT\s+ms\./i.test(sql)) return 'duplicate-groups';
  if (/GROUP_CONCAT\s*\(DISTINCT\s+cm\./i.test(sql)) return 'same-batch-groups';
  return 'unlabelled';
}

export function createSerializedExecutor(connection: Pick<Connection, 'query' | 'execute'>, onStatement?: (label: string) => void) {
  let tail: Promise<unknown> = Promise.resolve();
  let aborted = false;
  let operation = 'setup';
  let bytesOverhead: number | null = null;
  const statements: TimingRecord[] = [];
  const failures: unknown[] = [];
  const attempts: Array<{ sql: string; params: readonly unknown[]; operation: string }> = [];
  async function readBytes(): Promise<number> {
    const [rows] = await connection.query<mysql.RowDataPacket[]>(SHOW_BYTES);
    const value = Number(rows[0]?.Value);
    if (!Number.isFinite(value)) throw new Error('Invalid session status');
    return value;
  }
  async function calibrateBytes(): Promise<void> {
    const before = await readBytes();
    bytesOverhead = (await readBytes()) - before;
  }
  function executeQuery(sql: string, params?: readonly unknown[], label = 'unlabelled'): Promise<unknown> {
    const issuedAt = performance.now();
    const issuedOperation = operation;
    const run = async () => {
      if (aborted) throw new TimingRunAbortedError();
      assertReadOnlyStatement(sql);
      const trustedLabel = label === 'unlabelled' ? classifyStatement(sql) : label;
      onStatement?.(trustedLabel);
      const instrumentationStart = performance.now();
      const beforeBytes = bytesOverhead === null ? null : await readBytes();
      const startedAt = performance.now();
      const values = normalizeStatementParams(params);
      attempts.push({ sql, params: params ?? [], operation: issuedOperation });
      const [rows] = usesTextProtocol(sql, values) ? await connection.query(sql, values) : await connection.execute(sql, values);
      const endedAt = performance.now();
      const afterBytes = beforeBytes === null ? null : await readBytes();
      statements.push({
        label: trustedLabel,
        operation: issuedOperation,
        sql,
        params: params ?? [],
        instrumentationMs: startedAt - instrumentationStart + performance.now() - endedAt,
        issuedAt,
        startedAt,
        endedAt,
        rows: Array.isArray(rows) ? rows.length : 0,
        jsonBytes: Buffer.byteLength(JSON.stringify(rows)),
        bytesSent: afterBytes === null || beforeBytes === null || bytesOverhead === null ? null : Math.max(0, afterBytes - beforeBytes - bytesOverhead)
      });
      return rows;
    };
    const next = tail.then(run, run).catch(error => {
      failures.push(error);
      throw error;
    });
    tail = next;
    return next;
  }
  return {
    executeQuery,
    calibrateBytes,
    drain: async () => {
      await tail.catch(() => undefined);
      const pending = failures.splice(0);
      const nonTimeout = pending.findIndex(error => errnoOf(error) !== TIMEOUT_ERRNO);
      if (nonTimeout !== -1) throw pending[nonTimeout];
    },
    setOperation: (value: string) => {
      operation = value;
    },
    runReadOnlyStatement: executeQuery,
    statements,
    attempts,
    abort: () => {
      aborted = true;
    },
    distinctTexts: () => new Set(statements.map(statement => statement.sql))
  };
}
type Executor = ReturnType<typeof createSerializedExecutor>;
type Scenario = { name: string; run: (executor: Executor) => Promise<unknown> };
export interface TimingDeps {
  env?: Environment;
  runtimeEnv?: Environment;
  createConnection?: (options: ConnectionOptions) => Promise<QueryConnection>;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  loadEnvFile?: (path: string) => void;
  onSignal?: (signal: 'SIGINT' | 'SIGTERM', callback: () => void) => () => void;
  scenarios?: Scenario[];
}

export function resolveTimingTarget(env: Environment) {
  const host = env.AZURE_SQL_SERVER;
  assertExpectedHost(host, [AZURE_HOST, ...LOCAL_HOSTS]);
  const user = env.AZURE_SQL_USER;
  const password = env.AZURE_SQL_PASSWORD;
  const port = Number(env.AZURE_SQL_PORT);
  if (!user || !password || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid connection configuration');
  return { host: host as string, user, password, port, target: host === AZURE_HOST ? ('azure' as const) : ('local' as const) };
}
function codeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') return null;
  return SAFE_CODES.has(error.code) ? error.code : null;
}
function classOf(error: unknown): string {
  return error instanceof Error && SAFE_NAMES.has(error.name) ? error.name : 'Error';
}
function contextOf(value: string): string {
  return SAFE_CONTEXT.has(value) ? value : 'unlabelled';
}
function errnoOf(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'errno' in error && typeof error.errno === 'number' && Number.isInteger(error.errno)
    ? error.errno
    : undefined;
}
function describeFailure(error: unknown, phase: 'connection' | 'statement', scenario: string, label: string): string {
  if (error instanceof UnexpectedHostError) return 'timing: refusing to run: the database host is not an allowed target';
  if (error instanceof ReadOnlyStatementRejectedError) return 'timing: ReadOnlyStatementRejectedError: statement rejected';
  if (error instanceof TimingRunAbortedError) return 'timing: TimingRunAbortedError: timing run aborted';
  if (error instanceof ExplainRefusedError) return 'timing: ExplainRefusedError: explain requires a local target';
  if (error instanceof ReadOnlySessionNotConfirmedError) return 'timing: ReadOnlySessionNotConfirmedError: read-only session not confirmed';
  if (error instanceof MissingExplorerTablesError) return 'timing: refusing to run: missing required explorer tables';
  const code = codeOf(error);
  if (phase === 'connection') return `timing: connection failed (${code ?? 'Error'})`;
  if (code) return `timing: statement failed (${code}, errno ${errnoOf(error) ?? 'unknown'}) in ${contextOf(scenario)}/${contextOf(label)}`;
  return `timing: failed (${classOf(error)}) in ${contextOf(scenario)}/${contextOf(label)}`;
}
const USAGE = [
  'Usage:',
  '  --list-censuses [--schema schema] [--with-group-sizes]',
  '  --schema schema --plot id --census id[,id...] [--runs 3]',
  '  --max-statement-ms milliseconds [--explain]'
].join('\n');

async function listCensuses(executor: Executor, schema: string | undefined, groupSizes: boolean, out: (line: string) => void): Promise<void> {
  const adapter = {
    query: async (sql: string, params?: unknown[]) => [await executor.runReadOnlyStatement(sql, params, 'discovery'), []]
  } as unknown as Connection;
  const schemas = schema ? [schema] : await discoverSiteSchemas(adapter);
  for (const site of schemas) {
    validateSchemaOrThrow(site);
    const tables = (await executor.runReadOnlyStatement(
      'SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?, ?, ?, ?)',
      [site, ...REQUIRED_TABLES],
      'discovery'
    )) as Record<string, unknown>[];
    const present = new Set(tables.map(row => row.tableName));
    if (!REQUIRED_TABLES.every(table => present.has(table))) {
      if (schema) throw new MissingExplorerTablesError();
      out(`${site}: skipped: missing required explorer tables`);
      continue;
    }
    const read = async (sql: string, label: string) =>
      (await executor.runReadOnlyStatement(safeFormatQuery(site, sql), [], label)) as Record<string, unknown>[];
    const censuses = await read('SELECT PlotID, CensusID, PlotCensusNumber, IsActive FROM ??.census', 'censuses');
    const active = await read('SELECT CensusID, COUNT(*) AS n FROM ??.coremeasurements WHERE IsActive = 1 GROUP BY CensusID', 'active');
    const errors = await read(
      'SELECT cm.CensusID, COUNT(DISTINCT cm.CoreMeasurementID) AS measurements, COUNT(*) AS occurrences FROM ??.measurement_error_log mel JOIN ??.coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID WHERE mel.IsResolved = FALSE OR mel.IsResolved IS NULL GROUP BY cm.CensusID',
      'errors'
    );
    const invalid = await read(
      'SELECT ms.CensusID, COUNT(*) AS n FROM ??.measurementssummary ms WHERE ms.IsValidated = FALSE AND NOT EXISTS (SELECT 1 FROM ??.measurement_error_log mel WHERE mel.MeasurementID = ms.CoreMeasurementID AND (mel.IsResolved = FALSE OR mel.IsResolved IS NULL)) GROUP BY ms.CensusID',
      'invalid'
    );
    const byId = (rows: Record<string, unknown>[], id: unknown) => rows.find(row => row.CensusID === id);
    censuses.sort(
      (a, b) =>
        Number(byId(errors, b.CensusID)?.occurrences ?? 0) - Number(byId(errors, a.CensusID)?.occurrences ?? 0) ||
        Number(byId(invalid, b.CensusID)?.n ?? 0) - Number(byId(invalid, a.CensusID)?.n ?? 0)
    );
    out(
      `\n${site}\n| PlotID | CensusID | PlotCensusNumber | Active | Active measurements | Error measurements | Occurrences | Invalid no log |\n| --- | --- | --- | --- | --- | --- | --- | --- |`
    );
    for (const c of censuses)
      out(
        `| ${c.PlotID} | ${c.CensusID} | ${c.PlotCensusNumber ?? 'NULL'} | ${c.IsActive} | ${byId(active, c.CensusID)?.n ?? 0} | ${byId(errors, c.CensusID)?.measurements ?? 0} | ${byId(errors, c.CensusID)?.occurrences ?? 0} | ${byId(invalid, c.CensusID)?.n ?? 0} |`
      );
    const groups = new Map<string, { count: number; plot: unknown; number: unknown }>();
    for (const c of censuses) {
      const key = JSON.stringify([c.PlotID, c.PlotCensusNumber]);
      const group = groups.get(key) ?? { count: 0, plot: c.PlotID, number: c.PlotCensusNumber };
      group.count++;
      groups.set(key, group);
    }
    const largest = [...groups.values()].sort((a, b) => b.count - a.count)[0];
    out(
      `most physical censuses behind one plot census: ${largest?.count ?? 0} (plot ${largest?.plot ?? 'none'}, PlotCensusNumber ${largest?.number ?? 'NULL'})${(largest?.count ?? 0) > 8 ? ' (runs in chunks)' : ''}`
    );
    if (groupSizes) await listGroupSizes(executor, site, censuses, out);
  }
}
async function listGroupSizes(executor: Executor, schema: string, censuses: Record<string, unknown>[], out: (line: string) => void): Promise<void> {
  const limitRows = (await executor.executeQuery('SELECT @@group_concat_max_len AS maxLen', [], 'group-limit')) as Record<string, unknown>[];
  const limit = Number(limitRows[0]?.maxLen);
  for (const c of censuses) {
    const duplicate = safeFormatQuery(
      schema,
      "SELECT COUNT(DISTINCT CoreMeasurementID) AS members, SUM(CHAR_LENGTH(CoreMeasurementID)) + COUNT(*) - 1 AS bytes FROM ??.measurementssummary WHERE CensusID = ? AND TreeTag IS NOT NULL AND TreeTag <> '' AND StemTag IS NOT NULL AND StemTag <> '' GROUP BY TreeTag, StemTag HAVING COUNT(DISTINCT CoreMeasurementID) > 1 ORDER BY members DESC LIMIT 1"
    );
    const batch = safeFormatQuery(
      schema,
      "SELECT COUNT(DISTINCT cm.CoreMeasurementID) AS members, SUM(CHAR_LENGTH(cm.CoreMeasurementID)) + COUNT(*) - 1 AS bytes FROM ??.coremeasurements cm JOIN ??.measurementssummary ms ON ms.CoreMeasurementID = cm.CoreMeasurementID WHERE cm.CensusID = ? AND COALESCE(cm.IsActive, TRUE) = TRUE AND cm.UploadFileID IS NOT NULL AND cm.UploadBatchID IS NOT NULL AND ms.TreeTag IS NOT NULL AND ms.TreeTag <> '' GROUP BY cm.UploadFileID, cm.UploadBatchID, ms.TreeTag HAVING COUNT(DISTINCT COALESCE(ms.SpeciesCode, '')) > 1 AND COUNT(DISTINCT cm.CoreMeasurementID) > 1 ORDER BY members DESC LIMIT 1"
    );
    const d = ((await executor.executeQuery(duplicate, [c.CensusID], 'duplicate')) as Record<string, unknown>[])[0];
    const b = ((await executor.executeQuery(batch, [c.CensusID], 'batch')) as Record<string, unknown>[])[0];
    const show = (r: Record<string, unknown> | undefined) => `${r?.members ?? 0} members, ${r?.bytes ?? 0} bytes${Number(r?.bytes ?? 0) > limit ? ' cut' : ''}`;
    out(`census ${c.CensusID}: duplicate ${show(d)}; same-batch ${show(b)}; group_concat_max_len ${limit}`);
  }
}

const DEFAULT_RUNS = 3;
const PAGE_SIZE = 25;
const SHOW_PREPARE = "SHOW SESSION STATUS LIKE 'Com_stmt_prepare'";
const SHOW_REPREPARE = "SHOW SESSION STATUS LIKE 'Com_stmt_reprepare'";
const SHOW_GLOBAL_PREPARED = "SHOW GLOBAL STATUS LIKE 'Prepared_stmt_count'";
const SET_VAR_PROBE = "SELECT /*+ SET_VAR(group_concat_max_len = 4) */ CHAR_LENGTH(GROUP_CONCAT(v)) AS probe FROM (SELECT '123456' AS v) AS probe";
const CAVEATS =
  "Statements ran serially on one connection while production runs some in parallel on the pool; the shared server's other load is unknown; three runs are a smoke measurement, not a p95. The critical-path estimate excludes network, TLS, rendering and pool contention. Node time includes telemetry overhead from status reads.";
type ArmName = 'oracle' | 'current';
type ExplorerModule = Pick<
  typeof oracle,
  'queryErrorExplorer' | 'buildErrorExplorerFacets' | 'buildErrorExplorerDetails' | 'buildErrorMessageCounts' | 'fetchGroupedErrorRows' | 'buildErrorExportRows'
>;
type TimingScenario = { name: string; run: (arm: ExplorerModule, executor: Executor) => Promise<unknown> };
type CallResult = { run: number; response: unknown; records: TimingRecord[]; statementMs: number; nodeMs: number; criticalMs: number };

function hashResponse(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function compareGroupKeys(a: unknown, b: unknown): boolean {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return true;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  if ('contradictionGroupKey' in left || 'contradictionGroupKey' in right) {
    const x = left.contradictionGroupKey;
    const y = right.contradictionGroupKey;
    if (typeof x === 'string' && typeof y === 'string' ? !groupKeysEqual(x, y) : x !== y) return false;
  }
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].every(key => compareGroupKeys(left[key], right[key]));
}
function withoutGroupKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutGroupKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'contradictionGroupKey')
      .map(([key, item]) => [key, withoutGroupKeys(item)])
  );
}
export function compareResponses(a: unknown, b: unknown): { identical: boolean; paths: string[]; groupKeysIdentical: boolean } {
  const left = withoutGroupKeys(JSON.parse(JSON.stringify(a)) as unknown);
  const right = withoutGroupKeys(JSON.parse(JSON.stringify(b)) as unknown);
  const identical = hashResponse(left) === hashResponse(right);
  return { identical, paths: identical ? [] : diffFieldPaths(left, right), groupKeysIdentical: compareGroupKeys(a, b) };
}
function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, min: sorted[0], max: sorted[sorted.length - 1] };
}
export function summarizePageLoad(query: readonly { run: number; criticalMs: number }[], facets: readonly { run: number; criticalMs: number }[], runs: number) {
  const pairs = query
    .flatMap(q => {
      const facet = facets.find(f => f.run === q.run);
      return facet ? [{ run: q.run, query: q.criticalMs, facets: facet.criticalMs }] : [];
    })
    .sort((a, b) => a.run - b.run);
  const includedRuns = pairs.map(pair => pair.run);
  const missingRuns = Array.from({ length: runs }, (_, index) => index + 1).filter(run => !includedRuns.includes(run));
  const counts = { includedRuns, missingRuns, includedCount: includedRuns.length, missingCount: missingRuns.length };
  if (!pairs.length) return { median: null, min: null, max: null, queryMedian: null, facetsMedian: null, ...counts };
  return {
    ...summarize(pairs.map(pair => Math.max(pair.query, pair.facets))),
    queryMedian: summarize(pairs.map(pair => pair.query)).median,
    facetsMedian: summarize(pairs.map(pair => pair.facets)).median,
    ...counts
  };
}
function parsePositive(value: string | undefined): number {
  const number = Number(value);
  if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1) throw new Error('Invalid argument');
  return number;
}
function argument(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}
async function readStatus(connection: QueryConnection, sql: string): Promise<number> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(sql);
  const value = Number(rows[0]?.Value);
  if (!Number.isFinite(value)) throw new Error('Invalid session status');
  return value;
}
async function reportShape(executor: Executor, connection: QueryConnection, schema: string, plotID: number, censusIDs: number[], out: (line: string) => void) {
  const placeholders = censusIDs.map(() => '?').join(',');
  const scope = `PlotID = ? AND CensusID IN (${placeholders})`;
  const params = [plotID, ...censusIDs];
  const read = async (sql: string, values: unknown[] = []) =>
    (await executor.executeQuery(safeFormatQuery(schema, sql), values, 'shape')) as Record<string, unknown>[];
  const facts = await read(
    'SELECT @@version AS version, @@group_concat_max_len AS groupConcatMaxLen, @@innodb_buffer_pool_size AS bufferPoolBytes, @@max_prepared_stmt_count AS maxPreparedStatements'
  );
  const probe = await read(SET_VAR_PROBE);
  const prepared = await readStatus(connection, SHOW_GLOBAL_PREPARED);
  out(`server facts: ${JSON.stringify(facts[0])}; Prepared_stmt_count ${prepared}; SET_VAR honoured: ${Number(probe[0]?.probe) === 4 ? 'yes' : 'no'}`);
  const shapeQueries: Array<[string, string, unknown[]]> = [
    ['scope rows', `SELECT COUNT(*) AS n FROM ??.measurementssummary WHERE ${scope}`, params],
    [
      'active measurements',
      `SELECT COUNT(*) AS n FROM ??.coremeasurements cm JOIN ??.census c ON c.CensusID = cm.CensusID WHERE c.PlotID = ? AND cm.CensusID IN (${placeholders}) AND COALESCE(cm.IsActive, TRUE) = TRUE`,
      params
    ],
    [
      'scope unresolved logs',
      `SELECT COUNT(*) AS n FROM ??.measurement_error_log mel JOIN ??.coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID JOIN ??.census c ON c.CensusID = cm.CensusID WHERE c.PlotID = ? AND cm.CensusID IN (${placeholders}) AND (mel.IsResolved = FALSE OR mel.IsResolved IS NULL)`,
      params
    ],
    ['schema unresolved logs', 'SELECT COUNT(*) AS n FROM ??.measurement_error_log WHERE IsResolved = FALSE OR IsResolved IS NULL', []],
    [
      'invalid no log',
      `SELECT COUNT(*) AS n FROM ??.measurementssummary ms WHERE ms.PlotID = ? AND ms.CensusID IN (${placeholders}) AND ms.IsValidated = FALSE AND NOT EXISTS (SELECT 1 FROM ??.measurement_error_log mel WHERE mel.MeasurementID = ms.CoreMeasurementID AND (mel.IsResolved = FALSE OR mel.IsResolved IS NULL))`,
      params
    ],
    ['catalog size', 'SELECT COUNT(*) AS n FROM ??.measurement_errors', []],
    ['tree tags', 'SELECT COUNT(DISTINCT TreeTag) AS tags, COUNT(*) / NULLIF(COUNT(DISTINCT TreeTag), 0) AS averageRowsPerTag FROM ??.measurementssummary', []]
  ];
  for (const [name, sql, values] of shapeQueries) out(`${name}: ${JSON.stringify((await read(sql, values))[0])}`);
  const indexes = await executor.executeQuery(
    'SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS position FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?, ?, ?, ?) ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX',
    [schema, 'measurementssummary', 'coremeasurements', 'measurement_error_log', 'measurement_errors'],
    'shape'
  );
  out(`indexes: ${JSON.stringify(indexes)}`);
  out('distinct signatures: n/a');
  await listGroupSizes(
    executor,
    schema,
    censusIDs.map(CensusID => ({ CensusID })),
    out
  );
}

async function runMeasurements(
  argv: readonly string[],
  executor: Executor,
  connection: QueryConnection,
  out: (line: string) => void,
  maxMs: number,
  setScenario: (name: string) => void
): Promise<void> {
  const schema = argument(argv, '--schema');
  if (!schema) throw new Error('Missing schema');
  validateSchemaOrThrow(schema);
  const plotID = parsePositive(argument(argv, '--plot'));
  const censusArg = argument(argv, '--census');
  if (!censusArg) throw new Error('Missing census');
  const censusIDs = [...new Set(censusArg.split(',').map(parsePositive))];
  const runs = argument(argv, '--runs') === undefined ? DEFAULT_RUNS : parsePositive(argument(argv, '--runs'));
  const request = { schema, plotID, censusID: censusIDs[0], censusIDs, page: 0, pageSize: PAGE_SIZE, filters: DEFAULT_ERROR_EXPLORER_FILTERS };
  await reportShape(executor, connection, schema, plotID, censusIDs, out);
  const page = await oracle.queryErrorExplorer(executor, request);
  const facets = await oracle.buildErrorExplorerFacets(executor, request);
  const grouped = await oracle.fetchGroupedErrorRows(executor, schema, plotID, censusIDs, { withContradictions: false });
  const rawRecords = executor.statements.filter(record => /measurement_error_log\s+mel/i.test(record.sql));
  out(`error-set measurements: ${grouped.size}; occurrences: ${rawRecords.slice(-censusIDs.length).reduce((sum, record) => sum + record.rows, 0)}`);
  const first = page.rows[0];
  const message = facets.messages[0];
  const preset = (id: string): ErrorExplorerFilters => {
    const found = ERROR_EXPLORER_PRESETS.find(item => item.id === id);
    if (!found) throw new Error('Missing preset');
    return found.filters;
  };
  const contradictionPage = await oracle.queryErrorExplorer(executor, { ...request, filters: preset('contradictions') });
  const contradiction = contradictionPage.rows[0];
  const firstID = first?.coreMeasurementID;
  const contradictionID = contradiction?.coreMeasurementID;
  const scenarios: TimingScenario[] = [
    { name: 'queryPage0', run: (arm, e) => arm.queryErrorExplorer(e, request) },
    { name: 'queryLastPage', run: (arm, e) => arm.queryErrorExplorer(e, { ...request, page: Math.max(0, Math.ceil(page.totalRows / PAGE_SIZE) - 1) }) },
    { name: 'queryValidationOnly', run: (arm, e) => arm.queryErrorExplorer(e, { ...request, filters: preset('validation_only') }) },
    { name: 'queryContradictions', run: (arm, e) => arm.queryErrorExplorer(e, { ...request, filters: preset('contradictions') }) },
    ...(message
      ? [
          {
            name: 'queryMostCommonMessage',
            run: (arm, e) => arm.queryErrorExplorer(e, { ...request, filters: { ...request.filters, exactMessages: [message.value] } })
          } satisfies TimingScenario
        ]
      : []),
    ...(first?.treeTag
      ? [
          {
            name: 'queryQuickSearch',
            run: (arm, e) => arm.queryErrorExplorer(e, { ...request, filters: { ...request.filters, quickSearch: first.treeTag!.slice(0, 3) } })
          } satisfies TimingScenario
        ]
      : []),
    { name: 'facetsDefault', run: (arm, e) => arm.buildErrorExplorerFacets(e, request) },
    { name: 'facetsContradictions', run: (arm, e) => arm.buildErrorExplorerFacets(e, { ...request, filters: preset('contradictions') }) },
    ...(firstID != null ? [{ name: 'detailsFirstRow', run: (arm, e) => arm.buildErrorExplorerDetails(e, request, firstID) } satisfies TimingScenario] : []),
    ...(contradictionID != null
      ? [{ name: 'detailsFirstContradictionRow', run: (arm, e) => arm.buildErrorExplorerDetails(e, request, contradictionID) } satisfies TimingScenario]
      : []),
    { name: 'messageCounts', run: (arm, e) => arm.buildErrorMessageCounts(e, request) },
    { name: 'exportDefault', run: async (arm, e) => arm.buildErrorExportRows(await arm.fetchGroupedErrorRows(e, schema, plotID, censusIDs), request.filters) }
  ];
  for (const name of ['queryMostCommonMessage', 'queryQuickSearch', 'detailsFirstRow', 'detailsFirstContradictionRow'])
    if (!scenarios.some(item => item.name === name)) out(`${name}: unavailable for this scope`);
  const arms: Record<ArmName, ExplorerModule> = { oracle, current: current as unknown as ExplorerModule };
  const results: Record<string, Record<ArmName, CallResult[]>> = {};
  const currentAttempts: Array<{ sql: string; params: readonly unknown[]; operation: string }> = [];
  await executor.calibrateBytes();
  let prepareDelta = 0;
  let reprepareDelta = 0;
  const table = ['| Scenario | Arm | Critical ms median (min–max) | Statement ms | Node ms |', '| --- | --- | --- | --- | --- |'];
  const comparisons: Record<string, Array<{ run: number; identical: boolean; paths: string[]; groupKeysIdentical: boolean }>> = {};
  for (const scenario of scenarios) {
    setScenario(scenario.name);
    const calls: Record<ArmName, CallResult[]> = { oracle: [], current: [] };
    results[scenario.name] = calls;
    for (let round = 0; round <= runs; round++) {
      for (const armName of armOrder(round || 1)) {
        executor.setOperation(scenario.name);
        const startIndex = executor.statements.length;
        const startAttempt = executor.attempts.length;
        const preparesBefore = armName === 'current' ? await readStatus(connection, SHOW_PREPARE) : 0;
        const repreparesBefore = armName === 'current' ? await readStatus(connection, SHOW_REPREPARE) : 0;
        const start = performance.now();
        try {
          const response = await scenario.run(arms[armName], executor);
          const end = performance.now();
          const records = executor.statements.slice(startIndex);
          const statementMs = records.reduce((sum, r) => sum + r.endedAt - r.startedAt, 0);
          const nodeMs = Math.max(0, end - start - statementMs);
          if (round) calls[armName].push({ run: round, response, records, statementMs, nodeMs, criticalMs: criticalPathEstimate(records, nodeMs) });
        } catch (error) {
          if (errnoOf(error) !== TIMEOUT_ERRNO) throw error;
          await executor.drain();
          out(`${scenario.name} ${armName}: timed out after ${maxMs} ms`);
        } finally {
          if (armName === 'current') currentAttempts.push(...executor.attempts.slice(startAttempt));
        }
        if (armName === 'current') {
          prepareDelta += (await readStatus(connection, SHOW_PREPARE)) - preparesBefore;
          reprepareDelta += (await readStatus(connection, SHOW_REPREPARE)) - repreparesBefore;
        }
      }
    }
    for (const arm of ['oracle', 'current'] as const) {
      if (!calls[arm].length) continue;
      const critical = summarize(calls[arm].map(call => call.criticalMs));
      table.push(
        `| ${scenario.name} | ${arm} | ${critical.median.toFixed(2)} (${critical.min.toFixed(2)}–${critical.max.toFixed(2)}) | ${summarize(calls[arm].map(call => call.statementMs)).median.toFixed(2)} | ${summarize(calls[arm].map(call => call.nodeMs)).median.toFixed(2)} |`
      );
      for (const call of calls[arm])
        for (const record of call.records)
          out(
            `statement ${scenario.name} ${arm} run ${call.run}: ${contextOf(record.label)}, ${(record.endedAt - record.startedAt).toFixed(2)} ms, ${record.rows} rows, ${record.bytesSent} server bytes, ${record.jsonBytes} JSON bytes`
          );
    }
    if (calls.oracle.length && calls.current.length) {
      for (const oracleCall of calls.oracle) {
        const currentCall = calls.current.find(call => call.run === oracleCall.run);
        if (!currentCall) continue;
        const a = oracleCall.response;
        const b = currentCall.response;
        const comparison = compareResponses(a, b);
        (comparisons[scenario.name] ??= []).push({ run: oracleCall.run, ...comparison });
        out(`${scenario.name} run ${oracleCall.run}: ${comparison.identical ? 'identical' : `differs ${comparison.paths.join(', ')}`}`);
        out(`${scenario.name} run ${oracleCall.run} contradictionGroupKey: ${comparison.groupKeysIdentical ? 'identical' : 'differs'}`);
      }
    }
  }
  out(table.join('\n'));
  const pageLoad: Partial<Record<ArmName, unknown>> = {};
  for (const arm of ['oracle', 'current'] as const) {
    const query = results.queryPage0[arm];
    const facetsCalls = results.facetsDefault[arm];
    pageLoad[arm] = summarizePageLoad(query, facetsCalls, runs);
    out(`pageLoad ${arm}: ${JSON.stringify(pageLoad[arm])}`);
  }
  const budget = textBudget(currentAttempts.map(record => record.sql));
  out(`distinct-text budget: ${budget.status} (${budget.count})`);
  out(`Com_stmt_prepare delta: ${prepareDelta}; Com_stmt_reprepare delta: ${reprepareDelta}`);
  if (argv.includes('--explain')) {
    out('EXPLAIN output retains operation types, indentation and cost/row estimates; predicates and identifiers are redacted.');
    const explained = new Set<string>();
    for (const record of currentAttempts) {
      if (explained.has(record.sql)) continue;
      explained.add(record.sql);
      assertReadOnlyStatement(record.sql);
      const [rows] = await connection.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${record.sql}`, normalizeStatementParams(record.params));
      out(`EXPLAIN ${explained.size}:\n${redactExplainPlan(String(rows[0]?.EXPLAIN ?? ''))}`);
    }
  }
  out(CAVEATS);
  const summary = Object.fromEntries(
    Object.entries(results).map(([name, result]) => [
      name,
      Object.fromEntries((['oracle', 'current'] as const).map(arm => [arm, result[arm].length ? summarize(result[arm].map(call => call.criticalMs)) : null]))
    ])
  );
  out(`ERRORS_EXPLORER_TIMING_SUMMARY ${JSON.stringify({ scenarios: summary, comparisons, pageLoad, budget })}`);
}

export async function runTimingCli(argv: readonly string[], deps: TimingDeps = {}): Promise<{ exitCode: number; error: unknown | null }> {
  const out = deps.stdout ?? console.log;
  const err = deps.stderr ?? console.error;
  if (argv.includes('--help')) {
    out(USAGE);
    return { exitCode: 0, error: null };
  }
  let connection: QueryConnection | undefined;
  let executor: Executor | undefined;
  let failure: unknown = null;
  let aborted = false;
  let destroyed = false;
  let phase: 'connection' | 'statement' = 'connection';
  let scenario = 'setup';
  let label = 'unlabelled';
  const cleanupSignal: Array<() => void> = [];
  const destroy = () => {
    if (!connection || destroyed) return;
    destroyed = true;
    try {
      connection.destroy();
    } catch (error) {
      err(`timing: cleanup failed (${codeOf(error) ?? classOf(error)})`);
    }
  };
  try {
    const env = deps.env ?? deps.runtimeEnv ?? process.env;
    if (!deps.env && !REQUIRED_ENV.every(key => env[key])) {
      if (env.AZURE_SQL_SERVER && (LOCAL_HOSTS as readonly string[]).includes(env.AZURE_SQL_SERVER)) throw new Error('Incomplete local configuration');
      (deps.loadEnvFile ?? process.loadEnvFile)(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env.local'));
    }
    const target = resolveTimingTarget(env);
    if (argv.includes('--explain') && target.target !== 'local') throw new ExplainRefusedError();
    const maxIndex = argv.indexOf('--max-statement-ms');
    const maxMs = maxIndex < 0 ? DEFAULT_MAX_STATEMENT_MS : Number(argv[maxIndex + 1]);
    if (!Number.isInteger(maxMs) || maxMs < 1) throw new Error('Invalid timeout');
    connection = await (deps.createConnection ?? mysql.createConnection)({
      host: target.host,
      port: target.port,
      user: target.user,
      password: target.password,
      multipleStatements: false,
      timezone: 'Z',
      charset: 'utf8mb4_0900_ai_ci',
      ...(target.target === 'azure' && { ssl: { rejectUnauthorized: true } })
    });
    executor = createSerializedExecutor(connection, statementLabel => {
      label = statementLabel;
    });
    phase = 'statement';
    const onSignal =
      deps.onSignal ??
      ((signal, callback) => {
        process.on(signal, callback);
        return () => process.off(signal, callback);
      });
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      cleanupSignal.push(
        onSignal(signal, () => {
          aborted = true;
          executor?.abort();
          destroy();
        })
      );
    await prepareReadOnlySession(connection, maxMs);
    if (aborted) throw new TimingRunAbortedError();
    out(`target: ${target.target}`);
    if (argv.includes('--list-censuses')) {
      scenario = 'list-censuses';
      const index = argv.indexOf('--schema');
      const schema = index < 0 ? undefined : argv[index + 1];
      if (index >= 0 && !schema) throw new Error('Missing schema');
      await listCensuses(executor, schema, argv.includes('--with-group-sizes'), out);
    }
    if (!argv.includes('--list-censuses') && argv.includes('--schema'))
      await runMeasurements(argv, executor, connection, out, maxMs, name => {
        scenario = name;
      });
    for (const item of deps.scenarios ?? []) {
      scenario = item.name;
      try {
        await item.run({
          ...executor,
          executeQuery: (sql, params, statementLabel = 'unlabelled') => {
            label = statementLabel;
            return executor!.executeQuery(sql, params, statementLabel);
          }
        });
      } catch (error) {
        if (errnoOf(error) !== TIMEOUT_ERRNO) throw error;
        out(`timing: ${contextOf(scenario)} timed out after ${maxMs} ms`);
      }
    }
    if (aborted) throw new TimingRunAbortedError();
  } catch (error) {
    failure = error;
    err(describeFailure(error, phase, scenario, label));
  } finally {
    for (const remove of cleanupSignal) remove();
    if (connection) {
      if (failure || aborted) destroy();
      else {
        try {
          await connection.end();
        } catch (error) {
          failure = error;
          err(`timing: cleanup failed (${codeOf(error) ?? classOf(error)})`);
          destroy();
        }
      }
    }
  }
  return { exitCode: aborted ? INTERRUPT_EXIT_CODE : failure ? 1 : 0, error: failure };
}
function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
}
if (isMainModule())
  void runTimingCli(process.argv.slice(2)).then(result => {
    process.exitCode = result.exitCode;
  });
