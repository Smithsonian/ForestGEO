/**
 * Recent Changes (#507): the read side, proven end-to-end against real MySQL.
 *
 * recent-changes-ledger-history.integration.test.ts proves the WRITE side (the
 * live dual-write and the historical backfill migration both land the correct
 * rows in `unifiedchangelog`). This suite proves the READ side: that a caller
 * actually SEES those rows through every production read path the app ships —
 *
 *   - POST /api/changes/explorer/query   (the Recent Changes search/filter UI)
 *   - GET  /api/fixeddata/unifiedchangelog/... (the raw changelog grid)
 *   - GET  /api/changelog/overview/unifiedchangelog/... (the dashboard widget)
 *
 * — and that a new (dual-write) event and a historical (migration-backfilled)
 * event are both visible exactly once, a sitewide (NULL-scope) entry is visible
 * from every plot, an entry scoped to a different plot/census is excluded, and
 * quick search matches real row content rather than just metadata.
 *
 * Every write goes through the production ledger helper (`writeEditOperation`)
 * or the production migration (`applyPendingMigrations` against the real
 * manifest-listed SQL file); every read goes through the production route
 * handlers. Nothing here hand-builds a changelog row or reimplements a query.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import path from 'path';
import { NextRequest } from 'next/server';

import { createAdditionalCensus, setupTestDatabase, teardownTestDatabase, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';
import { HTTPResponses } from '@/config/macros';
import {
  DEFAULT_RECENT_CHANGES_FILTERS,
  type ChangelogEntry,
  type FeedItem,
  type RecentChangesFacetsResponse,
  type RecentChangesFilters,
  type RecentChangesQueryResponse
} from '@/config/recentchangesexplorer';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  plotIDForCookie: null as number | null
}));

const TEST_TRANSACTION_ID = 'recent-changes-read-path-txn';

const READ_PATH_CHANGED_BY = 'recent-changes-read-path@forestgeo.test';
const LEGACY_CHANGED_BY = 'legacy-recent-changes-read-path@forestgeo.test';

const LIVE_MARKER = 'READPATH_LIVE_A1_MARKER';
const HISTORICAL_MARKER = 'READPATH_HISTORICAL_A1_MARKER';
const PLOT_B_MARKER = 'READPATH_PLOTB_MARKER';
const CENSUS_A2_MARKER = 'READPATH_A2_MARKER';
const NO_SUCH_MARKER = 'READPATH_NO_SUCH_MARKER_EXISTS';

const LIVE_A1_PRIMARY_KEY = 80001;
const HISTORICAL_A1_PRIMARY_KEY = 80002;
const PLOT_B_PRIMARY_KEY = 80003;
const CENSUS_A2_PRIMARY_KEY = 80004;
const OPERATION_FACET_DELTA_PRIMARY_KEY = 80005;
const NULL_SCOPE_PLAN_HASH = 'readpath-null-scope';

const SECOND_PLOT_NAME = 'Recent Changes Read-Path Second Plot';
// No real row needs to exist for this: edit_operations.CensusID carries no FK,
// and the plot-B assertions below only exercise the explorer search route,
// which (see _shared.ts buildWhereClause) never filters on CensusID at all.
const PLOT_B_ARBITRARY_CENSUS_ID = 909090;

// ---------------------------------------------------------------------------
// Mock ConnectionManager, mirroring recent-changes-ledger-history.integration
// .test.ts: the adapter drives the ONE shared real connection, so
// writeEditOperation's transaction, the migration runner's exec, and every
// read-path route's ConnectionManager.getInstance() all operate on the exact
// same real MySQL state.
// ---------------------------------------------------------------------------
vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      const [rows] = await sharedState.connection.query(query, (params as unknown[]) ?? []);
      return rows;
    },
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (sharedState.activeTransactionID) throw new Error('ConnectionManager mock: transaction already active');
      await sharedState.connection.beginTransaction();
      sharedState.activeTransactionID = TEST_TRANSACTION_ID;
      return TEST_TRANSACTION_ID;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: commit transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: rollback transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
    },
    cleanupStaleTransactions: async () => undefined,
    // Routes call closeConnection() in a `finally` after every request; it must
    // not actually tear down the one shared connection this whole suite reuses.
    closeConnection: async () => undefined,
    acquireApplicationLock: async () => true
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({
  default: { info: () => undefined, warn: () => undefined, error: () => undefined }
}));

// The read-path routes authorize via a real session (withRouteAuthz /
// validateContextualValues); only the identity provider is mocked. The
// default here is immediately replaced in beforeAll/beforeEach once `schema`
// is known; it exists only so the factory has a well-typed implementation.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: READ_PATH_CHANGED_BY, userStatus: 'global', sites: [] } }))
}));

// The changelog overview route's PRIMARY path resolves plotID from the
// `plotID` cookie (exactly like the real dashboard, which never passes
// `?plotID=`) — only `schema` comes from the query string. Every other
// cookie key resolves to undefined so nothing else is accidentally supplied.
vi.mock('@/app/actions/cookiemanager', () => ({
  getCookie: vi.fn(async (name: string) => (name === 'plotID' && sharedState.plotIDForCookie ? String(sharedState.plotIDForCookie) : undefined))
}));

// Imports below must follow the mocks above so every module under test picks
// up the mocked ConnectionManager/auth/cookiemanager.
import ConnectionManager from '@/lib/db/connectionmanager';
import { auth } from '@/auth';
import { ensureEditOperationsTable, writeEditOperation, type EditOperationStateRow, type EditOperationWriteInput } from '@/config/editoperations';
import { BULK_REVISION_SUMMARY_KIND } from '@/lib/changelog/edit-operation-projection';
import { loadMigrationSources, applyPendingMigrations, type SqlExecutor } from '@/scripts/apply-schema-migrations';
import { SCHEMA_MIGRATION_MANIFEST } from '@/db/migrations/manifest';
import { POST as explorerQueryPOST } from '@/app/api/changes/explorer/query/route';
import { POST as explorerFacetsPOST } from '@/app/api/changes/explorer/facets/route';
import { GET as fixedDataGET } from '@/app/api/fixeddata/[dataType]/[[...slugs]]/route';
import { GET as overviewGET } from '@/app/api/changelog/overview/[changelogType]/[[...options]]/route';

interface MappedChangelogRow {
  changeID: number;
  tableName: string;
  recordID: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  oldRowState: Record<string, unknown> | null;
  newRowState: Record<string, unknown> | null;
  changedBy: string;
  plotID?: number;
  censusID?: number;
}

describe('Recent Changes read path (#507): production ledger write -> production GET/POST read', () => {
  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;
  let schema: string;
  const cm = ConnectionManager.getInstance();

  let plotA: number;
  let plotB: number;
  let censusA1: number;
  let pcnA1: number;
  let censusA2: number;
  let pcnA2: number;

  let liveA1OperationID: number;
  let historicalA1OperationID: number;
  let nullScopeOperationID: number;
  let plotBOperationID: number;
  let censusA2OperationID: number;

  const liveA1RecordID = () => `${LIVE_A1_PRIMARY_KEY}::edit-op-${liveA1OperationID}`;
  const historicalA1RecordID = () => `${HISTORICAL_A1_PRIMARY_KEY}::edit-op-${historicalA1OperationID}`;
  const nullScopeRecordID = () => `${NULL_SCOPE_PLAN_HASH}::edit-op-${nullScopeOperationID}`;
  const plotBRecordID = () => `${PLOT_B_PRIMARY_KEY}::edit-op-${plotBOperationID}`;
  const censusA2RecordID = () => `${CENSUS_A2_PRIMARY_KEY}::edit-op-${censusA2OperationID}`;

  function buildInput(overrides: Partial<EditOperationWriteInput> = {}): EditOperationWriteInput {
    return {
      operationType: 'single-row-edit',
      dataType: 'measurementssummary',
      targetID: LIVE_A1_PRIMARY_KEY,
      plotID: plotA,
      censusID: censusA1,
      planHash: 'a'.repeat(64),
      beforeState: [],
      afterState: [],
      createdBy: READ_PATH_CHANGED_BY,
      ...overrides
    };
  }

  async function writeLiveEdit(input: Partial<EditOperationWriteInput>): Promise<number> {
    const txn = await cm.beginTransaction();
    const editOperationID = await writeEditOperation(cm, schema, buildInput(input), txn);
    await cm.commitTransaction(txn);
    return editOperationID;
  }

  async function insertHistoricalLedgerRow(input: {
    plotID: number;
    censusID: number;
    beforeState: EditOperationStateRow[];
    afterState: EditOperationStateRow[];
    createdBy: string;
  }): Promise<number> {
    const [result] = await connection.query<any>(
      `INSERT INTO edit_operations (OperationType, Revertable, DataType, TargetID, PlotID, CensusID, PlanHash, BeforeState, AfterState, CreatedBy)
       VALUES ('single-row-edit', TRUE, 'measurementssummary', NULL, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)`,
      [input.plotID, input.censusID, 'f'.repeat(64), JSON.stringify(input.beforeState), JSON.stringify(input.afterState), input.createdBy]
    );
    return result.insertId;
  }

  async function createSecondPlot(): Promise<number> {
    await connection.query(
      `INSERT INTO plots (PlotName, LocationName, CountryName, DimensionX, DimensionY, Area, GlobalX, GlobalY, GlobalZ, PlotShape, PlotDescription)
       VALUES (?, 'Second Test Location', 'Panama', 200, 200, 40000, 10, 10, 0, 'square', 'Second plot for recent-changes read-path test')`,
      [SECOND_PLOT_NAME]
    );
    const [rows] = await connection.query<RowDataPacket[]>('SELECT PlotID FROM plots WHERE PlotName = ?', [SECOND_PLOT_NAME]);
    return rows[0].PlotID;
  }

  function sessionFor(email: string): { user: { email: string; userStatus: string; sites: Array<{ schemaName: string }> } } {
    return { user: { email, userStatus: 'global', sites: [{ schemaName: schema }] } };
  }

  function findSingle(items: FeedItem[], recordID: string): ChangelogEntry | undefined {
    const match = items.find(item => item.type === 'single' && item.entry.recordID === recordID);
    return match && match.type === 'single' ? match.entry : undefined;
  }

  async function postExplorerQuery(plotID: number, filters: Partial<RecentChangesFilters> = {}): Promise<FeedItem[]> {
    const request = new Request('http://localhost/api/changes/explorer/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schema,
        plotID,
        page: 0,
        pageSize: 50,
        filters: { ...DEFAULT_RECENT_CHANGES_FILTERS, ...filters }
      })
    });
    const response = await explorerQueryPOST(request as unknown as NextRequest, { params: Promise.resolve({}) });
    const body = await response.json();
    expect(response.status, `explorer query failed: ${JSON.stringify(body)}`).toBe(HTTPResponses.OK);
    return body.items as FeedItem[];
  }

  async function postExplorerQueryFull(plotID: number, filters: Partial<RecentChangesFilters> = {}): Promise<RecentChangesQueryResponse> {
    const request = new Request('http://localhost/api/changes/explorer/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schema,
        plotID,
        page: 0,
        pageSize: 50,
        filters: { ...DEFAULT_RECENT_CHANGES_FILTERS, ...filters }
      })
    });
    const response = await explorerQueryPOST(request as unknown as NextRequest, { params: Promise.resolve({}) });
    const body = await response.json();
    expect(response.status, `explorer query failed: ${JSON.stringify(body)}`).toBe(HTTPResponses.OK);
    return body as RecentChangesQueryResponse;
  }

  async function postExplorerFacets(plotID: number): Promise<RecentChangesFacetsResponse> {
    const request = new Request('http://localhost/api/changes/explorer/facets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schema, plotID })
    });
    const response = await explorerFacetsPOST(request as unknown as NextRequest, { params: Promise.resolve({}) });
    const body = await response.json();
    expect(response.status, `explorer facets failed: ${JSON.stringify(body)}`).toBe(HTTPResponses.OK);
    return body as RecentChangesFacetsResponse;
  }

  async function getFixedDataChangelog(plotID: number, plotCensusNumber: number): Promise<MappedChangelogRow[]> {
    const slugs = [schema, '0', '100', String(plotID), String(plotCensusNumber)];
    const request = new NextRequest(`http://localhost/api/fixeddata/unifiedchangelog/${slugs.join('/')}`);
    const response = await fixedDataGET(request, { params: Promise.resolve({ dataType: 'unifiedchangelog', slugs }) });
    const body = await response.json();
    expect(response.status, `fixeddata unifiedchangelog GET failed: ${JSON.stringify(body)}`).toBe(HTTPResponses.OK);
    return body.output as MappedChangelogRow[];
  }

  async function getOverviewChangelog(plotCensusNumber: number): Promise<MappedChangelogRow[]> {
    const url = new URL(`http://localhost/api/changelog/overview/unifiedchangelog/${plotA}/${plotCensusNumber}`);
    url.searchParams.set('schema', schema);
    const request = new NextRequest(url, { method: 'GET' });
    const response = await overviewGET(request, {
      params: Promise.resolve({ changelogType: 'unifiedchangelog', options: [String(plotA), String(plotCensusNumber)] })
    });
    const body = await response.json();
    expect(response.status, `changelog overview GET failed: ${JSON.stringify(body)}`).toBe(HTTPResponses.OK);
    return (body ?? []) as MappedChangelogRow[]; // the route returns literal `null` when no rows match
  }

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    schema = config.database;
    sharedState.connection = connection;

    plotA = testData.plots[0].plotID;
    censusA1 = testData.census[0].censusID;
    pcnA1 = testData.census[0].plotCensusNumber;
    sharedState.plotIDForCookie = plotA;

    const censusA2Info = await createAdditionalCensus(connection, testData, {
      plotCensusNumber: 2,
      startDate: '2025-01-01',
      endDate: '2025-12-31'
    });
    censusA2 = censusA2Info.censusID;
    pcnA2 = censusA2Info.plotCensusNumber;

    plotB = await createSecondPlot();

    vi.mocked(auth).mockResolvedValue(sessionFor(READ_PATH_CHANGED_BY) as any);

    await ensureEditOperationsTable(cm, schema);

    // --- seed the live (dual-write) entries -------------------------------
    liveA1OperationID = await writeLiveEdit({
      plotID: plotA,
      censusID: censusA1,
      targetID: LIVE_A1_PRIMARY_KEY,
      beforeState: [
        {
          table: 'coremeasurements',
          primaryKey: 'CoreMeasurementID',
          primaryKeyValue: LIVE_A1_PRIMARY_KEY,
          row: { Description: 'before-live-a1', MeasuredDBH: 10 }
        }
      ],
      afterState: [
        {
          table: 'coremeasurements',
          primaryKey: 'CoreMeasurementID',
          primaryKeyValue: LIVE_A1_PRIMARY_KEY,
          row: { Description: LIVE_MARKER, MeasuredDBH: 11.1 }
        }
      ]
    });

    nullScopeOperationID = await writeLiveEdit({
      operationType: 'bulk-revision-row',
      revertable: false,
      plotID: 0,
      censusID: 0,
      targetID: null,
      beforeState: [
        {
          table: 'bulk-revision-apply',
          primaryKey: 'bulkPlanHash',
          primaryKeyValue: NULL_SCOPE_PLAN_HASH,
          row: { updatedCount: 2, skippedCount: 1, insertedCount: 0, deletedDuplicateCount: 0 }
        }
      ],
      afterState: []
    });

    plotBOperationID = await writeLiveEdit({
      plotID: plotB,
      censusID: PLOT_B_ARBITRARY_CENSUS_ID,
      targetID: PLOT_B_PRIMARY_KEY,
      beforeState: [
        {
          table: 'coremeasurements',
          primaryKey: 'CoreMeasurementID',
          primaryKeyValue: PLOT_B_PRIMARY_KEY,
          row: { Description: 'before-plotb', MeasuredDBH: 30 }
        }
      ],
      afterState: [
        {
          table: 'coremeasurements',
          primaryKey: 'CoreMeasurementID',
          primaryKeyValue: PLOT_B_PRIMARY_KEY,
          row: { Description: PLOT_B_MARKER, MeasuredDBH: 33.3 }
        }
      ]
    });

    censusA2OperationID = await writeLiveEdit({
      plotID: plotA,
      censusID: censusA2,
      targetID: CENSUS_A2_PRIMARY_KEY,
      beforeState: [
        {
          table: 'coremeasurements',
          primaryKey: 'CoreMeasurementID',
          primaryKeyValue: CENSUS_A2_PRIMARY_KEY,
          row: { Description: 'before-a2', MeasuredDBH: 40 }
        }
      ],
      afterState: [
        {
          table: 'coremeasurements',
          primaryKey: 'CoreMeasurementID',
          primaryKeyValue: CENSUS_A2_PRIMARY_KEY,
          row: { Description: CENSUS_A2_MARKER, MeasuredDBH: 44.4 }
        }
      ]
    });

    // --- seed a HISTORICAL entry directly (bypassing the dual-write), then
    // backfill it through the production migration, exactly like
    // recent-changes-ledger-history.integration.test.ts's historical describe. ---
    historicalA1OperationID = await insertHistoricalLedgerRow({
      plotID: plotA,
      censusID: censusA1,
      createdBy: LEGACY_CHANGED_BY,
      beforeState: [
        {
          table: 'coremeasurements',
          primaryKey: 'CoreMeasurementID',
          primaryKeyValue: HISTORICAL_A1_PRIMARY_KEY,
          row: { Description: 'before-hist-a1', MeasuredDBH: 20 }
        }
      ],
      afterState: [
        {
          table: 'coremeasurements',
          primaryKey: 'CoreMeasurementID',
          primaryKeyValue: HISTORICAL_A1_PRIMARY_KEY,
          row: { Description: HISTORICAL_MARKER, MeasuredDBH: 22.2 }
        }
      ]
    });

    const sources = loadMigrationSources(SCHEMA_MIGRATION_MANIFEST, path.join(process.cwd(), 'db', 'migrations'));
    const exec: SqlExecutor = async (sql, params) => {
      const [rows] = await connection.query(sql, params ?? []);
      return Array.isArray(rows) ? (rows as any) : [];
    };
    const result = await applyPendingMigrations(exec, schema, sources);
    expect(result.failed, `migration run must not fail: ${JSON.stringify(result.failed)}`).toBeNull();
  }, 120_000);

  afterAll(async () => {
    sharedState.connection = null;
    sharedState.activeTransactionID = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(() => {
    sharedState.activeTransactionID = null;
    vi.mocked(auth).mockResolvedValue(sessionFor(READ_PATH_CHANGED_BY) as any);
  });

  describe('a new (dual-write) event is visible exactly once through every read path', () => {
    it('explorer search (POST /api/changes/explorer/query)', async () => {
      const items = await postExplorerQuery(plotA);
      const matches = items.filter(item => item.type === 'single' && item.entry.recordID === liveA1RecordID());
      expect(matches, `expected exactly one match for ${liveA1RecordID()}`).toHaveLength(1);
      const entry = findSingle(items, liveA1RecordID())!;
      expect(entry.tableName).toBe('coremeasurements');
      expect(entry.operation).toBe('UPDATE');
      expect(entry.newRowState?.Description).toBe(LIVE_MARKER);
      expect(entry.changedBy).toBe(READ_PATH_CHANGED_BY);
    });

    it('the unifiedchangelog grid (GET /api/fixeddata/unifiedchangelog/...)', async () => {
      const rows = await getFixedDataChangelog(plotA, pcnA1);
      const matches = rows.filter(row => row.recordID === liveA1RecordID());
      expect(matches).toHaveLength(1);
      expect(matches[0].newRowState?.Description).toBe(LIVE_MARKER);
    });

    it('the dashboard changelog overview (GET /api/changelog/overview/unifiedchangelog/...)', async () => {
      const rows = await getOverviewChangelog(pcnA1);
      const matches = rows.filter(row => row.recordID === liveA1RecordID());
      expect(matches).toHaveLength(1);
      expect(matches[0].newRowState?.Description).toBe(LIVE_MARKER);
    });
  });

  describe('a historical (migration-backfilled) event is visible exactly once, attributed to its original author', () => {
    it('explorer search (POST /api/changes/explorer/query)', async () => {
      const items = await postExplorerQuery(plotA);
      const entry = findSingle(items, historicalA1RecordID());
      expect(entry, `expected to find backfilled ${historicalA1RecordID()}`).toBeDefined();
      expect(entry!.newRowState?.Description).toBe(HISTORICAL_MARKER);
      expect(entry!.changedBy).toBe(LEGACY_CHANGED_BY);
    });

    it('the unifiedchangelog grid (GET /api/fixeddata/unifiedchangelog/...)', async () => {
      const rows = await getFixedDataChangelog(plotA, pcnA1);
      const matches = rows.filter(row => row.recordID === historicalA1RecordID());
      expect(matches).toHaveLength(1);
      expect(matches[0].changedBy).toBe(LEGACY_CHANGED_BY);
    });

    it('the dashboard changelog overview (GET /api/changelog/overview/unifiedchangelog/...)', async () => {
      const rows = await getOverviewChangelog(pcnA1);
      const matches = rows.filter(row => row.recordID === historicalA1RecordID());
      expect(matches).toHaveLength(1);
      expect(matches[0].changedBy).toBe(LEGACY_CHANGED_BY);
    });
  });

  describe('a sitewide (NULL-scope) entry is visible from every plot, with its summary metadata intact', () => {
    it('is returned by explorer search under BOTH plot A and plot B', async () => {
      const itemsForA = await postExplorerQuery(plotA);
      const itemsForB = await postExplorerQuery(plotB);

      for (const items of [itemsForA, itemsForB]) {
        const entry = findSingle(items, nullScopeRecordID());
        expect(entry, 'sitewide entry must be visible regardless of plot').toBeDefined();
        expect(entry!.tableName).toBe('bulk-revision-apply');
        expect(entry!.oldRowState, 'a bulk-revision summary has no before state').toBeNull();
        // The real counts from BeforeState[0], not a fabricated/altered value,
        // and the summaryKind marker that stops every render path from ever
        // computing a field-level diff against this summary object.
        expect(entry!.newRowState).toEqual({
          updatedCount: 2,
          skippedCount: 1,
          insertedCount: 0,
          deletedDuplicateCount: 0,
          summaryKind: BULK_REVISION_SUMMARY_KIND
        });
      }
    });

    it('is returned by the unifiedchangelog grid under BOTH census PCN 1 and PCN 2 of plot A', async () => {
      const rowsPCN1 = await getFixedDataChangelog(plotA, pcnA1);
      const rowsPCN2 = await getFixedDataChangelog(plotA, pcnA2);

      for (const rows of [rowsPCN1, rowsPCN2]) {
        const match = rows.find(row => row.recordID === nullScopeRecordID());
        expect(match, 'sitewide entry must be visible regardless of census').toBeDefined();
        expect(match!.newRowState?.summaryKind).toBe(BULK_REVISION_SUMMARY_KIND);
      }
    });
  });

  describe('an entry scoped to a different plot or census is excluded', () => {
    it('excludes an entry scoped to a different plot from explorer search', async () => {
      const itemsForA = await postExplorerQuery(plotA);
      expect(findSingle(itemsForA, plotBRecordID()), "plot A's query must not see plot B's entry").toBeUndefined();

      const itemsForB = await postExplorerQuery(plotB);
      expect(findSingle(itemsForB, liveA1RecordID()), "plot B's query must not see plot A's live entry").toBeUndefined();
      expect(findSingle(itemsForB, historicalA1RecordID()), "plot B's query must not see plot A's historical entry").toBeUndefined();
      expect(findSingle(itemsForB, censusA2RecordID()), "plot B's query must not see plot A's census-A2 entry").toBeUndefined();

      const plotBEntry = findSingle(itemsForB, plotBRecordID());
      expect(plotBEntry?.newRowState?.Description).toBe(PLOT_B_MARKER);
    });

    it('excludes an entry scoped to a different census (same plot) from the unifiedchangelog grid', async () => {
      const rowsPCN1 = await getFixedDataChangelog(plotA, pcnA1);
      expect(
        rowsPCN1.find(row => row.recordID === censusA2RecordID()),
        'PCN 1 must not see the PCN-2-scoped entry'
      ).toBeUndefined();

      const rowsPCN2 = await getFixedDataChangelog(plotA, pcnA2);
      expect(
        rowsPCN2.find(row => row.recordID === liveA1RecordID()),
        'PCN 2 must not see the PCN-1-scoped live entry'
      ).toBeUndefined();
      expect(
        rowsPCN2.find(row => row.recordID === historicalA1RecordID()),
        'PCN 2 must not see the PCN-1-scoped historical entry'
      ).toBeUndefined();
      const censusA2Row = rowsPCN2.find(row => row.recordID === censusA2RecordID());
      expect(censusA2Row?.newRowState?.Description).toBe(CENSUS_A2_MARKER);
    });

    it('excludes an entry scoped to a different census (same plot) from the dashboard changelog overview', async () => {
      const rowsPCN1 = await getOverviewChangelog(pcnA1);
      expect(
        rowsPCN1.find(row => row.recordID === censusA2RecordID()),
        'PCN 1 overview must not see the PCN-2-scoped entry'
      ).toBeUndefined();

      const rowsPCN2 = await getOverviewChangelog(pcnA2);
      expect(
        rowsPCN2.find(row => row.recordID === liveA1RecordID()),
        'PCN 2 overview must not see the PCN-1-scoped live entry'
      ).toBeUndefined();
      expect(
        rowsPCN2.find(row => row.recordID === historicalA1RecordID()),
        'PCN 2 overview must not see the PCN-1-scoped historical entry'
      ).toBeUndefined();
    });
  });

  describe('quick search matches real row content, not just metadata', () => {
    it('finds only the live entry when searching for its marker', async () => {
      const items = await postExplorerQuery(plotA, { quickSearch: LIVE_MARKER });
      const singles = items.filter((item): item is { type: 'single'; entry: ChangelogEntry } => item.type === 'single');
      expect(singles.map(s => s.entry.recordID)).toEqual([liveA1RecordID()]);
    });

    it('finds only the historical entry when searching for its marker', async () => {
      const items = await postExplorerQuery(plotA, { quickSearch: HISTORICAL_MARKER });
      const singles = items.filter((item): item is { type: 'single'; entry: ChangelogEntry } => item.type === 'single');
      expect(singles.map(s => s.entry.recordID)).toEqual([historicalA1RecordID()]);
    });

    it('finds the census-A2 entry under plot A regardless of census, by its real row content', async () => {
      const items = await postExplorerQuery(plotA, { quickSearch: CENSUS_A2_MARKER });
      const singles = items.filter((item): item is { type: 'single'; entry: ChangelogEntry } => item.type === 'single');
      expect(singles.map(s => s.entry.recordID)).toEqual([censusA2RecordID()]);
    });

    it('returns nothing for a marker that matches no row state', async () => {
      const items = await postExplorerQuery(plotA, { quickSearch: NO_SUCH_MARKER });
      expect(items).toEqual([]);
    });
  });

  describe('explorer summary counts and facets reflect real writes, scoped PLOT-WIDE (own plot + NULL-scope)', () => {
    it("summary.total/updates isolates exactly this suite's three plotA-visible UPDATEs (live A1, sitewide NULL-scope, census A2) when filtered by changedBy", async () => {
      // changedBy isolates this suite's own rows from any other fixture data;
      // plot B's entry shares that changedBy but must still be excluded by scope.
      const response = await postExplorerQueryFull(plotA, { changedBy: READ_PATH_CHANGED_BY });

      expect(response.summary).toEqual({ total: 3, updates: 3, inserts: 0, deletes: 0 });
      expect(response.totalItems).toBe(3);

      const recordIDs = response.items
        .filter((item): item is { type: 'single'; entry: ChangelogEntry } => item.type === 'single')
        .map(item => item.entry.recordID);
      expect(new Set(recordIDs)).toEqual(new Set([liveA1RecordID(), nullScopeRecordID(), censusA2RecordID()]));
      expect(recordIDs).not.toContain(plotBRecordID());
    });

    it("summary for plot B, filtered to this suite's changedBy, counts plot B's own entry plus the same sitewide NULL-scope entry — never plot A's plot-specific entries", async () => {
      const response = await postExplorerQueryFull(plotB, { changedBy: READ_PATH_CHANGED_BY });

      expect(response.summary).toEqual({ total: 2, updates: 2, inserts: 0, deletes: 0 });
      const recordIDs = response.items
        .filter((item): item is { type: 'single'; entry: ChangelogEntry } => item.type === 'single')
        .map(item => item.entry.recordID);
      expect(new Set(recordIDs)).toEqual(new Set([plotBRecordID(), nullScopeRecordID()]));
    });

    it("facets for plot A list both this suite's live author and the historical entry's original (legacy) author, each with its EXACT count", async () => {
      // Exact counts (3: liveA1 + nullScope + censusA2; 1: historicalA1) catch
      // a duplicate-row regression that an at-least check would miss.
      const facets = await postExplorerFacets(plotA);

      const liveAuthorFacet = facets.users.find(u => u.value === READ_PATH_CHANGED_BY);
      const legacyAuthorFacet = facets.users.find(u => u.value === LEGACY_CHANGED_BY);
      expect(liveAuthorFacet, "this suite's own author must appear in the plot-A user facet").toBeDefined();
      expect(liveAuthorFacet!.count).toBe(3);
      expect(legacyAuthorFacet, "the backfilled historical row's original author must appear, attributed correctly").toBeDefined();
      expect(legacyAuthorFacet!.count).toBe(1);
    });

    it("facets for plot A list both coremeasurements (the live/historical row table) and bulk-revision-apply (the sitewide summary's table)", async () => {
      const facets = await postExplorerFacets(plotA);

      const tableNames = facets.tables.map(t => t.value);
      expect(tableNames).toContain('coremeasurements');
      expect(tableNames).toContain('bulk-revision-apply');
      expect(tableNames, 'species_correction_metadata is undo bookkeeping, never a real changelog table').not.toContain('species_correction_metadata');
    });

    it('facets for plot A increments operationCounts.UPDATE by exactly one new write, leaving INSERT/DELETE unchanged', async () => {
      // Baseline/delta, not an absolute count, isolates this from any other
      // row already scoped to plot A.
      const baseline = await postExplorerFacets(plotA);

      await writeLiveEdit({
        plotID: plotA,
        censusID: censusA1,
        targetID: OPERATION_FACET_DELTA_PRIMARY_KEY,
        beforeState: [
          { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: OPERATION_FACET_DELTA_PRIMARY_KEY, row: { MeasuredDBH: 50 } }
        ],
        afterState: [
          { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: OPERATION_FACET_DELTA_PRIMARY_KEY, row: { MeasuredDBH: 55.5 } }
        ]
      });

      const afterWrite = await postExplorerFacets(plotA);

      expect(afterWrite.operationCounts.UPDATE).toBe(baseline.operationCounts.UPDATE + 1);
      expect(afterWrite.operationCounts.INSERT).toBe(baseline.operationCounts.INSERT);
      expect(afterWrite.operationCounts.DELETE).toBe(baseline.operationCounts.DELETE);
    });

    it("facets for plot B do NOT list plot A's exclusively-scoped historical author, since that entry is excluded by plot scope", async () => {
      const facets = await postExplorerFacets(plotB);

      expect(facets.users.find(u => u.value === LEGACY_CHANGED_BY)).toBeUndefined();
    });
  });
});
