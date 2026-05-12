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

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';

export interface CliArgs {
  input: string;
  site: string;
  plotId: number;
  censusNumber: number;
  output: string;
  tempTable: string;
}

const DEFAULT_TEMP_TABLE = 'TempAllTrees';

export type SqlValue = string | number | null;

export function escapeSqlValue(value: SqlValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "''");
  return `'${escaped}'`;
}

const REQUIRED_CSV_HEADERS = ['tag', 'stemtag', 'spcode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'] as const;
type CsvHeader = (typeof REQUIRED_CSV_HEADERS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface StagingRow {
  QuadratName: string | null;
  Tag: string | null;
  StemTag: string | null;
  Mnemonic: string | null;
  DBH: number | null;
  HOM: number | null;
  Codes: string | null;
  ExactDate: string | null;
  X: number | null;
  Y: number | null;
  PlotID: number;
  PlotCensusNumber: number;
}

export function mapCsvRowToStagingRow(row: Record<string, string>, plotId: number, censusNumber: number): StagingRow {
  for (const header of REQUIRED_CSV_HEADERS) {
    if (!(header in row)) {
      throw new Error(`Missing required CSV header: ${header}`);
    }
  }
  return {
    QuadratName: coerceString(row.quadrat),
    Tag: coerceString(row.tag),
    StemTag: coerceString(row.stemtag),
    Mnemonic: coerceString(row.spcode),
    DBH: coerceNumber('dbh', row.dbh),
    HOM: coerceNumber('hom', row.hom),
    Codes: coerceString(row.codes),
    ExactDate: coerceDate(row.date),
    X: coerceNumber('lx', row.lx),
    Y: coerceNumber('ly', row.ly),
    PlotID: plotId,
    PlotCensusNumber: censusNumber
  };
}

function coerceString(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function coerceNumber(column: CsvHeader, raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    throw new Error(`Column "${column}" expected a numeric value, got: ${raw}`);
  }
  return n;
}

function coerceDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!DATE_RE.test(trimmed)) {
    throw new Error(`Column "date" expected YYYY-MM-DD, got: ${raw}`);
  }
  return trimmed;
}

export function renderCreateTable(tableName: string): string {
  return [
    `DROP TABLE IF EXISTS \`${tableName}\`;`,
    `CREATE TABLE \`${tableName}\` (`,
    `  TempID           INT UNSIGNED AUTO_INCREMENT,`,
    `  QuadratName      VARCHAR(12),`,
    `  Subquad          INT UNSIGNED,`,
    `  Tag              VARCHAR(10),`,
    `  StemTag          VARCHAR(32),`,
    `  Mnemonic         VARCHAR(10),`,
    `  DBH              FLOAT(8) DEFAULT NULL,`,
    `  Codes            VARCHAR(50) DEFAULT NULL,`,
    `  HOM              FLOAT(8) DEFAULT NULL,`,
    `  Comments         VARCHAR(256) DEFAULT NULL,`,
    `  TreeID           INT UNSIGNED,`,
    `  StemID           INT UNSIGNED,`,
    `  ExactDate        DATE,`,
    `  QuadratID        INT UNSIGNED,`,
    `  X                FLOAT(8),`,
    `  Y                FLOAT(8),`,
    `  SpeciesID        INT UNSIGNED,`,
    `  SubSpeciesID     INT UNSIGNED,`,
    `  DBHID            INT UNSIGNED,`,
    `  PlotCensusNumber INT UNSIGNED,`,
    `  CensusID         INT UNSIGNED,`,
    `  PrimaryStem      VARCHAR(20),`,
    `  PlotID           INT UNSIGNED,`,
    `  Errors           VARCHAR(256),`,
    `  Tagged           VARCHAR(1),`,
    `  PRIMARY KEY (TempID),`,
    `  KEY \`indexTagStemTag\` (\`Tag\`,\`StemTag\`),`,
    `  KEY \`indexTreeIDStemID\` (\`TreeID\`,\`StemID\`),`,
    `  KEY \`indexQuadratNamePlotID\` (\`QuadratName\`,\`PlotID\`),`,
    `  KEY \`indexMnemonic\` (\`Mnemonic\`)`,
    `) ENGINE=MyISAM;`
  ].join('\n');
}

const INSERT_COLUMNS: ReadonlyArray<keyof StagingRow> = [
  'QuadratName',
  'Tag',
  'StemTag',
  'Mnemonic',
  'DBH',
  'HOM',
  'Codes',
  'ExactDate',
  'X',
  'Y',
  'PlotID',
  'PlotCensusNumber'
] as const;

const DEFAULT_CHUNK_SIZE = 1000;

export function renderInsertChunks(tableName: string, rows: StagingRow[], chunkSize: number = DEFAULT_CHUNK_SIZE): string[] {
  if (rows.length === 0) return [];
  const chunks: string[] = [];
  const columnList = INSERT_COLUMNS.join(', ');
  const insertHead = `INSERT INTO \`${tableName}\` (${columnList}) VALUES`;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    const tuples = slice.map(row => '(' + INSERT_COLUMNS.map(col => escapeSqlValue(row[col])).join(',') + ')');
    chunks.push(`${insertHead}\n  ${tuples.join(',\n  ')};`);
  }
  return chunks;
}

export function readCsvFile(path: string): Record<string, string>[] {
  const content = readFileSync(path, 'utf-8');
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim()
  });

  const actualHeaders = result.meta.fields ?? [];
  const missing = REQUIRED_CSV_HEADERS.filter(h => !actualHeaders.includes(h));
  if (missing.length > 0) {
    throw new Error(`CSV is missing required header(s): ${missing.join(', ')}`);
  }
  const extras = actualHeaders.filter(h => !(REQUIRED_CSV_HEADERS as ReadonlyArray<string>).includes(h));
  if (extras.length > 0) {
    console.warn(`CSV has extra columns that will be ignored: ${extras.join(', ')}`);
  }

  return result.data;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      input: { type: 'string' },
      site: { type: 'string' },
      'plot-id': { type: 'string' },
      'census-number': { type: 'string' },
      output: { type: 'string' },
      'temp-table': { type: 'string' }
    },
    strict: true
  });

  if (!values.input) throw new Error('Missing required flag: --input');
  if (!values.site) throw new Error('Missing required flag: --site');
  if (!values['plot-id']) throw new Error('Missing required flag: --plot-id');
  if (!values['census-number']) throw new Error('Missing required flag: --census-number');

  const plotId = Number(values['plot-id']);
  if (!Number.isInteger(plotId)) throw new Error(`--plot-id must be an integer, got: ${values['plot-id']}`);

  const censusNumber = Number(values['census-number']);
  if (!Number.isInteger(censusNumber)) throw new Error(`--census-number must be an integer, got: ${values['census-number']}`);

  const output = values.output ?? defaultOutputPath(values.input);
  const tempTable = values['temp-table'] ?? DEFAULT_TEMP_TABLE;

  return { input: values.input, site: values.site, plotId, censusNumber, output, tempTable };
}

function defaultOutputPath(input: string): string {
  return input.endsWith('.csv') ? input.slice(0, -'.csv'.length) + '.sql' : input + '.sql';
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  // Wired in Task 6. For now, echo the parsed args.
  process.stdout.write(JSON.stringify(args, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}
