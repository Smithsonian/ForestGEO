import { format } from 'mysql2/promise';
import moment from 'moment/moment';
import { buildInPlaceholders, safeFormatQuery } from '@/lib/db/sqlsecurity';
import { buildSubBatchPattern, LIKE_ESCAPE_CLAUSE } from '@/lib/uploads/batch-family';
import ConnectionManager from '@/lib/db/connectionmanager';
import { transactionExecutorFor } from '@/lib/ingestion/bulk-ingestion-call';
import { recordDeletedCoreMeasurementsAudit } from '@/lib/changelog/ingestion-audit';
import ailogger from '@/ailogger';
import { FileRow, SourceFormat } from '@/config/macros/formdetails';
import { toFiniteNumber } from '@/config/measurementerrors';
import { isMissingTableError } from '@/lib/errorhelpers';

export const TEMP_MEASUREMENT_INSERT_BATCH_SIZE = 1000;

export class StagingBatchIDCountMismatchError extends Error {
  readonly code = 'STAGING_BATCH_ID_COUNT_MISMATCH';

  constructor(message: string) {
    super(message);
    this.name = 'StagingBatchIDCountMismatchError';
  }
}

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

/** Returns the rows the server inserted (INSERT IGNORE without ON DUPLICATE KEY counts only inserted rows). */
export async function insertTemporaryMeasurementsInBatches(
  connectionManager: ConnectionManager,
  schema: string,
  rows: FileRow[],
  fileName: string,
  rowBatchIDs: readonly string[],
  sessionId: string | null,
  sourceFormat: SourceFormat,
  plotID: number,
  censusID: number,
  transactionID: string
): Promise<number> {
  if (rowBatchIDs.length !== rows.length) {
    throw new StagingBatchIDCountMismatchError(`Staging ${fileName} received ${rows.length} row(s) but ${rowBatchIDs.length} BatchID(s)`);
  }
  const columnList = TEMPORARY_MEASUREMENT_INSERT_COLUMNS.join(', ');
  const placeholderTuple = `(${TEMPORARY_MEASUREMENT_INSERT_COLUMNS.map(() => '?').join(', ')})`;
  const insertSQLPrefix = format(`INSERT IGNORE INTO ??.temporarymeasurements (${columnList}) VALUES `, [schema]);

  let insertedRows = 0;
  for (let start = 0; start < rows.length; start += TEMP_MEASUREMENT_INSERT_BATCH_SIZE) {
    const slice = rows.slice(start, start + TEMP_MEASUREMENT_INSERT_BATCH_SIZE);
    const placeholders = slice.map(() => placeholderTuple).join(', ');
    const values = slice.flatMap((row, index) =>
      toTemporaryMeasurementInsertValues(
        buildTemporaryMeasurementInsertRecord(row, fileName, rowBatchIDs[start + index], sessionId, sourceFormat, plotID, censusID)
      )
    );
    const insertSQL = `${insertSQLPrefix}${placeholders}`;
    const result = await connectionManager.executeQuery(insertSQL, values, transactionID);
    insertedRows += requireAffectedRows(result, insertSQL);
  }
  return insertedRows;
}

/** True when any row of `batchID`'s family (the batch itself or a `__subNNN` member) is staged for the file. */
export async function familyHasStagedRows(
  connectionManager: ConnectionManager,
  schema: string,
  fileName: string,
  batchID: string,
  transactionID?: string
): Promise<boolean> {
  const existsSQL = safeFormatQuery(
    schema,
    `SELECT 1 AS staged FROM ??.temporarymeasurements
     WHERE FileID = ? AND (BatchID = ? OR BatchID LIKE ? ${LIKE_ESCAPE_CLAUSE})
     LIMIT 1`
  );
  const rows = await connectionManager.executeQuery(existsSQL, [fileName, batchID, buildSubBatchPattern(batchID)], transactionID);
  if (!Array.isArray(rows)) {
    throw new Error(
      `Family staging probe for ${fileName} (batch ${batchID}) expected a row list from the server but got ${JSON.stringify(rows)}; ` +
        `refusing to report the family as not staged.`
    );
  }
  return rows.length > 0;
}

/**
 * The stale-batch DELETE pins this (PlotID, CensusID, FileID, BatchID) index: all
 * three equality predicates are leading columns, so it examines only the
 * file's rows in one plot/census. Measured on 200k staged rows: pinned, a const
 * range; FileID-led ingest_temporarymeasurements_FBPC_index, ~99k rows examined;
 * neither, a full scan. A hint, not FORCE INDEX, so a schema missing the index
 * degrades to a warning.
 */
export const STALE_BATCH_SCAN_INDEX = 'idx_tmpm_plot_census_file_batch';

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
    `DELETE /*+ INDEX(temporarymeasurements ${STALE_BATCH_SCAN_INDEX}) */ FROM ??.temporarymeasurements
     WHERE FileID = ?
       AND PlotID = ?
       AND CensusID = ?
       AND ${buildNotIncomingFamilyPredicate('BatchID')}`,
    [schema]
  );
  const cleanupResult = await connectionManager.executeQuery(cleanupSQL, [fileName, plotID, censusID, batchID, buildSubBatchPattern(batchID)], transactionID);
  const deletedRows = requireAffectedRows(cleanupResult, cleanupSQL);

  if (deletedRows > 0) {
    ailogger.warn(
      `Removed ${deletedRows} stale temporarymeasurement row(s) for ${fileName} before starting batch ${batchID}. ` +
        `This prevents a retry from inheriting abandoned batches for the same plot/census.`
    );
  }

  return deletedRows;
}

/**
 * One bounded window of an ArcGIS commit's unit S0 (#561): staged rows of `fileName` in this plot/census, whatever
 * their batch. At the start of a commit attempt nothing of that attempt is staged yet, so every such row is an earlier
 * attempt's or another batch's stale row. Pinned to the same (PlotID, CensusID, FileID, BatchID) index as the
 * stale-batch delete; the caller loops until a window deletes fewer than `rowLimit`.
 */
export async function deleteStagedRowsForFileWindow(
  connectionManager: ConnectionManager,
  schema: string,
  fileName: string,
  plotID: number,
  censusID: number,
  rowLimit: number,
  transactionID: string
): Promise<number> {
  if (!Number.isSafeInteger(rowLimit) || rowLimit <= 0) {
    throw new RangeError(`Staged-row window limit must be a positive integer; received ${rowLimit}`);
  }
  const deleteSQL = safeFormatQuery(
    schema,
    `DELETE /*+ INDEX(temporarymeasurements ${STALE_BATCH_SCAN_INDEX}) */ FROM ??.temporarymeasurements
     WHERE PlotID = ? AND CensusID = ? AND FileID = ? LIMIT ${rowLimit}`
  );
  return requireAffectedRows(await connectionManager.executeQuery(deleteSQL, [plotID, censusID, fileName], transactionID), deleteSQL);
}

/**
 * Rows a census-replacement statement touches per window, and the longest id
 * list an audited coremeasurements DELETE builds.
 *
 * The bound is the range optimizer's. With use_index_extensions=on every
 * secondary index carries the primary key, so a `CoreMeasurementID IN (...)`
 * list builds a range tree on every index of coremeasurements. Past
 * range_optimizer_max_mem_size (8 MiB default) MySQL raises warning 3170 and
 * plans a full table scan. On the canonical 19-index table, 3,315 ids still
 * plan `range PRIMARY` and 3,316 fall back. The limit tracks indexes x ids of
 * about 63,000-67,000 (issue #555 spec, finding F-1).
 *
 * Azure, read 2026-10-27: the 8 MiB default; 19 indexes in ten schemas, 21 in
 * forestgeo_harvard, forestgeo_mpala and forestgeo_rabi. The limit there is
 * about 3,000 ids, so 1,000 keeps a 3x margin.
 * tests/integration/census-replacement-statement-plans.integration.test.ts
 * asserts no warning 3170 at this size at both index counts.
 *
 * replaceCensusForCleanReupload commits every window separately. Callers that
 * pass their own transaction (the ArcGIS commit via cleanupPreviousFileUploads,
 * the ingest-batch recoveries, record-invalid-rows) still hold every row lock
 * they take until that transaction ends.
 */
export const CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE = 1000;

/**
 * The census window walks this (CensusID, CoreMeasurementID) index in id
 * order. Without the hint, the keyset cursor makes the optimizer switch to a
 * PRIMARY range scan that walks every other census under FOR UPDATE. A hint,
 * not FORCE INDEX, like STALE_BATCH_SCAN_INDEX.
 */
export const CENSUS_REPLACEMENT_SCAN_INDEX = 'idx_censusid';

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
function requireAffectedRows(result: unknown, statementSQL: string): number {
  const affectedRows = (result as { affectedRows?: unknown })?.affectedRows;
  const parsed = Number(affectedRows);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `Statement could not read a row count from the server: affectedRows=${JSON.stringify(affectedRows)} ` +
        `is not a non-negative integer. Statement: ${statementSQL.replace(/\s+/g, ' ').trim().slice(0, 200)}`
    );
  }
  return parsed;
}

async function selectCoreMeasurementWindowIDs(
  connectionManager: ConnectionManager,
  selectIdsSQL: string,
  params: unknown[],
  transactionID: string
): Promise<number[]> {
  const idRows = await connectionManager.executeQuery(selectIdsSQL, params, transactionID);
  return (Array.isArray(idRows) ? idRows : []).map((row: { CoreMeasurementID: number }) => row.CoreMeasurementID);
}

/** Audits exactly `ids`, then deletes exactly `ids`; both counts asserted (#507). */
async function auditAndDeleteCoreMeasurements(
  connectionManager: ConnectionManager,
  schema: string,
  ids: number[],
  changedBy: string | null,
  plotID: number,
  censusID: number,
  transactionID: string
): Promise<number> {
  const tx = transactionExecutorFor(connectionManager, transactionID);
  const auditedCount = await recordDeletedCoreMeasurementsAudit({ tx, schema, coreMeasurementIDs: ids, changedBy, plotID, censusID });
  if (auditedCount !== ids.length) {
    throw new Error(
      `Audit mismatch: selected ${ids.length} coremeasurements row(s) for deletion but only ` +
        `audited ${auditedCount}. Refusing to delete — the audit trail and the data would disagree.`
    );
  }
  const deleteSQL = safeFormatQuery(schema, `DELETE FROM ??.coremeasurements WHERE CoreMeasurementID IN (${buildInPlaceholders(ids.length)})`);
  const deletedRows = requireAffectedRows(await connectionManager.executeQuery(deleteSQL, ids, transactionID), deleteSQL);
  if (deletedRows !== ids.length) {
    throw new Error(
      `Audited delete removed ${deletedRows} coremeasurements row(s) but audited ${ids.length} — ` + `the audit trail and the data would disagree.`
    );
  }
  return deletedRows;
}

/**
 * Bounded like every census-replacement statement, but for coremeasurements
 * only, with a `unifiedchangelog` DELETE-audit row per row removed (#507).
 * Exported so lib/uploads/ingest-batch.ts's stale-failure cleanup can reuse
 * this select-lock-audit-delete sequence instead of duplicating it.
 *
 * Each chunk: SELECT ... FOR UPDATE the chunk's ids (stable ORDER BY, so a
 * reissued `LIMIT n` can't pick a different n rows; FOR UPDATE locks them for
 * the audit read but does not stop a concurrent INSERT matching a LATER
 * chunk), audit via recordDeletedCoreMeasurementsAudit, then DELETE by id —
 * all in the same transaction, so a rollback discards both together.
 *
 * Deliberately does NOT audit the measurement_error_log/failedmeasurements/
 * uploadmetrics deletes elsewhere in cleanupPreviousFileUploads — derivative
 * bookkeeping, reconstructed by the replacement ingestion that follows.
 *
 * `fromSQL` defaults to the plain table (unchanged SQL for the common
 * single-table caller); pass a `??.coremeasurements cm INNER JOIN ...`
 * fragment when `whereSQL` needs other tables — the SELECT then adds
 * `DISTINCT` so a join can't select (and audit) one id twice.
 */
export async function deleteCoreMeasurementsInBoundedChunksWithAudit(
  connectionManager: ConnectionManager,
  schema: string,
  whereSQL: string,
  whereParams: unknown[],
  changedBy: string | null,
  plotID: number,
  censusID: number,
  transactionID: string,
  fromSQL: string = '??.coremeasurements'
): Promise<number> {
  const isJoinedSource = fromSQL !== '??.coremeasurements';
  const idColumnSQL = isJoinedSource ? 'DISTINCT cm.CoreMeasurementID' : 'CoreMeasurementID';
  const orderBySQL = isJoinedSource ? 'cm.CoreMeasurementID' : 'CoreMeasurementID';
  const selectIdsSQL = safeFormatQuery(
    schema,
    `SELECT ${idColumnSQL} FROM ${fromSQL}
     WHERE ${whereSQL}
     ORDER BY ${orderBySQL}
     LIMIT ${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE}
     FOR UPDATE`
  );
  let totalDeleted = 0;

  for (;;) {
    const ids = await selectCoreMeasurementWindowIDs(connectionManager, selectIdsSQL, whereParams, transactionID);
    if (ids.length === 0) return totalDeleted;
    totalDeleted += await auditAndDeleteCoreMeasurements(connectionManager, schema, ids, changedBy, plotID, censusID, transactionID);
    if (ids.length < CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE) return totalDeleted;
  }
}

/** Links first, so the FK cascade has nothing to do and legacy schemas without that FK are cleaned too. */
async function deleteErrorLinksForMeasurements(connectionManager: ConnectionManager, schema: string, ids: number[], transactionID: string): Promise<void> {
  const placeholders = buildInPlaceholders(ids.length);
  try {
    await connectionManager.executeQuery(
      safeFormatQuery(schema, `DELETE FROM ??.measurement_error_log WHERE MeasurementID IN (${placeholders})`),
      ids,
      transactionID
    );
  } catch (error: unknown) {
    if (!isMissingTableError(error, 'measurement_error_log')) throw error;
    await connectionManager.executeQuery(safeFormatQuery(schema, `DELETE FROM ??.cmverrors WHERE CoreMeasurementID IN (${placeholders})`), ids, transactionID);
  }
}

/** The window tail every bounded coremeasurements delete shares: error links, one DELETE-audit row per id, then the ids. */
async function deleteWindowMeasurementsWithLinksAndAudit(
  connectionManager: ConnectionManager,
  schema: string,
  ids: number[],
  changedBy: string | null,
  plotID: number,
  censusID: number,
  transactionID: string
): Promise<number> {
  await deleteErrorLinksForMeasurements(connectionManager, schema, ids, transactionID);
  return auditAndDeleteCoreMeasurements(connectionManager, schema, ids, changedBy, plotID, censusID, transactionID);
}

export interface CensusReplacementChunkResult {
  deletedRows: number;
  /** The cursor after this window: its last id, or the incoming cursor when the window was empty. */
  lastCoreMeasurementID: number;
}

/**
 * One measurement window of a census replacement, in the caller's transaction:
 * lock at most CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE prior ids above
 * `afterCoreMeasurementID`, delete their error links, audit them, delete them.
 * Knows nothing about upload sessions.
 */
export async function deleteCensusReplacementChunk(
  connectionManager: ConnectionManager,
  schema: string,
  currentBatchID: string,
  plotID: number,
  censusID: number,
  afterCoreMeasurementID: number,
  changedBy: string | null,
  transactionID: string
): Promise<CensusReplacementChunkResult> {
  const selectIdsSQL = safeFormatQuery(
    schema,
    `SELECT /*+ INDEX(coremeasurements ${CENSUS_REPLACEMENT_SCAN_INDEX}) */ CoreMeasurementID FROM ??.coremeasurements
     WHERE CensusID = ? AND ${buildNotIncomingFamilyPredicate('UploadBatchID')} AND CoreMeasurementID > ?
     ORDER BY CoreMeasurementID
     LIMIT ${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE}
     FOR UPDATE`
  );
  const ids = await selectCoreMeasurementWindowIDs(
    connectionManager,
    selectIdsSQL,
    [censusID, currentBatchID, buildSubBatchPattern(currentBatchID), afterCoreMeasurementID],
    transactionID
  );
  if (ids.length === 0) return { deletedRows: 0, lastCoreMeasurementID: afterCoreMeasurementID };
  const deletedRows = await deleteWindowMeasurementsWithLinksAndAudit(connectionManager, schema, ids, changedBy, plotID, censusID, transactionID);
  return { deletedRows, lastCoreMeasurementID: ids[ids.length - 1] };
}

/**
 * Unit A's termination rule. A full window moves the cursor past its last id.
 * A short window ends unit A only when it covered the whole scope (cursor 0);
 * otherwise the walk restarts at 0 for one confirming pass, which catches any
 * row the cursor passed over. Returns null when unit A is done.
 */
export function nextCensusReplacementCursor(currentCursor: number, window: CensusReplacementChunkResult): number | null {
  if (window.deletedRows === CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE) return window.lastCoreMeasurementID;
  return currentCursor === 0 ? null : 0;
}

export interface CensusReplacementLegacyPassResult {
  deletedRows: number;
  /** failedmeasurements does not exist in this schema (every schema built from tablestructures.sql). */
  legacyTableMissing: boolean;
}

export async function deleteCensusReplacementLegacyFailuresWindow(
  connectionManager: ConnectionManager,
  schema: string,
  currentBatchID: string,
  censusID: number,
  transactionID: string
): Promise<CensusReplacementLegacyPassResult> {
  const deleteFailedSQL = safeFormatQuery(
    schema,
    `DELETE FROM ??.failedmeasurements
     WHERE CensusID = ? AND ${buildNotIncomingFamilyPredicate('BatchID')}
     LIMIT ${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE}`
  );
  try {
    const result = await connectionManager.executeQuery(deleteFailedSQL, [censusID, currentBatchID, buildSubBatchPattern(currentBatchID)], transactionID);
    return { deletedRows: requireAffectedRows(result, deleteFailedSQL), legacyTableMissing: false };
  } catch (error: unknown) {
    if (!isMissingTableError(error, 'failedmeasurements')) throw error;
    return { deletedRows: 0, legacyTableMissing: true };
  }
}

/** Prior metric rows must go, or the stored procedure's idempotency guard would skip re-ingestion. The incoming family keeps its own. */
export async function deleteCensusReplacementMetricsWindow(
  connectionManager: ConnectionManager,
  schema: string,
  currentBatchID: string,
  plotID: number,
  censusID: number,
  transactionID: string
): Promise<number> {
  const deleteMetricsSQL = safeFormatQuery(
    schema,
    `DELETE FROM ??.uploadmetrics
     WHERE plotID = ? AND censusID = ? AND ${buildNotIncomingFamilyPredicate('batchID')}
     LIMIT ${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE}`
  );
  const result = await connectionManager.executeQuery(
    deleteMetricsSQL,
    [plotID, censusID, currentBatchID, buildSubBatchPattern(currentBatchID)],
    transactionID
  );
  return requireAffectedRows(result, deleteMetricsSQL);
}

/**
 * F0's window walks this (UploadFileID, UploadBatchID, CensusID, StemGUID) index in its own order, so the scan stops
 * after one window. Ordering by CoreMeasurementID instead would force a filesort, and under READ COMMITTED a
 * FOR UPDATE filesort X-locks every family row it reads, not just the window; without the hint the optimizer could
 * also pick idx_censusid and walk the whole census. A hint, not FORCE INDEX, like the other scan indexes here.
 * #562's read-once PRIMARY window primitive is the eventual shared form of this window.
 */
export const BATCH_FAMILY_SCAN_INDEX = 'idx_cm_uploadfile_batch_census_stem';

/**
 * One bounded window of an ArcGIS commit's unit F0 (#561): rows of `fileName` under `batchID`'s family in this census,
 * resolved or not, with their error links and one DELETE-audit row each. The family is derived from the import
 * session's primary key and no other upload can produce it, so before the import is committed every such row is a
 * leftover of an earlier attempt of this import (a dropped-row failure, or staged rows the abandoned-session sweep
 * moved). The caller loops until a window deletes fewer than CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE.
 */
export async function deleteBatchFamilyRowsWindow(
  connectionManager: ConnectionManager,
  schema: string,
  fileName: string,
  batchID: string,
  plotID: number,
  censusID: number,
  changedBy: string | null,
  transactionID: string
): Promise<number> {
  const selectIdsSQL = safeFormatQuery(
    schema,
    `SELECT /*+ INDEX(coremeasurements ${BATCH_FAMILY_SCAN_INDEX}) */ CoreMeasurementID FROM ??.coremeasurements
     WHERE UploadFileID = ? AND (UploadBatchID = ? OR UploadBatchID LIKE ? ${LIKE_ESCAPE_CLAUSE}) AND CensusID = ?
     ORDER BY UploadFileID, UploadBatchID, CensusID, StemGUID, CoreMeasurementID
     LIMIT ${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE}
     FOR UPDATE`
  );
  const ids = await selectCoreMeasurementWindowIDs(
    connectionManager,
    selectIdsSQL,
    [fileName, batchID, buildSubBatchPattern(batchID), censusID],
    transactionID
  );
  if (ids.length === 0) return 0;
  return deleteWindowMeasurementsWithLinksAndAudit(connectionManager, schema, ids, changedBy, plotID, censusID, transactionID);
}

/**
 * Clean up all data from previous uploads for the same plot/census scope.
 * Clean measurement uploads are census replacements: a new upload fully replaces
 * any earlier measurement batches for that census, even if the filename changed.
 *
 * Removes: validation error links, coremeasurements, failedmeasurements (if legacy table exists), uploadmetrics
 *
 * Runs every window in the caller's one transaction, so the row locks of all
 * windows are held until that transaction ends. replaceCensusForCleanReupload
 * is the bounded, separately committed form of the same windows.
 * It has no production caller since the ArcGIS commit moved to bounded units (#561);
 * integration suites keep it as the one-transaction reference.
 *
 * `changedBy` attributes the coremeasurements DELETE audit rows this writes
 * to `unifiedchangelog` (#507). `null` records an unattributed cleanup rather
 * than throwing — see recordDeletedCoreMeasurementsAudit. The derivative
 * measurement_error_log/failedmeasurements/uploadmetrics deletes below are
 * deliberately NOT audited; see deleteCoreMeasurementsInBoundedChunksWithAudit's
 * doc comment for why.
 */
export async function cleanupPreviousFileUploads(
  connectionManager: ConnectionManager,
  schema: string,
  fileName: string,
  currentBatchID: string,
  plotID: number,
  censusID: number,
  changedBy: string | null,
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
  let deletedCmRows = 0;
  let cursor: number | null = 0;
  while (cursor !== null) {
    const window: CensusReplacementChunkResult = await deleteCensusReplacementChunk(
      connectionManager,
      schema,
      currentBatchID,
      plotID,
      censusID,
      cursor,
      changedBy,
      transactionID
    );
    deletedCmRows += window.deletedRows;
    cursor = nextCensusReplacementCursor(cursor, window);
  }

  for (;;) {
    const pass = await deleteCensusReplacementLegacyFailuresWindow(connectionManager, schema, currentBatchID, censusID, transactionID);
    if (pass.legacyTableMissing) {
      ailogger.info(`Skipping failedmeasurements cleanup for ${fileName}: legacy table does not exist in ${schema}`);
      break;
    }
    if (pass.deletedRows < CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE) break;
  }

  for (;;) {
    const deletedMetricRows = await deleteCensusReplacementMetricsWindow(connectionManager, schema, currentBatchID, plotID, censusID, transactionID);
    if (deletedMetricRows < CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE) break;
  }

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
  rowBatchIDs: readonly string[],
  plotID: number,
  censusID: number,
  chunkRows: FileRow[],
  transactionID: string
): Promise<DroppedMeasurementCandidate[]> {
  if (rowBatchIDs.length !== chunkRows.length) {
    throw new StagingBatchIDCountMismatchError(`Dropped-row audit for ${fileName} received ${chunkRows.length} row(s) but ${rowBatchIDs.length} BatchID(s)`);
  }
  const tempTable = 'dropped_row_candidates';
  await connectionManager.executeQuery(`DROP TEMPORARY TABLE IF EXISTS ${tempTable}`, [], transactionID);
  await connectionManager.executeQuery(
    `CREATE TEMPORARY TABLE ${tempTable} (
      RowOrdinal INT NOT NULL PRIMARY KEY,
      BatchID VARCHAR(36) NOT NULL,
      TreeTag VARCHAR(20) NULL,
      StemTag VARCHAR(10) NULL,
      SpeciesCode VARCHAR(25) NULL,
      QuadratName VARCHAR(255) NULL,
      MeasurementDate DATE NULL,
      INDEX idx_dropped_row_candidates_match (TreeTag, StemTag, SpeciesCode, QuadratName, MeasurementDate),
      INDEX idx_dropped_row_candidates_duplicate (TreeTag, StemTag, QuadratName)
    )`,
    [],
    transactionID
  );

  try {
    const insertWidth = 7;
    const insertBatchSize = 500;
    for (let start = 0; start < chunkRows.length; start += insertBatchSize) {
      const slice = chunkRows.slice(start, start + insertBatchSize);
      const placeholders = slice.map(() => `(${Array(insertWidth).fill('?').join(',')})`).join(', ');
      const params = slice.flatMap((row, index) => [
        start + index + 1,
        rowBatchIDs[start + index],
        row.tag ?? null,
        row.stemtag || null,
        row.spcode ?? null,
        row.quadrat ?? null,
        normalizeMeasurementDate(row.date)
      ]);

      await connectionManager.executeQuery(
        `INSERT INTO ${tempTable} (RowOrdinal, BatchID, TreeTag, StemTag, SpeciesCode, QuadratName, MeasurementDate) VALUES ${placeholders}`,
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
        AND tm.BatchID = drc.BatchID
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

    const results = await connectionManager.executeQuery(droppedRowsSQL, [fileName, fileName, plotID, censusID], transactionID);

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
