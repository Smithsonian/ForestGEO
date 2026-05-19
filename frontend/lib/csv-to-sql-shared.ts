/**
 * Shared helpers for csv-to-sql v1 and v2.
 *
 * v1 (`lib/csv-to-sql.ts`) re-exports everything from here via thin wrappers.
 * v2 will import directly from this module.
 */

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { escape as sqlEscape } from 'mysql2';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CENSUS_NUMBER_LEN = 16;

export const DEFAULT_TEMP_TABLE = 'TempAllTrees';

const UTF8_BOM = '﻿';

const STRICT_NUMERIC = /^-?(\d+\.?\d*|\.\d+)$/;
const MYSQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SqlValue = string | number | null;

export interface StagingRow {
  QuadratName: string | null;
  Tag: string | null;
  StemTag: string | null;
  Mnemonic: string | null;
  DBH: number | null;
  HOM: string | null;
  Codes: string | null;
  ExactDate: string | null;
  X: number | null;
  Y: number | null;
  PlotID: number;
  PlotCensusNumber: string;
}

export interface SharedCliArgs {
  input: string;
  site: string;
  plotId: number;
  censusNumber: string;
  output: string;
  tempTable: string;
}

export interface CreateStagingTableOptions {
  tableName: string;
  engine: 'MyISAM' | 'InnoDB';
  temporary: boolean;
}

// ---------------------------------------------------------------------------
// SQL escaping
// ---------------------------------------------------------------------------

/**
 * Escape a single value for inclusion in a SQL VALUES tuple.
 *
 * Delegates to mysql2's `escape()`, which handles NUL, \Z, \n, \r, \t, '\\'
 * and the single-quote character correctly.
 */
export function escapeSqlValue(value: SqlValue): string {
  if (value === null) return 'NULL';
  return sqlEscape(value);
}

/**
 * Backtick-quote a MySQL identifier.
 *
 * Rejects identifiers that contain characters not valid in an unquoted MySQL
 * identifier (letters, digits, underscores, starting with a letter or
 * underscore). This is intentionally strict: the goal is to prevent injection
 * via user-supplied table names, not to support every MySQL-legal identifier.
 */
export function escapeSqlIdentifier(identifier: string): string {
  if (!MYSQL_IDENTIFIER.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}. Use letters, numbers, and underscores, starting with a letter or underscore.`);
  }
  return `\`${identifier}\``;
}

// ---------------------------------------------------------------------------
// CSV row types
// ---------------------------------------------------------------------------

const REQUIRED_CSV_HEADERS = ['tag', 'stemtag', 'spcode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'] as const;
type CsvHeader = (typeof REQUIRED_CSV_HEADERS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function mapCsvRowToStagingRow(row: Record<string, string>, plotId: number, censusNumber: string): StagingRow {
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
    HOM: coerceNumericString('hom', row.hom),
    Codes: coerceString(row.codes),
    ExactDate: coerceDate(row.date),
    X: coerceNumber('lx', row.lx),
    Y: coerceNumber('ly', row.ly),
    PlotID: plotId,
    PlotCensusNumber: censusNumber
  };
}

function isNullToken(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed === '' || trimmed.toLowerCase() === 'null';
}

function coerceString(raw: string): string | null {
  if (isNullToken(raw)) return null;
  return raw.trim();
}

function coerceNumber(column: CsvHeader, raw: string): number | null {
  if (isNullToken(raw)) return null;
  const trimmed = raw.trim();
  if (!STRICT_NUMERIC.test(trimmed)) {
    throw new Error(`Column "${column}" expected a canonical numeric value (no hex, exponent, locale comma, leading +), got: ${raw}`);
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    throw new Error(`Column "${column}" numeric value is not finite, got: ${raw}`);
  }
  return n;
}

/**
 * Coerce a CSV cell to a trimmed numeric-looking string (or NULL).
 *
 * Used for columns whose destination is a CHAR/VARCHAR column where we want to
 * preserve the source lexical form (e.g. HOM '2.0' rather than the float
 * round-tripped '2'). Applies the same fail-fast canonical-numeric guard as
 * `coerceNumber` to reject hex / exponent / locale-comma / leading-plus, but
 * returns the trimmed string instead of a JS number.
 */
function coerceNumericString(column: CsvHeader, raw: string): string | null {
  if (isNullToken(raw)) return null;
  const trimmed = raw.trim();
  if (!STRICT_NUMERIC.test(trimmed)) {
    throw new Error(`Column "${column}" expected a canonical numeric value (no hex, exponent, locale comma, leading +), got: ${raw}`);
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    throw new Error(`Column "${column}" numeric value is not finite, got: ${raw}`);
  }
  return trimmed;
}

function coerceDate(raw: string): string | null {
  if (isNullToken(raw)) return null;
  const trimmed = raw.trim();
  if (!DATE_RE.test(trimmed)) {
    throw new Error(`Column "date" expected YYYY-MM-DD, got: ${raw}`);
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// DDL rendering
// ---------------------------------------------------------------------------

/**
 * Render `DROP [TEMPORARY] TABLE IF EXISTS` + `CREATE [TEMPORARY] TABLE` DDL
 * for the ctfsweb-style staging table.
 *
 * The `temporary` flag controls whether TEMPORARY keywords are emitted; the
 * `engine` is appended to the CREATE statement.
 */
export function renderCreateStagingTable({ tableName, engine, temporary }: CreateStagingTableOptions): string {
  const tableIdentifier = escapeSqlIdentifier(tableName);
  const temporaryKeyword = temporary ? 'TEMPORARY ' : '';
  return [
    `DROP ${temporaryKeyword}TABLE IF EXISTS ${tableIdentifier};`,
    `CREATE ${temporaryKeyword}TABLE ${tableIdentifier} (`,
    `  TempID           INT UNSIGNED AUTO_INCREMENT,`,
    `  QuadratName      VARCHAR(12),`,
    `  Subquad          INT UNSIGNED,`,
    `  Tag              VARCHAR(10),`,
    `  StemTag          VARCHAR(32),`,
    `  Mnemonic         VARCHAR(10),`,
    `  DBH              FLOAT(8) DEFAULT NULL,`,
    `  Codes            VARCHAR(50) DEFAULT NULL,`,
    `  HOM              VARCHAR(16) DEFAULT NULL,`,
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
    `  PlotCensusNumber VARCHAR(16),`,
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
    `) ENGINE=${engine};`
  ].join('\n');
}

// ---------------------------------------------------------------------------
// INSERT rendering
// ---------------------------------------------------------------------------

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
  const tableIdentifier = escapeSqlIdentifier(tableName);
  if (rows.length === 0) return [];
  const chunks: string[] = [];
  const columnList = INSERT_COLUMNS.join(', ');
  const insertHead = `INSERT INTO ${tableIdentifier} (${columnList}) VALUES`;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    const tuples = slice.map(row => '(' + INSERT_COLUMNS.map(col => escapeSqlValue(row[col])).join(',') + ')');
    chunks.push(`${insertHead}\n  ${tuples.join(',\n  ')};`);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// CSV file reading
// ---------------------------------------------------------------------------

export function parseCsvContent(content: string): Record<string, string>[] {
  const stripped = content.startsWith(UTF8_BOM) ? content.slice(UTF8_BOM.length) : content;
  const result = Papa.parse<Record<string, string>>(stripped, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim()
  });

  if (result.errors.length > 0) {
    const first = result.errors[0];
    const headerRowOffset = 2;
    const rowDisplay = typeof first.row === 'number' ? first.row + headerRowOffset : 'unknown';
    throw new Error(`CSV parse error: ${first.message} (row ${rowDisplay})`);
  }

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

export function readCsvFile(path: string): Record<string, string>[] {
  const content = readFileSync(path, 'utf-8');
  return parseCsvContent(content);
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function defaultOutputPath(input: string, suffix: string): string {
  return input.endsWith('.csv') ? input.slice(0, -'.csv'.length) + suffix : input + suffix;
}

/**
 * Parse the six common CLI args shared between v1 and v2.
 *
 * `opts.outputSuffix` (default `.sql`) is appended to the input path when
 * `--output` is not provided.
 */
export function parseSharedCliArgs(argv: string[], opts?: { outputSuffix?: string }): SharedCliArgs {
  const outputSuffix = opts?.outputSuffix ?? '.sql';

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

  const censusNumber = values['census-number'];
  if (censusNumber.length > MAX_CENSUS_NUMBER_LEN) {
    throw new Error(`--census-number must be at most ${MAX_CENSUS_NUMBER_LEN} characters, got: ${censusNumber}`);
  }

  const output = values.output ?? defaultOutputPath(values.input, outputSuffix);
  const tempTable = values['temp-table'] ?? DEFAULT_TEMP_TABLE;
  escapeSqlIdentifier(tempTable);

  return { input: values.input, site: values.site, plotId, censusNumber, output, tempTable };
}
