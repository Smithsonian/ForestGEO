import ConnectionManager from '@/config/connectionmanager';
import { format } from 'mysql2/promise';
import {
  ChangelogEntry,
  RecentChangesFilters,
  RecentChangesFacetsResponse,
  RecentChangesSummary,
  FacetOption,
  groupIntoBatches,
  FeedItem,
  RecentChangesQueryResponse
} from '@/config/recentchangesexplorer';

type ExplorerConnection = ReturnType<typeof ConnectionManager.getInstance>;

interface RawChangelogRow {
  ChangeID: number;
  TableName: string;
  RecordID: string;
  Operation: 'INSERT' | 'UPDATE' | 'DELETE';
  OldRowState: string | Record<string, unknown> | null;
  NewRowState: string | Record<string, unknown> | null;
  ChangeTimestamp: string | Date;
  ChangedBy: string;
}

function unwrapArray(obj: unknown): Record<string, unknown> | null {
  if (Array.isArray(obj)) {
    return obj.length === 1 && typeof obj[0] === 'object' && obj[0] !== null ? (obj[0] as Record<string, unknown>) : null;
  }
  return typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>) : null;
}

function parseJsonField(value: string | Record<string, unknown> | unknown[] | null): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return unwrapArray(value);
  try {
    return unwrapArray(JSON.parse(value));
  } catch {
    return null;
  }
}

function toChangelogEntry(row: RawChangelogRow): ChangelogEntry {
  return {
    changeID: row.ChangeID,
    tableName: row.TableName,
    recordID: row.RecordID,
    operation: row.Operation,
    oldRowState: parseJsonField(row.OldRowState),
    newRowState: parseJsonField(row.NewRowState),
    changeTimestamp: row.ChangeTimestamp instanceof Date ? row.ChangeTimestamp.toISOString() : row.ChangeTimestamp,
    changedBy: row.ChangedBy
  };
}

function buildWhereClause(filters: RecentChangesFilters): { clause: string; params: unknown[] } {
  const conditions: string[] = ['(uc.PlotID = ? OR uc.PlotID IS NULL)'];
  const params: unknown[] = [];

  if (filters.operation !== 'all') {
    conditions.push('uc.Operation = ?');
    params.push(filters.operation);
  }

  if (filters.changedBy) {
    conditions.push('uc.ChangedBy = ?');
    params.push(filters.changedBy);
  }

  if (filters.tableName) {
    conditions.push('uc.TableName = ?');
    params.push(filters.tableName);
  }

  if (filters.quickSearch) {
    const searchPattern = `%${filters.quickSearch}%`;
    conditions.push(
      '(uc.RecordID LIKE ? OR uc.TableName LIKE ? OR uc.ChangedBy LIKE ? OR CAST(uc.OldRowState AS CHAR) LIKE ? OR CAST(uc.NewRowState AS CHAR) LIKE ?)'
    );
    params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
  }

  return { clause: conditions.join(' AND '), params };
}

function buildChangelogQuery(schema: string): string {
  return `SELECT SQL_CALC_FOUND_ROWS uc.* FROM ${schema}.unifiedchangelog uc`;
}

function buildCountQuery(schema: string): string {
  return `SELECT COUNT(*) AS total FROM ${schema}.unifiedchangelog uc`;
}

function buildSummaryQuery(schema: string): string {
  return `SELECT uc.Operation, COUNT(*) AS cnt FROM ${schema}.unifiedchangelog uc`;
}

function buildFacetsUsersQuery(schema: string): string {
  return `SELECT uc.ChangedBy AS value, COUNT(*) AS cnt FROM ${schema}.unifiedchangelog uc`;
}

function buildFacetsTablesQuery(schema: string): string {
  return `SELECT uc.TableName AS value, COUNT(*) AS cnt FROM ${schema}.unifiedchangelog uc`;
}

export async function queryRecentChanges(
  connectionManager: ExplorerConnection,
  schema: string,
  plotID: number,
  page: number,
  pageSize: number,
  filters: RecentChangesFilters
): Promise<RecentChangesQueryResponse> {
  const { clause, params } = buildWhereClause(filters);
  const plotParams = [plotID];
  const allWhereParams = [...plotParams, ...params];

  const baseQuery = buildChangelogQuery(schema);
  const dataQuery = `${baseQuery} WHERE ${clause} ORDER BY uc.ChangeTimestamp DESC LIMIT ?, ?`;
  const offset = page * pageSize;
  const dataParams = [...allWhereParams, offset, pageSize + 1];

  const countQuery = `${buildCountQuery(schema)} WHERE ${clause}`;
  const summaryQuery = `${buildSummaryQuery(schema)} WHERE ${clause} GROUP BY uc.Operation`;

  const [rawRows, countResult, summaryResult] = await Promise.all([
    connectionManager.executeQuery(format(dataQuery, dataParams)) as Promise<RawChangelogRow[]>,
    connectionManager.executeQuery(format(countQuery, allWhereParams)) as Promise<Array<{ total: number }>>,
    connectionManager.executeQuery(format(summaryQuery, allWhereParams)) as Promise<Array<{ Operation: string; cnt: number }>>
  ]);

  const hasMore = rawRows.length > pageSize;
  const trimmedRows = hasMore ? rawRows.slice(0, pageSize) : rawRows;
  const entries = trimmedRows.map(toChangelogEntry);
  const items = groupIntoBatches(entries);

  const totalItems = countResult[0]?.total ?? 0;

  const summaryMap = new Map(summaryResult.map(row => [row.Operation, Number(row.cnt)]));
  const summary: RecentChangesSummary = {
    total: totalItems,
    updates: summaryMap.get('UPDATE') ?? 0,
    inserts: summaryMap.get('INSERT') ?? 0,
    deletes: summaryMap.get('DELETE') ?? 0
  };

  return { items, totalItems, summary, hasMore };
}

export async function queryRecentChangesFacets(connectionManager: ExplorerConnection, schema: string, plotID: number): Promise<RecentChangesFacetsResponse> {
  const plotCondition = '(uc.PlotID = ? OR uc.PlotID IS NULL)';
  const plotParams = [plotID];

  const usersQuery = `${buildFacetsUsersQuery(schema)} WHERE ${plotCondition} GROUP BY uc.ChangedBy ORDER BY cnt DESC`;
  const tablesQuery = `${buildFacetsTablesQuery(schema)} WHERE ${plotCondition} GROUP BY uc.TableName ORDER BY cnt DESC`;
  const operationQuery = `${buildSummaryQuery(schema)} WHERE ${plotCondition} GROUP BY uc.Operation`;

  const [usersResult, tablesResult, operationResult] = await Promise.all([
    connectionManager.executeQuery(format(usersQuery, plotParams)) as Promise<Array<{ value: string; cnt: number }>>,
    connectionManager.executeQuery(format(tablesQuery, plotParams)) as Promise<Array<{ value: string; cnt: number }>>,
    connectionManager.executeQuery(format(operationQuery, plotParams)) as Promise<Array<{ Operation: string; cnt: number }>>
  ]);

  const toFacetOptions = (rows: Array<{ value: string; cnt: number }>): FacetOption[] => rows.map(row => ({ value: row.value, count: Number(row.cnt) }));

  const operationMap = new Map(operationResult.map(row => [row.Operation, Number(row.cnt)]));

  return {
    users: toFacetOptions(usersResult),
    tables: toFacetOptions(tablesResult),
    operationCounts: {
      INSERT: operationMap.get('INSERT') ?? 0,
      UPDATE: operationMap.get('UPDATE') ?? 0,
      DELETE: operationMap.get('DELETE') ?? 0
    }
  };
}
