import { describe, expect, it, vi } from 'vitest';

import { BackgroundJobCatalogNotMigratedError, CATALOG_MIGRATION_COMMAND, ensureBackgroundJobCatalogTables, REQUIRED_BACKGROUND_JOB_TABLES } from './catalog';

/**
 * This module used to CREATE the background-job tables from the app bundle. It
 * now asserts the migrated contract instead, so the deploy gate is the only
 * thing that defines catalog DDL. These tests pin that inversion: the app must
 * never issue DDL, and an unmigrated database must fail loudly with an
 * actionable message rather than half-working.
 */

function poolReturning(presentTables: string[]) {
  const query = vi.fn().mockResolvedValue([presentTables.map(tableName => ({ tableName }))]);
  return { query } as never as import('mysql2/promise').Pool & { query: ReturnType<typeof vi.fn> };
}

describe('ensureBackgroundJobCatalogTables', () => {
  it('passes when every required table is present', async () => {
    const pool = poolReturning([...REQUIRED_BACKGROUND_JOB_TABLES]);

    await expect(ensureBackgroundJobCatalogTables(pool)).resolves.toBeUndefined();
  });

  it('issues only a read-only information_schema probe — never DDL', async () => {
    const pool = poolReturning([...REQUIRED_BACKGROUND_JOB_TABLES]);

    await ensureBackgroundJobCatalogTables(pool);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql] = pool.query.mock.calls[0];
    expect(String(sql)).toContain('information_schema.TABLES');
    expect(String(sql)).not.toMatch(/CREATE|ALTER|DROP/i);
  });

  it('throws a migration-required error naming the missing tables', async () => {
    const pool = poolReturning(['background_jobs']);

    await expect(ensureBackgroundJobCatalogTables(pool)).rejects.toThrow(BackgroundJobCatalogNotMigratedError);
    await expect(ensureBackgroundJobCatalogTables(pool)).rejects.toThrow(/background_job_files/);
  });

  it('tells the operator exactly which command fixes it', async () => {
    const pool = poolReturning([]);

    await expect(ensureBackgroundJobCatalogTables(pool)).rejects.toThrow(CATALOG_MIGRATION_COMMAND);
  });

  it('caches a successful assertion per pool so job reads do not re-probe', async () => {
    const pool = poolReturning([...REQUIRED_BACKGROUND_JOB_TABLES]);

    await ensureBackgroundJobCatalogTables(pool);
    await ensureBackgroundJobCatalogTables(pool);

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('re-probes after a failure so a later call succeeds once the migration lands', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([REQUIRED_BACKGROUND_JOB_TABLES.map(tableName => ({ tableName }))]);
    const pool = { query } as never as import('mysql2/promise').Pool;

    await expect(ensureBackgroundJobCatalogTables(pool)).rejects.toThrow(BackgroundJobCatalogNotMigratedError);
    await expect(ensureBackgroundJobCatalogTables(pool)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
  });
});
