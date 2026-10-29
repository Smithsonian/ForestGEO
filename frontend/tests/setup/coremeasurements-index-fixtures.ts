/**
 * Shared fixtures for the #560 coremeasurements index-trim integration tests.
 *
 * The expected index sets below are an independent oracle, written from section 4 of the
 * #560 design, and never derived from the SQL under test. Index state is always compared as
 * the full ordered signature list `name(col,col,...)[ UNIQUE][ INVISIBLE]`, so a failing
 * assertion prints exactly which index appeared, vanished, changed shape, lost uniqueness or
 * was hidden. docs/superpowers/notes/relay-560/plan-proof/check-proof-schemas.mjs uses the
 * same format for the plan-proof gate.
 */

import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { createTestDatabase, DEFAULT_TEST_CONFIG, loadSchema } from './local-db-setup';
import { testDbServerOptions } from './test-db-connection';
import type { SchemaQueryRow } from '@/lib/db/schema-contract';
import { LEDGER_TABLE, loadMigrationSources, type MigrationSource, type SqlExecutor } from '@/scripts/apply-schema-migrations';

export const LOCAL_DB_HOSTS = ['localhost', '127.0.0.1', '::1'] as const;
export const COREMEASUREMENTS_TABLE = 'coremeasurements';
export const MEASUREMENTS_SUMMARY_TABLE = 'measurementssummary';
export const UNIFIED_CHANGELOG_TABLE = 'unifiedchangelog';
export const TRIM_MIGRATION_ID = '2026-10-28-01-trim-coremeasurements-redundant-indexes';
export const TRIM_CONFLICT_HELPER_PROCEDURE = 'mig_2026_10_28_01_raise_contract_conflict';
export const TRIM_REFUSAL_MESSAGE_PREFIX = 'coremeasurements index trim refused, missing or reshaped:';
export const PRE_CHANGE_INDEX_COUNT = 19;
export const CTFS_DRIFT_INDEX_COUNT = 21;
const MYSQL_IDENTIFIER_MAX_LENGTH = 64;
/** information_schema.STATISTICS.IS_VISIBLE value for an invisible index. */
const INVISIBLE = 'NO';

export interface IndexDefinition {
  name: string;
  columns: readonly string[];
  unique: boolean;
}

/** The 14 coremeasurements indexes the #560 design keeps (section 4). */
export const TRIMMED_COREMEASUREMENTS_INDEXES: readonly IndexDefinition[] = [
  { name: 'PRIMARY', columns: ['CoreMeasurementID'], unique: true },
  { name: 'ux_measure_unique', columns: ['StemGUID', 'CensusID', 'MeasurementDate', 'MeasuredDBH', 'MeasuredHOM'], unique: true },
  { name: 'ux_cm_uploadbatch_rowindex', columns: ['UploadBatchID', 'SourceRowIndex'], unique: true },
  { name: 'idx_censusid', columns: ['CensusID'], unique: false },
  { name: 'ix_cm_cid_date_dbh_hom', columns: ['CensusID', 'MeasurementDate', 'MeasuredDBH', 'MeasuredHOM'], unique: false },
  { name: 'idx_cm_census_validated_stem', columns: ['CensusID', 'IsValidated', 'IsActive', 'StemGUID'], unique: false },
  { name: 'idx_cm_uploadbatch_census', columns: ['UploadBatchID', 'CensusID'], unique: false },
  { name: 'idx_cm_uploadfile_census_stem', columns: ['UploadFileID', 'CensusID', 'StemGUID'], unique: false },
  { name: 'idx_cm_uploadfile_batch_census_stem', columns: ['UploadFileID', 'UploadBatchID', 'CensusID', 'StemGUID'], unique: false },
  { name: 'idx_cm_stemguid_active', columns: ['StemGUID', 'IsActive'], unique: false },
  { name: 'idx_cm_unresolved_lookup', columns: ['StemGUID', 'CensusID', 'UploadBatchID'], unique: false },
  { name: 'idx_isvalidated', columns: ['IsValidated'], unique: false },
  { name: 'idx_measureddbh', columns: ['MeasuredDBH'], unique: false },
  { name: 'idx_measuredhom', columns: ['MeasuredHOM'], unique: false }
];

/** The five canonical indexes migration 2026-10-28-01 drops, with their pre-change columns. */
export const DROPPED_CANONICAL_INDEXES: readonly IndexDefinition[] = [
  { name: 'idx_cm_stem_cid_date_dbh_hom', columns: ['StemGUID', 'CensusID', 'MeasurementDate', 'MeasuredDBH', 'MeasuredHOM'], unique: false },
  { name: 'idx_description', columns: ['Description'], unique: false },
  { name: 'idx_measurementdate', columns: ['MeasurementDate'], unique: false },
  { name: 'idx_stemid', columns: ['StemGUID'], unique: false },
  { name: 'idx_cm_census_active', columns: ['CensusID', 'IsActive'], unique: false }
];

const CTFS_CENSUS_PLOT_INDEX: IndexDefinition = { name: 'idx_coremeasurements_census_plot', columns: ['CensusID'], unique: false };

/** The Azure drift shapes measured 2026-10-28: the canonical 19 plus two CTFS-script extras each. */
export const CTFS_DRIFT_SHAPES: ReadonlyArray<{ label: string; suffix: string; extras: readonly IndexDefinition[] }> = [
  {
    label: 'harvard',
    suffix: '_cmt_i2_h',
    extras: [CTFS_CENSUS_PLOT_INDEX, { name: 'idx_coremeasurements_census_validation', columns: ['CensusID', 'IsValidated'], unique: false }]
  },
  {
    label: 'mpala and rabi',
    suffix: '_cmt_i2_m',
    extras: [CTFS_CENSUS_PLOT_INDEX, { name: 'idx_coremeasurements_census_plot_validation', columns: ['CensusID', 'IsValidated'], unique: false }]
  }
];

export interface TrimSuccessor {
  current: IndexDefinition;
  /** Same name, different ordered columns: a check that compares names only lets this through. */
  reshaped: IndexDefinition;
}

class UnknownTrimmedIndexError extends Error {
  constructor(indexName: string) {
    super(`${indexName} is not one of TRIMMED_COREMEASUREMENTS_INDEXES`);
    this.name = 'UnknownTrimmedIndexError';
  }
}

function trimmedIndex(indexName: string): IndexDefinition {
  const index = TRIMMED_COREMEASUREMENTS_INDEXES.find(candidate => candidate.name === indexName);
  if (!index) throw new UnknownTrimmedIndexError(indexName);
  return index;
}

/** The four indexes the migration requires before it drops anything, each with one reshaped form. */
export const TRIM_SUCCESSORS: readonly TrimSuccessor[] = [
  { current: trimmedIndex('idx_censusid'), reshaped: { name: 'idx_censusid', columns: ['CensusID', 'IsActive'], unique: false } },
  {
    current: trimmedIndex('idx_cm_census_validated_stem'),
    reshaped: { name: 'idx_cm_census_validated_stem', columns: ['CensusID', 'IsValidated', 'IsActive'], unique: false }
  },
  { current: trimmedIndex('idx_cm_stemguid_active'), reshaped: { name: 'idx_cm_stemguid_active', columns: ['StemGUID'], unique: false } },
  {
    current: trimmedIndex('ux_measure_unique'),
    reshaped: { name: 'ux_measure_unique', columns: ['StemGUID', 'CensusID', 'MeasurementDate', 'MeasuredDBH'], unique: true }
  }
];

export function sortedSignatures(indexes: readonly IndexDefinition[]): string[] {
  return indexes.map(index => `${index.name}(${index.columns.join(',')})${index.unique ? ' UNIQUE' : ''}`).sort();
}

function addIndexClause(index: IndexDefinition): string {
  const columns = index.columns.map(column => `\`${column}\``).join(', ');
  return `ADD ${index.unique ? 'UNIQUE ' : ''}INDEX \`${index.name}\` (${columns})`;
}

export async function readIndexSignatures(connection: Connection, schema: string, table: string = COREMEASUREMENTS_TABLE): Promise<string[]> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT INDEX_NAME AS indexName, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS columnList,
            MAX(NON_UNIQUE) AS nonUnique, MIN(IS_VISIBLE) AS visible
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     GROUP BY INDEX_NAME`,
    [schema, table]
  );
  return rows
    .map(row => {
      const uniqueMarker = Number(row.nonUnique) === 0 ? ' UNIQUE' : '';
      const invisibleMarker = String(row.visible) === INVISIBLE ? ' INVISIBLE' : '';
      return `${String(row.indexName)}(${String(row.columnList)})${uniqueMarker}${invisibleMarker}`;
    })
    .sort();
}

/** Mutating helpers act on the connection's current database (DATABASE()), like the migration itself. */
async function presentIndexNames(connection: Connection): Promise<Set<string>> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT DISTINCT INDEX_NAME AS indexName FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [COREMEASUREMENTS_TABLE]
  );
  return new Set(rows.map(row => String(row.indexName)));
}

/** Adds, in one ALTER, every listed index the table lacks. Returns the names it added. */
export async function addMissingIndexes(connection: Connection, indexes: readonly IndexDefinition[]): Promise<string[]> {
  const present = await presentIndexNames(connection);
  const missing = indexes.filter(index => !present.has(index.name));
  if (missing.length > 0) {
    await connection.query(`ALTER TABLE \`${COREMEASUREMENTS_TABLE}\` ${missing.map(addIndexClause).join(', ')}`);
  }
  return missing.map(index => index.name);
}

export async function dropIndex(connection: Connection, indexName: string): Promise<void> {
  await connection.query(`ALTER TABLE \`${COREMEASUREMENTS_TABLE}\` DROP INDEX \`${indexName}\``);
}

/** Creates the index, or rebuilds it in one ALTER (so a foreign key never loses its last index) when the name exists. */
export async function replaceIndex(connection: Connection, index: IndexDefinition): Promise<void> {
  const present = await presentIndexNames(connection);
  const dropClause = present.has(index.name) ? `DROP INDEX \`${index.name}\`, ` : '';
  await connection.query(`ALTER TABLE \`${COREMEASUREMENTS_TABLE}\` ${dropClause}${addIndexClause(index)}`);
}

export async function setIndexVisibility(connection: Connection, indexName: string, visible: boolean): Promise<void> {
  await connection.query(`ALTER TABLE \`${COREMEASUREMENTS_TABLE}\` ALTER INDEX \`${indexName}\` ${visible ? 'VISIBLE' : 'INVISIBLE'}`);
}

export async function routineExists(connection: Connection, schema: string, routineName: string): Promise<boolean> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS routineCount FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ?`,
    [schema, routineName]
  );
  return Number(rows[0].routineCount) > 0;
}

export async function showCreateTable(connection: Connection, table: string = COREMEASUREMENTS_TABLE): Promise<string> {
  const [rows] = await connection.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${table}\``);
  return String(rows[0]['Create Table']);
}

export function connectionExecutor(connection: Connection): SqlExecutor {
  return async (sql: string, params?: unknown[]): Promise<SchemaQueryRow[]> => {
    const [rows] = await connection.query(sql, params ?? []);
    return Array.isArray(rows) ? (rows as SchemaQueryRow[]) : [];
  };
}

export interface LedgerEntry {
  status: string;
  checksum: string;
  appliedAt: string;
  errorSummary: string | null;
}

export async function readLedgerEntry(connection: Connection, schema: string, migrationID: string): Promise<LedgerEntry | null> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT Status AS status, Checksum AS checksum, CAST(AppliedAt AS CHAR) AS appliedAt, ErrorSummary AS errorSummary
     FROM \`${schema}\`.\`${LEDGER_TABLE}\` WHERE MigrationID = ?`,
    [migrationID]
  );
  if (rows.length === 0) return null;
  return {
    status: String(rows[0].status),
    checksum: String(rows[0].checksum),
    appliedAt: String(rows[0].appliedAt),
    errorSummary: rows[0].errorSummary === null ? null : String(rows[0].errorSummary)
  };
}

export class MigrationNotInManifestError extends Error {
  constructor(migrationID: string) {
    super(`Migration ${migrationID} is not listed in db/migrations/manifest.ts (or its file is missing).`);
    this.name = 'MigrationNotInManifestError';
  }
}

export function requireTrimMigrationSource(): MigrationSource {
  const source = loadMigrationSources().find(candidate => candidate.id === TRIM_MIGRATION_ID);
  if (!source) throw new MigrationNotInManifestError(TRIM_MIGRATION_ID);
  return source;
}

class ThrowawaySchemaNameTooLongError extends Error {
  constructor(schema: string) {
    super(`Throwaway schema name ${schema} exceeds MySQL's ${MYSQL_IDENTIFIER_MAX_LENGTH}-character identifier limit; shorten the suffix.`);
    this.name = 'ThrowawaySchemaNameTooLongError';
  }
}

export async function dropThrowawaySchema(connection: Connection, schema: string): Promise<void> {
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${schema}\``);
  } finally {
    await connection.end();
  }
}

/**
 * A fresh schema holding only the canonical DDL (no procedures, no seed), named from this
 * checkout's harness schema so worktrees never collide. If loadSchema fails, the half-built
 * schema is dropped and the connection closed before rethrowing.
 */
export async function provisionCanonicalSchema(suffix: string): Promise<{ schema: string; connection: Connection }> {
  const schema = `${DEFAULT_TEST_CONFIG.database}${suffix}`;
  if (schema.length > MYSQL_IDENTIFIER_MAX_LENGTH) throw new ThrowawaySchemaNameTooLongError(schema);
  const connection = await createTestDatabase({ ...DEFAULT_TEST_CONFIG, database: schema });
  try {
    await loadSchema(connection);
  } catch (error) {
    await dropThrowawaySchema(connection, schema);
    throw error;
  }
  return { schema, connection };
}

/** A second, independent session on the schema (its own lock waits, its own metadata locks). */
export async function openSessionOn(schema: string): Promise<Connection> {
  return mysql.createConnection({ ...testDbServerOptions(), database: schema, multipleStatements: true });
}

export function mysqlErrno(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'errno' in error && typeof (error as { errno: unknown }).errno === 'number') {
    return (error as { errno: number }).errno;
  }
  return null;
}

export function mysqlSqlState(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'sqlState' in error && typeof (error as { sqlState: unknown }).sqlState === 'string') {
    return (error as { sqlState: string }).sqlState;
  }
  return null;
}

/** One way to make a successor unusable; the trim (manifest or twin) must refuse and name it. */
export interface SuccessorRefusalCase {
  label: string;
  /** Short and unique: becomes part of a throwaway schema name. */
  caseTag: string;
  refusedName: string;
  regress: (connection: Connection) => Promise<void>;
  restore: (connection: Connection) => Promise<void>;
}

/** Not FK-critical (idx_censusid and ix_cm_cid_date_dbh_hom still lead with CensusID), so MySQL lets it go invisible. */
const INVISIBLE_CASE_SUCCESSOR = 'idx_cm_census_validated_stem';
const NON_UNIQUE_CASE_SUCCESSOR = 'ux_measure_unique';

/** Shared by I4 (manifest migration) and I8 (twin 62): 4 successors x removed/reshaped, plus invisible and non-unique. */
export const SUCCESSOR_REFUSAL_CASES: readonly SuccessorRefusalCase[] = [
  ...TRIM_SUCCESSORS.flatMap((successor, successorIndex) => [
    {
      label: `${successor.current.name} removed`,
      caseTag: `${successorIndex}r`,
      refusedName: successor.current.name,
      regress: (connection: Connection) => dropIndex(connection, successor.current.name),
      restore: (connection: Connection) => replaceIndex(connection, successor.current)
    },
    {
      label: `${successor.current.name} reshaped to (${successor.reshaped.columns.join(', ')})`,
      caseTag: `${successorIndex}s`,
      refusedName: successor.current.name,
      regress: (connection: Connection) => replaceIndex(connection, successor.reshaped),
      restore: (connection: Connection) => replaceIndex(connection, successor.current)
    }
  ]),
  {
    label: `${INVISIBLE_CASE_SUCCESSOR} present but INVISIBLE`,
    caseTag: 'iv',
    refusedName: INVISIBLE_CASE_SUCCESSOR,
    regress: (connection: Connection) => setIndexVisibility(connection, INVISIBLE_CASE_SUCCESSOR, false),
    restore: (connection: Connection) => setIndexVisibility(connection, INVISIBLE_CASE_SUCCESSOR, true)
  },
  {
    label: `${NON_UNIQUE_CASE_SUCCESSOR} with its columns but not UNIQUE`,
    caseTag: 'nu',
    refusedName: NON_UNIQUE_CASE_SUCCESSOR,
    regress: (connection: Connection) => replaceIndex(connection, { ...trimmedIndex(NON_UNIQUE_CASE_SUCCESSOR), unique: false }),
    restore: (connection: Connection) => replaceIndex(connection, trimmedIndex(NON_UNIQUE_CASE_SUCCESSOR))
  }
];
