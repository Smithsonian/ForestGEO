import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

import {
  ensureEditOperationsTable,
  markEditOperationReverted,
  readEditOperation,
  writeEditOperation,
  type EditOperationStateRow,
  type EditOperationWriteInput
} from './editoperations';

vi.mock('@/ailogger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

const TEST_SCHEMA = 'forestgeo_editoperations_test';
const TEST_DB_CONFIG = {
  host: process.env.TEST_DB_HOST || 'localhost',
  user: process.env.TEST_DB_USER || 'root',
  password: process.env.TEST_DB_PASSWORD || 'testpassword',
  port: parseInt(process.env.TEST_DB_PORT || '3306', 10)
};

const MIGRATION_PATH = path.join(
  process.cwd(),
  'db-migrations',
  'unified-measurements-migrations',
  '54_create_edit_operations.sql'
);

interface TestConnectionManager {
  executeQuery: (sql: string, params?: unknown[], transactionID?: string) => Promise<unknown>;
  beginTransaction: () => Promise<string>;
  commitTransaction: (transactionID: string) => Promise<void>;
  rollbackTransaction: (transactionID: string) => Promise<void>;
}

function buildConnectionManagerAdapter(connection: mysql.Connection): TestConnectionManager {
  return {
    executeQuery: async (sql: string, params?: unknown[]) => {
      const [rows] = await connection.query(sql, params ?? []);
      return rows;
    },
    beginTransaction: async () => {
      await connection.beginTransaction();
      return 'test-transaction';
    },
    commitTransaction: async () => {
      await connection.commit();
    },
    rollbackTransaction: async () => {
      await connection.rollback();
    }
  };
}

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
  let rootConnection: mysql.Connection;
  let schemaConnection: mysql.Connection;
  let cm: TestConnectionManager;
  const transactionID = 'test-transaction';

  beforeAll(async () => {
    rootConnection = await mysql.createConnection({
      host: TEST_DB_CONFIG.host,
      user: TEST_DB_CONFIG.user,
      password: TEST_DB_CONFIG.password,
      port: TEST_DB_CONFIG.port,
      multipleStatements: true
    });

    await rootConnection.query(`DROP DATABASE IF EXISTS \`${TEST_SCHEMA}\``);
    await rootConnection.query(`CREATE DATABASE \`${TEST_SCHEMA}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);

    schemaConnection = await mysql.createConnection({
      host: TEST_DB_CONFIG.host,
      user: TEST_DB_CONFIG.user,
      password: TEST_DB_CONFIG.password,
      port: TEST_DB_CONFIG.port,
      database: TEST_SCHEMA,
      multipleStatements: true
    });

    cm = buildConnectionManagerAdapter(schemaConnection);
  }, 30000);

  afterAll(async () => {
    if (schemaConnection) {
      try {
        await schemaConnection.end();
      } catch {
        // ignore
      }
    }
    if (rootConnection) {
      try {
        await rootConnection.query(`DROP DATABASE IF EXISTS \`${TEST_SCHEMA}\``);
      } catch {
        // ignore
      }
      try {
        await rootConnection.end();
      } catch {
        // ignore
      }
    }
  });

  beforeEach(async () => {
    await schemaConnection.query('DROP TABLE IF EXISTS edit_operations');
  });

  it('ensureEditOperationsTable is idempotent and produces the same DDL as the migration file', async () => {
    await ensureEditOperationsTable(cm as any, TEST_SCHEMA);
    await ensureEditOperationsTable(cm as any, TEST_SCHEMA);

    const [tables] = await schemaConnection.query<mysql.RowDataPacket[]>(`SHOW TABLES LIKE 'edit_operations'`);
    expect(tables).toHaveLength(1);

    const [columns] = await schemaConnection.query<mysql.RowDataPacket[]>(`SHOW COLUMNS FROM edit_operations`);
    const columnNames = columns.map(c => c.Field);
    expect(columnNames).toEqual(
      expect.arrayContaining([
        'EditOperationID',
        'OperationType',
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
    expect(migrationSQL).toContain('fk_edit_operations_revert');
  });

  it('writeEditOperation and readEditOperation round-trip non-trivial BeforeState/AfterState', async () => {
    await ensureEditOperationsTable(cm as any, TEST_SCHEMA);

    const input = buildInput();
    const editOperationID = await writeEditOperation(cm as any, TEST_SCHEMA, input, transactionID);

    expect(editOperationID).toBeGreaterThan(0);

    const roundTripped = await readEditOperation(cm as any, TEST_SCHEMA, editOperationID);
    expect(roundTripped).not.toBeNull();
    expect(roundTripped!.editOperationID).toBe(editOperationID);
    expect(roundTripped!.operationType).toBe(input.operationType);
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

  it('markEditOperationReverted links the original record to the reverting record', async () => {
    await ensureEditOperationsTable(cm as any, TEST_SCHEMA);

    const originalID = await writeEditOperation(cm as any, TEST_SCHEMA, buildInput(), transactionID);
    const revertID = await writeEditOperation(
      cm as any,
      TEST_SCHEMA,
      buildInput({
        operationType: 'revert',
        planHash: 'b'.repeat(64),
        beforeState: SAMPLE_AFTER_STATE,
        afterState: SAMPLE_BEFORE_STATE
      }),
      transactionID
    );

    expect(revertID).not.toBe(originalID);

    await markEditOperationReverted(cm as any, TEST_SCHEMA, originalID, revertID, transactionID);

    const originalAfterMark = await readEditOperation(cm as any, TEST_SCHEMA, originalID);
    expect(originalAfterMark).not.toBeNull();
    expect(originalAfterMark!.revertedByEditOperationID).toBe(revertID);

    const revertAfterMark = await readEditOperation(cm as any, TEST_SCHEMA, revertID);
    expect(revertAfterMark).not.toBeNull();
    expect(revertAfterMark!.revertedByEditOperationID).toBeNull();
  });

  it('readEditOperation returns null for an unknown EditOperationID', async () => {
    await ensureEditOperationsTable(cm as any, TEST_SCHEMA);

    const result = await readEditOperation(cm as any, TEST_SCHEMA, 9_999_999);
    expect(result).toBeNull();
  });
});
