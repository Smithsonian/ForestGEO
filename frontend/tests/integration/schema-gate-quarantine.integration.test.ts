/**
 * Contract-gate quarantine proof (integration, real MySQL). See #429.
 *
 * Two throwaway site schemas built by the same helpers every integration suite
 * uses (tablestructures + corequeries + storedprocedures). One is regressed to a
 * shape NO manifest migration repairs (coremeasurements.DeletedAt dropped —
 * asserted below against the manifest sources), so the gate cannot converge it.
 * DeletedAt is deliberately a column no index references, so restoring it
 * restores the contract exactly and case (4) proves release, not index drift.
 *
 *   (1) a never-passed drifted schema is QUARANTINED, exit 0, QuarantinedAt set;
 *   (2) a clean schema PASSES, LastPassedAt set, no quarantine;
 *   (3) re-running the drifted schema keeps the ORIGINAL QuarantinedAt;
 *   (4) repairing the column and re-running RELEASES it (QuarantinedAt NULL);
 *   (5) regressing the previously-passed schema is BLOCKED: exit 1,
 *       LastFailedAt set, QuarantinedAt still NULL;
 *   (6) the gate refuses to run when catalog.schema_contract_gate is absent.
 *
 * Prerequisites: docker compose up -d mysql
 * Run alone: npm run test:integration -- tests/integration/schema-gate-quarantine.integration.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { createTestDatabase, loadSchema, loadValidationDefinitions, loadStoredProcedures, DEFAULT_TEST_CONFIG } from '../setup/local-db-setup';
import { applyPendingCatalogMigrations, ensureCatalogDatabase, loadCatalogMigrationSources, runCatalogPreflight } from '@/scripts/apply-catalog-migrations';
import { loadMigrationSources, runCli } from '@/scripts/apply-schema-migrations';
import { SCHEMA_GATE_TABLE } from '@/scripts/lib/schema-gate';
import { CATALOG_DATABASE_NAME } from '@/db/migrations/catalog-manifest';

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(`[schema-gate-quarantine] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not local.`);
}

const GOOD_SCHEMA = 'forestgeo_gatetest_good';
const BAD_SCHEMA = 'forestgeo_gatetest_bad';
const DRIFT_TABLE = 'coremeasurements';
const DRIFT_COLUMN = 'DeletedAt';
const DRIFT_COLUMN_DDL = 'datetime NULL';
const EXIT_OK = 0;
const EXIT_FAILED = 1;
/** MySQL DATETIME has second precision, so a re-run must land in a later second. */
const ONE_SECOND_MS = 1100;

interface GateRow extends RowDataPacket {
  SchemaName: string;
  LastPassedAt: Date | null;
  LastFailedAt: Date | null;
  QuarantinedAt: Date | null;
  QuarantineReason: string | null;
  LastRunRef: string | null;
}

async function buildSiteSchema(database: string): Promise<void> {
  const connection = await createTestDatabase({ ...DEFAULT_TEST_CONFIG, database });
  try {
    await loadSchema(connection);
    await loadValidationDefinitions(connection);
    await loadStoredProcedures(connection);
  } finally {
    await connection.end();
  }
}

describe('schema contract gate — quarantine (integration)', () => {
  let server: Connection;

  async function gateRow(schema: string): Promise<GateRow | null> {
    const [rows] = await server.query<GateRow[]>(`SELECT * FROM \`${CATALOG_DATABASE_NAME}\`.\`${SCHEMA_GATE_TABLE}\` WHERE SchemaName = ?`, [schema]);
    return rows[0] ?? null;
  }

  async function dropDriftColumn(schema: string): Promise<void> {
    await server.query(`ALTER TABLE \`${schema}\`.\`${DRIFT_TABLE}\` DROP COLUMN \`${DRIFT_COLUMN}\``);
  }

  async function restoreDriftColumn(schema: string): Promise<void> {
    await server.query(`ALTER TABLE \`${schema}\`.\`${DRIFT_TABLE}\` ADD COLUMN \`${DRIFT_COLUMN}\` ${DRIFT_COLUMN_DDL}`);
  }

  beforeAll(async () => {
    server = await mysql.createConnection({
      host: DEFAULT_TEST_CONFIG.host,
      port: DEFAULT_TEST_CONFIG.port,
      user: DEFAULT_TEST_CONFIG.user,
      password: DEFAULT_TEST_CONFIG.password,
      multipleStatements: true
    });

    await ensureCatalogDatabase({ ...DEFAULT_TEST_CONFIG, allowedHosts: [TEST_DB_HOST] });
    const catalog = await mysql.createConnection({
      host: DEFAULT_TEST_CONFIG.host,
      port: DEFAULT_TEST_CONFIG.port,
      user: DEFAULT_TEST_CONFIG.user,
      password: DEFAULT_TEST_CONFIG.password,
      database: CATALOG_DATABASE_NAME,
      multipleStatements: true
    });
    try {
      const exec = async (sql: string, params?: unknown[]) => {
        const [rows] = await catalog.query(sql, params ?? []);
        return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
      };
      const result = await applyPendingCatalogMigrations(exec, loadCatalogMigrationSources(), await runCatalogPreflight(exec));
      console.log(`[setup] catalog migrations applied now: ${JSON.stringify(result.appliedNow)} failed=${JSON.stringify(result.failed)}`);
      expect(result.failed).toBeNull();
      await catalog.query(`DELETE FROM \`${CATALOG_DATABASE_NAME}\`.\`${SCHEMA_GATE_TABLE}\` WHERE SchemaName IN (?, ?)`, [GOOD_SCHEMA, BAD_SCHEMA]);
    } finally {
      await catalog.end();
    }

    await buildSiteSchema(GOOD_SCHEMA);
    await buildSiteSchema(BAD_SCHEMA);
    await dropDriftColumn(BAD_SCHEMA);
    console.log(`[setup] ${GOOD_SCHEMA} canonical; ${BAD_SCHEMA} missing ${DRIFT_TABLE}.${DRIFT_COLUMN}`);
  }, 180000);

  afterAll(async () => {
    if (!server) return;
    await server.query(`DROP DATABASE IF EXISTS \`${GOOD_SCHEMA}\``);
    await server.query(`DROP DATABASE IF EXISTS \`${BAD_SCHEMA}\``);
    await server.query(`DELETE FROM \`${CATALOG_DATABASE_NAME}\`.\`${SCHEMA_GATE_TABLE}\` WHERE SchemaName IN (?, ?)`, [GOOD_SCHEMA, BAD_SCHEMA]);
    await server.end();
  });

  it('the induced drift is one the manifest cannot repair (guards the test against becoming a convergence test)', () => {
    const mentioning = loadMigrationSources().filter(source => new RegExp(`\\b${DRIFT_COLUMN}\\b`, 'i').test(source.contents));
    expect(
      mentioning.map(source => source.id),
      `pick a different DRIFT_COLUMN: these manifest migrations touch ${DRIFT_COLUMN}`
    ).toEqual([]);
  });

  it('(1) quarantines a never-passed schema that fails the audit, without failing the run', async () => {
    const exitCode = await runCli(['--schema', BAD_SCHEMA, '--apply']);
    const row = await gateRow(BAD_SCHEMA);
    console.log(`[case 1] exit=${exitCode} row=${JSON.stringify(row)}`);

    expect(exitCode).toBe(EXIT_OK);
    expect(row?.QuarantinedAt).toBeInstanceOf(Date);
    expect(row?.LastPassedAt).toBeNull();
    expect(row?.QuarantineReason).toMatch(new RegExp(`DRIFT \\[${DRIFT_TABLE}\\] column "${DRIFT_COLUMN}"`));
  }, 120000);

  it('(2) passes a clean schema and stamps LastPassedAt', async () => {
    const exitCode = await runCli(['--schema', GOOD_SCHEMA, '--apply']);
    const row = await gateRow(GOOD_SCHEMA);
    console.log(`[case 2] exit=${exitCode} row=${JSON.stringify(row)}`);

    expect(exitCode).toBe(EXIT_OK);
    expect(row?.LastPassedAt).toBeInstanceOf(Date);
    expect(row?.QuarantinedAt).toBeNull();
  }, 120000);

  it('(3) a re-run keeps the original QuarantinedAt and refreshes the reason', async () => {
    const before = await gateRow(BAD_SCHEMA);
    await new Promise(resolve => setTimeout(resolve, ONE_SECOND_MS));

    const exitCode = await runCli(['--schema', BAD_SCHEMA, '--apply']);
    const after = await gateRow(BAD_SCHEMA);
    console.log(
      `[case 3] before=${before?.QuarantinedAt?.toISOString()} after=${after?.QuarantinedAt?.toISOString()} lastFailed=${after?.LastFailedAt?.toISOString()}`
    );

    expect(exitCode).toBe(EXIT_OK);
    expect(after?.QuarantinedAt?.getTime()).toBe(before?.QuarantinedAt?.getTime());
    expect(after!.LastFailedAt!.getTime()).toBeGreaterThan(before!.LastFailedAt!.getTime());
  }, 120000);

  it('(4) repairing the drift and re-running releases the schema', async () => {
    await restoreDriftColumn(BAD_SCHEMA);

    const exitCode = await runCli(['--schema', BAD_SCHEMA, '--apply']);
    const row = await gateRow(BAD_SCHEMA);
    console.log(`[case 4] exit=${exitCode} row=${JSON.stringify(row)}`);

    expect(exitCode).toBe(EXIT_OK);
    expect(row?.QuarantinedAt).toBeNull();
    expect(row?.QuarantineReason).toBeNull();
    expect(row?.LastPassedAt).toBeInstanceOf(Date);
  }, 120000);

  it('(5) a previously-passed schema that regresses is BLOCKED, not quarantined', async () => {
    await dropDriftColumn(GOOD_SCHEMA);

    const exitCode = await runCli(['--schema', GOOD_SCHEMA, '--apply']);
    const row = await gateRow(GOOD_SCHEMA);
    console.log(`[case 5] exit=${exitCode} row=${JSON.stringify(row)}`);

    expect(exitCode).toBe(EXIT_FAILED);
    expect(row?.QuarantinedAt).toBeNull();
    expect(row?.LastFailedAt).toBeInstanceOf(Date);
    expect(row?.LastPassedAt).toBeInstanceOf(Date);

    await restoreDriftColumn(GOOD_SCHEMA);
  }, 120000);

  it('(6) refuses to run when the gate table is absent, naming the catalog runner', async () => {
    await server.query(`RENAME TABLE \`${CATALOG_DATABASE_NAME}\`.\`${SCHEMA_GATE_TABLE}\` TO \`${CATALOG_DATABASE_NAME}\`.\`${SCHEMA_GATE_TABLE}_hidden\``);
    try {
      await expect(runCli(['--schema', GOOD_SCHEMA, '--apply'])).rejects.toThrow(/apply-catalog-migrations/);
    } finally {
      await server.query(`RENAME TABLE \`${CATALOG_DATABASE_NAME}\`.\`${SCHEMA_GATE_TABLE}_hidden\` TO \`${CATALOG_DATABASE_NAME}\`.\`${SCHEMA_GATE_TABLE}\``);
    }
  }, 60000);
});
