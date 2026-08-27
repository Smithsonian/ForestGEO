/**
 * Deploy Validation Queries and Stored Procedures to All ForestGEO Schemas
 *
 * Three CLI modes, dispatched by parseMode()/main() and fail-closed before any
 * SQL is read or connection opened:
 *
 *   (no flag)                 legacy-full-reset  — applies corequeries.sql
 *                              (which starts with `TRUNCATE sitespecificvalidations`)
 *                              and storedprocedures.sql to every migrated
 *                              forestgeo_* schema. Unchanged behavior.
 *
 *   --procedures-only          deployProceduresOnly — applies ONLY the parsed
 *                              statements from storedprocedures.sql. Never
 *                              reads corequeries.sql, so it can never truncate
 *                              sitespecificvalidations. Safe to run against
 *                              schemas that already carry site-authored
 *                              validation rows and hand-toggled IsEnabled
 *                              values.
 *
 *   --activate-validation-19   activateValidation19 — enables validation 19
 *                              (ValidatePlotCoordinateConsistency) only on
 *                              schemas where the full REQUIRED_PROCEDURES
 *                              contract, the measurement_errors row, and the
 *                              exact (19, ValidatePlotCoordinateConsistency)
 *                              validation identity all verify first.
 *
 * Schemas that have NOT been migrated (missing measurement_error_log /
 * measurement_errors tables) are skipped in legacy-full-reset and
 * procedures-only mode, since the new definitions would fail at runtime.
 *
 * Usage:
 *   npx tsx scripts/deploy-validations-to-all-schemas.ts
 *   npx tsx scripts/deploy-validations-to-all-schemas.ts --procedures-only
 *   npx tsx scripts/deploy-validations-to-all-schemas.ts --activate-validation-19
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateSchemaOrThrow } from '@/lib/db/sqlsecurity';
import { REQUIRED_PROCEDURES } from '@/lib/provisioning/steps/sql-steps';

export const AZURE_HOST = 'forestgeo-mysqldataserver.mysql.database.azure.com';
export const AZURE_USER = 'azureroot';
export const AZURE_PORT = 3306;

const REQUIRED_MIGRATION_TABLES = ['measurement_error_log', 'measurement_errors'] as const;

export interface SchemaResult {
  schema: string;
  status: 'deployed' | 'skipped' | 'failed';
  detail: string;
}

/**
 * Parse storedprocedures.sql into executable statements.
 *
 * The file uses MySQL client DELIMITER directives which mysql2 cannot handle
 * directly. We strip the DELIMITER lines, split on the custom delimiter ($$),
 * and return individual CREATE/DROP statements.
 */
export function parseStoredProceduresSQL(raw: string): string[] {
  const statements: string[] = [];
  let currentDelimiter = ';';
  let buffer = '';

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();

    if (/^DELIMITER\s+/i.test(trimmed)) {
      // Flush anything accumulated before the delimiter change
      const pending = buffer.trim();
      if (pending.length > 0 && pending !== currentDelimiter) {
        statements.push(pending);
      }
      buffer = '';
      currentDelimiter = trimmed.replace(/^DELIMITER\s+/i, '').trim();
      continue;
    }

    buffer += line + '\n';

    // Check if the buffer ends with the current delimiter
    const trimmedBuffer = buffer.trimEnd();
    if (currentDelimiter !== ';' && trimmedBuffer.endsWith(currentDelimiter)) {
      const stmt = trimmedBuffer.slice(0, -currentDelimiter.length).trim();
      if (stmt.length > 0) {
        statements.push(stmt);
      }
      buffer = '';
    }
  }

  // Flush remaining buffer (handles trailing statements after final DELIMITER ;)
  const remaining = buffer.trim();
  if (remaining.length > 0) {
    // Split on semicolons for any remaining simple statements
    for (const part of remaining.split(';')) {
      const stmt = part.trim();
      if (stmt.length > 0 && !stmt.startsWith('--')) {
        statements.push(stmt);
      }
    }
  }

  return statements;
}

export async function checkMigrationStatus(conn: mysql.Connection, schema: string): Promise<{ migrated: boolean; missingTables: string[] }> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME as table_name
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
    [schema, [...REQUIRED_MIGRATION_TABLES]]
  );

  const foundTables = new Set(rows.map((r: any) => r.table_name));
  const missingTables = REQUIRED_MIGRATION_TABLES.filter(t => !foundTables.has(t));

  return { migrated: missingTables.length === 0, missingTables };
}

async function deployStoredProcedures(conn: mysql.Connection, statements: readonly string[]): Promise<void> {
  for (const stmt of statements) {
    await conn.query(stmt);
  }
}

export function countEnabledValidations(validations: mysql.RowDataPacket[]): number {
  return validations.filter((v: any) => {
    const enabled = v.IsEnabled;
    return enabled === 1 || enabled === true || (Buffer.isBuffer(enabled) && enabled[0] === 1);
  }).length;
}

// ---------------------------------------------------------------------------
// Task 13 primitives: procedures-only deployment + gated validation 19
// activation. Every schema name that reaches SQL is validated first; USE is
// built with mysql2 identifier formatting, never string interpolation.
// ---------------------------------------------------------------------------

function useSchemaSql(schema: string): string {
  validateSchemaOrThrow(schema);
  return mysql.format('USE ??', [schema]);
}

async function assertRequiredProcedures(conn: mysql.Connection, schema: string): Promise<void> {
  const [rows]: any = await conn.query(
    `SELECT LOWER(ROUTINE_NAME) AS name
       FROM information_schema.ROUTINES
      WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'`,
    [schema]
  );
  const actual = new Set(rows.map((row: any) => String(row.name)));
  const missing = REQUIRED_PROCEDURES.filter(name => !actual.has(name.toLowerCase()));
  if (missing.length > 0) {
    throw new Error(`${schema}: procedure deployment incomplete; missing ${missing.join(', ')}`);
  }
}

/**
 * Deploys ONLY the already-parsed statements from storedprocedures.sql. Never
 * reads corequeries.sql — that file's leading `TRUNCATE sitespecificvalidations`
 * is exactly what makes the legacy full-reset path unsafe to run against
 * schemas carrying site-authored validation rows. Verifies the full
 * REQUIRED_PROCEDURES contract before returning, so a caller can never treat a
 * partially-applied schema as deployed.
 */
export async function deployProceduresOnly(conn: mysql.Connection, schema: string, statements: readonly string[]): Promise<void> {
  await conn.query(useSchemaSql(schema));
  for (const stmt of statements) {
    await conn.query(stmt);
  }
  await assertRequiredProcedures(conn, schema);
}

/**
 * Enables validation 19 (ValidatePlotCoordinateConsistency) only after every
 * dependency verifies: the full REQUIRED_PROCEDURES contract (which includes
 * RunPlotCoordinateConsistencyValidation), the measurement_errors row that
 * links flagged rows to the error catalog, and the exact
 * (19, ValidatePlotCoordinateConsistency) validation identity with no
 * conflicting row. Re-reads after the UPDATE to verify persistence.
 */
export async function activateValidation19(conn: mysql.Connection, schema: string): Promise<void> {
  await conn.query(useSchemaSql(schema));
  await assertRequiredProcedures(conn, schema);

  const [errs]: any = await conn.query(`SELECT ErrorID FROM measurement_errors WHERE ErrorSource = 'validation' AND ErrorCode = '19'`);
  if (errs.length === 0) {
    throw new Error(`${schema}: measurement_errors row for validation 19 is missing; run the migration before activating`);
  }

  const [validations]: any = await conn.query(
    `SELECT ValidationID, ProcedureName, IsEnabled
       FROM sitespecificvalidations
      WHERE ValidationID = 19 OR ProcedureName = 'ValidatePlotCoordinateConsistency'`
  );
  if (validations.length !== 1 || Number(validations[0].ValidationID) !== 19 || validations[0].ProcedureName !== 'ValidatePlotCoordinateConsistency') {
    throw new Error(`${schema}: validation 19 identity is missing or conflicting; expected exactly (19, ValidatePlotCoordinateConsistency)`);
  }

  await conn.query(
    `UPDATE sitespecificvalidations SET IsEnabled = TRUE
      WHERE ValidationID = 19 AND ProcedureName = 'ValidatePlotCoordinateConsistency'`
  );

  const [verified]: any = await conn.query(
    `SELECT IsEnabled FROM sitespecificvalidations
      WHERE ValidationID = 19 AND ProcedureName = 'ValidatePlotCoordinateConsistency'`
  );
  if (verified.length !== 1 || countEnabledValidations(verified) !== 1) {
    throw new Error(`${schema}: validation 19 activation did not persist`);
  }
}

async function createSchemaConnection(schema: string): Promise<mysql.Connection> {
  const azurePassword = requireAzurePassword();
  return mysql.createConnection({
    host: AZURE_HOST,
    user: AZURE_USER,
    password: azurePassword,
    database: schema,
    port: AZURE_PORT,
    multipleStatements: false
  });
}

/**
 * Owns a single per-schema connection end to end: validates the schema name,
 * opens the connection, and closes it in `finally` on both success and
 * failure. Routine DDL is not transactional — a failed middle statement can
 * leave earlier DROP/CREATE operations committed — so this helper only
 * guarantees the connection is released, not that a failed deploy left the
 * schema in a clean state. Recovery is to fix the failing statement and rerun
 * the complete procedures-only deployment for that schema.
 */
export async function withSchemaConnection<T>(
  schema: string,
  fn: (conn: mysql.Connection) => Promise<T>,
  connect: (schema: string) => Promise<mysql.Connection> = createSchemaConnection
): Promise<T> {
  validateSchemaOrThrow(schema);
  const conn = await connect(schema);
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

// ---------------------------------------------------------------------------
// CLI dependency injection — lets tests exercise the exact dispatch used by
// npm without opening a real connection or touching the real filesystem.
// ---------------------------------------------------------------------------

export interface DeployCliDeps {
  readSqlFile: (filePath: string) => string;
  createConnection: (options: mysql.ConnectionOptions) => Promise<mysql.Connection>;
  discoverSchemas: (conn: mysql.Connection) => Promise<string[]>;
  checkMigrationStatus: (conn: mysql.Connection, schema: string) => Promise<{ migrated: boolean; missingTables: string[] }>;
  log: (message?: string) => void;
}

function readSqlFileOrThrow(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`SQL file not found at: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

async function discoverForestGeoSchemas(conn: mysql.Connection): Promise<string[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT SCHEMA_NAME as schema_name
       FROM INFORMATION_SCHEMA.SCHEMATA
      WHERE SCHEMA_NAME LIKE 'forestgeo_%'
      ORDER BY SCHEMA_NAME`
  );
  return rows.map((r: any) => String(r.schema_name));
}

export const realDeps: DeployCliDeps = {
  readSqlFile: readSqlFileOrThrow,
  createConnection: options => mysql.createConnection(options),
  discoverSchemas: discoverForestGeoSchemas,
  checkMigrationStatus,
  log: (message = '') => console.log(message)
};

function requireAzurePassword(): string {
  const azurePassword = process.env.AZURE_SQL_PASSWORD;
  if (!azurePassword) {
    throw new Error('AZURE_SQL_PASSWORD environment variable not set. Please set the password in your environment or .env.local file.');
  }
  return azurePassword;
}

function discoveryConnectionOptions(password: string): mysql.ConnectionOptions {
  return { host: AZURE_HOST, user: AZURE_USER, password, port: AZURE_PORT, multipleStatements: false };
}

function schemaConnectionOptions(password: string, schema: string, multipleStatements = false): mysql.ConnectionOptions {
  return { host: AZURE_HOST, user: AZURE_USER, password, database: schema, port: AZURE_PORT, multipleStatements };
}

function sqlSourceDir(): string {
  return path.join(process.cwd(), 'db/sql');
}

function reportSummary(deps: DeployCliDeps, title: string, results: SchemaResult[], totalSchemas: number): void {
  const deployed = results.filter(r => r.status === 'deployed');
  const skipped = results.filter(r => r.status === 'skipped');
  const failed = results.filter(r => r.status === 'failed');

  deps.log('═══════════════════════════════════════════════════');
  deps.log(`${title} Summary`);
  deps.log('═══════════════════════════════════════════════════');
  deps.log(`Total schemas:  ${totalSchemas}`);
  deps.log(`Deployed:       ${deployed.length}`);
  deps.log(`Skipped:        ${skipped.length}`);
  deps.log(`Failed:         ${failed.length}`);
  deps.log('');

  if (deployed.length > 0) {
    deps.log('Deployed to:');
    deployed.forEach(r => deps.log(`  + ${r.schema}: ${r.detail}`));
    deps.log('');
  }
  if (skipped.length > 0) {
    deps.log('Skipped:');
    skipped.forEach(r => deps.log(`  ~ ${r.schema}: ${r.detail}`));
    deps.log('');
  }
  if (failed.length > 0) {
    deps.log('Failed:');
    failed.forEach(r => deps.log(`  x ${r.schema}: ${r.detail}`));
    throw new Error(`${title} failed for ${failed.length} schema(s). See the log above for detail.`);
  }
}

// ---------------------------------------------------------------------------
// legacy-full-reset — unchanged behavior: corequeries.sql (which TRUNCATEs
// sitespecificvalidations) + storedprocedures.sql applied to every migrated
// schema. The one deliberate fix versus the pre-Task-13 version: the
// per-schema connection now closes in `finally` on the failure path too
// (previously leaked on error, since `.end()` only ran on the success path).
// ---------------------------------------------------------------------------

async function runLegacyFullReset(deps: DeployCliDeps): Promise<void> {
  deps.log('Starting validation and stored procedure deployment to all ForestGEO schemas...\n');
  const password = requireAzurePassword();

  const discoveryConnection = await deps.createConnection(discoveryConnectionOptions(password));

  try {
    deps.log('[Step 1] Finding all ForestGEO schemas...');
    const schemas = await deps.discoverSchemas(discoveryConnection);

    if (schemas.length === 0) {
      deps.log('No forestgeo_* schemas found!');
      return;
    }

    deps.log(`Found ${schemas.length} ForestGEO schemas:`);
    schemas.forEach(schema => deps.log(`  - ${schema}`));
    deps.log('');

    deps.log('[Step 2] Reading SQL source files...');
    const scriptingDir = sqlSourceDir();
    const corequeriesSQL = deps.readSqlFile(path.join(scriptingDir, 'corequeries.sql'));
    deps.log(`  corequeries.sql: ${corequeriesSQL.length} chars`);
    const storedprocsRaw = deps.readSqlFile(path.join(scriptingDir, 'storedprocedures.sql'));
    const storedprocStatements = parseStoredProceduresSQL(storedprocsRaw);
    deps.log(`  storedprocedures.sql: ${storedprocsRaw.length} chars, ${storedprocStatements.length} statements`);
    deps.log('');

    deps.log('[Step 3] Checking migration status and deploying...\n');

    const results: SchemaResult[] = [];

    for (const schema of schemas) {
      deps.log(`Processing: ${schema}`);

      try {
        const { migrated, missingTables } = await deps.checkMigrationStatus(discoveryConnection, schema);

        if (!migrated) {
          const detail = `Missing tables: ${missingTables.join(', ')}. Run run-migrations.sh against this schema first.`;
          deps.log(`  SKIPPED (not migrated) - ${detail}`);
          results.push({ schema, status: 'skipped', detail });
          deps.log('');
          continue;
        }

        const schemaConnection = await deps.createConnection(schemaConnectionOptions(password, schema, true));
        try {
          await deployStoredProcedures(schemaConnection, storedprocStatements);
          deps.log('  Stored procedures deployed');

          await schemaConnection.query(corequeriesSQL);

          const [validations] = await schemaConnection.query<mysql.RowDataPacket[]>(
            'SELECT ValidationID, ProcedureName, IsEnabled FROM sitespecificvalidations ORDER BY ValidationID'
          );
          const enabledCount = countEnabledValidations(validations);
          const detail = `${validations.length} validations (${enabledCount} enabled), stored procedures updated`;
          deps.log(`  OK - ${detail}`);
          results.push({ schema, status: 'deployed', detail });
        } finally {
          await schemaConnection.end();
        }
      } catch (error: any) {
        deps.log(`  FAILED: ${error.message}`);
        results.push({ schema, status: 'failed', detail: error.message });
      }

      deps.log('');
    }

    reportSummary(deps, 'Deployment', results, schemas.length);
  } finally {
    await discoveryConnection.end();
  }
}

// ---------------------------------------------------------------------------
// --procedures-only — never reads corequeries.sql. A schema is reported
// deployed only after deployProceduresOnly's post-deploy REQUIRED_PROCEDURES
// verification passes; a schema that fails verification never proceeds to
// activation (activation is a separate, later CLI invocation).
// ---------------------------------------------------------------------------

async function runProceduresOnlyForAllSchemas(deps: DeployCliDeps): Promise<void> {
  deps.log('Starting procedures-only deployment to all ForestGEO schemas...\n');
  const password = requireAzurePassword();

  deps.log('[Step 1] Reading storedprocedures.sql (corequeries.sql is never read in this mode)...');
  const storedprocsRaw = deps.readSqlFile(path.join(sqlSourceDir(), 'storedprocedures.sql'));
  const statements = parseStoredProceduresSQL(storedprocsRaw);
  deps.log(`  storedprocedures.sql: ${storedprocsRaw.length} chars, ${statements.length} statements\n`);

  const discoveryConnection = await deps.createConnection(discoveryConnectionOptions(password));
  try {
    deps.log('[Step 2] Finding all ForestGEO schemas...');
    const schemas = await deps.discoverSchemas(discoveryConnection);

    if (schemas.length === 0) {
      deps.log('No forestgeo_* schemas found!');
      return;
    }
    deps.log(`Found ${schemas.length} ForestGEO schemas.\n`);

    deps.log('[Step 3] Deploying stored procedures to each migrated schema...\n');
    const results: SchemaResult[] = [];

    for (const schema of schemas) {
      deps.log(`Processing: ${schema}`);
      try {
        const { migrated, missingTables } = await deps.checkMigrationStatus(discoveryConnection, schema);
        if (!migrated) {
          const detail = `Missing tables: ${missingTables.join(', ')}. Run run-migrations.sh against this schema first.`;
          deps.log(`  SKIPPED (not migrated) - ${detail}`);
          results.push({ schema, status: 'skipped', detail });
          deps.log('');
          continue;
        }

        await withSchemaConnection(
          schema,
          conn => deployProceduresOnly(conn, schema, statements),
          s => deps.createConnection(schemaConnectionOptions(password, s, false))
        );

        const detail = `stored procedures deployed and REQUIRED_PROCEDURES verified (${REQUIRED_PROCEDURES.length} procedures)`;
        deps.log(`  OK - ${detail}`);
        results.push({ schema, status: 'deployed', detail });
      } catch (error: any) {
        deps.log(`  FAILED: ${error.message}`);
        results.push({ schema, status: 'failed', detail: error.message });
      }
      deps.log('');
    }

    reportSummary(deps, 'Procedures-only deployment', results, schemas.length);
  } finally {
    await discoveryConnection.end();
  }
}

// ---------------------------------------------------------------------------
// --activate-validation-19 — reads no SQL file at all. Each schema is gated
// through activateValidation19's own dependency checks; a schema that fails
// any one of them is reported failed with the specific reason, never enabled.
// ---------------------------------------------------------------------------

async function runActivateValidation19ForAllSchemas(deps: DeployCliDeps): Promise<void> {
  deps.log('Activating validation 19 (ValidatePlotCoordinateConsistency) on eligible ForestGEO schemas...\n');
  const password = requireAzurePassword();

  const discoveryConnection = await deps.createConnection(discoveryConnectionOptions(password));
  try {
    deps.log('[Step 1] Finding all ForestGEO schemas...');
    const schemas = await deps.discoverSchemas(discoveryConnection);

    if (schemas.length === 0) {
      deps.log('No forestgeo_* schemas found!');
      return;
    }
    deps.log(`Found ${schemas.length} ForestGEO schemas.\n`);

    deps.log('[Step 2] Activating validation 19 on each eligible schema...\n');
    const results: SchemaResult[] = [];

    for (const schema of schemas) {
      deps.log(`Processing: ${schema}`);
      try {
        await withSchemaConnection(
          schema,
          conn => activateValidation19(conn, schema),
          s => deps.createConnection(schemaConnectionOptions(password, s, false))
        );

        const detail = 'validation 19 (ValidatePlotCoordinateConsistency) enabled';
        deps.log(`  OK - ${detail}`);
        results.push({ schema, status: 'deployed', detail });
      } catch (error: any) {
        deps.log(`  FAILED: ${error.message}`);
        results.push({ schema, status: 'failed', detail: error.message });
      }
      deps.log('');
    }

    reportSummary(deps, 'Validation 19 activation', results, schemas.length);
  } finally {
    await discoveryConnection.end();
  }
}

// ---------------------------------------------------------------------------
// Fail-closed CLI mode parsing + dispatch. Unknown flags or more than one
// mode flag reject BEFORE any SQL is read or any connection opened.
// ---------------------------------------------------------------------------

export type DeployMode = 'legacy-full-reset' | 'procedures-only' | 'activate-validation-19';

const MODE_FLAGS: Readonly<Record<string, DeployMode>> = {
  '--procedures-only': 'procedures-only',
  '--activate-validation-19': 'activate-validation-19'
};

export function parseMode(argv: readonly string[]): DeployMode {
  const unknownArgs = argv.filter(arg => !(arg in MODE_FLAGS));
  if (unknownArgs.length > 0) {
    throw new Error(`Unknown CLI argument(s): ${unknownArgs.join(', ')}. Supported flags: ${Object.keys(MODE_FLAGS).join(', ')}.`);
  }

  const distinctModes = new Set(argv.map(arg => MODE_FLAGS[arg]));
  if (distinctModes.size > 1) {
    throw new Error(`Conflicting CLI mode flags: ${argv.join(' ')}. Pass at most one of ${Object.keys(MODE_FLAGS).join(', ')}.`);
  }

  const [mode] = distinctModes;
  return mode ?? 'legacy-full-reset';
}

export async function main(argv: readonly string[], deps: DeployCliDeps = realDeps): Promise<void> {
  const mode = parseMode(argv);

  if (mode === 'procedures-only') {
    await runProceduresOnlyForAllSchemas(deps);
    return;
  }
  if (mode === 'activate-validation-19') {
    await runActivateValidation19ForAllSchemas(deps);
    return;
  }
  await runLegacyFullReset(deps);
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main(process.argv.slice(2), realDeps)
    .then(() => {
      console.log('\nDone!');
    })
    .catch(error => {
      console.error('\nFailed:', error);
      process.exitCode = 1;
    });
}
