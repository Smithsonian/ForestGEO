import { describe, expect, it, vi } from 'vitest';
import { AZURE_HOST } from './lib/schema-cli';
import { cleanupTimingConnections } from '@/tests/setup/stricttestdatabasecleanup';
import {
  groupIntoWaves,
  criticalPathEstimate,
  diffFieldPaths,
  groupKeysEqual,
  textBudget,
  pageLoadEstimate,
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
  it('checks the text budget', () => {
    expect(textBudget(Array.from({ length: 9 }, (_, i) => String(i)))).toEqual({ count: 9, status: 'PASS' });
    expect(textBudget(Array.from({ length: 10 }, (_, i) => String(i)))).toEqual({ count: 10, status: 'FAIL' });
  });
  it('computes page load from separate operations', () => {
    const query = [
      { issuedAt: 0, startedAt: 0, endedAt: 5 },
      { issuedAt: 5, startedAt: 5, endedAt: 6 }
    ];
    const facets = [
      { issuedAt: 0, startedAt: 0, endedAt: 1 },
      { issuedAt: 1, startedAt: 1, endedAt: 11 }
    ];
    expect(pageLoadEstimate(query, facets, 0, 0)).toBe(11);
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

it('compares dates by their serialized value', () => {
  const comparison = compareResponses({ date: new Date('2020-01-01T00:00:00Z') }, { date: new Date('2021-01-01T00:00:00Z') });
  expect(comparison.paths).toEqual(['$.date']);
  expect(comparison.identical).toBe(false);
});
