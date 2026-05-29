/**
 * Seed a local MySQL instance with the fixture the Cypress e2e suite needs.
 *
 * The e2e suite (cypress/e2e/census-creation.cy.ts) drives the real app against
 * a database. In CI that database is a throwaway MySQL service container, not
 * Azure — so this script builds, from scratch, the minimum data the dashboard
 * selection flow requires:
 *
 *   - a `catalog` schema with one `sites` row (the dashboard site dropdown reads
 *     `SELECT * FROM catalog.sites`; the e2e session is a `global` user, so every
 *     catalog site renders as an "allowed" option)
 *   - a per-site schema (`forestgeo_testing`) fully provisioned with table
 *     structures, stored procedures, validation definitions, and seeded plots /
 *     quadrats / census rows so the plot and census dropdowns populate
 *
 * Usage:
 *   cd frontend && npx tsx tests/setup/e2e-seed.ts
 *
 * Connection defaults match docker-compose.yml (root / testpassword / 127.0.0.1)
 * and can be overridden with TEST_DB_HOST / TEST_DB_PORT / TEST_DB_USER /
 * TEST_DB_PASSWORD.
 */

import fs from 'fs';
import path from 'path';
import { DEFAULT_TEST_CONFIG, log, setupTestDatabase, type TestDatabaseConfig } from './local-db-setup';

/** Schema name the e2e spec documents as its backing site schema. */
const SITE_SCHEMA = 'forestgeo_testing';
const CATALOG_SCHEMA = 'catalog';

/** The single catalog site the dashboard dropdown will offer. */
const E2E_SITE = {
  name: 'E2E Test Site',
  schemaName: SITE_SCHEMA,
  squareDimensionX: 20,
  squareDimensionY: 20,
  defaultUomDbh: 'cm',
  defaultUomHom: 'm',
  doubleDataEntry: 0
} as const;

const CATALOG_DDL_PATH = path.join(process.cwd(), 'sqlscripting', 'catalog-provisioning-tables.sql');

/**
 * Creates the `catalog` schema (idempotent DDL) and replaces its sites with the
 * single deterministic e2e fixture site. We clear `sites` / `usersiterelations`
 * first so the dropdown's "first option" is always our site, regardless of any
 * pre-existing rows on a reused local container. (In CI the DB is empty.)
 */
async function seedCatalog(connection: Awaited<ReturnType<typeof setupTestDatabase>>['connection']): Promise<void> {
  if (!fs.existsSync(CATALOG_DDL_PATH)) {
    throw new Error(`Catalog DDL not found: ${CATALOG_DDL_PATH}`);
  }

  log.info(`Loading catalog DDL into \`${CATALOG_SCHEMA}\` schema...`);
  const ddl = fs.readFileSync(CATALOG_DDL_PATH, 'utf-8');
  await connection.query(ddl);

  log.info(`Seeding single fixture site -> schema \`${SITE_SCHEMA}\`...`);
  await connection.query(`DELETE FROM ${CATALOG_SCHEMA}.usersiterelations`);
  await connection.query(`DELETE FROM ${CATALOG_SCHEMA}.sites`);
  await connection.query(
    `INSERT INTO ${CATALOG_SCHEMA}.sites
       (SiteName, SchemaName, SQDimX, SQDimY, DefaultUOMDBH, DefaultUOMHOM, DoubleDataEntry)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      E2E_SITE.name,
      E2E_SITE.schemaName,
      E2E_SITE.squareDimensionX,
      E2E_SITE.squareDimensionY,
      E2E_SITE.defaultUomDbh,
      E2E_SITE.defaultUomHom,
      E2E_SITE.doubleDataEntry
    ]
  );
}

async function seedE2EDatabase(): Promise<void> {
  const siteConfig: TestDatabaseConfig = { ...DEFAULT_TEST_CONFIG, database: SITE_SCHEMA };

  log.info(`Provisioning site schema \`${SITE_SCHEMA}\` (tables, procedures, validations, sample data)...`);
  const { connection } = await setupTestDatabase(siteConfig);

  try {
    await seedCatalog(connection);
    log.info('E2E fixture seeded successfully.');
  } finally {
    // Close the live connection but keep the seeded schemas — the app reads them.
    await connection.end();
  }
}

seedE2EDatabase()
  .then(() => process.exit(0))
  .catch(error => {
    log.error(`E2E seed failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
