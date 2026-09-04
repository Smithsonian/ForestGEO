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
  CONTRACT_READ_TABLES,
  compareSchemaContracts,
  CRITICAL_TABLES,
  TARGET_TEXT_COLLATION,
  type SchemaDifference
} from '@/lib/db/schema-contract';
import { SCHEMA_MIGRATION_MANIFEST, type MigrationManifestEntry } from '../db/migrations/manifest';
import { CATALOG_DATABASE_NAME } from '../db/migrations/catalog-manifest';
import {
  SchemaGateUnavailableError,
  currentRunRef,
  pruneGateRows,
  readQuarantinedSchemas,
  readSchemaGateRows,
  recordGateBlock,
  recordGatePass,
  recordGateQuarantine,
  type EnvVars,
  type SchemaGateRow
} from './lib/schema-gate';
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

/**
 * Patience limit for DDL against live tables. MySQL's default lock_wait_timeout is
 * one year, so an ALTER queued behind a long-running ingestion transaction's
 * metadata lock would wait indefinitely — and every NEW app query on that table
 * queues behind the pending ALTER, freezing production ingestion until the CI job
 * is killed. With this limit the migration fails fast instead (the deploy re-runs
 * at a quieter moment); 60s still tolerates normal brief locks.
 */
export const DDL_LOCK_WAIT_TIMEOUT_SECONDS = 60;

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
export const ERROR_SUMMARY_MAX_LENGTH = 2000;

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
  failureCleanup?: readonly string[];
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
    return { id: entry.id, file: entry.file, contents, checksum: sha256Hex(contents), failureCleanup: entry.failureCleanup ?? [] };
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
    // Fail fast if live traffic holds a metadata or row lock on a target table —
    // see DDL_LOCK_WAIT_TIMEOUT_SECONDS for why the server default must not stand.
    await exec(`SET SESSION lock_wait_timeout = ${DDL_LOCK_WAIT_TIMEOUT_SECONDS}`);
    await exec(`SET SESSION innodb_lock_wait_timeout = ${DDL_LOCK_WAIT_TIMEOUT_SECONDS}`);
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
        // DDL is not transactional. Some reviewed migrations create short-lived
        // helper routines to raise runtime contract errors; an early SIGNAL
        // skips the SQL file's trailing DROP, so clean those helpers here.
        for (const cleanupStatement of source.failureCleanup ?? []) {
          await exec(cleanupStatement).catch(() => undefined);
        }
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
  const live = await readLiveSchemaContract(exec, schema, CONTRACT_READ_TABLES);
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
// Quarantine (see #429): a schema that has never passed the gate must not take
// every other schema's deploy down with it; a schema that HAS passed and now
// fails is a regression this deploy introduced and still blocks.
// ---------------------------------------------------------------------------

export type GateOutcome = 'passed' | 'quarantined' | 'blocked';

export const GATE_RESULT_PATH_ENV = 'SCHEMA_GATE_RESULT_PATH';
const GITHUB_ACTIONS_ENV = 'GITHUB_ACTIONS';
const GITHUB_STEP_SUMMARY_ENV = 'GITHUB_STEP_SUMMARY';
const GATE_LOG_PREFIX = '  GATE   ';
const ANNOTATION_TITLE = 'Schema quarantined';

export interface SchemaGateResult {
  schema: string;
  passed: boolean;
  /** Empty when passed; otherwise the audit/migration lines that failed. */
  reason: string;
}

export interface GateRunSummary {
  passed: string[];
  quarantined: Array<{ schema: string; reason: string; since: string }>;
  blocked: Array<{ schema: string; reason: string }>;
}

/** Injectable gate-table access so the loop is unit-testable without MySQL. */
export interface GateStore {
  rows: Map<string, SchemaGateRow>;
  pass(schema: string): Promise<void>;
  /** Returns the effective QuarantinedAt (the original one on a re-run). */
  quarantine(schema: string, reason: string): Promise<Date>;
  block(schema: string): Promise<void>;
}

export function decideGateOutcome(schemaPassed: boolean, priorRow: SchemaGateRow | null): GateOutcome {
  if (schemaPassed) return 'passed';
  return priorRow?.lastPassedAt == null ? 'quarantined' : 'blocked';
}

/** The lines printAudit would show, joined for storage; migration failure first when present. */
export function formatGateReason(audit: ContractAudit | null, migrationFailure: { id: string; error: string } | null): string {
  const lines: string[] = [];
  if (migrationFailure) lines.push(`MIGRATION FAILED ${migrationFailure.id}: ${migrationFailure.error}`);
  if (audit) {
    for (const failure of audit.contractFailures) {
      lines.push(
        `DRIFT [${failure.table}] ${failure.category} "${failure.object}" ${failure.kind}: expected=${JSON.stringify(failure.expected)} actual=${JSON.stringify(failure.actual)}`
      );
    }
    for (const proc of audit.missingProcedures) lines.push(`MISSING PROCEDURE ${proc}`);
    for (const id of audit.pendingMigrationIds) lines.push(`PENDING MIGRATION ${id}`);
  }
  return lines.join('\n').slice(0, ERROR_SUMMARY_MAX_LENGTH);
}

/**
 * Applies the per-schema outcome rule across every discovered schema. A
 * quarantined schema never stops the loop; a blocked schema stops it (today's
 * "abort remaining schemas" behavior) and fails the run.
 *
 * `requireAtLeastOnePass` is the systemic-failure floor for the deploy sweep: if
 * a bad migration breaks every schema at once, the run must fail rather than ship
 * the app with every site quarantined. It is meaningless for a single-schema run,
 * where "no schema passed" just restates the one outcome the caller asked for, so
 * runCli enables it only for --all-sites.
 */
export async function runApplyGateLoop(
  schemas: string[],
  processOne: (schema: string) => Promise<SchemaGateResult>,
  store: GateStore,
  log: (line: string) => void,
  requireAtLeastOnePass = true
): Promise<{ summary: GateRunSummary; exitCode: number }> {
  const summary: GateRunSummary = { passed: [], quarantined: [], blocked: [] };
  let exitCode = 0;

  for (const schema of schemas) {
    log(`Schema: ${schema}`);
    let result: SchemaGateResult;
    try {
      result = await processOne(schema);
    } catch (error) {
      result = { schema, passed: false, reason: errorMessage(error).slice(0, ERROR_SUMMARY_MAX_LENGTH) };
      log(`  SCHEMA FAILED  ${schema}: ${result.reason}`);
    }

    const outcome = decideGateOutcome(result.passed, store.rows.get(schema.toLowerCase()) ?? null);
    if (outcome === 'passed') {
      await store.pass(schema);
      summary.passed.push(schema);
      log(`${GATE_LOG_PREFIX}passed`);
    } else if (outcome === 'quarantined') {
      const since = await store.quarantine(schema, result.reason);
      summary.quarantined.push({ schema, reason: result.reason, since: since.toISOString() });
      log(`${GATE_LOG_PREFIX}quarantined (never passed; first quarantined ${since.toISOString()})`);
    } else {
      await store.block(schema);
      summary.blocked.push({ schema, reason: result.reason });
      exitCode = 1;
      log(`${GATE_LOG_PREFIX}BLOCKED (passed before; this deploy regressed it)`);
      log(`  ABORTING remaining schemas after apply failure to limit partial rollout.`);
      log('');
      break;
    }
    log('');
  }

  if (requireAtLeastOnePass && summary.passed.length === 0) {
    exitCode = 1;
    log(`GATE FAILED: no schema passed; refusing to treat a systemic failure as ${summary.quarantined.length} quarantines.`);
  }

  const quarantinedNames = summary.quarantined.map(entry => entry.schema).join(', ');
  log(
    `Gate summary: ${summary.passed.length} passed, ${summary.quarantined.length} quarantined${quarantinedNames ? ` (${quarantinedNames})` : ''}, ${summary.blocked.length} blocked`
  );
  return { summary, exitCode };
}

export function formatGitHubAnnotations(summary: GateRunSummary): string[] {
  return summary.quarantined.map(entry => `::warning title=${ANNOTATION_TITLE}::${entry.schema} — ${entry.reason.split('\n')[0]}`);
}

function formatStepSummaryMarkdown(summary: GateRunSummary): string {
  const rows = [
    ...summary.passed.map(schema => `| ${schema} | passed | | |`),
    ...summary.quarantined.map(entry => `| ${entry.schema} | quarantined | ${entry.reason.split('\n')[0]} | ${entry.since} |`),
    ...summary.blocked.map(entry => `| ${entry.schema} | BLOCKED | ${entry.reason.split('\n')[0]} | |`)
  ];
  return ['## Schema contract gate', '', '| Schema | Outcome | Reason | Quarantined since |', '|---|---|---|---|', ...rows, ''].join('\n');
}

/** Writes the JSON the workflow's "Report quarantined schemas" step reads. No-op unless the env var is set. */
export function writeGateResultFile(summary: GateRunSummary, env: EnvVars = process.env): void {
  const target = env[GATE_RESULT_PATH_ENV];
  if (!target) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(summary, null, 2), 'utf-8');
}

function reportGateRunToCi(summary: GateRunSummary, env: EnvVars = process.env): void {
  if (env[GITHUB_ACTIONS_ENV] !== 'true') return;
  for (const line of formatGitHubAnnotations(summary)) console.log(line);
  const stepSummaryPath = env[GITHUB_STEP_SUMMARY_ENV];
  if (stepSummaryPath) fs.appendFileSync(stepSummaryPath, formatStepSummaryMarkdown(summary), 'utf-8');
}

function gateStoreFor(exec: SqlExecutor, rows: Map<string, SchemaGateRow>, runRef: string): GateStore {
  return {
    rows,
    async pass(schema) {
      await recordGatePass(exec, schema, runRef);
    },
    async quarantine(schema, reason) {
      await recordGateQuarantine(exec, schema, reason, runRef);
      const after = await readSchemaGateRows(exec);
      return after.get(schema.toLowerCase())?.quarantinedAt ?? new Date();
    },
    async block(schema) {
      await recordGateBlock(exec, schema, runRef);
    }
  };
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

interface ProcessSchemaOutcome {
  passed: boolean;
  reason: string;
  audit: ContractAudit | null;
}

async function processSchema(
  settings: ReturnType<typeof resolveConnectionSettings>,
  schema: string,
  mode: RunnerMode,
  sources: MigrationSource[]
): Promise<ProcessSchemaOutcome> {
  let schemaConnection: Awaited<ReturnType<typeof createSchemaCliConnection>> | null = null;
  try {
    schemaConnection = await createSchemaCliConnection(settings, { database: schema, multipleStatements: true });
    const exec = executorFor(schemaConnection);

    if (mode === 'apply') {
      const result = await applyPendingMigrations(exec, schema, sources);
      console.log(`  applied: ${result.appliedNow.length === 0 ? '(none pending)' : result.appliedNow.join(', ')}`);
      if (result.failed) {
        console.error(`  MIGRATION FAILED  ${result.failed.id}: ${result.failed.error}`);
        return { passed: false, reason: formatGateReason(null, result.failed), audit: null };
      }
      const audit = await auditSchemaContract(exec, schema, []);
      printAudit(audit);
      const passed = !contractGateFailed(audit);
      return { passed, reason: passed ? '' : formatGateReason(audit, null), audit };
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
    const passed = !contractGateFailed(audit);
    return { passed, reason: passed ? '' : formatGateReason(audit, null), audit };
  } finally {
    if (schemaConnection) await schemaConnection.end();
  }
}

function printQuarantined(schema: string, row: SchemaGateRow): void {
  console.log(`Schema: ${schema}  [QUARANTINED since ${row.quarantinedAt?.toISOString() ?? 'unknown'}]`);
  for (const line of (row.quarantineReason ?? '').split('\n').filter(Boolean)) console.log(`  ${line}`);
  console.log();
}

async function runCheckLoop(
  settings: ReturnType<typeof resolveConnectionSettings>,
  schemas: string[],
  sources: MigrationSource[],
  quarantined: Map<string, SchemaGateRow>
): Promise<number> {
  let exitCode = 0;
  let checked = 0;
  for (const schema of schemas) {
    const row = quarantined.get(schema.toLowerCase());
    if (row) {
      printQuarantined(schema, row);
      continue;
    }
    console.log(`Schema: ${schema}`);
    try {
      const outcome = await processSchema(settings, schema, 'check', sources);
      checked++;
      if (!outcome.passed) exitCode = 1;
    } catch (error) {
      console.error(`  SCHEMA FAILED  ${schema}: ${errorMessage(error)}`);
      exitCode = 1;
    }
    console.log();
  }
  if (checked === 0) {
    console.error(`GATE FAILED: every discovered schema is quarantined; nothing was checked.`);
    exitCode = 1;
  }
  console.log(`Check summary: ${checked} checked, ${quarantined.size} quarantined`);
  return exitCode;
}

async function runCli(argv: string[]): Promise<number> {
  const args = parseRunnerArgs(argv);
  const settings = resolveConnectionSettings(args.allSites);
  assertExpectedHost(settings.host, settings.allowedHosts);

  const sources = loadMigrationSources();

  const discovery = await createSchemaCliConnection(settings, { multipleStatements: false });
  // Guarded: a failure opening the catalog connection must not strand the
  // discovery connection, which has no finally block covering it yet.
  let catalog: Awaited<ReturnType<typeof createSchemaCliConnection>>;
  try {
    catalog = await createSchemaCliConnection(settings, { database: CATALOG_DATABASE_NAME, multipleStatements: false });
  } catch (error) {
    await discovery.end();
    throw error;
  }
  const gateExec = executorFor(catalog);

  try {
    const schemas = args.allSites ? await discoverSiteSchemas(discovery) : [args.schema as string];
    if (args.allSites) {
      assertSiteSchemasDiscovered(schemas);
    }

    console.log(`Mode: ${args.mode.toUpperCase()} | Target: ${args.allSites ? 'all sites' : args.schema} | Host: ${settings.host}`);
    console.log(`Discovered ${schemas.length} schema(s). Manifest migrations: ${sources.map(s => s.id).join(', ')}\n`);

    if (args.mode === 'check') {
      const quarantined = await readQuarantinedSchemas(gateExec);
      return await runCheckLoop(settings, schemas, sources, quarantined);
    }

    // Gate-table failures are infrastructure, not schema state: they abort the run
    // here, before any schema is touched, and never produce a quarantine row.
    const gateRows = await readSchemaGateRows(gateExec);
    if (args.allSites) {
      const pruned = await pruneGateRows(gateExec, schemas);
      for (const name of pruned) console.log(`Pruned gate row for missing schema: ${name}`);
    }

    const store = gateStoreFor(gateExec, gateRows, currentRunRef());
    const { summary, exitCode } = await runApplyGateLoop(
      schemas,
      async schema => {
        const outcome = await processSchema(settings, schema, 'apply', sources);
        return { schema, passed: outcome.passed, reason: outcome.reason };
      },
      store,
      line => console.log(line),
      args.allSites
    );
    writeGateResultFile(summary);
    reportGateRunToCi(summary);
    return exitCode;
  } finally {
    await catalog.end();
    await discovery.end();
  }
}

export { runCli };

const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  // process.exitCode, NOT process.exit(): exit() terminates before piped stdout is
  // flushed, discarding the per-schema apply log CI needs to diagnose a failure.
  // All connections are closed in finally blocks, so the process exits on its own.
  runCli(process.argv.slice(2))
    .then(code => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const prefix = error instanceof SchemaGateUnavailableError ? 'Gate unavailable' : 'Fatal';
      console.error(`\n${prefix}: ${errorMessage(error)}`);
      process.exitCode = 1;
    });
}
