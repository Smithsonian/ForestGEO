/** Operator entry point for the fixed ValidationID 1/2 DBH re-score sweep. */
import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { DBH_CHANGE_VALIDATION_ID_LIST } from '@/config/dbhchangevalidations';
import { discoverSiteSchemas } from './lib/schema-cli';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import {
  buildDbhExpectedManifest,
  buildRealSweepDeps,
  createArtifactPath,
  dbhRuntimeConnectionOptions,
  DbhRescoreArgumentError,
  getDbhRuntimeSettings,
  parseDbhRescoreArgs,
  runDbhRescoreCli
} from '@/lib/validations/dbh-rescore-cli';

function usage(): string {
  return 'Usage: tsx scripts/rescore-dbh-validations.ts (--all-sites | --schema <name>) [--plot <id> [--census <id>]] [--artifact-dir <dir>] [--apply --i-understand-this-writes-to <host> [--allow-valid-to-invalid]]';
}

function applyTimeout(): number | undefined {
  const raw = process.env.DBH_RESCORE_TIMEOUT_MS;
  if (!raw) return undefined;
  const timeout = Number(raw);
  if (!Number.isInteger(timeout) || timeout <= 0) throw new Error('DBH_RESCORE_TIMEOUT_MS must be a positive integer');
  return timeout;
}

async function createVerificationConnection(settings: ReturnType<typeof getDbhRuntimeSettings>): Promise<mysql.Connection> {
  return mysql.createConnection(dbhRuntimeConnectionOptions(settings));
}

async function main(): Promise<number> {
  const args = parseDbhRescoreArgs(process.argv.slice(2));
  // A measured timeout is an explicit rollout input, never an undocumented default.
  const timeoutMs = args.apply ? applyTimeout() : undefined;
  if (args.apply && timeoutMs === undefined) throw new Error('Apply requires measured DBH_RESCORE_TIMEOUT_MS');
  const settings = getDbhRuntimeSettings();
  if (args.apply && args.acknowledgedHost !== settings.host)
    throw new Error(`--i-understand-this-writes-to must exactly match configured host ${settings.host}`);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const proceduresPath = process.env.DBH_RESCORE_PROCEDURES_SQL ?? path.join(root, 'db/sql/storedprocedures.sql');
  const queriesPath = process.env.DBH_RESCORE_COREQUERIES_SQL ?? path.join(root, 'db/sql/corequeries.sql');
  const manifest = buildDbhExpectedManifest(await readFile(proceduresPath, 'utf8'), await readFile(queriesPath, 'utf8'));
  const artifactPath = args.apply
    ? await createArtifactPath(args.artifactDir!, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`)
    : undefined;
  const connection = await createVerificationConnection(settings);
  try {
    const deps = buildRealSweepDeps(connection, manifest, artifactPath, timeoutMs, { allowValidToInvalid: args.allowValidToInvalid });
    deps.discoverSchemas = args.allSites ? () => discoverSiteSchemas(connection) : undefined;
    if (args.apply) {
      await deps.writeArtifact({
        event: 'sweep-start',
        at: deps.now(),
        revision: manifest.revision,
        args,
        timeoutMs,
        configuredHost: settings.host,
        configuredUser: settings.user,
        fixedValidationIDs: DBH_CHANGE_VALIDATION_ID_LIST
      });
    }
    console.log(`Configured database: ${settings.user}@${settings.host}:${settings.port}; expected revision ${manifest.revision}`);
    const exitCode = await runDbhRescoreCli(args, deps);
    if (args.apply) await deps.writeArtifact({ event: 'sweep-finished', at: deps.now(), exitCode });
    return exitCode;
  } finally {
    try {
      await connection.end();
    } finally {
      // Apply uses rescoreDbhCensus, whose owned transactions use the runtime
      // connection-manager pool rather than this verification connection.
      // A one-shot operator process must release that pool before it exits.
      if (args.apply) await getPoolMonitorInstance().closeAllConnections();
    }
  }
}

void main()
  .then(code => {
    process.exitCode = code;
  })
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof DbhRescoreArgumentError) console.error(usage());
    process.exitCode = error instanceof DbhRescoreArgumentError ? 2 : 1;
  });
