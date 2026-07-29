/**
 * Schema contract: a normalized, comparable description of the database objects
 * the application depends on at write time.
 *
 * There are two producers of a {@link SchemaContract}:
 *   1. {@link parseCanonicalSchemaContract} / {@link loadCanonicalSchemaContract} —
 *      parse the canonical DDL (`db/sql/tablestructures.sql`) into the contract shape.
 *   2. {@link readLiveSchemaContract} — read `information_schema` for a provisioned
 *      schema into the same shape.
 *
 * {@link compareSchemaContracts} diffs the two and returns structured failures
 * (missing / incompatible REQUIRED objects) separately from informational extras
 * (objects the live schema has beyond the canonical contract).
 *
 * This module is deliberately dependency-free (only `fs`/`path`) so it can be
 * imported by an integration test, a CI audit script, and a deploy pre-flight
 * check alike.
 */

import fs from 'fs';
import path from 'path';

export const TARGET_TEXT_COLLATION = 'utf8mb4_0900_ai_ci';

/** Tables whose write contract the application must be able to trust. */
export const CRITICAL_TABLES = [
  'temporarymeasurements',
  'coremeasurements',
  'species',
  'quadrats',
  'trees',
  'stems',
  'measurement_error_log',
  'uploadintegrityalerts',
  'uploadmetrics'
] as const;

/**
 * Individual columns that must exist, on tables NOT in {@link CRITICAL_TABLES}.
 *
 * `upload_sessions` deliberately is not a critical table. A read-only all-site
 * audit on 2026-07-29 found pre-existing, unrelated drift on it — forestgeo_mpala
 * and forestgeo_serc are missing column DEFAULTs (state, total_chunks,
 * uploaded_chunks, processed_batches, total_batches, last_heartbeat) and store
 * their text columns as utf8mb3. Promoting the whole table would turn the deploy
 * gate red for reasons this change did not cause and cannot automatically
 * repair, so only the column whose absence is dangerous is required here.
 *
 * `census_replacement_completed_at` is that column: without it a CLEAN_REUPLOAD
 * silently reverts to replacing the census on every file of a session, which is
 * how a second file destroys the failure rows the first one recorded.
 */
export const REQUIRED_COLUMNS_BY_TABLE: Record<string, readonly string[]> = {
  upload_sessions: ['census_replacement_completed_at']
};

/**
 * Named indexes/constraints whose presence and shape are load-bearing for
 * ingestion (dedup, idempotency, upload lineage, published-stem lookup).
 * These are compared exactly; every other live index is reported as informational.
 */
export const REQUIRED_INDEXES_BY_TABLE: Record<string, readonly string[]> = {
  species: ['uq_species_active_code'],
  quadrats: ['uq_quadrats_active_name'],
  temporarymeasurements: ['idx_tmpm_file_batch_census', 'ingest_temporarymeasurements_FBPC_index', 'idx_tmpm_plot_census_file_batch'],
  // ux_measure_unique and idx_cm_* — the first is the collision check's third
  // STRAIGHT_JOIN lookup, the rest carry batch-scoped upload verification.
  coremeasurements: ['ux_cm_uploadbatch_rowindex', 'idx_cm_uploadbatch_census', 'idx_cm_uploadfile_batch_census_stem', 'ux_measure_unique'],
  stems: ['idx_stems_publishedstemid', 'ux_stems_treeid_stemtag_census'],
  // STRAIGHT_JOIN pins the JOIN ORDER of the collision check
  // (existing_tag_stemtag_collision_failures, storedprocedures.sql STAGE 8) but
  // not the ACCESS PATH. Each of the three joined tables must still be reachable
  // by an indexed lookup keyed on the batch row; without one, the pinned order
  // degrades to a per-batch-row scan with no optimizer escape — the 8s -> 1500s
  // shape the STRAIGHT_JOIN was added to prevent. This project has documented
  // prod index drift, so the three lookups are contract-required, not assumed.
  trees: ['idx_trees_tag_census_active']
};

/**
 * Every table a contract read must fetch: the fully-compared critical tables
 * plus the ones that only have presence-only column requirements. Reading the
 * critical list alone would make {@link REQUIRED_COLUMNS_BY_TABLE} silently
 * unenforceable — the table would simply be absent from the live contract.
 */
export const CONTRACT_READ_TABLES: readonly string[] = [...CRITICAL_TABLES, ...Object.keys(REQUIRED_COLUMNS_BY_TABLE)];

const TEXT_DATA_TYPES = new Set(['char', 'varchar', 'text', 'tinytext', 'mediumtext', 'longtext', 'enum', 'set']);

const CANONICAL_DDL_RELATIVE_PATH = path.join('db', 'sql', 'tablestructures.sql');

export interface ColumnContract {
  /** Original-cased column name. */
  name: string;
  /** Normalized full type incl. width/precision/unsigned, e.g. `varchar(25)`, `decimal(12,6)`, `int unsigned`, `bit(1)`. */
  typeSignature: string;
  /** Base data type (first keyword), e.g. `varchar`, `int`, `decimal`, `enum`. */
  dataType: string;
  nullable: boolean;
  /** Normalized default (unquoted literal, `CURRENT_TIMESTAMP`, or null when there is no default). */
  defaultValue: string | null;
  /** Sorted, normalized generated/auto/on-update flags, e.g. `auto_increment`, `stored_generated`. */
  extra: string;
  /** Collation for text columns; null for non-text columns. */
  collation: string | null;
  isText: boolean;
}

export interface IndexContract {
  /** Original-cased index/constraint name. */
  name: string;
  unique: boolean;
  /** Ordered, original-cased column names. */
  columns: string[];
}

export interface TableContract {
  name: string;
  /** Keyed by lower-cased column name. */
  columns: Record<string, ColumnContract>;
  /** Keyed by lower-cased index name. */
  indexes: Record<string, IndexContract>;
}

export interface SchemaContract {
  defaultCollation: string | null;
  /** Keyed by lower-cased table name. */
  tables: Record<string, TableContract>;
}

export type SchemaDifferenceCategory = 'column' | 'index';

export type SchemaDifferenceKind = 'missing' | 'type' | 'nullability' | 'default' | 'extra' | 'collation' | 'uniqueness' | 'columns';

export interface SchemaDifference {
  table: string;
  object: string;
  category: SchemaDifferenceCategory;
  kind: SchemaDifferenceKind;
  expected: string | null;
  actual: string | null;
}

export interface ContractComparison {
  /** Missing or incompatible REQUIRED objects — these are contract violations. */
  failures: SchemaDifference[];
  /** Live objects beyond the canonical contract — informational, never a failure here. */
  extras: SchemaDifference[];
}

export interface CompareOptions {
  /** Tables to compare (lower-cased); defaults to {@link CRITICAL_TABLES}. */
  tables?: readonly string[];
  /** Required named indexes per table; defaults to {@link REQUIRED_INDEXES_BY_TABLE}. */
  requiredIndexesByTable?: Record<string, readonly string[]>;
  /** Presence-only column requirements outside `tables`; defaults to {@link REQUIRED_COLUMNS_BY_TABLE}. */
  requiredColumnsByTable?: Record<string, readonly string[]>;
}

/** Minimal row shape returned by a query executor; sufficient for information_schema reads. */
export type SchemaQueryRow = Record<string, unknown>;
export type SchemaQueryExecutor = (sql: string, params: unknown[]) => Promise<SchemaQueryRow[]>;

// ---------------------------------------------------------------------------
// Normalization helpers (shared by the DDL parser and the information_schema reader)
// ---------------------------------------------------------------------------

/**
 * Strips whitespace that is adjacent to `(`, `)`, or `,` and collapses the rest
 * to single spaces — but only OUTSIDE single-quoted string literals, so enum
 * values such as `'alive-not measured'` keep their internal spaces.
 */
function collapseTypeWhitespace(raw: string): string {
  let result = '';
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "'") {
      inQuote = !inQuote;
      result += ch;
      continue;
    }
    if (inQuote) {
      result += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      const prev = result[result.length - 1];
      const next = raw[i + 1];
      if (prev === '(' || prev === ',' || next === '(' || next === ')' || next === ',') continue;
      if (prev === ' ') continue;
      result += ' ';
      continue;
    }
    result += ch;
  }
  return result.trim();
}

export function normalizeTypeSignature(raw: string): string {
  let normalized = collapseTypeWhitespace(raw.toLowerCase());
  // MySQL reports a bare BIT as bit(1); make both sides agree.
  if (normalized === 'bit') normalized = 'bit(1)';
  return normalized;
}

/**
 * Normalizes a default value from either DDL (`default 'csv'`, `default 1`,
 * `default CURRENT_TIMESTAMP`) or information_schema (already-unquoted) into a
 * single comparable form. Returns null when there is no default.
 */
export function normalizeDefaultValue(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (trimmed.toLowerCase() === 'null') return null;
  if (trimmed.toLowerCase() === 'current_timestamp') return 'CURRENT_TIMESTAMP';
  // Single-quoted string literal -> inner value (handles the '' -> ' escape).
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

/**
 * Reduces raw EXTRA metadata to the load-bearing flags: auto_increment,
 * generated (stored/virtual), and on-update. Noise such as DEFAULT_GENERATED and
 * INVISIBLE is intentionally dropped so the two sides remain comparable.
 *
 * Generation is detected ONLY via the explicit `stored generated` / `virtual
 * generated` phrases — information_schema.EXTRA emits these verbatim, and the DDL
 * parser injects the matching phrase after precisely detecting `AS (...)`. There
 * is deliberately no bare-`as` fallback: a plain column whose remainder happens
 * to contain the word "as" (e.g. `COMMENT 'measured as diameter'` or a default
 * string) must not be mistagged as generated.
 */
export function normalizeExtraMetadata(raw: string | null | undefined): string {
  const value = (raw ?? '').toLowerCase();
  const flags: string[] = [];
  if (value.includes('auto_increment')) flags.push('auto_increment');
  if (value.includes('stored generated')) flags.push('stored_generated');
  else if (value.includes('virtual generated')) flags.push('virtual_generated');
  if (value.includes('on update current_timestamp')) flags.push('on_update_current_timestamp');
  return flags.sort().join(',');
}

function isTextDataType(dataType: string): boolean {
  return TEXT_DATA_TYPES.has(dataType.toLowerCase());
}

// ---------------------------------------------------------------------------
// DDL parsing
// ---------------------------------------------------------------------------

/** Removes `-- ...` line comments that fall outside single-quoted string literals. */
function stripLineComments(ddl: string): string {
  return ddl
    .split('\n')
    .map(line => {
      let inQuote = false;
      for (let i = 0; i < line.length - 1; i++) {
        const ch = line[i];
        if (ch === "'") inQuote = !inQuote;
        if (!inQuote && ch === '-' && line[i + 1] === '-') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

/** Splits DDL into statements on semicolons that fall outside quotes/identifiers. */
function splitStatements(ddl: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inQuote = false;
  let inBacktick = false;
  for (let i = 0; i < ddl.length; i++) {
    const ch = ddl[i];
    if (ch === "'" && !inBacktick) inQuote = !inQuote;
    else if (ch === '`' && !inQuote) inBacktick = !inBacktick;
    if (ch === ';' && !inQuote && !inBacktick) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

/** Extracts the content inside the outermost balanced parentheses of a CREATE TABLE. */
function extractTableBody(statement: string): string {
  const open = statement.indexOf('(');
  if (open < 0) return '';
  let depth = 0;
  let inQuote = false;
  let inBacktick = false;
  for (let i = open; i < statement.length; i++) {
    const ch = statement[i];
    if (ch === "'" && !inBacktick) inQuote = !inQuote;
    else if (ch === '`' && !inQuote) inBacktick = !inBacktick;
    if (inQuote || inBacktick) continue;
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return statement.slice(open + 1, i);
    }
  }
  return statement.slice(open + 1);
}

/** Splits a table body into top-level items on commas outside quotes/identifiers/parens. */
function splitTopLevelItems(body: string): string[] {
  const items: string[] = [];
  let current = '';
  let depth = 0;
  let inQuote = false;
  let inBacktick = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "'" && !inBacktick) inQuote = !inQuote;
    else if (ch === '`' && !inQuote) inBacktick = !inBacktick;
    if (!inQuote && !inBacktick) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) {
        const trimmed = current.trim();
        if (trimmed) items.push(trimmed);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) items.push(tail);
  return items;
}

function parseIndexColumns(rawColumns: string): string[] {
  return splitTopLevelItems(rawColumns).map(
    col =>
      col
        .replace(/`/g, '')
        .replace(/\([^)]*\)/g, '') // drop prefix lengths / functional parts
        .trim()
        .split(/\s+/)[0]
  );
}

function parseColumnDefinition(item: string, defaultCollation: string | null): ColumnContract | null {
  const nameMatch = item.match(/^`?([A-Za-z_][A-Za-z0-9_]*)`?\s+([\s\S]+)$/);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  const remainder = nameMatch[2];

  const isGenerated = /\bas\s*\(/i.test(remainder);
  const typeSource = isGenerated ? remainder.slice(0, remainder.search(/\bas\s*\(/i)) : remainder;

  const typeMatch = typeSource.match(/^\s*([A-Za-z]+)\s*(\([^)]*\))?\s*(unsigned)?\s*(zerofill)?/i);
  if (!typeMatch) return null;
  const dataType = typeMatch[1].toLowerCase();
  const parenPart = typeMatch[2] ?? '';
  const unsignedPart = typeMatch[3] ? ' unsigned' : '';
  const typeSignature = normalizeTypeSignature(`${dataType}${parenPart}${unsignedPart}`);

  const hasNotNull = /\bnot\s+null\b/i.test(remainder);
  const hasInlinePrimaryKey = /\bprimary\s+key\b/i.test(remainder);
  const nullable = !(hasNotNull || hasInlinePrimaryKey);

  let defaultValue: string | null = null;
  if (!isGenerated) {
    const defaultMatch = remainder.match(/\bdefault\s+(b'[^']*'|'(?:[^']|'')*'|[^\s,]+)/i);
    defaultValue = defaultMatch ? normalizeDefaultValue(defaultMatch[1]) : null;
  }

  // A generated column is VIRTUAL unless it explicitly declares STORED/PERSISTENT.
  // Inject the explicit phrase normalizeExtraMetadata keys on, so generation is
  // driven by the precise `AS (...)` detection above rather than a loose scan.
  const generatedMarker = isGenerated ? (/\b(stored|persistent)\b/i.test(remainder) ? ' stored generated' : ' virtual generated') : '';
  const extra = normalizeExtraMetadata(`${remainder}${generatedMarker}`);

  const isText = isTextDataType(dataType);
  const collateMatch = remainder.match(/\bcollate\s+([A-Za-z0-9_]+)/i);
  const collation = isText ? (collateMatch ? collateMatch[1] : defaultCollation) : null;

  return { name, typeSignature, dataType, nullable, defaultValue, extra, collation, isText };
}

function markPrimaryKeyColumnsNotNull(body: string, columns: Record<string, ColumnContract>): void {
  for (const item of splitTopLevelItems(body)) {
    const pkMatch = item.match(/^(?:constraint\s+\w+\s+)?primary\s+key\s*\(([^)]*)\)/i);
    if (!pkMatch) continue;
    for (const col of parseIndexColumns(pkMatch[1])) {
      const existing = columns[col.toLowerCase()];
      if (existing) existing.nullable = false;
    }
  }
}

function parseTableStatement(statement: string, defaultCollation: string | null): TableContract | null {
  const header = statement.match(/^create\s+table\s+(?:if\s+not\s+exists\s+)?`?([A-Za-z0-9_]+)`?\s*\(/i);
  if (!header) return null;
  const name = header[1];
  const body = extractTableBody(statement);

  const columns: Record<string, ColumnContract> = {};
  const indexes: Record<string, IndexContract> = {};

  for (const item of splitTopLevelItems(body)) {
    const namedUnique = item.match(/^constraint\s+`?(\w+)`?\s+unique\s*\(([^)]*)\)/i);
    if (namedUnique) {
      indexes[namedUnique[1].toLowerCase()] = { name: namedUnique[1], unique: true, columns: parseIndexColumns(namedUnique[2]) };
      continue;
    }
    if (/^constraint\b/i.test(item) || /^(primary\s+key|unique|key|index|fulltext|foreign\s+key)\b/i.test(item)) {
      continue; // FK / PK / anonymous indexes are not part of the named contract
    }
    const column = parseColumnDefinition(item, defaultCollation);
    if (column) columns[column.name.toLowerCase()] = column;
  }

  markPrimaryKeyColumnsNotNull(body, columns);

  return { name, columns, indexes };
}

export function parseCanonicalSchemaContract(ddl: string): SchemaContract {
  const cleaned = stripLineComments(ddl);
  const statements = splitStatements(cleaned);

  const defaultCollationMatch = cleaned.match(/alter\s+database[\s\S]*?collate\s+([A-Za-z0-9_]+)/i);
  const defaultCollation = defaultCollationMatch ? defaultCollationMatch[1] : null;

  const tables: Record<string, TableContract> = {};

  for (const statement of statements) {
    const table = parseTableStatement(statement, defaultCollation);
    if (table) {
      tables[table.name.toLowerCase()] = table;
      continue;
    }
    const indexMatch = statement.match(/^create\s+(unique\s+)?index\s+`?(\w+)`?\s+on\s+`?(\w+)`?\s*\(([\s\S]*)\)/i);
    if (indexMatch) {
      const targetTable = tables[indexMatch[3].toLowerCase()];
      if (targetTable) {
        targetTable.indexes[indexMatch[2].toLowerCase()] = {
          name: indexMatch[2],
          unique: Boolean(indexMatch[1]),
          columns: parseIndexColumns(indexMatch[4])
        };
      }
    }
  }

  // Text-column collation is inherited from the schema default. If the canonical
  // DDL never declared one (no `ALTER DATABASE ... COLLATE`), every text column
  // would carry a null expected collation and then diff against a live
  // utf8mb4_0900_ai_ci — mass false failures across every audited schema. Fail
  // loudly here instead so the DDL, not the audit, is fixed.
  if (defaultCollation === null) {
    const firstTextColumn = Object.values(tables)
      .flatMap(table => Object.values(table.columns).map(column => ({ table: table.name, column })))
      .find(entry => entry.column.isText);
    if (firstTextColumn) {
      throw new Error(
        `Canonical DDL declares text column(s) (e.g. ${firstTextColumn.table}.${firstTextColumn.column.name}) ` +
          `but has no schema default collation: an "ALTER DATABASE ... COLLATE <collation>" clause is required so ` +
          `text-column collation can be compared against the live schema.`
      );
    }
  }

  return { defaultCollation, tables };
}

export function resolveCanonicalDDLPath(explicitPath?: string): string {
  return explicitPath ?? path.join(process.cwd(), CANONICAL_DDL_RELATIVE_PATH);
}

export function loadCanonicalSchemaContract(ddlFilePath?: string): SchemaContract {
  const resolved = resolveCanonicalDDLPath(ddlFilePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Canonical DDL file not found: ${resolved}`);
  }
  return parseCanonicalSchemaContract(fs.readFileSync(resolved, 'utf-8'));
}

// ---------------------------------------------------------------------------
// information_schema reading
// ---------------------------------------------------------------------------

function coerceString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export async function readLiveSchemaContract(exec: SchemaQueryExecutor, schema: string, tableNames: readonly string[]): Promise<SchemaContract> {
  const schemataRows = await exec(`SELECT DEFAULT_COLLATION_NAME AS collation_name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`, [schema]);
  const defaultCollation = coerceString(schemataRows[0]?.collation_name);

  const tables: Record<string, TableContract> = {};

  for (const tableName of tableNames) {
    const columnRows = await exec(
      `SELECT COLUMN_NAME AS name, DATA_TYPE AS data_type, COLUMN_TYPE AS column_type,
              IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default,
              EXTRA AS extra, COLLATION_NAME AS collation_name
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [schema, tableName]
    );

    const columns: Record<string, ColumnContract> = {};
    for (const row of columnRows) {
      const name = String(row.name);
      const dataType = String(row.data_type);
      const isText = isTextDataType(dataType);
      columns[name.toLowerCase()] = {
        name,
        typeSignature: normalizeTypeSignature(String(row.column_type)),
        dataType,
        nullable: String(row.is_nullable).toUpperCase() === 'YES',
        defaultValue: normalizeDefaultValue(coerceString(row.column_default)),
        extra: normalizeExtraMetadata(coerceString(row.extra)),
        collation: isText ? coerceString(row.collation_name) : null,
        isText
      };
    }

    const statisticsRows = await exec(
      `SELECT INDEX_NAME AS index_name, NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS seq, COLUMN_NAME AS column_name
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [schema, tableName]
    );

    const indexes: Record<string, IndexContract> = {};
    for (const row of statisticsRows) {
      const indexName = String(row.index_name);
      const key = indexName.toLowerCase();
      if (!indexes[key]) {
        indexes[key] = { name: indexName, unique: Number(row.non_unique) === 0, columns: [] };
      }
      indexes[key].columns.push(String(row.column_name));
    }

    tables[tableName.toLowerCase()] = { name: tableName, columns, indexes };
  }

  return { defaultCollation, tables };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function compareColumn(tableName: string, expected: ColumnContract, actual: ColumnContract, failures: SchemaDifference[]): void {
  const base = { table: tableName, object: expected.name, category: 'column' as const };
  if (expected.typeSignature !== actual.typeSignature) {
    failures.push({ ...base, kind: 'type', expected: expected.typeSignature, actual: actual.typeSignature });
  }
  if (expected.nullable !== actual.nullable) {
    failures.push({ ...base, kind: 'nullability', expected: String(expected.nullable), actual: String(actual.nullable) });
  }
  if (expected.defaultValue !== actual.defaultValue) {
    failures.push({ ...base, kind: 'default', expected: expected.defaultValue, actual: actual.defaultValue });
  }
  if (expected.extra !== actual.extra) {
    failures.push({ ...base, kind: 'extra', expected: expected.extra, actual: actual.extra });
  }
  if (expected.collation !== actual.collation) {
    failures.push({ ...base, kind: 'collation', expected: expected.collation, actual: actual.collation });
  }
}

function compareIndex(tableName: string, expected: IndexContract, actual: IndexContract, failures: SchemaDifference[]): void {
  const base = { table: tableName, object: expected.name, category: 'index' as const };
  if (expected.unique !== actual.unique) {
    failures.push({ ...base, kind: 'uniqueness', expected: String(expected.unique), actual: String(actual.unique) });
  }
  const expectedCols = expected.columns.map(c => c.toLowerCase()).join(',');
  const actualCols = actual.columns.map(c => c.toLowerCase()).join(',');
  if (expectedCols !== actualCols) {
    failures.push({ ...base, kind: 'columns', expected: expected.columns.join(','), actual: actual.columns.join(',') });
  }
}

export function compareSchemaContracts(expected: SchemaContract, actual: SchemaContract, options: CompareOptions = {}): ContractComparison {
  const tables = options.tables ?? CRITICAL_TABLES;
  const requiredIndexesByTable = options.requiredIndexesByTable ?? REQUIRED_INDEXES_BY_TABLE;
  const requiredColumnsByTable = options.requiredColumnsByTable ?? REQUIRED_COLUMNS_BY_TABLE;

  const failures: SchemaDifference[] = [];
  const extras: SchemaDifference[] = [];

  for (const tableName of tables) {
    const key = tableName.toLowerCase();
    const expectedTable = expected.tables[key];
    const actualTable = actual.tables[key];

    if (!expectedTable) {
      failures.push({ table: tableName, object: tableName, category: 'column', kind: 'missing', expected: 'table defined in canonical DDL', actual: null });
      continue;
    }
    if (!actualTable) {
      failures.push({ table: tableName, object: tableName, category: 'column', kind: 'missing', expected: 'table present in live schema', actual: null });
      continue;
    }

    for (const [columnKey, expectedColumn] of Object.entries(expectedTable.columns)) {
      const actualColumn = actualTable.columns[columnKey];
      if (!actualColumn) {
        failures.push({
          table: tableName,
          object: expectedColumn.name,
          category: 'column',
          kind: 'missing',
          expected: expectedColumn.typeSignature,
          actual: null
        });
        continue;
      }
      compareColumn(tableName, expectedColumn, actualColumn, failures);
    }

    for (const [columnKey, actualColumn] of Object.entries(actualTable.columns)) {
      if (!expectedTable.columns[columnKey]) {
        extras.push({ table: tableName, object: actualColumn.name, category: 'column', kind: 'missing', expected: null, actual: actualColumn.typeSignature });
      }
    }

    const requiredIndexes = requiredIndexesByTable[key] ?? [];
    for (const indexName of requiredIndexes) {
      const indexKey = indexName.toLowerCase();
      const expectedIndex = expectedTable.indexes[indexKey];
      const actualIndex = actualTable.indexes[indexKey];
      if (!expectedIndex) {
        failures.push({ table: tableName, object: indexName, category: 'index', kind: 'missing', expected: 'index defined in canonical DDL', actual: null });
        continue;
      }
      if (!actualIndex) {
        failures.push({ table: tableName, object: indexName, category: 'index', kind: 'missing', expected: expectedIndex.columns.join(','), actual: null });
        continue;
      }
      compareIndex(tableName, expectedIndex, actualIndex, failures);
    }

    const requiredSet = new Set(requiredIndexes.map(name => name.toLowerCase()));
    for (const [indexKey, actualIndex] of Object.entries(actualTable.indexes)) {
      if (!requiredSet.has(indexKey) && !expectedTable.indexes[indexKey]) {
        extras.push({ table: tableName, object: actualIndex.name, category: 'index', kind: 'missing', expected: null, actual: actualIndex.columns.join(',') });
      }
    }
  }

  // Column-level requirements on tables outside the critical set: presence only,
  // so pre-existing drift elsewhere in those tables cannot fail the gate.
  for (const [tableName, columnNames] of Object.entries(requiredColumnsByTable)) {
    const key = tableName.toLowerCase();
    if (tables.some(table => table.toLowerCase() === key)) continue; // already fully compared above
    const actualTable = actual.tables[key];
    // The table itself is optional: upload_sessions is created on demand by
    // ensureUploadSessionsTable, so a schema that has never run an upload simply
    // does not have it yet. readLiveSchemaContract returns an entry with zero
    // columns for a table that does not exist, which is how absence looks here.
    // A table that DOES exist and is missing the column is the failure.
    if (!actualTable || Object.keys(actualTable.columns).length === 0) continue;
    for (const columnName of columnNames) {
      if (actualTable.columns[columnName.toLowerCase()]) continue;
      failures.push({
        table: tableName,
        object: columnName,
        category: 'column',
        kind: 'missing',
        expected: 'column present in live schema',
        actual: null
      });
    }
  }

  return { failures, extras };
}

/** Renders failures into a single, debuggable message. */
export function formatContractFailures(failures: SchemaDifference[]): string {
  return failures
    .map(f => `[${f.table}] ${f.category} "${f.object}" ${f.kind}: expected=${JSON.stringify(f.expected)} actual=${JSON.stringify(f.actual)}`)
    .join('\n');
}
