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
import { vi } from 'vitest';

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

/**
 * Suppresses the orchestrator's background `dispatchRun` kickoff by stubbing
 * `setImmediate` to a no-op, so the caller observes only the synchronous catalog
 * writes that startRun/retryRun perform inline.
 *
 * MUST be called from beforeEach, never beforeAll. vitest.integration.config.mts
 * sets `restoreMocks`, which tears a beforeAll spy down after the FIRST test.
 * With the seam dead from test 2 onward, dispatchRun ran real provisioning —
 * CREATE DATABASE and schema DDL — and started a 10-second heartbeat interval
 * that outlived the file and deadlocked the next test's catalog cleanup
 * (ER_LOCK_DEADLOCK on DELETE FROM catalog.provisioning_runs).
 */
export function suppressBackgroundDispatch() {
  return vi.spyOn(globalThis, 'setImmediate').mockImplementation((() => 0) as never);
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
  const ddlPath = join(process.cwd(), 'db/sql/catalog-provisioning-tables.sql');
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

/** Escapes the LIKE metacharacters in a schema name so `_` matches a literal underscore. */
function likePrefix(schemaName: string): string {
  return schemaName.replace(/([\\%_])/g, '\\$1') + '%';
}

/**
 * Cleans the provisioning catalog rows owned by one test file.
 *
 * `catalog` is shared by every integration file (only the per-site
 * `forestgeo_test_*` schemas are isolated), so this used to delete whole tables.
 * An unqualified `DELETE FROM catalog.provisioning_runs` locks every row and
 * cascades into provisioning_steps, which deadlocks against the worker's
 * heartbeat `UPDATE ... WHERE RunID = ?` — see the ER_LOCK_DEADLOCK in
 * start.integration.test.ts. Scoping each delete to the caller's own schema
 * keeps the lock footprint on rows this file actually owns.
 *
 * The match is a PREFIX: worker.integration.test.ts seeds derived schemas
 * (`<TEST_SCHEMA>_c`, `_f`, `_a`, `_fresh`) that must be cleared alongside their
 * parent. No two files' schemas prefix one another, so this cannot reach across
 * files. Only the exact schema is dropped as a database.
 *
 * Omitting `schemaName` keeps the table-wide wipe, which list.integration.test.ts
 * needs because it asserts the route returns an empty array when NO runs exist.
 */
export async function clearProvisioningState(pool: Pool, schemaName?: string): Promise<void> {
  if (schemaName) {
    const owned = likePrefix(schemaName);
    // Single-table DELETE with a subquery, NOT the multi-table `DELETE t FROM t JOIN u`
    // form: createTestPool() intentionally selects no default database, and the
    // multi-table form needs one even when every table is schema-qualified
    // (ER_NO_DB_ERROR 1046).
    await pool.query(
      `DELETE FROM catalog.provisioning_steps
        WHERE RunID IN (SELECT RunID FROM catalog.provisioning_runs WHERE SchemaName LIKE ?)`,
      [owned]
    );
    await pool.query(`DELETE FROM catalog.provisioning_runs WHERE SchemaName LIKE ?`, [owned]);
    await pool.query(
      `DELETE FROM catalog.usersiterelations
        WHERE SiteID IN (SELECT SiteID FROM catalog.sites WHERE SchemaName LIKE ?)`,
      [owned]
    );
    await pool.query(`DELETE FROM catalog.sites WHERE SchemaName LIKE ?`, [owned]);
    await pool.query(`DROP DATABASE IF EXISTS \`${schemaName}\``);
    return;
  }
  await pool.query(`DELETE FROM catalog.provisioning_steps`);
  await pool.query(`DELETE FROM catalog.provisioning_runs`);
  await pool.query(`DELETE FROM catalog.usersiterelations`);
  await pool.query(`DELETE FROM catalog.sites WHERE SchemaName LIKE ?`, [TEST_SCHEMA_PREFIX + '%']);
}

/**
 * A minimal but fully valid `ProvisioningInput` (quadrats mode 'none' so it needs
 * no rows). loadRun's parseStoredInput now validates the stored payload as canonical
 * run input, so a route test that exercises a real retry/execute success path needs
 * a payload that actually passes CanonicalProvisioningSchema — not a stub. Tests that
 * only assert status/authz/precondition behavior never read `input`, so this shape is
 * a safe default for all of them.
 */
function makeSeedInputPayload(siteName: string, schemaName: string): unknown {
  return {
    site: {
      siteName,
      schemaName,
      sqDimX: 20,
      sqDimY: 20,
      defaultUOMDBH: 'cm',
      defaultUOMHOM: 'm',
      doubleDataEntry: false,
      location: 'Test Location',
      country: 'Test Country'
    },
    plot: {
      plotName: 'Test Plot',
      dimensionX: 100,
      dimensionY: 100,
      area: 10000,
      globalX: 0,
      globalY: 0,
      globalZ: 0,
      plotShape: 'square',
      description: '',
      defaultDimensionUnits: 'm',
      defaultCoordinateUnits: 'm',
      defaultAreaUnits: 'm2',
      defaultDBHUnits: 'mm',
      defaultHOMUnits: 'm'
    },
    quadrats: { mode: 'none' }
  };
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
     VALUES (?, 'admin@test', NOW(), ?, ?, ?, ?)`,
    [status, finishedAt, siteName, schemaName, JSON.stringify(makeSeedInputPayload(siteName, schemaName))]
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
