import { mkdir, open } from 'fs/promises';
import path from 'path';
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { parseStoredProceduresSQL } from '@/scripts/deploy-validations-to-all-schemas';
import { DBH_CHANGE_VALIDATION_IDS, DBH_GROWTH_PROCEDURE, DBH_SHRINKAGE_PROCEDURE } from '@/config/dbhchangevalidations';
import { parseSiteValidationSeeds } from './validation-seed-parser';
import { validateSchemaOrThrow } from '@/lib/db/sqlsecurity';
import { ACTIVE_UPLOAD_SESSION_STATES } from '@/config/uploadsessiontracker';
import { NON_TERMINAL_BACKGROUND_JOB_STATUSES } from '@/lib/background-jobs/types';
import { dbhRuleDigest, planDbhSweep, runDbhSweep, type DbhSweepDependencies, type DbhSweepScope } from './dbh-rescore-sweep';
import { rescoreDbhCensus } from './dbh-rescore';

export interface DbhRescoreCliArgs {
  allSites: boolean;
  schema?: string;
  plotID?: number;
  censusID?: number;
  artifactDir?: string;
  apply: boolean;
  acknowledgedHost?: string;
  allowValidToInvalid: boolean;
}
export class DbhRescoreArgumentError extends Error {}
export interface DbhExpectedSeed {
  validationID: 1 | 2;
  procedureName: string;
  description: string;
  definition: string;
}
export interface DbhExpectedManifest {
  revision: string;
  procedures: Record<'BuildDBHChangePairs' | 'RunSharedDBHChangeValidations', string>;
  seeds: DbhExpectedSeed[];
}

type CensusScopeRow = RowDataPacket & {
  censusID: number | string;
  plotID: number | string;
  plotCensusNumber: number | string;
};
type TableNameRow = RowDataPacket & { TABLE_NAME: string };
type ProcedureDefinitionRow = RowDataPacket & { 'Create Procedure': string };
type ValidationRuleRow = RowDataPacket & {
  ValidationID: number | string;
  ProcedureName: string;
  Description: string;
  Definition: string;
  IsEnabled: number | boolean | Buffer;
};
type CensusRow = RowDataPacket & { CensusID: number | string; PlotCensusNumber: number | string };
type CountRow = RowDataPacket & { count: number | string };

/** DBH verification must use the process's application-pool target, not TEST_DB_* selector defaults. */
export function getDbhRuntimeSettings(environment: Record<string, string | undefined> = process.env): {
  host: string;
  user: string;
  password: string;
  port: number;
} {
  const host = environment.AZURE_SQL_SERVER;
  const user = environment.AZURE_SQL_USER;
  const password = environment.AZURE_SQL_PASSWORD;
  const port = Number(environment.AZURE_SQL_PORT);
  if (!host || !user || !password || !Number.isInteger(port) || port <= 0)
    throw new Error(
      'AZURE_SQL_SERVER, AZURE_SQL_USER, AZURE_SQL_PASSWORD, and AZURE_SQL_PORT must name the same database host used by the application runtime'
    );
  return { host, user, password, port };
}

/** The operator CLIs use plaintext only for local development databases. */
export function dbhRuntimeConnectionOptions(settings: ReturnType<typeof getDbhRuntimeSettings>): mysql.ConnectionOptions {
  const local = settings.host === 'localhost' || settings.host === '127.0.0.1';
  return {
    ...settings,
    timezone: 'Z',
    multipleStatements: false,
    connectTimeout: 10_000,
    ...(!local && { ssl: { rejectUnauthorized: true, verifyIdentity: true } })
  };
}

const positive = (value: string, flag: string) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new DbhRescoreArgumentError(`${flag} must be a positive integer`);
  return number;
};

export function parseDbhRescoreArgs(argv: readonly string[]): DbhRescoreCliArgs {
  const out: DbhRescoreCliArgs = { allSites: false, apply: false, allowValidToInvalid: false };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next || next.startsWith('--')) throw new DbhRescoreArgumentError(`${flag} requires a value`);
      return next;
    };
    if (seen.has(flag)) throw new DbhRescoreArgumentError(`Flag may be specified only once: ${flag}`);
    seen.add(flag);
    if (flag === '--all-sites') out.allSites = true;
    else if (flag === '--schema') out.schema = value();
    else if (flag === '--plot') out.plotID = positive(value(), flag);
    else if (flag === '--census') out.censusID = positive(value(), flag);
    else if (flag === '--artifact-dir') out.artifactDir = value();
    else if (flag === '--apply') out.apply = true;
    else if (flag === '--i-understand-this-writes-to') out.acknowledgedHost = value();
    else if (flag === '--allow-valid-to-invalid') out.allowValidToInvalid = true;
    else throw new DbhRescoreArgumentError(`Unknown or disallowed flag: ${flag}`);
  }
  if (out.allSites === Boolean(out.schema)) throw new DbhRescoreArgumentError('Specify exactly one of --all-sites or --schema');
  if (out.schema) validateSchemaOrThrow(out.schema);
  if (out.allSites && out.plotID !== undefined) throw new DbhRescoreArgumentError('--plot requires --schema so a plot ID cannot silently select several sites');
  if (out.censusID !== undefined && (out.schema === undefined || out.plotID === undefined))
    throw new DbhRescoreArgumentError('--census requires --schema and --plot');
  if (out.apply && (!out.artifactDir || !out.acknowledgedHost))
    throw new DbhRescoreArgumentError('--apply requires --artifact-dir and --i-understand-this-writes-to <host>');
  if (out.allowValidToInvalid && !out.apply) throw new DbhRescoreArgumentError('--allow-valid-to-invalid only applies with --apply');
  return out;
}

/** Build a revision contract from SQL, so rollback passes its own expected bodies. */
export function buildDbhExpectedManifest(
  storedProcedures: string,
  coreQueries: string,
  revision = dbhRuleDigest(`${storedProcedures}\n${coreQueries}`)
): DbhExpectedManifest {
  const expected: Partial<DbhExpectedManifest['procedures']> = {};
  for (const statement of parseStoredProceduresSQL(storedProcedures)) {
    const match = statement.match(/\bCREATE\s+(?:DEFINER\s*=\s*[^\s]+\s+)?PROCEDURE\s+`?(BuildDBHChangePairs|RunSharedDBHChangeValidations)`?/i);
    if (match) expected[match[1] as keyof DbhExpectedManifest['procedures']] = statement;
  }
  if (!expected.BuildDBHChangePairs || !expected.RunSharedDBHChangeValidations)
    throw new Error('Expected DBH procedure bodies are absent from the supplied manifest SQL');
  const seeds: DbhExpectedSeed[] = parseSiteValidationSeeds(coreQueries)
    .filter(seed => seed.validationID === DBH_CHANGE_VALIDATION_IDS.growth || seed.validationID === DBH_CHANGE_VALIDATION_IDS.shrinkage)
    .map(seed => ({
      validationID: seed.validationID as DbhExpectedSeed['validationID'],
      procedureName: seed.procedureName,
      description: seed.description,
      definition: seed.definition
    }));
  if (seeds.length !== 2 || new Set(seeds.map(seed => seed.validationID)).size !== 2)
    throw new Error('Expected DBH seed definitions are absent or ambiguous in the supplied manifest SQL');
  return { revision, procedures: expected as DbhExpectedManifest['procedures'], seeds };
}

export async function runDbhRescoreCli(args: DbhRescoreCliArgs, deps: DbhSweepDependencies, log: (line: string) => void = console.log): Promise<number> {
  log(`DBH re-score fixed validation IDs: 1 (${DBH_GROWTH_PROCEDURE}), 2 (${DBH_SHRINKAGE_PROCEDURE})`);
  const schemas = args.schema ? [args.schema] : await deps.discoverSchemas?.();
  if (!schemas) throw new Error('All-site DBH sweep requires schema discovery');
  const all: DbhSweepScope[] = [];
  for (const schema of schemas) all.push(...(await deps.discoverScopes(schema)));
  const plan = planDbhSweep(all, { plotID: args.plotID, censusID: args.censusID }, schemas);
  log(`Rule revision preflight covers: ${schemas.join(', ') || '(no schemas)'}`);
  log(`Ordered scopes: ${plan.scopes.map(scope => `${scope.schema}/${scope.plotID}/${scope.censusID}#${scope.plotCensusNumber}`).join(', ') || '(none)'}`);
  if (plan.followOn.length)
    log(
      `Later dependent scopes not selected: ${plan.followOn.map(scope => `${scope.schema}/${scope.plotID}/${scope.censusID}#${scope.plotCensusNumber}`).join(', ')}`
    );
  const preflightReasons = new Map<string, string | undefined>();
  const instrumentedDeps: DbhSweepDependencies = {
    ...deps,
    advisoryPreflight: async scope => {
      const preflight = await deps.advisoryPreflight(scope);
      preflightReasons.set(`${scope.schema}/${scope.plotID}/${scope.censusID}`, preflight.deferred);
      return preflight;
    }
  };
  const result = await runDbhSweep(plan, instrumentedDeps, args.apply);
  if (!args.apply) {
    for (const scope of plan.scopes) {
      const key = `${scope.schema}/${scope.plotID}/${scope.censusID}`;
      const reason = preflightReasons.has(key)
        ? preflightReasons.get(key)
        : result.deferred.some(deferred => deferred.schema === scope.schema && deferred.plotID === scope.plotID && deferred.censusID === scope.censusID)
          ? 'blocked by an earlier deferred scope in this plot'
          : undefined;
      log(`Read-only preflight ${key}#${scope.plotCensusNumber}: ${reason ?? 'ready'}`);
    }
  }
  for (const held of result.results.filter(row => row.outcome === 'held-valid-to-invalid')) {
    log(
      `Held for review (attempt ${held.attemptID}): ${held.validToInvalidMeasurementIDs?.length ?? 0} valid measurement(s) would become invalid; IDs are in the artifact. Rerun with --allow-valid-to-invalid after review.`
    );
  }
  if (result.deferred.length)
    log(`Deferred scopes: ${result.deferred.map(scope => `${scope.schema}/${scope.plotID}/${scope.censusID}#${scope.plotCensusNumber}`).join(', ')}`);
  if (result.earliestUnfinished.size)
    log(
      `Earliest unfinished by plot: ${[...result.earliestUnfinished.entries()]
        .map(([plot, scope]) => `${plot}=${scope.censusID}#${scope.plotCensusNumber}`)
        .join(', ')}`
    );
  return result.halted || result.deferred.length > 0 || (args.apply && result.results.some(row => row.outcome !== 'completed')) ? 1 : 0;
}

function normalizeDefinition(value: string): string {
  return value
    .replace(/--[^\r\n]*/g, '')
    .replace(/CREATE\s+DEFINER\s*=\s*[^\s]+\s+PROCEDURE/i, 'CREATE PROCEDURE')
    .replace(/\bSQL\s+SECURITY\s+DEFINER\b/gi, '')
    .replace(/(CREATE\s+PROCEDURE\s+)`[^`]+`\./i, '$1')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .replace(/;\s*$/, '')
    .trim()
    .toLowerCase();
}
function sameDefinition(expected: string, actual: string): boolean {
  return normalizeDefinition(expected) === normalizeDefinition(actual);
}
function enabled(value: unknown): boolean {
  return Buffer.isBuffer(value) ? value[0] === 1 : value === true || Number(value) === 1;
}
function sqlIdentifier(schema: string): string {
  validateSchemaOrThrow(schema);
  return mysql.format('??', [schema]);
}

export async function appendDurableJsonLine(artifactPath: string, event: Record<string, unknown>): Promise<void> {
  const handle = await open(artifactPath, 'a');
  try {
    await handle.writeFile(`${JSON.stringify(event)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function buildRealSweepDeps(
  connection: mysql.Connection,
  manifest: DbhExpectedManifest,
  artifactPath?: string,
  timeoutMs?: number,
  options: { requireEnabled?: boolean; allowValidToInvalid?: boolean } = {}
): DbhSweepDependencies {
  const requireEnabled = options.requireEnabled ?? true;
  const allowValidToInvalid = options.allowValidToInvalid ?? false;
  return {
    discoverScopes: async schema => {
      const qualified = sqlIdentifier(schema);
      const [rows] = await connection.query<CensusScopeRow[]>(
        `SELECT CensusID censusID, PlotID plotID, PlotCensusNumber plotCensusNumber FROM ${qualified}.census WHERE IsActive = TRUE`
      );
      return rows.map(row => ({ schema, censusID: Number(row.censusID), plotID: Number(row.plotID), plotCensusNumber: Number(row.plotCensusNumber) }));
    },
    verifySchema: async schema => {
      // Fail the all-target verification before any census mutation when the
      // shared job catalog is absent, incompatible, or unreadable.
      await connection.query('SELECT SchemaName, PlotID, CensusID, Status FROM catalog.background_jobs LIMIT 0');
      const requiredTables = [
        'census',
        'coremeasurements',
        'trees',
        'stems',
        'plots',
        'cmattributes',
        'attributes',
        'measurement_error_log',
        'measurement_errors',
        'sitespecificvalidations',
        'validation_runs',
        'upload_sessions',
        'measurementssummary',
        'viewfulltable'
      ];
      const [tableRows] = await connection.query<TableNameRow[]>(
        `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
        [schema, requiredTables]
      );
      const found = new Set(tableRows.map(row => row.TABLE_NAME));
      const missing = requiredTables.filter(table => !found.has(table));
      if (missing.length) throw new Error(`${schema}: required tables missing: ${missing.join(', ')}`);
      for (const [name, expected] of Object.entries(manifest.procedures)) {
        const [rows] = await connection.query<ProcedureDefinitionRow[]>(`SHOW CREATE PROCEDURE ${sqlIdentifier(schema)}.${mysql.format('??', [name])}`);
        const actual = rows[0]?.['Create Procedure'];
        if (typeof actual !== 'string' || !sameDefinition(expected, actual))
          throw new Error(`${schema}: ${name} differs from expected revision ${manifest.revision}`);
      }
      const qualified = sqlIdentifier(schema);
      const [rules] = await connection.query<ValidationRuleRow[]>(
        `SELECT ValidationID, ProcedureName, Description, Definition, IsEnabled FROM ${qualified}.sitespecificvalidations WHERE ValidationID IN (1, 2)`
      );
      for (const expected of manifest.seeds) {
        const actual = rules.filter(row => Number(row.ValidationID) === expected.validationID);
        if (
          actual.length !== 1 ||
          actual[0].ProcedureName !== expected.procedureName ||
          actual[0].Description !== expected.description ||
          actual[0].Definition !== expected.definition ||
          (requireEnabled && !enabled(actual[0].IsEnabled))
        )
          throw new Error(`${schema}: ValidationID ${expected.validationID} differs from expected revision ${manifest.revision}`);
      }
      return {
        revision: manifest.revision,
        digests: Object.fromEntries(
          [
            ...Object.entries(manifest.procedures),
            ...manifest.seeds.map(seed => [String(seed.validationID), `${seed.procedureName}|${seed.description}|${seed.definition}`])
          ].map(([name, body]) => [name, dbhRuleDigest(body)])
        )
      };
    },
    advisoryPreflight: async scope => {
      const qualified = sqlIdentifier(scope.schema);
      const [censuses] = await connection.query<CensusRow[]>(
        `SELECT CensusID, PlotCensusNumber FROM ${qualified}.census WHERE PlotID=? AND CensusID=? AND IsActive=1`,
        [scope.plotID, scope.censusID]
      );
      const current = censuses[0];
      const ids = [scope.censusID];
      if (Number(current?.PlotCensusNumber) > 1) {
        const [prior] = await connection.query<Array<RowDataPacket & Pick<CensusRow, 'CensusID'>>>(
          `SELECT CensusID FROM ${qualified}.census WHERE PlotID=? AND PlotCensusNumber=? AND IsActive=1`,
          [scope.plotID, Number(current.PlotCensusNumber) - 1]
        );
        if (prior.length === 1) ids.push(Number(prior[0].CensusID));
      }
      const [running] = await connection.query<CountRow[]>(
        `SELECT COUNT(*) count FROM ${qualified}.validation_runs WHERE PlotID=? AND CensusID IN (?) AND Status='running'`,
        [scope.plotID, ids]
      );
      const [uploads] = await connection.query<CountRow[]>(
        `SELECT COUNT(*) count FROM ${qualified}.upload_sessions WHERE plot_id=? AND census_id IN (?) AND state IN (?)`,
        [scope.plotID, ids, ACTIVE_UPLOAD_SESSION_STATES]
      );
      const [pending] = await connection.query<CountRow[]>(
        `SELECT COUNT(*) count FROM ${qualified}.coremeasurements WHERE CensusID IN (?) AND IsActive=TRUE AND StemGUID IS NOT NULL AND IsValidated IS NULL`,
        [ids]
      );
      const [jobs] = await connection.query<CountRow[]>(
        `SELECT COUNT(*) count FROM catalog.background_jobs WHERE SchemaName=? AND PlotID=? AND CensusID IN (?)
         AND Status IN (?)`,
        [scope.schema, scope.plotID, ids, NON_TERMINAL_BACKGROUND_JOB_STATUSES]
      );
      return Number(running[0]?.count ?? 0) > 0
        ? { deferred: 'running validation record' }
        : Number(uploads[0]?.count ?? 0) > 0
          ? { deferred: 'active upload' }
          : Number(pending[0]?.count ?? 0) > 0
            ? { deferred: 'eligible pending measurements' }
            : Number(jobs[0]?.count ?? 0) > 0
              ? { deferred: 'active background job' }
              : {};
    },
    rescore: scope =>
      rescoreDbhCensus(scope, {
        timeoutMs,
        allowValidToInvalid,
        ...(artifactPath ? { writeArtifact: event => appendDurableJsonLine(artifactPath, { ...event }) } : {})
      }),
    writeArtifact: async event => {
      if (artifactPath) await appendDurableJsonLine(artifactPath, event);
    },
    now: () => new Date().toISOString()
  };
}

/** Creates a fresh directory and fails if it is not writable; never overwrites a prior run. */
export async function createArtifactPath(directory: string, runID: string): Promise<string> {
  await mkdir(directory, { recursive: true });
  const artifactPath = path.join(directory, `dbh-rescore-${runID}.jsonl`);
  const handle = await open(artifactPath, 'wx');
  await handle.close();
  return artifactPath;
}
