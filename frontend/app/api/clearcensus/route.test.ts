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
import { CLEAR_CENSUS_CALLER_OWNS_TRANSACTION_SQL, CLEAR_CENSUS_CLEAR_CALLER_TRANSACTION_SQL } from '@/lib/census/clear-census-audit';

const AUDITED_CENSUS_ROW = { CensusID: 12, PlotID: 1, PlotCensusNumber: 2, Description: 'second census' };

interface ClearCensusQueryScript {
  censusRow?: Record<string, unknown>;
  referenceRows?: Record<string, Record<string, unknown>[]>;
  referenceRowsRemainingAfterCall?: Record<string, Record<string, unknown>[]>;
  /** Rows of the census the measurement lock sees, and the procedure's own delete counts. */
  lockedMeasurements?: number;
  censusCountInSchema?: number;
  deletedCounts?: Record<string, number>;
  auditFailure?: Error;
}

/** Answers each statement the clear flow sends by what it is, not by its position. */
function scriptClearCensusQueries(exec: ReturnType<typeof vi.spyOn>, script: ClearCensusQueryScript = {}) {
  let procedureCalled = false;
  exec.mockImplementation(async (rawSQL: unknown) => {
    const sql = String(rawSQL);
    if (/SELECT PlotID FROM/i.test(sql)) return [{ PlotID: 1 }];
    if (/MAX\(PlotCensusNumber\)/i.test(sql)) return [{ PlotID: 1, PlotCensusNumber: 2, MaxPlotCensusNumber: 2 }];
    if (/SELECT \* FROM \?\?\.census WHERE CensusID/i.test(sql)) return [script.censusRow ?? AUDITED_CENSUS_ROW];
    if (/COUNT\(\*\) AS total FROM \?\?\.coremeasurements WHERE CensusID = \? FOR UPDATE/.test(sql)) return [{ total: script.lockedMeasurements ?? 3 }];
    if (/COUNT\(\*\) AS total FROM \?\?\.census$/.test(sql)) return [{ total: script.censusCountInSchema ?? 1 }];
    if (sql.includes('unifiedchangelog')) {
      if (script.auditFailure) throw script.auditFailure;
      return { affectedRows: sql.includes('FROM ??.coremeasurements cm') ? 3 : (sql.match(/\(\?, \?, \?, CONVERT/g)?.length ?? 1) };
    }
    if (/^CALL /i.test(sql)) {
      procedureCalled = true;
      return [[{ DeletedMeasurements: 3, ...script.deletedCounts }], { affectedRows: 0 }];
    }
    const referenceTable = sql.match(/FROM \?\?\.`(\w+)`/)?.[1];
    if (referenceTable) {
      const rows = procedureCalled ? script.referenceRowsRemainingAfterCall?.[referenceTable] : script.referenceRows?.[referenceTable];
      return rows ?? [];
    }
    return {};
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

  it('200 on success: locks the plot, re-checks latest census, audits the census and its measurements, then calls the proc in caller-owned mode and commits once', async () => {
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
    const transactions = exec.mock.calls.map(call => call[2]);
    expect(new Set(transactions), `every statement must run on the route transaction:\n${statements.join('\n---\n')}`).toEqual(new Set(['tx-1']));

    // The target scope is resolved first, then an advisory lock serializes all
    // clears for that plot; the latest guard runs only after the lock is held.
    expect(String(statements[0])).toMatch(/SELECT PlotID FROM myschema\.census/i);
    expect(acquireLock).toHaveBeenCalledWith('clear-census:myschema', 'tx-1', 0);
    expect(statements[1]).toMatch(/MAX\(PlotCensusNumber\)/i);
    expect(statements[1]).toMatch(/FOR UPDATE/i);
    expect(acquireLock.mock.invocationCallOrder[0]).toBeLessThan(exec.mock.invocationCallOrder[1]);

    const measurementAuditIndex = statements.findIndex(sql => sql.includes('unifiedchangelog') && sql.includes('FROM ??.coremeasurements cm'));
    const censusAuditIndex = exec.mock.calls.findIndex(call => String(call[0]).includes('unifiedchangelog') && (call[1] as unknown[])?.[0] === 'census');
    const callIndex = statements.findIndex(sql => /^CALL /i.test(sql));
    expect(measurementAuditIndex, 'measurement deletes must be audited before the CALL removes the rows').toBeGreaterThan(-1);
    expect(measurementAuditIndex).toBeLessThan(callIndex);
    expect(censusAuditIndex).toBeLessThan(callIndex);
    expect(exec.mock.calls[measurementAuditIndex][1]).toEqual(['admin-user', 1, 12, 12]);

    const censusAuditParams = exec.mock.calls[censusAuditIndex][1] as unknown[];
    expect(censusAuditParams.slice(0, 3)).toEqual(['census', '12', 'DELETE']);
    expect(JSON.parse(String(censusAuditParams[3]))).toEqual(AUDITED_CENSUS_ROW);
    expect(censusAuditParams.slice(5)).toEqual(['admin-user', 1, 12]);

    expect(statements[callIndex]).toMatch(/^CALL \?\?\.`clearcensusmsmts`\(\?\)$/);
    expect(exec.mock.calls[callIndex][1]).toEqual([12]);
    expect(statements[callIndex - 1]).toBe(CLEAR_CENSUS_CALLER_OWNS_TRANSACTION_SQL);
    expect(statements[callIndex + 1]).toBe(CLEAR_CENSUS_CLEAR_CALLER_TRANSACTION_SQL);
    expect(
      statements.some(sql => /SELECT \* FROM \?\?\.`species`/.test(sql)),
      'msmts never touches reference data'
    ).toBe(false);

    expect(commit).toHaveBeenCalledWith('tx-1');
    expect(commit.mock.invocationCallOrder[0]).toBeGreaterThan(exec.mock.invocationCallOrder.at(-1)!);
    expect(rollback).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('full: audits, after the CALL, exactly the reference rows the CALL removed, schema-wide (no plot or census)', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-full');
    vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(true);
    const exec = vi.spyOn(cm, 'executeQuery');
    const alive = { Code: 'A', IsActive: 1, Description: 'alive' };
    const keptSpecies = { SpeciesID: 2, SpeciesCode: 'KEEP' };
    scriptClearCensusQueries(exec, {
      referenceRows: { attributes: [alive], species: [{ SpeciesID: 1, SpeciesCode: 'ACRU' }, keptSpecies] },
      referenceRowsRemainingAfterCall: { species: [{ SpeciesID: 2 }] },
      deletedCounts: { DeletedAttributes: 1, DeletedSpecies: 1 }
    });
    const commit = vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=full'));

    expect(res.status).toBe(HTTPResponses.OK);
    const callOrder = exec.mock.calls.findIndex(call => /^CALL /i.test(String(call[0])));
    const referenceAudits = exec.mock.calls
      .map((call, index) => ({ index, sql: String(call[0]), params: (call[1] ?? []) as unknown[] }))
      .filter(entry => entry.sql.includes('unifiedchangelog') && ['attributes', 'species'].includes(String(entry.params[0])));
    expect(referenceAudits.map(entry => entry.params.slice(0, 3))).toEqual([
      ['attributes', 'A', 'DELETE'],
      ['species', '1', 'DELETE']
    ]);
    for (const audit of referenceAudits) {
      expect(audit.index, 'reference rows are audited only once the CALL has removed them').toBeGreaterThan(callOrder);
      expect(audit.params.slice(4)).toEqual(['admin-user', null, null]);
    }
    expect(JSON.parse(String(referenceAudits[0].params[3]))).toEqual(alive);
    expect(commit).toHaveBeenCalledWith('tx-full');
  });

  it.each([
    ['a measurement inserted after the lock', { deletedCounts: { DeletedMeasurements: 4 } }, 'msmts'],
    ['a reference row inserted after the snapshot', { referenceRows: { species: [{ SpeciesID: 1 }] }, deletedCounts: { DeletedSpecies: 2 } }, 'full'],
    ['a last-census wipe the route did not foresee', { censusCountInSchema: 2, deletedCounts: { DeletedQuadrats: 5 } }, 'full']
  ] satisfies Array<[string, ClearCensusQueryScript, string]>)(
    '409 and rollback when the procedure deleted rows nobody audited: %s',
    async (_case, script, type) => {
      const cm = (ConnectionManager as any).getInstance();
      vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-mismatch');
      vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(true);
      scriptClearCensusQueries(vi.spyOn(cm, 'executeQuery'), script);
      const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
      const commit = vi.spyOn(cm, 'commitTransaction');

      const res = await POST(makeRequest(`http://localhost/api/clearcensus?schema=myschema&censusID=12&type=${type}`));

      expect(res.status).toBe(HTTPResponses.CONFLICT);
      expect((await res.json()).error).toMatch(/Nothing was deleted/);
      expect(rollback).toHaveBeenCalledWith('tx-mismatch');
      expect(commit).not.toHaveBeenCalled();
    }
  );

  it('full skips the reference snapshot when other censuses remain', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-not-last');
    vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(true);
    const exec = vi.spyOn(cm, 'executeQuery');
    scriptClearCensusQueries(exec, { censusCountInSchema: 3 });
    vi.spyOn(cm, 'commitTransaction').mockResolvedValueOnce(undefined);

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=full'));

    expect(res.status).toBe(HTTPResponses.OK);
    const statements = exec.mock.calls.map(call => String(call[0]));
    expect(
      statements.some(sql => /FROM \?\?\.`species`/.test(sql)),
      statements.join('\n')
    ).toBe(false);
  });

  it('rolls back without calling the procedure when an audit row cannot be written', async () => {
    const cm = (ConnectionManager as any).getInstance();
    vi.spyOn(cm, 'beginTransaction').mockResolvedValueOnce('tx-audit-fail');
    vi.spyOn(cm, 'acquireApplicationLock').mockResolvedValueOnce(true);
    const exec = vi.spyOn(cm, 'executeQuery');
    scriptClearCensusQueries(exec, { auditFailure: new Error('changelog unavailable') });
    const rollback = vi.spyOn(cm, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const commit = vi.spyOn(cm, 'commitTransaction');

    const res = await POST(makeRequest('http://localhost/api/clearcensus?schema=myschema&censusID=12&type=msmts'));

    expect(res.status).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
    expect(exec.mock.calls.some(call => /^CALL /i.test(String(call[0])))).toBe(false);
    expect(rollback).toHaveBeenCalledWith('tx-audit-fail');
    expect(commit).not.toHaveBeenCalled();
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
    expect(text).toMatch(/boom/i);
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
