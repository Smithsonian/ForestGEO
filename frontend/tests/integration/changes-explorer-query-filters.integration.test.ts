/**
 * POST /api/changes/explorer/query (#592): the shared request contract and filter builder against
 * real local MySQL. Changes are written through the production recordMutation; a hand-written row
 * is used only for the legacy array shape and the NULL ChangedBy that no current grid writer stores.
 *
 * Prerequisites: docker compose up -d mysql
 * Run: ~/dev/ForestGEO/docs/relay-integration.sh <checkout> -- tests/integration/changes-explorer-query-filters.integration.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestDatabaseConfig } from '../setup/local-db-setup';
import { HTTPResponses } from '@/config/macros';
import { DEFAULT_RECENT_CHANGES_FILTERS, type FeedItem, type RecentChangesFilters, type RecentChangesQueryResponse } from '@/config/recentchangesexplorer';
import { ChangelogOperation, recordMutation } from '@/lib/changelog/record-mutation';
import { INVALID_RECENT_CHANGES_REQUEST_RESPONSE } from '@/lib/changes/explorerrequest';

const AUTH_USER_EMAIL = 'changes-filter-runner@forestgeo.test';
const CHANGED_BY = 'changes-filter-seed@forestgeo.test';
const SEED_TRANSACTION_ID = 'changes-filter-seed';
const ROUTE_CONTEXT = { params: Promise.resolve({}) };
const PAGE_SIZE = 25;
const NON_JSON_BODY_GUARD_RESPONSE = { error: 'missing or invalid schema', code: 'INVALID_SCHEMA' };
/** Seven digits: no seeded tree id, tag or user text can contain a ChangeID drawn from here, so a hit on the digits is a ChangeID hit. */
const FIRST_UNAMBIGUOUS_CHANGE_ID = 7_340_001;

const TIME_BEFORE_WINDOW = '2026-03-09 23:59:59';
const TIME_WINDOW_START = '2026-03-10 00:00:00';
const TIME_WINDOW_END = '2026-03-11 23:59:59';
const TIME_AFTER_WINDOW = '2026-03-12 00:00:00';
const WINDOW_FROM = '2026-03-10';
const WINDOW_TO = '2026-03-11';

const sharedState = vi.hoisted(() => ({ connection: null as Connection | null, executeQueryCalls: 0 }));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: AUTH_USER_EMAIL, userStatus: 'global', sites: [] } }))
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[]) => {
      sharedState.executeQueryCalls += 1;
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      const [rows] = await sharedState.connection.query(query, params);
      return rows;
    },
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({ default: { info: () => undefined, warn: () => undefined, error: () => undefined } }));

type SingleItem = Extract<FeedItem, { type: 'single' }>;

describe('POST /api/changes/explorer/query: request contract and filters', () => {
  let connection: Connection;
  let config: TestDatabaseConfig;
  let schema: string;
  let plotID: number;

  const seedTx = {
    id: SEED_TRANSACTION_ID,
    query: async <T>(sql: string, params?: unknown[]): Promise<T> => {
      const [result] = await connection.query(sql, params);
      return result as T;
    }
  };

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    config = setup.config;
    schema = config.database;
    plotID = setup.testData.plots[0].plotID;
    sharedState.connection = connection;
  }, 90_000);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await connection.query('DELETE FROM unifiedchangelog');
    sharedState.executeQueryCalls = 0;
  });

  async function postQuery(body: Record<string, unknown>): Promise<Response> {
    const { POST } = await import('@/app/api/changes/explorer/query/route');
    const request = new NextRequest('http://localhost/api/changes/explorer/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return POST(request, ROUTE_CONTEXT);
  }

  async function queryFeed(filters: Partial<RecentChangesFilters> = {}): Promise<RecentChangesQueryResponse> {
    const response = await postQuery({ schema, plotID, page: 0, pageSize: PAGE_SIZE, filters: { ...DEFAULT_RECENT_CHANGES_FILTERS, ...filters } });
    const body = await response.json();
    expect(response.status, `query must succeed; body: ${JSON.stringify(body)}`).toBe(HTTPResponses.OK);
    return body;
  }

  function feedChangeIDs(feed: RecentChangesQueryResponse): number[] {
    return feed.items.flatMap(item => (item.type === 'single' ? [item.entry.changeID] : item.entries.map(entry => entry.changeID)));
  }

  /** One real grid UPDATE per call; UPDATEs are never batched, so each is its own feed item. */
  async function recordTreeUpdateAt(treeID: number, changeTime: string): Promise<number> {
    await recordMutation({
      tx: seedTx,
      schema,
      tableName: 'trees',
      recordID: treeID,
      operation: ChangelogOperation.UPDATE,
      oldRowState: { TreeID: treeID, TreeTag: `OLD-${treeID}` },
      newRowState: { TreeID: treeID, TreeTag: `NEW-${treeID}` },
      changedBy: CHANGED_BY,
      plotID
    });
    const [rows] = await connection.query<RowDataPacket[]>('SELECT ChangeID FROM unifiedchangelog WHERE TableName = ? AND RecordID = ?', [
      'trees',
      String(treeID)
    ]);
    expect(rows, `exactly one changelog row for trees ${treeID}`).toHaveLength(1);
    const changeID = Number(rows[0].ChangeID);
    await connection.query('UPDATE unifiedchangelog SET ChangeTimestamp = ? WHERE ChangeID = ?', [changeTime, changeID]);
    return changeID;
  }

  async function seedBoundaryChanges() {
    return {
      beforeWindow: await recordTreeUpdateAt(101, TIME_BEFORE_WINDOW),
      windowStart: await recordTreeUpdateAt(102, TIME_WINDOW_START),
      windowEnd: await recordTreeUpdateAt(103, TIME_WINDOW_END),
      afterWindow: await recordTreeUpdateAt(104, TIME_AFTER_WINDOW)
    };
  }

  it.each([
    { label: 'an object where a filter string belongs', filters: { changedBy: { $ne: '' } } },
    { label: 'an array where a filter string belongs', filters: { quickSearch: ['a', 'b'] } },
    { label: 'an unknown operation', filters: { operation: 'TRUNCATE' } },
    { label: 'an impossible date', filters: { changedFrom: '2026-02-30' } },
    { label: 'a date in year 0000, which MySQL cannot add a day to', filters: { changedTo: '0000-06-15' } },
    { label: 'From after To', filters: { changedFrom: WINDOW_TO, changedTo: WINDOW_FROM } }
  ])('rejects $label with a coded 400 and runs no SQL', async ({ filters }) => {
    const response = await postQuery({ schema, plotID, filters });

    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(await response.json(), 'a coded rejection, not a 500 carrying a driver message').toEqual(INVALID_RECENT_CHANGES_REQUEST_RESPONSE);
    expect(sharedState.executeQueryCalls).toBe(0);
  });

  it('rejects a missing plotID with the same coded 400', async () => {
    const response = await postQuery({ schema });
    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(await response.json()).toEqual(INVALID_RECENT_CHANGES_REQUEST_RESPONSE);
  });

  it.each([
    { label: 'From only', filters: { changedFrom: WINDOW_FROM }, expected: ['afterWindow', 'windowEnd', 'windowStart'] as const },
    { label: 'To only', filters: { changedTo: WINDOW_TO }, expected: ['windowEnd', 'windowStart', 'beforeWindow'] as const },
    { label: 'From and To', filters: { changedFrom: WINDOW_FROM, changedTo: WINDOW_TO }, expected: ['windowEnd', 'windowStart'] as const },
    { label: 'one day', filters: { changedFrom: WINDOW_TO, changedTo: WINDOW_TO }, expected: ['windowEnd'] as const }
  ])('$label narrows the feed and its summary at the boundary seconds', async ({ filters, expected }) => {
    const seeded = await seedBoundaryChanges();

    const feed = await queryFeed(filters);

    expect(feedChangeIDs(feed), `newest first for ${JSON.stringify(filters)}; seeded: ${JSON.stringify(seeded)}`).toEqual(expected.map(name => seeded[name]));
    expect(feed.summary, 'the summary cards share the filter').toEqual({ total: expected.length, updates: expected.length, inserts: 0, deletes: 0 });
    expect(feed.totalItems).toBe(expected.length);
    expect(feed.hasMore).toBe(false);
  });

  it('finds one change by its ChangeID, with or without the # sign (D7)', async () => {
    await connection.query(`ALTER TABLE unifiedchangelog AUTO_INCREMENT = ${FIRST_UNAMBIGUOUS_CHANGE_ID}`);
    const seeded = await seedBoundaryChanges();
    expect(seeded.windowStart, 'the seed ids start where the test placed them').toBeGreaterThanOrEqual(FIRST_UNAMBIGUOUS_CHANGE_ID);

    const hashed = await queryFeed({ quickSearch: `#${seeded.windowStart}` });
    expect(feedChangeIDs(hashed), 'no stored text holds a # sign, so a # term can only match the ChangeID').toEqual([seeded.windowStart]);

    const plainDigits = await queryFeed({ quickSearch: String(seeded.windowStart) });
    expect(feedChangeIDs(plainDigits), `only the ChangeID can contain these digits; seeded: ${JSON.stringify(seeded)}`).toEqual([seeded.windowStart]);
  });

  it('answers a body that is not JSON with the guard’s 400 and runs no SQL', async () => {
    const { POST } = await import('@/app/api/changes/explorer/query/route');
    const request = new NextRequest('http://localhost/api/changes/explorer/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"schema": '
    });

    const response = await POST(request, ROUTE_CONTEXT);

    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(sharedState.executeQueryCalls).toBe(0);
    expect(await response.json(), 'the route guard cannot read a schema from an unparsable body, so it answers before the handler').toEqual(
      NON_JSON_BODY_GUARD_RESPONSE
    );
  });

  it('returns paired records for a legacy multi-row change without changing the feed counts', async () => {
    const neighbour = await recordTreeUpdateAt(201, TIME_WINDOW_START);
    const [legacy] = await connection.query<ResultSetHeader>(
      `INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy, PlotID)
       VALUES ('trees', '1|2', 'UPDATE', ?, ?, ?, NULL, ?)`,
      [
        JSON.stringify([
          { TreeID: 1, SpeciesID: 10 },
          { TreeID: 2, SpeciesID: 10 }
        ]),
        JSON.stringify([
          { TreeID: 2, SpeciesID: 30 },
          { TreeID: 1, SpeciesID: 20 }
        ]),
        TIME_WINDOW_END,
        plotID
      ]
    );

    const feed = await queryFeed();

    expect(feedChangeIDs(feed), 'one feed item per audit row, newest first').toEqual([legacy.insertId, neighbour]);
    expect([feed.totalItems, feed.hasMore, feed.summary.updates]).toEqual([2, false, 2]);

    const [legacyItem, neighbourItem] = feed.items as SingleItem[];
    expect(legacyItem.entry.records, 'paired by TreeID read from the images, not by position').toEqual([
      { primaryKey: '1', oldState: { TreeID: 1, SpeciesID: 10 }, newState: { TreeID: 1, SpeciesID: 20 } },
      { primaryKey: '2', oldState: { TreeID: 2, SpeciesID: 10 }, newState: { TreeID: 2, SpeciesID: 30 } }
    ]);
    expect(legacyItem.entry.changedBy, 'a NULL ChangedBy stays null on the wire').toBeNull();
    expect(neighbourItem.entry.records).toEqual([
      { primaryKey: '201', oldState: { TreeID: 201, TreeTag: 'OLD-201' }, newState: { TreeID: 201, TreeTag: 'NEW-201' } }
    ]);
    expect(neighbourItem.entry.oldRowState, 'a single-record entry keeps its entry-level states').toEqual({ TreeID: 201, TreeTag: 'OLD-201' });
  });
});
