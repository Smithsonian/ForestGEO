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
import ConnectionManager from '@/config/connectionmanager';
import { insertOrUpdate } from '@/components/processors/processorhelperfunctions';
import { HTTPResponses } from '@/config/macros';

vi.mock('@/config/connectionmanager', async () => {
  // Pull whatever the environment currently exports
  const actual = await vi.importActual<any>('@/config/connectionmanager').catch(() => ({}));

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

// Mock just local helpers
vi.mock('@/components/processors/processorhelperfunctions', () => ({
  insertOrUpdate: vi.fn()
}));
vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-batch-id') }));

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

  /**
   * @test Validates that the endpoint returns HTTP 400 when required parameters are missing.
   * Specifically tests for missing plot and census parameters in the request body.
   * This ensures proper input validation before attempting database operations.
   */
  it('400 when dataType or plot or census missing', async () => {
    // missing plot + census
    const req = makeRequest({ gridType: 'trees', schema: 'myschema', fileRowSet: {} });
    const res = await POST(req);
    expect(res.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(await res.text()).toMatch(/No dataType or SLUGS provided/i);
  });

  /**
   * @test Verifies that the endpoint rejects requests with missing row data.
   * Tests the validation logic that ensures fileRowSet contains actual data
   * before proceeding with bulk operations.
   */
  it('400 when rows missing', async () => {
    const req = makeRequest({
      gridType: 'trees',
      schema: 'myschema',
      plot: { plotID: 1 },
      census: { dateRanges: [{ censusID: 9 }] }
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/No rows provided/i);
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
    execSpy.mockResolvedValueOnce({}); // CALL bulkingestionprocess

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
      schema: 'myschema',
      plot: { plotID: 42 },
      census: { dateRanges: [{ censusID: 7 }] },
      fileRowSet: rows
    });

    const res = await POST(req);

    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body.message).toMatch(/Insert to SQL successful/i);

    expect(beginSpy).toHaveBeenCalledTimes(1);
    expect(execSpy).toHaveBeenCalledTimes(2);
    expect(commitSpy).toHaveBeenCalledWith('tx-1');
    expect(rollbackSpy).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledTimes(1);

    const [firstSQL, firstParams] = execSpy.mock.calls[0];
    expect(String(firstSQL)).toMatch(/INSERT INTO \?\? SET \?/i);
    expect((firstParams as unknown as any)[0]).toBe('myschema.temporarymeasurements');

    const mappedArray = (firstParams as unknown as any)[1];
    expect(Array.isArray(mappedArray)).toBe(true);
    expect(mappedArray).toHaveLength(2);

    const [secondSQL, secondParams] = execSpy.mock.calls[1];
    expect(String(secondSQL)).toMatch(/CALL myschema\.bulkingestionprocess\(\?, \?\);?/i);
    expect(secondParams).toEqual(['sample_bulk_insert.csv', 'test-batch-id']);

    expect(insertOrUpdate).not.toHaveBeenCalled();
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
      gridType: 'trees', // anything not in ['measurementssummary','measurementssummaryview']
      schema: 'myschema',
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
    // Validate the first call's props
    const [firstProps] = (insertOrUpdate as any).mock.calls[0];
    expect(firstProps).toMatchObject({
      schema: 'myschema',
      formType: 'trees',
      rowData: { foo: 1 },
      plot: { plotID: 99 },
      census: { dateRanges: [{ censusID: 5 }] },
      quadratID: undefined,
      fullName: undefined
    });

    expect(beginSpy).toHaveBeenCalledTimes(1);
    expect(commitSpy).toHaveBeenCalledWith('tx-2');
    expect(rollbackSpy).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    // execSpy may or may not be called; we don’t assert a count here
    void execSpy;
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
      schema: 'myschema',
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
});
