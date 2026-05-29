/**
 * Shared helpers for admin-provision route integration tests.
 *
 * These tests exercise the real route handlers against a docker-compose MySQL.
 * The orchestrator is NOT mocked — we seed real catalog rows and assert real
 * post-call DB state. The only legitimate mock at the route boundary is `auth()`
 * because Next-auth has no runtime in vitest.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import mysql, { type Pool } from 'mysql2/promise';

export const TEST_SCHEMA_PREFIX = 'forestgeo_routetest_';

export const GLOBAL_SESSION = { user: { email: 'admin@test', userStatus: 'global' } };
export const DB_ADMIN_SESSION = { user: { email: 'dbadmin@test', userStatus: 'db admin' } };
export const FIELD_CREW_SESSION = { user: { email: 'crew@test', userStatus: 'field crew' } };

export interface SeedStep {
  stepIndex: number;
  stepKey: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  /** Use this to pass a JS Date you want literal-inserted (subject to mysql2 tz handling). */
  startedAt?: Date | null;
  /**
   * Preferred for tests sensitive to age comparisons: use NOW() - N seconds
   * (computed server-side) so the host/MySQL timezone offset cannot skew the
   * apparent age of the row.
   */
  startedAtSecondsAgo?: number;
  finishedAt?: Date | null;
  errorMessage?: string | null;
}

export function createTestPool(): Pool {
  return mysql.createPool({
    host: process.env.TEST_DB_HOST || 'localhost',
    port: Number(process.env.TEST_DB_PORT || 3306),
    user: process.env.TEST_DB_USER || 'root',
    password: process.env.TEST_DB_PASSWORD || 'testpassword',
    multipleStatements: true,
    connectionLimit: 5
  });
}

/**
 * Loads the catalog provisioning DDL and creates the supporting `sites` and
 * `usersiterelations` tables used by abort/teardown paths. Idempotent.
 */
export async function seedCatalogTables(pool: Pool): Promise<void> {
  await pool.query(`CREATE DATABASE IF NOT EXISTS catalog`);
  const ddlPath = join(process.cwd(), 'sqlscripting/catalog-provisioning-tables.sql');
  const ddl = readFileSync(ddlPath, 'utf-8');
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
}

/**
 * Cleans all rows in the provisioning catalog tables. If a `schemaName` is
 * provided, the matching site row is removed and the schema dropped — otherwise
 * any sites whose name starts with TEST_SCHEMA_PREFIX are removed.
 */
export async function clearProvisioningState(pool: Pool, schemaName?: string): Promise<void> {
  await pool.query(`DELETE FROM catalog.provisioning_steps`);
  await pool.query(`DELETE FROM catalog.provisioning_runs`);
  await pool.query(`DELETE FROM catalog.usersiterelations`);
  if (schemaName) {
    await pool.query(`DELETE FROM catalog.sites WHERE SchemaName = ?`, [schemaName]);
    await pool.query(`DROP DATABASE IF EXISTS \`${schemaName}\``);
  } else {
    await pool.query(`DELETE FROM catalog.sites WHERE SchemaName LIKE ?`, [TEST_SCHEMA_PREFIX + '%']);
  }
}

/**
 * Seeds a single provisioning_runs row plus its catalog.sites companion row.
 * Optionally creates the schema database itself, which abort and teardown paths
 * expect to find when they drop it.
 */
export async function seedRun(
  pool: Pool,
  schemaName: string,
  status: 'running' | 'completed' | 'failed' | 'aborted',
  options: { createSchema?: boolean; insertSiteRow?: boolean; siteName?: string } = {}
): Promise<number> {
  const { createSchema = false, insertSiteRow = true, siteName = 'Test' } = options;

  if (insertSiteRow) {
    await pool.query(
      `INSERT INTO catalog.sites (SiteName, SchemaName, SQDimX, SQDimY, DefaultUOMDBH, DefaultUOMHOM, DoubleDataEntry)
       VALUES (?, ?, 20, 20, 'cm', 'm', 0)`,
      [siteName, schemaName]
    );
  }
  if (createSchema) {
    await pool.query(`CREATE DATABASE IF NOT EXISTS \`${schemaName}\``);
  }
  const finishedAt = status === 'running' ? null : new Date();
  const [r]: any = await pool.query(
    `INSERT INTO catalog.provisioning_runs
       (Status, StartedBy, StartedAt, FinishedAt, SiteName, SchemaName, InputPayload)
     VALUES (?, 'admin@test', NOW(), ?, ?, ?, JSON_OBJECT())`,
    [status, finishedAt, siteName, schemaName]
  );
  return r.insertId;
}

export async function seedSteps(pool: Pool, runId: number, steps: SeedStep[]): Promise<void> {
  for (const step of steps) {
    if (typeof step.startedAtSecondsAgo === 'number') {
      await pool.query(
        `INSERT INTO catalog.provisioning_steps
           (RunID, StepIndex, StepKey, Status, StartedAt, FinishedAt, ErrorMessage)
         VALUES (?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? SECOND), ?, ?)`,
        [runId, step.stepIndex, step.stepKey, step.status, step.startedAtSecondsAgo, step.finishedAt ?? null, step.errorMessage ?? null]
      );
    } else {
      await pool.query(
        `INSERT INTO catalog.provisioning_steps
           (RunID, StepIndex, StepKey, Status, StartedAt, FinishedAt, ErrorMessage)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [runId, step.stepIndex, step.stepKey, step.status, step.startedAt ?? null, step.finishedAt ?? null, step.errorMessage ?? null]
      );
    }
  }
}

export function makeRequest(url: string, init: { method?: string; body?: unknown; rawBody?: string } = {}): Request {
  const headers = { 'Content-Type': 'application/json' };
  if (init.rawBody !== undefined) {
    return new Request(url, { method: init.method ?? 'GET', headers, body: init.rawBody });
  }
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  return new Request(url, { method: init.method ?? 'GET', headers, body });
}

export function makeParams(runId: string | number): { params: Promise<{ runId: string }> } {
  return { params: Promise.resolve({ runId: String(runId) }) };
}
