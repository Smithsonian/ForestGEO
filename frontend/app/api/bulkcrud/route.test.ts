/**
 * @fileoverview Unit tests for the bulk CRUD API endpoint.
 *
 * This test suite validates the POST /api/bulkcrud endpoint which handles
 * bulk create/update operations for forest measurement data. The endpoint
 * supports two execution paths:
 *
 * 1. measurementssummary: Inserts data into temporary tables and calls stored procedures
 * 2. Generic path: Processes data row-by-row using insertOrUpdate helper
 *
 * Tests verify transaction management, error handling, parameter validation,
 * and proper database connection lifecycle management.
 *
 * @see /app/api/bulkcrud/route.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { insertOrUpdate } from '@/components/processors/processorhelperfunctions';
import { HTTPResponses } from '@/config/macros';
import { BULKCRUD_REJECTION_MESSAGES } from '@/lib/bulkcrud/required-context';
import { CALLER_OWNS_TRANSACTION_SQL, CLEAR_CALLER_TRANSACTION_SQL, FLAG_CLEAR_FAILED_REASON } from '@/lib/ingestion/bulk-ingestion-call';

vi.mock('@/lib/db/connectionmanager', async () => {
  // Pull whatever the environment currently exports
  const actual = await vi.importActual<any>('@/lib/db/connectionmanager').catch(() => ({}));

  // Decide what looks like the active singleton
  const candidate =
    (typeof actual?.getInstance === 'function' && actual.getInstance()) ||
    (actual?.default && typeof actual.default.getInstance === 'function' && actual.default.getInstance()) ||
    actual?.default ||
    actual;

  // If we still couldn’t find one, create a safe stub (shouldn’t happen if your *-mocks.ts ran)
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

  // Return a module shape that preserves defaults + guarantees getInstance on both paths
  return {
    ...actual,
    default: { ...(actual?.default ?? {}), getInstance },
    getInstance
  };
});

// The route enforces per-site authz inline (auth() + assertSchemaAccess) before
// touching the DB. This suite exercises the SQL/transaction logic, so it runs as
// a global admin (assertSchemaAccess bypasses membership for admins). The 403
// out-of-scope path is covered by the bulkcrud authz integration test.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: { email: 'bulkcrud-test@forestgeo.test', userStatus: 'global', sites: [] }
  }))
}));

// Mock just local helpers
vi.mock('@/components/processors/processorhelperfunctions', () => ({
  insertOrUpdate: vi.fn()
}));
vi.mock('@/config/utils', async importOriginal => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    generateShortBatchID: () => 'test-batch-id'
  };
});

// Optional mysql2 format mock
vi.mock('mysql2/promise', () => {
  const format = (sql: string, params: any[]) => `FORMATTED_SQL:${sql}::PARAMS:${JSON.stringify(params)}`;
  return { format };
});
// Minimal helpers
function makeRequest(body: unknown) {
  return new Request('http://localhost/api', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
  }) as any;
}

function normalizeConnectionManager() {
  // Make sure the module has a getInstance() that returns the active singleton
  const mod: any = ConnectionManager as any;
  const candidate =
    (mod && typeof mod.getInstance === 'function' && mod.getInstance.call(mod)) ||
    (mod?.default && typeof mod.default.getInstance === 'function' && mod.default.getInstance.call(mod.default)) ||
    mod?.default ||
    mod;

  // If the candidate looks like an instance (has the methods), install a getInstance() on both shapes
  const looksLikeInstance =
    candidate &&
    typeof candidate.beginTransaction === 'function' &&
    typeof candidate.commitTransaction === 'function' &&
    typeof candidate.rollbackTransaction === 'function' &&
    typeof candidate.executeQuery === 'function' &&
    typeof candidate.closeConnection === 'function';

  if (looksLikeInstance) {
    if (typeof mod.getInstance !== 'function') {
      mod.getInstance = vi.fn(() => candidate);
    }
    if (mod.default && typeof mod.default.getInstance !== 'function') {
      mod.default.getInstance = mod.getInstance;
    }
    return candidate;
  }

  throw new Error('Unable to normalize ConnectionManager: no usable instance found');
}

describe('bulkcrud POST route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    normalizeConnectionManager();
  });

  it('rejects a census-scoped grid without a census with a JSON error and starts no transaction', async () => {
    const instance = (ConnectionManager as any).getInstance();
    const beginSpy = vi.spyOn(instance, 'beginTransaction');
    const res = await POST(makeRequest({ gridType: 'measurementssummary', schema: 'forestgeo_testing', plot: { plotID: 1 }, fileRowSet: { r1: {} } }));

    expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
    expect(await res.json()).toEqual({ error: BULKCRUD_REJECTION_MESSAGES.missingCensus });
    expect(beginSpy, 'validation must reject before any DB work').not.toHaveBeenCalled();
  });

  it.each([
    { label: 'missing', fileRowSet: undefined },
    { label: 'empty', fileRowSet: {} }
  ])('rejects $label rows with a JSON error', async ({ fileRowSet }) => {
    const res = await POST(makeRequest({ gridType: 'attributes', schema: 'forestgeo_testing', fileRowSet }));

    expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
    expect(await res.json()).toEqual({ error: BULKCRUD_REJECTION_MESSAGES.missingRows });
  });

  it('rejects an unknown grid type with a JSON error naming it', async () => {
    const res = await POST(
      makeRequest({ gridType: 'trees', schema: 'forestgeo_testing', plot: { plotID: 1 }, census: { dateRanges: [{ censusID: 2 }] }, fileRowSet: { r1: {} } })
    );

    expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
    expect(await res.json()).toEqual({ error: 'Unsupported grid type: trees' });
  });

  it.each([
    {
      gridType: 'attributes',
      rows: { r1: { code: 'A', description: 'alive', status: 'alive' }, r2: { code: 'D', description: 'dead', status: 'dead' } }
    },
    {
      gridType: 'species',
      rows: {
        r1: { spcode: 'ACRU', family: 'Sapindaceae', genus: 'Acer', species: 'rubrum' },
        r2: { spcode: 'ACSA', family: 'Sapindaceae', genus: 'Acer', species: 'saccharum' }
      }
    },
    {
      gridType: 'personnel',
      rows: { r1: { firstname: 'Alex', lastname: 'Smith', role: 'technician' }, r2: { firstname: 'Sam', lastname: 'Jones', role: 'technician' } }
    }
  ])('accepts site-level $gridType rows with no plot or census selected (#502)', async ({ gridType, rows }) => {
    const instance = (ConnectionManager as any).getInstance();
    vi.spyOn(instance, 'beginTransaction').mockResolvedValueOnce('tx-site-level');
    const commitSpy = vi.spyOn(instance, 'commitTransaction');
    const res = await POST(makeRequest({ gridType, schema: 'forestgeo_testing', fileRowSet: rows }));

    expect(res.status, `body: ${await res.clone().text()}`).toBe(HTTPResponses.OK);
    expect(insertOrUpdate).toHaveBeenCalledTimes(2);
    expect((insertOrUpdate as any).mock.calls[0][0]).toMatchObject({
      formType: gridType,
      rowData: rows.r1,
      plot: undefined,
      census: undefined,
      transactionID: 'tx-site-level'
    });
    expect(commitSpy).toHaveBeenCalledWith('tx-site-level');
  });

  /**
   * @test Validates the measurementssummary processing path for bulk forest measurement data.
   *
   * This test verifies the complete workflow:
   * 1. Transaction initiation
   * 2. Bulk insertion of measurement data into temporary tables
   * 3. Execution of the bulkingestionprocess stored procedure
   * 4. Successful transaction commit
   * 5. Proper connection cleanup
   *
   * Tests the specialized handling for measurement data that uses stored procedures
   * for optimal performance with large datasets.
   */
  it('measurementssummary path: inserts temp rows, calls proc, commits, and closes', async () => {
    const instance = (ConnectionManager as any).getInstance();

    const beginSpy = vi.spyOn(instance, 'beginTransaction').mockResolvedValueOnce('tx-1');
    const execSpy = vi.spyOn(instance, 'executeQuery');
    const commitSpy = vi.spyOn(instance, 'commitTransaction');
    const rollbackSpy = vi.spyOn(instance, 'rollbackTransaction');
    const closeSpy = vi.spyOn(instance, 'closeConnection');

    // ✅ Make both DB calls succeed
    execSpy.mockResolvedValueOnce({ affectedRows: 2 }); // INSERT into temporarymeasurements
    execSpy.mockResolvedValueOnce([]); // helper: SET caller-owns-transaction flag
    execSpy.mockResolvedValueOnce({}); // CALL bulkingestionprocess
    execSpy.mockResolvedValueOnce([]); // helper: CLEAR caller-owns-transaction flag
    execSpy.mockResolvedValueOnce({ affectedRows: 2 }); // recordCommittedCoreMeasurementsAudit INSERT ... SELECT

    const rows = {
      r1: {
        tag: 'A-1',
        stemtag: 'S1',
        spcode: 'ABCD',
        quadrat: 'Q1',
        lx: 1.23,
        ly: 4.56,
        dbh: 12.3,
        hom: 130,
        date: '2025-08-01',
        codes: 'C1',
        description: 'ok'
      },
      r2: {
        tag: 'A-2',
        stemtag: null,
        spcode: 'EFGH',
        quadrat: 'Q2',
        lx: 2.34,
        ly: 5.67,
        dbh: 9.87,
        hom: 120,
        date: '2025-08-02',
        codes: 'C2',
        description: 'fine'
      }
    };

    const req = makeRequest({
      gridType: 'measurementssummary',
      schema: 'forestgeo_testing',
      plot: { plotID: 42 },
      census: { dateRanges: [{ censusID: 7 }] },
      fileRowSet: rows
    });

    const res = await POST(req);

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body.message).toMatch(/Insert to SQL successful/i);

    expect(beginSpy).toHaveBeenCalledTimes(1);
    expect(execSpy).toHaveBeenCalledTimes(5);
    expect(commitSpy).toHaveBeenCalledWith('tx-1');
    expect(rollbackSpy).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    const [firstSQL, firstParams] = execSpy.mock.calls[0];
    expect(String(firstSQL)).toMatch(/INSERT INTO `forestgeo_testing`\.temporarymeasurements[\s\S]*VALUES \?/i);
    // firstParams is an array: [values] where values is an array of row arrays
    const values = (firstParams as unknown as any)[0];
    expect(Array.isArray(values)).toBe(true);
    expect(values).toHaveLength(2);

    const [setFlagSQL, , setFlagTransactionID] = execSpy.mock.calls[1];
    expect(setFlagSQL).toBe(CALLER_OWNS_TRANSACTION_SQL);
    expect(setFlagTransactionID).toBe('tx-1');

    const [procedureSQL, procedureParams, procedureTransactionID] = execSpy.mock.calls[2];
    expect(String(procedureSQL)).toMatch(/CALL `forestgeo_testing`\.bulkingestionprocess\(\?, \?\);?/i);
    expect(procedureParams).toEqual(['sample_bulk_insert.csv', 'test-batch-id']);
    expect(procedureTransactionID).toBe('tx-1');

    const [clearFlagSQL, , clearFlagTransactionID] = execSpy.mock.calls[3];
    expect(clearFlagSQL).toBe(CLEAR_CALLER_TRANSACTION_SQL);
    expect(clearFlagTransactionID).toBe('tx-1');

    // #507: the CALL's committed coremeasurements rows are audited to
    // unifiedchangelog, inside the SAME transaction, before commit.
    const [auditSQL, auditParams, auditTransactionID] = execSpy.mock.calls[4];
    expect(String(auditSQL)).toMatch(/INSERT INTO `forestgeo_testing`\.unifiedchangelog/i);
    expect(String(auditSQL)).toMatch(/FROM `forestgeo_testing`\.coremeasurements/i);
    expect(auditParams).toEqual(['bulkcrud-test@forestgeo.test', 42, 7, 'sample_bulk_insert.csv', 'test-batch-id']);
    expect(auditTransactionID).toBe('tx-1');

    expect(insertOrUpdate).not.toHaveBeenCalled();
  });

  /**
   * @test #507 regression: a client that forges a `user` field in the request
   * body must NOT have that value recorded as ChangedBy on the coremeasurements
   * audit row. The route has no `user` input at all — ChangedBy must come only
   * from the authenticated session resolved via auth().
   */
  it('measurementssummary path: audits with the authenticated session identity, ignoring a forged body.user field', async () => {
    const instance = (ConnectionManager as any).getInstance();
    vi.spyOn(instance, 'beginTransaction').mockResolvedValueOnce('tx-forge');
    const execSpy = vi.spyOn(instance, 'executeQuery');
    execSpy.mockResolvedValueOnce({ affectedRows: 1 }); // INSERT into temporarymeasurements
    execSpy.mockResolvedValueOnce([]); // SET caller-owns-transaction flag
    execSpy.mockResolvedValueOnce({}); // CALL bulkingestionprocess
    execSpy.mockResolvedValueOnce([]); // CLEAR caller-owns-transaction flag
    execSpy.mockResolvedValueOnce({ affectedRows: 1 }); // audit INSERT ... SELECT

    const req = makeRequest({
      gridType: 'measurementssummary',
      schema: 'forestgeo_testing',
      plot: { plotID: 42 },
      census: { dateRanges: [{ censusID: 7 }] },
      // Forged client-supplied identity — must never reach ChangedBy.
      user: 'attacker@evil.test',
      fileRowSet: {
        r1: { tag: 'A-1', stemtag: 'S1', spcode: 'ABCD', quadrat: 'Q1', lx: 1, ly: 1, dbh: 1, hom: 130, date: '2025-08-01', codes: '', description: '' }
      }
    });

    const res = await POST(req);
    expect(res.status).toBe(HTTPResponses.OK);

    const [, auditParams] = execSpy.mock.calls[4];
    expect(auditParams[0]).toBe('bulkcrud-test@forestgeo.test');
    expect(auditParams[0]).not.toBe('attacker@evil.test');
  });

  /**
   * @test #507 regression: if the coremeasurements audit write itself fails
   * (e.g. a deadlock on unifiedchangelog), the whole transaction — the staged
   * rows AND the procedure's committed coremeasurements rows — must roll back
   * together rather than silently committing data with no audit trail.
   */
  it('measurementssummary path: rolls back the whole transaction when the coremeasurements audit write fails', async () => {
    const instance = (ConnectionManager as any).getInstance();
    vi.spyOn(instance, 'beginTransaction').mockResolvedValueOnce('tx-audit-fail');
    const execSpy = vi.spyOn(instance, 'executeQuery');
    const rollbackSpy = vi.spyOn(instance, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const commitSpy = vi.spyOn(instance, 'commitTransaction');
    const closeSpy = vi.spyOn(instance, 'closeConnection');

    execSpy.mockResolvedValueOnce({ affectedRows: 1 }); // INSERT into temporarymeasurements
    execSpy.mockResolvedValueOnce([]); // SET caller-owns-transaction flag
    execSpy.mockResolvedValueOnce({}); // CALL bulkingestionprocess
    execSpy.mockResolvedValueOnce([]); // CLEAR caller-owns-transaction flag
    execSpy.mockRejectedValueOnce(new Error('unifiedchangelog deadlock')); // audit INSERT fails

    const res = await POST(
      makeRequest({
        gridType: 'measurementssummary',
        schema: 'forestgeo_testing',
        plot: { plotID: 42 },
        census: { dateRanges: [{ censusID: 7 }] },
        fileRowSet: {
          r1: { tag: 'A-1', stemtag: 'S1', spcode: 'ABCD', quadrat: 'Q1', lx: 1, ly: 1, dbh: 1, hom: 130, date: '2025-08-01', codes: '', description: '' }
        }
      })
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/Failed to record INSERT audit for coremeasurements/i);
    expect(body.error).toMatch(/unifiedchangelog deadlock/i);

    expect(commitSpy).not.toHaveBeenCalled();
    expect(rollbackSpy).toHaveBeenCalledWith('tx-audit-fail');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  /**
   * @test #507: a measurement upload with no plotID/censusID scope cannot be
   * audited (recordCommittedCoreMeasurementsAudit requires both). This must be
   * rejected BEFORE beginTransaction so the early return does not leave an
   * un-committed, un-rolled-back transaction open against the pool.
   */
  it('measurementssummary path: 400s on missing plotID/censusID without opening a transaction', async () => {
    const instance = (ConnectionManager as any).getInstance();
    const beginSpy = vi.spyOn(instance, 'beginTransaction');

    const res = await POST(
      makeRequest({
        gridType: 'measurementssummary',
        schema: 'forestgeo_testing',
        plot: {},
        census: { dateRanges: [{}] },
        fileRowSet: { r1: { tag: 'A-1' } }
      })
    );

    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    const body = await res.json();
    expect(body.code).toBe('MEASUREMENT_SCOPE_REQUIRED');
    expect(beginSpy).not.toHaveBeenCalled();
  });

  /**
   * @test Tests the generic bulk processing path for non-measurement data types.
   *
   * This test validates the row-by-row processing approach used for data types
   * other than measurementssummary. Verifies:
   * 1. Transaction management
   * 2. Individual row processing via insertOrUpdate helper
   * 3. Proper parameter passing to processing functions
   * 4. Successful commit and connection cleanup
   *
   * Used for tree, species, personnel, and other forest inventory data.
   */
  it('generic path: calls insertOrUpdate per row, commits, and closes', async () => {
    const instance = (ConnectionManager as any).getInstance();
    const beginSpy = vi.spyOn(instance, 'beginTransaction');
    const execSpy = vi.spyOn(instance, 'executeQuery');
    const commitSpy = vi.spyOn(instance, 'commitTransaction');
    const rollbackSpy = vi.spyOn(instance, 'rollbackTransaction');
    const closeSpy = vi.spyOn(instance, 'closeConnection');

    beginSpy.mockResolvedValueOnce('tx-2');

    const rows = {
      r1: { foo: 1 },
      r2: { foo: 2 }
    };

    const req = makeRequest({
      gridType: 'quadrats', // anything not in ['measurementssummary','measurementssummaryview']
      schema: 'forestgeo_testing',
      plot: { plotID: 99 },
      census: { dateRanges: [{ censusID: 5 }] },
      fileRowSet: rows
    });

    const res = await POST(req);

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body.message).toMatch(/Insert to SQL successful/i);

    // For generic path, executeQuery may not be used here
    expect(insertOrUpdate).toHaveBeenCalledTimes(2);
    // Validate the first call's props. #507: fullName must be the SERVER-resolved
    // session identity (never a client-supplied value — this route has no `user`
    // field for a client to forge), and transactionID must be the ACTIVE
    // transaction this request's beginTransaction() opened, so insertOrUpdate's
    // row write and rollback live in the same transaction as everything else.
    const [firstProps] = (insertOrUpdate as any).mock.calls[0];
    expect(firstProps).toMatchObject({
      schema: 'forestgeo_testing',
      formType: 'quadrats',
      rowData: { foo: 1 },
      plot: { plotID: 99 },
      census: { dateRanges: [{ censusID: 5 }] },
      quadratID: undefined,
      transactionID: 'tx-2',
      fullName: 'bulkcrud-test@forestgeo.test'
    });
    // Every row in the batch shares the one active transaction.
    const [secondProps] = (insertOrUpdate as any).mock.calls[1];
    expect(secondProps.transactionID).toBe('tx-2');

    expect(beginSpy).toHaveBeenCalledTimes(1);
    expect(commitSpy).toHaveBeenCalledWith('tx-2');
    expect(rollbackSpy).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    // execSpy may or may not be called; we don’t assert a count here
    void execSpy;
  });

  /**
   * @test #507 regression: the generic (non-measurement) path must ignore a
   * client-forged `user`/identity field and use the authenticated session for
   * `fullName`, exactly like the measurement path.
   */
  it('generic path: ignores a forged body field and uses the authenticated session identity for fullName', async () => {
    const instance = (ConnectionManager as any).getInstance();
    vi.spyOn(instance, 'beginTransaction').mockResolvedValueOnce('tx-generic-forge');

    const req = makeRequest({
      gridType: 'species',
      schema: 'forestgeo_testing',
      plot: { plotID: 1 },
      census: { dateRanges: [{ censusID: 1 }] },
      user: 'attacker@evil.test',
      fileRowSet: { r1: { foo: 1 } }
    });

    const res = await POST(req);
    expect(res.status).toBe(HTTPResponses.OK);

    const [props] = (insertOrUpdate as any).mock.calls[0];
    expect(props.fullName).toBe('bulkcrud-test@forestgeo.test');
    expect(props.fullName).not.toBe('attacker@evil.test');
  });

  /**
   * @test Validates error handling and transaction rollback behavior.
   *
   * This critical test ensures that when database operations fail:
   * 1. The transaction is properly rolled back with the correct transaction ID
   * 2. A meaningful error response is returned (HTTP 500)
   * 3. Database connections are properly cleaned up
   * 4. Error details are included in the response for debugging
   *
   * This test is essential for data integrity in production environments.
   */
  it('on error: rolls back with the transaction id, returns 500, and closes', async () => {
    const instance = (ConnectionManager as any).getInstance();
    const beginSpy = vi.spyOn(instance, 'beginTransaction').mockResolvedValueOnce('tx-err');
    const execSpy = vi.spyOn(instance, 'executeQuery').mockRejectedValueOnce(new Error('kaboom'));
    const rollbackSpy = vi.spyOn(instance, 'rollbackTransaction');
    const commitSpy = vi.spyOn(instance, 'commitTransaction');
    const closeSpy = vi.spyOn(instance, 'closeConnection');

    // Force the summary path so we hit executeQuery early
    const req = makeRequest({
      gridType: 'measurementssummary',
      schema: 'forestgeo_testing',
      plot: { plotID: 1 },
      census: { dateRanges: [{ censusID: 2 }] },
      fileRowSet: {
        r1: {
          tag: 'T1',
          stemtag: 'S1',
          spcode: 'SP',
          quadrat: 'Q',
          lx: 0,
          ly: 0,
          dbh: 1,
          hom: 130,
          date: '2025-08-01',
          codes: '',
          description: ''
        }
      }
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.responseMessage).toMatch(/Failure in connecting to SQL/i);
    expect(body.error).toMatch(/kaboom/i);

    expect(beginSpy).toHaveBeenCalledTimes(1);
    expect(execSpy).toHaveBeenCalled(); // failed on first insert exec
    expect(rollbackSpy).toHaveBeenCalledWith('tx-err');
    expect(commitSpy).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('returns 500 and rolls back instead of committing when the CALL succeeded but the caller flag could not be cleared', async () => {
    const instance = (ConnectionManager as any).getInstance();
    const clearError = new Error('connection lost while clearing the caller flag');
    vi.spyOn(instance, 'beginTransaction').mockResolvedValueOnce('tx-flag');
    const execSpy = vi.spyOn(instance, 'executeQuery');
    execSpy.mockResolvedValueOnce({ affectedRows: 1 }); // INSERT into temporarymeasurements
    execSpy.mockResolvedValueOnce([]); // helper: SET caller-owns-transaction flag
    execSpy.mockResolvedValueOnce({}); // CALL bulkingestionprocess
    execSpy.mockRejectedValueOnce(clearError); // helper: CLEAR caller-owns-transaction flag
    const discardSpy = vi.spyOn(instance, 'discardTransaction').mockImplementation(() => undefined);
    const rollbackSpy = vi.spyOn(instance, 'rollbackTransaction').mockResolvedValueOnce(undefined);
    const commitSpy = vi.spyOn(instance, 'commitTransaction');

    const res = await POST(
      makeRequest({
        gridType: 'measurementssummary',
        schema: 'forestgeo_testing',
        plot: { plotID: 1 },
        census: { dateRanges: [{ censusID: 2 }] },
        fileRowSet: {
          r1: { tag: 'T1', stemtag: 'S1', spcode: 'SP', quadrat: 'Q', lx: 0, ly: 0, dbh: 1, hom: 130, date: '2025-08-01', codes: '', description: '' }
        }
      })
    );

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe(clearError.message);
    expect(discardSpy).toHaveBeenCalledWith('tx-flag', FLAG_CLEAR_FAILED_REASON);
    expect(rollbackSpy).toHaveBeenCalledWith('tx-flag');
    expect(commitSpy).not.toHaveBeenCalled();
  });
});
