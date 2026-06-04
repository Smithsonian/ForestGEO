import ConnectionManager from '@/config/connectionmanager';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import ailogger from '@/ailogger';

export const INGESTION_ERROR_SOURCE = 'ingestion' as const;
export const VALIDATION_ERROR_SOURCE = 'validation' as const;

export interface IngestionFailureRowInput {
  plotID: number;
  censusID: number;
  tag?: string | null;
  stemTag?: string | null;
  spCode?: string | null;
  quadrat?: string | null;
  x?: number | null;
  y?: number | null;
  dbh?: number | null;
  hom?: number | null;
  date?: string | Date | null;
  codes?: string | null;
  comments?: string | null;
  failureReason?: string | null;
  fileID?: string | null;
  batchID?: string | null;
  sourceRowIndex?: number | null;
}

const INGESTION_ERROR_MESSAGES: Record<string, string> = {
  MISSING_FIELD_TREETAG: 'Missing required field: TreeTag',
  MISSING_FIELD_STEMTAG: 'Missing required field: StemTag',
  MISSING_FIELD_SPECIESCODE: 'Missing required field: SpeciesCode',
  MISSING_FIELD_QUADRATNAME: 'Missing required field: QuadratName',
  MISSING_FIELD_DATE: 'Missing required field: MeasurementDate',
  MISSING_FIELD_LOCALX: 'Missing required field: LocalX',
  MISSING_FIELD_LOCALY: 'Missing required field: LocalY',
  AMBIGUOUS_QUADRAT: 'Quadrat name resolves to multiple active quadrats in the same plot',
  AMBIGUOUS_SPECIES: 'Species code resolves to multiple active species records',
  INVALID_QUADRAT: 'Invalid quadrat reference',
  INVALID_SPECIES: 'Invalid species reference',
  QUADRAT_MISMATCH: 'Quadrat mismatch across censuses',
  COORDINATE_DRIFT: 'Coordinate drift exceeds allowed threshold',
  DUPLICATE_ENTRY: 'Duplicate measurement row detected',
  NEGATIVE_DBH: 'DBH must be non-negative',
  NEGATIVE_HOM: 'HOM must be non-negative',
  MISSING_FIELD_COORDINATES: 'Missing required coordinate fields (lx, ly)',
  INVALID_COORDINATE: 'Coordinate value is negative',
  FIELD_TOO_LONG: 'One or more fields exceed column length limits',
  MISSING_MEASUREMENT_DATA: 'Missing measurement data',
  SQL_EXCEPTION: 'Ingestion SQL exception'
};

export function inferIngestionErrorCode(reason?: string | null): string {
  const codes = inferAllIngestionErrorCodes(reason);
  return codes[0];
}

export function inferAllIngestionErrorCodes(reason?: string | null): string[] {
  const text = (reason || '').toLowerCase();
  const codes: string[] = [];

  if (text.includes('missing required field: treetag') || text.includes('missing treetag')) codes.push('MISSING_FIELD_TREETAG');
  if (text.includes('missing required field: stemtag') || text.includes('missing stemtag')) codes.push('MISSING_FIELD_STEMTAG');
  if (text.includes('missing required field: speciescode') || text.includes('missing speciescode')) codes.push('MISSING_FIELD_SPECIESCODE');
  if (text.includes('missing required field: quadratname') || text.includes('missing quadratname')) codes.push('MISSING_FIELD_QUADRATNAME');
  if (text.includes('missing required field: date') || text.includes('missing date') || text.includes('missing measurementdate')) {
    codes.push('MISSING_FIELD_DATE');
  }
  if (text.includes('ambiguous quadrat')) codes.push('AMBIGUOUS_QUADRAT');
  if (text.includes('ambiguous species')) codes.push('AMBIGUOUS_SPECIES');
  if ((text.includes('invalid quadrat') || text.includes('quadrat name')) && !text.includes('ambiguous quadrat')) codes.push('INVALID_QUADRAT');
  if ((text.includes('invalid species') || text.includes('species code')) && !text.includes('ambiguous species')) codes.push('INVALID_SPECIES');
  if (text.includes('quadrat mismatch')) codes.push('QUADRAT_MISMATCH');
  if (text.includes('coordinate drift')) codes.push('COORDINATE_DRIFT');
  if (text.includes('duplicate')) codes.push('DUPLICATE_ENTRY');
  if (text.includes('invalid dbh') || text.includes('negative dbh')) codes.push('NEGATIVE_DBH');
  if (text.includes('invalid hom') || text.includes('negative hom')) codes.push('NEGATIVE_HOM');
  if (text.includes('missing required fields: lx') || text.includes('missing required fields: ly')) codes.push('MISSING_FIELD_COORDINATES');
  if (text.includes('missing required field: localx')) codes.push('MISSING_FIELD_LOCALX');
  if (text.includes('missing required field: localy')) codes.push('MISSING_FIELD_LOCALY');
  if (text.includes('invalid localx') || text.includes('invalid localy') || text.includes('invalid local')) codes.push('INVALID_COORDINATE');
  if (text.includes('exceeds maximum length') || text.includes('field too long')) codes.push('FIELD_TOO_LONG');
  if (text.includes('missing measurement data')) codes.push('MISSING_MEASUREMENT_DATA');

  if (codes.length === 0) {
    ailogger.warn(`inferAllIngestionErrorCodes: unmapped error pattern defaulting to SQL_EXCEPTION: "${reason}"`);
    codes.push('SQL_EXCEPTION');
  }

  return Array.from(new Set(codes));
}

export function getIngestionErrorMessage(code: string, fallback?: string | null): string {
  return INGESTION_ERROR_MESSAGES[code] || fallback || 'Ingestion error';
}

interface MeasurementErrorInput {
  errorCode: string;
  errorMessage: string;
}

const INGESTION_FAILURE_BULK_INSERT_SIZE = 250;

interface PreparedIngestionFailureRow {
  resultIndex: number;
  row: IngestionFailureRowInput;
  normalizedDate: string | null;
  sourceRowIndex: number;
  errors: MeasurementErrorInput[];
}

export async function ensureMeasurementErrorDefinition(
  connectionManager: ConnectionManager,
  schema: string,
  source: 'ingestion' | 'validation',
  code: string,
  message: string,
  transactionID?: string
): Promise<number> {
  const upsertSQL = safeFormatQuery(
    schema,
    `INSERT INTO ??.measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE ErrorMessage = VALUES(ErrorMessage), ErrorID = LAST_INSERT_ID(ErrorID)`
  );
  const upsertResult: any = await connectionManager.executeQuery(upsertSQL, [source, code, message], transactionID);
  if (upsertResult?.insertId) {
    return upsertResult.insertId;
  }

  const selectSQL = safeFormatQuery(schema, 'SELECT ErrorID FROM ??.measurement_errors WHERE ErrorSource = ? AND ErrorCode = ? LIMIT 1');
  const rows = await connectionManager.executeQuery(selectSQL, [source, code], transactionID);
  const errorID = rows?.[0]?.ErrorID;
  if (!errorID) {
    throw new Error(`Unable to resolve measurement error definition for ${source}:${code}`);
  }
  return errorID;
}

function normalizeDate(date?: string | Date | null): string | null {
  if (!date) return null;
  if (typeof date === 'string') {
    // Accept already normalized YYYY-MM-DD.
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const parsed = new Date(date);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
    return null;
  }
  if (date instanceof Date && !isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }
  return null;
}

export async function resolveMeasurementErrors(
  connectionManager: ConnectionManager,
  schema: string,
  measurementID: number,
  source: 'ingestion' | 'validation',
  transactionID?: string
): Promise<void> {
  const resolveSQL = safeFormatQuery(
    schema,
    `UPDATE ??.measurement_error_log mel
     JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
     SET mel.IsResolved = TRUE,
         mel.ResolvedAt = NOW()
     WHERE mel.MeasurementID = ?
       AND me.ErrorSource = ?
       AND mel.IsResolved = FALSE`
  );

  await connectionManager.executeQuery(resolveSQL, [measurementID, source], transactionID);
}

export async function upsertMeasurementErrors(
  connectionManager: ConnectionManager,
  schema: string,
  measurementID: number,
  source: 'ingestion' | 'validation',
  errors: MeasurementErrorInput[],
  transactionID?: string,
  errorIDCache: Map<string, number> = new Map<string, number>()
): Promise<void> {
  if (errors.length === 0) return;

  const linkSQL = safeFormatQuery(
    schema,
    `INSERT INTO ??.measurement_error_log (MeasurementID, ErrorID, IsResolved, CreatedAt, ResolvedAt)
     VALUES (?, ?, FALSE, NOW(), NULL)
     ON DUPLICATE KEY UPDATE
       IsResolved = FALSE,
       CreatedAt = VALUES(CreatedAt),
       ResolvedAt = NULL`
  );

  for (const { errorCode, errorMessage } of errors) {
    const cacheKey = `${source}:${errorCode}`;
    let errorID = errorIDCache.get(cacheKey);
    if (!errorID) {
      errorID = await ensureMeasurementErrorDefinition(connectionManager, schema, source, errorCode, errorMessage, transactionID);
      errorIDCache.set(cacheKey, errorID);
    }

    await connectionManager.executeQuery(linkSQL, [measurementID, errorID], transactionID);
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildRepeatedRowPattern(rowCount: number, rowPattern: string): string {
  return new Array(rowCount).fill(rowPattern).join(', ');
}

function prepareIngestionFailureRows(rows: IngestionFailureRowInput[]): PreparedIngestionFailureRow[] {
  return rows.map((row, index) => ({
    resultIndex: index,
    row,
    normalizedDate: normalizeDate(row.date),
    sourceRowIndex: row.sourceRowIndex ?? index + 1,
    errors: inferAllIngestionErrorCodes(row.failureReason).map(code => ({
      errorCode: code,
      errorMessage: getIngestionErrorMessage(code, row.failureReason)
    }))
  }));
}

async function resolveIngestionErrorIDCache(
  connectionManager: ConnectionManager,
  schema: string,
  rows: PreparedIngestionFailureRow[],
  transactionID?: string
): Promise<Map<string, number>> {
  const errorIDCache = new Map<string, number>();
  const uniqueErrors = new Map<string, MeasurementErrorInput>();

  for (const row of rows) {
    for (const error of row.errors) {
      if (!uniqueErrors.has(error.errorCode)) {
        uniqueErrors.set(error.errorCode, error);
      }
    }
  }

  for (const [errorCode, error] of uniqueErrors.entries()) {
    const errorID = await ensureMeasurementErrorDefinition(connectionManager, schema, INGESTION_ERROR_SOURCE, errorCode, error.errorMessage, transactionID);
    errorIDCache.set(`${INGESTION_ERROR_SOURCE}:${errorCode}`, errorID);
  }

  return errorIDCache;
}

async function insertPreparedIngestionFailureRowsSequential(
  connectionManager: ConnectionManager,
  schema: string,
  rows: PreparedIngestionFailureRow[],
  transactionID: string | undefined,
  errorIDCache: Map<string, number>
): Promise<Map<number, number>> {
  if (rows.length === 0) return new Map<number, number>();

  const insertedIDs = new Map<number, number>();
  const insertSQL = safeFormatQuery(
    schema,
    `INSERT INTO ??.coremeasurements
      (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description,
       UploadFileID, UploadBatchID, RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, RawComments, SourceRowIndex, IsActive)
     VALUES (?, NULL, FALSE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       CoreMeasurementID = LAST_INSERT_ID(CoreMeasurementID),
       MeasurementDate = VALUES(MeasurementDate),
       MeasuredDBH = VALUES(MeasuredDBH),
       MeasuredHOM = VALUES(MeasuredHOM),
       Description = VALUES(Description),
       UploadFileID = VALUES(UploadFileID),
       UploadBatchID = VALUES(UploadBatchID),
       RawTreeTag = VALUES(RawTreeTag),
       RawStemTag = VALUES(RawStemTag),
       RawSpCode = VALUES(RawSpCode),
       RawQuadrat = VALUES(RawQuadrat),
       RawX = VALUES(RawX),
       RawY = VALUES(RawY),
       RawCodes = VALUES(RawCodes),
       RawComments = VALUES(RawComments),
       IsValidated = FALSE`
  );

  for (const preparedRow of rows) {
    const { row, normalizedDate, sourceRowIndex, errors } = preparedRow;
    const insertResult: any = await connectionManager.executeQuery(
      insertSQL,
      [
        row.censusID,
        normalizedDate,
        row.dbh ?? null,
        row.hom ?? null,
        row.comments ?? null,
        row.fileID ?? null,
        row.batchID ?? null,
        row.tag ?? null,
        row.stemTag ?? null,
        row.spCode ?? null,
        row.quadrat ?? null,
        row.x ?? null,
        row.y ?? null,
        row.codes ?? null,
        row.comments ?? null,
        sourceRowIndex
      ],
      transactionID
    );
    const measurementID = insertResult?.insertId;
    if (!measurementID) {
      continue;
    }
    insertedIDs.set(preparedRow.resultIndex, measurementID);

    await upsertMeasurementErrors(connectionManager, schema, measurementID, INGESTION_ERROR_SOURCE, errors, transactionID, errorIDCache);
  }

  return insertedIDs;
}

async function insertPreparedIngestionFailureRowsBulk(
  connectionManager: ConnectionManager,
  schema: string,
  batchID: string,
  rows: PreparedIngestionFailureRow[],
  transactionID: string | undefined,
  errorIDCache: Map<string, number>
): Promise<Map<number, number>> {
  if (rows.length === 0) return new Map<number, number>();

  const insertedIDs = new Map<number, number>();

  for (const chunk of chunkArray(rows, INGESTION_FAILURE_BULK_INSERT_SIZE)) {
    const insertSQL = safeFormatQuery(
      schema,
      `INSERT INTO ??.coremeasurements
        (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description,
         UploadFileID, UploadBatchID, RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, RawComments, SourceRowIndex, IsActive)
       VALUES ${buildRepeatedRowPattern(chunk.length, '(?, NULL, FALSE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)')}
       ON DUPLICATE KEY UPDATE
         MeasurementDate = VALUES(MeasurementDate),
         MeasuredDBH = VALUES(MeasuredDBH),
         MeasuredHOM = VALUES(MeasuredHOM),
         Description = VALUES(Description),
         UploadFileID = VALUES(UploadFileID),
         UploadBatchID = VALUES(UploadBatchID),
         RawTreeTag = VALUES(RawTreeTag),
         RawStemTag = VALUES(RawStemTag),
         RawSpCode = VALUES(RawSpCode),
         RawQuadrat = VALUES(RawQuadrat),
         RawX = VALUES(RawX),
         RawY = VALUES(RawY),
         RawCodes = VALUES(RawCodes),
         RawComments = VALUES(RawComments),
         SourceRowIndex = VALUES(SourceRowIndex),
         IsValidated = FALSE`
    );

    const insertParams = chunk.flatMap(({ row, normalizedDate, sourceRowIndex }) => [
      row.censusID,
      normalizedDate,
      row.dbh ?? null,
      row.hom ?? null,
      row.comments ?? null,
      row.fileID ?? null,
      row.batchID ?? null,
      row.tag ?? null,
      row.stemTag ?? null,
      row.spCode ?? null,
      row.quadrat ?? null,
      row.x ?? null,
      row.y ?? null,
      row.codes ?? null,
      row.comments ?? null,
      sourceRowIndex
    ]);

    await connectionManager.executeQuery(insertSQL, insertParams, transactionID);

    const rowIndexes = chunk.map(row => row.sourceRowIndex);
    const selectSQL = safeFormatQuery(
      schema,
      `SELECT CoreMeasurementID, SourceRowIndex
       FROM ??.coremeasurements
       WHERE UploadBatchID = ?
         AND SourceRowIndex IN (${rowIndexes.map(() => '?').join(', ')})`
    );
    const measurementRows: Array<{ CoreMeasurementID: number; SourceRowIndex: number }> = await connectionManager.executeQuery(
      selectSQL,
      [batchID, ...rowIndexes],
      transactionID
    );
    const measurementIDBySourceRow = new Map(measurementRows.map(row => [row.SourceRowIndex, row.CoreMeasurementID]));
    const missingRows = chunk.filter(row => !measurementIDBySourceRow.has(row.sourceRowIndex));

    const errorLinkParams: number[] = [];
    const seenErrorLinks = new Set<string>();

    for (const row of chunk) {
      const measurementID = measurementIDBySourceRow.get(row.sourceRowIndex);
      if (!measurementID) {
        continue;
      }

      insertedIDs.set(row.resultIndex, measurementID);

      for (const error of row.errors) {
        const errorID = errorIDCache.get(`${INGESTION_ERROR_SOURCE}:${error.errorCode}`);
        if (!errorID) {
          continue;
        }

        const dedupeKey = `${measurementID}:${errorID}`;
        if (seenErrorLinks.has(dedupeKey)) {
          continue;
        }
        seenErrorLinks.add(dedupeKey);
        errorLinkParams.push(measurementID, errorID);
      }
    }

    if (missingRows.length > 0) {
      for (const [rowIndex, measurementID] of (
        await insertPreparedIngestionFailureRowsSequential(connectionManager, schema, missingRows, transactionID, errorIDCache)
      ).entries()) {
        insertedIDs.set(rowIndex, measurementID);
      }
    }

    if (errorLinkParams.length === 0) {
      continue;
    }

    const errorLinkSQL = safeFormatQuery(
      schema,
      `INSERT INTO ??.measurement_error_log (MeasurementID, ErrorID, IsResolved, CreatedAt, ResolvedAt)
       VALUES ${buildRepeatedRowPattern(errorLinkParams.length / 2, '(?, ?, FALSE, NOW(), NULL)')}
       ON DUPLICATE KEY UPDATE
         IsResolved = FALSE,
         CreatedAt = NOW(),
         ResolvedAt = NULL`
    );
    await connectionManager.executeQuery(errorLinkSQL, errorLinkParams, transactionID);
  }

  return insertedIDs;
}

export async function insertIngestionFailureRows(
  connectionManager: ConnectionManager,
  schema: string,
  rows: IngestionFailureRowInput[],
  transactionID?: string
): Promise<number[]> {
  if (rows.length === 0) return [];

  const preparedRows = prepareIngestionFailureRows(rows);
  const errorIDCache = await resolveIngestionErrorIDCache(connectionManager, schema, preparedRows, transactionID);

  const bulkEligibleRows = new Map<string, PreparedIngestionFailureRow[]>();
  const sequentialRows: PreparedIngestionFailureRow[] = [];

  for (const preparedRow of preparedRows) {
    const batchID = preparedRow.row.batchID;
    if (!batchID?.trim()) {
      sequentialRows.push(preparedRow);
      continue;
    }

    const group = bulkEligibleRows.get(batchID) ?? [];
    group.push(preparedRow);
    bulkEligibleRows.set(batchID, group);
  }

  const insertedIDs: number[] = [];
  const insertedIDByRow = new Map<number, number>();

  for (const [batchID, batchRows] of bulkEligibleRows.entries()) {
    for (const [rowIndex, measurementID] of (
      await insertPreparedIngestionFailureRowsBulk(connectionManager, schema, batchID, batchRows, transactionID, errorIDCache)
    ).entries()) {
      insertedIDByRow.set(rowIndex, measurementID);
    }
  }

  for (const [rowIndex, measurementID] of (
    await insertPreparedIngestionFailureRowsSequential(connectionManager, schema, sequentialRows, transactionID, errorIDCache)
  ).entries()) {
    insertedIDByRow.set(rowIndex, measurementID);
  }

  for (const preparedRow of preparedRows) {
    const measurementID = insertedIDByRow.get(preparedRow.resultIndex);
    if (measurementID) {
      insertedIDs.push(measurementID);
    }
  }

  return insertedIDs;
}

export interface RevalidationResult {
  errorCode: string;
  errorMessage: string;
}

interface FailedRowFields {
  Tag?: string | null;
  StemTag?: string | null;
  SpCode?: string | null;
  Quadrat?: string | null;
  X?: number | null;
  Y?: number | null;
  DBH?: number | null;
  HOM?: number | null;
  Date?: string | null;
  Codes?: string | null;
  Comments?: string | null;
}

const FIELD_LENGTH_LIMITS = {
  TreeTag: 20,
  StemTag: 10,
  SpeciesCode: 25,
  Comments: 255,
  Codes: 255
} as const;

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Validates edited failed-row field values against all ingestion checks
 * (mirrors the stored procedure's early validation and reference validation).
 * Returns ALL applicable errors, not just the first match.
 */
export async function revalidateEditedFailedRow(
  connectionManager: ConnectionManager,
  schema: string,
  censusID: number,
  fields: FailedRowFields,
  transactionID?: string
): Promise<RevalidationResult[]> {
  const errors: RevalidationResult[] = [];
  const isEmpty = (v: string | null | undefined) => !v || String(v).trim() === '';

  // Field-presence checks (mirrors stored procedure early validation)
  if (isEmpty(fields.Tag)) {
    errors.push({ errorCode: 'MISSING_FIELD_TREETAG', errorMessage: INGESTION_ERROR_MESSAGES['MISSING_FIELD_TREETAG'] });
  }
  if (isEmpty(fields.StemTag)) {
    errors.push({ errorCode: 'MISSING_FIELD_STEMTAG', errorMessage: INGESTION_ERROR_MESSAGES['MISSING_FIELD_STEMTAG'] });
  }
  if (isEmpty(fields.SpCode)) {
    errors.push({ errorCode: 'MISSING_FIELD_SPECIESCODE', errorMessage: INGESTION_ERROR_MESSAGES['MISSING_FIELD_SPECIESCODE'] });
  }
  if (isEmpty(fields.Quadrat)) {
    errors.push({ errorCode: 'MISSING_FIELD_QUADRATNAME', errorMessage: INGESTION_ERROR_MESSAGES['MISSING_FIELD_QUADRATNAME'] });
  }
  if (!fields.Date) {
    errors.push({ errorCode: 'MISSING_FIELD_DATE', errorMessage: INGESTION_ERROR_MESSAGES['MISSING_FIELD_DATE'] });
  }

  // Field length checks (mirrors SP column-width validations)
  if (fields.Tag && String(fields.Tag).length > FIELD_LENGTH_LIMITS.TreeTag) {
    errors.push({ errorCode: 'FIELD_TOO_LONG', errorMessage: `TreeTag exceeds maximum length of ${FIELD_LENGTH_LIMITS.TreeTag} characters` });
  }
  if (fields.StemTag && String(fields.StemTag).length > FIELD_LENGTH_LIMITS.StemTag) {
    errors.push({ errorCode: 'FIELD_TOO_LONG', errorMessage: `StemTag exceeds maximum length of ${FIELD_LENGTH_LIMITS.StemTag} characters` });
  }
  if (fields.SpCode && String(fields.SpCode).length > FIELD_LENGTH_LIMITS.SpeciesCode) {
    errors.push({ errorCode: 'FIELD_TOO_LONG', errorMessage: `SpeciesCode exceeds maximum length of ${FIELD_LENGTH_LIMITS.SpeciesCode} characters` });
  }
  if (fields.Comments && String(fields.Comments).length > FIELD_LENGTH_LIMITS.Comments) {
    errors.push({ errorCode: 'FIELD_TOO_LONG', errorMessage: `Comments exceed maximum length of ${FIELD_LENGTH_LIMITS.Comments} characters` });
  }
  if (fields.Codes && String(fields.Codes).length > FIELD_LENGTH_LIMITS.Codes) {
    errors.push({ errorCode: 'FIELD_TOO_LONG', errorMessage: `Codes exceed maximum length of ${FIELD_LENGTH_LIMITS.Codes} characters` });
  }

  // Numeric range checks
  if (fields.DBH != null && Number(fields.DBH) < 0) {
    errors.push({ errorCode: 'NEGATIVE_DBH', errorMessage: INGESTION_ERROR_MESSAGES['NEGATIVE_DBH'] });
  }
  if (fields.HOM != null && Number(fields.HOM) < 0) {
    errors.push({ errorCode: 'NEGATIVE_HOM', errorMessage: INGESTION_ERROR_MESSAGES['NEGATIVE_HOM'] });
  }

  // Negative coordinate checks (mirrors SP: LocalX < 0, LocalY < 0)
  if (fields.X != null && Number(fields.X) < 0) {
    errors.push({ errorCode: 'INVALID_COORDINATE', errorMessage: `Invalid LocalX: ${fields.X} (must be >= 0 or NULL)` });
  }
  if (fields.Y != null && Number(fields.Y) < 0) {
    errors.push({ errorCode: 'INVALID_COORDINATE', errorMessage: `Invalid LocalY: ${fields.Y} (must be >= 0 or NULL)` });
  }

  // Missing measurement data (mirrors SP: DBH=0 AND HOM=0 AND no codes)
  const dbhEmpty = fields.DBH == null || Number(fields.DBH) === 0;
  const homEmpty = fields.HOM == null || Number(fields.HOM) === 0;
  const codesEmpty = !fields.Codes || String(fields.Codes).trim() === '';
  if (dbhEmpty && homEmpty && codesEmpty) {
    errors.push({ errorCode: 'MISSING_MEASUREMENT_DATA', errorMessage: INGESTION_ERROR_MESSAGES['MISSING_MEASUREMENT_DATA'] });
  }

  // Reference checks (require DB lookups, skip if field is empty since missing-field error already covers it)
  if (!isEmpty(fields.Quadrat)) {
    const plotIDQuery = safeFormatQuery(schema, 'SELECT PlotID FROM ??.census WHERE CensusID = ? LIMIT 1');
    const plotRows: any[] = await connectionManager.executeQuery(plotIDQuery, [censusID], transactionID);
    const plotID = plotRows?.[0]?.PlotID;
    if (plotID) {
      const quadratCheckSQL = safeFormatQuery(
        schema,
        'SELECT COUNT(*) as cnt FROM ??.quadrats WHERE LOWER(QuadratName) = LOWER(?) AND PlotID = ? AND IsActive = 1'
      );
      const quadratResult: any[] = await connectionManager.executeQuery(quadratCheckSQL, [String(fields.Quadrat).trim(), plotID], transactionID);
      const quadratCount = Number(quadratResult?.[0]?.cnt ?? 0);
      if (quadratCount === 0) {
        errors.push({ errorCode: 'INVALID_QUADRAT', errorMessage: INGESTION_ERROR_MESSAGES['INVALID_QUADRAT'] });
      } else if (quadratCount > 1) {
        errors.push({ errorCode: 'AMBIGUOUS_QUADRAT', errorMessage: INGESTION_ERROR_MESSAGES['AMBIGUOUS_QUADRAT'] });
      }
    }
  }

  if (!isEmpty(fields.SpCode)) {
    const speciesCheckSQL = safeFormatQuery(schema, 'SELECT COUNT(*) as cnt FROM ??.species WHERE LOWER(SpeciesCode) = LOWER(?) AND IsActive = 1');
    const speciesResult: any[] = await connectionManager.executeQuery(speciesCheckSQL, [String(fields.SpCode).trim()], transactionID);
    const speciesCount = Number(speciesResult?.[0]?.cnt ?? 0);
    if (speciesCount === 0) {
      errors.push({ errorCode: 'INVALID_SPECIES', errorMessage: INGESTION_ERROR_MESSAGES['INVALID_SPECIES'] });
    } else if (speciesCount > 1) {
      errors.push({ errorCode: 'AMBIGUOUS_SPECIES', errorMessage: INGESTION_ERROR_MESSAGES['AMBIGUOUS_SPECIES'] });
    }
  }

  // Cross-census hard-failure checks. These mirror the stored procedure logic
  // used for old trees and must remain unresolved until the edited row no longer
  // conflicts with the latest prior census record for the same TreeTag+StemTag.
  if (!isEmpty(fields.Tag) && !isEmpty(fields.StemTag)) {
    const priorStemSQL = safeFormatQuery(
      schema,
      `SELECT q.QuadratName AS PrevQuadratName,
              s.LocalX AS PrevX,
              s.LocalY AS PrevY
       FROM ??.stems s
       INNER JOIN ??.trees t ON s.TreeID = t.TreeID AND s.CensusID = t.CensusID
       INNER JOIN ??.quadrats q ON s.QuadratID = q.QuadratID
       WHERE t.TreeTag = ?
         AND s.StemTag = ?
         AND t.CensusID < ?
         AND t.IsActive = 1
         AND s.IsActive = 1
       ORDER BY t.CensusID DESC
       LIMIT 1`
    );
    const priorStemRows: any[] = await connectionManager.executeQuery(
      priorStemSQL,
      [String(fields.Tag).trim(), String(fields.StemTag).trim(), censusID],
      transactionID
    );

    const priorStem = priorStemRows?.[0];
    if (priorStem) {
      const currentQuadrat = isEmpty(fields.Quadrat) ? null : String(fields.Quadrat).trim();
      const previousQuadrat = priorStem.PrevQuadratName ? String(priorStem.PrevQuadratName).trim() : null;

      if (currentQuadrat && previousQuadrat && currentQuadrat !== previousQuadrat) {
        errors.push({ errorCode: 'QUADRAT_MISMATCH', errorMessage: INGESTION_ERROR_MESSAGES['QUADRAT_MISMATCH'] });
      } else {
        const currentX = toFiniteNumber(fields.X);
        const currentY = toFiniteNumber(fields.Y);
        const previousX = toFiniteNumber(priorStem.PrevX);
        const previousY = toFiniteNumber(priorStem.PrevY);

        if (currentX !== null && currentY !== null && previousX !== null && previousY !== null && Math.hypot(currentX - previousX, currentY - previousY) > 10) {
          errors.push({ errorCode: 'COORDINATE_DRIFT', errorMessage: INGESTION_ERROR_MESSAGES['COORDINATE_DRIFT'] });
        }
      }
    }
  }

  return errors;
}

export async function refreshIngestionErrorsForMeasurement(
  connectionManager: ConnectionManager,
  schema: string,
  measurementID: number,
  censusID: number,
  fields: FailedRowFields,
  transactionID?: string
): Promise<RevalidationResult[]> {
  const validationErrors = await revalidateEditedFailedRow(connectionManager, schema, censusID, fields, transactionID);

  await resolveMeasurementErrors(connectionManager, schema, measurementID, INGESTION_ERROR_SOURCE, transactionID);
  await upsertMeasurementErrors(connectionManager, schema, measurementID, INGESTION_ERROR_SOURCE, validationErrors, transactionID);

  return validationErrors;
}

export function buildFailedMeasurementsBaseQuery(schema: string): string {
  return `
    FROM ${schema}.coremeasurements cm
    JOIN ${schema}.census c ON c.CensusID = cm.CensusID
    WHERE cm.StemGUID IS NULL
      AND EXISTS (
        SELECT 1
        FROM ${schema}.measurement_error_log mel_exists
        JOIN ${schema}.measurement_errors me_exists ON me_exists.ErrorID = mel_exists.ErrorID
        WHERE mel_exists.MeasurementID = cm.CoreMeasurementID
          AND me_exists.ErrorSource = 'ingestion'
      )
  `;
}

export function buildFailedMeasurementsSelectQuery(schema: string): string {
  return `
    SELECT
      fm.FailedMeasurementID,
      fm.PlotID,
      fm.CensusID,
      fm.Tag,
      fm.StemTag,
      fm.SpCode,
      fm.Quadrat,
      fm.X,
      fm.Y,
      fm.DBH,
      fm.HOM,
      fm.Date,
      fm.Codes,
      fm.Comments,
      fm.Description,
      fm.OriginalFailureReasons,
      fm.CurrentFailureReasons,
      fm.LastValidatedAt,
      COALESCE(fm.CurrentFailureReasons, 'Ready for reingestion') AS FailureReasons,
      fm.FileID,
      fm.BatchID
    FROM (
      SELECT
        cm.CoreMeasurementID AS FailedMeasurementID,
        c.PlotID AS PlotID,
        cm.CensusID AS CensusID,
        cm.RawTreeTag AS Tag,
        cm.RawStemTag AS StemTag,
        cm.RawSpCode AS SpCode,
        cm.RawQuadrat AS Quadrat,
        cm.RawX AS X,
        cm.RawY AS Y,
        cm.MeasuredDBH AS DBH,
        cm.MeasuredHOM AS HOM,
        cm.MeasurementDate AS Date,
        cm.RawCodes AS Codes,
        cm.RawComments AS Comments,
        cm.Description AS Description,
        GROUP_CONCAT(DISTINCT me.ErrorMessage ORDER BY me.ErrorCode SEPARATOR '; ') AS OriginalFailureReasons,
        GROUP_CONCAT(DISTINCT CASE WHEN mel.IsResolved = FALSE THEN me.ErrorMessage END ORDER BY me.ErrorCode SEPARATOR '; ') AS CurrentFailureReasons,
        MAX(COALESCE(mel.ResolvedAt, mel.CreatedAt)) AS LastValidatedAt,
        cm.UploadFileID AS FileID,
        cm.UploadBatchID AS BatchID
      FROM ${schema}.coremeasurements cm
      JOIN ${schema}.census c ON c.CensusID = cm.CensusID
      JOIN ${schema}.measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
      JOIN ${schema}.measurement_errors me ON me.ErrorID = mel.ErrorID AND me.ErrorSource = 'ingestion'
      WHERE cm.StemGUID IS NULL
      GROUP BY cm.CoreMeasurementID, c.PlotID, cm.CensusID, cm.RawTreeTag, cm.RawStemTag,
        cm.RawSpCode, cm.RawQuadrat, cm.RawX, cm.RawY, cm.MeasuredDBH, cm.MeasuredHOM,
        cm.MeasurementDate, cm.RawCodes, cm.RawComments, cm.Description,
        cm.UploadFileID, cm.UploadBatchID
    ) fm
  `;
}
