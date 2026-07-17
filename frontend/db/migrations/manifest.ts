/**
 * Ordered manifest of schema-contract-repair migrations.
 *
 * The apply-schema-migrations runner applies ONLY the migrations listed here, in
 * array order — never "every historical .sql file in db/migrations". Each entry's
 * `file` is resolved relative to this directory (db/migrations/). Adding a
 * migration means appending an entry; entries are never reordered or removed once
 * they have been applied to any live schema (the per-schema ledger keys on `id`).
 *
 * `id` is a stable, human-readable identifier (date-ordinal-slug). It is the
 * ledger primary key, so it must never change after first release.
 */

export interface MigrationManifestEntry {
  /** Stable ledger key. Never change after release. */
  id: string;
  /** Path to the migration SQL, relative to db/migrations/. */
  file: string;
}

export const SCHEMA_MIGRATION_MANIFEST: readonly MigrationManifestEntry[] = [
  {
    id: '2026-07-13-01-add-published-stemid-and-source-format',
    file: 'schema-contract-repair/2026-07-13-01-add-published-stemid-and-source-format.sql'
  },
  {
    id: '2026-07-16-01-add-cm-uploadbatch-census-index',
    file: 'schema-contract-repair/2026-07-16-01-add-cm-uploadbatch-census-index.sql'
  },
  {
    id: '2026-07-16-02-normalize-temporarymeasurements-ids',
    file: 'schema-contract-repair/2026-07-16-02-normalize-temporarymeasurements-ids.sql'
  }
] as const;
