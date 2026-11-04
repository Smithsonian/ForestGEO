import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql, { type Connection, type ConnectionOptions } from 'mysql2/promise';
import { normalizeStatementParams, usesTextProtocol } from '@/lib/db/statementprotocol';
import { safeFormatQuery, validateSchemaOrThrow } from '@/lib/db/sqlsecurity';
import { AZURE_HOST, LOCAL_HOSTS, UnexpectedHostError, assertExpectedHost, discoverSiteSchemas } from './lib/schema-cli';
import '@/tests/oracles/errors-explorer-legacy';
import '@/app/api/errors/explorer/_shared';

const DEFAULT_MAX_STATEMENT_MS = 60_000;
const INTERRUPT_EXIT_CODE = 130;
const TIMEOUT_ERRNO = 3024;
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
  'group-limit'
]);
const REQUIRED_ENV = ['AZURE_SQL_SERVER', 'AZURE_SQL_USER', 'AZURE_SQL_PASSWORD', 'AZURE_SQL_PORT'] as const;
const REQUIRED_TABLES = ['census', 'coremeasurements', 'measurement_error_log', 'measurementssummary'] as const;

type Environment = Record<string, string | undefined>;
type QueryConnection = Pick<Connection, 'query' | 'execute' | 'end' | 'destroy'>;
type TimingRecord = {
  label: string;
  sql: string;
  issuedAt: number;
  startedAt: number;
  endedAt: number;
  rows: number;
  jsonBytes: number;
  bytesSent: number | null;
};

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

export function createSerializedExecutor(connection: Pick<Connection, 'query' | 'execute'>) {
  let tail: Promise<unknown> = Promise.resolve();
  let aborted = false;
  const statements: TimingRecord[] = [];
  function executeQuery(sql: string, params?: readonly unknown[], label = 'unlabelled'): Promise<unknown> {
    const issuedAt = performance.now();
    const run = async () => {
      if (aborted) throw new TimingRunAbortedError();
      assertReadOnlyStatement(sql);
      const startedAt = performance.now();
      const values = normalizeStatementParams(params);
      const [rows] = usesTextProtocol(sql, values) ? await connection.query(sql, values) : await connection.execute(sql, values);
      const endedAt = performance.now();
      statements.push({
        label,
        sql,
        issuedAt,
        startedAt,
        endedAt,
        rows: Array.isArray(rows) ? rows.length : 0,
        jsonBytes: Buffer.byteLength(JSON.stringify(rows)),
        bytesSent: null
      });
      return rows;
    };
    const next = tail.then(run, run);
    tail = next;
    return next;
  }
  return {
    executeQuery,
    runReadOnlyStatement: executeQuery,
    statements,
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
  return `timing: failed (${classOf(error)})`;
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
      "SELECT COUNT(DISTINCT cm.CoreMeasurementID) AS members, SUM(CHAR_LENGTH(cm.CoreMeasurementID)) + COUNT(*) - 1 AS bytes FROM ??.coremeasurements cm JOIN ??.measurementssummary ms ON ms.CoreMeasurementID = cm.CoreMeasurementID WHERE cm.CensusID = ? AND cm.IsActive = 1 AND cm.UploadFileID IS NOT NULL AND cm.UploadBatchID IS NOT NULL AND ms.TreeTag IS NOT NULL AND ms.TreeTag <> '' GROUP BY cm.UploadFileID, cm.UploadBatchID, ms.TreeTag HAVING COUNT(DISTINCT COALESCE(ms.SpeciesCode, '')) > 1 AND COUNT(DISTINCT cm.CoreMeasurementID) > 1 ORDER BY members DESC LIMIT 1"
    );
    const d = ((await executor.executeQuery(duplicate, [c.CensusID], 'duplicate')) as Record<string, unknown>[])[0];
    const b = ((await executor.executeQuery(batch, [c.CensusID], 'batch')) as Record<string, unknown>[])[0];
    const show = (r: Record<string, unknown> | undefined) => `${r?.members ?? 0} members, ${r?.bytes ?? 0} bytes${Number(r?.bytes ?? 0) > limit ? ' cut' : ''}`;
    out(`census ${c.CensusID}: duplicate ${show(d)}; same-batch ${show(b)}; group_concat_max_len ${limit}`);
  }
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
    executor = createSerializedExecutor(connection);
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
      const index = argv.indexOf('--schema');
      const schema = index < 0 ? undefined : argv[index + 1];
      if (index >= 0 && !schema) throw new Error('Missing schema');
      await listCensuses(executor, schema, argv.includes('--with-group-sizes'), out);
    }
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
