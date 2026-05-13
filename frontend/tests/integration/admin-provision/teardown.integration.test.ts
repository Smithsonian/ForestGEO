import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { join } from 'path';

// We need to observe the orchestrator's audit calls without polluting the
// module registry for sibling test files in the same worker (singleFork +
// isolate: false). Strategy: lazily mock the audit module via vi.doMock in
// beforeAll, dynamically import the orchestrator, then explicitly vi.doUnmock
// + vi.resetModules in afterAll so other test files see the real audit module.
type TeardownFn = typeof import('@/lib/provisioning/orchestrator').teardownProvisionedSite;
type AbortFn = typeof import('@/lib/provisioning/orchestrator').abortRun;

const auditSpies = {
  auditAttempt: vi.fn(),
  auditSuccess: vi.fn(),
  auditFailure: vi.fn()
};

let teardownProvisionedSite!: TeardownFn;
let abortRun!: AbortFn;

const TEST_SCHEMA = 'forestgeo_teardown_test';
const CATALOG_DDL = join(process.cwd(), 'sqlscripting/catalog-provisioning-tables.sql');

describe('teardownProvisionedSite / abortRun (integration)', () => {
  let pool: mysql.Pool;

  beforeAll(async () => {
    // Reset the registry so previously-cached modules that captured a stale
    // audit reference get a fresh binding.
    vi.resetModules();
    vi.doMock('@/lib/provisioning/audit', async () => {
      const actual = await vi.importActual<typeof import('@/lib/provisioning/audit')>('@/lib/provisioning/audit');
      return {
        ...actual,
        auditAttempt: auditSpies.auditAttempt,
        auditSuccess: auditSpies.auditSuccess,
        auditFailure: auditSpies.auditFailure
      };
    });
    const orchestrator = await import('@/lib/provisioning/orchestrator');
    teardownProvisionedSite = orchestrator.teardownProvisionedSite;
    abortRun = orchestrator.abortRun;

    pool = mysql.createPool({
      host: process.env.TEST_DB_HOST || 'localhost',
      port: Number(process.env.TEST_DB_PORT || 3306),
      user: process.env.TEST_DB_USER || 'root',
      password: process.env.TEST_DB_PASSWORD || 'testpassword',
      multipleStatements: true,
      connectionLimit: 5
    });
    await pool.query(`CREATE DATABASE IF NOT EXISTS catalog`);
    const ddl = readFileSync(CATALOG_DDL, 'utf-8');
    for (const stmt of ddl
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)) {
      await pool.query(stmt);
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS catalog.sites (
        SiteID INT AUTO_INCREMENT PRIMARY KEY,
        SiteName VARCHAR(255),
        SchemaName VARCHAR(255),
        SQDimX INT,
        SQDimY INT,
        DefaultUOMDBH VARCHAR(16),
        DefaultUOMHOM VARCHAR(16),
        DoubleDataEntry TINYINT
      )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS catalog.usersiterelations (UserID INT, SiteID INT)`);
  });

  beforeEach(async () => {
    auditSpies.auditAttempt.mockClear();
    auditSpies.auditSuccess.mockClear();
    auditSpies.auditFailure.mockClear();
    await pool.query(`DELETE FROM catalog.provisioning_steps`);
    await pool.query(`DELETE FROM catalog.provisioning_runs`);
    await pool.query(`DELETE FROM catalog.usersiterelations`);
    await pool.query(`DELETE FROM catalog.sites WHERE SchemaName = ?`, [TEST_SCHEMA]);
    await pool.query(`DROP DATABASE IF EXISTS \`${TEST_SCHEMA}\``);
  });

  afterAll(async () => {
    await pool.query(`DROP DATABASE IF EXISTS \`${TEST_SCHEMA}\``);
    await pool.end();
    // Clean up module-level mocks so sibling test files (e.g. audit.test.ts)
    // resolve the real implementation when they run in the same worker.
    vi.doUnmock('@/lib/provisioning/audit');
    vi.resetModules();
  });

  async function seedRun(status: 'completed' | 'failed'): Promise<number> {
    await pool.query(`CREATE DATABASE \`${TEST_SCHEMA}\``);
    await pool.query(
      `INSERT INTO catalog.sites (SiteName, SchemaName, SQDimX, SQDimY, DefaultUOMDBH, DefaultUOMHOM, DoubleDataEntry)
       VALUES (?, ?, 20, 20, 'cm', 'm', 0)`,
      ['Test', TEST_SCHEMA]
    );
    const [r]: any = await pool.query(
      `INSERT INTO catalog.provisioning_runs (Status, StartedBy, StartedAt, SiteName, SchemaName, InputPayload)
       VALUES (?, 'admin@test', NOW(), 'Test', ?, JSON_OBJECT())`,
      [status, TEST_SCHEMA]
    );
    return r.insertId;
  }

  it('drops schema and catalog row when confirmation matches', async () => {
    const runId = await seedRun('completed');
    await teardownProvisionedSite(runId, TEST_SCHEMA, pool, 'admin@test');

    const [sites]: any = await pool.query(`SELECT * FROM catalog.sites WHERE SchemaName = ?`, [TEST_SCHEMA]);
    expect(sites).toHaveLength(0);
    const [schemas]: any = await pool.query(`SELECT * FROM information_schema.schemata WHERE schema_name = ?`, [TEST_SCHEMA]);
    expect(schemas).toHaveLength(0);
    expect(auditSpies.auditAttempt).toHaveBeenCalledWith(expect.objectContaining({ action: 'teardown' }));
    expect(auditSpies.auditSuccess).toHaveBeenCalledWith(expect.objectContaining({ action: 'teardown' }));
  });

  it('throws ProvisioningError(not_found) for missing run', async () => {
    await expect(teardownProvisionedSite(99999, 'forestgeo_x', pool, 'admin@test')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('throws ProvisioningError(invalid_input) when confirmation mismatches AND schema not dropped', async () => {
    const runId = await seedRun('completed');
    await expect(teardownProvisionedSite(runId, 'forestgeo_wrong', pool, 'admin@test')).rejects.toMatchObject({ kind: 'invalid_input' });

    // Critical: schema must still exist after a mismatch
    const [schemas]: any = await pool.query(`SELECT * FROM information_schema.schemata WHERE schema_name = ?`, [TEST_SCHEMA]);
    expect(schemas).toHaveLength(1);
    const [sites]: any = await pool.query(`SELECT * FROM catalog.sites WHERE SchemaName = ?`, [TEST_SCHEMA]);
    expect(sites).toHaveLength(1);
  });

  it('confirmation-mismatch error message does NOT leak the actual schema name', async () => {
    const runId = await seedRun('completed');
    try {
      await teardownProvisionedSite(runId, 'forestgeo_wrong', pool, 'admin@test');
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.message).not.toContain(TEST_SCHEMA);
      expect(err.kind).toBe('invalid_input');
    }
  });

  it('abortRun cleans up usersiterelations and catalog row for a failed run', async () => {
    const runId = await seedRun('failed');
    const [site]: any = await pool.query(`SELECT SiteID FROM catalog.sites WHERE SchemaName = ?`, [TEST_SCHEMA]);
    await pool.query(`INSERT INTO catalog.usersiterelations (UserID, SiteID) VALUES (1, ?)`, [site[0].SiteID]);

    await abortRun(runId, pool, 'admin@test');

    const [sites]: any = await pool.query(`SELECT * FROM catalog.sites WHERE SchemaName = ?`, [TEST_SCHEMA]);
    const [relations]: any = await pool.query(`SELECT * FROM catalog.usersiterelations`);
    expect(sites).toHaveLength(0);
    expect(relations).toHaveLength(0);
  });

  it('audits failure when a non-existent run is torn down', async () => {
    try {
      await teardownProvisionedSite(99999, 'forestgeo_x', pool, 'admin@test');
    } catch {
      // expected
    }
    expect(auditSpies.auditFailure).toHaveBeenCalledWith(expect.objectContaining({ action: 'teardown' }));
  });
});
