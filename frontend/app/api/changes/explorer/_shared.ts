import ailogger from '@/ailogger';
import ConnectionManager from '@/lib/db/connectionmanager';
import { format } from 'mysql2/promise';
import { decodeChangelogRow } from '@/config/changelogdecode';
import { buildChangeFilter, PLOT_SCOPE_CONDITION } from '@/lib/changes/changefilter';
import {
  ChangelogEntry,
  RecentChangesServerFilters,
  RecentChangesFacetsResponse,
  RecentChangesSummary,
  FacetOption,
  groupIntoBatches,
  FeedItem,
  RecentChangesQueryResponse
} from '@/config/recentchangesexplorer';

type ExplorerConnection = ReturnType<typeof ConnectionManager.getInstance>;

const CHANGELOG_ORDER_BY = 'ORDER BY uc.ChangeTimestamp DESC, uc.ChangeID DESC';
const MIN_RAW_FETCH_CHUNK_SIZE = 100;
const MAX_LOGGED_UNDECODABLE_CHANGE_IDS = 20;

interface RawChangelogRow {
  ChangeID: number;
  TableName: string;
  RecordID: string;
  Operation: 'INSERT' | 'UPDATE' | 'DELETE';
  OldRowState: unknown;
  NewRowState: unknown;
  ChangeTimestamp: string | Date;
  ChangedBy: string | null;
}

function toChangelogEntry(row: RawChangelogRow): { entry: ChangelogEntry; undecodable: boolean } {
  const { records, undecodable } = decodeChangelogRow({
    tableName: row.TableName,
    recordID: row.RecordID,
    oldRowState: row.OldRowState,
    newRowState: row.NewRowState
  });
  const soleRecord = records.length === 1 ? records[0] : null;
  const entry: ChangelogEntry = {
    changeID: row.ChangeID,
    tableName: row.TableName,
    recordID: row.RecordID,
    operation: row.Operation,
    oldRowState: soleRecord?.oldState ?? null,
    newRowState: soleRecord?.newState ?? null,
    records,
    changeTimestamp: row.ChangeTimestamp instanceof Date ? row.ChangeTimestamp.toISOString() : row.ChangeTimestamp,
    changedBy: row.ChangedBy
  };
  return { entry, undecodable };
}

function warnAboutUndecodableRows(schema: string, undecodableChangeIDs: number[]): void {
  if (undecodableChangeIDs.length === 0) return;
  ailogger.warn(`Recent changes: ${undecodableChangeIDs.length} change-log row(s) hold a row state that could not be decoded`, {
    schema,
    undecodableCount: undecodableChangeIDs.length,
    changeIDs: undecodableChangeIDs.slice(0, MAX_LOGGED_UNDECODABLE_CHANGE_IDS)
  });
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

function buildDataQuery(schema: string, clause: string): string {
  return `${buildChangelogQuery(schema)} WHERE ${clause} ${CHANGELOG_ORDER_BY} LIMIT ?, ?`;
}

async function queryRecentChangesPage(
  connectionManager: ExplorerConnection,
  schema: string,
  page: number,
  pageSize: number,
  clause: string,
  whereParams: unknown[]
): Promise<{ items: FeedItem[]; hasMore: boolean }> {
  const startItemIndex = page * pageSize;
  const endItemIndexExclusive = startItemIndex + pageSize;
  const chunkSize = Math.max(MIN_RAW_FETCH_CHUNK_SIZE, pageSize * 4);
  const entries: ChangelogEntry[] = [];
  const undecodableChangeIDs: number[] = [];
  let groupedItems: FeedItem[] = [];
  let offset = 0;

  while (true) {
    const dataQuery = buildDataQuery(schema, clause);
    const rawRows = (await connectionManager.executeQuery(format(dataQuery, [...whereParams, offset, chunkSize]))) as RawChangelogRow[];

    if (rawRows.length === 0) {
      break;
    }

    for (const row of rawRows) {
      const { entry, undecodable } = toChangelogEntry(row);
      entries.push(entry);
      if (undecodable) undecodableChangeIDs.push(row.ChangeID);
    }
    groupedItems = groupIntoBatches(entries);

    const reachedEndOfRows = rawRows.length < chunkSize;
    if (reachedEndOfRows || groupedItems.length > endItemIndexExclusive) {
      break;
    }

    offset += rawRows.length;
  }

  warnAboutUndecodableRows(schema, undecodableChangeIDs);

  return {
    items: groupedItems.slice(startItemIndex, endItemIndexExclusive),
    hasMore: groupedItems.length > endItemIndexExclusive
  };
}

export async function queryRecentChanges(
  connectionManager: ExplorerConnection,
  schema: string,
  plotID: number,
  page: number,
  pageSize: number,
  filters: RecentChangesServerFilters
): Promise<RecentChangesQueryResponse> {
  const { sql: clause, params: allWhereParams } = buildChangeFilter(plotID, filters);

  const countQuery = `${buildCountQuery(schema)} WHERE ${clause}`;
  const summaryQuery = `${buildSummaryQuery(schema)} WHERE ${clause} GROUP BY uc.Operation`;
  const countPromise = connectionManager.executeQuery(format(countQuery, allWhereParams)) as Promise<Array<{ total: number }>>;
  const summaryPromise = connectionManager.executeQuery(format(summaryQuery, allWhereParams)) as Promise<Array<{ Operation: string; cnt: number }>>;

  const [{ items, hasMore }, countResult, summaryResult] = await Promise.all([
    queryRecentChangesPage(connectionManager, schema, page, pageSize, clause, allWhereParams),
    countPromise,
    summaryPromise
  ]);

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
  const plotCondition = PLOT_SCOPE_CONDITION;
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
