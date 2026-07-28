/**
 * Apply CATALOG migrations — DDL for the shared `catalog` database.
 *
 * Sibling of apply-schema-migrations.ts, deliberately not the same runner:
 *   - site migrations run once per forestgeo_* schema, ledger `schema_migrations`
 *   - catalog migrations run ONCE per server, ledger `catalog.catalog_migrations`
 *
 * Deploy ordering: run this BEFORE the per-site schema gate and before the app
 * deploy, so code that reads catalog.background_jobs can never ship ahead of the
 * tables it needs.
 *
 * Sequence:
 *   1. server-level connection (no database selected) -> ensure `catalog` exists
 *   2. reconnect scoped to `catalog`
 *   3. one GLOBAL advisory lock (not per-schema) so concurrent deploys serialize
 *   4. read-only contract preflight: classify each table absent | current | stale
 *   5. apply pending manifest migrations in order, recording checksum + status
 *
 * Fail-closed rule: `--apply` refuses to run while any table is STALE. It never
 * drops anything. A stale-but-provably-empty unreleased table can be replaced
 * only through the explicit operator-only --remediate-empty-unreleased step,
 * which records the preflight and drops in foreign-key order. Any nonzero row
 * count blocks the deploy and requires a preservation migration instead.
 *
 * Flags:
 *   --check                        report ledger + contract state, write nothing
 *   --apply                        apply pending migrations (fails closed on stale)
 *   --remediate-empty-unreleased   operator-only: drop CONFIRMED-EMPTY stale tables
 *   --azure                        target the Azure server (default: local TEST_DB_*)
 *
 * Usage:
 *   npm run apply-catalog-migrations -- --check
 *   npm run apply-catalog-migrations -- --apply
 *   npm run apply-catalog-migrations -- --azure --check
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CATALOG_DATABASE_NAME, CATALOG_MIGRATION_MANIFEST, type CatalogMigrationManifestEntry } from '../db/migrations/catalog-manifest';
import {
  assertExpectedHost,
  createSchemaCliConnection,
  executorFor,
  resolveConnectionSettings,
  type ConnectionSettings,
  type SqlExecutor
} from './lib/schema-cli';
import {
  DDL_LOCK_WAIT_TIMEOUT_SECONDS,
  MIGRATION_LOCK_TIMEOUT_SECONDS,
  MIGRATION_STATUS,
  MigrationFileMissingError,
  MigrationLockUnavailableError,
  TamperedMigrationError,
  defaultMigrationsDir,
  sha256Hex,
  type LedgerRow,
  type MigrationSource,
  type MigrationStatus
} from './apply-schema-migrations';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CATALOG_LEDGER_TABLE = 'catalog_migrations';

/**
 * One global lock for the whole catalog database. The site runner locks per
 * schema because those migrations are independent; catalog DDL is shared, so two
 * concurrent deploys must serialize on a single name.
 */
export const CATALOG_MIGRATION_LOCK_NAME = 'fg:migrate:catalog';

/** Tables this migration set owns, in foreign-key-safe DROP order (children first). */
export const CATALOG_BACKGROUND_JOB_TABLES = ['background_job_events', 'background_job_files', 'background_jobs'] as const;

export type CatalogTableName = (typeof CATALOG_BACKGROUND_JOB_TABLES)[number];

/**
 * Minimum shape each table must have to be considered CURRENT. Only
 * app-load-bearing structure is listed: every column the repository reads or
 * writes, the ENUM domains whose values changed between the unreleased
 * iterations, and the legacy columns whose presence proves a stale bootstrap.
 */
interface CatalogTableContract {
  requiredColumns: readonly string[];
  /** Columns that only an older, incompatible bootstrap would have created. */
  forbiddenColumns: readonly string[];
  /** Exact ENUM value sets, keyed by column name. */
  enumValues: Readonly<Record<string, readonly string[]>>;
}

export const CATALOG_TABLE_CONTRACTS: Readonly<Record<CatalogTableName, CatalogTableContract>> = {
  background_jobs: {
    requiredColumns: [
      'JobID',
      'JobType',
      'Status',
      'Phase',
      'SchemaName',
      'PlotID',
      'CensusID',
      'UploadMode',
      'SourceFormat',
      'FormType',
      'CreatedBy',
      'IdempotencyKey',
      'PercentComplete',
      'TotalFiles',
      'TotalRows',
      'ProcessedRows',
      'FailedRows',
      'RetryCount',
      'MaxRetries',
      'NextAttemptAt',
      'LastError',
      'WorkerID',
      'WorkerHeartbeatAt',
      'Payload',
      'CreatedAt',
      'UpdatedAt',
      'StartedAt',
      'FinishedAt'
    ],
    // The Service Bus iteration tracked the last message instead of a worker lease.
    forbiddenColumns: ['LastMessageID'],
    enumValues: {
      JobType: ['upload_validation'],
      Status: ['queued', 'running', 'cancel_requested', 'waiting_retry', 'completed', 'failed', 'cancelled'],
      Phase: ['queued', 'staging', 'ingestion', 'collapsing', 'validation', 'refreshing_views', 'completed', 'failed', 'cancelled']
    }
  },
  background_job_files: {
    requiredColumns: [
      'JobFileID',
      'JobID',
      'FileName',
      'BlobContainer',
      'BlobName',
      'ContentType',
      'ByteSize',
      'ChecksumSHA256',
      'SourceFormat',
      'FormType',
      'BatchID',
      'ExpectedRows',
      'ProcessedRows',
      'FailedRows',
      'Status',
      'ErrorMessage',
      'CreatedAt',
      'UpdatedAt'
    ],
    forbiddenColumns: [],
    enumValues: {
      Status: ['pending', 'staged', 'processed', 'failed', 'skipped']
    }
  },
  background_job_events: {
    requiredColumns: ['EventID', 'JobID', 'EventType', 'Message', 'Details', 'CreatedAt'],
    forbiddenColumns: [],
    enumValues: {}
  }
} as const;

const CLI_FLAG = {
  CHECK: '--check',
  APPLY: '--apply',
  REMEDIATE: '--remediate-empty-unreleased',
  AZURE: '--azure'
} as const;

const ERROR_SUMMARY_MAX_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class StaleCatalogSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleCatalogSchemaError';
  }
}

export class CatalogTablesNotEmptyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogTablesNotEmptyError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Manifest loading (mirrors the site runner; separate manifest + dir root)
// ---------------------------------------------------------------------------

export function loadCatalogMigrationSources(
  manifest: readonly CatalogMigrationManifestEntry[] = CATALOG_MIGRATION_MANIFEST,
  migrationsDir: string = defaultMigrationsDir()
): MigrationSource[] {
  return manifest.map(entry => {
    const filePath = path.join(migrationsDir, entry.file);
    if (!fs.existsSync(filePath)) {
      throw new MigrationFileMissingError(`Catalog manifest migration file not found: ${filePath} (id ${entry.id})`);
    }
    const contents = fs.readFileSync(filePath, 'utf-8');
    return { id: entry.id, file: entry.file, contents, checksum: sha256Hex(contents) };
  });
}

/**
 * Same selection semantics as the site runner: unknown -> pending, failed ->
 * pending (retry), applied-with-changed-checksum -> tampered (throw).
 */
export function selectPendingCatalogMigrations(sources: MigrationSource[], ledgerRows: LedgerRow[]): MigrationSource[] {
  const byId = new Map(ledgerRows.map(row => [row.MigrationID, row]));
  const pending: MigrationSource[] = [];

  for (const source of sources) {
    const row = byId.get(source.id);
    if (!row) {
      pending.push(source);
      continue;
    }
    if (row.Status === MIGRATION_STATUS.APPLIED) {
      if (row.Checksum !== source.checksum) {
        throw new TamperedMigrationError(
          `Catalog migration "${source.id}" is recorded applied with checksum ${row.Checksum} but the current file hashes to ${source.checksum}. ` +
            `A migration already applied to a live database must never be edited; add a new catalog migration instead.`
        );
      }
      continue;
    }
    pending.push(source);
  }

  return pending;
}

// ---------------------------------------------------------------------------
// Contract preflight (read-only)
// ---------------------------------------------------------------------------

export type CatalogTableState = 'absent' | 'current' | 'stale';

export interface CatalogTablePreflight {
  table: CatalogTableName;
  state: CatalogTableState;
  /** Human-readable reasons a table was classified stale. */
  differences: string[];
  /** Row count; null when the table is absent (never counted). */
  rowCount: number | null;
}

export interface CatalogPreflight {
  tables: CatalogTablePreflight[];
  hasStale: boolean;
  staleRowTotal: number;
}

export interface LiveColumn {
  name: string;
  columnType: string;
}

/** Parses `enum('a','b')` into ['a','b']; returns null for non-ENUM types. */
export function parseEnumValues(columnType: string): string[] | null {
  const match = /^enum\((.*)\)$/i.exec(columnType.trim());
  if (!match) return null;
  return match[1]
    .split(',')
    .map(value => value.trim().replace(/^'(.*)'$/, '$1'))
    .filter(value => value.length > 0);
}

/** Pure classifier — no DB access, so every branch is unit-testable. */
export function classifyCatalogTable(table: CatalogTableName, columns: LiveColumn[] | null): CatalogTablePreflight {
  if (columns === null || columns.length === 0) {
    return { table, state: 'absent', differences: [], rowCount: null };
  }

  const contract = CATALOG_TABLE_CONTRACTS[table];
  const byName = new Map(columns.map(column => [column.name.toLowerCase(), column]));
  const differences: string[] = [];

  for (const required of contract.requiredColumns) {
    if (!byName.has(required.toLowerCase())) differences.push(`missing column ${required}`);
  }
  for (const forbidden of contract.forbiddenColumns) {
    if (byName.has(forbidden.toLowerCase())) differences.push(`legacy column ${forbidden} present`);
  }
  for (const [columnName, expectedValues] of Object.entries(contract.enumValues)) {
    const column = byName.get(columnName.toLowerCase());
    if (!column) continue; // already reported as missing
    const actualValues = parseEnumValues(column.columnType);
    if (actualValues === null) {
      differences.push(`column ${columnName} is ${column.columnType}, expected ENUM`);
      continue;
    }
    const missing = expectedValues.filter(value => !actualValues.includes(value));
    const unexpected = actualValues.filter(value => !expectedValues.includes(value));
    if (missing.length > 0 || unexpected.length > 0) {
      differences.push(`column ${columnName} ENUM mismatch (missing: [${missing.join(', ')}], unexpected: [${unexpected.join(', ')}])`);
    }
  }

  return { table, state: differences.length === 0 ? 'current' : 'stale', differences, rowCount: null };
}

/** Reads live column metadata + row counts and classifies every owned table. */
export async function runCatalogPreflight(exec: SqlExecutor, database: string = CATALOG_DATABASE_NAME): Promise<CatalogPreflight> {
  const tables: CatalogTablePreflight[] = [];

  for (const table of CATALOG_BACKGROUND_JOB_TABLES) {
    const columnRows = await exec(
      `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS columnType FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [database, table]
    );
    const columns: LiveColumn[] = columnRows.map(row => ({ name: String(row.name), columnType: String(row.columnType) }));
    const classified = classifyCatalogTable(table, columns.length === 0 ? null : columns);

    if (classified.state !== 'absent') {
      const countRows = await exec(`SELECT COUNT(*) AS rowCount FROM \`${database}\`.\`${table}\``);
      classified.rowCount = Number(countRows[0]?.rowCount ?? 0);
    }
    tables.push(classified);
  }

  const staleTables = tables.filter(entry => entry.state === 'stale');
  return {
    tables,
    hasStale: staleTables.length > 0,
    staleRowTotal: staleTables.reduce((sum, entry) => sum + (entry.rowCount ?? 0), 0)
  };
}

export function formatPreflight(preflight: CatalogPreflight): string[] {
  return preflight.tables.map(entry => {
    const rows = entry.rowCount === null ? 'n/a' : String(entry.rowCount);
    const detail = entry.differences.length > 0 ? ` — ${entry.differences.join('; ')}` : '';
    return `  ${entry.table.padEnd(22)} ${entry.state.toUpperCase().padEnd(8)} rows=${rows}${detail}`;
  });
}

// ---------------------------------------------------------------------------
// Ledger + lock (catalog-scoped)
// ---------------------------------------------------------------------------

/**
 * Ledger identifiers are FULLY QUALIFIED. The runner's own connection is scoped
 * to `catalog`, but test harnesses and any future caller may hand in a
 * server-level connection with no database selected, where unqualified DDL fails
 * with "No database selected".
 */
export function catalogLedgerIdentifier(database: string = CATALOG_DATABASE_NAME): string {
  return `\`${database}\`.\`${CATALOG_LEDGER_TABLE}\``;
}

export async function ensureCatalogLedgerTable(exec: SqlExecutor, database: string = CATALOG_DATABASE_NAME): Promise<void> {
  await exec(
    `CREATE TABLE IF NOT EXISTS ${catalogLedgerIdentifier(database)} (
       MigrationID  VARCHAR(191) PRIMARY KEY,
       Checksum     CHAR(64) NOT NULL,
       AppliedAt    DATETIME NOT NULL,
       Status       ENUM('applied','failed') NOT NULL,
       ErrorSummary TEXT NULL
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
  );
}

export async function readCatalogLedger(exec: SqlExecutor, database: string = CATALOG_DATABASE_NAME): Promise<LedgerRow[]> {
  const presentRows = await exec(`SELECT COUNT(*) AS present FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [
    database,
    CATALOG_LEDGER_TABLE
  ]);
  if (Number(presentRows[0]?.present ?? 0) === 0) return [];

  const rows = await exec(`SELECT MigrationID, Checksum, Status FROM ${catalogLedgerIdentifier(database)}`);
  return rows.map(row => ({ MigrationID: String(row.MigrationID), Checksum: String(row.Checksum), Status: String(row.Status) }));
}

export async function recordCatalogLedgerEntry(
  exec: SqlExecutor,
  id: string,
  checksum: string,
  status: MigrationStatus,
  errorSummary: string | null,
  database: string = CATALOG_DATABASE_NAME
): Promise<void> {
  await exec(
    `INSERT INTO ${catalogLedgerIdentifier(database)} (MigrationID, Checksum, AppliedAt, Status, ErrorSummary)
     VALUES (?, ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE Checksum = VALUES(Checksum), AppliedAt = NOW(), Status = VALUES(Status), ErrorSummary = VALUES(ErrorSummary)`,
    [id, checksum, status, errorSummary]
  );
}

export async function acquireCatalogMigrationLock(exec: SqlExecutor): Promise<void> {
  const rows = await exec(`SELECT GET_LOCK(?, ?) AS acquired`, [CATALOG_MIGRATION_LOCK_NAME, MIGRATION_LOCK_TIMEOUT_SECONDS]);
  if (Number(rows[0]?.acquired ?? 0) !== 1) {
    throw new MigrationLockUnavailableError(
      `Could not acquire the global catalog migration lock "${CATALOG_MIGRATION_LOCK_NAME}" within ${MIGRATION_LOCK_TIMEOUT_SECONDS} seconds. ` +
        `Another deploy is probably applying catalog migrations.`
    );
  }
}

export async function releaseCatalogMigrationLock(exec: SqlExecutor): Promise<void> {
  const rows = await exec(`SELECT RELEASE_LOCK(?) AS released`, [CATALOG_MIGRATION_LOCK_NAME]);
  if (Number(rows[0]?.released ?? 0) !== 1) {
    throw new MigrationLockUnavailableError(`Catalog migration lock "${CATALOG_MIGRATION_LOCK_NAME}" was not owned when release was attempted.`);
  }
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export interface CatalogApplyResult {
  pendingBefore: string[];
  appliedNow: string[];
  failed: { id: string; error: string } | null;
}

/**
 * Applies pending catalog migrations under the global lock.
 *
 * Refuses to touch anything while a table is STALE: CREATE TABLE IF NOT EXISTS
 * would silently accept the wrong shape and the app would fail at runtime
 * instead of at deploy time.
 */
export async function applyPendingCatalogMigrations(exec: SqlExecutor, sources: MigrationSource[], preflight: CatalogPreflight): Promise<CatalogApplyResult> {
  if (preflight.hasStale) {
    const detail = preflight.tables
      .filter(entry => entry.state === 'stale')
      .map(entry => `${entry.table} (rows=${entry.rowCount ?? 0}): ${entry.differences.join('; ')}`)
      .join(' | ');
    throw new StaleCatalogSchemaError(
      `Refusing to apply catalog migrations: incompatible existing table(s) detected. ${detail}. ` +
        `This gate never drops tables. If these are confirmed-empty unreleased tables, re-run with ` +
        `${CLI_FLAG.REMEDIATE} after recording this preflight; any nonzero row count requires a preservation migration instead.`
    );
  }

  await acquireCatalogMigrationLock(exec);
  try {
    await exec(`SET SESSION lock_wait_timeout = ${DDL_LOCK_WAIT_TIMEOUT_SECONDS}`);
    await exec(`SET SESSION innodb_lock_wait_timeout = ${DDL_LOCK_WAIT_TIMEOUT_SECONDS}`);
    await ensureCatalogLedgerTable(exec);

    const ledger = await readCatalogLedger(exec);
    const pending = selectPendingCatalogMigrations(sources, ledger);
    const pendingBefore = pending.map(source => source.id);
    const appliedNow: string[] = [];

    for (const source of pending) {
      try {
        await exec(source.contents);
        await recordCatalogLedgerEntry(exec, source.id, source.checksum, MIGRATION_STATUS.APPLIED, null);
        appliedNow.push(source.id);
      } catch (error) {
        const summary = errorMessage(error).slice(0, ERROR_SUMMARY_MAX_LENGTH);
        await recordCatalogLedgerEntry(exec, source.id, source.checksum, MIGRATION_STATUS.FAILED, summary).catch(() => undefined);
        return { pendingBefore, appliedNow, failed: { id: source.id, error: errorMessage(error) } };
      }
    }

    return { pendingBefore, appliedNow, failed: null };
  } finally {
    await releaseCatalogMigrationLock(exec);
  }
}

/**
 * Operator-only remediation for stale UNRELEASED tables that are provably empty.
 * Never reachable from --apply, and never from CI: a human runs it after reading
 * the recorded preflight. Any row in any owned table aborts.
 */
export async function remediateEmptyUnreleasedCatalogTables(
  exec: SqlExecutor,
  preflight: CatalogPreflight,
  database: string = CATALOG_DATABASE_NAME
): Promise<CatalogTableName[]> {
  const nonEmpty = preflight.tables.filter(entry => (entry.rowCount ?? 0) > 0);
  if (nonEmpty.length > 0) {
    throw new CatalogTablesNotEmptyError(
      `Refusing to drop catalog tables that contain data: ${nonEmpty.map(entry => `${entry.table}=${entry.rowCount}`).join(', ')}. ` +
        `Write a preservation migration instead.`
    );
  }
  if (!preflight.hasStale) return [];

  const dropped: CatalogTableName[] = [];
  // Children first so the foreign keys never block the parent drop.
  for (const table of CATALOG_BACKGROUND_JOB_TABLES) {
    await exec(`DROP TABLE IF EXISTS \`${database}\`.\`${table}\``);
    dropped.push(table);
  }
  return dropped;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export type CatalogRunnerMode = 'check' | 'apply' | 'remediate';

export interface CatalogRunnerArgs {
  mode: CatalogRunnerMode;
  azure: boolean;
}

export function parseCatalogRunnerArgs(argv: string[]): CatalogRunnerArgs {
  let mode: CatalogRunnerMode | null = null;
  let azure = false;

  for (const arg of argv) {
    switch (arg) {
      case CLI_FLAG.CHECK:
        mode = 'check';
        break;
      case CLI_FLAG.APPLY:
        mode = 'apply';
        break;
      case CLI_FLAG.REMEDIATE:
        mode = 'remediate';
        break;
      case CLI_FLAG.AZURE:
        azure = true;
        break;
      default:
        throw new Error(`Unknown argument "${arg}". Supported: ${Object.values(CLI_FLAG).join(', ')}.`);
    }
  }

  if (mode === null) {
    throw new Error(`One of ${CLI_FLAG.CHECK}, ${CLI_FLAG.APPLY} or ${CLI_FLAG.REMEDIATE} is required.`);
  }
  return { mode, azure };
}

/** Server-level connection ensures the shared database exists before scoping to it. */
export async function ensureCatalogDatabase(settings: ConnectionSettings): Promise<void> {
  const server = await createSchemaCliConnection(settings, { multipleStatements: false });
  try {
    await server.query(`CREATE DATABASE IF NOT EXISTS \`${CATALOG_DATABASE_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  } finally {
    await server.end();
  }
}

async function runCli(argv: string[]): Promise<number> {
  const args = parseCatalogRunnerArgs(argv);
  const settings = resolveConnectionSettings(args.azure);
  assertExpectedHost(settings.host, settings.allowedHosts);

  const sources = loadCatalogMigrationSources();
  console.log(`Mode: ${args.mode.toUpperCase()} | Database: ${CATALOG_DATABASE_NAME} | Host: ${settings.host}`);
  console.log(`Catalog manifest migrations: ${sources.map(source => source.id).join(', ')}\n`);

  await ensureCatalogDatabase(settings);

  const connection = await createSchemaCliConnection(settings, { database: CATALOG_DATABASE_NAME, multipleStatements: true });
  const exec = executorFor(connection);

  try {
    const preflight = await runCatalogPreflight(exec);
    console.log('Contract preflight:');
    for (const line of formatPreflight(preflight)) console.log(line);
    console.log();

    if (args.mode === 'remediate') {
      const dropped = await remediateEmptyUnreleasedCatalogTables(exec, preflight);
      console.log(dropped.length === 0 ? 'Nothing to remediate (no stale tables).' : `Dropped confirmed-empty stale tables: ${dropped.join(', ')}`);
      console.log(`Re-run ${CLI_FLAG.CHECK} to confirm, then ${CLI_FLAG.APPLY}.`);
      return 0;
    }

    const ledger = await readCatalogLedger(exec);
    const pending = selectPendingCatalogMigrations(sources, ledger);

    if (args.mode === 'check') {
      console.log(`pending: ${pending.length === 0 ? '(none)' : pending.map(source => source.id).join(', ')}`);
      if (preflight.hasStale) {
        console.error(`STALE catalog tables present; --apply will refuse until they are remediated.`);
        return 1;
      }
      return pending.length === 0 ? 0 : 1;
    }

    const result = await applyPendingCatalogMigrations(exec, sources, preflight);
    console.log(`applied: ${result.appliedNow.length === 0 ? '(none pending)' : result.appliedNow.join(', ')}`);
    if (result.failed) {
      console.error(`CATALOG MIGRATION FAILED  ${result.failed.id}: ${result.failed.error}`);
      return 1;
    }

    const verifyPreflight = await runCatalogPreflight(exec);
    console.log('Post-apply preflight:');
    for (const line of formatPreflight(verifyPreflight)) console.log(line);
    const allCurrent = verifyPreflight.tables.every(entry => entry.state === 'current');
    if (!allCurrent) {
      console.error('Post-apply verification failed: not every catalog table is CURRENT.');
      return 1;
    }
    return 0;
  } finally {
    await connection.end();
  }
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  runCli(process.argv.slice(2))
    .then(code => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(`\nFatal: ${errorMessage(error)}`);
      process.exitCode = 1;
    });
}
