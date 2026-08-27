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
 *
 * An entry may point at any file under db/migrations/, not only
 * schema-contract-repair/. Listing a file here FREEZES it: the ledger stores a
 * checksum of its contents, so editing a listed file after it has been applied
 * anywhere throws TamperedMigrationError and blocks every deploy. That applies
 * equally to files under unified-measurements-migrations/, which are otherwise
 * hand-run and look editable — see the banner in 60_add_published_stemid.sql.
 *
 * Every object the schema contract REQUIRES must be reachable from this manifest.
 * A requirement with no migration behind it is a deadlock, not a gap: on 2026-07-29
 * a newly provisioned schema failed the post-apply audit on stems.PublishedStemID
 * with no automated remedy, and took the whole dev pipeline down until the columns
 * were added by hand.
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
  },
  {
    id: '2026-07-29-01-add-upload-session-census-replacement-marker',
    file: 'schema-contract-repair/2026-07-29-01-add-upload-session-census-replacement-marker.sql'
  },
  {
    id: '2026-07-29-02-add-stem-published-stemid',
    file: 'unified-measurements-migrations/60_add_published_stemid.sql'
  },
  {
    id: '2026-07-29-03-create-arcgis-import-staging',
    file: 'unified-measurements-migrations/59_create_arcgis_import_sessions.sql'
  },
  {
    id: '2026-07-29-04-scope-postvalidation-last-run',
    file: 'unified-measurements-migrations/61_scope_postvalidation_last_run.sql'
  },
  {
    id: '2026-08-04-01-widen-plot-global-coordinates',
    file: 'schema-contract-repair/2026-08-04-01-widen-plot-global-coordinates.sql'
  },
  {
    id: '2026-08-04-02-add-plot-coordinate-epsg',
    file: 'schema-contract-repair/2026-08-04-02-add-plot-coordinate-epsg.sql'
  },
  {
    id: '2026-08-07-01-rename-viewfulltable-stemid-to-stemguid',
    file: 'schema-contract-repair/2026-08-07-01-rename-viewfulltable-stemid-to-stemguid.sql'
  },
  {
    id: '2026-08-17-01-add-error-log-prior-snapshot',
    file: 'schema-contract-repair/2026-08-17-01-add-error-log-prior-snapshot.sql'
  },
  {
    id: '2026-08-19-02-repair-error-log-prior-snapshot-columns',
    file: 'schema-contract-repair/2026-08-19-02-repair-error-log-prior-snapshot-columns.sql'
  },
  {
    id: '2026-08-26-01-widen-temporarymeasurements-fileid',
    file: 'schema-contract-repair/2026-08-26-01-widen-temporarymeasurements-fileid.sql'
  },
  {
    id: '2026-08-27-01-add-plot-coordinates',
    file: 'schema-contract-repair/2026-08-27-01-add-plot-coordinates.sql'
  }
] as const;
