import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPResponses } from '@/config/macros';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock('@/auth', () => ({ auth: authMock }));

// ---- Mock SQL security utilities ----
vi.mock('@/lib/db/sqlsecurity', () => ({
  validateSchemaOrThrow: vi.fn(),
  safeFormatQuery: vi.fn((schema, query) => query),
  safeEscapeId: vi.fn((identifier: string) => `\`${identifier}\``)
}));

// ---- Mock ailogger ----
vi.mock('@/ailogger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}));

// ---- Mock mysql2/promise format function ----
vi.mock('mysql2/promise', () => ({
  format: vi.fn((sql, params) => {
    // Mock implementation that properly replaces ?? and ? placeholders in order
    let result = sql;
    params.forEach((param: any) => {
      if (result.includes('??')) {
        result = result.replace('??', param);
      } else if (result.includes('?')) {
        result = result.replace('?', param);
      }
    });
    return result;
  })
}));

// ---- Wrap ConnectionManager BEFORE importing the route ----
vi.mock('@/lib/db/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/lib/db/connectionmanager').catch(() => ({}) as any);

  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance()) ||
    actual?.default ||
    actual;

  // Use existing shared mock instance if present; otherwise make a safe stub.
  const instance = (candidate &&
    typeof candidate.beginTransaction === 'function' &&
    typeof candidate.commitTransaction === 'function' &&
    typeof candidate.rollbackTransaction === 'function' &&
    typeof candidate.executeQuery === 'function' &&
    typeof candidate.closeConnection === 'function' &&
    candidate) || {
    beginTransaction: vi.fn(async () => 'tx-test'),
    commitTransaction: vi.fn(async () => {}),
    rollbackTransaction: vi.fn(async () => {}),
    executeQuery: vi.fn(async () => {}),
    closeConnection: vi.fn(async () => {})
  };

  const getInstance = vi.fn(() => instance);

  return {
    ...actual,
    default: { ...(actual?.default ?? {}), getInstance },
    getInstance
  };
});

// ---- Helpers ----
function makeRequest(url: string) {
  const parsedUrl = new URL(url);
  const body = Object.fromEntries(parsedUrl.searchParams.entries());
  const req: any = new Request(parsedUrl.origin + parsedUrl.pathname, { method: 'POST', body: JSON.stringify(body) });
  req.nextUrl = new URL(url); // Next.js reads request.nextUrl.searchParams
  return req as any;
}

// ---- Import handler AFTER mocks ----
import { POST } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { INTERNAL_SERVER_ERROR_MESSAGE } from '@/lib/errorhelpers';

interface ClearCensusQueryScript {
  censusCountInSchema?: number;
  /** Rows each fixed-data table holds when the route locks it (`SELECT COUNT(*) ... FOR UPDATE`). */
  lockedCounts?: Record<string, number>;
  deletedCounts?: Record<string, number>;
}

/** Answers the census reads, the fixed-data locks and the CALL; every other statement (flags, the summary row) finds nothing to do. */
function scriptClearCensusQueries(exec: ReturnType<typeof vi.spyOn>, script: ClearCensusQueryScript = {}) {
  exec.mockImplementation(async (rawSQL: unknown) => {
    const sql = String(rawSQL);
    if (/SELECT PlotID FROM/i.test(sql)) return [{ PlotID: 1 }];
    if (/MAX\(PlotCensusNumber\)/i.test(sql)) return [{ PlotID: 1, PlotCensusNumber: 2, MaxPlotCensusNumber: 2 }];
    if (/SELECT \* FROM \?\?\.census WHERE CensusID/i.test(sql)) return [{ CensusID: 12, PlotID: 1 }];
    if (/COUNT\(\*\) AS total FROM \?\?\.census$/.test(sql)) return [{ total: script.censusCountInSchema ?? 2 }];
    const lockedTable = /COUNT\(\*\) AS total FROM \?\?\.`(\w+)` FOR UPDATE$/.exec(sql)?.[1];
    if (lockedTable) return [{ total: script.lockedCounts?.[lockedTable] ?? 0 }];
    if (/^CALL /i.test(sql)) return [[{ DeletedMeasurements: 0, ...script.deletedCounts }], {}];
    return [];
  });
}

describe('POST /api/clearcensus', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'admin-user', userStatus: 'global' } });
  });

  it('401 when no session and does not call ConnectionManager', async () => {
    authMock.mockResolvedValueOnce(null);
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction');

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.UNAUTHORIZED);
    expect(begin).not.toHaveBeenCalled();
  });

  it('403 when non-admin session and does not call ConnectionManager', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'user', userStatus: 'field crew' } });
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction');

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.FORBIDDEN);
    expect(begin).not.toHaveBeenCalled();
  });

  it('400 when schema, censusID, or type is missing', async () => {
    // missing all
    let res = await POST(makeRequest('http://localhost/api/clearcensus'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(await res.text()).toMatch(/Missing required parameters/i);

    // missing censusID and type
    res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(await res.text()).toMatch(/Missing required parameters/i);

    // missing schema and type
    res = await POST(makeRequest('http://localhost/api/clearcensus?censusID=7'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(await res.text()).toMatch(/Missing required parameters/i);

    // missing type
    res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=7'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(await res.text()).toMatch(/Missing required parameters/i);
  });

  it('200 on success: takes the site lock before the locked latest-census check, then commits once', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-1');
    const acquireLock = vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(true);
    const exec = vi.spyOn(cm, 'executeQuery');
    scriptClearCensusQueries(exec);
    const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);
    const rollback = vi.spyOn(cm, 'rollbackTransaction');
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.OK);
    expect(await res.json()).toEqual({ message: 'Census cleared successfully' });
    expect(begin).toHaveBeenCalledTimes(1);

    const statements = exec.mock.calls.map(call => String(call[0]));
    expect(statements[0]).toMatch(/SELECT PlotID FROM myschema\.census/i);
    expect(acquireLock).toHaveBeenCalledWith('clear-census:myschema', 'tx-1', 0);
    expect(statements[1]).toMatch(/MAX\(PlotCensusNumber\)/i);
    expect(statements[1]).toMatch(/FOR UPDATE/i);
    expect(acquireLock.mock.invocationCallOrder[0]).toBeLessThan(exec.mock.invocationCallOrder[1]);

    expect(commit).toHaveBeenCalledWith('tx-1');
    expect(rollback).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  function changelogInserts(exec: ReturnType<typeof vi.spyOn>): unknown[][] {
    return exec.mock.calls.filter(call => /INSERT INTO \?\?\.unifiedchangelog/.test(String(call[0]))).map(call => call[1] as unknown[]);
  }

  it('full on the last census locks every fixed-data table, then records one census DELETE summary row with every count, after the CALL', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-full');
    vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(true);
    const exec = vi.spyOn(cm, 'executeQuery');
    scriptClearCensusQueries(exec, {
      censusCountInSchema: 1,
      lockedCounts: { quadrats: 5, species: 3 },
      deletedCounts: { DeletedMeasurements: 40, DeletedQuadrats: 5, DeletedSpecies: 3, DeletedFamily: 0 }
    });
    const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=full'));

    expect(res.status, await res.clone().text()).toBe(HTTPResponses.OK);
    expect(commit).toHaveBeenCalledWith('tx-full');
    const statements = exec.mock.calls.map(call => String(call[0]));
    console.log(
      '[clearcensus full] statements:',
      statements.map(sql => sql.replace(/\s+/g, ' ').slice(0, 90))
    );
    const callIndex = statements.findIndex(sql => /^CALL /.test(sql));
    const lockedTables = statements.flatMap((sql, index) => {
      const table = /FROM \?\?\.`(\w+)` FOR UPDATE$/.exec(sql)?.[1];
      return table && index < callIndex ? [table] : [];
    });
    expect(lockedTables, 'every fixed-data table is locked before the procedure empties it').toEqual([
      'attributes',
      'personnel',
      'roles',
      'quadrats',
      'species',
      'specieslimits',
      'genus',
      'family',
      'reference'
    ]);
    const inserts = changelogInserts(exec);
    expect(inserts, 'one summary row, not one per deleted row').toHaveLength(1);
    const [tableName, recordID, operation, oldRowState, newRowState, changedBy, plotID, censusID] = inserts[0];
    expect([tableName, recordID, operation, newRowState, changedBy, plotID, censusID]).toEqual(['census', '12', 'DELETE', null, 'admin-user', 1, 12]);
    expect(JSON.parse(String(oldRowState))).toEqual({
      CensusID: 12,
      PlotID: 1,
      summaryKind: 'census-delete',
      clearType: 'full',
      deletedRowCounts: { coremeasurements: 40, quadrats: 5, species: 3, family: 0 }
    });
    const summaryIndex = statements.findIndex(sql => /INSERT INTO \?\?\.unifiedchangelog/.test(sql));
    expect(summaryIndex, 'the counts come from the CALL, so the summary follows it').toBeGreaterThan(callIndex);
  });

  it('full with other censuses left locks no fixed data', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-not-last');
    vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(true);
    const exec = vi.spyOn(cm, 'executeQuery');
    scriptClearCensusQueries(exec, { censusCountInSchema: 3, deletedCounts: { DeletedMeasurements: 2 } });
    vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=full'));

    expect(res.status).toBe(HTTPResponses.OK);
    const statements = exec.mock.calls.map(call => String(call[0]));
    expect(
      statements.filter(sql => /FOR UPDATE$/.test(sql) && /FROM \?\?\.`/.test(sql)),
      statements.join('\n')
    ).toEqual([]);
  });

  it.each([
    ['a fixed-data row was added after the lock', { censusCountInSchema: 1, lockedCounts: { attributes: 2 }, deletedCounts: { DeletedAttributes: 3 } }],
    ['the procedure emptied fixed data the route did not see as a last-census clear', { censusCountInSchema: 2, deletedCounts: { DeletedQuadrats: 5 } }]
  ])('409 and rollback, with no summary row, when %s', async (_case, script) => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-changed');
    vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(true);
    const exec = vi.spyOn(cm, 'executeQuery');
    scriptClearCensusQueries(exec, script);
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction');

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=full'));

    expect(res.status).toBe(HTTPResponses.CONFLICT);
    expect((await res.json()).error).toMatch(/Nothing was deleted/);
    expect(rollback).toHaveBeenCalledWith('tx-changed');
    expect(commit).not.toHaveBeenCalled();
    expect(changelogInserts(exec)).toHaveLength(0);
  });

  it('msmts records the measurement count alone', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-msmts');
    vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(true);
    const exec = vi.spyOn(cm, 'executeQuery');
    scriptClearCensusQueries(exec, { deletedCounts: { DeletedMeasurements: 7 } });
    vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.OK);
    const inserts = changelogInserts(exec);
    expect(inserts).toHaveLength(1);
    const summary = JSON.parse(String(inserts[0][3]));
    expect(summary.clearType).toBe('msmts');
    expect(summary.deletedRowCounts).toEqual({ coremeasurements: 7 });
  });

  it('500 and rollback, with no summary row, when the procedure reports no delete counts', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-old-procedure');
    vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(true);
    const exec = vi.spyOn(cm, 'executeQuery');
    scriptClearCensusQueries(exec);
    const defaultAnswer = exec.getMockImplementation()!;
    exec.mockImplementation(async (rawSQL: unknown, ...rest: unknown[]) => (/^CALL /i.test(String(rawSQL)) ? [{}] : defaultAnswer(rawSQL, ...rest)));
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction');

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(rollback).toHaveBeenCalledWith('tx-old-procedure');
    expect(commit).not.toHaveBeenCalled();
    expect(changelogInserts(exec)).toHaveLength(0);
  });

  it('500 on DB error: rolls back with transaction id and returns error text', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-err');
    vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(true);
    const exec = vi
      .spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([{ PlotID: 1 }])
      .mockResolvedValueOnce([{ PlotID: 1, PlotCensusNumber: 2, MaxPlotCensusNumber: 2 }])
      .mockRejectedValueOnce(new Error('boom'));
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction');
    const close = vi.spyOn(cm, 'closeConnection').mockResolvedValueOnce(undefined);

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=99&type=full'));

    expect(begin).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(3);
    expect(rollback).toHaveBeenCalledWith('tx-err');
    expect(commit).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);

    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: INTERNAL_SERVER_ERROR_MESSAGE });
  });

  it.each(['measurements', 'attributes', 'personnel', 'quadrats'])('400 for type %s, which has no stored procedure, before any SQL runs', async type => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction');

    const res = await POST(makeRequest(`http://localhost/api/clearcensus?schema=s1&censusID=5&type=${type}`));

    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(await res.json()).toEqual({ error: 'Invalid census type', validTypes: ['msmts', 'full'] });
    expect(begin).not.toHaveBeenCalled();
  });

  it('400 when invalid type is provided', async () => {
    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=5&type=invalid'));
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    const text = await res.text();
    expect(text).toMatch(/Invalid census type/i);
  });

  it('400 when censusID is not a strict positive integer', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction');

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12abc&type=msmts'));

    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(begin).not.toHaveBeenCalled();
  });

  it('409 when the requested census is not the latest for its plot; rolls back after the locked guard without calling the procedure', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-409');
    const acquireLock = vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(true);
    const exec = vi
      .spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([{ PlotID: 1 }])
      .mockResolvedValueOnce([{ PlotID: 1, PlotCensusNumber: 1, MaxPlotCensusNumber: 2 }]);
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction');

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.CONFLICT);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[1][2]).toBe('tx-409');
    expect(acquireLock).toHaveBeenCalledWith('clear-census:myschema', 'tx-409', 0);
    expect(rollback).toHaveBeenCalledWith('tx-409');
    expect(commit).not.toHaveBeenCalled();
  });

  it('404 when the census does not exist; rolls back the guard transaction without calling the procedure', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-404');
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([]);
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction');

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.NOT_FOUND);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith('tx-404');
    expect(commit).not.toHaveBeenCalled();
  });

  it('takes one site-wide lock, so clears of two different plots exclude each other (#507: clearcensusfull counts every plot)', async () => {
    const cm = (ConnectionManager as any).getInstance();
    const acquireLock = vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValue(false);
    vi.spyOn(cm, 'beginTransaction').mockResolvedValue('tx-plot');
    vi.spyOn(cm, 'rollbackTransaction').mockResolvedValue(undefined);
    vi.spyOn(cm, 'executeQuery')
      .mockResolvedValueOnce([{ PlotID: 1 }])
      .mockResolvedValueOnce([{ PlotID: 2 }]);

    await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=full'));
    await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=13&type=full'));

    expect(acquireLock.mock.calls.map(call => call[0])).toEqual(['clear-census:myschema', 'clear-census:myschema']);
  });

  it('409 when another clear holds the site lock; it never runs the latest-census check or procedure', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-locked');
    const acquireLock = vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(false);
    const exec = vi.spyOn(cm, 'executeQuery').mockResolvedValueOnce([{ PlotID: 4 }]);
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction');

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.CONFLICT);
    expect(acquireLock).toHaveBeenCalledWith('clear-census:myschema', 'tx-locked', 0);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith('tx-locked');
    expect(commit).not.toHaveBeenCalled();
  });
});
