/**
 * idx_mss_plot_census_scope (View Data scope index) on real MySQL: a schema built from tablestructures.sql
 * has it, and the manifest migration restores it on a schema that lacks it and is a no-op when re-applied.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestDatabaseConfig } from '../setup/local-db-setup';
import {
  applyPendingMigrations,
  LEDGER_TABLE,
  loadMigrationSources,
  MIGRATION_STATUS,
  type MigrationSource,
  type SqlExecutor
} from '@/scripts/apply-schema-migrations';
import type { SchemaQueryRow } from '@/lib/db/schema-contract';

const MIGRATION_ID = '2026-11-11-01-add-measurementssummary-plot-census-scope-index';
const SUMMARY_TABLE = 'measurementssummary';
const SCOPE_INDEX = 'idx_mss_plot_census_scope';
const SCOPE_INDEX_COLUMNS = ['PlotID', 'CensusID', 'MeasurementDate', 'StemGUID', 'IsValidated'];

let connection: Connection;
let config: TestDatabaseConfig;
let schema: string;
let migrationSource: MigrationSource;

function connectionExecutor(target: Connection): SqlExecutor {
  return async (sql: string, params?: unknown[]): Promise<SchemaQueryRow[]> => {
    const [rows] = await target.query(sql, params ?? []);
    return Array.isArray(rows) ? (rows as SchemaQueryRow[]) : [];
  };
}

async function scopeIndexColumns(): Promise<string[]> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME AS columnName FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? ORDER BY SEQ_IN_INDEX`,
    [schema, SUMMARY_TABLE, SCOPE_INDEX]
  );
  console.log(`[scope index] schema=${schema} columns=${JSON.stringify(rows.map(row => row.columnName))}`);
  return rows.map(row => String(row.columnName));
}

beforeAll(async () => {
  const setup = await setupTestDatabase();
  connection = setup.connection;
  config = setup.config;
  schema = config.database;
  const source = loadMigrationSources().find(candidate => candidate.id === MIGRATION_ID);
  if (!source) throw new Error(`Migration ${MIGRATION_ID} is not listed in db/migrations/manifest.ts (or its file is missing).`);
  migrationSource = source;
}, 120000);

afterAll(async () => {
  await teardownTestDatabase(connection, config);
});

describe('measurementssummary scope index', () => {
  it('exists with its five columns in order on a schema built from tablestructures.sql', async () => {
    expect(await scopeIndexColumns()).toEqual(SCOPE_INDEX_COLUMNS);
  });

  it('is restored by the migration once and left as exactly one index when the migration runs again', async () => {
    await connection.query(`DROP INDEX \`${SCOPE_INDEX}\` ON ${SUMMARY_TABLE}`);
    expect(await scopeIndexColumns(), 'precondition: index dropped').toEqual([]);

    const first = await applyPendingMigrations(connectionExecutor(connection), schema, [migrationSource]);
    console.log(`[scope index] first apply ${JSON.stringify(first)}`);
    expect(first.failed).toBeNull();
    expect(first.appliedNow).toEqual([MIGRATION_ID]);
    expect(await scopeIndexColumns()).toEqual(SCOPE_INDEX_COLUMNS);

    await connection.query(`DELETE FROM ${LEDGER_TABLE} WHERE MigrationID = ?`, [MIGRATION_ID]);
    const second = await applyPendingMigrations(connectionExecutor(connection), schema, [migrationSource]);
    console.log(`[scope index] second apply (ledger row cleared) ${JSON.stringify(second)}`);
    expect(second.failed, 'a second run over an existing index must not error').toBeNull();
    expect(await scopeIndexColumns()).toEqual(SCOPE_INDEX_COLUMNS);

    const [ledger] = await connection.query<RowDataPacket[]>(`SELECT Status FROM ${LEDGER_TABLE} WHERE MigrationID = ?`, [MIGRATION_ID]);
    expect(ledger.map(row => row.Status)).toEqual([MIGRATION_STATUS.APPLIED]);
  });
});
