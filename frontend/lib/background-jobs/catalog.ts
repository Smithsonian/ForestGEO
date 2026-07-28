/**
 * Catalog contract readiness for the background-job tables.
 *
 * This module used to carry a second copy of the background-job DDL and create
 * the tables from the deployed app bundle. That is gone on purpose: two
 * executable copies of the same schema (here and in the SQL file) drift, and the
 * app silently defining production DDL means a deploy can invent a table shape
 * nobody reviewed.
 *
 * The tables are now owned by exactly one artifact —
 * db/migrations/catalog/2026-07-27-01-background-job-tables.sql, applied through
 * scripts/apply-catalog-migrations.ts before the app deploys. All this module
 * does is assert the contract exists and fail with an actionable message when it
 * does not.
 */

import type { Pool } from 'mysql2/promise';
import { CATALOG_DATABASE_NAME } from '@/db/migrations/catalog-manifest';

/** Tables the background-job repository requires. Must match the catalog migration. */
export const REQUIRED_BACKGROUND_JOB_TABLES = ['background_jobs', 'background_job_files', 'background_job_events'] as const;

export const CATALOG_MIGRATION_COMMAND = 'npm run apply-catalog-migrations -- --apply';

export class BackgroundJobCatalogNotMigratedError extends Error {
  readonly missingTables: string[];

  constructor(missingTables: string[]) {
    super(
      `Background-job catalog tables are missing from the "${CATALOG_DATABASE_NAME}" database: ${missingTables.join(', ')}. ` +
        `Run the catalog migration gate before starting the app: ${CATALOG_MIGRATION_COMMAND}`
    );
    this.name = 'BackgroundJobCatalogNotMigratedError';
    this.missingTables = missingTables;
  }
}

/**
 * Cached per pool: the assertion is a read-only information_schema probe, and
 * repeating it on every repository call would add a round trip to each job read.
 * A failed probe is evicted so a later call re-checks once the migration lands.
 */
const catalogAssertions = new WeakMap<Pool, Promise<void>>();

async function readMissingTables(catalogPool: Pool): Promise<string[]> {
  const placeholders = REQUIRED_BACKGROUND_JOB_TABLES.map(() => '?').join(', ');
  const [rows] = await catalogPool.query(
    `SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})`,
    [CATALOG_DATABASE_NAME, ...REQUIRED_BACKGROUND_JOB_TABLES]
  );
  const present = new Set((rows as Array<{ tableName: string }>).map(row => String(row.tableName).toLowerCase()));
  return REQUIRED_BACKGROUND_JOB_TABLES.filter(table => !present.has(table.toLowerCase()));
}

async function runCatalogAssertion(catalogPool: Pool): Promise<void> {
  const missing = await readMissingTables(catalogPool);
  if (missing.length > 0) throw new BackgroundJobCatalogNotMigratedError(missing);
}

/**
 * Asserts the migrated background-job contract is present. Creates nothing.
 *
 * Kept under the original name so every repository call site reads the same, but
 * the semantics changed from "ensure by creating" to "assert by checking".
 */
export async function ensureBackgroundJobCatalogTables(catalogPool: Pool): Promise<void> {
  const cached = catalogAssertions.get(catalogPool);
  if (cached) return cached;

  const promise = runCatalogAssertion(catalogPool).catch(error => {
    catalogAssertions.delete(catalogPool);
    throw error;
  });
  catalogAssertions.set(catalogPool, promise);
  return promise;
}
