import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildChangeFilter as sharedBuildChangeFilter, queryRecentChanges } from './_shared';
import { buildChangeFilter } from '@/lib/changes/changefilter';
import { DEFAULT_RECENT_CHANGES_FILTERS, type FeedItem } from '@/config/recentchangesexplorer';

const PLOT_ID = 1;

interface MockRawRow {
  ChangeID: number;
  TableName: string;
  RecordID: string;
  Operation: 'INSERT' | 'UPDATE' | 'DELETE';
  OldRowState: unknown;
  NewRowState: unknown;
  ChangeTimestamp: string;
  ChangedBy: string | null;
}

function makeRawRow(overrides: Partial<MockRawRow> = {}): MockRawRow {
  return {
    ChangeID: 1,
    TableName: 'coremeasurements',
    RecordID: '1',
    Operation: 'INSERT',
    OldRowState: null,
    NewRowState: { TreeTag: 'TREE-1', StemTag: '1' },
    ChangeTimestamp: '2026-04-10T12:00:00.000Z',
    ChangedBy: 'mason@si.edu',
    ...overrides
  };
}

function buildConnection(rows: MockRawRow[]) {
  return {
    executeQuery: vi.fn(async (query: string) => {
      if (query.includes('COUNT(*) AS total')) {
        return [{ total: rows.length }];
      }

      if (query.includes('GROUP BY uc.Operation')) {
        return [
          { Operation: 'INSERT', cnt: rows.filter(row => row.Operation === 'INSERT').length },
          { Operation: 'UPDATE', cnt: rows.filter(row => row.Operation === 'UPDATE').length },
          { Operation: 'DELETE', cnt: rows.filter(row => row.Operation === 'DELETE').length }
        ].filter(row => row.cnt > 0);
      }

      const limitMatch = query.match(/LIMIT\s+(\d+),\s*(\d+)/i);
      if (!limitMatch) {
        throw new Error(`Missing LIMIT clause in query: ${query}`);
      }

      const offset = Number(limitMatch[1]);
      const limit = Number(limitMatch[2]);
      return rows.slice(offset, offset + limit);
    })
  };
}

describe('queryRecentChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('orders data queries by timestamp then ChangeID descending', async () => {
    const connection = buildConnection([]);

    await queryRecentChanges(connection as any, 'forestgeo_testing', 1, 0, 25, DEFAULT_RECENT_CHANGES_FILTERS);

    const dataQuery = connection.executeQuery.mock.calls
      .map(([query]: [string]) => String(query))
      .find(query => query.includes('SELECT SQL_CALC_FOUND_ROWS uc.*'));

    expect(dataQuery).toContain('ORDER BY uc.ChangeTimestamp DESC, uc.ChangeID DESC');
  });

  it('keeps a large upload batch intact across feed pages', async () => {
    const uploadBatch = Array.from({ length: 120 }, (_, index) =>
      makeRawRow({
        ChangeID: 500 - index,
        RecordID: String(500 - index),
        Operation: 'INSERT',
        ChangeTimestamp: '2026-04-10T12:00:00.000Z',
        NewRowState: { TreeTag: `TREE-${index + 1}`, StemTag: '1' }
      })
    );

    const rows = [
      ...uploadBatch,
      makeRawRow({
        ChangeID: 200,
        Operation: 'UPDATE',
        RecordID: '200',
        ChangeTimestamp: '2026-04-10T11:59:00.000Z',
        OldRowState: { MeasuredDBH: 10 },
        NewRowState: { MeasuredDBH: 12 }
      })
    ];

    const connection = buildConnection(rows);
    const firstPage = await queryRecentChanges(connection as any, 'forestgeo_testing', 1, 0, 1, DEFAULT_RECENT_CHANGES_FILTERS);

    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]).toMatchObject({
      type: 'batch',
      tableName: 'coremeasurements',
      changedBy: 'mason@si.edu',
      count: 120
    });
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.summary.total).toBe(121);

    const dataCalls = connection.executeQuery.mock.calls
      .map(([query]: [string]) => String(query))
      .filter(query => query.includes('SELECT SQL_CALC_FOUND_ROWS uc.*'));
    expect(dataCalls).toHaveLength(2);

    connection.executeQuery.mockClear();

    const secondPage = await queryRecentChanges(connection as any, 'forestgeo_testing', 1, 1, 1, DEFAULT_RECENT_CHANGES_FILTERS);

    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]).toMatchObject({
      type: 'single',
      entry: {
        changeID: 200,
        operation: 'UPDATE',
        recordID: '200'
      }
    });
    expect(secondPage.hasMore).toBe(false);
  });
});

describe('queryRecentChanges: whole-row decoding', () => {
  it('returns paired records for a legacy multi-row change and leaves the feed shape unchanged', async () => {
    const legacyRow = makeRawRow({
      ChangeID: 300,
      TableName: 'trees',
      RecordID: '1|2',
      Operation: 'UPDATE',
      OldRowState: [
        { TreeID: 1, SpeciesID: 10 },
        { TreeID: 2, SpeciesID: 10 }
      ],
      NewRowState: [
        { TreeID: 2, SpeciesID: 30 },
        { TreeID: 1, SpeciesID: 20 }
      ]
    });
    const objectRow = makeRawRow({ ChangeID: 299, RecordID: '77', Operation: 'UPDATE', OldRowState: { MeasuredDBH: 10 }, NewRowState: { MeasuredDBH: 12 } });
    const connection = buildConnection([legacyRow, objectRow]);

    const response = await queryRecentChanges(connection as any, 'forestgeo_testing', PLOT_ID, 0, 25, DEFAULT_RECENT_CHANGES_FILTERS);

    expect(
      response.items.map(item => item.type),
      'one feed item per audit row, as before'
    ).toEqual(['single', 'single']);
    expect(response.totalItems).toBe(2);
    expect(response.hasMore).toBe(false);

    const [legacyItem, objectItem] = response.items as Array<Extract<FeedItem, { type: 'single' }>>;
    expect(legacyItem.entry.records, 'paired by TreeID, not by position').toEqual([
      { primaryKey: '1', oldState: { TreeID: 1, SpeciesID: 10 }, newState: { TreeID: 1, SpeciesID: 20 } },
      { primaryKey: '2', oldState: { TreeID: 2, SpeciesID: 10 }, newState: { TreeID: 2, SpeciesID: 30 } }
    ]);
    expect([legacyItem.entry.oldRowState, legacyItem.entry.newRowState], 'entry-level states are for single-record changes only').toEqual([null, null]);

    expect(objectItem.entry.records).toEqual([{ primaryKey: '77', oldState: { MeasuredDBH: 10 }, newState: { MeasuredDBH: 12 } }]);
    expect(objectItem.entry.oldRowState).toEqual({ MeasuredDBH: 10 });
    expect(objectItem.entry.newRowState).toEqual({ MeasuredDBH: 12 });
  });

  it('passes a NULL ChangedBy through as null instead of a string', async () => {
    const connection = buildConnection([makeRawRow({ ChangedBy: null })]);
    const response = await queryRecentChanges(connection as any, 'forestgeo_testing', PLOT_ID, 0, 25, DEFAULT_RECENT_CHANGES_FILTERS);
    const [item] = response.items as Array<Extract<FeedItem, { type: 'single' }>>;
    expect(item.entry.changedBy).toBeNull();
  });
});

describe('queryRecentChanges: one filter for every list query', () => {
  it('re-exports the shared builder, so the route module and the export use the same function', () => {
    expect(sharedBuildChangeFilter).toBe(buildChangeFilter);
  });

  it('applies the date bounds and the ChangeID search to the rows, the count and the summary alike', async () => {
    const connection = buildConnection([]);
    const filters = { ...DEFAULT_RECENT_CHANGES_FILTERS, quickSearch: '#4821', changedFrom: '2026-11-01', changedTo: '2026-11-05' };

    await queryRecentChanges(connection as any, 'forestgeo_testing', PLOT_ID, 0, 25, filters);

    const queries = connection.executeQuery.mock.calls.map(([query]: [string]) => String(query));
    const listQueries = {
      rows: queries.find(query => query.includes('SELECT SQL_CALC_FOUND_ROWS uc.*')),
      count: queries.find(query => query.includes('COUNT(*) AS total')),
      summary: queries.find(query => query.includes('GROUP BY uc.Operation'))
    };
    for (const [name, query] of Object.entries(listQueries)) {
      expect(query, `the ${name} query must exist`).toBeDefined();
      expect(query, `the ${name} query carries the lower bound`).toContain("uc.ChangeTimestamp >= '2026-11-01'");
      expect(query, `the ${name} query carries the upper bound`).toContain("uc.ChangeTimestamp < DATE_ADD('2026-11-05', INTERVAL 1 DAY)");
      expect(query, `the ${name} query matches the ChangeID`).toContain('uc.ChangeID = 4821');
      expect(query, `the ${name} query keeps the plot scope first`).toContain('WHERE (uc.PlotID = 1 OR uc.PlotID IS NULL)');
    }
  });
});
