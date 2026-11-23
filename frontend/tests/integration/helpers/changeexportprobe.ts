/**
 * Reads the change-log export's own classification and rows for rows a test wrote through a real
 * writer (#592). Every statement runs on the connection the test passes in, so rows the test has
 * not committed yet are visible too.
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { buildInPlaceholders, safeFormatQuery } from '@/lib/db/sqlsecurity';
import { EXPORT_COLUMNS, type ExportCell } from '@/config/changelogexport';
import { DEFAULT_RECENT_CHANGES_FILTERS, type RecentChangesServerFilters } from '@/config/recentchangesexplorer';
import { buildUploadPipelineRowPredicate, collectChangeExport, type ChangeExportSnapshot } from '@/lib/changes/exportsnapshot';

const PROBE_MAX_ROWS = 100_000;
const PROBE_PAGE_SIZE = 500;

export type ExportColumn = (typeof EXPORT_COLUMNS)[number];
export type ExportedRow = Record<ExportColumn, ExportCell>;

export interface ClassifiedChange {
  changeID: number;
  tableName: string;
  recordID: string;
  operation: string;
  /** `(<upload predicate>) IS TRUE`: the rollup query takes the row. */
  isUploadPipelineRow: boolean;
  /** `(<upload predicate>) IS NOT TRUE`: the detail query takes the row. */
  isDetailRow: boolean;
}

export async function latestChangeID(connection: Connection, schema: string): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>(safeFormatQuery(schema, 'SELECT COALESCE(MAX(ChangeID), 0) AS latest FROM ??.unifiedchangelog'));
  return Number(rows[0].latest);
}

async function classify(connection: Connection, schema: string, condition: string, conditionParams: unknown[]): Promise<ClassifiedChange[]> {
  const predicate = buildUploadPipelineRowPredicate();
  const sql = safeFormatQuery(
    schema,
    `SELECT uc.ChangeID, uc.TableName, uc.RecordID, uc.Operation,
            ${predicate.sql} IS TRUE AS isUploadPipelineRow,
            ${predicate.sql} IS NOT TRUE AS isDetailRow
     FROM ??.unifiedchangelog uc
     WHERE ${condition}
     ORDER BY uc.ChangeID`
  );
  const [rows] = await connection.query<RowDataPacket[]>(sql, [...predicate.params, ...predicate.params, ...conditionParams]);
  return rows.map(row => ({
    changeID: Number(row.ChangeID),
    tableName: String(row.TableName),
    recordID: String(row.RecordID),
    operation: String(row.Operation),
    isUploadPipelineRow: Number(row.isUploadPipelineRow) === 1,
    isDetailRow: Number(row.isDetailRow) === 1
  }));
}

/** Every changelog row written after `afterChangeID`, classified. */
export function classifyChangesAfter(connection: Connection, schema: string, afterChangeID: number): Promise<ClassifiedChange[]> {
  return classify(connection, schema, 'uc.ChangeID > ?', [afterChangeID]);
}

export function classifyChanges(connection: Connection, schema: string, changeIDs: number[]): Promise<ClassifiedChange[]> {
  return classify(connection, schema, `uc.ChangeID IN (${buildInPlaceholders(changeIDs.length)})`, changeIDs);
}

export function collectPlotExport(
  connection: Connection,
  schema: string,
  plotID: number,
  filters: RecentChangesServerFilters = DEFAULT_RECENT_CHANGES_FILTERS
): Promise<ChangeExportSnapshot> {
  return collectChangeExport(connection, { schema, plotID, filters }, { maxRows: PROBE_MAX_ROWS, pageSize: PROBE_PAGE_SIZE });
}

export function toExportedRows(cellRows: ExportCell[][]): ExportedRow[] {
  return cellRows.map(cells => Object.fromEntries(EXPORT_COLUMNS.map((column, index) => [column, cells[index]])) as ExportedRow);
}

/** The plot's whole export as one object per CSV row, keyed by column name. */
export async function exportedRowsForPlot(connection: Connection, schema: string, plotID: number): Promise<ExportedRow[]> {
  return toExportedRows((await collectPlotExport(connection, schema, plotID)).rows);
}

/** One line per row for failure messages. */
export function describeExportedRows(rows: ExportedRow[]): string {
  return rows.map(row => EXPORT_COLUMNS.map(column => `${column}=${JSON.stringify(row[column])}`).join(' ')).join('\n');
}
