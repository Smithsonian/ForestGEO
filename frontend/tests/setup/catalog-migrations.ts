/**
 * Applies the catalog migration set to the local test MySQL server.
 *
 * lib/background-jobs/catalog.ts no longer creates its tables — it asserts the
 * migrated contract exists. Integration suites that touch catalog.background_jobs
 * must therefore run the same migration the deploy gate runs, rather than a
 * test-only copy of the DDL. Using the real runner is the point: if the migration
 * or the ledger breaks, these suites fail instead of quietly diverging from
 * production.
 */

import mysql from 'mysql2/promise';
import {
  applyPendingCatalogMigrations,
  loadCatalogMigrationSources,
  runCatalogPreflight,
  remediateEmptyUnreleasedCatalogTables
} from '@/scripts/apply-catalog-migrations';
import { CATALOG_DATABASE_NAME } from '@/db/migrations/catalog-manifest';
import type { SqlExecutor } from '@/scripts/lib/schema-cli';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

function testConnectionSettings() {
  const host = process.env.TEST_DB_HOST ?? 'localhost';
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(`[catalog-migrations] Refusing to migrate catalog on non-local host "${host}".`);
  }
  return {
    host,
    port: Number.parseInt(process.env.TEST_DB_PORT ?? '3306', 10),
    user: process.env.TEST_DB_USER ?? 'root',
    password: process.env.TEST_DB_PASSWORD ?? 'testpassword'
  };
}

/**
 * Ensures the catalog database exists and every catalog migration is applied.
 *
 * Idempotent: the ledger skips already-applied migrations, so suites can call
 * this in each beforeAll. A stale table left by an older local run is dropped
 * first — safe here and only here, because this targets a local test server.
 */
export async function applyCatalogMigrationsForTests(): Promise<void> {
  const settings = testConnectionSettings();

  const server = await mysql.createConnection({ ...settings, multipleStatements: false });
  try {
    await server.query(`CREATE DATABASE IF NOT EXISTS \`${CATALOG_DATABASE_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  } finally {
    await server.end();
  }

  const connection = await mysql.createConnection({ ...settings, database: CATALOG_DATABASE_NAME, multipleStatements: true });
  try {
    const exec: SqlExecutor = async (sql, params) => {
      const [rows] = await connection.query(sql, params ?? []);
      return Array.isArray(rows) ? (rows as Awaited<ReturnType<SqlExecutor>>) : [];
    };

    let preflight = await runCatalogPreflight(exec);
    if (preflight.hasStale) {
      // Local-only convenience: a developer machine may still hold tables from an
      // older bootstrap. Production remediation is the operator-only CLI step.
      await remediateEmptyUnreleasedCatalogTables(exec, preflight);
      preflight = await runCatalogPreflight(exec);
    }

    const result = await applyPendingCatalogMigrations(exec, loadCatalogMigrationSources(), preflight);
    if (result.failed) {
      throw new Error(`[catalog-migrations] ${result.failed.id} failed: ${result.failed.error}`);
    }
  } finally {
    await connection.end();
  }
}
