/**
 * Backfill the taxonomy views (alltaxonomiesview, stemtaxonomiesview) into all
 * existing ForestGEO site schemas.
 *
 * These views back the alltaxonomies / stemtaxonomies datagrids. They are defined
 * in db/sql/tablestructures.sql, so any site provisioned AFTER that file
 * gained them is fine. Sites provisioned earlier (or restored from a legacy
 * CTFSweb dump with a differently-shaped view) are missing the current
 * definition, which makes the species viewer fail with "error fetching data".
 *
 * The operation is non-destructive: it runs CREATE OR REPLACE VIEW only. It does
 * NOT drop, truncate, or reprovision anything. Schemas that lack the base
 * tables required by the views (species/genus/family/trees/stems) — e.g. the
 * catalog schema or legacy CTFS-format exports — are skipped.
 *
 * The view DDL is read from tablestructures.sql so this script and provisioning
 * stay in lockstep (single source of truth).
 *
 * Usage: npx tsx scripts/deploy-taxonomy-views-to-all-schemas.ts
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const AZURE_HOST = 'forestgeo-mysqldataserver.mysql.database.azure.com';
const AZURE_USER = 'azureroot';
const AZURE_PORT = 3306;

const TAXONOMY_VIEWS = ['alltaxonomiesview', 'stemtaxonomiesview'] as const;
const REQUIRED_BASE_TABLES = ['species', 'genus', 'family', 'trees', 'stems'] as const;

interface SchemaResult {
  schema: string;
  status: 'deployed' | 'skipped' | 'failed';
  detail: string;
}

/**
 * Extract the `CREATE OR REPLACE VIEW <name> ... ;` statement for each taxonomy
 * view from tablestructures.sql. The view bodies contain no inner semicolons, so
 * a non-greedy match up to the first `;` captures exactly one statement.
 */
function extractViewStatements(tablestructuresSQL: string): Map<string, string> {
  const statements = new Map<string, string>();
  for (const viewName of TAXONOMY_VIEWS) {
    const pattern = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+VIEW\\s+${viewName}\\b[\\s\\S]*?;`, 'i');
    const match = tablestructuresSQL.match(pattern);
    if (!match) {
      throw new Error(`Could not find CREATE OR REPLACE VIEW ${viewName} in tablestructures.sql`);
    }
    statements.set(viewName, match[0]);
  }
  return statements;
}

async function hasRequiredBaseTables(conn: mysql.Connection, schema: string): Promise<{ ready: boolean; missing: string[] }> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME as table_name
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME IN (?)`,
    [schema, [...REQUIRED_BASE_TABLES]]
  );
  const found = new Set(rows.map((r: any) => r.table_name));
  const missing = REQUIRED_BASE_TABLES.filter(t => !found.has(t));
  return { ready: missing.length === 0, missing };
}

async function deployTaxonomyViewsToAllSchemas() {
  console.log('Backfilling taxonomy views into all ForestGEO schemas...\n');

  if (!process.env.AZURE_SQL_PASSWORD) {
    console.error('Error: AZURE_SQL_PASSWORD environment variable not set');
    console.error('Please set the password in your environment or .env.local file');
    process.exit(1);
  }

  const azurePassword = process.env.AZURE_SQL_PASSWORD;

  const scriptingDir = path.join(process.cwd(), 'db/sql');
  const tablestructuresPath = path.join(scriptingDir, 'tablestructures.sql');
  if (!fs.existsSync(tablestructuresPath)) {
    throw new Error(`tablestructures.sql not found at: ${tablestructuresPath}`);
  }
  const viewStatements = extractViewStatements(fs.readFileSync(tablestructuresPath, 'utf8'));
  console.log(`Loaded ${viewStatements.size} view definitions from tablestructures.sql:`);
  for (const name of viewStatements.keys()) console.log(`  - ${name}`);
  console.log();

  const discoveryConnection = await mysql.createConnection({
    host: AZURE_HOST,
    user: AZURE_USER,
    password: azurePassword,
    port: AZURE_PORT,
    multipleStatements: false
  });

  try {
    console.log('[Step 1] Finding all ForestGEO schemas...');
    const [schemas] = await discoveryConnection.query<mysql.RowDataPacket[]>(
      `SELECT SCHEMA_NAME as schema_name
       FROM INFORMATION_SCHEMA.SCHEMATA
       WHERE SCHEMA_NAME LIKE 'forestgeo_%'
       ORDER BY SCHEMA_NAME`
    );

    // A discovery failure must never read as "nothing to deploy" — this runs as a
    // deploy gate, where exiting 0 on zero schemas is a silent false green.
    if (schemas.length === 0) {
      console.error('No forestgeo_* schemas found. Refusing to report success against zero schemas.');
      process.exit(1);
    }

    console.log(`Found ${schemas.length} ForestGEO schemas.\n`);
    console.log('[Step 2] Applying views to each schema that has base taxonomy tables...\n');

    const results: SchemaResult[] = [];

    for (const row of schemas) {
      const schema = (row as any).schema_name;
      console.log(`Processing: ${schema}`);

      try {
        const { ready, missing } = await hasRequiredBaseTables(discoveryConnection, schema);
        if (!ready) {
          const detail = `Missing base tables: ${missing.join(', ')}. Not a provisioned site schema — skipped.`;
          console.log(`  SKIPPED - ${detail}`);
          results.push({ schema, status: 'skipped', detail });
          console.log();
          continue;
        }

        const schemaConnection = await mysql.createConnection({
          host: AZURE_HOST,
          user: AZURE_USER,
          password: azurePassword,
          database: schema,
          port: AZURE_PORT,
          multipleStatements: false
        });

        try {
          for (const [name, stmt] of viewStatements) {
            await schemaConnection.query(stmt);
            console.log(`  ${name} applied`);
          }
        } finally {
          await schemaConnection.end();
        }

        results.push({ schema, status: 'deployed', detail: `${viewStatements.size} views applied` });
      } catch (error: any) {
        console.log(`  FAILED: ${error.message}`);
        results.push({ schema, status: 'failed', detail: error.message });
      }

      console.log();
    }

    console.log('═══════════════════════════════════════════════════');
    console.log('Backfill Summary');
    console.log('═══════════════════════════════════════════════════');

    const deployed = results.filter(r => r.status === 'deployed');
    const skipped = results.filter(r => r.status === 'skipped');
    const failed = results.filter(r => r.status === 'failed');

    console.log(`Total schemas:  ${schemas.length}`);
    console.log(`Deployed:       ${deployed.length}`);
    console.log(`Skipped:        ${skipped.length} (no base taxonomy tables)`);
    console.log(`Failed:         ${failed.length}`);
    console.log();

    if (failed.length > 0) {
      console.log('Failed:');
      failed.forEach(r => console.log(`  x ${r.schema}: ${r.detail}`));
      process.exit(1);
    }

    console.log('Taxonomy views backfilled successfully!');
  } catch (error: any) {
    console.error('Fatal error:', error.message);
    throw error;
  } finally {
    await discoveryConnection.end();
  }
}

deployTaxonomyViewsToAllSchemas()
  .then(() => {
    console.log('\nBackfill complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\nBackfill failed:', error);
    process.exit(1);
  });
