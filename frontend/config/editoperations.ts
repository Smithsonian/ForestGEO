import ConnectionManager from '@/config/connectionmanager';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import ailogger from '@/ailogger';

export type EditOperationType = 'single-row-edit' | 'revert';
export type EditOperationDataType = 'measurementssummary' | 'failedmeasurements';

export interface EditOperationStateRow {
  table: string;
  primaryKey: string;
  primaryKeyValue: string | number;
  row: Record<string, unknown> | null;
}

export interface EditOperationRecord {
  editOperationID: number;
  operationType: EditOperationType;
  dataType: EditOperationDataType;
  targetID: number;
  plotID: number;
  censusID: number;
  planHash: string;
  beforeState: EditOperationStateRow[];
  afterState: EditOperationStateRow[];
  createdBy: string;
  createdAt: string;
  revertedByEditOperationID: number | null;
}

export interface EditOperationWriteInput {
  operationType: EditOperationType;
  dataType: EditOperationDataType;
  targetID: number;
  plotID: number;
  censusID: number;
  planHash: string;
  beforeState: EditOperationStateRow[];
  afterState: EditOperationStateRow[];
  createdBy: string;
}

// Keep in sync with the migration file: frontend/db-migrations/unified-measurements-migrations/54_create_edit_operations.sql.
const CREATE_EDIT_OPERATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ??.edit_operations (
    EditOperationID INT AUTO_INCREMENT PRIMARY KEY,
    OperationType ENUM('single-row-edit', 'revert') NOT NULL,
    DataType ENUM('measurementssummary', 'failedmeasurements') NOT NULL,
    TargetID BIGINT NOT NULL,
    PlotID INT NOT NULL,
    CensusID INT NOT NULL,
    PlanHash CHAR(64) NOT NULL,
    BeforeState JSON NOT NULL,
    AfterState JSON NOT NULL,
    CreatedBy VARCHAR(255) NOT NULL,
    CreatedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    RevertedByEditOperationID INT NULL,
    INDEX idx_edit_operations_target (DataType, TargetID, CreatedAt DESC),
    INDEX idx_edit_operations_scope (PlotID, CensusID, CreatedAt DESC),
    INDEX idx_edit_operations_reverted (RevertedByEditOperationID),
    CONSTRAINT fk_edit_operations_revert
      FOREIGN KEY (RevertedByEditOperationID)
      REFERENCES ??.edit_operations(EditOperationID)
      ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

export async function ensureEditOperationsTable(
  connectionManager: ConnectionManager,
  schema: string,
  transactionID?: string
): Promise<void> {
  const sql = safeFormatQuery(schema, CREATE_EDIT_OPERATIONS_TABLE_SQL);
  try {
    await connectionManager.executeQuery(sql, undefined, transactionID);
  } catch (error: unknown) {
    ailogger.error(
      `[editoperations] Failed to ensure edit_operations table in ${schema}:`,
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
}

export async function writeEditOperation(
  connectionManager: ConnectionManager,
  schema: string,
  record: EditOperationWriteInput,
  transactionID: string
): Promise<number> {
  const sql = safeFormatQuery(
    schema,
    `INSERT INTO ??.edit_operations (
       OperationType, DataType, TargetID, PlotID, CensusID, PlanHash,
       BeforeState, AfterState, CreatedBy
     ) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)`
  );

  const params = [
    record.operationType,
    record.dataType,
    record.targetID,
    record.plotID,
    record.censusID,
    record.planHash,
    JSON.stringify(record.beforeState ?? []),
    JSON.stringify(record.afterState ?? []),
    record.createdBy
  ];

  const result = await connectionManager.executeQuery(sql, params, transactionID);
  const insertId = (result as { insertId?: number })?.insertId;
  if (typeof insertId !== 'number' || insertId <= 0) {
    throw new Error('writeEditOperation: INSERT did not return a valid EditOperationID');
  }
  return insertId;
}

export async function readEditOperation(
  connectionManager: ConnectionManager,
  schema: string,
  editOperationID: number,
  transactionID?: string
): Promise<EditOperationRecord | null> {
  const sql = safeFormatQuery(
    schema,
    `SELECT
       EditOperationID,
       OperationType,
       DataType,
       TargetID,
       PlotID,
       CensusID,
       PlanHash,
       BeforeState,
       AfterState,
       CreatedBy,
       CreatedAt,
       RevertedByEditOperationID
     FROM ??.edit_operations
     WHERE EditOperationID = ?
     LIMIT 1`
  );

  const rows = await connectionManager.executeQuery(sql, [editOperationID], transactionID);
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const row = rows[0] as Record<string, unknown>;
  return mapRowToEditOperationRecord(row);
}

export async function markEditOperationReverted(
  connectionManager: ConnectionManager,
  schema: string,
  originalEditOperationID: number,
  revertingEditOperationID: number,
  transactionID: string
): Promise<void> {
  if (originalEditOperationID === revertingEditOperationID) {
    throw new Error('markEditOperationReverted: original and reverting IDs must differ');
  }

  const sql = safeFormatQuery(
    schema,
    `UPDATE ??.edit_operations
     SET RevertedByEditOperationID = ?
     WHERE EditOperationID = ?`
  );

  const result = await connectionManager.executeQuery(sql, [revertingEditOperationID, originalEditOperationID], transactionID);
  const affectedRows = (result as { affectedRows?: number })?.affectedRows ?? 0;
  if (affectedRows === 0) {
    throw new Error(`markEditOperationReverted: no edit_operations row found with EditOperationID=${originalEditOperationID}`);
  }
}

function parseStateColumn(value: unknown): EditOperationStateRow[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value as EditOperationStateRow[];
  }

  if (typeof value === 'string') {
    if (value.length === 0) {
      return [];
    }
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as EditOperationStateRow[]) : [];
  }

  if (typeof value === 'object') {
    return value as unknown as EditOperationStateRow[];
  }

  return [];
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return String(value);
}

function mapRowToEditOperationRecord(row: Record<string, unknown>): EditOperationRecord {
  const revertedByRaw = row.RevertedByEditOperationID;
  const revertedBy = revertedByRaw === null || revertedByRaw === undefined ? null : Number(revertedByRaw);

  return {
    editOperationID: Number(row.EditOperationID),
    operationType: row.OperationType as EditOperationType,
    dataType: row.DataType as EditOperationDataType,
    targetID: Number(row.TargetID),
    plotID: Number(row.PlotID),
    censusID: Number(row.CensusID),
    planHash: String(row.PlanHash),
    beforeState: parseStateColumn(row.BeforeState),
    afterState: parseStateColumn(row.AfterState),
    createdBy: String(row.CreatedBy),
    createdAt: toIsoString(row.CreatedAt),
    revertedByEditOperationID: revertedBy
  };
}
