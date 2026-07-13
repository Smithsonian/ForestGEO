import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updatePostValidationLastRun } from './postvalidationlastrun';

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

const SCHEMA = 'forestgeo_testing';
const RUN = {
  queryID: 7,
  plotID: 3,
  censusID: 11,
  ranAt: '2025-01-02 03:04:05',
  status: 'success' as const,
  result: '[{"RowID":1}]'
};

function unknownColumnError(shape: 'code' | 'errno'): Error {
  const error = new Error("Unknown column 'LastRunPlotID' in 'field list'") as Error & { code?: string; errno?: number };
  if (shape === 'code') error.code = 'ER_BAD_FIELD_ERROR';
  else error.errno = 1054;
  return error;
}

function makeConnectionManager(executeQuery: ReturnType<typeof vi.fn>) {
  return { executeQuery } as any;
}

describe('updatePostValidationLastRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs a single scoped UPDATE (with LastRunPlotID/LastRunCensusID) on migrated schemas', async () => {
    const executeQuery = vi.fn(async () => undefined);
    await updatePostValidationLastRun(makeConnectionManager(executeQuery), SCHEMA, RUN);

    expect(executeQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = executeQuery.mock.calls[0];
    expect(String(sql)).toMatch(/UPDATE `forestgeo_testing`\.postvalidationqueries/i);
    expect(String(sql)).toMatch(/LastRunPlotID = \?, LastRunCensusID = \?/i);
    expect(params).toEqual(['2025-01-02 03:04:05', '[{"RowID":1}]', 'success', 3, 11, 7]);
  });

  it.each(['code', 'errno'] as const)('falls back to the unscoped legacy UPDATE when the scope columns are missing (%s shape)', async shape => {
    const executeQuery = vi.fn(async (sql: string) => {
      if (/LastRunPlotID/i.test(sql)) throw unknownColumnError(shape);
      return undefined;
    });

    await updatePostValidationLastRun(makeConnectionManager(executeQuery), SCHEMA, RUN);

    expect(executeQuery).toHaveBeenCalledTimes(2);
    const [fallbackSql, fallbackParams] = executeQuery.mock.calls[1];
    expect(String(fallbackSql)).toMatch(/UPDATE `forestgeo_testing`\.postvalidationqueries/i);
    expect(String(fallbackSql)).not.toMatch(/LastRunPlotID|LastRunCensusID/i);
    expect(fallbackParams).toEqual(['2025-01-02 03:04:05', '[{"RowID":1}]', 'success', 7]);
  });

  it('rethrows non-unknown-column errors without retrying', async () => {
    const executeQuery = vi.fn(async () => {
      throw new Error('Lock wait timeout exceeded');
    });

    await expect(updatePostValidationLastRun(makeConnectionManager(executeQuery), SCHEMA, RUN)).rejects.toThrow('Lock wait timeout exceeded');
    expect(executeQuery).toHaveBeenCalledTimes(1);
  });

  it('omits LastRunResult when result is undefined and clears it when result is null', async () => {
    const executeQuery = vi.fn(async () => undefined);
    const cm = makeConnectionManager(executeQuery);

    await updatePostValidationLastRun(cm, SCHEMA, { ...RUN, status: 'failure', result: undefined });
    const [failureSql, failureParams] = executeQuery.mock.calls[0];
    expect(String(failureSql)).not.toMatch(/LastRunResult/i);
    expect(failureParams).toEqual(['2025-01-02 03:04:05', 'failure', 3, 11, 7]);

    await updatePostValidationLastRun(cm, SCHEMA, { ...RUN, status: 'failure', result: null });
    const [clearSql, clearParams] = executeQuery.mock.calls[1];
    expect(String(clearSql)).toMatch(/LastRunResult = \?/i);
    expect(clearParams).toEqual(['2025-01-02 03:04:05', null, 'failure', 3, 11, 7]);
  });
});
