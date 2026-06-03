/**
 * Deploy Validation Queries and Stored Procedures to All ForestGEO Schemas
 *
 * This script applies the latest validation queries from corequeries.sql
 * and stored procedures from storedprocedures.sql to all forestgeo_* schemas
 * that have been migrated to the unified measurements model.
 *
 * Schemas that have NOT been migrated (missing measurement_error_log /
 * measurement_errors tables) are skipped with a clear warning, since the
 * new validation definitions would fail at runtime on those schemas.
 *
 * Usage: npx tsx scripts/deploy-validations-to-all-schemas.ts
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const AZURE_HOST = 'forestgeo-mysqldataserver.mysql.database.azure.com';
const AZURE_USER = 'azureroot';
const AZURE_PORT = 3306;

const REQUIRED_MIGRATION_TABLES = ['measurement_error_log', 'measurement_errors'] as const;

interface SchemaResult {
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
function parseStoredProceduresSQL(raw: string): string[] {
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

async function checkMigrationStatus(conn: mysql.Connection, schema: string): Promise<{ migrated: boolean; missingTables: string[] }> {
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

async function deployStoredProcedures(conn: mysql.Connection, statements: string[]): Promise<void> {
  for (const stmt of statements) {
    await conn.query(stmt);
  }
}

function countEnabledValidations(validations: mysql.RowDataPacket[]): number {
  return validations.filter((v: any) => {
    const enabled = v.IsEnabled;
    return enabled === 1 || enabled === true || (Buffer.isBuffer(enabled) && enabled[0] === 1);
  }).length;
}

async function deployValidationsToAllSchemas() {
  console.log('Starting validation and stored procedure deployment to all ForestGEO schemas...\n');

  if (!process.env.AZURE_SQL_PASSWORD) {
    console.error('Error: AZURE_SQL_PASSWORD environment variable not set');
    console.error('Please set the password in your environment or .env.local file');
    process.exit(1);
  }

  const azurePassword = process.env.AZURE_SQL_PASSWORD;

  // Create discovery connection (no specific database)
  const discoveryConnection = await mysql.createConnection({
    host: AZURE_HOST,
    user: AZURE_USER,
    password: azurePassword,
    port: AZURE_PORT,
    multipleStatements: false
  });

  try {
    // Step 1: Discover schemas
    console.log('[Step 1] Finding all ForestGEO schemas...');
    const [schemas] = await discoveryConnection.query<mysql.RowDataPacket[]>(
      `SELECT SCHEMA_NAME as schema_name
       FROM INFORMATION_SCHEMA.SCHEMATA
       WHERE SCHEMA_NAME LIKE 'forestgeo_%'
       ORDER BY SCHEMA_NAME`
    );

    if (schemas.length === 0) {
      console.log('No forestgeo_* schemas found!');
      return;
    }

    console.log(`Found ${schemas.length} ForestGEO schemas:`);
    schemas.forEach((row: any) => console.log(`  - ${row.schema_name}`));
    console.log();

    // Step 2: Read SQL files
    console.log('[Step 2] Reading SQL source files...');
    const scriptingDir = path.join(process.cwd(), 'sqlscripting');

    const corequeriesPath = path.join(scriptingDir, 'corequeries.sql');
    if (!fs.existsSync(corequeriesPath)) {
      throw new Error(`corequeries.sql not found at: ${corequeriesPath}`);
    }
    const corequeriesSQL = fs.readFileSync(corequeriesPath, 'utf8');
    console.log(`  corequeries.sql: ${corequeriesSQL.length} chars`);

    const storedprocsPath = path.join(scriptingDir, 'storedprocedures.sql');
    if (!fs.existsSync(storedprocsPath)) {
      throw new Error(`storedprocedures.sql not found at: ${storedprocsPath}`);
    }
    const storedprocsRaw = fs.readFileSync(storedprocsPath, 'utf8');
    const storedprocStatements = parseStoredProceduresSQL(storedprocsRaw);
    console.log(`  storedprocedures.sql: ${storedprocsRaw.length} chars, ${storedprocStatements.length} statements`);
    console.log();

    // Step 3: Check migration status and deploy to each schema
    console.log('[Step 3] Checking migration status and deploying...\n');

    const results: SchemaResult[] = [];

    for (const row of schemas) {
      const schema = (row as any).schema_name;
      console.log(`Processing: ${schema}`);

      try {
        // Check migration status using discovery connection
        const { migrated, missingTables } = await checkMigrationStatus(discoveryConnection, schema);

        if (!migrated) {
          const detail = `Missing tables: ${missingTables.join(', ')}. Run run-migrations.sh against this schema first.`;
          console.log(`  SKIPPED (not migrated) - ${detail}`);
          results.push({ schema, status: 'skipped', detail });
          console.log();
          continue;
        }

        // Schema is migrated — deploy stored procedures then validation definitions
        const schemaConnection = await mysql.createConnection({
          host: AZURE_HOST,
          user: AZURE_USER,
          password: azurePassword,
          database: schema,
          port: AZURE_PORT,
          multipleStatements: true
        });

        // Deploy stored procedures (handles DELIMITER-parsed statements one at a time)
        await deployStoredProcedures(schemaConnection, storedprocStatements);
        console.log(`  Stored procedures deployed`);

        // Deploy validation definitions (corequeries.sql uses multipleStatements)
        await schemaConnection.query(corequeriesSQL);

        // Verify validations were loaded
        const [validations] = await schemaConnection.query<mysql.RowDataPacket[]>(
          'SELECT ValidationID, ProcedureName, IsEnabled FROM sitespecificvalidations ORDER BY ValidationID'
        );

        const enabledCount = countEnabledValidations(validations);

        await schemaConnection.end();

        const detail = `${validations.length} validations (${enabledCount} enabled), stored procedures updated`;
        console.log(`  OK - ${detail}`);
        results.push({ schema, status: 'deployed', detail });
      } catch (error: any) {
        console.log(`  FAILED: ${error.message}`);
        results.push({ schema, status: 'failed', detail: error.message });
      }

      console.log();
    }

    // Step 4: Summary
    console.log('═══════════════════════════════════════════════════');
    console.log('Deployment Summary');
    console.log('═══════════════════════════════════════════════════');

    const deployed = results.filter(r => r.status === 'deployed');
    const skipped = results.filter(r => r.status === 'skipped');
    const failed = results.filter(r => r.status === 'failed');

    console.log(`Total schemas:  ${schemas.length}`);
    console.log(`Deployed:       ${deployed.length}`);
    console.log(`Skipped:        ${skipped.length} (not migrated)`);
    console.log(`Failed:         ${failed.length}`);
    console.log();

    if (deployed.length > 0) {
      console.log('Deployed to:');
      deployed.forEach(r => console.log(`  + ${r.schema}: ${r.detail}`));
      console.log();
    }

    if (skipped.length > 0) {
      console.log('Skipped (migration required):');
      skipped.forEach(r => console.log(`  ~ ${r.schema}: ${r.detail}`));
      console.log();
    }

    if (failed.length > 0) {
      console.log('Failed:');
      failed.forEach(r => console.log(`  x ${r.schema}: ${r.detail}`));
      console.log();
    }

    if (failed.length > 0) {
      console.log('Some schemas failed to update. Please review errors above.');
      process.exit(1);
    }

    if (skipped.length > 0) {
      console.log(`WARNING: ${skipped.length} schema(s) skipped because they have not been migrated.`);
      console.log('Run run-migrations.sh against these schemas, then re-run this script.');
      console.log();
    }

    if (failed.length === 0 && skipped.length === 0) {
      console.log('All schemas updated successfully!');
    }
  } catch (error: any) {
    console.error('Fatal error:', error.message);
    throw error;
  } finally {
    await discoveryConnection.end();
  }
}

deployValidationsToAllSchemas()
  .then(() => {
    console.log('\nDeployment complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\nDeployment failed:', error);
    process.exit(1);
  });
