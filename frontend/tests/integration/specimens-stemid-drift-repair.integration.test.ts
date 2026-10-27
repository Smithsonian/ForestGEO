/**
 * specimens.StemID drift repair (#552): integration, real MySQL.
 *
 * Four live schemas (forestgeo_mpala, forestgeo_panama, forestgeo_serc,
 * forestgeo_testing) carried specimens.StemGUID instead of the canonical StemID.
 * bulkingestionprocess reads specimens.StemID on every batch (#489), so every
 * upload there failed with Error 1054. Migration 2026-10-26-01 renames the column
 * where that drift exists, no-ops on canonical schemas, and fails loudly on any
 * other shape.
 *
 * This file proves:
 *   (7) the canonical no-op leaves SHOW CREATE TABLE byte-identical;
 *   (8) the both-columns / neither-column / table-missing states fail with a named
 *       conflict, change nothing, leave no helper procedure, and the "neither"
 *       state recovers once a person adds the column.
 *
 * Prerequisites: docker compose up -d mysql (from the main checkout root)
 * Run alone: npm run test:integration -- specimens-stemid-drift-repair
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { createTestDatabase, DEFAULT_TEST_CONFIG, loadSchema } from '../setup/local-db-setup';
import type { SchemaQueryRow } from '@/lib/db/schema-contract';
import {
  applyPendingMigrations,
  LEDGER_TABLE,
  loadMigrationSources,
  MIGRATION_STATUS,
  type MigrationSource,
  type SqlExecutor
} from '@/scripts/apply-schema-migrations';

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(
    `[specimens-stemid-drift-repair] REFUSING TO RUN: TEST_DB_HOST="${TEST_DB_HOST}" is not local. This suite renames, drops and recreates specimens columns.`
  );
}

const MIGRATION_ID = '2026-10-26-01-rename-specimens-stemguid-to-stemid';
const CONFLICT_HELPER_PROCEDURE = 'mig_2026_10_26_01_raise_contract_conflict';
const CONFLICT_MESSAGE_PREFIX = 'specimens stem column conflict:';
const CONFLICT_DETAIL = {
  BOTH_COLUMNS: 'both StemID and StemGUID exist; reconcile by hand',
  NEITHER_COLUMN: 'neither StemID nor StemGUID exists',
  TABLE_MISSING: 'table specimens is missing'
} as const;

const SPECIMENS_TABLE = 'specimens';
const CANONICAL_STEM_COLUMN = 'StemID';
const DRIFTED_STEM_COLUMN = 'StemGUID';
const STEM_FOREIGN_KEY = 'specimens_stems_StemID_fk';

/** Throwaway schemas are named from this checkout's harness schema, so worktrees never collide. */
const THROWAWAY_SCHEMA_SUFFIX = {
  CANONICAL: '_spec_canonical',
  BOTH_COLUMNS: '_spec_both',
  NEITHER_COLUMN: '_spec_neither',
  TABLE_MISSING: '_spec_missing',
  NEITHER_THEN_REPAIRED: '_spec_retry'
} as const;

const STEMID_COLUMN_DDL = 'int NULL';

interface SpecimensColumnShape {
  name: string;
  columnType: string;
  isNullable: string;
  ordinalPosition: number;
}

interface SpecimensForeignKeyShape {
  column: string;
  referencedTable: string;
  referencedColumn: string;
  deleteRule: string;
}

interface SpecimensShape {
  tablePresent: boolean;
  columns: SpecimensColumnShape[];
  stemForeignKey: SpecimensForeignKeyShape | null;
  stemForeignKeyIndexColumns: string[];
}

interface LedgerEntry {
  status: string;
  checksum: string;
  appliedAt: string;
  errorSummary: string | null;
}

class MigrationNotInManifestError extends Error {
  constructor(migrationID: string) {
    super(`Migration ${migrationID} is not listed in db/migrations/manifest.ts (or its file is missing).`);
    this.name = 'MigrationNotInManifestError';
  }
}

function requireMigrationSource(): MigrationSource {
  const source = loadMigrationSources().find(candidate => candidate.id === MIGRATION_ID);
  if (!source) throw new MigrationNotInManifestError(MIGRATION_ID);
  return source;
}

function connectionExecutor(connection: Connection): SqlExecutor {
  return async (sql: string, params?: unknown[]): Promise<SchemaQueryRow[]> => {
    const [rows] = await connection.query(sql, params ?? []);
    return Array.isArray(rows) ? (rows as SchemaQueryRow[]) : [];
  };
}

async function readSpecimensShape(connection: Connection, schema: string): Promise<SpecimensShape> {
  const [tableRows] = await connection.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS tableCount FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [schema, SPECIMENS_TABLE]
  );
  const [columnRows] = await connection.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, ORDINAL_POSITION AS ordinalPosition
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [schema, SPECIMENS_TABLE]
  );
  const [foreignKeyRows] = await connection.query<RowDataPacket[]>(
    `SELECT kcu.COLUMN_NAME AS columnName, kcu.REFERENCED_TABLE_NAME AS referencedTable,
            kcu.REFERENCED_COLUMN_NAME AS referencedColumn, rc.DELETE_RULE AS deleteRule
     FROM information_schema.KEY_COLUMN_USAGE kcu
     JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
       ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
     WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND kcu.CONSTRAINT_NAME = ?`,
    [schema, SPECIMENS_TABLE, STEM_FOREIGN_KEY]
  );
  const [indexRows] = await connection.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME AS columnName FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
     ORDER BY SEQ_IN_INDEX`,
    [schema, SPECIMENS_TABLE, STEM_FOREIGN_KEY]
  );
  const foreignKey = foreignKeyRows[0];
  return {
    tablePresent: Number(tableRows[0].tableCount) === 1,
    columns: columnRows.map(row => ({
      name: String(row.name),
      columnType: String(row.columnType),
      isNullable: String(row.isNullable),
      ordinalPosition: Number(row.ordinalPosition)
    })),
    stemForeignKey: foreignKey
      ? {
          column: String(foreignKey.columnName),
          referencedTable: String(foreignKey.referencedTable),
          referencedColumn: String(foreignKey.referencedColumn),
          deleteRule: String(foreignKey.deleteRule)
        }
      : null,
    stemForeignKeyIndexColumns: indexRows.map(row => String(row.columnName))
  };
}

async function showCreateSpecimens(connection: Connection): Promise<string> {
  const [rows] = await connection.query<RowDataPacket[]>(`SHOW CREATE TABLE ${SPECIMENS_TABLE}`);
  return String(rows[0]['Create Table']);
}

async function helperProcedureExists(connection: Connection, schema: string): Promise<boolean> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS helperCount FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ?`,
    [schema, CONFLICT_HELPER_PROCEDURE]
  );
  return Number(rows[0].helperCount) > 0;
}

async function readLedgerEntry(connection: Connection, schema: string, migrationID: string): Promise<LedgerEntry | null> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT Status AS status, Checksum AS checksum, CAST(AppliedAt AS CHAR) AS appliedAt, ErrorSummary AS errorSummary
     FROM \`${schema}\`.\`${LEDGER_TABLE}\` WHERE MigrationID = ?`,
    [migrationID]
  );
  if (rows.length === 0) return null;
  return {
    status: String(rows[0].status),
    checksum: String(rows[0].checksum),
    appliedAt: String(rows[0].appliedAt),
    errorSummary: rows[0].errorSummary === null ? null : String(rows[0].errorSummary)
  };
}

async function dropThrowawaySchema(connection: Connection, schema: string): Promise<void> {
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${schema}\``);
  } finally {
    await connection.end();
  }
}

/**
 * A fresh schema holding only the canonical DDL (no procedures, no seed).
 * createTestDatabase closes its own connection if it fails. If loadSchema fails, this
 * helper drops the half-built schema and closes the connection before rethrowing, because
 * the caller's try/finally only starts once this returns.
 */
async function provisionCanonicalSchema(suffix: string): Promise<{ schema: string; connection: Connection }> {
  const schema = `${DEFAULT_TEST_CONFIG.database}${suffix}`;
  const connection = await createTestDatabase({ ...DEFAULT_TEST_CONFIG, database: schema });
  try {
    await loadSchema(connection);
  } catch (error) {
    await dropThrowawaySchema(connection, schema);
    throw error;
  }
  return { schema, connection };
}

describe('migration 2026-10-26-01 guard states on canonical-only schemas', () => {
  let migrationSource: MigrationSource;

  beforeAll(() => {
    migrationSource = requireMigrationSource();
  });

  it('(7) leaves a canonical specimens table byte-identical and records the migration applied', async () => {
    const { schema, connection } = await provisionCanonicalSchema(THROWAWAY_SCHEMA_SUFFIX.CANONICAL);
    try {
      const createBefore = await showCreateSpecimens(connection);
      const result = await applyPendingMigrations(connectionExecutor(connection), schema, [migrationSource]);
      const createAfter = await showCreateSpecimens(connection);
      const ledger = await readLedgerEntry(connection, schema, MIGRATION_ID);
      const helperLeft = await helperProcedureExists(connection, schema);
      console.log(
        `[case 7] schema=${schema} result=${JSON.stringify(result)} ledger=${JSON.stringify(ledger)} helperLeft=${helperLeft}\n` +
          `[case 7] before:\n${createBefore}\n[case 7] after:\n${createAfter}`
      );

      expect(result.failed, result.failed ? `${result.failed.id}: ${result.failed.error}` : undefined).toBeNull();
      expect(result.appliedNow).toEqual([MIGRATION_ID]);
      expect(ledger?.status).toBe(MIGRATION_STATUS.APPLIED);
      expect(createAfter).toBe(createBefore);
      expect(helperLeft).toBe(false);
    } finally {
      await dropThrowawaySchema(connection, schema);
    }
  });

  const LOUD_FAILURE_STATES = [
    {
      label: 'both columns',
      suffix: THROWAWAY_SCHEMA_SUFFIX.BOTH_COLUMNS,
      detail: CONFLICT_DETAIL.BOTH_COLUMNS,
      regress: [
        `ALTER TABLE ${SPECIMENS_TABLE} RENAME COLUMN ${CANONICAL_STEM_COLUMN} TO ${DRIFTED_STEM_COLUMN}`,
        `ALTER TABLE ${SPECIMENS_TABLE} ADD COLUMN ${CANONICAL_STEM_COLUMN} ${STEMID_COLUMN_DDL}`
      ]
    },
    {
      label: 'neither column',
      suffix: THROWAWAY_SCHEMA_SUFFIX.NEITHER_COLUMN,
      detail: CONFLICT_DETAIL.NEITHER_COLUMN,
      regress: [`ALTER TABLE ${SPECIMENS_TABLE} DROP FOREIGN KEY ${STEM_FOREIGN_KEY}`, `ALTER TABLE ${SPECIMENS_TABLE} DROP COLUMN ${CANONICAL_STEM_COLUMN}`]
    },
    {
      label: 'table missing',
      suffix: THROWAWAY_SCHEMA_SUFFIX.TABLE_MISSING,
      detail: CONFLICT_DETAIL.TABLE_MISSING,
      regress: [`DROP TABLE ${SPECIMENS_TABLE}`]
    }
  ] as const;

  it.each(LOUD_FAILURE_STATES)('(8) $label: fails with a named conflict, changes nothing, and leaves no helper', async state => {
    const { schema, connection } = await provisionCanonicalSchema(state.suffix);
    try {
      for (const statement of state.regress) await connection.query(statement);
      const shapeBefore = await readSpecimensShape(connection, schema);
      const result = await applyPendingMigrations(connectionExecutor(connection), schema, [migrationSource]);
      const shapeAfter = await readSpecimensShape(connection, schema);
      const ledger = await readLedgerEntry(connection, schema, MIGRATION_ID);
      const helperLeft = await helperProcedureExists(connection, schema);
      console.log(
        `[case 8 ${state.label}] schema=${schema} failed=${JSON.stringify(result.failed)} ledger=${JSON.stringify(ledger)} helperLeft=${helperLeft}\n` +
          `[case 8 ${state.label}] before=${JSON.stringify(shapeBefore)}\n[case 8 ${state.label}] after=${JSON.stringify(shapeAfter)}`
      );

      expect(result.failed?.id).toBe(MIGRATION_ID);
      expect(result.failed?.error).toContain(`${CONFLICT_MESSAGE_PREFIX} ${state.detail}`);
      expect(result.appliedNow).toEqual([]);
      expect(ledger?.status).toBe(MIGRATION_STATUS.FAILED);
      expect(shapeAfter).toEqual(shapeBefore);
      expect(helperLeft).toBe(false);
    } finally {
      await dropThrowawaySchema(connection, schema);
    }
  });

  it('(8) neither column: once a person adds StemID, the retry succeeds and flips the ledger to applied', async () => {
    const { schema, connection } = await provisionCanonicalSchema(THROWAWAY_SCHEMA_SUFFIX.NEITHER_THEN_REPAIRED);
    try {
      await connection.query(`ALTER TABLE ${SPECIMENS_TABLE} DROP FOREIGN KEY ${STEM_FOREIGN_KEY}`);
      await connection.query(`ALTER TABLE ${SPECIMENS_TABLE} DROP COLUMN ${CANONICAL_STEM_COLUMN}`);
      const firstAttempt = await applyPendingMigrations(connectionExecutor(connection), schema, [migrationSource]);
      const ledgerAfterFailure = await readLedgerEntry(connection, schema, MIGRATION_ID);

      await connection.query(`ALTER TABLE ${SPECIMENS_TABLE} ADD COLUMN ${CANONICAL_STEM_COLUMN} ${STEMID_COLUMN_DDL}`);
      const retry = await applyPendingMigrations(connectionExecutor(connection), schema, [migrationSource]);
      const ledgerAfterRetry = await readLedgerEntry(connection, schema, MIGRATION_ID);
      const helperLeft = await helperProcedureExists(connection, schema);
      console.log(
        `[case 8 retry] first=${JSON.stringify(firstAttempt.failed)} ledgerAfterFailure=${JSON.stringify(ledgerAfterFailure)}\n` +
          `[case 8 retry] retry=${JSON.stringify(retry)} ledgerAfterRetry=${JSON.stringify(ledgerAfterRetry)} helperLeft=${helperLeft}`
      );

      expect(firstAttempt.failed?.error).toContain(`${CONFLICT_MESSAGE_PREFIX} ${CONFLICT_DETAIL.NEITHER_COLUMN}`);
      expect(ledgerAfterFailure?.status).toBe(MIGRATION_STATUS.FAILED);
      expect(retry.failed, retry.failed ? `${retry.failed.id}: ${retry.failed.error}` : undefined).toBeNull();
      expect(retry.pendingBefore).toEqual([MIGRATION_ID]);
      expect(retry.appliedNow).toEqual([MIGRATION_ID]);
      expect(ledgerAfterRetry?.status).toBe(MIGRATION_STATUS.APPLIED);
      expect(ledgerAfterRetry?.errorSummary).toBeNull();
      expect(helperLeft).toBe(false);
    } finally {
      await dropThrowawaySchema(connection, schema);
    }
  });
});
