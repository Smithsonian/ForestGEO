import type { Connection, RowDataPacket } from 'mysql2/promise';
import type { FileRow } from '@/config/macros/formdetails';
import { createArcgisImportSession } from '@/lib/arcgis/import-session';
import { buildSubBatchPattern, deriveArcgisCommitBatchID, LIKE_ESCAPE_CLAUSE } from '@/lib/uploads/batch-family';
import { TEMPORARY_MEASUREMENT_INSERT_COLUMNS } from '@/lib/ingestion/temporary-measurements';
import { startFreshUploadSession } from './upload-session-fixtures';

export const ARCGIS_TEST_USER = 'arcgis-commit@example.com';
export const PRIOR_BATCH = 'prior-batch-561';
export const PRIOR_FILE = 'prior-census.csv';
const COREMEASUREMENTS_TABLE_NAME = 'coremeasurements';
const FILE_UPLOAD_TABLE_NAME = 'file_upload';
const DELETE_OPERATION = 'DELETE';
const SEED_MEASUREMENT_DATE = '2024-03-15';
const SEED_MEASURED_VALUE = 1.0;
const SEED_IMPORT_DATE = '2026-06-01';
const SEED_METRIC_SOURCE_RECORDS = 1;
const SEED_METRIC_STATUS = 'completed';

export interface ArcgisImportScope {
  schema: string;
  plotID: number;
  censusID: number;
  speciesCode: string;
  quadratName: string;
}

export interface SeededArcgisImport {
  importSessionId: string;
  batchID: string;
  fileName: string;
  rowCount: number;
}

export interface RecordedTransaction {
  transactionID: string;
  statements: string[];
}

/** One FileRow per index, with a unique tag `${tagPrefix}${index}` so tests can drop or find a row by tag. */
export function buildArcgisImportRows(scope: ArcgisImportScope, rowCount: number, tagPrefix: string): FileRow[] {
  return Array.from({ length: rowCount }, (_, index) => ({
    tag: `${tagPrefix}${index}`,
    stemtag: '1',
    spcode: scope.speciesCode,
    quadrat: scope.quadratName,
    lx: '1',
    ly: '2',
    dbh: '10',
    hom: '1.3',
    date: SEED_IMPORT_DATE,
    codes: 'A'
  }));
}

/** Creates the import session through the product function, so it runs on whatever ConnectionManager the test file installed. */
export async function seedArcgisImport(
  scope: ArcgisImportScope,
  fileName: string,
  rowCount: number,
  tagPrefix: string,
  userId = ARCGIS_TEST_USER
): Promise<SeededArcgisImport> {
  const rows = buildArcgisImportRows(scope, rowCount, tagPrefix);
  const reference = await createArcgisImportSession({
    schema: scope.schema,
    plotID: scope.plotID,
    censusID: scope.censusID,
    userId,
    fileName,
    result: {
      rows,
      warnings: [],
      summary: {
        treesTransformed: rowCount,
        stemsJoined: 0,
        blankQuadratCount: 0,
        tagMismatchCount: 0,
        orphanStemsEmitted: 0,
        duplicateTreeTags: 0,
        duplicateGlobalIds: 0,
        missingRequired: 0,
        totalRows: rowCount
      }
    }
  });
  return { importSessionId: reference.importSessionId, batchID: deriveArcgisCommitBatchID(reference.importSessionId), fileName, rowCount };
}

export async function startActiveUploadSession(connection: Connection, scope: ArcgisImportScope, sessionID: string): Promise<void> {
  await startFreshUploadSession(connection, { schema: scope.schema, sessionID, plotID: scope.plotID, censusID: scope.censusID });
}

export async function setUploadSessionState(connection: Connection, sessionID: string, state: string): Promise<void> {
  await connection.query(`UPDATE upload_sessions SET state = ? WHERE session_id = ?`, [state, sessionID]);
}

/** Failure-shaped prior rows (StemGUID NULL) so no tree/stem graph is needed; the replacement deletes them all the same. */
export async function seedPriorCensusRows(
  connection: Connection,
  scope: ArcgisImportScope,
  rowCount: number,
  batchID = PRIOR_BATCH,
  fileName = PRIOR_FILE
): Promise<void> {
  await connection.query(`SET SESSION cte_max_recursion_depth = ?`, [rowCount + 1]);
  await connection.query(
    `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
       UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
     WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
     SELECT ?, NULL, FALSE, ?, ?, ?, ?, ?, CONCAT(?, n), n, 1 FROM seq`,
    [rowCount, scope.censusID, SEED_MEASUREMENT_DATE, SEED_MEASURED_VALUE, SEED_MEASURED_VALUE, fileName, batchID, `${batchID}-`]
  );
}

export async function seedScopeMetrics(connection: Connection, scope: ArcgisImportScope, count: number, batchID = PRIOR_BATCH): Promise<void> {
  for (let ordinal = 1; ordinal <= count; ordinal += 1) {
    await connection.query(
      `INSERT INTO uploadmetrics (uploadId, fileID, batchID, schema_name, plotID, censusID, sourceRecords, processedRecords, failedRecords, status, startTime)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW())`,
      [
        `metric-${scope.plotID}-${scope.censusID}-${batchID}-${ordinal}`,
        PRIOR_FILE,
        batchID,
        scope.schema,
        scope.plotID,
        scope.censusID,
        SEED_METRIC_SOURCE_RECORDS,
        SEED_METRIC_SOURCE_RECORDS,
        SEED_METRIC_STATUS
      ]
    );
  }
}

async function readNumber(connection: Connection, sql: string, params: unknown[]): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>(sql, params);
  return Number(rows[0].total);
}

export function countStagedFamilyRows(connection: Connection, fileName: string, batchID: string): Promise<number> {
  return readNumber(
    connection,
    `SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ? AND (BatchID = ? OR BatchID LIKE ? ${LIKE_ESCAPE_CLAUSE})`,
    [fileName, batchID, buildSubBatchPattern(batchID)]
  );
}

export function countFamilyFailureRows(connection: Connection, fileName: string, batchID: string, censusID: number): Promise<number> {
  return readNumber(
    connection,
    `SELECT COUNT(*) AS total FROM coremeasurements
     WHERE UploadFileID = ? AND (UploadBatchID = ? OR UploadBatchID LIKE ? ${LIKE_ESCAPE_CLAUSE}) AND CensusID = ?`,
    [fileName, batchID, buildSubBatchPattern(batchID), censusID]
  );
}

export function countCensusRowsOutsideFamily(connection: Connection, censusID: number, batchID: string): Promise<number> {
  return readNumber(
    connection,
    `SELECT COUNT(*) AS total FROM coremeasurements
     WHERE CensusID = ? AND (UploadBatchID IS NULL OR NOT (UploadBatchID = ? OR UploadBatchID LIKE ? ${LIKE_ESCAPE_CLAUSE}))`,
    [censusID, batchID, buildSubBatchPattern(batchID)]
  );
}

export async function readImportRow(connection: Connection, importSessionId: string): Promise<RowDataPacket> {
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT * FROM arcgis_import_sessions WHERE import_session_id = ?`, [importSessionId]);
  if (rows.length !== 1) throw new Error(`expected exactly one arcgis_import_sessions row for ${importSessionId}, found ${rows.length}`);
  return rows[0];
}

export async function deleteAuditRows(connection: Connection, censusID: number): Promise<{ total: number; distinctRecordIDs: number }> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT RecordID) AS distinctRecordIDs FROM unifiedchangelog
     WHERE TableName = ? AND Operation = ? AND CensusID = ?`,
    [COREMEASUREMENTS_TABLE_NAME, DELETE_OPERATION, censusID]
  );
  return { total: Number(rows[0].total), distinctRecordIDs: Number(rows[0].distinctRecordIDs) };
}

export async function fileUploadChangelogRows(connection: Connection, censusID: number, fileName: string): Promise<RowDataPacket[]> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT * FROM unifiedchangelog WHERE TableName = ? AND CensusID = ? AND RecordID LIKE ? ORDER BY ChangeID`,
    [FILE_UPLOAD_TABLE_NAME, censusID, `${fileName}%`]
  );
  return rows;
}

export function countScopeMetrics(connection: Connection, scope: ArcgisImportScope): Promise<number> {
  return readNumber(connection, `SELECT COUNT(*) AS total FROM uploadmetrics WHERE plotID = ? AND censusID = ?`, [scope.plotID, scope.censusID]);
}

/**
 * Pure helper for `state.rewrite`: drops the INSERT IGNORE tuple whose TreeTag is `treeTag`, which is what a duplicate-key collision
 * does to the statement's effect. Returns null when the statement is not a staging insert or holds no such tag.
 */
export function dropStagingTupleWithTreeTag(sql: string, params: unknown[], treeTag: string): { sql: string; params: unknown[] } | null {
  const columnCount = TEMPORARY_MEASUREMENT_INSERT_COLUMNS.length;
  const treeTagColumnIndex = TEMPORARY_MEASUREMENT_INSERT_COLUMNS.indexOf('TreeTag');
  if (!sql.includes('INSERT IGNORE INTO') || !sql.includes('.temporarymeasurements')) return null;
  const tupleCount = params.length / columnCount;
  let droppedTupleIndex = -1;
  for (let tupleIndex = 0; tupleIndex < tupleCount; tupleIndex += 1) {
    if (params[tupleIndex * columnCount + treeTagColumnIndex] === treeTag) {
      droppedTupleIndex = tupleIndex;
      break;
    }
  }
  if (droppedTupleIndex === -1) return null;
  const [statementHead, tuplesSql] = sql.split(' VALUES ');
  const tuples = tuplesSql.match(/\([^()]*\)/g) ?? [];
  tuples.splice(droppedTupleIndex, 1);
  return {
    sql: `${statementHead} VALUES ${tuples.join(', ')}`,
    params: [...params.slice(0, droppedTupleIndex * columnCount), ...params.slice((droppedTupleIndex + 1) * columnCount)]
  };
}

/** Statements with no transaction id (the ensure-table DDL) are not part of any transaction and are left out. */
export function groupStatementsByTransaction(statements: Array<{ transactionID: string | null; sql: string }>): RecordedTransaction[] {
  const transactions = new Map<string, RecordedTransaction>();
  for (const statement of statements) {
    if (statement.transactionID === null) continue;
    const transaction = transactions.get(statement.transactionID) ?? { transactionID: statement.transactionID, statements: [] };
    transaction.statements.push(statement.sql);
    transactions.set(statement.transactionID, transaction);
  }
  return [...transactions.values()];
}
