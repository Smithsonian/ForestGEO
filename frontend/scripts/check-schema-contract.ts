/**
 * Read-only schema-contract audit across ForestGEO schemas.
 *
 * Reports, per schema: missing/incompatible columns (type/nullability/default/
 * extra/collation), missing required named indexes, database + text collation
 * drift, missing ingestion procedures, and pending-migration state — all via the
 * shared audit in apply-schema-migrations.ts (Task 2 schema-contract underneath).
 * It never writes.
 *
 * It ends in exactly one of:
 *   schema-contract OK: N schemas
 *   schema-contract FAILED: N schemas checked, M incompatible
 * each with a " (Q quarantined: ...)" suffix when the deploy gate has quarantined
 * schemas (see #429) — those are printed with their stored reason and never
 * audited here. N = 0 is ALWAYS a failure (a discovery failure, or an all-
 * quarantined server, must never read as a green run).
 *
 * Flags:
 *   --schema <name>   audit ONE schema using LOCAL test credentials
 *   --all-sites       audit every forestgeo_* schema on the Azure server
 *
 * Usage:
 *   npx tsx scripts/check-schema-contract.ts --all-sites
 *   npx tsx scripts/check-schema-contract.ts --schema forestgeo_test_default
 */

import path from 'path';
import { fileURLToPath } from 'url';
import {
  assertSiteSchemasDiscovered,
  auditSchemaContract,
  loadMigrationSources,
  readLedger,
  selectPendingMigrations,
  type ContractAudit,
  type MigrationSource
} from './apply-schema-migrations';
import { assertExpectedHost, createSchemaCliConnection, discoverSiteSchemas, executorFor, resolveConnectionSettings } from './lib/schema-cli';
import { CATALOG_DATABASE_NAME } from '../db/migrations/catalog-manifest';
import { readQuarantinedSchemas, type SchemaGateRow } from './lib/schema-gate';

const CLI_FLAG = {
  SCHEMA: '--schema',
  ALL_SITES: '--all-sites'
} as const;

export interface AuditArgs {
  allSites: boolean;
  schema: string | null;
}

export function parseAuditArgs(argv: string[]): AuditArgs {
  let allSites = false;
  let schema: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
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

  if (allSites === (schema !== null)) {
    throw new Error(`Exactly one target is required: ${CLI_FLAG.ALL_SITES} or ${CLI_FLAG.SCHEMA} <name>.`);
  }

  return { allSites, schema };
}

export interface AuditSummary {
  checked: number;
  incompatible: number;
  quarantined: number;
  passed: boolean;
  message: string;
}

/**
 * Decides the overall pass/fail from per-schema audits. N = 0 is ALWAYS a
 * failure: a run that checked zero schemas must never report success, and a
 * quarantined schema is not a checked schema.
 */
export function summarizeAudits(audits: ContractAudit[], quarantinedSchemas: readonly string[] = []): AuditSummary {
  const checked = audits.length;
  const incompatible = audits.filter(audit => !audit.ok).length;
  const quarantined = quarantinedSchemas.length;
  const passed = checked > 0 && incompatible === 0;
  const quarantineSuffix = quarantined === 0 ? '' : ` (${quarantined} quarantined: ${quarantinedSchemas.join(', ')})`;
  const message = passed
    ? `schema-contract OK: ${checked} schemas${quarantineSuffix}`
    : `schema-contract FAILED: ${checked} schemas checked, ${incompatible} incompatible${quarantineSuffix}`;
  return { checked, incompatible, quarantined, passed, message };
}

function printAuditDetail(audit: ContractAudit): void {
  console.log(`Schema: ${audit.schema}${audit.ok ? '  [OK]' : '  [INCOMPATIBLE]'}`);
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

function printQuarantinedDetail(schema: string, row: SchemaGateRow): void {
  console.log(`Schema: ${schema}  [QUARANTINED since ${row.quarantinedAt?.toISOString() ?? 'unknown'}]`);
  for (const line of (row.quarantineReason ?? '').split('\n').filter(Boolean)) console.log(`  ${line}`);
}

async function auditOneSchema(settings: ReturnType<typeof resolveConnectionSettings>, schema: string, sources: MigrationSource[]): Promise<ContractAudit> {
  const schemaConnection = await createSchemaCliConnection(settings, { database: schema, multipleStatements: false });
  try {
    const exec = executorFor(schemaConnection);
    const ledger = await readLedger(exec, schema);
    const pending = selectPendingMigrations(sources, ledger);
    // `return await`, not `return`: the finally below closes the connection, and a bare
    // `return` would run it before the audit's queries finish — killing the connection
    // mid-audit on every real run.
    return await auditSchemaContract(
      exec,
      schema,
      pending.map(source => source.id)
    );
  } finally {
    await schemaConnection.end();
  }
}

async function runCli(argv: string[]): Promise<number> {
  const args = parseAuditArgs(argv);
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

  const audits: ContractAudit[] = [];
  const quarantinedNames: string[] = [];
  try {
    const schemas = args.allSites ? await discoverSiteSchemas(discovery) : [args.schema as string];
    if (args.allSites) {
      assertSiteSchemasDiscovered(schemas);
    }
    const quarantined = await readQuarantinedSchemas(executorFor(catalog));

    for (const schema of schemas) {
      const row = quarantined.get(schema.toLowerCase());
      if (row) {
        printQuarantinedDetail(schema, row);
        quarantinedNames.push(schema);
        continue;
      }
      const audit = await auditOneSchema(settings, schema, sources);
      audits.push(audit);
      printAuditDetail(audit);
    }
  } finally {
    await catalog.end();
    await discovery.end();
  }

  const summary = summarizeAudits(audits, quarantinedNames);
  console.log(`\n${summary.message}`);
  return summary.passed ? 0 : 1;
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
  // process.exitCode, NOT process.exit(): exit() terminates before piped stdout is
  // flushed, discarding every per-schema audit line CI needs to diagnose a failure.
  // All connections are closed in finally blocks, so the process exits on its own.
  runCli(process.argv.slice(2))
    .then(code => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`\nschema-contract FAILED: ${reason}`);
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
      process.exitCode = 1;
    });
}
