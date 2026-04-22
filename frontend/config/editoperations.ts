import ConnectionManager from '@/config/connectionmanager';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import ailogger from '@/ailogger';

export type EditOperationType = 'single-row-edit' | 'bulk-revision-row' | 'revert';
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
  revertable: boolean;
  dataType: EditOperationDataType;
  // null on bulk-revision-row entries because a batch has no single "target"
  // measurement. Affected CoreMeasurementIDs live inside BeforeState JSON.
  targetID: number | null;
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
  revertable?: boolean;
  dataType: EditOperationDataType;
  targetID: number | null;
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

const ALTER_EDIT_OPERATION_TYPE_SQL = `
  ALTER TABLE ??.edit_operations
  MODIFY COLUMN OperationType ENUM('single-row-edit', 'bulk-revision-row', 'revert') NOT NULL
`;

async function ensureOperationTypeColumn(
  connectionManager: ConnectionManager,
  schema: string,
  transactionID?: string
): Promise<void> {
  const rows = await connectionManager.executeQuery(
    `SELECT COLUMN_TYPE AS columnType
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'edit_operations'
       AND COLUMN_NAME = 'OperationType'
     LIMIT 1`,
    [schema],
    transactionID
  );

  const columnType = Array.isArray(rows) && rows.length > 0 ? String((rows[0] as Record<string, unknown>).columnType ?? '') : '';
  if (columnType.includes('bulk-revision-row')) {
    return;
  }

  await connectionManager.executeQuery(safeFormatQuery(schema, ALTER_EDIT_OPERATION_TYPE_SQL), undefined, transactionID);
}

async function ensureRevertableColumn(
  connectionManager: ConnectionManager,
  schema: string,
  transactionID?: string
): Promise<void> {
  const rows = await connectionManager.executeQuery(
    `SELECT COUNT(*) AS columnCount
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'edit_operations'
       AND COLUMN_NAME = 'Revertable'`,
    [schema],
    transactionID
  );

  const columnCount = Array.isArray(rows) && rows.length > 0 ? Number((rows[0] as Record<string, unknown>).columnCount) : 0;
  if (columnCount > 0) {
    return;
  }

  await connectionManager.executeQuery(
    safeFormatQuery(schema, `ALTER TABLE ??.edit_operations ADD COLUMN Revertable BOOLEAN NOT NULL DEFAULT TRUE AFTER OperationType`),
    undefined,
    transactionID
  );
}

async function ensureTargetIDNullable(
  connectionManager: ConnectionManager,
  schema: string,
  transactionID?: string
): Promise<void> {
  const rows = await connectionManager.executeQuery(
    `SELECT IS_NULLABLE AS isNullable
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'edit_operations'
       AND COLUMN_NAME = 'TargetID'
     LIMIT 1`,
    [schema],
    transactionID
  );

  const isNullable = Array.isArray(rows) && rows.length > 0 ? String((rows[0] as Record<string, unknown>).isNullable ?? '') : '';
  if (isNullable === 'YES') {
    return;
  }

  await connectionManager.executeQuery(
    safeFormatQuery(schema, `ALTER TABLE ??.edit_operations MODIFY COLUMN TargetID BIGINT NULL`),
    undefined,
    transactionID
  );
}

async function ensureEditOperationsSchemaUpgrades(
  connectionManager: ConnectionManager,
  schema: string,
  transactionID?: string
): Promise<void> {
  await ensureOperationTypeColumn(connectionManager, schema, transactionID);
  await ensureRevertableColumn(connectionManager, schema, transactionID);
  await ensureTargetIDNullable(connectionManager, schema, transactionID);
}

export async function ensureEditOperationsTable(
  connectionManager: ConnectionManager,
  schema: string,
  transactionID?: string
): Promise<void> {
  const sql = safeFormatQuery(schema, CREATE_EDIT_OPERATIONS_TABLE_SQL);
  try {
    await connectionManager.executeQuery(sql, undefined, transactionID);
    await ensureEditOperationsSchemaUpgrades(connectionManager, schema, transactionID);
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
       OperationType, Revertable, DataType, TargetID, PlotID, CensusID, PlanHash,
       BeforeState, AfterState, CreatedBy
     ) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)`
  );

  const params = [
    record.operationType,
    record.revertable ?? true,
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
       Revertable,
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

function toBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    return value === '1' || value.toLowerCase() === 'true';
  }
  return Boolean(value);
}

function mapRowToEditOperationRecord(row: Record<string, unknown>): EditOperationRecord {
  const revertedByRaw = row.RevertedByEditOperationID;
  const revertedBy = revertedByRaw === null || revertedByRaw === undefined ? null : Number(revertedByRaw);

  const targetIDRaw = row.TargetID;
  const targetID = targetIDRaw === null || targetIDRaw === undefined ? null : Number(targetIDRaw);

  return {
    editOperationID: Number(row.EditOperationID),
    operationType: row.OperationType as EditOperationType,
    revertable: toBoolean(row.Revertable, true),
    dataType: row.DataType as EditOperationDataType,
    targetID,
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
