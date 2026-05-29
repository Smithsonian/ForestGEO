/**
 * Convert an app-exported census CSV into a SQL file that creates and bulk-loads
 * a `TempAllTrees` staging table matching the legacy ctfsweb schema.
 *
 * Usage:
 *   npx tsx lib/csv-to-sql.ts \
 *     --input <path/to/census.csv> \
 *     --site SERC \
 *     --plot-id 1 \
 *     --census-number 2 \
 *     [--output <path/to/out.sql>] \
 *     [--temp-table TempAllTrees]
 *
 * Produces a .sql file (default: <input>.sql) ready to run against MySQL.
 * Never connects to the database.
 *
 * See: frontend/docs/superpowers/specs/2026-05-11-csv-to-sql-design.md
 */

import { writeFileSync } from 'node:fs';
import {
  escapeSqlIdentifier,
  escapeSqlValue,
  mapCsvRowToStagingRow,
  readCsvFile,
  parseCsvContent,
  renderCreateStagingTable,
  renderInsertChunks,
  parseSharedCliArgs,
  type StagingRow,
  type SqlValue,
  type SharedCliArgs
} from './csv-to-sql-shared';

// Re-export everything so existing third-party imports of this module continue to work.
export { escapeSqlIdentifier, escapeSqlValue, mapCsvRowToStagingRow, readCsvFile, parseCsvContent, renderInsertChunks, type StagingRow, type SqlValue };

export interface CliArgs {
  input: string;
  site: string;
  plotId: number;
  censusNumber: string;
  output: string;
  tempTable: string;
}

/**
 * v1 DDL renderer — plain (non-temporary) MyISAM table.
 *
 * Thin wrapper over `renderCreateStagingTable` in the shared module.
 * Preserves the v1 public signature `renderCreateTable(tableName: string)`.
 */
export function renderCreateTable(tableName: string): string {
  return renderCreateStagingTable({ tableName, engine: 'MyISAM', temporary: false });
}

/**
 * Parse v1 CLI args.
 *
 * Thin wrapper over `parseSharedCliArgs` with the v1 default `.sql` output suffix.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  return parseSharedCliArgs(argv);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseCliArgs(argv);
  const rawRows = readCsvFile(args.input);
  const stagingRows = rawRows.map(row => mapCsvRowToStagingRow(row, args.plotId, args.censusNumber));

  const header = [
    `-- Generated ${new Date().toISOString()} from ${args.input}`,
    `-- Source rows: ${stagingRows.length}`,
    `-- Site: ${args.site}, PlotID: ${args.plotId}, PlotCensusNumber: ${args.censusNumber}`,
    `-- Target staging table: ${args.tempTable}`,
    ''
  ].join('\n');

  const ddl = renderCreateTable(args.tempTable);
  const inserts = renderInsertChunks(args.tempTable, stagingRows);

  const sql = [header, ddl, '', ...inserts].join('\n') + '\n';
  writeFileSync(args.output, sql, 'utf-8');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}
