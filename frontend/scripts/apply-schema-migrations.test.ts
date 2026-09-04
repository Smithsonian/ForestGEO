import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { SchemaQueryRow } from '@/lib/db/schema-contract';
import {
  sha256Hex,
  selectPendingMigrations,
  assertSiteSchemasDiscovered,
  applyPendingMigrations,
  migrationLockName,
  contractGateFailed,
  parseRunnerArgs,
  decideGateOutcome,
  runApplyGateLoop,
  formatGateReason,
  formatGitHubAnnotations,
  writeGateResultFile,
  GATE_RESULT_PATH_ENV,
  ERROR_SUMMARY_MAX_LENGTH,
  TamperedMigrationError,
  NoSiteSchemasError,
  MIGRATION_STATUS,
  LEDGER_TABLE,
  DDL_LOCK_WAIT_TIMEOUT_SECONDS,
  type ContractAudit,
  type MigrationSource,
  type LedgerRow,
  type SqlExecutor,
  type GateStore,
  type SchemaGateResult,
  type GateRunSummary
} from './apply-schema-migrations';
import type { SchemaGateRow } from './lib/schema-gate';

function source(id: string, contents: string): MigrationSource {
  return { id, file: `${id}.sql`, contents, checksum: sha256Hex(contents), failureCleanup: [] };
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
  sessionTimeoutStatements: string[] = [];
  ledgerExists = false;
  failOnBodyIncluding: string | null = null;
  lockHeld = false;

  exec: SqlExecutor = async (sql, params) => {
    if (sql.startsWith('SET SESSION') && sql.includes('lock_wait_timeout')) {
      this.sessionTimeoutStatements.push(sql);
      return [];
    }
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
    // The DDL patience limit must be set on the session BEFORE any migration body runs,
    // so an ALTER queued behind live traffic fails fast instead of freezing the table.
    expect(db.sessionTimeoutStatements).toEqual([
      `SET SESSION lock_wait_timeout = ${DDL_LOCK_WAIT_TIMEOUT_SECONDS}`,
      `SET SESSION innodb_lock_wait_timeout = ${DDL_LOCK_WAIT_TIMEOUT_SECONDS}`
    ]);
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

  it('runs declared helper cleanup after a failed migration without masking the migration error', async () => {
    const db = new FakeSchemaDb();
    const failing = { ...m1, failureCleanup: ['DROP PROCEDURE IF EXISTS migration_helper'] };
    db.failOnBodyIncluding = failing.contents;

    const result = await applyPendingMigrations(db.exec, 'forestgeo_test', [failing]);

    expect(result.failed).toEqual({ id: failing.id, error: 'simulated migration failure' });
    expect(db.appliedBodies).toContain('DROP PROCEDURE IF EXISTS migration_helper');
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

function gateRow(overrides: Partial<SchemaGateRow> = {}): SchemaGateRow {
  return { schemaName: 'forestgeo_x', lastPassedAt: null, lastFailedAt: null, quarantinedAt: null, quarantineReason: null, lastRunRef: null, ...overrides };
}

/** Records every gate write so tests can assert exactly what the loop persisted. */
class FakeGateStore implements GateStore {
  rows = new Map<string, SchemaGateRow>();
  passes: string[] = [];
  quarantines: Array<{ schema: string; reason: string }> = [];
  blocks: string[] = [];
  readonly quarantinedSince = new Date('2026-09-02T18:04:11Z');

  async pass(schema: string): Promise<void> {
    this.passes.push(schema);
  }
  async quarantine(schema: string, reason: string): Promise<Date> {
    this.quarantines.push({ schema, reason });
    return this.quarantinedSince;
  }
  async block(schema: string): Promise<void> {
    this.blocks.push(schema);
  }
}

describe('decideGateOutcome', () => {
  it('passes a passing schema regardless of history', () => {
    expect(decideGateOutcome(true, null)).toBe('passed');
    expect(decideGateOutcome(true, gateRow({ lastPassedAt: new Date() }))).toBe('passed');
  });

  it('quarantines a failing schema that has never passed', () => {
    expect(decideGateOutcome(false, null)).toBe('quarantined');
    expect(decideGateOutcome(false, gateRow({ lastPassedAt: null, quarantinedAt: new Date() }))).toBe('quarantined');
  });

  it('blocks a failing schema that passed before', () => {
    expect(decideGateOutcome(false, gateRow({ lastPassedAt: new Date('2026-08-01T00:00:00Z') }))).toBe('blocked');
  });
});

describe('runApplyGateLoop', () => {
  function processor(results: Record<string, SchemaGateResult>) {
    const calls: string[] = [];
    const processOne = async (schema: string): Promise<SchemaGateResult> => {
      calls.push(schema);
      return results[schema];
    };
    return { processOne, calls };
  }

  it('continues past a never-passed failing schema and records the quarantine', async () => {
    const logs: string[] = [];
    const store = new FakeGateStore();
    const { processOne, calls } = processor({
      forestgeo_a: { schema: 'forestgeo_a', passed: true, reason: '' },
      forestgeo_new: { schema: 'forestgeo_new', passed: false, reason: 'DRIFT [stems] column "PublishedStemID" missing' },
      forestgeo_z: { schema: 'forestgeo_z', passed: true, reason: '' }
    });

    const { summary, exitCode } = await runApplyGateLoop(['forestgeo_a', 'forestgeo_new', 'forestgeo_z'], processOne, store, line => logs.push(line));
    console.log(`[gate loop] exit=${exitCode} summary=${JSON.stringify(summary)}`);

    expect(calls).toEqual(['forestgeo_a', 'forestgeo_new', 'forestgeo_z']);
    expect(exitCode).toBe(0);
    expect(summary.passed).toEqual(['forestgeo_a', 'forestgeo_z']);
    expect(summary.quarantined).toEqual([
      { schema: 'forestgeo_new', reason: 'DRIFT [stems] column "PublishedStemID" missing', since: store.quarantinedSince.toISOString() }
    ]);
    expect(summary.blocked).toEqual([]);
    expect(store.passes).toEqual(['forestgeo_a', 'forestgeo_z']);
    expect(store.quarantines).toEqual([{ schema: 'forestgeo_new', reason: 'DRIFT [stems] column "PublishedStemID" missing' }]);
  });

  it('stops at a previously-passed failing schema and exits 1', async () => {
    const logs: string[] = [];
    const store = new FakeGateStore();
    store.rows.set('forestgeo_b', gateRow({ schemaName: 'forestgeo_b', lastPassedAt: new Date('2026-08-01T00:00:00Z') }));
    const { processOne, calls } = processor({
      forestgeo_a: { schema: 'forestgeo_a', passed: true, reason: '' },
      forestgeo_b: { schema: 'forestgeo_b', passed: false, reason: 'MIGRATION FAILED 2026-09-x: boom' },
      forestgeo_c: { schema: 'forestgeo_c', passed: true, reason: '' }
    });

    const { summary, exitCode } = await runApplyGateLoop(['forestgeo_a', 'forestgeo_b', 'forestgeo_c'], processOne, store, line => logs.push(line));
    console.log(`[gate loop blocked] exit=${exitCode} calls=${JSON.stringify(calls)} summary=${JSON.stringify(summary)}`);

    expect(calls).toEqual(['forestgeo_a', 'forestgeo_b']);
    expect(exitCode).toBe(1);
    expect(summary.blocked).toEqual([{ schema: 'forestgeo_b', reason: 'MIGRATION FAILED 2026-09-x: boom' }]);
    expect(store.blocks).toEqual(['forestgeo_b']);
    expect(store.quarantines).toEqual([]);
  });

  it('fails the run when no schema passed, even though each failure was quarantine-eligible', async () => {
    const logs: string[] = [];
    const store = new FakeGateStore();
    const { processOne } = processor({
      forestgeo_a: { schema: 'forestgeo_a', passed: false, reason: 'DRIFT a' },
      forestgeo_b: { schema: 'forestgeo_b', passed: false, reason: 'DRIFT b' }
    });

    const { summary, exitCode } = await runApplyGateLoop(['forestgeo_a', 'forestgeo_b'], processOne, store, line => logs.push(line));
    console.log(`[gate loop zero-pass] exit=${exitCode} logs=${JSON.stringify(logs)}`);

    expect(exitCode).toBe(1);
    expect(summary.quarantined.map(entry => entry.schema)).toEqual(['forestgeo_a', 'forestgeo_b']);
    expect(logs.some(line => /no schema passed/i.test(line))).toBe(true);
  });

  it('treats a thrown per-schema error as a failure with the error message as reason', async () => {
    const logs: string[] = [];
    const store = new FakeGateStore();
    const processOne = async (schema: string): Promise<SchemaGateResult> => {
      if (schema === 'forestgeo_bad') throw new Error('ER_CANT_AGGREGATE_2COLLATIONS');
      return { schema, passed: true, reason: '' };
    };

    const { summary } = await runApplyGateLoop(['forestgeo_bad', 'forestgeo_ok'], processOne, store, line => logs.push(line));

    expect(summary.quarantined[0]).toMatchObject({ schema: 'forestgeo_bad', reason: 'ER_CANT_AGGREGATE_2COLLATIONS' });
    expect(summary.passed).toEqual(['forestgeo_ok']);
  });

  it('matches prior gate rows case-insensitively so a mixed-case schema is not misread as never-passed', async () => {
    const logs: string[] = [];
    const store = new FakeGateStore();
    store.rows.set('forestgeo_mixed', gateRow({ schemaName: 'forestgeo_Mixed', lastPassedAt: new Date('2026-08-01T00:00:00Z') }));
    const { processOne } = processor({
      forestgeo_Mixed: { schema: 'forestgeo_Mixed', passed: false, reason: 'DRIFT mixed' }
    });

    const { summary, exitCode } = await runApplyGateLoop(['forestgeo_Mixed'], processOne, store, line => logs.push(line));

    expect(exitCode).toBe(1);
    expect(summary.blocked.map(entry => entry.schema)).toEqual(['forestgeo_Mixed']);
    expect(summary.quarantined).toEqual([]);
  });
  it('skips the systemic-failure floor when the caller targets a single schema', async () => {
    const logs: string[] = [];
    const store = new FakeGateStore();
    const { processOne } = processor({
      forestgeo_only: { schema: 'forestgeo_only', passed: false, reason: 'DRIFT only' }
    });

    const { summary, exitCode } = await runApplyGateLoop(['forestgeo_only'], processOne, store, line => logs.push(line), false);
    console.log(`[gate loop single-schema] exit=${exitCode} quarantined=${JSON.stringify(summary.quarantined.map(entry => entry.schema))}`);

    expect(exitCode).toBe(0);
    expect(summary.quarantined.map(entry => entry.schema)).toEqual(['forestgeo_only']);
    expect(logs.some(line => /no schema passed/i.test(line))).toBe(false);
  });
});

describe('gate reporting helpers', () => {
  const summary: GateRunSummary = {
    passed: ['forestgeo_a'],
    quarantined: [{ schema: 'forestgeo_new', reason: 'DRIFT line 1\nDRIFT line 2', since: '2026-09-02T18:04:11.000Z' }],
    blocked: []
  };

  it('truncates a reason at ERROR_SUMMARY_MAX_LENGTH', () => {
    const audit: ContractAudit = {
      schema: 's',
      contractFailures: Array.from({ length: 200 }, (_, index) => ({
        table: 'stems',
        object: `col${index}`,
        category: 'column' as const,
        kind: 'missing' as const,
        expected: 'int',
        actual: null
      })),
      contractExtras: [],
      collationViolations: [],
      missingProcedures: [],
      pendingMigrationIds: [],
      ok: false
    };

    const reason = formatGateReason(audit, null);
    console.log(`[gate reason] length=${reason.length} head=${reason.slice(0, 80)}`);

    expect(reason.length).toBe(ERROR_SUMMARY_MAX_LENGTH);
    expect(reason.startsWith('DRIFT')).toBe(true);
  });

  it('puts a migration failure ahead of any audit lines', () => {
    const reason = formatGateReason(null, { id: '2026-09-02-01-x', error: 'Duplicate column name' });
    expect(reason).toBe('MIGRATION FAILED 2026-09-02-01-x: Duplicate column name');
  });

  it('emits one warning annotation per quarantined schema with the first reason line', () => {
    expect(formatGitHubAnnotations(summary)).toEqual(['::warning title=Schema quarantined::forestgeo_new — DRIFT line 1']);
  });

  it('writes the result file only when the env var is set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-result-'));
    const target = path.join(dir, 'result.json');

    writeGateResultFile(summary, {});
    expect(fs.existsSync(target)).toBe(false);

    writeGateResultFile(summary, { [GATE_RESULT_PATH_ENV]: target });
    expect(JSON.parse(fs.readFileSync(target, 'utf-8'))).toEqual(summary);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
