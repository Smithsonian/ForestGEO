/**
 * Apply schema-contract-repair migrations to ForestGEO schemas.
 *
 * This is the engine module for the schema migrate + verify pipeline. It owns:
 *   - the per-schema `schema_migrations` ledger (create / read / record);
 *   - the ordered manifest -> pending-selection logic (with tamper detection);
 *   - the reviewed-additive migration apply loop;
 *   - a contract audit (built on the Task 2 schema-contract module) used both here
 *     as a post-migration gate and by the read-only check-schema-contract CLI.
 *
 * Deploy ordering: run this (--all-sites --apply) and the contract verify BEFORE
 * deploying app code / stored procedures that depend on the new columns, so a
 * failed migrate or verify prevents the app deploy.
 *
 * Flags:
 *   --check                 list pending migrations + contract state, write nothing
 *   --apply                 apply pending migrations, then verify the contract
 *   --schema <name>         operate on ONE schema using LOCAL test credentials
 *   --all-sites             enumerate every forestgeo_* schema on the Azure server
 *
 * Safety: refuses to run against an unexpected DB host, and (under --all-sites)
 * refuses a "zero schemas discovered" false green.
 *
 * Usage:
 *   npx tsx scripts/apply-schema-migrations.ts --all-sites --check
 *   npx tsx scripts/apply-schema-migrations.ts --all-sites --apply
 *   npx tsx scripts/apply-schema-migrations.ts --schema forestgeo_test_default --apply
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  loadCanonicalSchemaContract,
  readLiveSchemaContract,
  compareSchemaContracts,
  CRITICAL_TABLES,
  TARGET_TEXT_COLLATION,
  type SchemaDifference
} from '@/lib/db/schema-contract';
import { SCHEMA_MIGRATION_MANIFEST, type MigrationManifestEntry } from '../db/migrations/manifest';
import {
  SITE_SCHEMA_LIKE,
  assertExpectedHost,
  createSchemaCliConnection,
  discoverSiteSchemas,
  executorFor,
  resolveConnectionSettings,
  type SqlExecutor
} from './lib/schema-cli';

// Re-exported so the integration test and audit CLI can keep a single import site.
export type { SqlExecutor } from './lib/schema-cli';

// ---------------------------------------------------------------------------
// Constants (no magic strings)
// ---------------------------------------------------------------------------

export const LEDGER_TABLE = 'schema_migrations';
export const MIGRATION_LOCK_TIMEOUT_SECONDS = 30;

export const MIGRATION_STATUS = {
  APPLIED: 'applied',
  FAILED: 'failed'
} as const;

export type MigrationStatus = (typeof MIGRATION_STATUS)[keyof typeof MIGRATION_STATUS];

/** Ingestion procedures whose presence is part of the write contract. */
export const REQUIRED_INGESTION_PROCEDURES = ['bulkingestionprocess'] as const;

/** Text columns allowed to diverge from the target collation (empty today). */
export const EXEMPT_TEXT_COLLATION_COLUMNS = new Set<string>();

/** ErrorSummary is TEXT; keep recorded failure summaries bounded. */
const ERROR_SUMMARY_MAX_LENGTH = 2000;

const CLI_FLAG = {
  CHECK: '--check',
  APPLY: '--apply',
  SCHEMA: '--schema',
  ALL_SITES: '--all-sites'
} as const;

// ---------------------------------------------------------------------------
// Types + error classes
// ---------------------------------------------------------------------------

export interface MigrationSource {
  id: string;
  file: string;
  contents: string;
  checksum: string;
}

export interface LedgerRow {
  MigrationID: string;
  Checksum: string;
  Status: string;
}

export interface ApplyResult {
  schema: string;
  pendingBefore: string[];
  appliedNow: string[];
  failed: { id: string; error: string } | null;
}

export interface ContractAudit {
  schema: string;
  contractFailures: SchemaDifference[];
  contractExtras: SchemaDifference[];
  collationViolations: string[];
  missingProcedures: string[];
  pendingMigrationIds: string[];
  ok: boolean;
}

export class TamperedMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TamperedMigrationError';
  }
}

export class NoSiteSchemasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoSiteSchemasError';
  }
}

export class MigrationFileMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationFileMissingError';
  }
}

export class MigrationLockUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationLockUnavailableError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Pure primitives (unit-tested without a DB)
// ---------------------------------------------------------------------------

export function sha256Hex(contents: string): string {
  return crypto.createHash('sha256').update(contents, 'utf8').digest('hex');
}

export function defaultMigrationsDir(): string {
  return path.join(process.cwd(), 'db', 'migrations');
}

/**
 * Reads every manifest-listed migration file and computes its checksum.
 * Throws MigrationFileMissingError (rather than silently skipping) if a listed
 * file is absent — a manifest that points at nothing must fail loudly.
 */
export function loadMigrationSources(
  manifest: readonly MigrationManifestEntry[] = SCHEMA_MIGRATION_MANIFEST,
  migrationsDir: string = defaultMigrationsDir()
): MigrationSource[] {
  return manifest.map(entry => {
    const filePath = path.join(migrationsDir, entry.file);
    if (!fs.existsSync(filePath)) {
      throw new MigrationFileMissingError(`Manifest migration file not found: ${filePath} (id ${entry.id})`);
    }
    const contents = fs.readFileSync(filePath, 'utf-8');
    return { id: entry.id, file: entry.file, contents, checksum: sha256Hex(contents) };
  });
}

/**
 * Given the manifest sources and a ledger snapshot, returns the migrations that
 * still need to run, in manifest order. A `failed` ledger row is re-selected as
 * pending (retry). An `applied` row whose stored checksum no longer matches the
 * current file is a tampered migration and throws — a recorded-applied migration
 * must never change on disk.
 */
export function selectPendingMigrations(sources: MigrationSource[], ledgerRows: LedgerRow[]): MigrationSource[] {
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
          `Migration "${source.id}" is recorded applied with checksum ${row.Checksum} but the current file hashes to ${source.checksum}. ` +
            `A migration already applied to a live schema must never be edited; create a new migration instead.`
        );
      }
      continue;
    }
    pending.push(source);
  }

  return pending;
}

/** Refuses the "zero schemas checked" false green. */
export function assertSiteSchemasDiscovered(schemas: string[]): void {
  if (schemas.length === 0) {
    throw new NoSiteSchemasError(
      `No site schemas matched "${SITE_SCHEMA_LIKE}". Refusing to report success against zero schemas ` +
        `(a discovery failure must never read as "nothing to migrate").`
    );
  }
}

// ---------------------------------------------------------------------------
// Ledger + apply (effectful; exec is injectable so tests use a mock)
// ---------------------------------------------------------------------------

export async function ensureLedgerTable(exec: SqlExecutor): Promise<void> {
  await exec(
    `CREATE TABLE IF NOT EXISTS \`${LEDGER_TABLE}\` (
       MigrationID  VARCHAR(191) PRIMARY KEY,
       Checksum     CHAR(64) NOT NULL,
       AppliedAt    DATETIME NOT NULL,
       Status       ENUM('applied','failed') NOT NULL,
       ErrorSummary TEXT NULL
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
  );
}

async function ledgerTableExists(exec: SqlExecutor, schema: string): Promise<boolean> {
  const rows = await exec(`SELECT COUNT(*) AS present FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [schema, LEDGER_TABLE]);
  return Number(rows[0]?.present ?? 0) > 0;
}

/** Reads the ledger, tolerating a not-yet-created ledger table (returns []). */
export async function readLedger(exec: SqlExecutor, schema: string): Promise<LedgerRow[]> {
  if (!(await ledgerTableExists(exec, schema))) return [];
  const rows = await exec(`SELECT MigrationID, Checksum, Status FROM \`${LEDGER_TABLE}\``);
  return rows.map(row => ({
    MigrationID: String(row.MigrationID),
    Checksum: String(row.Checksum),
    Status: String(row.Status)
  }));
}

export async function recordLedgerEntry(exec: SqlExecutor, id: string, checksum: string, status: MigrationStatus, errorSummary: string | null): Promise<void> {
  await exec(
    `INSERT INTO \`${LEDGER_TABLE}\` (MigrationID, Checksum, AppliedAt, Status, ErrorSummary)
     VALUES (?, ?, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE Checksum = VALUES(Checksum), AppliedAt = NOW(), Status = VALUES(Status), ErrorSummary = VALUES(ErrorSummary)`,
    [id, checksum, status, errorSummary]
  );
}

export function migrationLockName(schema: string): string {
  return `fg:migrate:${sha256Hex(schema).slice(0, 40)}`;
}

export async function acquireMigrationLock(exec: SqlExecutor, schema: string): Promise<string> {
  const lockName = migrationLockName(schema);
  const rows = await exec(`SELECT GET_LOCK(?, ?) AS acquired`, [lockName, MIGRATION_LOCK_TIMEOUT_SECONDS]);
  if (Number(rows[0]?.acquired ?? 0) !== 1) {
    throw new MigrationLockUnavailableError(`Could not acquire migration lock for schema "${schema}" within ${MIGRATION_LOCK_TIMEOUT_SECONDS} seconds.`);
  }
  return lockName;
}

export async function releaseMigrationLock(exec: SqlExecutor, lockName: string): Promise<void> {
  const rows = await exec(`SELECT RELEASE_LOCK(?) AS released`, [lockName]);
  if (Number(rows[0]?.released ?? 0) !== 1) {
    throw new MigrationLockUnavailableError(`Migration lock "${lockName}" was not owned when release was attempted.`);
  }
}

/**
 * Applies every pending migration for one schema, in order, recording each in the
 * ledger. Stops at the first failing migration (recording it `failed`) so a broken
 * migration cannot be skipped over. Idempotent migrations mean a re-run of an
 * already-applied set does nothing.
 *
 * DDL implicitly commits in MySQL, so a wrapping transaction cannot make a
 * multi-statement DDL migration atomic; re-run safety comes from the migration's
 * own information_schema guards, and the ledger record is a single atomic upsert.
 */
export async function applyPendingMigrations(exec: SqlExecutor, schema: string, sources: MigrationSource[]): Promise<ApplyResult> {
  const lockName = await acquireMigrationLock(exec, schema);
  try {
    await ensureLedgerTable(exec);
    const ledger = await readLedger(exec, schema);
    const pending = selectPendingMigrations(sources, ledger);
    const pendingBefore = pending.map(source => source.id);
    const appliedNow: string[] = [];

    for (const source of pending) {
      try {
        await exec(source.contents);
        await recordLedgerEntry(exec, source.id, source.checksum, MIGRATION_STATUS.APPLIED, null);
        appliedNow.push(source.id);
      } catch (error) {
        const summary = errorMessage(error).slice(0, ERROR_SUMMARY_MAX_LENGTH);
        // Best-effort failure record; never mask the original migration error.
        await recordLedgerEntry(exec, source.id, source.checksum, MIGRATION_STATUS.FAILED, summary).catch(() => undefined);
        return { schema, pendingBefore, appliedNow, failed: { id: source.id, error: errorMessage(error) } };
      }
    }

    return { schema, pendingBefore, appliedNow, failed: null };
  } finally {
    await releaseMigrationLock(exec, lockName);
  }
}

// ---------------------------------------------------------------------------
// Contract audit (built on Task 2 schema-contract)
// ---------------------------------------------------------------------------

/**
 * Audits one live schema against the canonical write contract: column
 * type/nullability/default/extra/collation drift, required named indexes, text +
 * database collation, ingestion procedure presence, and pending-migration state.
 */
export async function auditSchemaContract(exec: SqlExecutor, schema: string, pendingMigrationIds: string[]): Promise<ContractAudit> {
  const canonical = loadCanonicalSchemaContract();
  const live = await readLiveSchemaContract(exec, schema, CRITICAL_TABLES);
  const comparison = compareSchemaContracts(canonical, live);
  // Collation drift remains visible below, but it is not an app-compatibility
  // failure and must not trigger table-wide rewrites during a deploy.
  const contractFailures = comparison.failures.filter(failure => failure.kind !== 'collation');

  const collationViolations: string[] = [];
  if (live.defaultCollation !== TARGET_TEXT_COLLATION) {
    collationViolations.push(`database default => ${live.defaultCollation}`);
  }
  for (const table of CRITICAL_TABLES) {
    const liveTable = live.tables[table];
    if (!liveTable) continue;
    for (const column of Object.values(liveTable.columns)) {
      if (!column.isText) continue;
      const key = `${table}.${column.name}`.toLowerCase();
      if (EXEMPT_TEXT_COLLATION_COLUMNS.has(key)) continue;
      if (column.collation !== TARGET_TEXT_COLLATION) {
        collationViolations.push(`${table}.${column.name} => ${column.collation}`);
      }
    }
  }

  const procedureRows = await exec(`SELECT ROUTINE_NAME AS name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'`, [
    schema
  ]);
  const presentProcedures = new Set(procedureRows.map(row => String(row.name).toLowerCase()));
  const missingProcedures = REQUIRED_INGESTION_PROCEDURES.filter(name => !presentProcedures.has(name.toLowerCase()));

  const ok = contractFailures.length === 0 && missingProcedures.length === 0 && pendingMigrationIds.length === 0;

  return { schema, contractFailures, contractExtras: comparison.extras, collationViolations, missingProcedures, pendingMigrationIds, ok };
}

/**
 * Whether an audited schema must fail its gate: incompatible structural drift,
 * missing procedures, or pending migrations. Collation drift is reported as a
 * maintenance warning rather than repaired inside an application deploy.
 * `ContractAudit.ok` already folds in pending migrations, so `--check` cannot
 * read as success while work is still outstanding.
 */
export function contractGateFailed(audit: ContractAudit): boolean {
  return !audit.ok;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export type RunnerMode = 'check' | 'apply';

export interface RunnerArgs {
  mode: RunnerMode;
  allSites: boolean;
  schema: string | null;
}

export function parseRunnerArgs(argv: string[]): RunnerArgs {
  let mode: RunnerMode | null = null;
  let allSites = false;
  let schema: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case CLI_FLAG.CHECK:
        mode = 'check';
        break;
      case CLI_FLAG.APPLY:
        mode = 'apply';
        break;
      case CLI_FLAG.ALL_SITES:
        allSites = true;
        break;
      case CLI_FLAG.SCHEMA:
        schema = argv[i + 1];
        if (!schema || schema.startsWith('--')) {
          throw new Error(`${CLI_FLAG.SCHEMA} requires a schema name.`);
        }
        i++;
        break;
      default:
        throw new Error(`Unknown argument "${arg}". Supported: ${Object.values(CLI_FLAG).join(', ')}.`);
    }
  }

  if (mode === null) {
    throw new Error(`One of ${CLI_FLAG.CHECK} or ${CLI_FLAG.APPLY} is required.`);
  }
  if (allSites === (schema !== null)) {
    throw new Error(`Exactly one target is required: ${CLI_FLAG.ALL_SITES} or ${CLI_FLAG.SCHEMA} <name>.`);
  }

  return { mode, allSites, schema };
}

function printAudit(audit: ContractAudit): void {
  if (audit.ok) {
    console.log(`  contract OK`);
  }
  for (const failure of audit.contractFailures) {
    console.log(
      `  DRIFT   [${failure.table}] ${failure.category} "${failure.object}" ${failure.kind}: expected=${JSON.stringify(failure.expected)} actual=${JSON.stringify(failure.actual)}`
    );
  }
  for (const extra of audit.contractExtras) {
    console.log(`  EXTRA   [${extra.table}] ${extra.category} "${extra.object}" actual=${JSON.stringify(extra.actual)}`);
  }
  for (const violation of audit.collationViolations) {
    console.log(`  COLLATION WARNING  ${violation}`);
  }
  for (const proc of audit.missingProcedures) {
    console.log(`  MISSING PROCEDURE  ${proc}`);
  }
  for (const id of audit.pendingMigrationIds) {
    console.log(`  PENDING MIGRATION  ${id}`);
  }
}

async function processSchema(
  settings: ReturnType<typeof resolveConnectionSettings>,
  schema: string,
  mode: RunnerMode,
  sources: MigrationSource[]
): Promise<boolean> {
  let schemaConnection: Awaited<ReturnType<typeof createSchemaCliConnection>> | null = null;
  try {
    schemaConnection = await createSchemaCliConnection(settings, { database: schema, multipleStatements: true });
    const exec = executorFor(schemaConnection);

    if (mode === 'apply') {
      const result = await applyPendingMigrations(exec, schema, sources);
      console.log(`  applied: ${result.appliedNow.length === 0 ? '(none pending)' : result.appliedNow.join(', ')}`);
      if (result.failed) {
        console.error(`  MIGRATION FAILED  ${result.failed.id}: ${result.failed.error}`);
        return false;
      }
      const audit = await auditSchemaContract(exec, schema, []);
      printAudit(audit);
      return !contractGateFailed(audit);
    }

    const ledger = await readLedger(exec, schema);
    const pending = selectPendingMigrations(sources, ledger);
    console.log(`  pending: ${pending.length === 0 ? '(none)' : pending.map(p => p.id).join(', ')}`);
    const audit = await auditSchemaContract(
      exec,
      schema,
      pending.map(p => p.id)
    );
    printAudit(audit);
    return !contractGateFailed(audit);
  } finally {
    if (schemaConnection) await schemaConnection.end();
  }
}

async function runCli(argv: string[]): Promise<number> {
  const args = parseRunnerArgs(argv);
  const settings = resolveConnectionSettings(args.allSites);
  assertExpectedHost(settings.host, settings.allowedHosts);

  const sources = loadMigrationSources();

  const discovery = await createSchemaCliConnection(settings, { multipleStatements: false });

  let exitCode = 0;
  try {
    const schemas = args.allSites ? await discoverSiteSchemas(discovery) : [args.schema as string];
    if (args.allSites) {
      assertSiteSchemasDiscovered(schemas);
    }

    console.log(`Mode: ${args.mode.toUpperCase()} | Target: ${args.allSites ? 'all sites' : args.schema} | Host: ${settings.host}`);
    console.log(`Discovered ${schemas.length} schema(s). Manifest migrations: ${sources.map(s => s.id).join(', ')}\n`);

    for (const schema of schemas) {
      console.log(`Schema: ${schema}`);
      try {
        // A per-schema connection or processing failure fails the run (exitCode=1)
        // but must not abort the remaining schemas — mirrors deploy-validations.
        const passed = await processSchema(settings, schema, args.mode, sources);
        if (!passed) {
          exitCode = 1;
          if (args.mode === 'apply') {
            console.error(`  ABORTING remaining schemas after apply failure to limit partial rollout.`);
            break;
          }
        }
      } catch (error) {
        console.error(`  SCHEMA FAILED  ${schema}: ${errorMessage(error)}`);
        exitCode = 1;
        if (args.mode === 'apply') {
          console.error(`  ABORTING remaining schemas after apply failure to limit partial rollout.`);
          break;
        }
      }
      console.log();
    }
  } finally {
    await discovery.end();
  }

  return exitCode;
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
      process.exit(code);
    })
    .catch((error: unknown) => {
      console.error(`\nFatal: ${errorMessage(error)}`);
      process.exit(1);
    });
}
