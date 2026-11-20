import { describe, expect, it, vi } from 'vitest';
import { AZURE_HOST } from './lib/schema-cli';
import { cleanupTimingConnections } from '@/tests/setup/stricttestdatabasecleanup';
import { everyErrorSetStatement } from '@/tests/setup/errorsetstatements';
import * as oracle from '@/tests/oracles/errors-explorer-legacy';
import { buildActiveMeasurementCountQuery } from '@/lib/activemeasurementcount';
import { ACTIVE_COUNT_STATEMENT, ORACLE_OUTSIDE_ROWS_STATEMENT } from '@/tests/setup/errorsetstatements';
import { buildF1MembershipProbe, buildF2MembershipProbe, MEMBERSHIP_PROBE_LABELS, runMembershipProbeRepetition } from '@/tests/benchmarks/lib/membershipprobe';
import { CENSUS_LIST_SIZE, chunkCensusIDs, ERROR_EXPLORER_STATEMENT_LABELS, readStatementLabel } from '@/app/api/errors/explorer/errorsetsql';
import {
  classifyStatement,
  countDistinctSignatures,
  createTimedProbeExecutor,
  describeCensusScope,
  lastPageNumber,
  m1Summary,
  pastTheEndPageNumber,
  groupIntoWaves,
  criticalPathEstimate,
  diffFieldPaths,
  groupKeysEqual,
  textBudget,
  summarizePageLoadSerial,
  STATEMENT_SHAPE_LIMIT,
  redactExplainPlan,
  armOrder,
  compareResponses,
  assertReadOnlyStatement,
  createSerializedExecutor,
  ExplainRefusedError,
  ReadOnlyStatementRejectedError,
  resolveTimingTarget,
  runTimingCli,
  TimingRunAbortedError
} from './errors-explorer-timing';

const env = { AZURE_SQL_SERVER: '127.0.0.1', AZURE_SQL_USER: 'sentinel_user_544', AZURE_SQL_PASSWORD: 'SENTINEL-PASSWORD-544', AZURE_SQL_PORT: '3306' };
function fake() {
  const connection = {
    query: vi.fn().mockResolvedValue([[{ readOnly: 1 }], []]),
    execute: vi.fn().mockResolvedValue([[], []]),
    end: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn()
  };
  const stdout: string[] = [];
  const stderr: string[] = [];
  const deps = {
    env,
    createConnection: vi.fn().mockResolvedValue(connection),
    stdout: (s: string) => stdout.push(s),
    stderr: (s: string) => stderr.push(s),
    loadEnvFile: vi.fn(),
    onSignal: vi.fn(() => () => {})
  };
  return { connection, stdout, stderr, deps };
}
const forbidden = [
  'INSERT INTO t VALUES (1)',
  'UPDATE t SET a = 1',
  'DELETE FROM t',
  'CREATE TABLE t (a INT)',
  'DROP TABLE t',
  'SELECT a INTO @x FROM t',
  'SELECT a FROM t FOR UPDATE',
  'SELECT a FROM t FOR SHARE',
  'SELECT a FROM t LOCK IN SHARE MODE',
  'SELECT 1; SELECT 2',
  '/* x */ DELETE FROM t'
];
describe('read-only timing safety', () => {
  it('only loads the environment for incomplete live CLI configuration', async () => {
    const f = fake();
    const { env: ignored, ...deps } = f.deps;
    void ignored;
    const complete = { ...env };
    await runTimingCli([], { ...deps, runtimeEnv: complete });
    expect(f.deps.loadEnvFile).not.toHaveBeenCalled();
    const incomplete = { AZURE_SQL_SERVER: AZURE_HOST } as Record<string, string>;
    f.deps.loadEnvFile.mockImplementation(() => Object.assign(incomplete, { ...env, AZURE_SQL_SERVER: AZURE_HOST }));
    await runTimingCli([], { ...deps, runtimeEnv: incomplete });
    expect(f.deps.loadEnvFile).toHaveBeenCalledOnce();
    f.deps.loadEnvFile.mockClear();
    await runTimingCli([], { ...deps, runtimeEnv: { AZURE_SQL_SERVER: '127.0.0.1' } });
    expect(f.deps.loadEnvFile).not.toHaveBeenCalled();
  });
  it('closes all owned resources and retains setup and cleanup failures by identity', async () => {
    const primary = new Error('setup');
    const roError = new Error('ro');
    const dropError = new Error('drop');
    const closeError = new Error('close');
    const ro = { end: vi.fn().mockRejectedValue(roError) };
    const writable = { query: vi.fn().mockRejectedValue(dropError), end: vi.fn().mockRejectedValue(closeError) };
    const error = await cleanupTimingConnections(ro as never, writable as never, 'forestgeo_test_timing', primary).catch(e => e);
    expect(error.errors).toEqual([primary, roError, dropError, closeError]);
    expect(error.errors[0]).toBe(primary);
    expect(error.errors[1]).toBe(roError);
    expect(error.errors[2]).toBe(dropError);
    expect(error.errors[3]).toBe(closeError);
    expect(writable.query).toHaveBeenCalledOnce();
    expect(writable.end).toHaveBeenCalledOnce();
    expect(ro.end.mock.invocationCallOrder[0]).toBeLessThan(writable.query.mock.invocationCallOrder[0]);
    await expect(cleanupTimingConnections(null, null, 'forestgeo_test_timing', primary)).rejects.toBe(primary);
  });
  it('destroys once and removes both signal listeners on interrupt', async () => {
    const f = fake();
    const callbacks: Array<() => void> = [];
    const remove = vi.fn();
    const result = await runTimingCli([], {
      ...f.deps,
      onSignal: (_signal, callback) => {
        callbacks.push(callback);
        return remove;
      },
      scenarios: [
        {
          name: 'test',
          run: async () => {
            callbacks[0]();
            callbacks[1]();
          }
        }
      ]
    });
    expect(result.exitCode).toBe(130);
    expect(f.connection.destroy).toHaveBeenCalledOnce();
    expect(f.connection.end).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(2);
  });
  it('routes schema discovery through the guarded executor', async () => {
    const f = fake();
    await runTimingCli(['--list-censuses'], f.deps);
    expect(f.connection.execute).toHaveBeenCalledWith(expect.stringContaining('information_schema.SCHEMATA'), expect.any(Array));
    expect(f.connection.query).toHaveBeenCalledTimes(3);
  });
  it('reports incomplete discovered schemas and continues to complete sites', async () => {
    const f = fake();
    const required = ['census', 'coremeasurements', 'measurement_error_log', 'measurementssummary'];
    f.connection.execute.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('information_schema.SCHEMATA')) return [[{ schema_name: 'forestgeo_incomplete' }, { schema_name: 'forestgeo_complete' }], []];
      if (sql.includes('information_schema.TABLES'))
        return [(params[0] === 'forestgeo_complete' ? required : ['census']).map(tableName => ({ tableName })), []];
      if (sql.includes('.census')) return [[{ PlotID: 1, CensusID: 2, PlotCensusNumber: 1, IsActive: 1 }], []];
      return [[], []];
    });
    const result = await runTimingCli(['--list-censuses'], f.deps);
    expect(result.exitCode).toBe(0);
    expect(f.stdout.join('\n')).toContain('forestgeo_incomplete: skipped: missing required explorer tables');
    expect(f.stdout.join('\n')).toContain('forestgeo_complete\n| PlotID');
    expect(f.connection.execute.mock.calls.filter(([sql]) => sql.includes('information_schema.TABLES'))).toHaveLength(2);
  });
  it('fails visibly for an explicitly selected incomplete schema', async () => {
    const f = fake();
    const result = await runTimingCli(['--list-censuses', '--schema', 'forestgeo_incomplete'], f.deps);
    expect(result.exitCode).toBe(1);
    expect(f.stderr.join('\n')).toContain('missing required explorer tables');
  });
  it('lists counts in error order and reports group sizes and chunking', async () => {
    const f = fake();
    const censuses = Array.from({ length: 9 }, (_, i) => ({ PlotID: 1, CensusID: i + 1, PlotCensusNumber: null, IsActive: 1 }));
    f.connection.execute.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.TABLES'))
        return [['census', 'coremeasurements', 'measurement_error_log', 'measurementssummary'].map(tableName => ({ tableName })), []];
      if (sql.includes('FROM `forestgeo_example`.census')) return [censuses, []];
      if (sql.includes('AS measurements')) return [[{ CensusID: 2, measurements: 2, occurrences: 3 }], []];
      if (sql.includes('@@group_concat_max_len')) return [[{ maxLen: 4 }], []];
      if (sql.includes('AS members')) return [[{ members: 3, bytes: 8 }], []];
      return [[], []];
    });
    const result = await runTimingCli(['--list-censuses', '--schema', 'forestgeo_example', '--with-group-sizes'], f.deps);
    expect(result.exitCode).toBe(0);
    const output = f.stdout.join('\n');
    expect(output.indexOf('| 1 | 2 |')).toBeLessThan(output.indexOf('| 1 | 1 |'));
    expect(output).toContain('most physical censuses behind one plot census: 9 (plot 1, PlotCensusNumber NULL) (runs in chunks)');
    expect(output).toContain('3 members, 8 bytes cut');
    expect(f.connection.execute).toHaveBeenCalledTimes(24);
    const batchSql = f.connection.execute.mock.calls.find(([sql]) => sql.includes('UploadBatchID'))?.[0];
    expect(batchSql).toContain('COALESCE(cm.IsActive, TRUE) = TRUE');
  });
  it('labels and redacts a real census-list statement failure', async () => {
    const f = fake();
    const original = { code: 'ER_TABLEACCESS_DENIED_ERROR', errno: 1142, message: 'sentinel_user_544 SENTINEL-PASSWORD-544' };
    f.connection.execute.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.TABLES'))
        return [['census', 'coremeasurements', 'measurement_error_log', 'measurementssummary'].map(tableName => ({ tableName })), []];
      if (sql.includes('.census')) throw original;
      return [[], []];
    });
    const result = await runTimingCli(['--list-censuses', '--schema', 'forestgeo_example'], f.deps);
    expect(result.error).toBe(original);
    expect(f.stderr.join('\n')).toBe('timing: statement failed (ER_TABLEACCESS_DENIED_ERROR, errno 1142) in list-censuses/censuses');
    expect(f.stderr.join('\n')).not.toMatch(/SENTINEL|sentinel/);
  });
  it('keeps safe listing context for an unrecognized driver error', async () => {
    const f = fake();
    const original = { code: 'SENTINEL_SQL_544', message: 'sentinel_user_544 SENTINEL-PASSWORD-544' };
    f.connection.execute.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.TABLES'))
        return [['census', 'coremeasurements', 'measurement_error_log', 'measurementssummary'].map(tableName => ({ tableName })), []];
      if (sql.includes('.census')) throw original;
      return [[], []];
    });
    const result = await runTimingCli(['--list-censuses', '--schema', 'forestgeo_example'], f.deps);
    expect(result.error).toBe(original);
    expect(f.stderr.join('\n')).toBe('timing: failed (Error) in list-censuses/censuses');
    expect(f.stderr.join('\n')).not.toMatch(/SENTINEL|sentinel/);
  });
  it('fails closed when read-only session setup is not confirmed', async () => {
    const f = fake();
    f.connection.query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{ readOnly: 0 }], []]);
    const result = await runTimingCli([], f.deps);
    expect(result.exitCode).toBe(1);
    expect(f.connection.destroy).toHaveBeenCalledOnce();
    expect(f.connection.execute).not.toHaveBeenCalled();
  });
  it.each(forbidden)('rejects %s', sql => expect(() => assertReadOnlyStatement(sql)).toThrow(ReadOnlyStatementRejectedError));
  it.each([
    'SELECT 1',
    '/* errors-explorer:page */\nWITH x AS (SELECT 1) SELECT * FROM x',
    "SELECT /*+ SET_VAR(group_concat_max_len = 4) */ CHAR_LENGTH(GROUP_CONCAT(v)) FROM (SELECT '123456' AS v) AS probe"
  ])('accepts %s', sql => expect(() => assertReadOnlyStatement(sql)).not.toThrow());
  it('restricts hosts', () => {
    expect(() => resolveTimingTarget({ ...env, AZURE_SQL_SERVER: 'evil.example.com' })).toThrow();
    expect(resolveTimingTarget(env).target).toBe('local');
    expect(resolveTimingTarget({ ...env, AZURE_SQL_SERVER: AZURE_HOST }).target).toBe('azure');
  });
  it('does not load env for help or injected environment', async () => {
    const f = fake();
    await runTimingCli(['--help'], f.deps);
    await runTimingCli([], f.deps);
    expect(f.deps.loadEnvFile).not.toHaveBeenCalled();
  });
  it('ends once on success', async () => {
    const f = fake();
    expect((await runTimingCli([], f.deps)).exitCode).toBe(0);
    expect(f.connection.end).toHaveBeenCalledOnce();
    expect(f.connection.destroy).not.toHaveBeenCalled();
  });
  it('destroys the connection when graceful close fails and preserves that error', async () => {
    const f = fake();
    const closeError = new Error('sentinel-host-544.example');
    f.connection.end.mockRejectedValue(closeError);
    const result = await runTimingCli([], f.deps);
    expect(result.error).toBe(closeError);
    expect(f.connection.destroy).toHaveBeenCalledOnce();
    expect(f.stderr.join('\n')).toBe('timing: cleanup failed (Error)');
  });
  it('redacts connection and host errors', async () => {
    const f = fake();
    f.deps.createConnection.mockRejectedValue({ code: 'ECONNREFUSED', errno: -61, message: 'SENTINEL-PASSWORD-544 sentinel-host-544.example' });
    await runTimingCli([], f.deps);
    expect(f.stderr.join('\n')).toBe('timing: connection failed (ECONNREFUSED)');
    const g = fake();
    await runTimingCli([], { ...g.deps, env: { ...env, AZURE_SQL_SERVER: 'sentinel-host-544.example' } });
    expect(g.stderr.join('\n')).toBe('timing: refusing to run: the database host is not an allowed target');
  });
  it.each([
    { code: 'ER_TABLEACCESS_DENIED_ERROR', errno: 1142 },
    { code: 'ER_PARSE_ERROR', errno: 1064 }
  ])('preserves and redacts statement failure %s', async error => {
    const f = fake();
    const original = { ...error, message: 'SENTINEL_SQL_544 sentinel_user_544 SENTINEL-PASSWORD-544' };
    f.connection.execute.mockRejectedValue(original);
    f.connection.destroy.mockImplementation(() => {
      throw new Error('sentinel-host-544.example');
    });
    const result = await runTimingCli([], { ...f.deps, scenarios: [{ name: 'test', run: executor => executor.executeQuery('SELECT 1', [], 'read') }] });
    expect(result.error).toBe(original);
    expect(f.stderr.join('\n')).toContain(`statement failed (${error.code}, errno ${error.errno}) in test/read`);
    expect(f.stderr.join('\n')).toContain('timing: cleanup failed (Error)');
    expect(f.stderr.join('\n')).not.toMatch(/SENTINEL|sentinel/);
  });
  it('redacts malicious diagnostic metadata', async () => {
    const f = fake();
    f.connection.execute.mockRejectedValue({ code: 'SENTINEL_SQL_544', message: 'SENTINEL' });
    await runTimingCli([], {
      ...f.deps,
      scenarios: [{ name: 'sentinel_user_544', run: executor => executor.executeQuery('SELECT 1', [], 'SENTINEL_SQL_544') }]
    });
    expect(f.stderr.join('\n')).not.toMatch(/SENTINEL|sentinel/);
  });
  it('aborts queued statements', async () => {
    const f = fake();
    const executor = createSerializedExecutor(f.connection as never);
    executor.abort();
    await expect(executor.runReadOnlyStatement('SELECT 1')).rejects.toBeInstanceOf(TimingRunAbortedError);
    expect(f.connection.execute).not.toHaveBeenCalled();
  });
  it('continues after scenario timeout', async () => {
    const f = fake();
    f.connection.execute.mockRejectedValueOnce({ errno: 3024 }).mockResolvedValueOnce([[], []]);
    const result = await runTimingCli([], {
      ...f.deps,
      scenarios: [
        { name: 'first', run: e => e.executeQuery('SELECT 1') },
        { name: 'second', run: e => e.executeQuery('SELECT 2') }
      ]
    });
    expect(result.exitCode).toBe(0);
    expect(f.stdout.join('\n')).toContain('timed out after');
    expect(f.connection.execute).toHaveBeenCalledTimes(2);
  });
  it('refuses explain before connecting to Azure', async () => {
    const f = fake();
    const result = await runTimingCli(['--explain'], { ...f.deps, env: { ...env, AZURE_SQL_SERVER: AZURE_HOST } });
    expect(result.error).toBeInstanceOf(ExplainRefusedError);
    expect(f.deps.createConnection).not.toHaveBeenCalled();
  });
  it('serializes concurrent statements and starts timing at its turn', async () => {
    const f = fake();
    let release!: () => void;
    f.connection.execute.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = () => resolve([[], []]);
        })
    );
    const executor = createSerializedExecutor(f.connection as never);
    const one = executor.executeQuery('SELECT 1');
    const two = executor.executeQuery('SELECT 2');
    await Promise.resolve();
    expect(f.connection.execute).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([one, two]);
    expect(f.connection.execute).toHaveBeenCalledTimes(2);
    expect(executor.statements[1].startedAt).toBeGreaterThanOrEqual(executor.statements[0].endedAt);
    expect(executor.statements[1].issuedAt).toBeLessThanOrEqual(executor.statements[1].startedAt);
  });
});

describe('timing calculations', () => {
  it('groups by issue time relative to the first statement and estimates critical path', () => {
    const statements = [
      { issuedAt: 0, startedAt: 0, endedAt: 5 },
      { issuedAt: 0, startedAt: 5, endedAt: 7 },
      { issuedAt: 7, startedAt: 7, endedAt: 9 }
    ];
    console.log('wave inputs', statements);
    expect(groupIntoWaves(statements)).toEqual([[statements[0], statements[1]], [statements[2]]]);
    expect(criticalPathEstimate(statements, 3)).toBe(10);
  });
  it('returns only differing paths', () => {
    expect(diffFieldPaths({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } })).toEqual(['$.b.c']);
  });
  it('compares group keys with base sensitivity', () => {
    expect(groupKeysEqual('duplicate:2:Ab1:1', 'duplicate:2:áb1:1')).toBe(true);
    expect(groupKeysEqual('duplicate:2:Ab1:1', 'duplicate:2:Ab2:1')).toBe(false);
  });
  it('allows the ten labelled statement shapes and fails the eleventh text', () => {
    const texts = (count: number) => Array.from({ length: count }, (_, i) => `SELECT ${i}`);
    expect(STATEMENT_SHAPE_LIMIT).toBe(Object.keys(ERROR_EXPLORER_STATEMENT_LABELS).length);
    expect(STATEMENT_SHAPE_LIMIT).toBe(10);
    expect(textBudget(texts(10))).toEqual({ count: 10, status: 'PASS' });
    expect(textBudget(texts(11))).toEqual({ count: 11, status: 'FAIL' });
  });
  it('leaves the allowed active-count text out of the budget but counts every other text', () => {
    const activeCountText = 'SELECT COUNT(*) AS n active';
    const ten = Array.from({ length: 10 }, (_, i) => `SELECT ${i}`);
    expect(textBudget([...ten, activeCountText], new Set([activeCountText]))).toEqual({ count: 10, status: 'PASS' });
    expect(textBudget([...ten, 'SELECT COUNT(*) AS n other'], new Set([activeCountText]))).toEqual({ count: 11, status: 'FAIL' });
  });
});

describe('measurement safeguards', () => {
  it('alternates measured arms', () => {
    expect(armOrder(1)).toEqual(['oracle', 'current']);
    expect(armOrder(2)).toEqual(['current', 'oracle']);
  });
  it('hides literal values in local explain output while retaining plan shape', () => {
    const plan = "-> Filter: (treeTag like 'SENTINELsearch%')  (cost=4 rows=2)\n    -> Index lookup on t (id=123456789)";
    const result = redactExplainPlan(plan);
    expect(result).not.toContain('SENTINELsearch');
    expect(result).not.toContain('123456789');
    expect(result).toContain('Filter');
    expect(result).toContain('cost=4 rows=2');
  });
  it('subtracts the calibrated SHOW overhead for each statement', async () => {
    const f = fake();
    let count = 0;
    f.connection.query.mockImplementation(async () => [[{ Value: String([100, 110, 120, 180][count++]) }], []]);
    const executor = createSerializedExecutor(f.connection as never);
    await executor.calibrateBytes();
    executor.setOperation('queryPage0');
    await executor.executeQuery('SELECT 1');
    expect(executor.statements[0].bytesSent).toBe(50);
    expect(executor.statements[0].operation).toBe('queryPage0');
  });
});

it('drains a timed-out operation before a subsequent operation starts', async () => {
  const f = fake();
  let release!: () => void;
  f.connection.execute
    .mockRejectedValueOnce({ errno: 3024 })
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = () => resolve([[], []]);
        })
    )
    .mockResolvedValueOnce([[], []]);
  const executor = createSerializedExecutor(f.connection as never);
  executor.setOperation('first');
  const first = Promise.all([executor.executeQuery('SELECT 1'), executor.executeQuery('SELECT 2')]);
  await expect(first).rejects.toMatchObject({ errno: 3024 });
  const drain = executor.drain();
  let drained = false;
  void drain.then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  expect(f.connection.execute).toHaveBeenCalledTimes(2);
  release();
  await drain;
  executor.setOperation('second');
  await executor.executeQuery('SELECT 3');
  expect(executor.statements.map(record => record.operation)).toEqual(['first', 'second']);
  expect(f.connection.execute).toHaveBeenCalledTimes(3);
  expect(executor.attempts.map(attempt => attempt.sql)).toEqual(['SELECT 1', 'SELECT 2', 'SELECT 3']);
  expect(textBudget(executor.attempts.map(attempt => attempt.sql))).toEqual({ count: 3, status: 'PASS' });
});

it('compares response paths without exposing values and checks group keys separately', () => {
  const a = { row: { value: 'SECRET-A', contradictionGroupKey: 'duplicate:2:Ab1:1' } };
  const b = { row: { value: 'SECRET-B', contradictionGroupKey: 'duplicate:2:áb1:1' } };
  expect(compareResponses(a, b)).toEqual({ identical: false, paths: ['$.row.value'], groupKeysIdentical: true });
  expect(compareResponses(a, { row: { value: 'SECRET-A', contradictionGroupKey: 'duplicate:2:áb1:1' } })).toEqual({
    identical: true,
    paths: [],
    groupKeysIdentical: true
  });
});

describe('user-defined JSON in response comparison', () => {
  const PRIVATE_KEY = 'PRIVATE-CUSTOM-KEY-544';
  const PRIVATE_VALUE_A = 'PRIVATE-VALUE-A-544';
  const PRIVATE_VALUE_B = 'PRIVATE-VALUE-B-544';
  const USER_DEFINED_FIELDS_PATH = '$.rows[0].userDefinedFields';
  const rowWith = (userDefinedFields: unknown, contradictionGroupKey: string | null = null) => ({
    rows: [{ id: 1, userDefinedFields, contradictionGroupKey }]
  });

  it('reports a user-defined JSON difference at the enclosing field path without leaking its keys or values', () => {
    const comparison = compareResponses(
      rowWith({ [PRIVATE_KEY]: PRIVATE_VALUE_A, nested: { [`${PRIVATE_KEY}-DEEP`]: 1 } }),
      rowWith({ [PRIVATE_KEY]: PRIVATE_VALUE_B, nested: { [`${PRIVATE_KEY}-DEEP`]: 2 } })
    );
    const printedLine = `differs ${comparison.paths.join(', ')}`;
    const summaryJson = JSON.stringify({ comparisons: { queryPage0: [{ run: 1, ...comparison }] } });
    console.log('comparison', comparison, 'printed', printedLine);
    expect(comparison).toEqual({ identical: false, paths: [USER_DEFINED_FIELDS_PATH], groupKeysIdentical: true });
    for (const output of [printedLine, summaryJson]) {
      expect(output).not.toContain(PRIVATE_KEY);
      expect(output).not.toContain('PRIVATE-VALUE');
    }
  });

  it('reports a key that exists on one side only at the enclosing field path', () => {
    const comparison = compareResponses(rowWith({ [PRIVATE_KEY]: PRIVATE_VALUE_A }), rowWith({}));
    expect(comparison.paths).toEqual([USER_DEFINED_FIELDS_PATH]);
    expect(JSON.stringify(comparison)).not.toContain(PRIVATE_KEY);
  });

  it('reports user-defined JSON that is present on one side only', () => {
    const comparison = compareResponses(rowWith({ [PRIVATE_KEY]: PRIVATE_VALUE_A }), { rows: [{ id: 1, contradictionGroupKey: null }] });
    expect(comparison.identical).toBe(false);
    expect(comparison.paths).toEqual([USER_DEFINED_FIELDS_PATH]);
  });

  it('treats a case-only difference in a user-defined contradictionGroupKey as a mismatch', () => {
    const comparison = compareResponses(rowWith({ contradictionGroupKey: 'CaseSensitiveValue' }), rowWith({ contradictionGroupKey: 'casesensitivevalue' }));
    console.log('comparison', comparison);
    expect(comparison.identical).toBe(false);
    expect(comparison.paths).toEqual([USER_DEFINED_FIELDS_PATH]);
  });

  it('treats a missing user-defined contradictionGroupKey as a mismatch', () => {
    const comparison = compareResponses(rowWith({ contradictionGroupKey: 'x' }), rowWith({}));
    expect(comparison.identical).toBe(false);
    expect(comparison.paths).toEqual([USER_DEFINED_FIELDS_PATH]);
  });

  it('does not let a user-defined contradictionGroupKey change the group-key verdict', () => {
    const comparison = compareResponses(rowWith({ contradictionGroupKey: 'CaseSensitiveValue' }), rowWith({ contradictionGroupKey: 'casesensitivevalue' }));
    expect(comparison.groupKeysIdentical).toBe(true);
  });

  it('keeps the case and accent normalization for explorer contradictionGroupKey fields in query rows', () => {
    const comparison = compareResponses(rowWith({ same: true }, 'duplicate:2:Ab1:1'), rowWith({ same: true }, 'duplicate:2:áb1:1'));
    expect(comparison).toEqual({ identical: true, paths: [], groupKeysIdentical: true });
  });

  it('keeps the normalization for the details row and still flags a different group', () => {
    const detailsWith = (contradictionGroupKey: string) => ({ row: { id: 1, contradictionGroupKey }, allErrors: [], relatedRows: [] });
    expect(compareResponses(detailsWith('duplicate:2:Ab1:1'), detailsWith('duplicate:2:áb1:1'))).toEqual({
      identical: true,
      paths: [],
      groupKeysIdentical: true
    });
    expect(compareResponses(detailsWith('duplicate:2:Ab1:1'), detailsWith('duplicate:2:Ab2:1')).groupKeysIdentical).toBe(false);
  });

  it('does not apply the normalization to a contradictionGroupKey outside the explorer row positions', () => {
    const comparison = compareResponses({ other: { contradictionGroupKey: 'Ab1' } }, { other: { contradictionGroupKey: 'ab1' } });
    expect(comparison.identical).toBe(false);
    expect(comparison.paths).toEqual(['$.other.contradictionGroupKey']);
  });
});

it('compares dates by their serialized value', () => {
  const comparison = compareResponses({ date: new Date('2020-01-01T00:00:00Z') }, { date: new Date('2021-01-01T00:00:00Z') });
  expect(comparison.paths).toEqual(['$.date']);
  expect(comparison.identical).toBe(false);
});

it('summarizes the serial page load as facets then the top group page, using matching successful run indices', () => {
  const query = [
    { run: 1, criticalMs: 5 },
    { run: 3, criticalMs: 20 }
  ];
  const facets = [
    { run: 1, criticalMs: 10 },
    { run: 2, criticalMs: 100 },
    { run: 3, criticalMs: 12 }
  ];
  const summary = summarizePageLoadSerial(facets, query, 3);
  console.log(`serial page load ${JSON.stringify(summary)}`);
  expect(summary).toEqual({
    median: 23.5,
    min: 15,
    max: 32,
    queryMedian: 12.5,
    facetsMedian: 11,
    includedRuns: [1, 3],
    missingRuns: [2],
    includedCount: 2,
    missingCount: 1
  });
});

it('reports a serial page load with no included runs as null rather than zero', () => {
  expect(summarizePageLoadSerial([{ run: 1, criticalMs: 10 }], [], 1)).toMatchObject({ median: null, includedCount: 0, missingRuns: [1] });
});

it('propagates a non-timeout sibling failure after draining a timed-out operation', async () => {
  const f = fake();
  const siblingError = { errno: 1142, code: 'ER_TABLEACCESS_DENIED_ERROR' };
  let release!: () => void;
  f.connection.execute.mockRejectedValueOnce({ errno: 3024 }).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        release = () => reject(siblingError);
      })
  );
  const executor = createSerializedExecutor(f.connection as never);
  const operation = Promise.all([executor.executeQuery('SELECT 1'), executor.executeQuery('SELECT 2'), executor.executeQuery('SELECT 3')]);
  await expect(operation).rejects.toMatchObject({ errno: 3024 });
  const followingScenario = executor.drain().then(() => executor.executeQuery('SELECT 4'));
  release();
  await expect(followingScenario).rejects.toBe(siblingError);
  expect(f.connection.execute).toHaveBeenCalledTimes(3);
});

const BUILDER_SCHEMA = 'forestgeo_testsite';
const MULTI_CHUNK_CENSUS_COUNT = 26;
const MEASUREMENT_ID_COUNT = 300;
const range = (count: number, start = 1) => Array.from({ length: count }, (_, index) => start + index);
const ORACLE_STATEMENT_CLASSES = ['raw-rows', 'duplicate-groups', 'same-batch-groups'];

describe('read-only guard over every builder output', () => {
  it('accepts every statement of every builder for 26 censuses and 300 measurement IDs', () => {
    const statements = everyErrorSetStatement(BUILDER_SCHEMA, range(MULTI_CHUNK_CENSUS_COUNT), range(MEASUREMENT_ID_COUNT));
    console.log(`checking ${statements.length} builder statements; first label ${readStatementLabel(statements[0].sql)}`);
    expect(statements.length).toBeGreaterThan(Object.keys(ERROR_EXPLORER_STATEMENT_LABELS).length);
    for (const { sql } of statements) {
      expect(() => assertReadOnlyStatement(sql), `rejected: ${sql.slice(0, 80)}`).not.toThrow();
    }
  });

  it('accepts both membership probes for every census chunk', () => {
    const chunks = chunkCensusIDs(range(MULTI_CHUNK_CENSUS_COUNT));
    expect(chunks.map(chunk => chunk.length)).toEqual([8, 8, 8, 2]);
    for (const censusIDs of chunks) {
      for (const build of [buildF2MembershipProbe, buildF1MembershipProbe]) {
        const { sql } = build({ schema: BUILDER_SCHEMA, plotID: 1, censusIDs });
        expect(() => assertReadOnlyStatement(sql), `rejected: ${sql.slice(0, 80)}`).not.toThrow();
      }
    }
  });
});

describe('statement classification', () => {
  it('returns each explorer label for the builder that carries it', () => {
    const statements = everyErrorSetStatement(BUILDER_SCHEMA, [2], [10]);
    const classes = statements.map(({ sql }) => classifyStatement(sql));
    console.log(`classes: ${classes.join(' | ')}`);
    expect(new Set(classes)).toEqual(new Set(Object.values(ERROR_EXPLORER_STATEMENT_LABELS)));
    statements.forEach(({ sql }) => expect(classifyStatement(sql)).toBe(readStatementLabel(sql)));
  });

  it('keeps the legacy classes for the three texts the frozen oracle sends', async () => {
    const recorded: string[] = [];
    const recordingExecutor = {
      executeQuery: async (sql: string) => {
        recorded.push(sql);
        return [];
      }
    };
    await oracle.fetchGroupedErrorRows(recordingExecutor as never, BUILDER_SCHEMA, 1, [2]);
    const classes = recorded.map(classifyStatement);
    console.log(`oracle statements: ${recorded.length}; classes: ${classes.join(', ')}`);
    expect([...classes].sort()).toEqual([...ORACLE_STATEMENT_CLASSES].sort());
  });

  it('classifies the frozen oracle outside-partner lookup as an oracle shape, and only that statement', async () => {
    const OUTSIDE_PARTNER_ID = 99;
    const SELECTED_ID = 10;
    const recorded: string[] = [];
    const fakeRawRow = {
      CoreMeasurementID: SELECTED_ID,
      PlotID: 1,
      CensusID: 2,
      CoreStemGUID: 5,
      ErrorSource: 'ingestion',
      ErrorCode: 'FAKE_CODE',
      DisplayMessage: 'fake message',
      ValidationCriteria: null,
      ProcedureName: null
    };
    const oracleExecutor = {
      executeQuery: async (sql: string) => {
        recorded.push(sql);
        if (classifyStatement(sql) === 'raw-rows') return [fakeRawRow];
        if (classifyStatement(sql) === 'duplicate-groups') return [{ TreeTag: 'T', StemTag: '1', MeasurementIDs: `${SELECTED_ID},${OUTSIDE_PARTNER_ID}` }];
        return [];
      }
    };
    await oracle.buildErrorExplorerDetails(oracleExecutor as never, { schema: BUILDER_SCHEMA, plotID: 1, censusID: 2 }, SELECTED_ID);
    const classes = recorded.map(classifyStatement);
    console.log(`oracle details statements: ${recorded.length}; classes: ${classes.join(', ')}`);
    expect(classes.filter(statementClass => statementClass === ORACLE_OUTSIDE_ROWS_STATEMENT)).toHaveLength(1);
    expect(classes, 'the lookup was the only statement that was unlabelled before').not.toContain('unlabelled');
    const outsideSql = recorded[classes.indexOf(ORACLE_OUTSIDE_ROWS_STATEMENT)];
    expect(classifyStatement(`${outsideSql} OR 1 = 1`), 'an appended clause is no longer the exact shape').toBe('unlabelled');
    expect(classifyStatement(outsideSql.replace('measurementssummary', 'coremeasurements'))).toBe('unlabelled');
    expect(classifyStatement('SELECT 1')).toBe('unlabelled');
  });

  it('names the shared active-count statement, so the statement log never shows it as unlabelled', () => {
    const { sql } = buildActiveMeasurementCountQuery(BUILDER_SCHEMA, 1, [2, 3]);
    console.log(`active-count text classified as ${classifyStatement(sql)}`);
    expect(classifyStatement(sql)).toBe(ACTIVE_COUNT_STATEMENT);
  });

  it('classifies a statement with no label and no legacy shape as unlabelled', () => {
    expect(classifyStatement('SELECT 1')).toBe('unlabelled');
  });

  it('does not read a membership probe as an explorer statement, so it never counts toward the nine texts', () => {
    for (const build of [buildF2MembershipProbe, buildF1MembershipProbe]) {
      const { sql } = build({ schema: BUILDER_SCHEMA, plotID: 1, censusIDs: [2] });
      expect(readStatementLabel(sql)).toBeNull();
    }
  });
});

describe('m1Summary', () => {
  it('reports 1.1 as not triggered', () => {
    expect(m1Summary([10, 11, 12], [10, 10, 10])).toMatchObject({ m1Status: 'comparable', m1Ratio: 1.1, m1Triggered: false });
  });
  it('reports 1.3 as triggered', () => {
    expect(m1Summary([13, 13, 13], [10, 10, 10])).toMatchObject({ m1Status: 'comparable', m1Ratio: 1.3, m1Triggered: true });
  });
});

describe('page scenarios on a multi-chunk scope', () => {
  it.each([
    { totalRows: 0, last: 0, pastTheEnd: 1 },
    { totalRows: 1, last: 0, pastTheEnd: 1 },
    { totalRows: 25, last: 0, pastTheEnd: 1 },
    { totalRows: 26, last: 1, pastTheEnd: 2 },
    { totalRows: 50, last: 1, pastTheEnd: 2 },
    { totalRows: 51, last: 2, pastTheEnd: 3 }
  ])('totalRows $totalRows: last page $last, one past it $pastTheEnd', ({ totalRows, last, pastTheEnd }) => {
    expect(lastPageNumber(totalRows, 25)).toBe(last);
    expect(pastTheEndPageNumber(totalRows, 25)).toBe(pastTheEnd);
  });

  it.each([
    { censusCount: 1, censuses: 1, censusChunks: 1 },
    { censusCount: 8, censuses: 8, censusChunks: 1 },
    { censusCount: 9, censuses: 9, censusChunks: 2 },
    { censusCount: 26, censuses: 26, censusChunks: 4 }
  ])('describes $censusCount censuses as $censusChunks chunks', ({ censusCount, censuses, censusChunks }) => {
    expect(describeCensusScope(range(censusCount))).toEqual({ censuses, censusChunks });
  });
});

describe('membership probe timing', () => {
  const SHOW_MS = 40;
  const STRINGIFY_MS = 25;
  const SQL_MS_PER_CALL = [1, 2, 3, 4];
  const EXPECTED_SQL_MS = 10;
  const SHOW_CALLS_PER_STATEMENT = 2;

  it.each([
    ['F2', buildF2MembershipProbe],
    ['F1', buildF1MembershipProbe]
  ])('%s: times the SQL alone, not the SHOW SESSION STATUS reads or the row serialisation around it', async (_name, build) => {
    let clockMs = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clockMs);
    let sqlCalls = 0;
    const connection = {
      query: vi.fn(async () => {
        clockMs += SHOW_MS;
        return [[{ Value: '100' }], []];
      }),
      execute: vi.fn(async () => {
        clockMs += SQL_MS_PER_CALL[sqlCalls++ % SQL_MS_PER_CALL.length];
        const row = {
          CoreMeasurementID: sqlCalls,
          ErrorID: 1,
          PriorCensusID: null,
          PriorDBH: null,
          PriorHOM: null,
          toJSON() {
            clockMs += STRINGIFY_MS;
            return { CoreMeasurementID: sqlCalls };
          }
        };
        return [[row], []];
      })
    };
    const executor = createSerializedExecutor(connection as never);
    await executor.calibrateBytes();
    const showCallsBeforeProbe = connection.query.mock.calls.length;
    const scope = { schema: BUILDER_SCHEMA, plotID: 1, censusIDs: range(MULTI_CHUNK_CENSUS_COUNT) };
    const sample = await runMembershipProbeRepetition(scope, build, createTimedProbeExecutor(executor));
    const showCallsDuringProbe = connection.query.mock.calls.length - showCallsBeforeProbe;
    console.log(`SHOW calls during probe=${showCallsDuringProbe}; wall clock advanced to ${clockMs} ms; reported durationMs=${sample.durationMs}`);
    expect(showCallsDuringProbe, 'the telemetry must really run inside each call for this test to mean anything').toBe(
      chunkCensusIDs(scope.censusIDs).length * SHOW_CALLS_PER_STATEMENT
    );
    expect(clockMs).toBeGreaterThan(EXPECTED_SQL_MS + showCallsDuringProbe * SHOW_MS);
    expect(sample.durationMs).toBe(EXPECTED_SQL_MS);
  });
});

describe('distinct signature counting', () => {
  const REPEATED_SIGNATURE = { ErrorTypeKeys: '3,7', SignatureComplete: 1, HasDuplicate: 0, HasSameBatch: 1 };
  const SECOND_SIGNATURE = { ErrorTypeKeys: '3', SignatureComplete: 1, HasDuplicate: 0, HasSameBatch: 0, MeasurementCount: 5 };
  const CHUNK_WITH_SECOND_SIGNATURE = 2;
  const EXPECTED_CHUNKS = 4;

  it('merges the histogram rows of 26 censuses: one signature in four chunks counts once, a second signature counts once', async () => {
    const callsByLabel = new Map<string | null, number>();
    const executor = {
      executeQuery: async (sql: string) => {
        const label = readStatementLabel(sql);
        const chunkIndex = callsByLabel.get(label) ?? 0;
        callsByLabel.set(label, chunkIndex + 1);
        return [{ ...REPEATED_SIGNATURE, MeasurementCount: chunkIndex + 1 }, ...(chunkIndex === CHUNK_WITH_SECOND_SIGNATURE ? [SECOND_SIGNATURE] : [])];
      }
    };
    const counts = await countDistinctSignatures(executor, BUILDER_SCHEMA, 1, range(MULTI_CHUNK_CENSUS_COUNT));
    console.log(`distinct signatures ${JSON.stringify(counts)}; calls per label ${JSON.stringify([...callsByLabel])}`);
    expect(counts).toEqual({ withFlags: 2, withoutFlags: 2 });
    expect(callsByLabel.get(ERROR_EXPLORER_STATEMENT_LABELS.histogramWithFlags)).toBe(EXPECTED_CHUNKS);
    expect(callsByLabel.get(ERROR_EXPLORER_STATEMENT_LABELS.histogramWithoutFlags)).toBe(EXPECTED_CHUNKS);
  });
});

describe('a full measurement run over a 26-census scope (fake database)', () => {
  const PLOT_ID = 1;
  const RUNS = 1;
  const PAGE_LIMIT_PARAM_FIRST_PAGE = '25';
  const PAGE_LIMIT_PARAM_PAST_THE_END = '50';
  const SETTLE_MS = 1;
  const ZERO_TOTALS = { TotalRows: 0, ValidationRows: 0, IngestionRows: 0, ContradictionRows: 0, DuplicateTagStemRows: 0, SameBatchConflictRows: 0 };
  const isProbe = (sql: string) => sql.startsWith(MEMBERSHIP_PROBE_LABELS.f1) || sql.startsWith(MEMBERSHIP_PROBE_LABELS.f2);

  function databaseFake() {
    const base = fake();
    const executed: Array<{ sql: string; params: unknown[] }> = [];
    base.connection.query.mockResolvedValue([[{ readOnly: 1, Value: '1' }], []]);
    base.connection.execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
      executed.push({ sql, params });
      if (isProbe(sql)) {
        await new Promise(resolve => setTimeout(resolve, SETTLE_MS));
        const censusIDs = params.slice(1, 1 + CENSUS_LIST_SIZE).filter(param => param !== null);
        return [censusIDs.map(censusID => ({ CoreMeasurementID: Number(censusID), ErrorID: 1, PriorCensusID: null, PriorDBH: null, PriorHOM: null })), []];
      }
      if (readStatementLabel(sql) === ERROR_EXPLORER_STATEMENT_LABELS.totals) return [[ZERO_TOTALS], []];
      if (sql.includes('AS maxLen')) return [[{ maxLen: 1_048_576 }], []];
      if (sql.includes('SET_VAR')) return [[{ probe: 4 }], []];
      if (sql.includes('COUNT(*) AS n')) return [[{ n: 0 }], []];
      return [[], []];
    });
    return { ...base, executed };
  }

  async function runScope() {
    const f = databaseFake();
    const censusArgument = range(MULTI_CHUNK_CENSUS_COUNT).join(',');
    const result = await runTimingCli(['--schema', BUILDER_SCHEMA, '--plot', String(PLOT_ID), '--census', censusArgument, '--runs', String(RUNS)], f.deps);
    const output = f.stdout.join('\n');
    const summaryLine = output.split('\n').find(line => line.startsWith('ERRORS_EXPLORER_TIMING_SUMMARY '));
    const summary = summaryLine ? JSON.parse(summaryLine.slice('ERRORS_EXPLORER_TIMING_SUMMARY '.length)) : null;
    return { f, result, output, summary };
  }

  it('prints the census and chunk counts next to the page scenarios and carries them in the summary', async () => {
    const { result, output, summary, f } = await runScope();
    console.log(
      `exit=${result.exitCode} stderr=${JSON.stringify(f.stderr)}\n${output
        .split('\n')
        .filter(line => /scope|queryPastTheEnd run|queryFlatPage0 run/.test(line))
        .join('\n')}`
    );
    expect(result.exitCode).toBe(0);
    expect(output).toContain('queryFlatPage0 scope: 26 censuses, 4 census chunks');
    expect(output).toContain('queryPastTheEnd scope: 26 censuses, 4 census chunks');
    expect(summary.scope).toEqual({ censuses: 26, censusChunks: 4 });
  });

  it('runs queryPastTheEnd against the oracle and finds the arms identical', async () => {
    const { output, summary } = await runScope();
    expect(output).toContain('queryPastTheEnd run 1: identical');
    expect(Object.keys(summary.scenarios)).toContain('queryPastTheEnd');
    expect(summary.comparisons.queryPastTheEnd).toEqual([expect.objectContaining({ run: 1, identical: true })]);
  });

  it('asks every census chunk for the page one past the last, a wider prefix than the first page', async () => {
    const { f } = await runScope();
    const pageStatements = f.executed.filter(({ sql }) => readStatementLabel(sql) === ERROR_EXPLORER_STATEMENT_LABELS.page);
    const limits = pageStatements.map(({ params }) => params[params.length - 2]);
    const chunkCount = chunkCensusIDs(range(MULTI_CHUNK_CENSUS_COUNT)).length;
    const roundsPerScenario = RUNS + 1;
    console.log(`page statements ${pageStatements.length}; limits seen ${JSON.stringify([...new Set(limits)])}`);
    expect(limits.filter(limit => limit === PAGE_LIMIT_PARAM_PAST_THE_END)).toHaveLength(chunkCount * roundsPerScenario);
    expect(limits).toContain(PAGE_LIMIT_PARAM_FIRST_PAGE);
  });

  it('classifies every recorded statement, keeps probes out of the text budget and reports the probe block', async () => {
    const { output, summary, f } = await runScope();
    const explorerTexts = new Set(
      f.executed.map(({ sql }) => sql).filter(sql => Object.values(ERROR_EXPLORER_STATEMENT_LABELS).some(label => sql.startsWith(label)))
    );
    const probeCalls = f.executed.filter(({ sql }) => isProbe(sql));
    console.log(
      `explorer texts=${explorerTexts.size} budget=${JSON.stringify(summary.budget)} probe calls=${probeCalls.length}\n${output
        .split('\n')
        .filter(line => line.startsWith('m1Probe'))
        .join('\n')}`
    );
    expect(output).not.toMatch(/: unlabelled, /);
    expect(summary.unlabelledStatements).toBe(0);
    expect(probeCalls.length).toBeGreaterThan(0);
    expect(summary.budget).toEqual({ count: explorerTexts.size, status: 'PASS' });
    expect(summary.m1).toMatchObject({ m1Status: 'comparable', f2RowCount: MULTI_CHUNK_CENSUS_COUNT, f1RowCount: MULTI_CHUNK_CENSUS_COUNT });
    expect(summary.m1.m1Ratio).toBeGreaterThan(0);
    expect(typeof summary.m1.m1Triggered).toBe('boolean');
  });

  it('marks the probe inconclusive and carries on when a probe statement times out', async () => {
    const f = databaseFake();
    const answer = f.connection.execute.getMockImplementation()!;
    const TIMEOUT_ERRNO = 3024;
    f.connection.execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (isProbe(sql)) throw { errno: TIMEOUT_ERRNO, code: 'ER_QUERY_TIMEOUT' };
      return answer(sql, params);
    });
    const args = ['--schema', BUILDER_SCHEMA, '--plot', String(PLOT_ID), '--census', range(MULTI_CHUNK_CENSUS_COUNT).join(','), '--runs', String(RUNS)];
    const result = await runTimingCli(args, f.deps);
    const output = f.stdout.join('\n');
    const summary = JSON.parse(
      output
        .split('\n')
        .find(line => line.startsWith('ERRORS_EXPLORER_TIMING_SUMMARY '))!
        .slice('ERRORS_EXPLORER_TIMING_SUMMARY '.length)
    );
    console.log(`exit=${result.exitCode}; m1 line: ${output.split('\n').find(line => line.startsWith('m1Probe'))}; summary m1: ${JSON.stringify(summary.m1)}`);
    expect(result.exitCode).toBe(0);
    expect(output).toContain('m1Probe: timed out after');
    expect(summary.m1).toEqual({ m1Status: 'inconclusive', diagnostic: expect.any(String) });
  });

  it('explains a page statement over the prepared protocol, because its LIMIT and OFFSET are bound strings', async () => {
    const f = databaseFake();
    const args = ['--schema', BUILDER_SCHEMA, '--plot', String(PLOT_ID), '--census', '2', '--runs', String(RUNS), '--explain'];
    const result = await runTimingCli(args, f.deps);
    const explained = f.executed.filter(({ sql }) => sql.startsWith('EXPLAIN FORMAT=TREE'));
    const explainedViaText = f.connection.query.mock.calls.filter(([sql]) => String(sql).startsWith('EXPLAIN'));
    console.log(`exit=${result.exitCode}; explained over execute: ${explained.length}; over query: ${explainedViaText.length}`);
    expect(result.exitCode).toBe(0);
    expect(explained.some(({ sql }) => sql.includes(ERROR_EXPLORER_STATEMENT_LABELS.page))).toBe(true);
    expect(explainedViaText).toHaveLength(0);
  });

  it('reports a timed-out signature histogram, carries null, and still runs the scenarios', async () => {
    const f = databaseFake();
    const answer = f.connection.execute.getMockImplementation()!;
    let histogramCalls = 0;
    f.connection.execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (readStatementLabel(sql) === ERROR_EXPLORER_STATEMENT_LABELS.histogramWithFlags && histogramCalls++ === 0) {
        throw { errno: 3024, code: 'ER_QUERY_TIMEOUT' };
      }
      return answer(sql, params);
    });
    const args = ['--schema', BUILDER_SCHEMA, '--plot', String(PLOT_ID), '--census', range(MULTI_CHUNK_CENSUS_COUNT).join(','), '--runs', String(RUNS)];
    const result = await runTimingCli(args, f.deps);
    const output = f.stdout.join('\n');
    const summary = JSON.parse(
      output
        .split('\n')
        .find(line => line.startsWith('ERRORS_EXPLORER_TIMING_SUMMARY '))!
        .slice('ERRORS_EXPLORER_TIMING_SUMMARY '.length)
    );
    console.log(
      `exit=${result.exitCode}; line: ${output.split('\n').find(line => line.startsWith('distinct signatures'))}; summary: ${JSON.stringify(summary.distinctSignatures)}`
    );
    expect(result.exitCode).toBe(0);
    expect(output).toContain('distinct signatures: timed out after');
    expect(summary.distinctSignatures).toEqual({ withFlags: null, withoutFlags: null });
    expect(output).toContain('queryFlatPage0 run 1: identical');
  });

  it('propagates a probe error that is not a timeout, naming only the probe label', async () => {
    const f = databaseFake();
    const answer = f.connection.execute.getMockImplementation()!;
    const LEAKING_MESSAGE = "SELECT command denied to user 'u'@'h'";
    f.connection.execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (isProbe(sql)) throw { errno: 1142, code: 'ER_TABLEACCESS_DENIED_ERROR', message: LEAKING_MESSAGE };
      return answer(sql, params);
    });
    const args = ['--schema', BUILDER_SCHEMA, '--plot', String(PLOT_ID), '--census', range(MULTI_CHUNK_CENSUS_COUNT).join(','), '--runs', String(RUNS)];
    const result = await runTimingCli(args, f.deps);
    const stderr = f.stderr.join('\n');
    console.log(`exit=${result.exitCode}; stderr=${stderr}`);
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain(`m1Probe/${MEMBERSHIP_PROBE_LABELS.f2}`);
    expect(stderr).not.toContain("'u'@'h'");
    expect(f.stdout.join('\n')).not.toContain("'u'@'h'");
  });

  it('names the serial page load pageLoadSerial, drops the old pageLoad field, and reports the scenarios a scope without errors cannot run', async () => {
    const { output, summary } = await runScope();
    console.log(
      output
        .split('\n')
        .filter(line => /unavailable|pageLoad/.test(line))
        .join('\n')
    );
    expect(summary.pageLoadSerial).toBeDefined();
    expect(Object.keys(summary)).not.toContain('pageLoad');
    expect(output).toContain('queryTopGroupPage0: unavailable for this scope');
    expect(output).toContain('detailsWithOutsidePartner: unavailable for this scope');
    expect(Object.keys(summary.scenarios).sort()).toEqual(['facetsDefault', 'messageCounts', 'queryFlatPage0', 'queryPastTheEnd']);
    expect(summary.reportOnly).toEqual(expect.arrayContaining(['queryPastTheEnd', 'queryTopGroupSorted']));
  });

  it('merges the histogram chunks into the distinct signature count', async () => {
    const { output } = await runScope();
    expect(output).toMatch(/distinct signatures: with flags \d+, without flags \d+/);
  });
});
