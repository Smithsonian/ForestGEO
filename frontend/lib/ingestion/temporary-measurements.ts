import { format } from 'mysql2/promise';
import moment from 'moment/moment';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { buildSubBatchPattern, LIKE_ESCAPE_CLAUSE } from '@/lib/uploads/batch-family';
import ConnectionManager from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';
import { FileRow, SourceFormat } from '@/config/macros/formdetails';
import { toFiniteNumber } from '@/config/measurementerrors';

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

// Maximum value of a MySQL INT UNSIGNED column (2^32 - 1).
export const MYSQL_UNSIGNED_INT_MAX = 4294967295;

/** Parses a value into a positive MySQL-unsigned-int, or null if absent/invalid. */
export function parseUnsignedIntField(value: unknown): number | null {
  if (value === undefined || value === null || `${value}`.trim() === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= MYSQL_UNSIGNED_INT_MAX ? n : null;
}

/**
 * True when a value is present and non-empty but does not parse to a valid unsigned int.
 * Absent/blank values are legitimately optional and return false; only present-but-garbage
 * values (e.g. "5,001", "STEM-5001") return true so callers can surface the coerced-to-NULL loss.
 */
export function isUnsignedIntFieldInvalid(value: unknown): boolean {
  if (value === undefined || value === null || `${value}`.trim() === '') return false;
  return parseUnsignedIntField(value) === null;
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

/**
 * Canonical column order for the temporarymeasurements bulk INSERT.
 *
 * This is the single source of truth that the INSERT column list, the
 * per-row placeholder width, and the SQL value order are all derived from.
 * Adding a column here (and to its keyed record below) is the ONLY change
 * required to widen the write, which keeps the write contract from silently
 * diverging from the live schema.
 */
export const TEMPORARY_MEASUREMENT_INSERT_COLUMNS = [
  'FileID',
  'BatchID',
  'SessionID',
  'SourceFormat',
  'PlotID',
  'CensusID',
  'TreeTag',
  'StemTag',
  'SpeciesCode',
  'QuadratName',
  'LocalX',
  'LocalY',
  'PlotX',
  'PlotY',
  'DBH',
  'HOM',
  'MeasurementDate',
  'Codes',
  'Comments',
  'PublishedStemID'
] as const;

export type TemporaryMeasurementInsertColumn = (typeof TEMPORARY_MEASUREMENT_INSERT_COLUMNS)[number];

export type TemporaryMeasurementInsertValue = string | number | null;

export type TemporaryMeasurementInsertRecord = Record<TemporaryMeasurementInsertColumn, TemporaryMeasurementInsertValue>;

export function buildTemporaryMeasurementInsertRecord(
  row: FileRow,
  fileName: string,
  batchID: string,
  sessionId: string | null,
  sourceFormat: SourceFormat,
  plotID: number,
  censusID: number
): TemporaryMeasurementInsertRecord {
  const { tag, stemtag, spcode, quadrat, lx, ly, px, py, dbh, hom, date, codes, comments, publishedstemid } = row;
  const formattedDate = normalizeMeasurementDate(date);
  const parsedLx = lx !== undefined && lx !== null && lx !== '' && !isNaN(Number(lx)) ? Number(lx) : null;
  const parsedLy = ly !== undefined && ly !== null && ly !== '' && !isNaN(Number(ly)) ? Number(ly) : null;
  const parsedPublishedStemID = parseUnsignedIntField(publishedstemid);

  return {
    FileID: fileName,
    BatchID: batchID,
    SessionID: sessionId,
    SourceFormat: sourceFormat,
    PlotID: plotID,
    CensusID: censusID,
    TreeTag: tag ?? null,
    StemTag: stemtag || null,
    SpeciesCode: spcode ?? null,
    QuadratName: quadrat ?? null,
    LocalX: parsedLx,
    LocalY: parsedLy,
    PlotX: toFiniteNumber(px),
    PlotY: toFiniteNumber(py),
    DBH: dbh ?? null,
    HOM: hom ?? null,
    MeasurementDate: formattedDate,
    Codes: codes ?? null,
    Comments: comments ?? null,
    PublishedStemID: parsedPublishedStemID
  };
}

/** Projects a keyed insert record onto the canonical column order for the SQL VALUES tuple. */
export function toTemporaryMeasurementInsertValues(record: TemporaryMeasurementInsertRecord): TemporaryMeasurementInsertValue[] {
  return TEMPORARY_MEASUREMENT_INSERT_COLUMNS.map(column => record[column]);
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
  const columnList = TEMPORARY_MEASUREMENT_INSERT_COLUMNS.join(', ');
  const placeholderTuple = `(${TEMPORARY_MEASUREMENT_INSERT_COLUMNS.map(() => '?').join(', ')})`;
  const insertSQLPrefix = format(`INSERT IGNORE INTO ??.temporarymeasurements (${columnList}) VALUES `, [schema]);

  for (let start = 0; start < rows.length; start += TEMP_MEASUREMENT_INSERT_BATCH_SIZE) {
    const slice = rows.slice(start, start + TEMP_MEASUREMENT_INSERT_BATCH_SIZE);
    const placeholders = slice.map(() => placeholderTuple).join(', ');
    const values = slice.flatMap(row =>
      toTemporaryMeasurementInsertValues(buildTemporaryMeasurementInsertRecord(row, fileName, batchID, sessionId, sourceFormat, plotID, censusID))
    );
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
 * Rows removed per statement by the census-replacement deletes.
 *
 * What chunking DOES bound: per-statement execution time and per-statement
 * rollback size. A single unbounded DELETE over a large census (Harvard: 116,227
 * rows) runs as one statement that can outlive the 660s JS-side KILL in
 * lib/db/primitives.ts, and a KILL mid-statement forces the server to roll back
 * everything that one statement had removed.
 *
 * What chunking does NOT bound: the lock footprint at commit. Every chunk runs
 * inside the SAME caller-owned transaction, so InnoDB holds every row lock this
 * loop takes until that transaction commits — the total is identical to the
 * unbounded DELETE. Do not treat lock contention against a concurrent writer as
 * mitigated by this constant.
 */
export const CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE = 5000;

/**
 * "Belongs to a batch other than the incoming family" — `batch` itself and its
 * `batch__subNNN` children.
 *
 * Both arms must be NULL-safe. `UploadBatchID` is nullable and CTFS-migrated
 * rows carry NULL; a bare `NOT (col LIKE ?)` evaluates to NULL for those rows,
 * which poisons the conjunction and silently spares every legacy row from a
 * census replacement that claims to have replaced them. A NULL batch id belongs
 * to no family, so it is always a prior row.
 */
function buildNotIncomingFamilyPredicate(column: string): string {
  return `NOT (${column} <=> ?) AND (${column} IS NULL OR ${column} NOT LIKE ? ${LIKE_ESCAPE_CLAUSE})`;
}

/**
 * The loop below terminates ONLY on the row count the server reports, so an
 * unreadable count is not a value to paper over with a default. Coercing a
 * missing `affectedRows` to 0 stops the loop after one window and silently
 * leaves the rest of the census in place; coercing an unparseable one to NaN
 * makes `deleted < CHUNK_SIZE` permanently false and the loop never ends.
 * Both are failures the caller must see.
 */
function requireAffectedRows(result: unknown, deleteSQL: string): number {
  const affectedRows = (result as { affectedRows?: unknown })?.affectedRows;
  const parsed = Number(affectedRows);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `Bounded delete could not read a row count from the server: affectedRows=${JSON.stringify(affectedRows)} ` +
        `is not a non-negative integer. Statement: ${deleteSQL.replace(/\s+/g, ' ').trim().slice(0, 200)}`
    );
  }
  return parsed;
}

/**
 * Runs a `DELETE ... LIMIT n` until it stops filling the limit, returning the
 * total rows removed. The statement is re-issued verbatim: each pass deletes a
 * fresh window because the previous window's rows no longer match.
 */
async function deleteInBoundedChunks(connectionManager: ConnectionManager, deleteSQL: string, params: unknown[], transactionID: string): Promise<number> {
  let totalDeleted = 0;
  for (;;) {
    const result = await connectionManager.executeQuery(deleteSQL, params, transactionID);
    const deleted = requireAffectedRows(result, deleteSQL);
    totalDeleted += deleted;
    if (deleted < CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE) return totalDeleted;
  }
}

/** Column recording that a session's census replacement has run. */
export const CENSUS_REPLACEMENT_MARKER_COLUMN = 'census_replacement_completed_at';

const verifiedCensusReplacementMarkerSchemas = new Set<string>();

/**
 * Self-heals a live schema whose upload_sessions predates the marker column, the
 * same way SourceFormat is handled for temporarymeasurements: the repair
 * migration is the durable fix, this keeps a not-yet-migrated schema working.
 *
 * Runs OUTSIDE the caller's transaction on purpose — ALTER TABLE causes an
 * implicit commit in MySQL, so issuing it on the transaction's connection would
 * silently commit the caller's in-progress work.
 */
export async function ensureUploadSessionCensusReplacementColumn(connectionManager: ConnectionManager, schema: string): Promise<void> {
  if (verifiedCensusReplacementMarkerSchemas.has(schema)) return;

  // Both facts in one read: whether the table exists at all, and whether it has
  // the column. upload_sessions is created on demand by ensureUploadSessionsTable,
  // so "no table yet" is a legitimate state, not something to repair here.
  const stateSQL = `
    SELECT
      (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'upload_sessions') AS tableCount,
      (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'upload_sessions' AND COLUMN_NAME = ?) AS columnCount
  `;
  const state = await connectionManager.executeQuery(stateSQL, [schema, schema, CENSUS_REPLACEMENT_MARKER_COLUMN]);
  const tableExists = Number(state?.[0]?.tableCount ?? 0) > 0;
  const columnExists = Number(state?.[0]?.columnCount ?? 0) > 0;

  if (tableExists && !columnExists) {
    const alterSQL = format(`ALTER TABLE ??.upload_sessions ADD COLUMN ${CENSUS_REPLACEMENT_MARKER_COLUMN} TIMESTAMP NULL DEFAULT NULL`, [schema]);
    await connectionManager.executeQuery(alterSQL);
  }

  // Only memoize a settled state. A schema without the table yet must be
  // re-checked, or the column would never be added once it appears.
  if (tableExists) verifiedCensusReplacementMarkerSchemas.add(schema);
}

/** Test seam: the per-process memo would otherwise hide a dropped column between suites. */
export function resetUploadSessionCensusReplacementColumnCacheForTests(): void {
  verifiedCensusReplacementMarkerSchemas.clear();
}

/**
 * True when this upload session has already performed its census replacement.
 *
 * This used to be inferred from "the session has staged rows", which is only
 * ALMOST the same thing: if every row of the session's first file dropped as an
 * INSERT IGNORE duplicate, nothing was staged, and the next file read "no staged
 * rows" and re-ran the census-wide cleanup — deleting the failure rows the first
 * file had just recorded. That is the exact defect class #384 fixed, surviving in
 * the zero-staged edge.
 *
 * The marker is written in the SAME caller-owned transaction as the cleanup, so
 * the two cannot disagree: a rollback loses both, a commit keeps both.
 */
export async function uploadSessionHasReplacedCensus(
  connectionManager: ConnectionManager,
  schema: string,
  uploadSessionID: string,
  transactionID: string
): Promise<boolean> {
  const probeSQL = safeFormatQuery(schema, `SELECT ${CENSUS_REPLACEMENT_MARKER_COLUMN} FROM ??.upload_sessions WHERE session_id = ? LIMIT 1`);
  try {
    const rows = await connectionManager.executeQuery(probeSQL, [uploadSessionID], transactionID);
    return Array.isArray(rows) && rows.length > 0 && rows[0][CENSUS_REPLACEMENT_MARKER_COLUMN] !== null;
  } catch (error: unknown) {
    if (!isMissingTableError(error, 'upload_sessions')) throw error;
    // No session table in this schema: fall back to "has not replaced", which
    // reproduces the pre-marker behaviour (clean on every file) rather than
    // failing the upload outright.
    ailogger.warn(`No upload_sessions table in ${schema}; census replacement cannot be tracked per session for ${uploadSessionID}.`);
    return false;
  }
}

/** Records that this session's census replacement has run. Same transaction as the cleanup. */
export async function markUploadSessionCensusReplaced(
  connectionManager: ConnectionManager,
  schema: string,
  uploadSessionID: string,
  transactionID: string
): Promise<void> {
  const markSQL = safeFormatQuery(schema, `UPDATE ??.upload_sessions SET ${CENSUS_REPLACEMENT_MARKER_COLUMN} = CURRENT_TIMESTAMP WHERE session_id = ?`);
  try {
    const result = await connectionManager.executeQuery(markSQL, [uploadSessionID], transactionID);
    if (Number((result as { affectedRows?: number })?.affectedRows ?? 0) === 0) {
      // The marker lives on the session row, so a session id with no row cannot
      // be marked — and the next file of that "session" would replace the census
      // again. Never silent: this is the shape of the bug the marker replaced.
      ailogger.warn(
        `Upload session ${uploadSessionID} has no row in ${schema}.upload_sessions; its census replacement could not be recorded, ` +
          `so a later file in the same session will replace the census again.`
      );
    }
  } catch (error: unknown) {
    if (!isMissingTableError(error, 'upload_sessions')) throw error;
  }
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
  // SCOPE: the whole target census, minus the incoming batch family.
  //
  // This deliberately does NOT enumerate batches from uploadmetrics. A batch
  // whose ingestion died before the stored procedure recorded its metric row
  // has no uploadmetrics entry, so a metrics-driven delete list cannot see it:
  // on live forestgeo_harvard (measured 2026-07-28) only 2 of 12 sub-batches
  // had metrics, and a metrics-driven cleanup stranded 96,227 of 106,227 rows
  // permanently, with no later mechanism that would ever remove them.
  //
  // It also does NOT filter on UploadFileID. Clean re-upload is CENSUS
  // replacement, not filename replacement — restricting to the same file would
  // preserve stale data whenever the replacement file was renamed or the census
  // was previously assembled from several files.
  //
  // The incoming batch is excluded as a FAMILY (`batch` and `batch__subNNN`),
  // not just by exact id, so a re-entrant call after this upload has already
  // split cannot delete its own in-flight rows.
  const incomingSubBatchPattern = buildSubBatchPattern(currentBatchID);
  const notIncomingFamily = buildNotIncomingFamilyPredicate('%COL%');
  const familyParams = [currentBatchID, incomingSubBatchPattern];

  // Error links first. The FK is ON DELETE CASCADE in current schemas, but
  // legacy schemas may lack it, and an explicit scoped delete is cheap.
  // Expressed as a single-table DELETE over a subquery rather than a
  // multi-table DELETE ... JOIN, because MySQL rejects LIMIT on the latter and
  // these deletes must stay bounded (see deleteInBoundedChunks).
  const deleteValidationErrorsSQL = safeFormatQuery(
    schema,
    `DELETE FROM ??.measurement_error_log
     WHERE MeasurementID IN (
       SELECT cm.CoreMeasurementID FROM ??.coremeasurements cm
       WHERE cm.CensusID = ? AND ${notIncomingFamily.replace(/%COL%/g, 'cm.UploadBatchID')}
     )
     LIMIT ${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE}`
  );
  try {
    await deleteInBoundedChunks(connectionManager, deleteValidationErrorsSQL, [censusID, ...familyParams], transactionID);
  } catch (error: unknown) {
    if (!isMissingTableError(error, 'measurement_error_log')) {
      throw error;
    }

    const deleteLegacyValidationErrorsSQL = safeFormatQuery(
      schema,
      `DELETE FROM ??.cmverrors
       WHERE CoreMeasurementID IN (
         SELECT cm.CoreMeasurementID FROM ??.coremeasurements cm
         WHERE cm.CensusID = ? AND ${notIncomingFamily.replace(/%COL%/g, 'cm.UploadBatchID')}
       )
       LIMIT ${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE}`
    );
    await deleteInBoundedChunks(connectionManager, deleteLegacyValidationErrorsSQL, [censusID, ...familyParams], transactionID);
  }

  // Every prior measurement in the census — ingested and unresolved alike.
  const deleteCmSQL = safeFormatQuery(
    schema,
    `DELETE FROM ??.coremeasurements
     WHERE CensusID = ? AND ${notIncomingFamily.replace(/%COL%/g, 'UploadBatchID')}
     LIMIT ${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE}`
  );
  const deletedCmRows = await deleteInBoundedChunks(connectionManager, deleteCmSQL, [censusID, ...familyParams], transactionID);

  const deleteFailedSQL = safeFormatQuery(
    schema,
    `DELETE FROM ??.failedmeasurements
     WHERE CensusID = ? AND ${notIncomingFamily.replace(/%COL%/g, 'BatchID')}
     LIMIT ${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE}`
  );
  try {
    await deleteInBoundedChunks(connectionManager, deleteFailedSQL, [censusID, ...familyParams], transactionID);
  } catch (error: unknown) {
    if (!isMissingTableError(error, 'failedmeasurements')) {
      throw error;
    }
    ailogger.info(`Skipping failedmeasurements cleanup for ${fileName}: legacy table does not exist in ${schema}`);
  }

  // Prior metric rows for this scope must go too, or the stored procedure's
  // idempotency guard would skip re-ingestion. The incoming upload keeps its
  // own metrics — those belong to the replacement, not the thing replaced.
  const deleteMetricsSQL = safeFormatQuery(
    schema,
    `DELETE FROM ??.uploadmetrics
     WHERE plotID = ? AND censusID = ? AND ${notIncomingFamily.replace(/%COL%/g, 'batchID')}
     LIMIT ${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE}`
  );
  await deleteInBoundedChunks(connectionManager, deleteMetricsSQL, [plotID, censusID, ...familyParams], transactionID);

  if (deletedCmRows > 0) {
    ailogger.info(
      `Clean re-upload for ${fileName}: removed ${deletedCmRows} prior coremeasurement(s) and associated errors ` +
        `from census ${censusID} (plot ${plotID}), excluding the incoming batch family ${currentBatchID}`
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

    // safeFormatQuery substitutes EVERY ?? with the validated schema, leaving
    // the value `?` placeholders for executeQuery. Do NOT use mysql2 format()
    // with [schema, schema] here: format fills placeholders strictly in order,
    // so the second array value lands in `tm.FileID = ?` and the second ??
    // never gets the schema (it would be filled by a value param at execute
    // time and treated as a database name).
    const droppedRowsSQL = safeFormatQuery(
      schema,
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
       ORDER BY drc.RowOrdinal`
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
