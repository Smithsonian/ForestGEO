import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryRecentChanges } from './_shared';
import { DEFAULT_RECENT_CHANGES_FILTERS } from '@/config/recentchangesexplorer';

interface MockRawRow {
  ChangeID: number;
  TableName: string;
  RecordID: string;
  Operation: 'INSERT' | 'UPDATE' | 'DELETE';
  OldRowState: Record<string, unknown> | null;
  NewRowState: Record<string, unknown> | null;
  ChangeTimestamp: string;
  ChangedBy: string;
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
