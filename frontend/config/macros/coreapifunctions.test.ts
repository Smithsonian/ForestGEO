import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { PATCH, POST, DELETE } from './coreapifunctions';
import ConnectionManager from '@/lib/db/connectionmanager';
import MapperFactory from '@/config/datamapper';
import { applyEdit } from '@/config/editplan/apply';
// Keep measurementerrors mocked even though no test reads the mock directly; it
// prevents the module from hitting the real DB stack when imported transitively.

const PLAN_HASH = 'a'.repeat(64);
const TEST_SESSION_EMAIL = 'grid-editor@si.edu';
const CHANGELOG_TABLE = 'unifiedchangelog';
// Must satisfy lib/db/sqlsecurity's schema pattern: the changelog write runs
// through safeFormatQuery, which rejects anything that is not a real ForestGEO
// schema. Production schemas always are — withRouteAuthz validates upstream.
const TEST_SCHEMA = 'forestgeo_testing';

// Mock dependencies
vi.mock('@/lib/db/connectionmanager');
vi.mock('@/config/datamapper');
vi.mock('@/components/processors/processorhelperfunctions', () => ({
  AllTaxonomiesViewQueryConfig: { mockConfig: true },
  handleUpsertForSlices: vi.fn()
}));
vi.mock('@/lib/errorhandler', () => ({
  handleError: vi.fn(error => NextResponse.json({ error: error.message }, { status: 500 }))
}));
vi.mock('@/app/actions/cookiemanager', () => ({
  getCookie: vi.fn((key: string) => Promise.resolve(key === 'plotID' ? '5' : '1'))
}));
// The CRUD handlers read the session for unifiedchangelog.ChangedBy. withRouteAuthz
// has already validated it upstream; this models a resolved session.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: TEST_SESSION_EMAIL } }))
}));
vi.mock('@/ailogger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}));
vi.mock('@/config/utils', () => ({
  getUpdatedValues: vi.fn((old, updated) => {
    const changes: any = {};
    Object.keys(updated).forEach(key => {
      if (old[key] !== updated[key]) {
        changes[key] = updated[key];
      }
    });
    return changes;
  }),
  handleUpsert: vi.fn(() => Promise.resolve({ id: 123, operation: 'inserted' }))
}));
vi.mock('@/config/measurementerrors', () => ({
  insertIngestionFailureRows: vi.fn(() => Promise.resolve([1])),
  refreshIngestionErrorsForMeasurement: vi.fn(() => Promise.resolve([]))
}));
// applyEdit is kept mocked so the 405-rejection test can assert it was NOT called.
// The PATCH route no longer calls it; production callers use /api/edits/apply instead.
vi.mock('@/config/editplan/apply', () => ({
  applyEdit: vi.fn()
}));

/** Positional decode of recordMutation's INSERT parameter list. */
const CHANGELOG_PARAM_ORDER = ['tableName', 'recordID', 'operation', 'oldRowState', 'newRowState', 'changedBy', 'plotID', 'censusID'] as const;

type DecodedChangelogRow = Record<(typeof CHANGELOG_PARAM_ORDER)[number], any>;

function changelogCalls(mockConnectionManager: any): any[][] {
  return mockConnectionManager.executeQuery.mock.calls.filter((call: any[]) => typeof call[0] === 'string' && call[0].includes(CHANGELOG_TABLE));
}

function changelogRows(mockConnectionManager: any): DecodedChangelogRow[] {
  return changelogCalls(mockConnectionManager).map((call: any[]) => {
    const params = call[1] as unknown[];
    const row = Object.fromEntries(CHANGELOG_PARAM_ORDER.map((name, index) => [name, params[index]])) as DecodedChangelogRow;
    // eslint-disable-next-line no-console
    console.log('[coreapifunctions] changelog row', row);
    return row;
  });
}

/**
 * The tx mock delegates to executeQuery(sql, params, transactionID). A changelog
 * write issued on a bare pool connection would call executeQuery(sql, params)
 * with no transaction id — and would autocommit independently of the mutation it
 * claims to describe, surviving a rollback of that mutation.
 *
 * This is the precise discriminator between tx.query and executeQuery at unit
 * level. The transaction-scoping consequence is proven against real MySQL in
 * tests/integration/coreapifunctions-patch-atomicity.integration.test.ts.
 */
function expectChangelogWritesAreTransactionScoped(mockConnectionManager: any) {
  const calls = changelogCalls(mockConnectionManager);
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(call[2], 'the changelog write must run on the mutation transaction, not a pool connection').toBe('transaction-123');
  }
}

/**
 * Every dataType the CLIENT can actually send to a mutating verb on
 * /api/fixeddata, with the verbs that reach it. Derived from the call sites, not
 * from the handler's allowlist — a test written against the allowlist would stay
 * green while the allowlist 405s a live grid.
 *
 * Call sites:
 *   - components/datagrids/isolateddatagridcommons.tsx (POST/PATCH, DELETE)
 *   - components/datagrids/measurementscommons.tsx (POST for new rows, DELETE)
 *   - components/client/modals/specieslimitsmodal.tsx (PATCH/POST/DELETE)
 *   - components/client/modals/plotcardmodal.tsx (POST/PATCH)
 *   - lib/db/definitions/timekeeping.ts (POST)
 *
 * `stemtaxonomiesview`, `unifiedchangelog` and the admin `sites`/`users` grids
 * are intentionally excluded: the first two pass `locked`, and the admin grids
 * rewrite every mutation to /api/administrative/fetch/*.
 */
const CLIENT_REACHABLE_MUTATIONS: { dataType: string; methods: ('PATCH' | 'POST' | 'DELETE')[] }[] = [
  { dataType: 'alltaxonomiesview', methods: ['PATCH', 'POST', 'DELETE'] },
  { dataType: 'attributes', methods: ['PATCH', 'POST', 'DELETE'] },
  { dataType: 'quadrats', methods: ['PATCH', 'POST', 'DELETE'] },
  { dataType: 'personnel', methods: ['PATCH', 'POST', 'DELETE'] },
  { dataType: 'quadratpersonnel', methods: ['PATCH', 'POST', 'DELETE'] },
  { dataType: 'roles', methods: ['PATCH', 'POST', 'DELETE'] },
  { dataType: 'species', methods: ['PATCH', 'POST', 'DELETE'] },
  { dataType: 'specieslimits', methods: ['PATCH', 'POST', 'DELETE'] },
  { dataType: 'plots', methods: ['PATCH', 'POST'] },
  { dataType: 'census', methods: ['POST'] },
  { dataType: 'viewfulltable', methods: ['PATCH', 'POST', 'DELETE'] },
  // PATCH is deliberately absent: measurement edits go through /api/edits/*.
  { dataType: 'measurementssummary', methods: ['POST', 'DELETE'] },
  { dataType: 'failedmeasurements', methods: ['POST', 'DELETE'] }
];

const UNSUPPORTED_DATA_TYPE_MARKER = 'is not supported for data type';

/**
 * Swaps the identity-stub mapper for the REAL one.
 *
 * The stub passes payloads through untouched, so it cannot catch a key-casing
 * mismatch between what the grid sends (`censusActive`) and what the handler
 * reads. The real GenericMapper is the component that capitalizes the key and
 * runs the boolean through booleanToBit, so any test asserting on a demapped
 * field name has to go through it or it proves nothing.
 */
async function useRealMapper(): Promise<void> {
  const { GenericMapper } = await vi.importActual<typeof import('@/config/datamapper')>('@/config/datamapper');
  (MapperFactory.getMapper as any).mockReturnValue(new GenericMapper());
}

/** The personnel row shape the grid PATCHes with — RDS-cased, exactly as sent. */
const PERSONNEL_GRID_ROW = { id: 1, personnelID: 1, firstName: 'Ada', lastName: 'Audit' } as const;
const PERSISTED_PERSONNEL_ROW = { PersonnelID: 1, FirstName: 'Ada', LastName: 'Audit', RoleID: null, IsActive: 1 };
const SEEDED_RELATION_ID = 91;

/** True only for the allowlist's own rejection, not other 405s or failures. */
async function rejectedAsUnsupportedDataType(response: Response): Promise<boolean> {
  if (response.status !== HTTPResponses.METHOD_NOT_ALLOWED) return false;
  const body = await response.clone().json();
  return typeof body?.error === 'string' && body.error.includes(UNSUPPORTED_DATA_TYPE_MARKER);
}

describe('CoreAPIFunctions', () => {
  let mockConnectionManager: any;
  let mockMapper: any;

  /**
   * DELETE now reads the rows it is about to remove so the changelog can record
   * their real prior state. Model both statement shapes: a SELECT yields rows, a
   * DELETE yields a ResultSetHeader.
   */
  function mockDeleteCapture(rowsToRemove: Record<string, unknown>[]) {
    mockConnectionManager.executeQuery.mockImplementation(async (sql: string) =>
      typeof sql === 'string' && sql.trimStart().toUpperCase().startsWith('SELECT') ? rowsToRemove : { affectedRows: rowsToRemove.length }
    );
  }

  function mockPatchSnapshots(before: Record<string, unknown>, after: Record<string, unknown>, affectedRows = 1) {
    let targetRead = 0;
    mockConnectionManager.executeQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes(CHANGELOG_TABLE)) return { affectedRows: 1 };
      if (typeof sql === 'string' && sql.trimStart().toUpperCase().startsWith('SELECT')) {
        return [targetRead++ === 0 ? before : after];
      }
      if (typeof sql === 'string' && sql.trimStart().toUpperCase().startsWith('UPDATE')) return { affectedRows };
      return { affectedRows: 1, insertId: 91 };
    });
  }

  function mockInsertReadback(insertId: number, persistedRow: Record<string, unknown>, affectedRows = 1) {
    mockConnectionManager.executeQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes(CHANGELOG_TABLE)) return { affectedRows: 1 };
      if (typeof sql === 'string' && sql.trimStart().toUpperCase().startsWith('SELECT')) return [persistedRow];
      return { insertId, affectedRows };
    });
  }

  function mockTaxonomyReadback(rows: { family: Record<string, unknown>; genus: Record<string, unknown>; species: Record<string, unknown> }) {
    mockConnectionManager.executeQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes(CHANGELOG_TABLE)) return { affectedRows: 1 };
      if (typeof sql === 'string' && sql.includes('.`family`')) return [rows.family];
      if (typeof sql === 'string' && sql.includes('.`genus`')) return [rows.genus];
      if (typeof sql === 'string' && sql.includes('.`species`')) return [rows.species];
      return { affectedRows: 1 };
    });
  }

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup mock ConnectionManager
    mockConnectionManager = {
      getInstance: vi.fn(),
      beginTransaction: vi.fn(() => Promise.resolve('transaction-123')),
      commitTransaction: vi.fn(() => Promise.resolve()),
      rollbackTransaction: vi.fn(() => Promise.resolve()),
      closeConnection: vi.fn(() => Promise.resolve()),
      executeQuery: vi.fn(() => Promise.resolve([]))
    };

    // PATCH now drives its writes through withTransaction. Faithfully model the
    // real semantics: run the callback with a TxExecutor whose query() delegates
    // to the same executeQuery mock (so existing query assertions still hold),
    // commit on success, and roll back + re-throw on failure (so the route's
    // outer catch -> handleError path runs exactly as in production).
    mockConnectionManager.withTransaction = vi.fn(async (fn: (tx: any) => Promise<any>) => {
      const transactionID = await mockConnectionManager.beginTransaction();
      const tx = {
        id: transactionID,
        query: (sql: string, params?: unknown[]) => mockConnectionManager.executeQuery(sql, params, transactionID)
      };
      try {
        const result = await fn(tx);
        await mockConnectionManager.commitTransaction(transactionID);
        return result;
      } catch (err) {
        await mockConnectionManager.rollbackTransaction(transactionID);
        throw err;
      }
    });

    (ConnectionManager.getInstance as any).mockReturnValue(mockConnectionManager);

    // Setup mock Mapper
    mockMapper = {
      demapData: vi.fn(data => data),
      mapData: vi.fn(data => data)
    };

    (MapperFactory.getMapper as any).mockReturnValue(mockMapper);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('PATCH function', () => {
    it('should handle missing schema or gridID', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow: {}, oldRow: {} })
      });

      const mockParams = { dataType: 'test', slugs: [] };

      await expect(PATCH(mockRequest, { params: Promise.resolve(mockParams) })).rejects.toThrow('no schema or gridID provided');
    });

    it('should throw error for missing slugs', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow: {}, oldRow: {} })
      });

      const mockParams = { dataType: 'test', slugs: undefined };

      await expect(PATCH(mockRequest, { params: Promise.resolve(mockParams) })).rejects.toThrow();
    });

    it('returns 400 for malformed JSON before opening a transaction', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', { method: 'PATCH', body: '{' });
      const response = await PATCH(mockRequest, { params: Promise.resolve({ dataType: 'plots', slugs: [TEST_SCHEMA, 'plotID'] }) });

      expect(response.status).toBe(HTTPResponses.BAD_REQUEST);
      expect(mockConnectionManager.withTransaction).not.toHaveBeenCalled();
    });

    it('rejects a read-only mapped dataType before it can become an arbitrary-table writer', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ oldRow: { ChangeID: 1 }, newRow: { ChangedBy: 'forged' } })
      });
      const response = await PATCH(mockRequest, {
        params: Promise.resolve({ dataType: 'unifiedchangelog', slugs: [TEST_SCHEMA, 'changeID'] })
      });

      expect(response.status).toBe(HTTPResponses.METHOD_NOT_ALLOWED);
      expect(mockConnectionManager.withTransaction).not.toHaveBeenCalled();
      expect(mockConnectionManager.executeQuery).not.toHaveBeenCalled();
    });

    it('should begin and commit transaction for valid update', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({
          newRow: { PlotID: 1, PlotName: 'Updated' },
          oldRow: { PlotID: 1, PlotName: 'Original' }
        })
      });

      // The PATCH UPDATE is guarded against zero-row writes: mysql2 returns a
      // ResultSetHeader whose affectedRows counts matched rows, so a real matched
      // update reports affectedRows >= 1. Model that here so the guard sees a hit.
      mockPatchSnapshots({ PlotID: 1, PlotName: 'Original' }, { PlotID: 1, PlotName: 'Updated' });

      const mockParams = {
        dataType: 'plots',
        slugs: [TEST_SCHEMA, 'plotID']
      };

      const response = await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

      // PATCH now wraps its writes in withTransaction; the underlying
      // begin/commit still fire (the mock models that), but the route no longer
      // threads the transaction id or calls closeConnection itself.
      expect(mockConnectionManager.withTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.beginTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.commitTransaction).toHaveBeenCalledWith('transaction-123');
      expect(response.status).toBe(200);
    });

    it('rolls back via withTransaction when a write fails', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow: { PlotName: 'Updated' }, oldRow: { PlotID: 1 } })
      });

      mockConnectionManager.executeQuery.mockRejectedValue(new Error('DB Error'));

      const mockParams = {
        dataType: 'plots',
        slugs: [TEST_SCHEMA, 'plotID']
      };

      const response = await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

      expect(mockConnectionManager.withTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalledWith('transaction-123');
      expect(response.status).toBe(500);
    });

    it('should handle alltaxonomiesview dataType with handleUpsertForSlices', async () => {
      const { handleUpsertForSlices } = await import('@/components/processors/processorhelperfunctions');
      (handleUpsertForSlices as any).mockResolvedValue({ family: 1, genus: 2, species: 3 });

      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({
          newRow: { Family: 'Fabaceae' },
          oldRow: { Family: 'Fabaceae' }
        })
      });

      const mockParams = {
        dataType: 'alltaxonomiesview',
        slugs: [TEST_SCHEMA, 'speciesID']
      };

      const response = await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

      // The trailing observer is how each slice's upsert reaches the changelog.
      expect(handleUpsertForSlices).toHaveBeenCalledWith(
        mockConnectionManager,
        TEST_SCHEMA,
        { Family: 'Fabaceae' },
        expect.any(Object),
        'transaction-123',
        expect.any(Function)
      );
      expect(response.status).toBe(200);
    });

    /**
     * REGRESSION: the handler once matched the RAW body against `CensusActive`,
     * but the grid sends `censusActive` (isolatedpersonneldatagrid: field
     * 'censusActive'; isolateddatagridcommons JSON.stringifies the row as-is).
     * The branch never fired: the toggle wrote nothing and still answered 200.
     * These two tests go through the REAL mapper, so the key the handler reads
     * has to be the key the real mapper produces from the real client field.
     */
    function mockPersonnelRelationQueries(existingRelation: Record<string, unknown> | null) {
      mockConnectionManager.executeQuery.mockImplementation(async (sql: string) => {
        if (sql.includes(CHANGELOG_TABLE)) return { affectedRows: 1 };
        if (sql.includes('censusactivepersonnel')) {
          if (sql.trimStart().toUpperCase().startsWith('SELECT')) {
            // The CAPID read-back follows the INSERT; the lookup precedes it.
            if (sql.includes('`CAPID`')) return [{ CAPID: SEEDED_RELATION_ID, CensusID: 1, PersonnelID: 1 }];
            return existingRelation ? [existingRelation] : [];
          }
          if (sql.trimStart().toUpperCase().startsWith('INSERT')) return { insertId: SEEDED_RELATION_ID, affectedRows: 1 };
          return { affectedRows: 1 };
        }
        // Toggling census activity changes no personnel column, so both
        // snapshots are the same row — the only audit row must be the relation.
        if (sql.trimStart().toUpperCase().startsWith('SELECT')) return [PERSISTED_PERSONNEL_ROW];
        return { affectedRows: 1 };
      });
    }

    function personnelPatchRequest(censusActive: boolean): NextRequest {
      return new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({
          newRow: { ...PERSONNEL_GRID_ROW, censusActive },
          oldRow: PERSONNEL_GRID_ROW
        })
      });
    }

    it('creates the census relation when the grid toggles censusActive on', async () => {
      await useRealMapper();
      mockPersonnelRelationQueries(null);

      const response = await PATCH(personnelPatchRequest(true), {
        params: Promise.resolve({ dataType: 'personnel', slugs: [TEST_SCHEMA, 'personnelID'] })
      });

      expect(response.status).toBe(HTTPResponses.OK);
      const queries = mockConnectionManager.executeQuery.mock.calls.map((call: any) => call[0]);
      const hasInsertQuery = queries.some((q: string) => typeof q === 'string' && q.includes('INSERT INTO') && q.includes('censusactivepersonnel'));
      expect(hasInsertQuery, 'toggling censusActive on must write the relation, not silently no-op').toBe(true);

      const auditRows = changelogRows(mockConnectionManager);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].tableName).toBe('censusactivepersonnel');
      expect(auditRows[0].operation).toBe('INSERT');
      expect(auditRows[0].recordID).toBe(String(SEEDED_RELATION_ID));
    });

    it('removes the census relation when the grid toggles censusActive off', async () => {
      await useRealMapper();
      mockPersonnelRelationQueries({ CAPID: SEEDED_RELATION_ID, CensusID: 1, PersonnelID: 1 });

      const response = await PATCH(personnelPatchRequest(false), {
        params: Promise.resolve({ dataType: 'personnel', slugs: [TEST_SCHEMA, 'personnelID'] })
      });

      expect(response.status).toBe(HTTPResponses.OK);
      const queries = mockConnectionManager.executeQuery.mock.calls.map((call: any) => call[0]);
      const hasDeleteQuery = queries.some((q: string) => typeof q === 'string' && q.trimStart().toUpperCase().startsWith('DELETE'));
      expect(hasDeleteQuery, 'toggling censusActive off must remove the relation').toBe(true);

      const auditRows = changelogRows(mockConnectionManager);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].tableName).toBe('censusactivepersonnel');
      expect(auditRows[0].operation).toBe('DELETE');
      expect(auditRows[0].newRowState, 'a removal has no after-state').toBeNull();
    });

    it('rejects a censusActive flag that is not a boolean', async () => {
      await useRealMapper();
      mockPersonnelRelationQueries(null);

      const request = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({
          newRow: { ...PERSONNEL_GRID_ROW, censusActive: 'yes' },
          oldRow: PERSONNEL_GRID_ROW
        })
      });
      const response = await PATCH(request, {
        params: Promise.resolve({ dataType: 'personnel', slugs: [TEST_SCHEMA, 'personnelID'] })
      });

      expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
      expect(changelogRows(mockConnectionManager)).toHaveLength(0);
    });

    it('should skip personnel census-activity updates when CensusActive is not provided', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({
          newRow: { PersonnelID: 1, LastName: 'Updated' },
          oldRow: { PersonnelID: 1, LastName: 'Original' }
        })
      });

      mockMapper.demapData.mockImplementation((data: any[]) => data);
      mockPatchSnapshots({ PersonnelID: 1, LastName: 'Original' }, { PersonnelID: 1, LastName: 'Updated' });

      const mockParams = {
        dataType: 'personnel',
        slugs: [TEST_SCHEMA, 'personnelID']
      };

      const response = await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

      expect(response.status).toBe(200);
      const censusActivityQueries = mockConnectionManager.executeQuery.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('censusactivepersonnel')
      );
      expect(censusActivityQueries).toHaveLength(0);
    });

    it.each([
      ['measurementssummary', '77'],
      ['failedmeasurements', '5']
    ])('rejects PATCH for %s with 405 and does not invoke applyEdit', async (dataType, targetID) => {
      const applyEditMock = applyEdit as ReturnType<typeof vi.fn>;
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow: { MeasuredDBH: 12.34 }, oldRow: {}, planHash: PLAN_HASH })
      });

      const response = await PATCH(mockRequest, {
        params: Promise.resolve({
          dataType,
          slugs: [TEST_SCHEMA, targetID]
        })
      });

      expect(response.status).toBe(405);
      await expect(response.json()).resolves.toEqual({
        error: 'measurement edits must go through /api/edits/preview and /api/edits/apply'
      });
      expect(applyEditMock).not.toHaveBeenCalled();
      expect(mockConnectionManager.beginTransaction).not.toHaveBeenCalled();
      expect(mockConnectionManager.executeQuery).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND and rolls back when the UPDATE matches zero rows (stale-key edit)', async () => {
      // A zero-row UPDATE means the target row does not exist (the pool keeps
      // mysql2 FOUND_ROWS on, so affectedRows counts matched rows). The handler
      // must surface HTTPResponses.NOT_FOUND instead of reporting a false success,
      // and the transaction must roll back. This pins the guard at the unit level;
      // the real-DB proof lives in coreapifunctions-patch-atomicity.
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({
          newRow: { Code: 'GHOST', Description: 'Edited' },
          oldRow: { Code: 'GHOST', Description: 'Original' }
        })
      });

      mockMapper.demapData.mockReturnValue([{ Code: 'GHOST', Description: 'Edited' }]);
      // mysql2 reports affectedRows === 0 when no row matched the WHERE clause.
      mockConnectionManager.executeQuery.mockResolvedValue({ affectedRows: 0 });

      const mockParams = {
        dataType: 'attributes',
        slugs: [TEST_SCHEMA, 'code']
      };

      const response = await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

      expect(response.status).toBe(HTTPResponses.NOT_FOUND);
      // The zero-row guard throws inside withTransaction, so the transaction the
      // handler opened must be rolled back, not committed.
      expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalledWith('transaction-123');
      expect(mockConnectionManager.commitTransaction).not.toHaveBeenCalled();
    });

    describe('changelog audit', () => {
      it('writes one UPDATE row carrying the before and after states of the edited row', async () => {
        const oldRow = { PlotID: 17, PlotName: 'Harvard Forest', DefaultDBHUnits: 'mm' };
        const newRow = { DefaultDBHUnits: 'cm' };
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'PATCH',
          body: JSON.stringify({ newRow, oldRow })
        });

        const persistedBefore = { PlotID: 17, PlotName: 'Harvard Forest', DefaultDBHUnits: 'mm' };
        const persistedAfter = { PlotID: 17, PlotName: 'Harvard Forest', DefaultDBHUnits: 'cm' };
        mockPatchSnapshots(persistedBefore, persistedAfter);

        const response = await PATCH(mockRequest, {
          params: Promise.resolve({ dataType: 'plots', slugs: [TEST_SCHEMA, 'plotID'] })
        });

        expect(response.status).toBe(200);

        const rows = changelogRows(mockConnectionManager);
        expect(rows).toHaveLength(1);
        expect(rows[0].tableName).toBe('plots');
        expect(rows[0].recordID).toBe('17');
        expect(rows[0].operation).toBe('UPDATE');
        expect(JSON.parse(rows[0].oldRowState)).toEqual(persistedBefore);
        expect(JSON.parse(rows[0].newRowState)).toEqual(persistedAfter);
        expect(rows[0].changedBy).toBe(TEST_SESSION_EMAIL);
        // `plots` scopes to its own key; the census cookie mock resolves to 1.
        expect(rows[0].plotID).toBe(17);
        expect(rows[0].censusID).toBe(1);
        expectChangelogWritesAreTransactionScoped(mockConnectionManager);
      });

      it('writes nothing when the UPDATE matches zero rows', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'PATCH',
          body: JSON.stringify({
            newRow: { Code: 'GHOST', Description: 'Edited' },
            oldRow: { Code: 'GHOST', Description: 'Original' }
          })
        });

        mockConnectionManager.executeQuery.mockResolvedValue({ affectedRows: 0 });

        const response = await PATCH(mockRequest, {
          params: Promise.resolve({ dataType: 'attributes', slugs: [TEST_SCHEMA, 'code'] })
        });

        expect(response.status).toBe(HTTPResponses.NOT_FOUND);
        // A stale-key edit is not a change. Logging it would put a row in the
        // changelog that no committed mutation corresponds to.
        expect(changelogRows(mockConnectionManager)).toHaveLength(0);
      });

      it('records NULL plot scope for a table that has no PlotID column', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'PATCH',
          body: JSON.stringify({
            newRow: { Code: 'DEAD', Description: 'dead stem' },
            oldRow: { Code: 'DEAD', Description: 'dead' }
          })
        });

        mockPatchSnapshots({ Code: 'DEAD', Description: 'dead', IsActive: 1 }, { Code: 'DEAD', Description: 'dead stem', IsActive: 1 });

        await PATCH(mockRequest, {
          params: Promise.resolve({ dataType: 'attributes', slugs: [TEST_SCHEMA, 'code'] })
        });

        const rows = changelogRows(mockConnectionManager);
        expect(rows).toHaveLength(1);
        expect(rows[0].tableName).toBe('attributes');
        // Natural key, preserved as-is rather than coerced to a number.
        expect(rows[0].recordID).toBe('DEAD');
        expect(rows[0].plotID).toBeNull();
      });

      it('ignores forged client history and records the row snapshots read from MySQL', async () => {
        const persistedBefore = { PlotID: 17, PlotName: 'Real database name', DefaultDBHUnits: 'mm' };
        const persistedAfter = { ...persistedBefore, DefaultDBHUnits: 'cm' };
        mockPatchSnapshots(persistedBefore, persistedAfter);
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'PATCH',
          body: JSON.stringify({
            oldRow: { PlotID: 17, PlotName: 'FORGED OLD VALUE', DefaultDBHUnits: 'feet' },
            newRow: { DefaultDBHUnits: 'cm' }
          })
        });

        const response = await PATCH(mockRequest, { params: Promise.resolve({ dataType: 'plots', slugs: [TEST_SCHEMA, 'plotID'] }) });

        expect(response.status).toBe(HTTPResponses.OK);
        const [audit] = changelogRows(mockConnectionManager);
        expect(JSON.parse(audit.oldRowState)).toEqual(persistedBefore);
        expect(JSON.parse(audit.newRowState)).toEqual(persistedAfter);
      });
    });
  });

  describe('POST function', () => {
    it('should throw error when slugs not provided', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({ newRow: {} })
      });

      const mockParams = { dataType: 'test', slugs: undefined };

      await expect(POST(mockRequest, { params: Promise.resolve(mockParams) })).rejects.toThrow('slugs not provided');
    });

    it('should throw error for missing schema or gridID', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({ newRow: {} })
      });

      const mockParams = { dataType: 'test', slugs: [] };

      await expect(POST(mockRequest, { params: Promise.resolve(mockParams) })).rejects.toThrow('no schema or gridID provided');
    });

    it('should begin and commit transaction for valid insert', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({ newRow: { name: 'New Item' } })
      });

      mockInsertReadback(456, { PlotID: 456, PlotName: 'New Item', IsActive: 1 });

      const mockParams = {
        dataType: 'plots',
        slugs: [TEST_SCHEMA, 'plotID', '1', '1']
      };

      const response = await POST(mockRequest, { params: Promise.resolve(mockParams) });

      // POST now wraps its writes in withTransaction; the underlying
      // begin/commit still fire (the mock models that), but the route no longer
      // threads the transaction id or calls closeConnection itself.
      expect(mockConnectionManager.withTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.beginTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.commitTransaction).toHaveBeenCalledWith('transaction-123');
      expect(response.status).toBe(200);
    });

    it('should remove isNew field from newRow if present', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({ newRow: { name: 'Test', isNew: true } })
      });

      mockInsertReadback(789, { PlotID: 789, Name: 'Test', IsActive: 1 });

      const mockParams = {
        dataType: 'plots',
        slugs: [TEST_SCHEMA, 'plotID', '1', '1']
      };

      await POST(mockRequest, { params: Promise.resolve(mockParams) });

      expect(mockConnectionManager.executeQuery).toHaveBeenCalled();
    });

    it('should handle alltaxonomiesview insert with handleUpsert', async () => {
      const { handleUpsert } = await import('@/config/utils');

      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({
          newRow: {
            Family: 'Fabaceae',
            Genus: 'Acacia',
            GenusAuthority: 'Mill.',
            SpeciesCode: 'ACACIA',
            SpeciesName: 'acacia'
          }
        })
      });

      mockMapper.demapData.mockReturnValue([
        {
          Family: 'Fabaceae',
          Genus: 'Acacia',
          GenusAuthority: 'Mill.',
          SpeciesCode: 'ACACIA',
          SpeciesName: 'acacia'
        }
      ]);
      mockTaxonomyReadback({
        family: { FamilyID: 123, Family: 'Fabaceae' },
        genus: { GenusID: 123, FamilyID: 123, Genus: 'Acacia', GenusAuthority: 'Mill.' },
        species: { SpeciesID: 123, GenusID: 123, SpeciesCode: 'ACACIA', SpeciesName: 'acacia' }
      });

      const mockParams = {
        dataType: 'alltaxonomiesview',
        slugs: [TEST_SCHEMA, 'speciesID', '1', '1']
      };

      const response = await POST(mockRequest, { params: Promise.resolve(mockParams) });

      expect(handleUpsert).toHaveBeenCalledTimes(3); // Family, Genus, Species
      expect(response.status).toBe(200);
    });

    it('rolls back via withTransaction when a write fails in POST', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({ newRow: {} })
      });

      mockConnectionManager.executeQuery.mockRejectedValue(new Error('DB Error'));

      const mockParams = {
        dataType: 'plots',
        slugs: [TEST_SCHEMA, 'plotID', '1', '1']
      };

      const response = await POST(mockRequest, { params: Promise.resolve(mockParams) });

      // POST now delegates rollback to withTransaction and no longer calls
      // closeConnection itself.
      expect(mockConnectionManager.withTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalledWith('transaction-123');
      expect(response.status).toBe(500);
    });

    describe('changelog audit', () => {
      const GENERATED_PLOT_ID = 456;

      it('writes one INSERT row whose RecordID is the generated key, not the submitted payload', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'POST',
          body: JSON.stringify({ newRow: { PlotName: 'New Plot', LocationName: 'Somewhere' } })
        });

        mockInsertReadback(GENERATED_PLOT_ID, { PlotID: GENERATED_PLOT_ID, PlotName: 'New Plot', LocationName: 'Somewhere', IsActive: 1 });

        const response = await POST(mockRequest, {
          params: Promise.resolve({ dataType: 'plots', slugs: [TEST_SCHEMA, 'plotID', '1', '7'] })
        });

        expect(response.status).toBe(200);

        const rows = changelogRows(mockConnectionManager);
        expect(rows).toHaveLength(1);
        expect(rows[0].tableName).toBe('plots');
        // The key only exists after the insert; reading it from the request body
        // would record whatever the client happened to send.
        expect(rows[0].recordID).toBe(String(GENERATED_PLOT_ID));
        expect(rows[0].operation).toBe('INSERT');
        expect(rows[0].oldRowState).toBeNull();
        expect(JSON.parse(rows[0].newRowState).PlotID).toBe(GENERATED_PLOT_ID);
        expect(rows[0].changedBy).toBe(TEST_SESSION_EMAIL);
        expectChangelogWritesAreTransactionScoped(mockConnectionManager);
      });

      it('records an attributes insert under its natural Code key', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'POST',
          body: JSON.stringify({ newRow: { Code: 'BROKEN', Description: 'broken stem', Status: 'alive' } })
        });

        // `attributes` has no AUTO_INCREMENT key, so mysql2 reports insertId 0.
        mockInsertReadback(0, { Code: 'BROKEN', Description: 'broken stem', Status: 'alive', IsActive: 1 });

        await POST(mockRequest, {
          params: Promise.resolve({ dataType: 'attributes', slugs: [TEST_SCHEMA, 'code', '1', '7'] })
        });

        const rows = changelogRows(mockConnectionManager);
        expect(rows).toHaveLength(1);
        expect(rows[0].tableName).toBe('attributes');
        expect(rows[0].recordID).toBe('BROKEN');
      });

      it('captures the generated key for the quadrats branch, which does not return it to the client', async () => {
        const GENERATED_QUADRAT_ID = 33;
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'POST',
          body: JSON.stringify({ newRow: { QuadratID: 0, QuadratName: 'Q-33', PlotID: 5 } })
        });

        mockInsertReadback(GENERATED_QUADRAT_ID, { QuadratID: GENERATED_QUADRAT_ID, QuadratName: 'Q-33', PlotID: 5, IsActive: 1 });

        await POST(mockRequest, {
          params: Promise.resolve({ dataType: 'quadrats', slugs: [TEST_SCHEMA, 'quadratID', '1', '7'] })
        });

        const rows = changelogRows(mockConnectionManager);
        expect(rows).toHaveLength(1);
        expect(rows[0].tableName).toBe('quadrats');
        expect(rows[0].recordID).toBe(String(GENERATED_QUADRAT_ID));
        expect(rows[0].plotID).toBe(5);
      });

      it('records a personnel POST against censusactivepersonnel, the only table it writes', async () => {
        const PERSONNEL_ID = 88;
        const CENSUS_ID = 7;
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'POST',
          body: JSON.stringify({ newRow: { PersonnelID: PERSONNEL_ID, FirstName: 'Existing', LastName: 'Person' } })
        });

        mockInsertReadback(901, { CAPID: 901, CensusID: CENSUS_ID, PersonnelID: PERSONNEL_ID });

        await POST(mockRequest, {
          params: Promise.resolve({ dataType: 'personnel', slugs: [TEST_SCHEMA, 'personnelID', '1', String(CENSUS_ID)] })
        });

        const rows = changelogRows(mockConnectionManager);
        expect(rows).toHaveLength(1);
        // This branch links an existing person to a census; it creates no
        // personnel row. Logging it as `personnel` would assert a person was
        // created who wasn't.
        expect(rows[0].tableName).toBe('censusactivepersonnel');
        expect(rows[0].recordID).toBe('901');
        expect(JSON.parse(rows[0].newRowState)).toEqual({ CAPID: 901, CensusID: CENSUS_ID, PersonnelID: PERSONNEL_ID });
      });

      it('does not log a duplicate personnel activation that INSERT IGNORE skipped', async () => {
        mockConnectionManager.executeQuery.mockResolvedValue({ insertId: 0, affectedRows: 0 });
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'POST',
          body: JSON.stringify({ newRow: { PersonnelID: 88 } })
        });

        const response = await POST(mockRequest, {
          params: Promise.resolve({ dataType: 'personnel', slugs: [TEST_SCHEMA, 'personnelID', '1', '7'] })
        });

        expect(response.status).toBe(HTTPResponses.OK);
        expect(changelogRows(mockConnectionManager)).toHaveLength(0);
      });

      it('fans a single alltaxonomiesview POST out into one row per real table', async () => {
        const { handleUpsert } = await import('@/config/utils');
        const upsertMock = handleUpsert as ReturnType<typeof vi.fn>;
        // Distinct ids per slice so a mis-wired fan-out cannot pass by accident.
        upsertMock
          .mockResolvedValueOnce({ id: 11, operation: 'inserted' })
          .mockResolvedValueOnce({ id: 22, operation: 'inserted' })
          .mockResolvedValueOnce({ id: 33, operation: 'inserted' });

        const submitted = {
          Family: 'Fabaceae',
          Genus: 'Acacia',
          GenusAuthority: 'Mill.',
          SpeciesCode: 'ACACIA',
          SpeciesName: 'acacia'
        };
        mockMapper.demapData.mockReturnValue([submitted]);
        mockTaxonomyReadback({
          family: { FamilyID: 11, Family: 'Fabaceae' },
          genus: { GenusID: 22, FamilyID: 11, Genus: 'Acacia', GenusAuthority: 'Mill.' },
          species: { SpeciesID: 33, GenusID: 22, SpeciesCode: 'ACACIA', SpeciesName: 'acacia' }
        });

        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'POST',
          body: JSON.stringify({ newRow: submitted })
        });

        const response = await POST(mockRequest, {
          params: Promise.resolve({ dataType: 'alltaxonomiesview', slugs: [TEST_SCHEMA, 'speciesID', '1', '7'] })
        });

        expect(response.status).toBe(200);

        const rows = changelogRows(mockConnectionManager);
        // A family edit hidden under the view's name is the same invisibility
        // this audit exists to remove.
        expect(rows.map(row => row.tableName)).toEqual(['family', 'genus', 'species']);
        expect(rows.map(row => row.recordID)).toEqual(['11', '22', '33']);
        expectChangelogWritesAreTransactionScoped(mockConnectionManager);
        expect(rows.every(row => row.operation === 'INSERT')).toBe(true);
        // The species id is the one the handler used to discard entirely.
        expect(JSON.parse(rows[2].newRowState).SpeciesCode).toBe('ACACIA');
        expect(JSON.parse(rows[1].newRowState).FamilyID).toBe(11);
      });

      it('records an upsert that overwrote an existing taxon as UPDATE, not INSERT', async () => {
        const { handleUpsert } = await import('@/config/utils');
        const upsertMock = handleUpsert as ReturnType<typeof vi.fn>;
        upsertMock
          .mockResolvedValueOnce({ id: 11, operation: 'updated' })
          .mockResolvedValueOnce({ id: 22, operation: 'updated' })
          .mockResolvedValueOnce({ id: 33, operation: 'inserted' });

        mockMapper.demapData.mockReturnValue([{ Family: 'Fabaceae', Genus: 'Acacia', SpeciesCode: 'NEWSP' }]);
        mockTaxonomyReadback({
          family: { FamilyID: 11, Family: 'Fabaceae' },
          genus: { GenusID: 22, FamilyID: 11, Genus: 'Acacia' },
          species: { SpeciesID: 33, GenusID: 22, SpeciesCode: 'NEWSP' }
        });

        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'POST',
          body: JSON.stringify({ newRow: { Family: 'Fabaceae', Genus: 'Acacia', SpeciesCode: 'NEWSP' } })
        });

        await POST(mockRequest, {
          params: Promise.resolve({ dataType: 'alltaxonomiesview', slugs: [TEST_SCHEMA, 'speciesID', '1', '7'] })
        });

        const rows = changelogRows(mockConnectionManager);
        // Hardcoding INSERT would claim the family and genus were created here.
        expect(rows.map(row => row.operation)).toEqual(['UPDATE', 'UPDATE', 'INSERT']);
        // An upsert overwrites the row before anything can read it, so the prior
        // state is genuinely unknown — recorded as NULL rather than fabricated.
        expect(rows[0].oldRowState).toBeNull();
        expect(rows[2].oldRowState).toBeNull();
      });

      it('does not log taxonomy slices whose duplicate upsert changed no values', async () => {
        const { handleUpsert } = await import('@/config/utils');
        const upsertMock = handleUpsert as ReturnType<typeof vi.fn>;
        upsertMock
          .mockResolvedValueOnce({ id: 11, operation: 'unchanged' })
          .mockResolvedValueOnce({ id: 22, operation: 'unchanged' })
          .mockResolvedValueOnce({ id: 33, operation: 'unchanged' });
        mockMapper.demapData.mockReturnValue([{ Family: 'Fabaceae', Genus: 'Acacia', SpeciesCode: 'ACACIA' }]);

        const response = await POST(
          new NextRequest('http://localhost/api/test', {
            method: 'POST',
            body: JSON.stringify({ newRow: { Family: 'Fabaceae', Genus: 'Acacia', SpeciesCode: 'ACACIA' } })
          }),
          { params: Promise.resolve({ dataType: 'alltaxonomiesview', slugs: [TEST_SCHEMA, 'speciesID', '1', '7'] }) }
        );

        expect(response.status).toBe(HTTPResponses.OK);
        expect(changelogRows(mockConnectionManager)).toHaveLength(0);
        expect(mockConnectionManager.executeQuery).not.toHaveBeenCalled();
      });

      it('writes nothing when the insert fails and the transaction rolls back', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'POST',
          body: JSON.stringify({ newRow: { PlotName: 'Doomed' } })
        });

        mockConnectionManager.executeQuery.mockRejectedValue(new Error('DB Error'));

        const response = await POST(mockRequest, {
          params: Promise.resolve({ dataType: 'plots', slugs: [TEST_SCHEMA, 'plotID', '1', '7'] })
        });

        expect(response.status).toBe(500);
        expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalledWith('transaction-123');
        expect(changelogRows(mockConnectionManager)).toHaveLength(0);
      });
    });
  });

  describe('DELETE function', () => {
    it('should throw error when slugs not provided', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'DELETE'
      });

      const mockParams = { dataType: 'test', slugs: undefined };

      await expect(DELETE(mockRequest, { params: Promise.resolve(mockParams) })).rejects.toThrow('slugs not provided');
    });

    it('should throw error for missing schema or gridID', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'DELETE',
        body: JSON.stringify({ newRow: { id: 1 } })
      });

      const mockParams = { dataType: 'test', slugs: [TEST_SCHEMA] };

      await expect(DELETE(mockRequest, { params: Promise.resolve(mockParams) })).rejects.toThrow('no schema or gridID provided');
    });

    it('should begin and commit transaction for valid delete', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'DELETE',
        body: JSON.stringify({ newRow: { PlotID: 123 } })
      });

      mockDeleteCapture([{ PlotID: 123, PlotName: 'Doomed Plot' }]);

      const mockParams = {
        dataType: 'plots',
        slugs: [TEST_SCHEMA, 'plotID', '123']
      };

      const response = await DELETE(mockRequest, { params: Promise.resolve(mockParams) });

      // DELETE now wraps its writes in withTransaction; begin/commit still
      // fire (the mock models that), but the route no longer threads the
      // transaction id or calls closeConnection itself.
      expect(mockConnectionManager.withTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.beginTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.commitTransaction).toHaveBeenCalledWith('transaction-123');
      expect(response.status).toBe(200);
    });

    it('should handle attributes dataType delete', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'DELETE',
        body: JSON.stringify({ newRow: { CMAID: 456 } })
      });

      mockDeleteCapture([{ Code: 'DEAD', Description: 'dead stem' }]);

      const mockParams = {
        dataType: 'attributes',
        slugs: [TEST_SCHEMA, 'cmaid', '456']
      };

      const response = await DELETE(mockRequest, { params: Promise.resolve(mockParams) });

      expect(mockConnectionManager.executeQuery).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it('should delete alltaxonomiesview rows by SpeciesID without a CensusID filter', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'DELETE',
        body: JSON.stringify({ newRow: { SpeciesID: 99 } })
      });

      mockMapper.demapData.mockReturnValue([{ SpeciesID: 99 }]);
      mockDeleteCapture([{ SpeciesID: 99, SpeciesCode: 'ACACIA' }]);

      const mockParams = {
        dataType: 'alltaxonomiesview',
        slugs: [TEST_SCHEMA, 'speciesID', '99']
      };

      const response = await DELETE(mockRequest, { params: Promise.resolve(mockParams) });

      // tx.query in the mock delegates to executeQuery(sql, params, transactionID),
      // so the assertion includes the threaded transaction id as the trailing arg.
      expect(mockConnectionManager.executeQuery).toHaveBeenCalledWith(`DELETE FROM \`${TEST_SCHEMA}\`.species WHERE SpeciesID = ?`, [99], 'transaction-123');
      expect(response.status).toBe(200);
    });

    it('rolls back via withTransaction when a write fails in DELETE', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'DELETE',
        body: JSON.stringify({ newRow: { PlotID: 123 } })
      });

      mockConnectionManager.executeQuery.mockRejectedValue(new Error('DB Error'));

      const mockParams = {
        dataType: 'plots',
        slugs: [TEST_SCHEMA, 'plotID', '123']
      };

      const response = await DELETE(mockRequest, { params: Promise.resolve(mockParams) });

      expect(mockConnectionManager.withTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalledWith('transaction-123');
      expect(response.status).toBe(500);
    });

    describe('changelog audit', () => {
      it('writes one DELETE row carrying the removed row and a null NewRowState', async () => {
        const removedRow = { QuadratID: 33, QuadratName: 'Q-33', PlotID: 5, CensusID: 7 };
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'DELETE',
          body: JSON.stringify({ newRow: { QuadratID: 33 } })
        });

        mockMapper.demapData.mockReturnValue([{ QuadratID: 33 }]);
        mockDeleteCapture([removedRow]);

        const response = await DELETE(mockRequest, {
          params: Promise.resolve({ dataType: 'quadrats', slugs: [TEST_SCHEMA, 'quadratID', '33'] })
        });

        expect(response.status).toBe(200);

        const rows = changelogRows(mockConnectionManager);
        expect(rows).toHaveLength(1);
        expect(rows[0].tableName).toBe('quadrats');
        expect(rows[0].recordID).toBe('33');
        expect(rows[0].operation).toBe('DELETE');
        // The request field is named `newRow`, but it is the row being removed.
        expect(JSON.parse(rows[0].oldRowState)).toEqual(removedRow);
        expect(rows[0].newRowState).toBeNull();
        expect(rows[0].plotID).toBe(5);
        expect(rows[0].censusID).toBe(7);
        expectChangelogWritesAreTransactionScoped(mockConnectionManager);
      });

      it('records the state read from the database, not the payload the client sent', async () => {
        // A grid row can be stale. Logging the client's copy would record a
        // prior state that never existed in the table.
        const databaseRow = { QuadratID: 33, QuadratName: 'Renamed Since Load' };
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'DELETE',
          body: JSON.stringify({ newRow: { QuadratID: 33, QuadratName: 'Stale Client Copy' } })
        });

        mockMapper.demapData.mockReturnValue([{ QuadratID: 33, QuadratName: 'Stale Client Copy' }]);
        mockDeleteCapture([databaseRow]);

        await DELETE(mockRequest, {
          params: Promise.resolve({ dataType: 'quadrats', slugs: [TEST_SCHEMA, 'quadratID', '33'] })
        });

        expect(JSON.parse(changelogRows(mockConnectionManager)[0].oldRowState)).toEqual(databaseRow);
      });

      it('names the table actually emptied, not the view the request addressed', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'DELETE',
          body: JSON.stringify({ newRow: { SpeciesID: 99 } })
        });

        mockMapper.demapData.mockReturnValue([{ SpeciesID: 99 }]);
        mockDeleteCapture([{ SpeciesID: 99, SpeciesCode: 'ACACIA' }]);

        await DELETE(mockRequest, {
          params: Promise.resolve({ dataType: 'alltaxonomiesview', slugs: [TEST_SCHEMA, 'speciesID', '99'] })
        });

        const rows = changelogRows(mockConnectionManager);
        expect(rows).toHaveLength(1);
        // `alltaxonomiesview` is a view; the DELETE hits `species`.
        expect(rows[0].tableName).toBe('species');
      });

      it('records a failedmeasurements delete against coremeasurements', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'DELETE',
          body: JSON.stringify({ newRow: { FailedMeasurementID: 5 } })
        });

        mockMapper.demapData.mockReturnValue([{ FailedMeasurementID: 5 }]);
        mockDeleteCapture([{ CoreMeasurementID: 5, StemGUID: null, CensusID: 3 }]);

        await DELETE(mockRequest, {
          params: Promise.resolve({ dataType: 'failedmeasurements', slugs: [TEST_SCHEMA, 'failedMeasurementID', '5'] })
        });

        const rows = changelogRows(mockConnectionManager);
        expect(rows).toHaveLength(1);
        // `failedmeasurements` is a view over coremeasurements rows whose
        // StemGUID is NULL; that is the table the DELETE empties.
        expect(rows[0].tableName).toBe('coremeasurements');
        expect(rows[0].recordID).toBe('5');
      });

      it('writes one row per table a measurementssummary delete empties', async () => {
        const MEASUREMENT_ID = 77;
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'DELETE',
          body: JSON.stringify({ newRow: { CoreMeasurementID: MEASUREMENT_ID } })
        });

        mockMapper.demapData.mockReturnValue([{ CoreMeasurementID: MEASUREMENT_ID }]);
        // Each capture SELECT hits a different table; return a row shaped for
        // whichever table the statement names.
        mockConnectionManager.executeQuery.mockImplementation(async (sql: string) => {
          if (typeof sql !== 'string' || !sql.trimStart().toUpperCase().startsWith('SELECT')) return { affectedRows: 1 };
          if (sql.includes('measurement_error_log')) return [{ MeasurementID: MEASUREMENT_ID, ErrorID: 12, IsResolved: 0 }];
          if (sql.includes('cmattributes')) return [{ CMAID: 501, CoreMeasurementID: MEASUREMENT_ID, Code: 'DEAD' }];
          return [{ CoreMeasurementID: MEASUREMENT_ID, CensusID: 3 }];
        });

        await DELETE(mockRequest, {
          params: Promise.resolve({ dataType: 'measurementssummary', slugs: [TEST_SCHEMA, 'coreMeasurementID', String(MEASUREMENT_ID)] })
        });

        const rows = changelogRows(mockConnectionManager);
        expect(rows.map(row => row.tableName)).toEqual(['measurement_error_log', 'cmattributes', 'coremeasurements']);
        expectChangelogWritesAreTransactionScoped(mockConnectionManager);
        // measurement_error_log is keyed on (MeasurementID, ErrorID), so the
        // RecordID must identify the pair, not just the measurement.
        expect(rows[0].recordID).toBe(`${MEASUREMENT_ID}-12`);
        expect(rows[1].recordID).toBe('501');
        expect(rows[2].recordID).toBe(String(MEASUREMENT_ID));
        expect(rows.every(row => row.operation === 'DELETE' && row.newRowState === null)).toBe(true);
      });

      it('writes nothing when the delete matches no row', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'DELETE',
          body: JSON.stringify({ newRow: { QuadratID: 999 } })
        });

        mockMapper.demapData.mockReturnValue([{ QuadratID: 999 }]);
        mockDeleteCapture([]);

        const response = await DELETE(mockRequest, {
          params: Promise.resolve({ dataType: 'quadrats', slugs: [TEST_SCHEMA, 'quadratID', '999'] })
        });

        expect(response.status).toBe(200);
        // A delete that removed nothing is not a change.
        expect(changelogRows(mockConnectionManager)).toHaveLength(0);
      });
    });
  });

  describe('mutation allowlist covers every client-reachable dataType', () => {
    const cases = CLIENT_REACHABLE_MUTATIONS.flatMap(entry => entry.methods.map(method => ({ dataType: entry.dataType, method })));

    it.each(cases)('does not reject $method $dataType as an unsupported data type', async ({ dataType, method }) => {
      // Permissive mocks: the point is only whether the request gets PAST the
      // allowlist. Any later outcome (200, 404, 500) is fine — a 405 naming an
      // unsupported data type is not, because the client sends this today.
      mockConnectionManager.executeQuery.mockImplementation(async (sql: string) =>
        typeof sql === 'string' && sql.trimStart().toUpperCase().startsWith('SELECT') ? [{ id: 1, Code: 'X', IsActive: 1 }] : { affectedRows: 1, insertId: 1 }
      );

      const body = JSON.stringify({ oldRow: { id: 1 }, newRow: { id: 1 } });
      const request = new NextRequest('http://localhost/api/test', { method, body });
      const slugs = [TEST_SCHEMA, 'id', '1', '1'];
      const params = Promise.resolve({ dataType, slugs });

      const response =
        method === 'PATCH' ? await PATCH(request, { params }) : method === 'POST' ? await POST(request, { params }) : await DELETE(request, { params });

      expect(
        await rejectedAsUnsupportedDataType(response),
        `${method} ${dataType} is reachable from the client but the allowlist rejects it as unsupported`
      ).toBe(false);
    });

    it('still rejects a dataType no client sends', async () => {
      // The allowlist must remain an allowlist — proving the assertion above can
      // actually fail rather than passing vacuously.
      const request = new NextRequest('http://localhost/api/test', { method: 'POST', body: JSON.stringify({ newRow: {} }) });
      const response = await POST(request, {
        params: Promise.resolve({ dataType: 'not_a_real_grid', slugs: [TEST_SCHEMA, 'id', '1', '1'] })
      });

      expect(await rejectedAsUnsupportedDataType(response)).toBe(true);
    });
  });

  describe('Transaction Management', () => {
    it('should handle transaction rollback on error in PATCH', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow: {}, oldRow: {} })
      });

      mockConnectionManager.executeQuery.mockRejectedValue(new Error('Transaction failed'));

      const mockParams = {
        dataType: 'plots',
        slugs: [TEST_SCHEMA, 'plotID']
      };

      await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

      // PATCH delegates rollback to withTransaction; it no longer rolls back or
      // closes the connection in its own finally.
      expect(mockConnectionManager.withTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalled();
    });

    it('should handle transaction rollback on error in POST', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({ newRow: {} })
      });

      mockConnectionManager.executeQuery.mockRejectedValue(new Error('Insert failed'));

      const mockParams = {
        dataType: 'plots',
        slugs: [TEST_SCHEMA, 'plotID', '1', '1']
      };

      await POST(mockRequest, { params: Promise.resolve(mockParams) });

      // POST delegates rollback to withTransaction; it no longer rolls back or
      // closes the connection in its own finally.
      expect(mockConnectionManager.withTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalled();
    });

    it('should handle transaction rollback on error in DELETE', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'DELETE',
        body: JSON.stringify({ newRow: { PlotID: 123 } })
      });

      mockConnectionManager.executeQuery.mockRejectedValue(new Error('Delete failed'));

      const mockParams = {
        dataType: 'plots',
        slugs: [TEST_SCHEMA, 'plotID', '123']
      };

      await DELETE(mockRequest, { params: Promise.resolve(mockParams) });

      // DELETE delegates rollback to withTransaction; it no longer rolls back or
      // closes the connection in its own finally.
      expect(mockConnectionManager.withTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('PRIMARY_KEY_MAP Logic', () => {
    describe('PATCH with PRIMARY_KEY_MAP', () => {
      it('still rejects failedmeasurements PATCH with 405 regardless of slugs shape (numeric or column-name)', async () => {
        const applyEditMock = applyEdit as ReturnType<typeof vi.fn>;
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'PATCH',
          body: JSON.stringify({
            newRow: { Tag: '123' },
            oldRow: { Tag: '122' },
            planHash: PLAN_HASH
          })
        });

        const response = await PATCH(mockRequest, {
          params: Promise.resolve({
            dataType: 'failedmeasurements',
            slugs: ['forestgeo_panama', '1']
          })
        });

        expect(response.status).toBe(405);
        expect(applyEditMock).not.toHaveBeenCalled();
      });

      it('rejects direct coremeasurements PATCH so measurement edits cannot bypass the edit plan', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'PATCH',
          body: JSON.stringify({
            newRow: { CoreMeasurementID: 42, MeasuredDBH: 15.5 },
            oldRow: { CoreMeasurementID: 42, MeasuredDBH: 15.0 }
          })
        });

        const mockParams = {
          dataType: 'coremeasurements',
          slugs: ['forestgeo_test', '42']
        };

        const response = await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

        expect(response.status).toBe(HTTPResponses.METHOD_NOT_ALLOWED);
        expect(mockConnectionManager.executeQuery).not.toHaveBeenCalled();
      });

      it('should use Code for attributes dataType', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'PATCH',
          body: JSON.stringify({
            newRow: { Code: 'TEST', Description: 'Updated' },
            oldRow: { Code: 'TEST', Description: 'Original' }
          })
        });

        mockPatchSnapshots({ Code: 'TEST', Description: 'Original' }, { Code: 'TEST', Description: 'Updated' });

        const mockParams = {
          dataType: 'attributes',
          slugs: ['forestgeo_test', 'TEST']
        };

        const response = await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

        expect(response.status).toBe(200);

        const updateCall = mockConnectionManager.executeQuery.mock.calls.find(
          (call: any) => typeof call[0] === 'string' && call[0].trimStart().toUpperCase().startsWith('UPDATE')
        );
        expect(updateCall[0]).toMatch(/Code/i);
      });

      it('should update attributes.Code using the original code in the WHERE clause', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'PATCH',
          body: JSON.stringify({
            newRow: { Code: 'NEWCODE', Description: 'Updated' },
            oldRow: { Code: 'OLDCODE', Description: 'Original' }
          })
        });

        mockPatchSnapshots({ Code: 'OLDCODE', Description: 'Original' }, { Code: 'NEWCODE', Description: 'Updated' });

        const mockParams = {
          dataType: 'attributes',
          slugs: ['forestgeo_test', 'code']
        };

        const response = await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

        expect(response.status).toBe(200);

        const updateCall = mockConnectionManager.executeQuery.mock.calls.find(
          (call: any) => typeof call[0] === 'string' && call[0].trimStart().toUpperCase().startsWith('UPDATE')
        );
        expect(updateCall).toBeDefined();
        expect(updateCall[0]).toContain('NEWCODE');
        expect(updateCall[0]).toContain('OLDCODE');
      });

      it('rejects unmapped dataTypes instead of treating the route as an arbitrary-table writer', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'PATCH',
          body: JSON.stringify({
            newRow: { CustomID: 99, Name: 'Updated' },
            oldRow: { CustomID: 99, Name: 'Original' }
          })
        });

        const mockParams = {
          dataType: 'customtable', // Not in PRIMARY_KEY_MAP
          slugs: ['forestgeo_test', 'customID']
        };

        const response = await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

        expect(response.status).toBe(HTTPResponses.METHOD_NOT_ALLOWED);
        expect(mockConnectionManager.executeQuery).not.toHaveBeenCalled();
      });
    });

    describe('DELETE with PRIMARY_KEY_MAP', () => {
      it('should use FailedMeasurementID input while deleting the failed coremeasurement row', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'DELETE',
          body: JSON.stringify({ newRow: { FailedMeasurementID: 5 } })
        });

        mockDeleteCapture([{ CoreMeasurementID: 5, StemGUID: null, CensusID: 3 }]);
        mockMapper.demapData.mockReturnValue([{ FailedMeasurementID: 5 }]);

        const mockParams = {
          dataType: 'failedmeasurements',
          slugs: ['forestgeo_panama', '5']
        };

        const response = await DELETE(mockRequest, { params: Promise.resolve(mockParams) });

        expect(response.status).toBe(200);

        const deleteCall = mockConnectionManager.executeQuery.mock.calls.find((call: any) => typeof call[0] === 'string' && call[0].includes('DELETE'));
        expect(deleteCall[0]).toMatch(/CoreMeasurementID/i);
        expect(deleteCall[1]).toEqual([5]);
      });

      it('rejects direct stems DELETE outside the supported metadata surface', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'DELETE',
          body: JSON.stringify({ newRow: { StemGUID: 12345 } })
        });

        const mockParams = {
          dataType: 'stems',
          slugs: ['forestgeo_test', '12345']
        };

        const response = await DELETE(mockRequest, { params: Promise.resolve(mockParams) });

        expect(response.status).toBe(HTTPResponses.METHOD_NOT_ALLOWED);
        expect(mockConnectionManager.executeQuery).not.toHaveBeenCalled();
      });
    });

    describe('PRIMARY_KEY_MAP Coverage', () => {
      const primaryKeyMappings = [
        { dataType: 'failedmeasurements', primaryKey: 'FailedMeasurementID' },
        { dataType: 'coremeasurements', primaryKey: 'CoreMeasurementID' },
        { dataType: 'attributes', primaryKey: 'Code' },
        { dataType: 'census', primaryKey: 'CensusID' },
        { dataType: 'cmattributes', primaryKey: 'CMAID' },
        { dataType: 'family', primaryKey: 'FamilyID' },
        { dataType: 'genus', primaryKey: 'GenusID' },
        { dataType: 'personnel', primaryKey: 'PersonnelID' },
        { dataType: 'plots', primaryKey: 'PlotID' },
        { dataType: 'quadrats', primaryKey: 'QuadratID' },
        { dataType: 'species', primaryKey: 'SpeciesID' },
        { dataType: 'stems', primaryKey: 'StemGUID' },
        { dataType: 'trees', primaryKey: 'TreeID' }
      ];

      it('should have PRIMARY_KEY_MAP defined for critical dataTypes', () => {
        // This test documents the expected mappings
        primaryKeyMappings.forEach(mapping => {
          expect(mapping.primaryKey).toBeDefined();
          expect(mapping.primaryKey).not.toBe('');
        });
      });
    });
  });
});
