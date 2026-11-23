import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import ailogger from '@/ailogger';
import { getConn } from '@/lib/db/primitives';
import { buildInPlaceholders, safeFormatQuery } from '@/lib/db/sqlsecurity';
import { buildChangeFilter, type ChangeFilter } from '@/lib/changes/changefilter';
import { COREMEASUREMENTS_TABLE_NAME } from '@/lib/changelog/ingestion-audit';
import { EDIT_OPERATION_RECORD_ID_MARKER } from '@/lib/changelog/edit-operation-projection';
import { BULK_CRUD_FILE_ID } from '@/lib/uploads/file-names';
import { SUB_BATCH_SUFFIX_SQL_PATTERN } from '@/lib/uploads/batch-family';
import { MAX_EXPORT_ROWS, type RecentChangesServerFilters } from '@/config/recentchangesexplorer';
import {
  buildUploadRollupDraft,
  collectForeignKeyReferences,
  compareExportDrafts,
  expandChange,
  FOREIGN_KEY_COLUMNS,
  FOREIGN_KEY_LABELS,
  toExportCells,
  type ChangeExportDraft,
  type ChangeOperationName,
  type ExportCell,
  type ExportSourceChange,
  type ForeignKeyLabelMap,
  type ForeignKeyReferences,
  type UploadRollupGroup
} from '@/config/changelogexport';

export const EXPORT_PAGE_SIZE = 1000;
export const FOREIGN_KEY_LABEL_CHUNK_SIZE = 500;

/** Applies to the next transaction only. READ ONLY is deliberately not set here: see SNAPSHOT_BEGIN_STATEMENT. */
export const SNAPSHOT_ISOLATION_STATEMENT = 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ';
/** READ ONLY is set by the statement that opens the transaction, so a failed begin cannot leave it pending on a pooled connection. */
export const SNAPSHOT_BEGIN_STATEMENT = 'START TRANSACTION READ ONLY';
const CHANGE_TIME_SQL_FORMAT = '%Y-%m-%d %H:%i:%s';
const UPLOAD_FILE_ID_JSON_PATH = '$.UploadFileID';
const UPLOAD_BATCH_ID_JSON_PATH = '$.UploadBatchID';
const GRID_ROW_ONLY_JSON_PATHS = ['$.UserDefinedFields', '$.DeletedAt'] as const;
const ROLLBACK_FAILED_MESSAGE = 'Change export rollback failed';

/** The state an operation carries: the removed row for a DELETE, the written row otherwise. */
const CARRIED_STATE_SQL = `IF(uc.Operation = 'DELETE', uc.OldRowState, uc.NewRowState)`;

/**
 * A snapshot string field, or NULL when it is missing, JSON null or empty. The JSON type is tested
 * before unquoting: JSON null and the JSON string "null" both unquote to the text 'null'.
 */
function normalizedSnapshotTextSQL(jsonPath: string): string {
  return `IF(JSON_TYPE(JSON_EXTRACT(${CARRIED_STATE_SQL}, '${jsonPath}')) = 'STRING', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(${CARRIED_STATE_SQL}, '${jsonPath}')), ''), NULL)`;
}

const UPLOAD_FILE_ID_SQL = normalizedSnapshotTextSQL(UPLOAD_FILE_ID_JSON_PATH);
const UPLOAD_BATCH_ID_SQL = normalizedSnapshotTextSQL(UPLOAD_BATCH_ID_JSON_PATH);

export interface SqlFragment {
  sql: string;
  params: unknown[];
}

/**
 * Classifies a unifiedchangelog row `uc` as written by the upload pipeline (spec §6.3, D5): the
 * ingestion snapshot shape, with a plot, outside an edit operation and outside manual entry.
 * Callers must append `IS TRUE` or `IS NOT TRUE`; a bare NOT is no complement, because the
 * predicate is NULL when the carried state is SQL NULL.
 */
export function buildUploadPipelineRowPredicate(): SqlFragment {
  const gridRowOnlyPaths = GRID_ROW_ONLY_JSON_PATHS.map(path => `'${path}'`).join(', ');
  return {
    sql: `(uc.TableName = ?
      AND uc.RecordID NOT LIKE ?
      AND uc.PlotID IS NOT NULL
      AND JSON_TYPE(${CARRIED_STATE_SQL}) = 'OBJECT'
      AND JSON_CONTAINS_PATH(${CARRIED_STATE_SQL}, 'one', '${UPLOAD_BATCH_ID_JSON_PATH}')
      AND NOT JSON_CONTAINS_PATH(${CARRIED_STATE_SQL}, 'one', ${gridRowOnlyPaths})
      AND (${UPLOAD_FILE_ID_SQL} IS NULL OR ${UPLOAD_FILE_ID_SQL} <> ?))`,
    params: [COREMEASUREMENTS_TABLE_NAME, `%${EDIT_OPERATION_RECORD_ID_MARKER}%`, BULK_CRUD_FILE_ID]
  };
}

/** The upload's base batch by the rule of familyRootOf: only a terminal sub-batch suffix is removed. */
export function buildBaseBatchExpression(): SqlFragment {
  return { sql: `REGEXP_REPLACE(${UPLOAD_BATCH_ID_SQL}, ?, '')`, params: [SUB_BATCH_SUFFIX_SQL_PATTERN] };
}

export type ChangeExportReadStage = 'acquire' | 'begin' | 'detail' | 'rollup' | 'labels';

/** Carries the stage and the driver's error code only; the driver's message can quote row data. */
export class ChangeExportReadError extends Error {
  readonly stage: ChangeExportReadStage;
  readonly driverCode: string | undefined;

  constructor(stage: ChangeExportReadStage, driverCode?: string) {
    super(`Change export read failed at stage ${stage}`);
    this.name = 'ChangeExportReadError';
    this.stage = stage;
    this.driverCode = driverCode;
  }
}

export class ExportTooLargeError extends Error {
  readonly maxRows: number;

  constructor(maxRows: number) {
    super(`Change export passed its ceiling of ${maxRows} rows`);
    this.name = 'ExportTooLargeError';
    this.maxRows = maxRows;
  }
}

export interface ChangeExportLimits {
  /** Data rows allowed in one CSV; the first row past it fails the export. */
  maxRows: number;
  /** Source changes read per detail page. */
  pageSize: number;
}

export const DEFAULT_CHANGE_EXPORT_LIMITS: ChangeExportLimits = { maxRows: MAX_EXPORT_ROWS, pageSize: EXPORT_PAGE_SIZE };

export interface ChangeExportReadScope {
  schema: string;
  plotID: number;
  filters: RecentChangesServerFilters;
}

export interface ChangeExportSnapshot {
  /** Data rows in EXPORT_COLUMNS order, sorted oldest first. */
  rows: ExportCell[][];
  /** Source changes the detail pages read, suppressed ones included. */
  detailChangeCount: number;
  /** Source changes folded into upload rollup rows: the sum of their member counts. */
  rollupMemberCount: number;
  /** Detail changes that produced no row (paired updates with no visible difference). */
  suppressedChangeCount: number;
}

export interface ChangeExportQueryable {
  query<T extends RowDataPacket[]>(sql: string, values: unknown[]): Promise<[T, unknown]>;
}

interface DetailRow extends RowDataPacket {
  ChangeID: number;
  TableName: string;
  RecordID: string;
  Operation: ChangeOperationName;
  OldRowState: unknown;
  NewRowState: unknown;
  ChangeTime: string | null;
  ChangedBy: string | null;
  PlotID: number | null;
  CensusID: number | null;
}

interface RollupRow extends RowDataPacket {
  FileID: string | null;
  BaseBatchID: string | null;
  Operation: ChangeOperationName;
  ChangedBy: string | null;
  CensusID: number | null;
  LogID: number;
  MemberCount: number;
  ChangeTime: string | null;
}

interface LabelRow extends RowDataPacket {
  id: number;
  label: string | null;
}

interface DetailCursor {
  changeTime: string | null;
  changeID: number;
}

function driverCodeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

async function runStage<T>(stage: ChangeExportReadStage, pendingRead: Promise<T>): Promise<T> {
  try {
    return await pendingRead;
  } catch (error: unknown) {
    throw new ChangeExportReadError(stage, driverCodeOf(error));
  }
}

function nullableNumber(value: number | null): number | null {
  return value === null ? null : Number(value);
}

/** Rows strictly after the cursor in (ChangeTimestamp, ChangeID) order; NULL timestamps sort first. */
function cursorCondition(cursor: DetailCursor | null): SqlFragment {
  if (cursor === null) return { sql: '', params: [] };
  if (cursor.changeTime === null) return { sql: ' AND (uc.ChangeTimestamp IS NOT NULL OR uc.ChangeID > ?)', params: [cursor.changeID] };
  return {
    sql: ' AND uc.ChangeTimestamp >= ? AND (uc.ChangeTimestamp > ? OR uc.ChangeID > ?)',
    params: [cursor.changeTime, cursor.changeTime, cursor.changeID]
  };
}

async function readDetailPage(
  conn: ChangeExportQueryable,
  schema: string,
  filter: ChangeFilter,
  cursor: DetailCursor | null,
  pageSize: number
): Promise<ExportSourceChange[]> {
  const predicate = buildUploadPipelineRowPredicate();
  const after = cursorCondition(cursor);
  const sql = safeFormatQuery(
    schema,
    `SELECT uc.ChangeID, uc.TableName, uc.RecordID, uc.Operation, uc.OldRowState, uc.NewRowState,
            DATE_FORMAT(uc.ChangeTimestamp, '${CHANGE_TIME_SQL_FORMAT}') AS ChangeTime,
            uc.ChangedBy, uc.PlotID, uc.CensusID
     FROM ??.unifiedchangelog uc
     WHERE ${filter.sql} AND ${predicate.sql} IS NOT TRUE${after.sql}
     ORDER BY uc.ChangeTimestamp, uc.ChangeID
     LIMIT ?`
  );
  const [rows] = await conn.query<DetailRow[]>(sql, [...filter.params, ...predicate.params, ...after.params, pageSize]);
  return rows.map(row => ({
    changeID: Number(row.ChangeID),
    tableName: row.TableName,
    recordID: row.RecordID,
    operation: row.Operation,
    oldRowState: row.OldRowState,
    newRowState: row.NewRowState,
    changeTime: row.ChangeTime,
    changedBy: row.ChangedBy,
    plotID: nullableNumber(row.PlotID),
    censusID: nullableNumber(row.CensusID)
  }));
}

/** One row per (file, base batch, operation, user, census); LogID and time both come from the group's lowest ChangeID. */
async function readUploadRollup(
  conn: ChangeExportQueryable,
  scope: ChangeExportReadScope,
  filter: ChangeFilter,
  groupLimit: number
): Promise<UploadRollupGroup[]> {
  const predicate = buildUploadPipelineRowPredicate();
  const baseBatch = buildBaseBatchExpression();
  const sql = safeFormatQuery(
    scope.schema,
    `SELECT g.FileID, g.BaseBatchID, g.Operation, g.ChangedBy, g.CensusID, g.LogID, g.MemberCount,
            DATE_FORMAT(m.ChangeTimestamp, '${CHANGE_TIME_SQL_FORMAT}') AS ChangeTime
     FROM (
       SELECT ${UPLOAD_FILE_ID_SQL} AS FileID, ${baseBatch.sql} AS BaseBatchID, uc.Operation, uc.ChangedBy, uc.CensusID,
              MIN(uc.ChangeID) AS LogID, COUNT(*) AS MemberCount
       FROM ??.unifiedchangelog uc
       WHERE ${filter.sql} AND uc.TableName = ? AND ${predicate.sql} IS TRUE
       GROUP BY FileID, BaseBatchID, uc.Operation, uc.ChangedBy, uc.CensusID
     ) g
     JOIN ??.unifiedchangelog m ON m.ChangeID = g.LogID AND m.TableName = ?
     ORDER BY g.LogID
     LIMIT ?`
  );
  // The plain TableName term repeats the predicate's own first test on purpose: unifiedchangelog is partitioned by
  // TableName, and the optimizer prunes partitions only for a term it can see outside `(...) IS TRUE`.
  const params = [...baseBatch.params, ...filter.params, COREMEASUREMENTS_TABLE_NAME, ...predicate.params, COREMEASUREMENTS_TABLE_NAME, groupLimit];
  const [rows] = await conn.query<RollupRow[]>(sql, params);
  return rows.map(row => ({
    logID: Number(row.LogID),
    changeTime: row.ChangeTime,
    changedTable: COREMEASUREMENTS_TABLE_NAME,
    operation: row.Operation,
    changedBy: row.ChangedBy,
    plotID: scope.plotID,
    censusID: nullableNumber(row.CensusID),
    fileID: row.FileID,
    baseBatchID: row.BaseBatchID,
    memberCount: Number(row.MemberCount)
  }));
}

async function readForeignKeyLabels(conn: ChangeExportQueryable, schema: string, references: ForeignKeyReferences): Promise<ForeignKeyLabelMap> {
  const labels = { SpeciesID: new Map<number, string>(), QuadratID: new Map<number, string>() };
  for (const column of FOREIGN_KEY_COLUMNS) {
    const { table, labelColumn } = FOREIGN_KEY_LABELS[column];
    const ids = references[column];
    for (let start = 0; start < ids.length; start += FOREIGN_KEY_LABEL_CHUNK_SIZE) {
      const chunk = ids.slice(start, start + FOREIGN_KEY_LABEL_CHUNK_SIZE);
      const sql = safeFormatQuery(
        schema,
        `SELECT \`${column}\` AS id, \`${labelColumn}\` AS label FROM ??.\`${table}\` WHERE \`${column}\` IN (${buildInPlaceholders(chunk.length)})`
      );
      const [rows] = await conn.query<LabelRow[]>(sql, chunk);
      for (const row of rows) {
        if (row.label !== null) labels[column].set(Number(row.id), String(row.label));
      }
    }
  }
  return labels;
}

function countsAreFiltered(filters: RecentChangesServerFilters): boolean {
  return filters.quickSearch !== '' || filters.changedFrom !== '' || filters.changedTo !== '';
}

/**
 * Reads, expands and sorts every row of the export on the connection it is given. The caller owns
 * the connection and its snapshot; every statement here must run on that one connection.
 */
export async function collectChangeExport(
  conn: ChangeExportQueryable,
  scope: ChangeExportReadScope,
  limits: ChangeExportLimits
): Promise<ChangeExportSnapshot> {
  const filter = buildChangeFilter(scope.plotID, scope.filters);
  const drafts: ChangeExportDraft[] = [];
  let detailChangeCount = 0;
  let suppressedChangeCount = 0;
  let rollupMemberCount = 0;

  const appendRow = (draft: ChangeExportDraft) => {
    if (drafts.length >= limits.maxRows) throw new ExportTooLargeError(limits.maxRows);
    drafts.push(draft);
  };

  let cursor: DetailCursor | null = null;
  let moreDetailPages = true;
  while (moreDetailPages) {
    const page: ExportSourceChange[] = await runStage('detail', readDetailPage(conn, scope.schema, filter, cursor, limits.pageSize));
    for (const change of page) {
      detailChangeCount += 1;
      const expanded = expandChange(change);
      if (expanded.length === 0) suppressedChangeCount += 1;
      expanded.forEach(appendRow);
    }
    moreDetailPages = page.length === limits.pageSize;
    if (moreDetailPages) {
      const lastChange = page[page.length - 1];
      cursor = { changeTime: lastChange.changeTime, changeID: lastChange.changeID };
    }
  }

  // One more group than fits is enough to pass the ceiling; the SELECT never returns more.
  const groupLimit = limits.maxRows - drafts.length + 1;
  const groups = await runStage('rollup', readUploadRollup(conn, scope, filter, groupLimit));
  for (const group of groups) {
    rollupMemberCount += group.memberCount;
    appendRow(buildUploadRollupDraft(group));
  }

  const labels = await runStage('labels', readForeignKeyLabels(conn, scope.schema, collectForeignKeyReferences(drafts)));
  drafts.sort(compareExportDrafts);
  const context = { labels, countsAreFiltered: countsAreFiltered(scope.filters) };

  return { rows: drafts.map(draft => toExportCells(draft, context)), detailChangeCount, rollupMemberCount, suppressedChangeCount };
}

async function acquireConnection(): Promise<PoolConnection> {
  try {
    return await getConn();
  } catch {
    // getConn rethrows a bare message, so there is no driver code to keep.
    throw new ChangeExportReadError('acquire');
  }
}

type ConnectionCleanupStep = 'destroy' | 'release';

const CLEANUP_FAILED_MESSAGES: Record<ConnectionCleanupStep, string> = {
  destroy: 'Change export connection destroy failed',
  release: 'Change export connection release failed'
};

function reportCleanupFailure(message: string, scope: ChangeExportReadScope, driverCode: string | undefined): void {
  try {
    ailogger.error(message, new Error(message), { schema: scope.schema, plotID: scope.plotID, driverCode });
  } catch {
    // The logger is the last resort: when it throws too there is nowhere left to report to.
  }
}

/** Cleanup runs after the outcome is decided, so a step that throws is recorded and must not replace that outcome. */
function attemptConnectionCleanup(step: ConnectionCleanupStep, scope: ChangeExportReadScope, cleanupStep: () => void): void {
  try {
    cleanupStep();
  } catch (error: unknown) {
    reportCleanupFailure(CLEANUP_FAILED_MESSAGES[step], scope, driverCodeOf(error));
  }
}

async function rollbackOrDestroy(conn: PoolConnection, scope: ChangeExportReadScope): Promise<void> {
  try {
    await conn.rollback();
  } catch (rollbackError: unknown) {
    reportCleanupFailure(ROLLBACK_FAILED_MESSAGE, scope, driverCodeOf(rollbackError));
    attemptConnectionCleanup('destroy', scope, () => conn.destroy());
  }
}

/**
 * The whole export in ONE REPEATABLE READ snapshot on an owned connection, so the detail pages and
 * the rollup agree and a file_upload row moved by a running upload cannot appear twice. Read-only:
 * the transaction is always rolled back, and the connection is always released.
 */
export async function readChangeExportSnapshot(
  scope: ChangeExportReadScope,
  limits: ChangeExportLimits = DEFAULT_CHANGE_EXPORT_LIMITS
): Promise<ChangeExportSnapshot> {
  const conn = await acquireConnection();
  let transactionActive = false;
  let isolationLevelPending = false;
  try {
    await runStage('begin', conn.query(SNAPSHOT_ISOLATION_STATEMENT));
    isolationLevelPending = true;
    await runStage('begin', conn.query(SNAPSHOT_BEGIN_STATEMENT));
    isolationLevelPending = false;
    transactionActive = true;
    return await collectChangeExport(conn, scope, limits);
  } finally {
    if (transactionActive) await rollbackOrDestroy(conn, scope);
    // A one-shot isolation level that no transaction consumed would be spent by the next borrower of this connection.
    if (isolationLevelPending) attemptConnectionCleanup('destroy', scope, () => conn.destroy());
    attemptConnectionCleanup('release', scope, () => conn.release());
  }
}
