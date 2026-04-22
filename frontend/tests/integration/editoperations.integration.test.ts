import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

// ---------------------------------------------------------------------------
// Shared state bridge — vi.mock factories are hoisted, so the mock adapter
// cannot close over the `connection` local below. A hoisted container lets the
// adapter read the live connection once beforeAll has initialized it.
// ---------------------------------------------------------------------------
const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null
}));

const TEST_TRANSACTION_ID = 'test-transaction-id';
const UNKNOWN_EDIT_OPERATION_ID = 9_999_999;

const MIGRATION_PATH = path.join(
  process.cwd(),
  'db-migrations',
  'unified-measurements-migrations',
  '54_create_edit_operations.sql'
);

// ---------------------------------------------------------------------------
// Mock ConnectionManager — mirrors the pattern used by reingest-routes
// integration tests. The adapter drives the shared test connection so the
// real editoperations module exercises its actual transactionID plumbing:
// transactions are started on the shared connection, txID is threaded through
// writeEditOperation and markEditOperationReverted, and commit/rollback run
// against the same live connection.
// ---------------------------------------------------------------------------
vi.mock('@/config/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(
          `ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`
        );
      }
      const [rows] = await sharedState.connection.query(query, (params as unknown[]) ?? []);
      return rows;
    },
    beginTransaction: async () => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      if (sharedState.activeTransactionID) {
        throw new Error('ConnectionManager mock: transaction already active');
      }
      await sharedState.connection.beginTransaction();
      sharedState.activeTransactionID = TEST_TRANSACTION_ID;
      return TEST_TRANSACTION_ID;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error(
          `ConnectionManager mock: commit transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`
        );
      }
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error(
          `ConnectionManager mock: rollback transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`
        );
      }
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined,
    acquireApplicationLock: async () => true,
    withTransaction: async (fn: (transactionID: string) => Promise<unknown>) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      await sharedState.connection.beginTransaction();
      sharedState.activeTransactionID = TEST_TRANSACTION_ID;
      try {
        const result = await fn(TEST_TRANSACTION_ID);
        await sharedState.connection.commit();
        sharedState.activeTransactionID = null;
        return result;
      } catch (error) {
        await sharedState.connection.rollback();
        sharedState.activeTransactionID = null;
        throw error;
      }
    }
  };

  return {
    default: {
      getInstance: () => manager
    }
  };
});

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

// Imports below must come after vi.mock calls so the mocked ConnectionManager
// is the one wired into the module under test.
import ConnectionManager from '@/config/connectionmanager';
import {
  ensureEditOperationsTable,
  markEditOperationReverted,
  readEditOperation,
  writeEditOperation,
  type EditOperationStateRow,
  type EditOperationWriteInput
} from '@/config/editoperations';

const SAMPLE_BEFORE_STATE: EditOperationStateRow[] = [
  {
    table: 'coremeasurements',
    primaryKey: 'CoreMeasurementID',
    primaryKeyValue: 4201,
    row: {
      CoreMeasurementID: 4201,
      MeasuredDBH: 12.3,
      MeasuredHOM: 1.3,
      RawCodes: 'LI'
    }
  },
  {
    table: 'cmattributes',
    primaryKey: 'CMAID',
    primaryKeyValue: 7701,
    row: null
  }
];

const SAMPLE_AFTER_STATE: EditOperationStateRow[] = [
  {
    table: 'coremeasurements',
    primaryKey: 'CoreMeasurementID',
    primaryKeyValue: 4201,
    row: {
      CoreMeasurementID: 4201,
      MeasuredDBH: 12.5,
      MeasuredHOM: 1.3,
      RawCodes: 'LI;BR'
    }
  },
  {
    table: 'cmattributes',
    primaryKey: 'CMAID',
    primaryKeyValue: 7701,
    row: {
      CMAID: 7701,
      CoreMeasurementID: 4201,
      Code: 'BR'
    }
  }
];

function buildInput(overrides: Partial<EditOperationWriteInput> = {}): EditOperationWriteInput {
  return {
    operationType: 'single-row-edit',
    dataType: 'measurementssummary',
    targetID: 4201,
    plotID: 10,
    censusID: 3,
    planHash: 'a'.repeat(64),
    beforeState: SAMPLE_BEFORE_STATE,
    afterState: SAMPLE_AFTER_STATE,
    createdBy: 'mason@example.com',
    ...overrides
  };
}

describe('editoperations (integration)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  const cm = ConnectionManager.getInstance();

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    sharedState.connection = connection;
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    sharedState.activeTransactionID = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    // Each test starts from a clean edit_operations table so we can assert
    // creation/idempotency from scratch and so INSERT ids are predictable.
    await connection.query('DROP TABLE IF EXISTS edit_operations');
    sharedState.activeTransactionID = null;
    void testData;
  });

  it('ensureEditOperationsTable is idempotent and produces the same DDL as the migration file', async () => {
    await ensureEditOperationsTable(cm, config.database);
    await ensureEditOperationsTable(cm, config.database);

    const [tables] = await connection.query<RowDataPacket[]>(`SHOW TABLES LIKE 'edit_operations'`);
    expect(tables).toHaveLength(1);

    const [columns] = await connection.query<RowDataPacket[]>(`SHOW COLUMNS FROM edit_operations`);
    const columnNames = columns.map(c => c.Field);
    expect(columnNames).toEqual(
      expect.arrayContaining([
        'EditOperationID',
        'OperationType',
        'Revertable',
        'DataType',
        'TargetID',
        'PlotID',
        'CensusID',
        'PlanHash',
        'BeforeState',
        'AfterState',
        'CreatedBy',
        'CreatedAt',
        'RevertedByEditOperationID'
      ])
    );

    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    const migrationSQL = fs.readFileSync(MIGRATION_PATH, 'utf-8');
    expect(migrationSQL).toContain('CREATE TABLE IF NOT EXISTS edit_operations');
    expect(migrationSQL).toContain("'bulk-revision-row'");
    expect(migrationSQL).toContain('Revertable BOOLEAN NOT NULL DEFAULT TRUE');
    expect(migrationSQL).toContain('fk_edit_operations_revert');
  });

  it('writeEditOperation and readEditOperation round-trip non-trivial BeforeState/AfterState through a real transaction', async () => {
    await ensureEditOperationsTable(cm, config.database);

    const input = buildInput();

    const transactionID = await cm.beginTransaction();
    const editOperationID = await writeEditOperation(cm, config.database, input, transactionID);
    await cm.commitTransaction(transactionID);

    expect(editOperationID).toBeGreaterThan(0);

    const roundTripped = await readEditOperation(cm, config.database, editOperationID);
    expect(roundTripped).not.toBeNull();
    expect(roundTripped!.editOperationID).toBe(editOperationID);
    expect(roundTripped!.operationType).toBe(input.operationType);
    expect(roundTripped!.revertable).toBe(true);
    expect(roundTripped!.dataType).toBe(input.dataType);
    expect(roundTripped!.targetID).toBe(input.targetID);
    expect(roundTripped!.plotID).toBe(input.plotID);
    expect(roundTripped!.censusID).toBe(input.censusID);
    expect(roundTripped!.planHash).toBe(input.planHash);
    expect(roundTripped!.createdBy).toBe(input.createdBy);
    expect(roundTripped!.revertedByEditOperationID).toBeNull();
    expect(roundTripped!.createdAt).toBeTruthy();

    expect(roundTripped!.beforeState).toEqual(SAMPLE_BEFORE_STATE);
    expect(roundTripped!.afterState).toEqual(SAMPLE_AFTER_STATE);
    expect(roundTripped!.beforeState[0].row).toEqual(SAMPLE_BEFORE_STATE[0].row);
    expect(roundTripped!.afterState[1].row).toEqual(SAMPLE_AFTER_STATE[1].row);
  });

  it('round-trips non-revertable bulk revision row ledger entries', async () => {
    await ensureEditOperationsTable(cm, config.database);

    const transactionID = await cm.beginTransaction();
    const editOperationID = await writeEditOperation(
      cm,
      config.database,
      buildInput({ operationType: 'bulk-revision-row', revertable: false }),
      transactionID
    );
    await cm.commitTransaction(transactionID);

    const roundTripped = await readEditOperation(cm, config.database, editOperationID);
    expect(roundTripped).not.toBeNull();
    expect(roundTripped!.operationType).toBe('bulk-revision-row');
    expect(roundTripped!.revertable).toBe(false);
  });

  it('markEditOperationReverted links the original record to the reverting record', async () => {
    await ensureEditOperationsTable(cm, config.database);

    const firstTxn = await cm.beginTransaction();
    const originalID = await writeEditOperation(cm, config.database, buildInput(), firstTxn);
    await cm.commitTransaction(firstTxn);

    const secondTxn = await cm.beginTransaction();
    const revertID = await writeEditOperation(
      cm,
      config.database,
      buildInput({
        operationType: 'revert',
        planHash: 'b'.repeat(64),
        beforeState: SAMPLE_AFTER_STATE,
        afterState: SAMPLE_BEFORE_STATE
      }),
      secondTxn
    );
    await markEditOperationReverted(cm, config.database, originalID, revertID, secondTxn);
    await cm.commitTransaction(secondTxn);

    expect(revertID).not.toBe(originalID);

    const originalAfterMark = await readEditOperation(cm, config.database, originalID);
    expect(originalAfterMark).not.toBeNull();
    expect(originalAfterMark!.revertedByEditOperationID).toBe(revertID);

    const revertAfterMark = await readEditOperation(cm, config.database, revertID);
    expect(revertAfterMark).not.toBeNull();
    expect(revertAfterMark!.revertedByEditOperationID).toBeNull();
  });

  it('readEditOperation returns null for an unknown EditOperationID', async () => {
    await ensureEditOperationsTable(cm, config.database);

    const result = await readEditOperation(cm, config.database, UNKNOWN_EDIT_OPERATION_ID);
    expect(result).toBeNull();
  });
});
