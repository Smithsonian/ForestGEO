/**
 * Catalog migration gate — Integration Tests
 *
 * Proves against a real local MySQL server that the dedicated catalog runner:
 *   1. creates the shared `catalog` database and the three background-job tables
 *      through the reviewed migration file (server-level bootstrap connection,
 *      then a catalog-scoped connection);
 *   2. records the migration in `catalog.catalog_migrations` and is idempotent —
 *      a second apply does nothing and a follow-up check reports no pending work;
 *   3. serializes on ONE global lock, not a per-schema lock;
 *   4. classifies a stale table and FAILS CLOSED rather than dropping it;
 *   5. never writes the catalog migration id into a site `schema_migrations`
 *      ledger.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/catalog-migration.integration.test.ts
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';

import {
  applyPendingCatalogMigrations,
  CATALOG_BACKGROUND_JOB_TABLES,
  CATALOG_LEDGER_TABLE,
  CATALOG_MIGRATION_LOCK_NAME,
  ensureCatalogDatabase,
  loadCatalogMigrationSources,
  readCatalogLedger,
  remediateEmptyUnreleasedCatalogTables,
  runCatalogPreflight,
  selectPendingCatalogMigrations,
  StaleCatalogSchemaError
} from '@/scripts/apply-catalog-migrations';
import { CATALOG_DATABASE_NAME, CATALOG_MIGRATION_MANIFEST } from '@/db/migrations/catalog-manifest';
import { LEDGER_TABLE as SITE_LEDGER_TABLE } from '@/scripts/apply-schema-migrations';
import type { SqlExecutor } from '@/scripts/lib/schema-cli';

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';

if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(`[catalog-migration] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not local. This suite drops and recreates catalog tables.`);
}

const SETTINGS = {
  host: TEST_DB_HOST,
  port: Number(process.env.TEST_DB_PORT || 3306),
  user: process.env.TEST_DB_USER || 'root',
  password: process.env.TEST_DB_PASSWORD || 'testpassword'
};

const CATALOG_MIGRATION_ID = CATALOG_MIGRATION_MANIFEST[0].id;

describe('catalog migration gate — integration', () => {
  let connection: Connection;
  let exec: SqlExecutor;

  beforeAll(async () => {
    await ensureCatalogDatabase({ ...SETTINGS, allowedHosts: [TEST_DB_HOST] });
    connection = await mysql.createConnection({ ...SETTINGS, database: CATALOG_DATABASE_NAME, multipleStatements: true });
    exec = async (sql, params) => {
      const [rows] = await connection.query(sql, params ?? []);
      return Array.isArray(rows) ? (rows as Awaited<ReturnType<SqlExecutor>>) : [];
    };
    console.log(`[setup] catalog runner target host=${SETTINGS.host}:${SETTINGS.port}`);
  }, 60000);

  afterAll(async () => {
    if (connection) await connection.end();
  });

  /** Full reset so each test starts from a known catalog state. */
  beforeEach(async () => {
    for (const table of CATALOG_BACKGROUND_JOB_TABLES) {
      await connection.query(`DROP TABLE IF EXISTS \`${CATALOG_DATABASE_NAME}\`.\`${table}\``);
    }
    await connection.query(`DROP TABLE IF EXISTS \`${CATALOG_DATABASE_NAME}\`.\`${CATALOG_LEDGER_TABLE}\``);
  });

  async function tableNames(): Promise<string[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
      [CATALOG_DATABASE_NAME]
    );
    return rows.map(row => String(row.name));
  }

  it('applies the migration from absent to current and records the ledger', async () => {
    const before = await runCatalogPreflight(exec);
    expect(before.tables.every(entry => entry.state === 'absent')).toBe(true);

    const result = await applyPendingCatalogMigrations(exec, loadCatalogMigrationSources(), before);
    console.log(`[apply] pendingBefore=${JSON.stringify(result.pendingBefore)} appliedNow=${JSON.stringify(result.appliedNow)}`);

    expect(result.failed).toBeNull();
    expect(result.appliedNow).toEqual([CATALOG_MIGRATION_ID]);

    const after = await runCatalogPreflight(exec);
    console.log(`[apply] post states=${JSON.stringify(after.tables.map(entry => [entry.table, entry.state, entry.rowCount]))}`);
    expect(after.tables.every(entry => entry.state === 'current')).toBe(true);
    expect(after.tables.every(entry => entry.rowCount === 0)).toBe(true);

    const created = await tableNames();
    for (const table of CATALOG_BACKGROUND_JOB_TABLES) {
      expect(created).toContain(table);
    }

    const ledger = await readCatalogLedger(exec);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ MigrationID: CATALOG_MIGRATION_ID, Status: 'applied' });
  }, 60000);

  it('is idempotent: check → apply → check leaves no pending work and applies nothing twice', async () => {
    const sources = loadCatalogMigrationSources();

    // check (first): everything pending
    expect(selectPendingCatalogMigrations(sources, await readCatalogLedger(exec)).map(source => source.id)).toEqual([CATALOG_MIGRATION_ID]);

    // apply
    const first = await applyPendingCatalogMigrations(exec, sources, await runCatalogPreflight(exec));
    expect(first.appliedNow).toEqual([CATALOG_MIGRATION_ID]);

    // check (second): nothing pending
    expect(selectPendingCatalogMigrations(sources, await readCatalogLedger(exec))).toHaveLength(0);

    // apply again: no-op, and the ledger still holds exactly one row
    const second = await applyPendingCatalogMigrations(exec, sources, await runCatalogPreflight(exec));
    console.log(`[idempotency] second apply appliedNow=${JSON.stringify(second.appliedNow)}`);
    expect(second.appliedNow).toEqual([]);
    expect(await readCatalogLedger(exec)).toHaveLength(1);
  }, 60000);

  it('holds one global catalog lock during apply and releases it afterwards', async () => {
    const observer = await mysql.createConnection({ ...SETTINGS, database: CATALOG_DATABASE_NAME });
    try {
      // Hold the global lock from another session; the runner must not proceed.
      const [held] = await observer.query<RowDataPacket[]>(`SELECT GET_LOCK(?, 1) AS acquired`, [CATALOG_MIGRATION_LOCK_NAME]);
      expect(Number(held[0].acquired)).toBe(1);

      const [blocked] = await connection.query<RowDataPacket[]>(`SELECT IS_USED_LOCK(?) IS NOT NULL AS inUse`, [CATALOG_MIGRATION_LOCK_NAME]);
      expect(Number(blocked[0].inUse)).toBe(1);

      await observer.query(`SELECT RELEASE_LOCK(?)`, [CATALOG_MIGRATION_LOCK_NAME]);
    } finally {
      await observer.end();
    }

    await applyPendingCatalogMigrations(exec, loadCatalogMigrationSources(), await runCatalogPreflight(exec));

    // After a successful apply the lock must be free for the next deploy.
    const [freed] = await connection.query<RowDataPacket[]>(`SELECT IS_USED_LOCK(?) AS holder`, [CATALOG_MIGRATION_LOCK_NAME]);
    console.log(`[lock] post-apply holder=${JSON.stringify(freed[0].holder)}`);
    expect(freed[0].holder).toBeNull();
  }, 60000);

  it('classifies a stale table and refuses to apply or drop it', async () => {
    // A table left by the older bootstrap: incompatible ENUM plus the Service
    // Bus era LastMessageID column.
    await connection.query(
      `CREATE TABLE \`${CATALOG_DATABASE_NAME}\`.background_jobs (
         JobID BIGINT AUTO_INCREMENT PRIMARY KEY,
         Status ENUM('created','dead_lettered','blob_received') NOT NULL DEFAULT 'created',
         LastMessageID VARCHAR(128) NULL
       ) ENGINE=InnoDB`
    );

    const preflight = await runCatalogPreflight(exec);
    const jobs = preflight.tables.find(entry => entry.table === 'background_jobs');
    console.log(`[stale] differences=${JSON.stringify(jobs?.differences)} rows=${jobs?.rowCount}`);

    expect(jobs?.state).toBe('stale');
    expect(jobs?.differences.some(difference => difference.includes('LastMessageID'))).toBe(true);
    expect(jobs?.rowCount).toBe(0);

    await expect(applyPendingCatalogMigrations(exec, loadCatalogMigrationSources(), preflight)).rejects.toThrow(StaleCatalogSchemaError);

    // Fail-closed means the table survives untouched and nothing was recorded.
    expect(await tableNames()).toContain('background_jobs');
    expect(await readCatalogLedger(exec)).toHaveLength(0);
  }, 60000);

  it('refuses remediation when a stale table holds rows, and succeeds once it is empty', async () => {
    await connection.query(
      `CREATE TABLE \`${CATALOG_DATABASE_NAME}\`.background_jobs (
         JobID BIGINT AUTO_INCREMENT PRIMARY KEY,
         Status ENUM('created','dead_lettered') NOT NULL DEFAULT 'created',
         LastMessageID VARCHAR(128) NULL
       ) ENGINE=InnoDB`
    );
    await connection.query(`INSERT INTO \`${CATALOG_DATABASE_NAME}\`.background_jobs (Status) VALUES ('created')`);

    const withData = await runCatalogPreflight(exec);
    expect(withData.staleRowTotal).toBe(1);
    await expect(remediateEmptyUnreleasedCatalogTables(exec, withData)).rejects.toThrow(/contain data/i);
    expect(await tableNames()).toContain('background_jobs');

    // Operator empties the unreleased table, then remediation is allowed.
    await connection.query(`DELETE FROM \`${CATALOG_DATABASE_NAME}\`.background_jobs`);
    const emptied = await runCatalogPreflight(exec);
    await remediateEmptyUnreleasedCatalogTables(exec, emptied);
    expect(await tableNames()).not.toContain('background_jobs');

    // And the normal gate now succeeds from a clean slate.
    const result = await applyPendingCatalogMigrations(exec, loadCatalogMigrationSources(), await runCatalogPreflight(exec));
    expect(result.failed).toBeNull();
    expect((await runCatalogPreflight(exec)).tables.every(entry => entry.state === 'current')).toBe(true);
  }, 60000);

  it('never records the catalog migration id in a site schema_migrations ledger', async () => {
    await applyPendingCatalogMigrations(exec, loadCatalogMigrationSources(), await runCatalogPreflight(exec));

    // The catalog ledger is a distinct table from the per-site ledger name.
    expect(CATALOG_LEDGER_TABLE).not.toBe(SITE_LEDGER_TABLE);

    const [siteLedgerRows] = await connection.query<RowDataPacket[]>(
      `SELECT TABLE_SCHEMA AS schemaName FROM information_schema.TABLES WHERE TABLE_NAME = ? AND TABLE_SCHEMA LIKE 'forestgeo\\_%'`,
      [SITE_LEDGER_TABLE]
    );

    for (const row of siteLedgerRows) {
      const siteSchema = String(row.schemaName);
      const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM \`${siteSchema}\`.\`${SITE_LEDGER_TABLE}\` WHERE MigrationID = ?`, [
        CATALOG_MIGRATION_ID
      ]);
      console.log(`[separation] ${siteSchema}.${SITE_LEDGER_TABLE} rows with catalog id = ${rows[0].count}`);
      expect(Number(rows[0].count)).toBe(0);
    }
  }, 60000);
});
