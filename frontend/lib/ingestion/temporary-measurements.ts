import { format } from 'mysql2/promise';
import moment from 'moment/moment';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import { FileRow, SourceFormat } from '@/config/macros/formdetails';

export const TEMP_MEASUREMENT_INSERT_BATCH_SIZE = 1000;

const verifiedTemporaryMeasurementSourceFormatSchemas = new Set<string>();

export function resetTemporaryMeasurementsSourceFormatColumnCacheForTests(): void {
  if (process.env.NODE_ENV === 'test') {
    verifiedTemporaryMeasurementSourceFormatSchemas.clear();
  }
}

export async function ensureTemporaryMeasurementsSourceFormatColumn(connectionManager: ConnectionManager, schema: string): Promise<void> {
  if (verifiedTemporaryMeasurementSourceFormatSchemas.has(schema)) return;

  const columnCheckSQL = `
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = 'temporarymeasurements'
      AND COLUMN_NAME = 'SourceFormat'
  `;
  const columnCheck = await connectionManager.executeQuery(columnCheckSQL, [schema]);
  const hasColumn = Number(columnCheck?.[0]?.count ?? 0) > 0;

  if (!hasColumn) {
    const alterSQL = format(`ALTER TABLE ??.temporarymeasurements ADD COLUMN SourceFormat VARCHAR(32) NOT NULL DEFAULT 'csv' AFTER SessionID`, [schema]);
    await connectionManager.executeQuery(alterSQL);
  }

  verifiedTemporaryMeasurementSourceFormatSchemas.add(schema);
}

function isMissingTableError(error: unknown, tableName?: string): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as { code?: string; message?: string; sqlMessage?: string };
  const message = `${candidate.message ?? ''} ${candidate.sqlMessage ?? ''}`.toLowerCase();
  const tableMatch = tableName ? message.includes(tableName.toLowerCase()) : true;

  return (candidate.code === 'ER_NO_SUCH_TABLE' || message.includes("doesn't exist") || message.includes('does not exist')) && tableMatch;
}

export interface DroppedMeasurementCandidate {
  rowOrdinal: number;
  existingBatch: string | null;
}

export type DroppedMeasurementRow = FileRow & {
  failureReason: string;
  sourceRowIndex: number;
};

export function normalizeMeasurementDate(value: unknown): string | null {
  return value ? moment(value).format('YYYY-MM-DD') : null;
}

function collectMeasurementValidationIssues(row: FileRow): string[] {
  const issues: string[] = [];
  if (!row.tag || row.tag.trim() === '') issues.push('empty TreeTag');
  if (!row.spcode || row.spcode.trim() === '') issues.push('empty SpeciesCode');
  if (!row.quadrat || row.quadrat.trim() === '') issues.push('empty QuadratName');
  if (row.dbh !== undefined && row.dbh !== null && (isNaN(Number(row.dbh)) || Number(row.dbh) < 0)) issues.push(`invalid DBH value: ${row.dbh}`);
  if (row.hom !== undefined && row.hom !== null && (isNaN(Number(row.hom)) || Number(row.hom) < 0)) issues.push(`invalid HOM value: ${row.hom}`);
  if (row.lx !== undefined && row.lx !== null && isNaN(Number(row.lx))) issues.push(`invalid LocalX value: ${row.lx}`);
  if (row.ly !== undefined && row.ly !== null && isNaN(Number(row.ly))) issues.push(`invalid LocalY value: ${row.ly}`);
  return issues;
}

export function buildDroppedMeasurementFailureReason(row: FileRow, existingBatch: string | null): string {
  if (existingBatch) {
    return `Duplicate row: TreeTag=${row.tag}, StemTag=${row.stemtag || 'null'}, Quadrat=${row.quadrat} already exists in batch ${existingBatch}`;
  }

  const issues = collectMeasurementValidationIssues(row);
  if (issues.length > 0) {
    return `Data validation failed: ${issues.join('; ')}`;
  }

  return `Row dropped by INSERT IGNORE - possible constraint violation (Tag=${row.tag}, Quadrat=${row.quadrat}, Date=${normalizeMeasurementDate(row.date)})`;
}

export function buildTemporaryMeasurementInsertParams(
  row: FileRow,
  fileName: string,
  batchID: string,
  sessionId: string | null,
  sourceFormat: SourceFormat,
  plotID: number,
  censusID: number
): (string | number | null)[] {
  const { tag, stemtag, spcode, quadrat, lx, ly, dbh, hom, date, codes, comments } = row;
  const formattedDate = normalizeMeasurementDate(date);
  const parsedLx = lx !== undefined && lx !== null && lx !== '' && !isNaN(Number(lx)) ? Number(lx) : null;
  const parsedLy = ly !== undefined && ly !== null && ly !== '' && !isNaN(Number(ly)) ? Number(ly) : null;

  return [
    fileName,
    batchID,
    sessionId,
    sourceFormat,
    plotID,
    censusID,
    tag ?? null,
    stemtag || null,
    spcode ?? null,
    quadrat ?? null,
    parsedLx,
    parsedLy,
    dbh ?? null,
    hom ?? null,
    formattedDate,
    codes ?? null,
    comments ?? null
  ];
}

export async function insertTemporaryMeasurementsInBatches(
  connectionManager: ConnectionManager,
  schema: string,
  rows: FileRow[],
  fileName: string,
  batchID: string,
  sessionId: string | null,
  sourceFormat: SourceFormat,
  plotID: number,
  censusID: number,
  transactionID: string
): Promise<void> {
  const insertSQLPrefix = format(
    `INSERT IGNORE INTO ??.temporarymeasurements
      (FileID, BatchID, SessionID, SourceFormat, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
      VALUES `,
    [schema]
  );

  for (let start = 0; start < rows.length; start += TEMP_MEASUREMENT_INSERT_BATCH_SIZE) {
    const slice = rows.slice(start, start + TEMP_MEASUREMENT_INSERT_BATCH_SIZE);
    const placeholders = slice.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(', ');
    const values = slice.flatMap(row => buildTemporaryMeasurementInsertParams(row, fileName, batchID, sessionId, sourceFormat, plotID, censusID));
    await connectionManager.executeQuery(`${insertSQLPrefix}${placeholders}`, values, transactionID);
  }
}

export async function cleanupStaleMeasurementBatchesForFile(
  connectionManager: ConnectionManager,
  schema: string,
  fileName: string,
  batchID: string,
  plotID: number,
  censusID: number,
  transactionID: string
): Promise<number> {
  const cleanupSQL = format(
    `DELETE FROM ??.temporarymeasurements
     WHERE FileID = ?
       AND PlotID = ?
       AND CensusID = ?
       AND BatchID <> ?`,
    [schema]
  );
  const cleanupResult = await connectionManager.executeQuery(cleanupSQL, [fileName, plotID, censusID, batchID], transactionID);
  const deletedRows = Number((cleanupResult as { affectedRows?: number })?.affectedRows ?? 0);

  if (deletedRows > 0) {
    ailogger.warn(
      `Removed ${deletedRows} stale temporarymeasurement row(s) for ${fileName} before starting batch ${batchID}. ` +
        `This prevents a retry from inheriting abandoned batches for the same plot/census.`
    );
  }

  return deletedRows;
}

/**
 * Clean up all data from previous uploads for the same plot/census scope.
 * Clean measurement uploads are census replacements: a new upload fully replaces
 * any earlier measurement batches for that census, even if the filename changed.
 *
 * Removes: validation error links, coremeasurements, failedmeasurements (if legacy table exists), uploadmetrics
 */
export async function cleanupPreviousFileUploads(
  connectionManager: ConnectionManager,
  schema: string,
  fileName: string,
  currentBatchID: string,
  plotID: number,
  censusID: number,
  transactionID: string
): Promise<number> {
  const findBatchesSQL = format(
    `SELECT batchID FROM ??.uploadmetrics
     WHERE plotID = ? AND censusID = ? AND batchID <> ?`,
    [schema]
  );
  const previousBatches = await connectionManager.executeQuery(findBatchesSQL, [plotID, censusID, currentBatchID], transactionID);

  if (!Array.isArray(previousBatches) || previousBatches.length === 0) return 0;

  const oldBatchIDs = previousBatches.map((row: { batchID: string }) => row.batchID);
  const placeholders = oldBatchIDs.map(() => '?').join(', ');

  // Delete validation error links linked to old coremeasurements from previous uploads
  // in the same census scope, regardless of the original filename.
  // Prefer the unified measurement_error_log table, but fall back to cmverrors in legacy schemas.
  const deleteValidationErrorsSQL = format(
    `DELETE mel FROM ??.measurement_error_log mel
     INNER JOIN ??.coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
     WHERE cm.CensusID = ? AND cm.UploadBatchID IN (${placeholders})`,
    [schema, schema]
  );
  try {
    await connectionManager.executeQuery(deleteValidationErrorsSQL, [censusID, ...oldBatchIDs], transactionID);
  } catch (error: unknown) {
    if (!isMissingTableError(error, 'measurement_error_log')) {
      throw error;
    }

    const deleteLegacyValidationErrorsSQL = format(
      `DELETE e FROM ??.cmverrors e
       INNER JOIN ??.coremeasurements cm ON cm.CoreMeasurementID = e.CoreMeasurementID
       WHERE cm.CensusID = ? AND cm.UploadBatchID IN (${placeholders})`,
      [schema, schema]
    );
    await connectionManager.executeQuery(deleteLegacyValidationErrorsSQL, [censusID, ...oldBatchIDs], transactionID);
  }

  // Delete old coremeasurements
  const deleteCmSQL = format(
    `DELETE FROM ??.coremeasurements
     WHERE CensusID = ? AND UploadBatchID IN (${placeholders})`,
    [schema]
  );
  const cmResult = await connectionManager.executeQuery(deleteCmSQL, [censusID, ...oldBatchIDs], transactionID);
  const deletedCmRows = Number((cmResult as { affectedRows?: number })?.affectedRows ?? 0);

  // Delete old failedmeasurements
  const deleteFailedSQL = format(
    `DELETE FROM ??.failedmeasurements
     WHERE CensusID = ? AND BatchID IN (${placeholders})`,
    [schema]
  );
  try {
    await connectionManager.executeQuery(deleteFailedSQL, [censusID, ...oldBatchIDs], transactionID);
  } catch (error: unknown) {
    if (!isMissingTableError(error, 'failedmeasurements')) {
      throw error;
    }
    ailogger.info(`Skipping failedmeasurements cleanup for ${fileName}: legacy table does not exist in ${schema}`);
  }

  // Delete old uploadmetrics so the stored procedure won't skip the new batch
  const deleteMetricsSQL = format(
    `DELETE FROM ??.uploadmetrics
     WHERE plotID = ? AND censusID = ? AND batchID IN (${placeholders})`,
    [schema]
  );
  await connectionManager.executeQuery(deleteMetricsSQL, [plotID, censusID, ...oldBatchIDs], transactionID);

  if (deletedCmRows > 0) {
    ailogger.info(
      `Clean re-upload for ${fileName}: removed ${deletedCmRows} coremeasurement(s) and associated errors ` +
        `from ${oldBatchIDs.length} previous batch(es) for census ${censusID}`
    );
  }

  return deletedCmRows;
}

export async function findDroppedMeasurementCandidates(
  connectionManager: ConnectionManager,
  schema: string,
  fileName: string,
  batchID: string,
  plotID: number,
  censusID: number,
  chunkRows: FileRow[],
  transactionID: string
): Promise<DroppedMeasurementCandidate[]> {
  const tempTable = 'dropped_row_candidates';
  await connectionManager.executeQuery(`DROP TEMPORARY TABLE IF EXISTS ${tempTable}`, [], transactionID);
  await connectionManager.executeQuery(
    `CREATE TEMPORARY TABLE ${tempTable} (
      RowOrdinal INT NOT NULL PRIMARY KEY,
      TreeTag VARCHAR(20) NULL,
      StemTag VARCHAR(10) NULL,
      SpeciesCode VARCHAR(25) NULL,
      QuadratName VARCHAR(255) NULL,
      MeasurementDate DATE NULL,
      INDEX idx_dropped_row_candidates_match (TreeTag, StemTag, SpeciesCode, QuadratName, MeasurementDate),
      INDEX idx_dropped_row_candidates_duplicate (TreeTag, StemTag, QuadratName)
    ) ENGINE=MEMORY`,
    [],
    transactionID
  );

  try {
    const insertWidth = 6;
    const insertBatchSize = 500;
    for (let start = 0; start < chunkRows.length; start += insertBatchSize) {
      const slice = chunkRows.slice(start, start + insertBatchSize);
      const placeholders = slice.map(() => `(${Array(insertWidth).fill('?').join(',')})`).join(', ');
      const params = slice.flatMap((row, index) => [
        start + index + 1,
        row.tag ?? null,
        row.stemtag || null,
        row.spcode ?? null,
        row.quadrat ?? null,
        normalizeMeasurementDate(row.date)
      ]);

      await connectionManager.executeQuery(
        `INSERT INTO ${tempTable} (RowOrdinal, TreeTag, StemTag, SpeciesCode, QuadratName, MeasurementDate) VALUES ${placeholders}`,
        params,
        transactionID
      );
    }

    const droppedRowsSQL = format(
      `SELECT drc.RowOrdinal as rowOrdinal,
              MIN(dup.BatchID) as existingBatch
       FROM ${tempTable} drc
       LEFT JOIN ??.temporarymeasurements tm
         ON tm.FileID = ?
        AND tm.BatchID = ?
        AND tm.TreeTag <=> drc.TreeTag
        AND tm.StemTag <=> drc.StemTag
        AND tm.SpeciesCode <=> drc.SpeciesCode
        AND tm.QuadratName <=> drc.QuadratName
        AND tm.MeasurementDate <=> drc.MeasurementDate
       LEFT JOIN ??.temporarymeasurements dup
         ON dup.FileID = ?
        AND dup.PlotID = ?
        AND dup.CensusID = ?
        AND dup.TreeTag <=> drc.TreeTag
        AND dup.StemTag <=> drc.StemTag
        AND dup.QuadratName <=> drc.QuadratName
       WHERE tm.id IS NULL
       GROUP BY drc.RowOrdinal
       ORDER BY drc.RowOrdinal`,
      [schema, schema]
    );

    const results = await connectionManager.executeQuery(droppedRowsSQL, [fileName, batchID, fileName, plotID, censusID], transactionID);

    return Array.isArray(results) ? (results as DroppedMeasurementCandidate[]) : [];
  } finally {
    try {
      await connectionManager.executeQuery(`DROP TEMPORARY TABLE IF EXISTS ${tempTable}`, [], transactionID);
    } catch (cleanupError: unknown) {
      const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      ailogger.warn(`Failed to clean up ${tempTable}: ${message}`);
    }
  }
}
