import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import type { SchemaQueryRow } from '@/lib/db/schema-contract';
import {
  sha256Hex,
  selectPendingMigrations,
  assertSiteSchemasDiscovered,
  applyPendingMigrations,
  migrationLockName,
  contractGateFailed,
  parseRunnerArgs,
  TamperedMigrationError,
  NoSiteSchemasError,
  MIGRATION_STATUS,
  LEDGER_TABLE,
  type ContractAudit,
  type MigrationSource,
  type LedgerRow,
  type SqlExecutor
} from './apply-schema-migrations';

function source(id: string, contents: string): MigrationSource {
  return { id, file: `${id}.sql`, contents, checksum: sha256Hex(contents) };
}

/**
 * In-memory stand-in for a per-schema connection. It answers the exact SQL the
 * apply loop issues (ledger existence, ledger read, ledger upsert) and treats any
 * other statement as a migration body, recording it as applied unless configured
 * to fail.
 */
class FakeSchemaDb {
  ledger = new Map<string, LedgerRow>();
  appliedBodies: string[] = [];
  ledgerExists = false;
  failOnBodyIncluding: string | null = null;
  lockHeld = false;

  exec: SqlExecutor = async (sql, params) => {
    if (sql.includes('GET_LOCK')) {
      if (this.lockHeld) return [{ acquired: 0 }];
      this.lockHeld = true;
      return [{ acquired: 1 }];
    }
    if (sql.includes('RELEASE_LOCK')) {
      const released = this.lockHeld ? 1 : 0;
      this.lockHeld = false;
      return [{ released }];
    }
    if (sql.includes('CREATE TABLE IF NOT EXISTS') && sql.includes(LEDGER_TABLE)) {
      this.ledgerExists = true;
      return [];
    }
    if (sql.includes('information_schema.TABLES')) {
      return [{ present: this.ledgerExists ? 1 : 0 }];
    }
    if (sql.includes(`SELECT MigrationID`) && sql.includes(LEDGER_TABLE)) {
      return [...this.ledger.values()] as unknown as SchemaQueryRow[];
    }
    if (sql.includes('INSERT INTO') && sql.includes(LEDGER_TABLE)) {
      const [id, checksum, status] = params as [string, string, string];
      this.ledger.set(id, { MigrationID: id, Checksum: checksum, Status: status });
      return [];
    }
    if (this.failOnBodyIncluding && sql.includes(this.failOnBodyIncluding)) {
      throw new Error('simulated migration failure');
    }
    this.appliedBodies.push(sql);
    return [];
  };
}

describe('sha256Hex', () => {
  it('matches node crypto and is deterministic', () => {
    const input = 'ALTER TABLE temporarymeasurements ADD COLUMN PublishedStemID int unsigned NULL';
    const expected = crypto.createHash('sha256').update(input, 'utf8').digest('hex');
    expect(sha256Hex(input)).toBe(expected);
    expect(sha256Hex(input)).toBe(sha256Hex(input));
  });

  it('changes when the migration body changes (tamper detection basis)', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('a ')); // trailing space matters
  });
});

describe('selectPendingMigrations', () => {
  const m1 = source('2026-07-13-01-first', 'BODY ONE');
  const m2 = source('2026-07-13-02-second', 'BODY TWO');

  it('returns all migrations, in manifest order, against an empty ledger', () => {
    expect(selectPendingMigrations([m1, m2], []).map(s => s.id)).toEqual([m1.id, m2.id]);
  });

  it('skips a migration recorded applied with a matching checksum', () => {
    const ledger: LedgerRow[] = [{ MigrationID: m1.id, Checksum: m1.checksum, Status: MIGRATION_STATUS.APPLIED }];
    expect(selectPendingMigrations([m1, m2], ledger).map(s => s.id)).toEqual([m2.id]);
  });

  it('re-selects a migration recorded failed (retry)', () => {
    const ledger: LedgerRow[] = [{ MigrationID: m1.id, Checksum: m1.checksum, Status: MIGRATION_STATUS.FAILED }];
    expect(selectPendingMigrations([m1, m2], ledger).map(s => s.id)).toEqual([m1.id, m2.id]);
  });

  it('throws TamperedMigrationError when an applied migration checksum changed', () => {
    const ledger: LedgerRow[] = [{ MigrationID: m1.id, Checksum: 'a-different-checksum', Status: MIGRATION_STATUS.APPLIED }];
    expect(() => selectPendingMigrations([m1, m2], ledger)).toThrow(TamperedMigrationError);
  });
});

describe('assertSiteSchemasDiscovered', () => {
  it('throws NoSiteSchemasError on zero schemas (no false green)', () => {
    expect(() => assertSiteSchemasDiscovered([])).toThrow(NoSiteSchemasError);
  });

  it('passes when at least one schema is discovered', () => {
    expect(() => assertSiteSchemasDiscovered(['forestgeo_testing'])).not.toThrow();
  });
});

describe('contractGateFailed', () => {
  function audit(ok: boolean, pendingMigrationIds: string[] = []): ContractAudit {
    return { schema: 's', contractFailures: [], contractExtras: [], collationViolations: [], missingProcedures: [], pendingMigrationIds, ok };
  }

  it('fails the gate (drives --check exit 1) when the audit is not ok', () => {
    expect(contractGateFailed(audit(false))).toBe(true);
  });

  it('fails the gate when migrations are still pending (audit.ok already folds pending in)', () => {
    expect(contractGateFailed(audit(false, ['2026-07-13-01-pending']))).toBe(true);
  });

  it('passes the gate only when the schema is fully compatible', () => {
    expect(contractGateFailed(audit(true))).toBe(false);
  });
});

describe('applyPendingMigrations', () => {
  const m1 = source('2026-07-13-01-first', 'MIGRATION_BODY_ONE');
  const m2 = source('2026-07-13-02-second', 'MIGRATION_BODY_TWO');

  it('creates the ledger, applies every pending migration, and records them applied', async () => {
    const db = new FakeSchemaDb();
    const result = await applyPendingMigrations(db.exec, 'forestgeo_test', [m1, m2]);

    expect(result.appliedNow).toEqual([m1.id, m2.id]);
    expect(result.failed).toBeNull();
    expect(db.appliedBodies).toEqual([m1.contents, m2.contents]);
    expect(db.ledger.get(m1.id)?.Status).toBe(MIGRATION_STATUS.APPLIED);
    expect(db.ledger.get(m2.id)?.Status).toBe(MIGRATION_STATUS.APPLIED);
    expect(db.lockHeld).toBe(false);
  });

  it('is a no-op when every migration is already applied (idempotent re-run)', async () => {
    const db = new FakeSchemaDb();
    db.ledgerExists = true;
    db.ledger.set(m1.id, { MigrationID: m1.id, Checksum: m1.checksum, Status: MIGRATION_STATUS.APPLIED });
    db.ledger.set(m2.id, { MigrationID: m2.id, Checksum: m2.checksum, Status: MIGRATION_STATUS.APPLIED });

    const result = await applyPendingMigrations(db.exec, 'forestgeo_test', [m1, m2]);

    expect(result.appliedNow).toEqual([]);
    expect(db.appliedBodies).toEqual([]);
  });

  it('records a failing migration as failed and stops (does not apply later migrations)', async () => {
    const db = new FakeSchemaDb();
    db.failOnBodyIncluding = m1.contents;

    const result = await applyPendingMigrations(db.exec, 'forestgeo_test', [m1, m2]);

    expect(result.failed?.id).toBe(m1.id);
    expect(result.appliedNow).toEqual([]);
    expect(db.appliedBodies).toEqual([]); // m2 never attempted
    expect(db.ledger.get(m1.id)?.Status).toBe(MIGRATION_STATUS.FAILED);
    expect(db.ledger.has(m2.id)).toBe(false);
    expect(db.lockHeld).toBe(false);
  });

  it('refuses a concurrent migration runner before reading or writing the ledger', async () => {
    const db = new FakeSchemaDb();
    db.lockHeld = true;

    await expect(applyPendingMigrations(db.exec, 'forestgeo_test', [m1])).rejects.toThrow(/Could not acquire migration lock/);
    expect(db.ledgerExists).toBe(false);
    expect(db.appliedBodies).toEqual([]);
  });

  it('uses a deterministic lock name within the MySQL 64-character limit', () => {
    expect(migrationLockName('forestgeo_test')).toBe(migrationLockName('forestgeo_test'));
    expect(migrationLockName('forestgeo_test')).not.toBe(migrationLockName('forestgeo_other'));
    expect(migrationLockName('x'.repeat(64)).length).toBeLessThanOrEqual(64);
  });
});

describe('parseRunnerArgs', () => {
  it('parses an all-sites apply', () => {
    expect(parseRunnerArgs(['--apply', '--all-sites'])).toEqual({ mode: 'apply', allSites: true, schema: null });
  });

  it('parses a single-schema check', () => {
    expect(parseRunnerArgs(['--check', '--schema', 'forestgeo_x'])).toEqual({ mode: 'check', allSites: false, schema: 'forestgeo_x' });
  });

  it('requires a mode', () => {
    expect(() => parseRunnerArgs(['--all-sites'])).toThrow(/check.*apply|apply.*check/i);
  });

  it('rejects both targets or neither', () => {
    expect(() => parseRunnerArgs(['--apply'])).toThrow(/Exactly one target/);
    expect(() => parseRunnerArgs(['--apply', '--all-sites', '--schema', 'x'])).toThrow(/Exactly one target/);
  });

  it('rejects a --schema with no value', () => {
    expect(() => parseRunnerArgs(['--apply', '--schema'])).toThrow(/requires a schema name/);
  });
});
