import { describe, expect, it, vi } from 'vitest';

import {
  applyPendingCatalogMigrations,
  CATALOG_BACKGROUND_JOB_TABLES,
  CATALOG_LEDGER_TABLE,
  CATALOG_MIGRATION_LOCK_NAME,
  CatalogTablesNotEmptyError,
  classifyCatalogTable,
  loadCatalogMigrationSources,
  parseCatalogRunnerArgs,
  parseEnumValues,
  remediateEmptyUnreleasedCatalogTables,
  runCatalogPreflight,
  selectPendingCatalogMigrations,
  StaleCatalogSchemaError,
  type CatalogPreflight,
  type LiveColumn
} from './apply-catalog-migrations';
import { CATALOG_MIGRATION_MANIFEST } from '../db/migrations/catalog-manifest';
import { SCHEMA_MIGRATION_MANIFEST } from '../db/migrations/manifest';
import { TamperedMigrationError, type MigrationSource } from './apply-schema-migrations';

const BACKGROUND_JOBS = 'background_jobs';

/** Columns matching the canonical migration for a given table. */
function currentColumns(table: (typeof CATALOG_BACKGROUND_JOB_TABLES)[number]): LiveColumn[] {
  if (table === BACKGROUND_JOBS) {
    return [
      { name: 'JobID', columnType: 'bigint' },
      { name: 'JobType', columnType: "enum('upload_validation')" },
      { name: 'Status', columnType: "enum('queued','running','cancel_requested','waiting_retry','completed','failed','cancelled')" },
      { name: 'Phase', columnType: "enum('queued','staging','ingestion','collapsing','validation','refreshing_views','completed','failed','cancelled')" },
      ...[
        'SchemaName',
        'PlotID',
        'CensusID',
        'UploadMode',
        'SourceFormat',
        'FormType',
        'CreatedBy',
        'IdempotencyKey',
        'PercentComplete',
        'TotalFiles',
        'TotalRows',
        'ProcessedRows',
        'FailedRows',
        'RetryCount',
        'MaxRetries',
        'NextAttemptAt',
        'LastError',
        'WorkerID',
        'WorkerHeartbeatAt',
        'Payload',
        'CreatedAt',
        'UpdatedAt',
        'StartedAt',
        'FinishedAt'
      ].map(name => ({ name, columnType: 'varchar(64)' }))
    ];
  }
  if (table === 'background_job_files') {
    return [
      { name: 'Status', columnType: "enum('pending','staged','processed','failed','skipped')" },
      ...[
        'JobFileID',
        'JobID',
        'FileName',
        'BlobContainer',
        'BlobName',
        'ContentType',
        'ByteSize',
        'ChecksumSHA256',
        'SourceFormat',
        'FormType',
        'BatchID',
        'ExpectedRows',
        'ProcessedRows',
        'FailedRows',
        'ErrorMessage',
        'CreatedAt',
        'UpdatedAt'
      ].map(name => ({ name, columnType: 'varchar(64)' }))
    ];
  }
  return ['EventID', 'JobID', 'EventType', 'Message', 'Details', 'CreatedAt'].map(name => ({ name, columnType: 'varchar(64)' }));
}

function makeSource(overrides: Partial<MigrationSource> = {}): MigrationSource {
  return { id: 'cat-1', file: 'catalog/cat-1.sql', contents: 'CREATE TABLE x', checksum: 'aaa', ...overrides };
}

function cleanPreflight(): CatalogPreflight {
  return {
    tables: CATALOG_BACKGROUND_JOB_TABLES.map(table => ({ table, state: 'absent' as const, differences: [], rowCount: null })),
    hasStale: false,
    staleRowTotal: 0
  };
}

describe('catalog manifest separation', () => {
  it('keeps the catalog migration out of the per-site manifest', () => {
    const siteIDs = SCHEMA_MIGRATION_MANIFEST.map(entry => entry.id);
    for (const entry of CATALOG_MIGRATION_MANIFEST) {
      expect(siteIDs).not.toContain(entry.id);
    }
  });

  it('resolves every catalog manifest file on disk', () => {
    const sources = loadCatalogMigrationSources();

    expect(sources).toHaveLength(CATALOG_MIGRATION_MANIFEST.length);
    for (const source of sources) {
      expect(source.contents.length).toBeGreaterThan(0);
      expect(source.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('ships catalog DDL that touches no site schema', () => {
    for (const source of loadCatalogMigrationSources()) {
      // Comments legitimately discuss the site manifest; only executable SQL is
      // constrained. A forestgeo_* reference in a statement would mean shared
      // DDL running against one arbitrary site.
      const executableSql = source.contents
        .split('\n')
        .filter(line => !line.trimStart().startsWith('--'))
        .join('\n');

      expect(executableSql).not.toMatch(/forestgeo_/i);
      expect(executableSql.toLowerCase()).toContain('catalog.');
    }
  });
});

describe('parseEnumValues', () => {
  it('extracts values from an ENUM column type', () => {
    expect(parseEnumValues("enum('queued','running')")).toEqual(['queued', 'running']);
  });

  it('returns null for a non-ENUM column type', () => {
    expect(parseEnumValues('varchar(64)')).toBeNull();
  });
});

describe('classifyCatalogTable', () => {
  it('classifies a missing table as absent', () => {
    expect(classifyCatalogTable(BACKGROUND_JOBS, null).state).toBe('absent');
    expect(classifyCatalogTable(BACKGROUND_JOBS, []).state).toBe('absent');
  });

  it('classifies the canonical shape as current', () => {
    const result = classifyCatalogTable(BACKGROUND_JOBS, currentColumns(BACKGROUND_JOBS));

    expect(result.state).toBe('current');
    expect(result.differences).toEqual([]);
  });

  it('classifies a table missing a required column as stale', () => {
    const columns = currentColumns(BACKGROUND_JOBS).filter(column => column.name !== 'WorkerID');

    const result = classifyCatalogTable(BACKGROUND_JOBS, columns);

    expect(result.state).toBe('stale');
    expect(result.differences).toContain('missing column WorkerID');
  });

  it('classifies the Service Bus era LastMessageID column as stale', () => {
    const columns = [...currentColumns(BACKGROUND_JOBS), { name: 'LastMessageID', columnType: 'varchar(128)' }];

    const result = classifyCatalogTable(BACKGROUND_JOBS, columns);

    expect(result.state).toBe('stale');
    expect(result.differences).toContain('legacy column LastMessageID present');
  });

  it('classifies stale ENUM domains, naming both missing and unexpected values', () => {
    const columns = currentColumns(BACKGROUND_JOBS).map(column =>
      column.name === 'Status' ? { name: 'Status', columnType: "enum('created','dead_lettered','blob_received')" } : column
    );

    const result = classifyCatalogTable(BACKGROUND_JOBS, columns);

    expect(result.state).toBe('stale');
    const enumDifference = result.differences.find(difference => difference.startsWith('column Status ENUM mismatch'));
    expect(enumDifference).toBeDefined();
    expect(enumDifference).toContain('cancel_requested');
    expect(enumDifference).toContain('dead_lettered');
  });
});

describe('runCatalogPreflight', () => {
  it('counts rows for present tables and never counts an absent one', async () => {
    const exec = vi.fn(async (sql: string) => {
      if (sql.includes('information_schema.COLUMNS')) return [];
      throw new Error(`unexpected query: ${sql}`);
    });

    const preflight = await runCatalogPreflight(exec as never);

    expect(preflight.tables.every(entry => entry.state === 'absent')).toBe(true);
    expect(preflight.tables.every(entry => entry.rowCount === null)).toBe(true);
    expect(preflight.hasStale).toBe(false);
    // No COUNT(*) may be issued against a table that does not exist.
    expect(exec.mock.calls.some(([sql]) => String(sql).includes('COUNT(*)'))).toBe(false);
  });

  it('reports stale tables with their row counts', async () => {
    const exec = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('information_schema.COLUMNS')) {
        const table = String((params as unknown[])[1]) as (typeof CATALOG_BACKGROUND_JOB_TABLES)[number];
        if (table !== BACKGROUND_JOBS) return currentColumns(table).map(column => ({ name: column.name, columnType: column.columnType }));
        return [...currentColumns(BACKGROUND_JOBS), { name: 'LastMessageID', columnType: 'varchar(128)' }];
      }
      if (sql.includes('COUNT(*)')) return [{ rowCount: sql.includes('background_jobs`') ? 7 : 0 }];
      throw new Error(`unexpected query: ${sql}`);
    });

    const preflight = await runCatalogPreflight(exec as never);

    expect(preflight.hasStale).toBe(true);
    const jobs = preflight.tables.find(entry => entry.table === BACKGROUND_JOBS);
    expect(jobs?.state).toBe('stale');
    expect(jobs?.rowCount).toBe(7);
    expect(preflight.staleRowTotal).toBe(7);
  });
});

describe('selectPendingCatalogMigrations', () => {
  it('treats an unrecorded migration as pending', () => {
    expect(selectPendingCatalogMigrations([makeSource()], [])).toHaveLength(1);
  });

  it('skips an applied migration whose checksum still matches', () => {
    const pending = selectPendingCatalogMigrations([makeSource()], [{ MigrationID: 'cat-1', Checksum: 'aaa', Status: 'applied' }]);

    expect(pending).toHaveLength(0);
  });

  it('re-selects a failed migration for retry', () => {
    const pending = selectPendingCatalogMigrations([makeSource()], [{ MigrationID: 'cat-1', Checksum: 'aaa', Status: 'failed' }]);

    expect(pending).toHaveLength(1);
  });

  it('refuses an applied migration whose file changed', () => {
    expect(() => selectPendingCatalogMigrations([makeSource({ checksum: 'bbb' })], [{ MigrationID: 'cat-1', Checksum: 'aaa', Status: 'applied' }])).toThrow(
      TamperedMigrationError
    );
  });
});

describe('applyPendingCatalogMigrations', () => {
  function execWithLedger(applied: string[] = []) {
    return vi.fn(async (sql: string) => {
      if (sql.includes('GET_LOCK')) return [{ acquired: 1 }];
      if (sql.includes('RELEASE_LOCK')) return [{ released: 1 }];
      if (sql.includes('information_schema.TABLES')) return [{ present: applied.length > 0 ? 1 : 0 }];
      if (sql.includes(`SELECT MigrationID`)) return applied.map(id => ({ MigrationID: id, Checksum: 'aaa', Status: 'applied' }));
      return [];
    });
  }

  it('applies pending migrations under the global catalog lock and records the ledger', async () => {
    const exec = execWithLedger();

    const result = await applyPendingCatalogMigrations(exec as never, [makeSource()], cleanPreflight());

    expect(result.appliedNow).toEqual(['cat-1']);
    expect(result.failed).toBeNull();

    const lockCalls = exec.mock.calls.filter(([sql]) => String(sql).includes('GET_LOCK'));
    expect(lockCalls).toHaveLength(1);
    expect(lockCalls[0][1]).toContain(CATALOG_MIGRATION_LOCK_NAME);
    expect(exec.mock.calls.some(([sql]) => String(sql).includes(CATALOG_LEDGER_TABLE))).toBe(true);
    // The lock is always released, even on the success path.
    expect(exec.mock.calls.some(([sql]) => String(sql).includes('RELEASE_LOCK'))).toBe(true);
  });

  it('records a failure and stops without masking the original error', async () => {
    const exec = vi.fn(async (sql: string) => {
      if (sql.includes('GET_LOCK')) return [{ acquired: 1 }];
      if (sql.includes('RELEASE_LOCK')) return [{ released: 1 }];
      if (sql.includes('information_schema.TABLES')) return [{ present: 0 }];
      if (sql.startsWith('CREATE TABLE x')) throw new Error('syntax error near x');
      return [];
    });

    const result = await applyPendingCatalogMigrations(exec as never, [makeSource()], cleanPreflight());

    expect(result.failed).toEqual({ id: 'cat-1', error: 'syntax error near x' });
    expect(result.appliedNow).toEqual([]);
  });

  it('fails closed on a stale table and never acquires the lock or writes', async () => {
    const exec = vi.fn(async () => []);
    const stale: CatalogPreflight = {
      tables: [
        { table: BACKGROUND_JOBS, state: 'stale', differences: ['legacy column LastMessageID present'], rowCount: 0 },
        { table: 'background_job_files', state: 'absent', differences: [], rowCount: null },
        { table: 'background_job_events', state: 'absent', differences: [], rowCount: null }
      ],
      hasStale: true,
      staleRowTotal: 0
    };

    await expect(applyPendingCatalogMigrations(exec as never, [makeSource()], stale)).rejects.toThrow(StaleCatalogSchemaError);
    // The automated gate must not lock, drop, or write anything.
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('remediateEmptyUnreleasedCatalogTables', () => {
  it('drops stale tables in foreign-key order when every owned table is empty', async () => {
    const exec = vi.fn(async () => []);
    const stale: CatalogPreflight = {
      tables: [
        { table: 'background_job_events', state: 'absent', differences: [], rowCount: null },
        { table: 'background_job_files', state: 'absent', differences: [], rowCount: null },
        { table: BACKGROUND_JOBS, state: 'stale', differences: ['legacy column LastMessageID present'], rowCount: 0 }
      ],
      hasStale: true,
      staleRowTotal: 0
    };

    const dropped = await remediateEmptyUnreleasedCatalogTables(exec as never, stale);

    // Children before the parent so FKs never block the drop.
    expect(dropped).toEqual(['background_job_events', 'background_job_files', 'background_jobs']);
    const droppedOrder = exec.mock.calls.map(([sql]) => String(sql)).filter(sql => sql.startsWith('DROP TABLE'));
    expect(droppedOrder[0]).toContain('background_job_events');
    expect(droppedOrder[2]).toContain('background_jobs');
  });

  it('refuses to drop when any owned table holds rows', async () => {
    const exec = vi.fn(async () => []);
    const withData: CatalogPreflight = {
      tables: [
        { table: 'background_job_events', state: 'absent', differences: [], rowCount: null },
        { table: 'background_job_files', state: 'absent', differences: [], rowCount: null },
        { table: BACKGROUND_JOBS, state: 'stale', differences: ['legacy column LastMessageID present'], rowCount: 3 }
      ],
      hasStale: true,
      staleRowTotal: 3
    };

    await expect(remediateEmptyUnreleasedCatalogTables(exec as never, withData)).rejects.toThrow(CatalogTablesNotEmptyError);
    expect(exec.mock.calls.some(([sql]) => String(sql).startsWith('DROP TABLE'))).toBe(false);
  });
});

describe('parseCatalogRunnerArgs', () => {
  it('defaults to the local target', () => {
    expect(parseCatalogRunnerArgs(['--check'])).toEqual({ mode: 'check', azure: false });
  });

  it('accepts an explicit Azure target', () => {
    expect(parseCatalogRunnerArgs(['--apply', '--azure'])).toEqual({ mode: 'apply', azure: true });
  });

  it('requires a mode', () => {
    expect(() => parseCatalogRunnerArgs(['--azure'])).toThrow(/required/);
  });

  it('rejects an unknown flag rather than silently ignoring it', () => {
    expect(() => parseCatalogRunnerArgs(['--check', '--all-sites'])).toThrow(/Unknown argument/);
  });
});
