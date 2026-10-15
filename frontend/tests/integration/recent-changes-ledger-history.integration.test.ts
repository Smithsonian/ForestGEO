/**
 * Recent Changes (#507): the edit_operations ledger -> unifiedchangelog, both
 * going forward and retroactively.
 *
 * Two independent code paths claim to produce the SAME projection of a ledger
 * entry into unifiedchangelog:
 *   - writeEditOperation's dual-write (frontend/config/editoperations.ts), for
 *     every edit/revert/bulk-revision-row made AFTER this feature shipped;
 *   - migration 2026-10-14-02 (frontend/db/migrations/schema-contract-repair/
 *     2026-10-14-02-backfill-edit-operations-to-unifiedchangelog.sql), a
 *     one-time backfill for every ledger entry written BEFORE it shipped.
 *
 * Both are driven here against real local MySQL, through their actual
 * production entry points (writeEditOperation itself; the migration's exact
 * file content via loadMigrationSources + applyPendingMigrations, including
 * the real schema_migrations ledger and migration lock) — never a
 * reimplementation of the mapping. A real coremeasurements/cmattributes/
 * species table backs every row; nothing here asserts against an in-memory
 * fixture.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import path from 'path';

import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null
}));

const TEST_TRANSACTION_ID = 'recent-changes-ledger-history-txn';

// ---------------------------------------------------------------------------
// Mock ConnectionManager, mirroring editoperations.integration.test.ts: the
// adapter drives the ONE shared real connection, so writeEditOperation's
// transactionID plumbing and recordMutation's shared-transaction guarantee
// both run for real, against real MySQL, while the test controls commit vs.
// rollback explicitly.
// ---------------------------------------------------------------------------
vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      const [rows] = await sharedState.connection.query(query, (params as unknown[]) ?? []);
      return rows;
    },
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (sharedState.activeTransactionID) throw new Error('ConnectionManager mock: transaction already active');
      await sharedState.connection.beginTransaction();
      sharedState.activeTransactionID = TEST_TRANSACTION_ID;
      return TEST_TRANSACTION_ID;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: commit transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: rollback transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined,
    acquireApplicationLock: async () => true
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({
  default: { info: () => undefined, warn: () => undefined, error: () => undefined }
}));

// Imports below must follow vi.mock so the mocked ConnectionManager is wired
// into every module under test, including the loader/executor used for the
// historical migration path.
import ConnectionManager from '@/lib/db/connectionmanager';
import { ensureEditOperationsTable, writeEditOperation, type EditOperationStateRow, type EditOperationWriteInput } from '@/config/editoperations';
import { ChangelogWriteError } from '@/lib/changelog/record-mutation';
import { BULK_REVISION_SUMMARY_KIND } from '@/lib/changelog/edit-operation-projection';
import {
  ensureLedgerTable,
  loadMigrationSources,
  applyPendingMigrations,
  type SqlExecutor,
  type MigrationSource,
  type ApplyResult
} from '@/scripts/apply-schema-migrations';
import { SCHEMA_MIGRATION_MANIFEST } from '@/db/migrations/manifest';
import type { SchemaQueryRow } from '@/lib/db/schema-contract';

const MIGRATION_ID = '2026-10-14-02-backfill-edit-operations-to-unifiedchangelog';
const PLOT_SCOPE = 10;
const CENSUS_SCOPE = 3;
// A RecordID this long overflows unifiedchangelog.RecordID (varchar(255)) once
// the `::edit-op-<id>` suffix is appended. Under STRICT_TRANS_TABLES (the
// default sql_mode on MySQL 8, confirmed by metadata-changelog-audit's
// ER_DATA_TOO_LONG test) that INSERT raises an error instead of truncating.
const OVERSIZED_PRIMARY_KEY_VALUE = 'x'.repeat(300);

interface ChangelogRow extends RowDataPacket {
  ChangeID: number;
  TableName: string;
  RecordID: string;
  Operation: 'INSERT' | 'UPDATE' | 'DELETE';
  OldRowState: Record<string, unknown> | string | null;
  NewRowState: Record<string, unknown> | string | null;
  ChangeTimestamp: string | Date;
  ChangedBy: string;
  PlotID: number | null;
  CensusID: number | null;
}

/** mysql2 hands JSON columns back already parsed; tolerate a string too. */
function rowState(value: Record<string, unknown> | string | null): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

describe('Recent Changes ledger history (#507)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let schema: string;
  const cm = ConnectionManager.getInstance();

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    schema = config.database;
    sharedState.connection = connection;
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    sharedState.activeTransactionID = null;
    await teardownTestDatabase(connection, config);
  });

  async function readChangelog(tableName: string): Promise<ChangelogRow[]> {
    const [rows] = await connection.query<ChangelogRow[]>('SELECT * FROM unifiedchangelog WHERE TableName = ? ORDER BY RecordID', [tableName]);
    return rows;
  }

  async function countAll(table: string): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM ${table}`);
    return Number(rows[0].cnt);
  }

  function buildInput(overrides: Partial<EditOperationWriteInput> = {}): EditOperationWriteInput {
    return {
      operationType: 'single-row-edit',
      dataType: 'measurementssummary',
      targetID: 9000,
      plotID: PLOT_SCOPE,
      censusID: CENSUS_SCOPE,
      planHash: 'a'.repeat(64),
      beforeState: [],
      afterState: [],
      createdBy: 'ledger-history@forestgeo.test',
      ...overrides
    };
  }

  // =========================================================================
  // Live dual-write (writeEditOperation), going forward.
  // =========================================================================
  describe('live dual-write (writeEditOperation)', () => {
    beforeEach(async () => {
      await connection.query('DROP TABLE IF EXISTS edit_operations');
      sharedState.activeTransactionID = null;
      await connection.query('DELETE FROM unifiedchangelog');
    });

    it('projects a single-row-edit with a real INSERT, a real UPDATE, and a real DELETE key, and skips a value-identical key despite reordered JSON keys', async () => {
      await ensureEditOperationsTable(cm, schema);

      const before: EditOperationStateRow[] = [
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 9101, row: { MeasuredDBH: 10, Comments: 'ok' } }, // no-op
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 9102, row: { MeasuredDBH: 20 } }, // updated
        { table: 'cmattributes', primaryKey: 'CMAID', primaryKeyValue: 600, row: { Code: 'DEAD' } } // deleted
      ];
      const after: EditOperationStateRow[] = [
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 9101, row: { Comments: 'ok', MeasuredDBH: 10 } }, // same values, different key order
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 9102, row: { MeasuredDBH: 25 } },
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 9103, row: { MeasuredDBH: 30 } } // inserted
      ];

      const txn = await cm.beginTransaction();
      const editOperationID = await writeEditOperation(cm, schema, buildInput({ beforeState: before, afterState: after }), txn);
      await cm.commitTransaction(txn);

      const coreRows = await readChangelog('coremeasurements');
      const cmaRows = await readChangelog('cmattributes');

      expect(
        coreRows.find(r => r.RecordID === `9101::edit-op-${editOperationID}`),
        'a value-identical key must produce no changelog row'
      ).toBeUndefined();

      const updated = coreRows.find(r => r.RecordID === `9102::edit-op-${editOperationID}`)!;
      expect(updated.Operation).toBe('UPDATE');
      expect(rowState(updated.OldRowState)).toEqual({ MeasuredDBH: 20 });
      expect(rowState(updated.NewRowState)).toEqual({ MeasuredDBH: 25 });
      expect(updated.PlotID).toBe(PLOT_SCOPE);
      expect(updated.CensusID).toBe(CENSUS_SCOPE);

      const inserted = coreRows.find(r => r.RecordID === `9103::edit-op-${editOperationID}`)!;
      expect(inserted.Operation).toBe('INSERT');
      expect(inserted.OldRowState).toBeNull();
      expect(rowState(inserted.NewRowState)).toEqual({ MeasuredDBH: 30 });

      expect(cmaRows).toHaveLength(1);
      expect(cmaRows[0].Operation).toBe('DELETE');
      expect(rowState(cmaRows[0].OldRowState)).toEqual({ Code: 'DEAD' });
      expect(cmaRows[0].NewRowState).toBeNull();

      expect(coreRows).toHaveLength(2);
    });

    it('projects a revert with the identical pairing logic as a single-row-edit', async () => {
      await ensureEditOperationsTable(cm, schema);

      const before: EditOperationStateRow[] = [{ table: 'species', primaryKey: 'SpeciesID', primaryKeyValue: 7777, row: { SpeciesCode: 'NEWC' } }];
      const after: EditOperationStateRow[] = [{ table: 'species', primaryKey: 'SpeciesID', primaryKeyValue: 7777, row: { SpeciesCode: 'OLDC' } }];

      const txn = await cm.beginTransaction();
      const editOperationID = await writeEditOperation(cm, schema, buildInput({ operationType: 'revert', beforeState: before, afterState: after }), txn);
      await cm.commitTransaction(txn);

      const rows = await readChangelog('species');
      expect(rows).toHaveLength(1);
      expect(rows[0].RecordID).toBe(`7777::edit-op-${editOperationID}`);
      expect(rows[0].Operation).toBe('UPDATE');
      expect(rowState(rows[0].OldRowState)).toEqual({ SpeciesCode: 'NEWC' });
      expect(rowState(rows[0].NewRowState)).toEqual({ SpeciesCode: 'OLDC' });
    });

    it('projects a bulk-revision-row as one summary UPDATE tagged summaryKind, with NULL scope when PlotID/CensusID are 0', async () => {
      await ensureEditOperationsTable(cm, schema);

      const summary: EditOperationStateRow[] = [
        {
          table: 'bulk-revision-apply',
          primaryKey: 'bulkPlanHash',
          primaryKeyValue: 'plan-hash-live-1',
          row: { updatedCount: 4, skippedCount: 1, insertedCount: 2, deletedDuplicateCount: 0 }
        }
      ];

      const txn = await cm.beginTransaction();
      const editOperationID = await writeEditOperation(
        cm,
        schema,
        buildInput({ operationType: 'bulk-revision-row', revertable: false, plotID: 0, censusID: 0, beforeState: summary, afterState: [] }),
        txn
      );
      await cm.commitTransaction(txn);

      const rows = await readChangelog('bulk-revision-apply');
      expect(rows).toHaveLength(1);
      expect(rows[0].RecordID).toBe(`plan-hash-live-1::edit-op-${editOperationID}`);
      expect(rows[0].Operation).toBe('UPDATE');
      expect(rows[0].OldRowState).toBeNull();
      expect(rowState(rows[0].NewRowState)).toEqual({
        updatedCount: 4,
        skippedCount: 1,
        insertedCount: 2,
        deletedDuplicateCount: 0,
        summaryKind: BULK_REVISION_SUMMARY_KIND
      });
      // PlotID/CensusID 0 mean "no scope" (normalizeScopeID), not plot/census 0.
      expect(rows[0].PlotID).toBeNull();
      expect(rows[0].CensusID).toBeNull();
    });

    it('projects a failedmeasurements-scoped edit (a failed/unresolved row, StemGUID NULL) with the same mapping as a resolved one', async () => {
      await ensureEditOperationsTable(cm, schema);

      const before: EditOperationStateRow[] = [
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 9201, row: { MeasuredDBH: null, RawCodes: 'LI' } }
      ];
      const after: EditOperationStateRow[] = [
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 9201, row: { MeasuredDBH: 11.1, RawCodes: 'LI' } }
      ];

      const txn = await cm.beginTransaction();
      const editOperationID = await writeEditOperation(cm, schema, buildInput({ dataType: 'failedmeasurements', beforeState: before, afterState: after }), txn);
      await cm.commitTransaction(txn);

      const rows = await readChangelog('coremeasurements');
      expect(rows).toHaveLength(1);
      expect(rows[0].RecordID).toBe(`9201::edit-op-${editOperationID}`);
      expect(rows[0].Operation).toBe('UPDATE');
      expect(rowState(rows[0].OldRowState)).toEqual({ MeasuredDBH: null, RawCodes: 'LI' });
      expect(rowState(rows[0].NewRowState)).toEqual({ MeasuredDBH: 11.1, RawCodes: 'LI' });
    });

    it('projects an UPDATE for a real DATE-typed column change and no event when two distinct Date instances hold the same instant', async () => {
      await ensureEditOperationsTable(cm, schema);

      // Key 9301 pins the no-op case (distinct Date instances, same instant);
      // key 9302 is the actual regression case (distinct instants).
      const sameInstant = '2026-03-15T00:00:00.000Z';
      const before: EditOperationStateRow[] = [
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 9301, row: { MeasurementDate: new Date(sameInstant) } },
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 9302, row: { MeasurementDate: new Date('2026-01-01T00:00:00.000Z') } }
      ];
      const after: EditOperationStateRow[] = [
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 9301, row: { MeasurementDate: new Date(sameInstant) } },
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 9302, row: { MeasurementDate: new Date('2026-06-01T00:00:00.000Z') } }
      ];

      const txn = await cm.beginTransaction();
      const editOperationID = await writeEditOperation(cm, schema, buildInput({ beforeState: before, afterState: after }), txn);
      await cm.commitTransaction(txn);

      const rows = await readChangelog('coremeasurements');
      expect(
        rows.find(r => r.RecordID === `9301::edit-op-${editOperationID}`),
        'two Date instances holding the same instant must produce no row'
      ).toBeUndefined();

      const changed = rows.find(r => r.RecordID === `9302::edit-op-${editOperationID}`)!;
      expect(changed.Operation).toBe('UPDATE');
      expect(rowState(changed.OldRowState)).toEqual({ MeasurementDate: '2026-01-01T00:00:00.000Z' });
      expect(rowState(changed.NewRowState)).toEqual({ MeasurementDate: '2026-06-01T00:00:00.000Z' });
      expect(rows).toHaveLength(1);
    });

    it('excludes a species_correction_metadata marker row from the changelog while still projecting the real trees mutation beside it', async () => {
      await ensureEditOperationsTable(cm, schema);

      const before: EditOperationStateRow[] = [
        { table: 'species_correction_metadata', primaryKey: 'TreeID', primaryKeyValue: 42, row: { version: 1, speciesID: 10 } },
        { table: 'trees', primaryKey: 'TreeID', primaryKeyValue: 42, row: { SpeciesID: 10 } }
      ];
      const after: EditOperationStateRow[] = [
        { table: 'species_correction_metadata', primaryKey: 'TreeID', primaryKeyValue: 42, row: { version: 1, speciesID: 20 } },
        { table: 'trees', primaryKey: 'TreeID', primaryKeyValue: 42, row: { SpeciesID: 20 } }
      ];

      const txn = await cm.beginTransaction();
      const editOperationID = await writeEditOperation(cm, schema, buildInput({ beforeState: before, afterState: after }), txn);
      await cm.commitTransaction(txn);

      const treesRows = await readChangelog('trees');
      const metadataRows = await readChangelog('species_correction_metadata');

      expect(metadataRows, 'species_correction_metadata is undo bookkeeping, never a real changelog row').toHaveLength(0);
      expect(treesRows).toHaveLength(1);
      expect(treesRows[0].RecordID).toBe(`42::edit-op-${editOperationID}`);
      expect(rowState(treesRows[0].NewRowState)).toEqual({ SpeciesID: 20 });
    });

    it('rolls back BOTH the edit_operations ledger row and the changelog row when the audit write fails mid-transaction', async () => {
      await ensureEditOperationsTable(cm, schema);
      const ledgerCountBefore = await countAll('edit_operations');
      const changelogCountBefore = await countAll('unifiedchangelog');

      const after: EditOperationStateRow[] = [
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: OVERSIZED_PRIMARY_KEY_VALUE, row: { MeasuredDBH: 1 } }
      ];

      const txn = await cm.beginTransaction();
      await expect(writeEditOperation(cm, schema, buildInput({ beforeState: [], afterState: after }), txn)).rejects.toThrow(ChangelogWriteError);
      await cm.rollbackTransaction(txn);

      // REGRESSION SENTINEL: the edit_operations INSERT ran successfully inside
      // the SAME transaction before the dual-write loop hit the oversized
      // RecordID. If that INSERT is ever moved outside the shared transaction,
      // this count assertion catches an orphaned, undescribed ledger row.
      expect(await countAll('edit_operations')).toBe(ledgerCountBefore);
      expect(await countAll('unifiedchangelog')).toBe(changelogCountBefore);
    });
  });

  // =========================================================================
  // Historical backfill migration, for ledger entries written before the
  // dual-write shipped. Driven through the real manifest + loader/executor —
  // loadMigrationSources reads the actual file off disk, applyPendingMigrations
  // runs it through the real schema_migrations ledger and migration lock.
  // =========================================================================
  describe(`historical migration backfill (${MIGRATION_ID})`, () => {
    let sources: MigrationSource[];
    let exec: SqlExecutor;

    // Independent of ensureEditOperationsTable/the live-dual-write describe
    // above: this block must set up its own edit_operations table so it does
    // not depend on sibling-describe execution order (e.g. running this file
    // with a --testNamePattern filter).
    const EDIT_OPERATIONS_TABLE_DDL = `
      CREATE TABLE IF NOT EXISTS edit_operations (
        EditOperationID INT AUTO_INCREMENT PRIMARY KEY,
        OperationType ENUM('single-row-edit', 'bulk-revision-row', 'revert') NOT NULL,
        Revertable BOOLEAN NOT NULL DEFAULT TRUE,
        DataType ENUM('measurementssummary', 'failedmeasurements') NOT NULL,
        TargetID BIGINT NULL,
        PlotID INT NOT NULL,
        CensusID INT NOT NULL,
        PlanHash CHAR(64) NOT NULL,
        BeforeState JSON NOT NULL,
        AfterState JSON NOT NULL,
        CreatedBy VARCHAR(255) NOT NULL,
        CreatedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        RevertedByEditOperationID INT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    beforeAll(() => {
      sources = loadMigrationSources(SCHEMA_MIGRATION_MANIFEST, path.join(process.cwd(), 'db', 'migrations'));
      expect(
        sources.some(s => s.id === MIGRATION_ID),
        'the manifest must list this migration'
      ).toBe(true);
      exec = async (sql: string, params?: unknown[]): Promise<SchemaQueryRow[]> => {
        const [rows] = await connection.query(sql, params ?? []);
        return Array.isArray(rows) ? (rows as SchemaQueryRow[]) : [];
      };
    });

    async function resetMigrationLedgerEntry(): Promise<void> {
      // applyPendingMigrations creates schema_migrations itself on first run; a
      // test resetting the ledger before that has ever happened (e.g. the very
      // first test in this describe) must create it too, via the SAME exported
      // helper applyPendingMigrations uses — not a copy of its DDL.
      await ensureLedgerTable(exec);
      await connection.query(`DELETE FROM schema_migrations WHERE MigrationID = ?`, [MIGRATION_ID]);
    }

    async function readEditOperationsRow(editOperationID: number): Promise<RowDataPacket> {
      const [rows] = await connection.query<RowDataPacket[]>('SELECT * FROM edit_operations WHERE EditOperationID = ?', [editOperationID]);
      expect(rows, `edit_operations row ${editOperationID} must still exist`).toHaveLength(1);
      return rows[0];
    }

    async function runMigration(): Promise<ApplyResult> {
      return applyPendingMigrations(exec, schema, sources);
    }

    async function insertHistoricalLedgerRow(input: {
      operationType: 'single-row-edit' | 'revert' | 'bulk-revision-row';
      plotID?: number;
      censusID?: number;
      beforeState: EditOperationStateRow[];
      afterState: EditOperationStateRow[];
      createdBy?: string;
    }): Promise<number> {
      const [result] = await connection.query<ResultSetHeader>(
        `INSERT INTO edit_operations (OperationType, Revertable, DataType, TargetID, PlotID, CensusID, PlanHash, BeforeState, AfterState, CreatedBy)
         VALUES (?, TRUE, 'measurementssummary', NULL, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)`,
        [
          input.operationType,
          input.plotID ?? PLOT_SCOPE,
          input.censusID ?? CENSUS_SCOPE,
          'f'.repeat(64),
          JSON.stringify(input.beforeState),
          JSON.stringify(input.afterState),
          input.createdBy ?? 'legacy-historical@forestgeo.test'
        ]
      );
      return result.insertId;
    }

    it('on a schema with NO edit_operations table at all, creates it empty and backfills nothing — never fabricates history that was never recorded', async () => {
      await connection.query('DROP TABLE IF EXISTS edit_operations');
      await connection.query('DELETE FROM unifiedchangelog');
      await resetMigrationLedgerEntry();

      const result = await runMigration();
      expect(result.failed, JSON.stringify(result.failed)).toBeNull();
      expect(result.appliedNow).toContain(MIGRATION_ID);

      const [tables] = await connection.query<RowDataPacket[]>(`SHOW TABLES LIKE 'edit_operations'`);
      expect(tables).toHaveLength(1);
      expect(await countAll('unifiedchangelog')).toBe(0);
    });

    beforeEach(async () => {
      // CREATE TABLE IF NOT EXISTS first: this describe must not depend on the
      // sibling "live dual-write" describe having run earlier in the same
      // file (e.g. under --testNamePattern), and the preceding test in THIS
      // describe intentionally DROPs the table to prove the migration
      // recreates it from nothing.
      await connection.query(EDIT_OPERATIONS_TABLE_DDL);
      await connection.query('DELETE FROM edit_operations');
      await connection.query('DELETE FROM unifiedchangelog');
      await resetMigrationLedgerEntry();
      sharedState.activeTransactionID = null;
    });

    it('backfills a historical single-row-edit with the SAME three-way split as the live projection, including the key-order-insensitive no-op skip', async () => {
      const before: EditOperationStateRow[] = [
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 7001, row: { MeasuredDBH: 10, Comments: 'ok' } }, // no-op
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 7002, row: { MeasuredDBH: 20 } }, // updated
        { table: 'cmattributes', primaryKey: 'CMAID', primaryKeyValue: 500, row: { Code: 'DEAD' } } // deleted
      ];
      const after: EditOperationStateRow[] = [
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 7001, row: { Comments: 'ok', MeasuredDBH: 10 } }, // same values, reordered keys
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 7002, row: { MeasuredDBH: 25 } },
        { table: 'cmattributes', primaryKey: 'CMAID', primaryKeyValue: 501, row: { Code: 'ALIVE' } }, // reinserted under a new CMAID
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 7003, row: { MeasuredDBH: 30 } } // inserted
      ];

      const editOperationID = await insertHistoricalLedgerRow({
        operationType: 'single-row-edit',
        beforeState: before,
        afterState: after,
        createdBy: 'legacy@forestgeo.test'
      });

      const result = await runMigration();
      expect(result.failed, JSON.stringify(result.failed)).toBeNull();

      const coreRows = await readChangelog('coremeasurements');
      const cmaRows = await readChangelog('cmattributes');

      expect(
        coreRows.find(r => r.RecordID === `7001::edit-op-${editOperationID}`),
        'reordered-but-equal key must produce no row'
      ).toBeUndefined();

      const updated = coreRows.find(r => r.RecordID === `7002::edit-op-${editOperationID}`)!;
      expect(updated.Operation).toBe('UPDATE');
      expect(rowState(updated.OldRowState)).toEqual({ MeasuredDBH: 20 });
      expect(rowState(updated.NewRowState)).toEqual({ MeasuredDBH: 25 });
      expect(updated.ChangedBy).toBe('legacy@forestgeo.test');
      expect(updated.PlotID).toBe(PLOT_SCOPE);
      expect(updated.CensusID).toBe(CENSUS_SCOPE);

      const inserted = coreRows.find(r => r.RecordID === `7003::edit-op-${editOperationID}`)!;
      expect(inserted.Operation).toBe('INSERT');
      expect(inserted.OldRowState).toBeNull();
      expect(rowState(inserted.NewRowState)).toEqual({ MeasuredDBH: 30 });

      const deleted = cmaRows.find(r => r.RecordID === `500::edit-op-${editOperationID}`)!;
      expect(deleted.Operation).toBe('DELETE');
      expect(rowState(deleted.OldRowState)).toEqual({ Code: 'DEAD' });
      expect(deleted.NewRowState).toBeNull();

      const reinserted = cmaRows.find(r => r.RecordID === `501::edit-op-${editOperationID}`)!;
      expect(reinserted.Operation).toBe('INSERT');
      expect(rowState(reinserted.NewRowState)).toEqual({ Code: 'ALIVE' });

      expect(coreRows).toHaveLength(2);
      expect(cmaRows).toHaveLength(2);
    });

    it('backfills a historical revert entry with the identical pairing logic', async () => {
      const before: EditOperationStateRow[] = [{ table: 'species', primaryKey: 'SpeciesID', primaryKeyValue: 8888, row: { SpeciesCode: 'REVB' } }];
      const after: EditOperationStateRow[] = [{ table: 'species', primaryKey: 'SpeciesID', primaryKeyValue: 8888, row: { SpeciesCode: 'REVA' } }];
      const editOperationID = await insertHistoricalLedgerRow({ operationType: 'revert', beforeState: before, afterState: after });

      const result = await runMigration();
      expect(result.failed).toBeNull();

      const rows = await readChangelog('species');
      expect(rows).toHaveLength(1);
      expect(rows[0].RecordID).toBe(`8888::edit-op-${editOperationID}`);
      expect(rows[0].Operation).toBe('UPDATE');
      expect(rowState(rows[0].OldRowState)).toEqual({ SpeciesCode: 'REVB' });
      expect(rowState(rows[0].NewRowState)).toEqual({ SpeciesCode: 'REVA' });
    });

    it('backfills a historical bulk-revision-row as one summary UPDATE tagged summaryKind, never fabricating fields beyond BeforeState[0]', async () => {
      const summary: EditOperationStateRow[] = [
        {
          table: 'bulk-revision-apply',
          primaryKey: 'bulkPlanHash',
          primaryKeyValue: 'legacy-hash-1',
          row: { updatedCount: 9, skippedCount: 2, insertedCount: 1, deletedDuplicateCount: 0 }
        }
      ];
      const editOperationID = await insertHistoricalLedgerRow({ operationType: 'bulk-revision-row', beforeState: summary, afterState: [] });

      const result = await runMigration();
      expect(result.failed).toBeNull();

      const rows = await readChangelog('bulk-revision-apply');
      expect(rows).toHaveLength(1);
      expect(rows[0].RecordID).toBe(`legacy-hash-1::edit-op-${editOperationID}`);
      expect(rows[0].Operation).toBe('UPDATE');
      expect(rows[0].OldRowState).toBeNull();
      expect(rowState(rows[0].NewRowState)).toEqual({
        updatedCount: 9,
        skippedCount: 2,
        insertedCount: 1,
        deletedDuplicateCount: 0,
        summaryKind: BULK_REVISION_SUMMARY_KIND
      });
    });

    it("backfills a historical DATE-typed column change as an UPDATE, with parity to the live dual-write's Date handling", async () => {
      // Stored as ISO strings (JSON.stringify already ran), unlike the live
      // path's raw Date objects — proves the two implementations agree.
      const before: EditOperationStateRow[] = [
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 7701, row: { MeasurementDate: '2026-01-01T00:00:00.000Z' } }
      ];
      const after: EditOperationStateRow[] = [
        { table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 7701, row: { MeasurementDate: '2026-06-01T00:00:00.000Z' } }
      ];
      const editOperationID = await insertHistoricalLedgerRow({ operationType: 'single-row-edit', beforeState: before, afterState: after });

      const result = await runMigration();
      expect(result.failed).toBeNull();

      const rows = await readChangelog('coremeasurements');
      expect(rows).toHaveLength(1);
      expect(rows[0].RecordID).toBe(`7701::edit-op-${editOperationID}`);
      expect(rows[0].Operation).toBe('UPDATE');
      expect(rowState(rows[0].OldRowState)).toEqual({ MeasurementDate: '2026-01-01T00:00:00.000Z' });
      expect(rowState(rows[0].NewRowState)).toEqual({ MeasurementDate: '2026-06-01T00:00:00.000Z' });
    });

    it('excludes a historical species_correction_metadata marker row from the backfill while still backfilling the real trees mutation beside it', async () => {
      const before: EditOperationStateRow[] = [
        { table: 'species_correction_metadata', primaryKey: 'TreeID', primaryKeyValue: 88, row: { version: 1, speciesID: 10 } },
        { table: 'trees', primaryKey: 'TreeID', primaryKeyValue: 88, row: { SpeciesID: 10 } }
      ];
      const after: EditOperationStateRow[] = [
        { table: 'species_correction_metadata', primaryKey: 'TreeID', primaryKeyValue: 88, row: { version: 1, speciesID: 20 } },
        { table: 'trees', primaryKey: 'TreeID', primaryKeyValue: 88, row: { SpeciesID: 20 } }
      ];
      const editOperationID = await insertHistoricalLedgerRow({ operationType: 'single-row-edit', beforeState: before, afterState: after });

      const result = await runMigration();
      expect(result.failed).toBeNull();

      const treesRows = await readChangelog('trees');
      const metadataRows = await readChangelog('species_correction_metadata');

      expect(metadataRows, 'species_correction_metadata is undo bookkeeping, never a real changelog row').toHaveLength(0);
      expect(treesRows).toHaveLength(1);
      expect(treesRows[0].RecordID).toBe(`88::edit-op-${editOperationID}`);
      expect(rowState(treesRows[0].NewRowState)).toEqual({ SpeciesID: 20 });
    });

    it("records NULL PlotID/CensusID for a historical site-level entry, matching the live dual-write's scope semantics", async () => {
      const after: EditOperationStateRow[] = [
        { table: 'attributes', primaryKey: 'Code', primaryKeyValue: 'LEGACY', row: { Description: 'legacy site-level edit' } }
      ];
      await insertHistoricalLedgerRow({ operationType: 'single-row-edit', plotID: 0, censusID: 0, beforeState: [], afterState: after });

      const result = await runMigration();
      expect(result.failed).toBeNull();

      const rows = await readChangelog('attributes');
      expect(rows).toHaveLength(1);
      expect(rows[0].PlotID).toBeNull();
      expect(rows[0].CensusID).toBeNull();
    });

    it('never projects a duplicate row for an entry the live dual-write already recorded', async () => {
      // Written through the REAL dual-write, not a hand-built changelog row —
      // this is "already projected" exactly the way it happens in production.
      const txn = await cm.beginTransaction();
      const editOperationID = await writeEditOperation(
        cm,
        schema,
        buildInput({
          beforeState: [{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 9500, row: { MeasuredDBH: 1 } }],
          afterState: [{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 9500, row: { MeasuredDBH: 2 } }]
        }),
        txn
      );
      await cm.commitTransaction(txn);

      const beforeMigration = await readChangelog('coremeasurements');
      expect(beforeMigration).toHaveLength(1);

      const result = await runMigration();
      expect(result.failed).toBeNull();

      const afterMigration = await readChangelog('coremeasurements');
      expect(afterMigration, 'the NOT EXISTS guard must skip a key already dual-written').toHaveLength(1);
      expect(afterMigration[0].RecordID).toBe(`9500::edit-op-${editOperationID}`);
      expect(afterMigration[0].ChangeID).toBe(beforeMigration[0].ChangeID);
    });

    it('is idempotent: re-running after it has already applied inserts nothing further', async () => {
      const before: EditOperationStateRow[] = [{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 7500, row: { MeasuredDBH: 1 } }];
      const after: EditOperationStateRow[] = [{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 7500, row: { MeasuredDBH: 2 } }];
      await insertHistoricalLedgerRow({ operationType: 'single-row-edit', beforeState: before, afterState: after });

      const first = await runMigration();
      expect(first.failed).toBeNull();
      expect(first.appliedNow).toContain(MIGRATION_ID);
      expect(await readChangelog('coremeasurements')).toHaveLength(1);

      const second = await runMigration();
      expect(second.failed).toBeNull();
      expect(second.pendingBefore, 'already-applied migration must not be reselected as pending').not.toContain(MIGRATION_ID);
      expect(second.appliedNow).not.toContain(MIGRATION_ID);
      expect(await readChangelog('coremeasurements')).toHaveLength(1);
    });

    it('reruns the migration FILE itself (not merely skipped by ledger suppression) and still produces no extra or altered rows', async () => {
      const before: EditOperationStateRow[] = [{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 7600, row: { MeasuredDBH: 1 } }];
      const after: EditOperationStateRow[] = [{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 7600, row: { MeasuredDBH: 2 } }];
      const editOperationID = await insertHistoricalLedgerRow({
        operationType: 'single-row-edit',
        beforeState: before,
        afterState: after,
        createdBy: 'legacy-rerun@forestgeo.test'
      });

      const first = await runMigration();
      expect(first.failed).toBeNull();
      expect(first.appliedNow).toContain(MIGRATION_ID);

      const rowsAfterFirst = await readChangelog('coremeasurements');
      expect(rowsAfterFirst).toHaveLength(1);
      const original = rowsAfterFirst[0];
      expect(original.RecordID).toBe(`7600::edit-op-${editOperationID}`);
      const ledgerRowBefore = await readEditOperationsRow(editOperationID);

      // Delete ONLY this migration's own ledger record (not edit_operations or
      // unifiedchangelog): selectPendingMigrations reselects it as pending, so
      // applyPendingMigrations executes the SQL FILE a second time for real.
      // What must stop a duplicate here is the migration's own NOT EXISTS
      // guard, not ledger suppression — this is the case the test above
      // (which the ledger skips entirely) cannot exercise.
      await resetMigrationLedgerEntry();

      const second = await runMigration();
      expect(second.failed).toBeNull();
      expect(second.pendingBefore, 'deleting only the ledger row must reselect this migration as pending').toContain(MIGRATION_ID);
      expect(second.appliedNow, 'the SQL file must actually execute a second time').toContain(MIGRATION_ID);

      const rowsAfterSecond = await readChangelog('coremeasurements');
      expect(rowsAfterSecond, 'the NOT EXISTS guard must prevent a duplicate even on a genuine second execution').toHaveLength(1);
      const rerun = rowsAfterSecond[0];

      expect(rerun.ChangeID, 'the existing row must be left alone, not replaced').toBe(original.ChangeID);
      expect(rerun.ChangedBy).toBe(original.ChangedBy);
      expect(rerun.PlotID).toBe(original.PlotID);
      expect(rerun.CensusID).toBe(original.CensusID);
      expect(new Date(rerun.ChangeTimestamp).getTime()).toBe(new Date(original.ChangeTimestamp).getTime());
      expect(rowState(rerun.OldRowState)).toEqual(rowState(original.OldRowState));
      expect(rowState(rerun.NewRowState)).toEqual(rowState(original.NewRowState));

      // The source edit_operations ledger row is read-only input to this
      // migration; a rerun must not mutate it either.
      expect(await readEditOperationsRow(editOperationID)).toEqual(ledgerRowBefore);
    });
  });
});
