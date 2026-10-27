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
 *   (1) on a schema regressed to the measured Mpala shape, ingestion fails with the 1054 incident;
 *   (2) the contract gate reports specimens.StemID missing and specimens.StemGUID extra;
 *   (3) the real runner renames the column in place, keeping the FK, its rule and the specimen;
 *   (4) after the repair the same rows ingest;
 *   (5) a census replacement clears the drift-failed rows while the specimen-holding stem survives;
 *   (6) re-runs of the runner and of the SQL change nothing;
 *   (7) the canonical no-op leaves SHOW CREATE TABLE byte-identical;
 *   (8) the both-columns / neither-column / table-missing states fail with a named
 *       conflict, change nothing, leave no helper procedure, and the "neither"
 *       state recovers once a person adds the column.
 *
 * Prerequisites: docker compose up -d mysql (from the main checkout root)
 * Run alone: npm run test:integration -- specimens-stemid-drift-repair
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import {
  createTestDatabase,
  DEFAULT_TEST_CONFIG,
  insertTestMeasurements,
  loadSchema,
  runBulkIngestion,
  setupTestDatabase,
  teardownTestDatabase,
  type TestData,
  type TestDatabaseConfig
} from '../setup/local-db-setup';
import { testDbServerOptions } from '../setup/test-db-connection';
import { formatContractFailures, type SchemaQueryRow } from '@/lib/db/schema-contract';
import {
  applyPendingMigrations,
  auditSchemaContract,
  LEDGER_TABLE,
  loadMigrationSources,
  MIGRATION_STATUS,
  runCli,
  sha256Hex,
  type MigrationSource,
  type SqlExecutor
} from '@/scripts/apply-schema-migrations';
import { applyPendingCatalogMigrations, ensureCatalogDatabase, loadCatalogMigrationSources, runCatalogPreflight } from '@/scripts/apply-catalog-migrations';
import { SCHEMA_GATE_TABLE } from '@/scripts/lib/schema-gate';
import { CATALOG_DATABASE_NAME } from '@/db/migrations/catalog-manifest';
import { SCHEMA_MIGRATION_MANIFEST } from '@/db/migrations/manifest';

const sharedState = vi.hoisted(() => ({
  connection: null as import('mysql2/promise').Connection | null,
  activeTransactionID: null as string | null,
  counter: 0
}));

// cleanupPreviousFileUploads (case 5) runs through this bridge onto the suite's own
// connection. runCli opens its own mysql2 connections and never imports ConnectionManager.
vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (sql: string, params?: unknown[]) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      const [rows] = await sharedState.connection.query(sql, params ?? []);
      return rows;
    },
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      await sharedState.connection.beginTransaction();
      sharedState.counter += 1;
      sharedState.activeTransactionID = `specimens-drift-tx-${sharedState.counter}`;
      return sharedState.activeTransactionID;
    },
    commitTransaction: async () => {
      await sharedState.connection!.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async () => {
      await sharedState.connection!.rollback();
      sharedState.activeTransactionID = null;
    }
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import ConnectionManager from '@/lib/db/connectionmanager';
import { cleanupPreviousFileUploads } from '@/lib/ingestion/temporary-measurements';

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

const MIGRATION_FILE = path.join(process.cwd(), 'db', 'migrations', 'schema-contract-repair', `${MIGRATION_ID}.sql`);
const EXIT_OK = 0;
/** schema_migrations.AppliedAt is DATETIME (second precision): a re-apply must land in a later second to be visible. */
const ONE_SECOND_MS = 1100;
const SETUP_TIMEOUT_MS = 180_000;
const CASE_TIMEOUT_MS = 120_000;

const MYSQL_ERRNO_NO_REFERENCED_ROW = 1452;
const UNKNOWN_COLUMN_ERRNO_TEXT = '1054';
const PROCEDURE_SPECIMENS_COLUMN_REFERENCE = 'sp.StemID';
const ERROR_CODE = { SQL_EXCEPTION: 'SQL_EXCEPTION', INVALID_SPECIES: 'INVALID_SPECIES' } as const;
const STEMS_TABLE = 'stems';
const STEMS_PRIMARY_KEY = 'StemGUID';
const DELETE_RULE_NO_ACTION = 'NO ACTION';
const STEM_COLUMN_TYPE = 'int';
const NULLABLE = 'YES';
const LEGACY_ERROR_CATALOG_COLLATION = 'utf8mb3_general_ci';

const MEASUREMENT_DATE = '2024-03-15';
const QUADRAT = 'Q01';
const STEM_TAG = '1';
const MEASUREMENT_COORDINATE = 5;
const MEASUREMENT_DBH = 10;
const MEASUREMENT_HOM = 1.3;
const SPECIES = { KNOWN: 'ACERRU', CORRECTED: 'QUERCO', UNKNOWN: 'NOSUCHSP' } as const;
const TAG = { SENTINEL: 'SENTINEL', GOOD: 'DRIFT-GOOD', UNKNOWN_SPECIES: 'DRIFT-BADSP' } as const;
const FILE = { SENTINEL: 'sentinel.csv', INCIDENT: 'incident.csv', REPAIRED: 'repaired.csv', REPLACEMENT: 'replacement.csv' } as const;
const BATCH = { SENTINEL: 'stemid-sentinel', INCIDENT: 'stemid-incident', REPAIRED: 'stemid-repaired', REPLACEMENT: 'stemid-replacement' } as const;
const SENTINEL_SPECIMEN_NUMBER = 552;
const ORPHAN_SPECIMEN_NUMBER = 553;
const NONEXISTENT_STEM_OFFSET = 1000;
const TEST_CHANGED_BY = 'specimens-stemid-drift-repair-test';

/**
 * Reproduces the Azure-measured forestgeo_mpala / forestgeo_testing shape (2026-10-26):
 * stem column StemGUID, the FK re-created on it with delete rule NO ACTION, and the
 * error catalog in utf8mb3. ON DELETE NO ACTION is written out so DELETE_RULE is deterministic.
 */
const MPALA_DRIFT_STATEMENTS = [
  `ALTER TABLE specimens DROP FOREIGN KEY ${STEM_FOREIGN_KEY}`,
  `ALTER TABLE specimens RENAME COLUMN ${CANONICAL_STEM_COLUMN} TO ${DRIFTED_STEM_COLUMN}`,
  `ALTER TABLE specimens ADD CONSTRAINT ${STEM_FOREIGN_KEY} FOREIGN KEY (${DRIFTED_STEM_COLUMN}) REFERENCES ${STEMS_TABLE} (${STEMS_PRIMARY_KEY}) ON DELETE NO ACTION`,
  `ALTER TABLE measurement_errors CONVERT TO CHARACTER SET utf8mb3 COLLATE ${LEGACY_ERROR_CATALOG_COLLATION}`
] as const;

type MeasurementRow = Parameters<typeof insertTestMeasurements>[2][number];

function measurementRow(treeTag: string, speciesCode: string): MeasurementRow {
  return {
    treeTag,
    stemTag: STEM_TAG,
    speciesCode,
    quadratName: QUADRAT,
    x: MEASUREMENT_COORDINATE,
    y: MEASUREMENT_COORDINATE,
    dbh: MEASUREMENT_DBH,
    hom: MEASUREMENT_HOM,
    date: MEASUREMENT_DATE
  };
}

const INCIDENT_ROWS: MeasurementRow[] = [measurementRow(TAG.GOOD, SPECIES.KNOWN), measurementRow(TAG.UNKNOWN_SPECIES, SPECIES.UNKNOWN)];
/**
 * The replacement names the sentinel's TreeTag + StemTag on purpose. leftover_stems only
 * considers stems an incoming row names (the INNER JOIN on stem_resolution_rows,
 * storedprocedures.sql ~2774-2787). After the cleanup, the sentinel stem has no measurement,
 * so only the `NOT EXISTS (... specimens sp WHERE sp.StemID = s.StemGUID)` exclusion keeps it
 * out of leftover_stems. With the exclusion, the stem is reused: the replacement row resolves
 * to the original StemGUID and the specimen stays attached. Without it, the stem would be
 * deleted (1451 under this fixture's NO ACTION rule, or the specimen cascaded away under CASCADE).
 */
const REPLACEMENT_ROWS: MeasurementRow[] = [
  measurementRow(TAG.GOOD, SPECIES.KNOWN),
  measurementRow(TAG.UNKNOWN_SPECIES, SPECIES.CORRECTED),
  measurementRow(TAG.SENTINEL, SPECIES.KNOWN)
];

interface BatchRowOutcome {
  tag: string;
  resolved: boolean;
  errorCodes: string | null;
}

interface CensusBatchCount {
  batchID: string | null;
  resolvedRows: number;
  failedRows: number;
}

interface LedgerSnapshotRow {
  migrationID: string;
  status: string;
  appliedAt: string;
}

function mysqlErrno(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'errno' in error && typeof (error as { errno: unknown }).errno === 'number') {
    return (error as { errno: number }).errno;
  }
  return null;
}

async function readLedgerSnapshot(connection: Connection, schema: string): Promise<LedgerSnapshotRow[]> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT MigrationID AS migrationID, Status AS status, CAST(AppliedAt AS CHAR) AS appliedAt
     FROM \`${schema}\`.\`${LEDGER_TABLE}\` ORDER BY MigrationID`
  );
  return rows.map(row => ({ migrationID: String(row.migrationID), status: String(row.status), appliedAt: String(row.appliedAt) }));
}

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

describe('Mpala-shaped specimens drift: incident, gate, repair, recovery (#552)', () => {
  let connection: Connection;
  let catalogConnection: Connection | null = null;
  let testData: TestData;
  let config: TestDatabaseConfig;
  let schema: string;
  let plotID: number;
  let censusID: number;
  let migrationSource: MigrationSource;
  let canonicalStemOrdinal: number;
  let sentinelStemGUID: number;
  const connectionManager = ConnectionManager.getInstance();

  async function stageAndIngest(fileID: string, batchID: string, rows: MeasurementRow[]) {
    await insertTestMeasurements(connection, testData, rows, { fileID, batchID });
    return runBulkIngestion(connection, fileID, batchID);
  }

  async function batchOutcomes(batchID: string): Promise<BatchRowOutcome[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT cm.RawTreeTag AS tag, cm.StemGUID IS NOT NULL AS resolved,
              GROUP_CONCAT(me.ErrorCode ORDER BY me.ErrorCode) AS errorCodes
       FROM coremeasurements cm
       LEFT JOIN measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
       LEFT JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE cm.UploadBatchID = ?
       GROUP BY cm.CoreMeasurementID, cm.RawTreeTag, cm.StemGUID
       ORDER BY cm.RawTreeTag`,
      [batchID]
    );
    return rows.map(row => ({
      tag: String(row.tag),
      resolved: Number(row.resolved) === 1,
      errorCodes: row.errorCodes === null ? null : String(row.errorCodes)
    }));
  }

  async function treeCountForTags(tags: readonly string[]): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS treeCount FROM trees WHERE TreeTag IN (?)`, [tags]);
    return Number(rows[0].treeCount);
  }

  async function errorCatalogCollation(): Promise<string> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT COLLATION_NAME AS collationName FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'measurement_errors' AND COLUMN_NAME = 'ErrorCode'`,
      [schema]
    );
    return String(rows[0].collationName);
  }

  async function gateRow(): Promise<{ lastPassedAt: Date | null; quarantinedAt: Date | null } | null> {
    const [rows] = await catalogConnection!.query<RowDataPacket[]>(
      `SELECT LastPassedAt AS lastPassedAt, QuarantinedAt AS quarantinedAt FROM \`${CATALOG_DATABASE_NAME}\`.\`${SCHEMA_GATE_TABLE}\` WHERE SchemaName = ?`,
      [schema]
    );
    return rows.length === 0 ? null : { lastPassedAt: rows[0].lastPassedAt, quarantinedAt: rows[0].quarantinedAt };
  }

  async function deleteGateRow(): Promise<void> {
    await catalogConnection!.query(`DELETE FROM \`${CATALOG_DATABASE_NAME}\`.\`${SCHEMA_GATE_TABLE}\` WHERE SchemaName = ?`, [schema]);
  }

  async function specimenStemValues(specimenNumber: number): Promise<number[]> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT ${CANONICAL_STEM_COLUMN} AS stemValue FROM specimens WHERE SpecimenNumber = ?`, [
      specimenNumber
    ]);
    return rows.map(row => Number(row.stemValue));
  }

  /** Returns the errno of a specimen insert that points at a stem that does not exist, or null if MySQL accepted it. */
  async function orphanSpecimenInsertErrno(): Promise<number | null> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COALESCE(MAX(${STEMS_PRIMARY_KEY}), 0) AS maxStem FROM ${STEMS_TABLE}`);
    const nonexistentStem = Number(rows[0].maxStem) + NONEXISTENT_STEM_OFFSET;
    try {
      await connection.query(`INSERT INTO specimens (${CANONICAL_STEM_COLUMN}, SpecimenNumber, IsActive) VALUES (?, ?, 1)`, [
        nonexistentStem,
        ORPHAN_SPECIMEN_NUMBER
      ]);
      return null;
    } catch (error) {
      const errno = mysqlErrno(error);
      if (errno === null) throw error;
      return errno;
    }
  }

  async function censusCountsByBatch(): Promise<CensusBatchCount[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT UploadBatchID AS batchID, SUM(StemGUID IS NOT NULL) AS resolvedRows, SUM(StemGUID IS NULL) AS failedRows
       FROM coremeasurements WHERE CensusID = ? GROUP BY UploadBatchID ORDER BY UploadBatchID`,
      [censusID]
    );
    return rows.map(row => ({
      batchID: row.batchID === null ? null : String(row.batchID),
      resolvedRows: Number(row.resolvedRows),
      failedRows: Number(row.failedRows)
    }));
  }

  async function sqlExceptionLinkCount(): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS linkCount
       FROM measurement_error_log mel
       JOIN coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
       JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE cm.CensusID = ? AND me.ErrorCode = ?`,
      [censusID, ERROR_CODE.SQL_EXCEPTION]
    );
    return Number(rows[0].linkCount);
  }

  async function stemExists(stemGUID: number): Promise<boolean> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS stemCount FROM ${STEMS_TABLE} WHERE ${STEMS_PRIMARY_KEY} = ?`, [stemGUID]);
    return Number(rows[0].stemCount) === 1;
  }

  /** StemGUIDs the given batch's measurements for one tree tag resolved to (NULL for a failed row). */
  async function resolvedStemGUIDsForTag(batchID: string, treeTag: string): Promise<Array<number | null>> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT StemGUID AS stemGUID FROM coremeasurements WHERE UploadBatchID = ? AND RawTreeTag = ?`, [
      batchID,
      treeTag
    ]);
    return rows.map(row => (row.stemGUID === null ? null : Number(row.stemGUID)));
  }

  /** Every current-census stem under one tree tag: a rebuilt (duplicate) stem would show up here. */
  async function stemGUIDsForTreeTag(treeTag: string): Promise<number[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT s.StemGUID AS stemGUID FROM stems s JOIN trees t ON t.TreeID = s.TreeID WHERE t.TreeTag = ? AND s.CensusID = ? ORDER BY s.StemGUID`,
      [treeTag, censusID]
    );
    return rows.map(row => Number(row.stemGUID));
  }

  async function ingestSentinelStemWithSpecimen(): Promise<number> {
    const result = await stageAndIngest(FILE.SENTINEL, BATCH.SENTINEL, [measurementRow(TAG.SENTINEL, SPECIES.KNOWN)]);
    expect(result.success, `sentinel ingestion while canonical: ${result.message}`).toBe(true);
    const [stemRows] = await connection.query<RowDataPacket[]>(
      `SELECT s.StemGUID AS stemGUID FROM stems s JOIN trees t ON t.TreeID = s.TreeID WHERE t.TreeTag = ? AND s.CensusID = ?`,
      [TAG.SENTINEL, censusID]
    );
    expect(stemRows, 'exactly one sentinel stem').toHaveLength(1);
    const stemGUID = Number(stemRows[0].stemGUID);
    await connection.query(`INSERT INTO specimens (${CANONICAL_STEM_COLUMN}, SpecimenNumber, IsActive) VALUES (?, ?, 1)`, [stemGUID, SENTINEL_SPECIMEN_NUMBER]);
    return stemGUID;
  }

  beforeAll(async () => {
    await ensureCatalogDatabase({ ...DEFAULT_TEST_CONFIG, allowedHosts: [TEST_DB_HOST] });
    catalogConnection = await mysql.createConnection({ ...testDbServerOptions(), database: CATALOG_DATABASE_NAME, multipleStatements: true });
    const catalogExec = connectionExecutor(catalogConnection);
    const catalogResult = await applyPendingCatalogMigrations(catalogExec, loadCatalogMigrationSources(), await runCatalogPreflight(catalogExec));
    console.log(`[setup] catalog migrations applied now: ${JSON.stringify(catalogResult.appliedNow)} failed=${JSON.stringify(catalogResult.failed)}`);
    expect(catalogResult.failed).toBeNull();

    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    schema = config.database;
    plotID = testData.plots[0].plotID;
    censusID = testData.census[0].censusID;
    sharedState.connection = connection;
    await deleteGateRow();

    migrationSource = requireMigrationSource();
    const canonicalStemColumn = (await readSpecimensShape(connection, schema)).columns.find(column => column.name === CANONICAL_STEM_COLUMN);
    expect(canonicalStemColumn, 'canonical DDL must define specimens.StemID').toBeDefined();
    canonicalStemOrdinal = canonicalStemColumn!.ordinalPosition;

    sentinelStemGUID = await ingestSentinelStemWithSpecimen();
    for (const statement of MPALA_DRIFT_STATEMENTS) await connection.query(statement);
    console.log(`[setup] schema=${schema} plot=${plotID} census=${censusID} sentinelStem=${sentinelStemGUID} canonicalStemOrdinal=${canonicalStemOrdinal}`);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    sharedState.connection = null;
    // Site teardown sits in the OUTER finally: a failed gate-row delete or catalog close must
    // never strand this checkout's test schema or its connection.
    try {
      if (catalogConnection) {
        try {
          if (schema) await deleteGateRow();
        } finally {
          await catalogConnection.end();
        }
      }
    } finally {
      await teardownTestDatabase(connection, config);
    }
  });

  it(
    '(1) the fixture matches the measured Mpala shape, and ingestion fails with the 1054 incident',
    async () => {
      const shape = await readSpecimensShape(connection, schema);
      const collation = await errorCatalogCollation();
      console.log(`[case 1] fixture shape=${JSON.stringify(shape)} measurement_errors collation=${collation}`);
      expect(shape.columns.map(column => column.name)).toContain(DRIFTED_STEM_COLUMN);
      expect(shape.columns.map(column => column.name)).not.toContain(CANONICAL_STEM_COLUMN);
      expect(shape.stemForeignKey).toEqual({
        column: DRIFTED_STEM_COLUMN,
        referencedTable: STEMS_TABLE,
        referencedColumn: STEMS_PRIMARY_KEY,
        deleteRule: DELETE_RULE_NO_ACTION
      });
      expect(collation).toBe(LEGACY_ERROR_CATALOG_COLLATION);

      const result = await stageAndIngest(FILE.INCIDENT, BATCH.INCIDENT, INCIDENT_ROWS);
      const outcomes = await batchOutcomes(BATCH.INCIDENT);
      const treesForIncidentTags = await treeCountForTags([TAG.GOOD, TAG.UNKNOWN_SPECIES]);
      console.log(`[case 1] ingestion=${JSON.stringify(result)} outcomes=${JSON.stringify(outcomes)} treesForIncidentTags=${treesForIncidentTags}`);

      expect(result.success).toBe(false);
      expect(result.message).toContain(UNKNOWN_COLUMN_ERRNO_TEXT);
      expect(result.message).toContain(PROCEDURE_SPECIMENS_COLUMN_REFERENCE);
      expect(outcomes).toEqual([
        { tag: TAG.UNKNOWN_SPECIES, resolved: false, errorCodes: ERROR_CODE.SQL_EXCEPTION },
        { tag: TAG.GOOD, resolved: false, errorCodes: ERROR_CODE.SQL_EXCEPTION }
      ]);
      expect(treesForIncidentTags).toBe(0);
    },
    CASE_TIMEOUT_MS
  );

  it('(2) the contract gate reports specimens.StemID missing and specimens.StemGUID extra, and nothing else', async () => {
    const audit = await auditSchemaContract(connectionExecutor(connection), schema, []);
    console.log(
      `[case 2] ok=${audit.ok} failures:\n${formatContractFailures(audit.contractFailures)}\n` +
        `[case 2] specimens extras=${JSON.stringify(audit.contractExtras.filter(extra => extra.table === SPECIMENS_TABLE))} missingProcedures=${JSON.stringify(audit.missingProcedures)}`
    );

    expect(audit.ok).toBe(false);
    expect(audit.contractFailures).toContainEqual(expect.objectContaining({ table: SPECIMENS_TABLE, object: CANONICAL_STEM_COLUMN, kind: 'missing' }));
    expect(audit.contractExtras).toContainEqual(expect.objectContaining({ table: SPECIMENS_TABLE, object: DRIFTED_STEM_COLUMN, category: 'column' }));
    expect(audit.contractFailures.filter(failure => failure.table !== SPECIMENS_TABLE)).toEqual([]);
    expect(audit.missingProcedures).toEqual([]);
  });

  it(
    '(3) the real runner renames the column in place, keeps the FK, its rule and the specimen, and passes the gate',
    async () => {
      const exitCode = await runCli(['--schema', schema, '--apply']);
      const ledger = await readLedgerEntry(connection, schema, MIGRATION_ID);
      const ledgerSnapshot = await readLedgerSnapshot(connection, schema);
      const gate = await gateRow();
      const shape = await readSpecimensShape(connection, schema);
      const sentinelStemValues = await specimenStemValues(SENTINEL_SPECIMEN_NUMBER);
      const orphanErrno = await orphanSpecimenInsertErrno();
      const audit = await auditSchemaContract(connectionExecutor(connection), schema, []);
      const fileChecksum = sha256Hex(fs.readFileSync(MIGRATION_FILE, 'utf-8'));
      console.log(
        `[case 3] exit=${exitCode} ledger=${JSON.stringify(ledger)} fileChecksum=${fileChecksum} gate=${JSON.stringify(gate)}\n` +
          `[case 3] ledgerSnapshot=${JSON.stringify(ledgerSnapshot)}\n[case 3] shape=${JSON.stringify(shape)}\n` +
          `[case 3] sentinelStemValues=${JSON.stringify(sentinelStemValues)} expected=${sentinelStemGUID} orphanErrno=${orphanErrno}\n` +
          `[case 3] audit ok=${audit.ok} failures:\n${formatContractFailures(audit.contractFailures)}`
      );

      expect(exitCode).toBe(EXIT_OK);
      expect(ledger?.status).toBe(MIGRATION_STATUS.APPLIED);
      expect(ledger?.checksum).toBe(fileChecksum);
      expect(ledgerSnapshot.map(row => row.migrationID).sort()).toEqual(SCHEMA_MIGRATION_MANIFEST.map(entry => entry.id).sort());
      expect(ledgerSnapshot.every(row => row.status === MIGRATION_STATUS.APPLIED)).toBe(true);
      expect(gate?.lastPassedAt).toBeInstanceOf(Date);
      expect(gate?.quarantinedAt).toBeNull();
      expect(shape.columns.find(column => column.name === CANONICAL_STEM_COLUMN)).toEqual({
        name: CANONICAL_STEM_COLUMN,
        columnType: STEM_COLUMN_TYPE,
        isNullable: NULLABLE,
        ordinalPosition: canonicalStemOrdinal
      });
      expect(shape.columns.map(column => column.name)).not.toContain(DRIFTED_STEM_COLUMN);
      expect(shape.stemForeignKey).toEqual({
        column: CANONICAL_STEM_COLUMN,
        referencedTable: STEMS_TABLE,
        referencedColumn: STEMS_PRIMARY_KEY,
        deleteRule: DELETE_RULE_NO_ACTION
      });
      expect(shape.stemForeignKeyIndexColumns).toEqual([CANONICAL_STEM_COLUMN]);
      expect(sentinelStemValues).toEqual([sentinelStemGUID]);
      expect(orphanErrno).toBe(MYSQL_ERRNO_NO_REFERENCED_ROW);
      expect(audit.ok).toBe(true);
    },
    CASE_TIMEOUT_MS
  );

  it(
    '(4) after the repair the same rows ingest: the good row resolves and only the unknown species fails',
    async () => {
      const result = await stageAndIngest(FILE.REPAIRED, BATCH.REPAIRED, INCIDENT_ROWS);
      const outcomes = await batchOutcomes(BATCH.REPAIRED);
      console.log(`[case 4] ingestion=${JSON.stringify(result)} outcomes=${JSON.stringify(outcomes)}`);

      expect(result.success, result.message).toBe(true);
      expect(outcomes).toEqual([
        { tag: TAG.UNKNOWN_SPECIES, resolved: false, errorCodes: ERROR_CODE.INVALID_SPECIES },
        { tag: TAG.GOOD, resolved: true, errorCodes: null }
      ]);
    },
    CASE_TIMEOUT_MS
  );

  it(
    '(5) a census replacement clears every drift-failed row; the replacement names the specimen stem, which is protected and reused',
    async () => {
      const transactionID = await connectionManager.beginTransaction();
      try {
        await cleanupPreviousFileUploads(connectionManager, schema, FILE.REPLACEMENT, BATCH.REPLACEMENT, plotID, censusID, TEST_CHANGED_BY, transactionID);
        await connectionManager.commitTransaction(transactionID);
      } catch (error) {
        await connectionManager.rollbackTransaction(transactionID);
        throw error;
      }
      // After the cleanup the sentinel stem holds no measurement but still holds the specimen,
      // and the replacement names its TreeTag + StemTag: only the procedure's specimens
      // exclusion keeps it out of leftover_stems now.
      const sentinelStemsBeforeReplacement = await stemGUIDsForTreeTag(TAG.SENTINEL);
      const result = await stageAndIngest(FILE.REPLACEMENT, BATCH.REPLACEMENT, REPLACEMENT_ROWS);
      const countsByBatch = await censusCountsByBatch();
      const sqlExceptionLinks = await sqlExceptionLinkCount();
      const sentinelStemSurvives = await stemExists(sentinelStemGUID);
      const sentinelStemsAfterReplacement = await stemGUIDsForTreeTag(TAG.SENTINEL);
      const sentinelReplacementResolvedTo = await resolvedStemGUIDsForTag(BATCH.REPLACEMENT, TAG.SENTINEL);
      const sentinelStemValues = await specimenStemValues(SENTINEL_SPECIMEN_NUMBER);
      console.log(
        `[case 5] ingestion=${JSON.stringify(result)} countsByBatch=${JSON.stringify(countsByBatch)} sqlExceptionLinks=${sqlExceptionLinks}\n` +
          `[case 5] sentinelStem=${sentinelStemGUID} survives=${sentinelStemSurvives} ` +
          `stemsBefore=${JSON.stringify(sentinelStemsBeforeReplacement)} stemsAfter=${JSON.stringify(sentinelStemsAfterReplacement)}\n` +
          `[case 5] sentinel replacement row resolved to=${JSON.stringify(sentinelReplacementResolvedTo)} specimenStemValues=${JSON.stringify(sentinelStemValues)}`
      );

      expect(sentinelStemsBeforeReplacement, 'the cleanup deletes measurements, never stems').toEqual([sentinelStemGUID]);
      expect(result.success, result.message).toBe(true);
      expect(countsByBatch).toEqual([{ batchID: BATCH.REPLACEMENT, resolvedRows: REPLACEMENT_ROWS.length, failedRows: 0 }]);
      expect(sqlExceptionLinks).toBe(0);
      expect(sentinelStemSurvives, 'the specimen-holding stem must not be deleted as a leftover').toBe(true);
      expect(sentinelStemsAfterReplacement, 'no rebuilt duplicate stem under the sentinel tag').toEqual([sentinelStemGUID]);
      expect(sentinelReplacementResolvedTo, 'the replacement row reuses the protected stem').toEqual([sentinelStemGUID]);
      expect(sentinelStemValues, 'the specimen still points at the original stem').toEqual([sentinelStemGUID]);
    },
    CASE_TIMEOUT_MS
  );

  it(
    '(6) re-runs change nothing: a ledger re-run applies nothing, and a direct SQL re-run is a byte-identical no-op',
    async () => {
      const ledgerBefore = await readLedgerSnapshot(connection, schema);
      await new Promise(resolve => setTimeout(resolve, ONE_SECOND_MS));
      const exitCode = await runCli(['--schema', schema, '--apply']);
      const ledgerAfter = await readLedgerSnapshot(connection, schema);

      const createBefore = await showCreateSpecimens(connection);
      await connection.query(migrationSource.contents);
      const createAfter = await showCreateSpecimens(connection);
      const helperLeft = await helperProcedureExists(connection, schema);
      console.log(
        `[case 6] exit=${exitCode}\n[case 6] ledgerBefore=${JSON.stringify(ledgerBefore)}\n[case 6] ledgerAfter=${JSON.stringify(ledgerAfter)}\n` +
          `[case 6] helperLeft=${helperLeft} createIdentical=${createAfter === createBefore}\n[case 6] before:\n${createBefore}\n[case 6] after:\n${createAfter}`
      );

      expect(exitCode).toBe(EXIT_OK);
      expect(ledgerAfter).toEqual(ledgerBefore);
      expect(createAfter).toBe(createBefore);
      expect(helperLeft).toBe(false);
    },
    CASE_TIMEOUT_MS
  );
});
