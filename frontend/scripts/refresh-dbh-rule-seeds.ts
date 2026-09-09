/** Refresh only the two DBH validation descriptions/definitions after procedure deployment. */
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { discoverSiteSchemas, executorFor } from './lib/schema-cli';
import { checkMigrationStatus } from './deploy-validations-to-all-schemas';
import { quarantineSkipDetail, readQuarantinedSchemas } from './lib/schema-gate';
import {
  buildDbhRuleDeploymentManifest,
  DbhRuleDeploymentArgumentError,
  parseDbhRuleDeploymentArgs,
  refreshDbhRuleSeeds,
  selectDbhRuleDeploymentSchemas
} from '@/lib/validations/dbh-rule-deployment';
import { dbhRuntimeConnectionOptions, getDbhRuntimeSettings } from '@/lib/validations/dbh-rescore-cli';

function usage(): string {
  return 'Usage: tsx scripts/refresh-dbh-rule-seeds.ts (--all-sites | --schema <name>) [--apply --i-understand-this-writes-to <host>]';
}

async function main(): Promise<void> {
  const args = parseDbhRuleDeploymentArgs(process.argv.slice(2));
  const settings = getDbhRuntimeSettings();
  if (args.apply && args.acknowledgedHost !== settings.host)
    throw new Error(`--i-understand-this-writes-to must exactly match configured host ${settings.host}`);

  const connection = await mysql.createConnection(dbhRuntimeConnectionOptions(settings));
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const proceduresPath = process.env.DBH_RESCORE_PROCEDURES_SQL ?? path.join(root, 'db/sql/storedprocedures.sql');
    const coreQueriesPath = process.env.DBH_RESCORE_COREQUERIES_SQL ?? path.join(root, 'db/sql/corequeries.sql');
    const manifest = buildDbhRuleDeploymentManifest(await readFile(proceduresPath, 'utf8'), await readFile(coreQueriesPath, 'utf8'));
    const requestedSchemas = args.schema ? [args.schema] : await discoverSiteSchemas(connection);
    const quarantined = await readQuarantinedSchemas(executorFor(connection));
    const migrationStatus = new Map(
      await Promise.all(requestedSchemas.map(async schema => [schema.toLowerCase(), await checkMigrationStatus(connection, schema)] as const))
    );
    const selection = selectDbhRuleDeploymentSchemas(requestedSchemas, quarantined, args.schema !== undefined, migrationStatus);
    for (const entry of selection.quarantined) console.warn(`SKIPPED (quarantined): ${entry.schema} - ${quarantineSkipDetail(entry.gate)}`);
    for (const entry of selection.notMigrated)
      console.warn(
        `SKIPPED (not migrated): ${entry.schema} - Missing tables: ${entry.missingTables.join(', ')}. Run run-migrations.sh against this schema first.`
      );
    console.log(`Configured database: ${settings.user}@${settings.host}:${settings.port}; expected revision ${manifest.revision}`);
    await refreshDbhRuleSeeds(connection, selection.schemas, manifest, args.apply);
    console.log(
      args.apply
        ? `Refreshed DBH validation seeds in ${selection.schemas.length} schema(s).`
        : `Preflight passed for ${selection.schemas.length} schema(s); re-run with --apply to write.`
    );
  } finally {
    await connection.end();
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof DbhRuleDeploymentArgumentError) console.error(usage());
  process.exitCode = error instanceof DbhRuleDeploymentArgumentError ? 2 : 1;
});
