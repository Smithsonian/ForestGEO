/**
 * Ordered manifest of CATALOG migrations — DDL for the shared `catalog` database.
 *
 * Deliberately separate from SCHEMA_MIGRATION_MANIFEST (db/migrations/manifest.ts).
 * Site migrations run once per forestgeo_* schema and record into that schema's
 * `schema_migrations` ledger; catalog migrations run ONCE per server and record
 * into `catalog.catalog_migrations`. Mixing them would either run shared DDL once
 * per site or scatter a catalog id across every site's ledger, so the two
 * manifests, runners, and ledgers stay disjoint by construction.
 *
 * Each entry's `file` is resolved relative to db/migrations/. `id` is the ledger
 * primary key: stable, human-readable (date-ordinal-slug), never changed after
 * first release, never reordered or removed.
 */

import type { MigrationManifestEntry } from './manifest';

export type CatalogMigrationManifestEntry = MigrationManifestEntry;

export const CATALOG_MIGRATION_MANIFEST: readonly CatalogMigrationManifestEntry[] = [
  {
    id: '2026-07-27-01-background-job-tables',
    file: 'catalog/2026-07-27-01-background-job-tables.sql'
  }
] as const;

/** The shared database every catalog migration targets. */
export const CATALOG_DATABASE_NAME = 'catalog';
