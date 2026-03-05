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
  INVALID_QUADRAT: 'Invalid quadrat reference',
  INVALID_SPECIES: 'Invalid species reference',
  QUADRAT_MISMATCH: 'Quadrat mismatch across censuses',
  COORDINATE_DRIFT: 'Coordinate drift exceeds allowed threshold',
  DUPLICATE_ENTRY: 'Duplicate measurement row detected',
  NEGATIVE_DBH: 'DBH must be non-negative',
  NEGATIVE_HOM: 'HOM must be non-negative',
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
  if (text.includes('missing required field: date') || text.includes('missing date') || text.includes('missing measurementdate')) codes.push('MISSING_FIELD_DATE');
  if (text.includes('invalid quadrat') || text.includes('quadrat name')) codes.push('INVALID_QUADRAT');
  if (text.includes('invalid species') || text.includes('species code')) codes.push('INVALID_SPECIES');
  if (text.includes('quadrat mismatch')) codes.push('QUADRAT_MISMATCH');
  if (text.includes('coordinate drift')) codes.push('COORDINATE_DRIFT');
  if (text.includes('duplicate')) codes.push('DUPLICATE_ENTRY');
  if (text.includes('invalid dbh') || text.includes('negative dbh')) codes.push('NEGATIVE_DBH');
  if (text.includes('invalid hom') || text.includes('negative hom')) codes.push('NEGATIVE_HOM');
  if (text.includes('invalid localx') || text.includes('invalid localy') || text.includes('invalid local')) codes.push('INVALID_COORDINATE');
  if (text.includes('exceeds maximum length') || text.includes('field too long')) codes.push('FIELD_TOO_LONG');
  if (text.includes('missing measurement data')) codes.push('MISSING_MEASUREMENT_DATA');

  if (codes.length === 0) {
    ailogger.warn(`inferAllIngestionErrorCodes: unmapped error pattern defaulting to SQL_EXCEPTION: "${reason}"`);
    codes.push('SQL_EXCEPTION');
  }

  return codes;
}

export function getIngestionErrorMessage(code: string, fallback?: string | null): string {
  return INGESTION_ERROR_MESSAGES[code] || fallback || 'Ingestion error';
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

export async function insertIngestionFailureRows(
  connectionManager: ConnectionManager,
  schema: string,
  rows: IngestionFailureRowInput[],
  transactionID?: string
): Promise<number[]> {
  if (rows.length === 0) return [];

  const insertedIDs: number[] = [];
  const errorIDCache = new Map<string, number>();
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
  const linkSQL = safeFormatQuery(schema, 'INSERT IGNORE INTO ??.measurement_error_log (MeasurementID, ErrorID, IsResolved) VALUES (?, ?, FALSE)');

  for (const [index, row] of rows.entries()) {
    const normalizedDate = normalizeDate(row.date);
    const sourceRowIndex = row.sourceRowIndex ?? index + 1;
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
    insertedIDs.push(measurementID);

    const code = inferIngestionErrorCode(row.failureReason);
    const cacheKey = `${INGESTION_ERROR_SOURCE}:${code}`;
    let errorID = errorIDCache.get(cacheKey);
    if (!errorID) {
      errorID = await ensureMeasurementErrorDefinition(
        connectionManager,
        schema,
        INGESTION_ERROR_SOURCE,
        code,
        getIngestionErrorMessage(code, row.failureReason),
        transactionID
      );
      errorIDCache.set(cacheKey, errorID);
    }

    await connectionManager.executeQuery(linkSQL, [measurementID, errorID], transactionID);
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
      const quadratCheckSQL = safeFormatQuery(schema, 'SELECT COUNT(*) as cnt FROM ??.quadrats WHERE QuadratName = ? AND PlotID = ?');
      const quadratResult: any[] = await connectionManager.executeQuery(quadratCheckSQL, [String(fields.Quadrat).trim(), plotID], transactionID);
      if (quadratResult?.[0]?.cnt === 0) {
        errors.push({ errorCode: 'INVALID_QUADRAT', errorMessage: INGESTION_ERROR_MESSAGES['INVALID_QUADRAT'] });
      }
    }
  }

  if (!isEmpty(fields.SpCode)) {
    const speciesCheckSQL = safeFormatQuery(schema, 'SELECT COUNT(*) as cnt FROM ??.species WHERE SpeciesCode = ?');
    const speciesResult: any[] = await connectionManager.executeQuery(speciesCheckSQL, [String(fields.SpCode).trim()], transactionID);
    if (speciesResult?.[0]?.cnt === 0) {
      errors.push({ errorCode: 'INVALID_SPECIES', errorMessage: INGESTION_ERROR_MESSAGES['INVALID_SPECIES'] });
    }
  }

  return errors;
}

export function buildFailedMeasurementsBaseQuery(schema: string): string {
  return `
    FROM ${schema}.coremeasurements cm
    JOIN ${schema}.census c ON c.CensusID = cm.CensusID
    JOIN ${schema}.measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
    JOIN ${schema}.measurement_errors me ON me.ErrorID = mel.ErrorID
    WHERE cm.StemGUID IS NULL
      AND me.ErrorSource = 'ingestion'
      AND mel.IsResolved = FALSE
  `;
}

export function buildFailedMeasurementsSelectQuery(schema: string): string {
  return `
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
      (SELECT GROUP_CONCAT(DISTINCT me_all.ErrorMessage ORDER BY me_all.ErrorCode SEPARATOR '; ')
       FROM ${schema}.measurement_error_log mel_all
       JOIN ${schema}.measurement_errors me_all ON me_all.ErrorID = mel_all.ErrorID
       WHERE mel_all.MeasurementID = cm.CoreMeasurementID
         AND me_all.ErrorSource = 'ingestion'
      ) AS OriginalFailureReasons,
      (SELECT GROUP_CONCAT(DISTINCT me_cur.ErrorMessage ORDER BY me_cur.ErrorCode SEPARATOR '; ')
       FROM ${schema}.measurement_error_log mel_cur
       JOIN ${schema}.measurement_errors me_cur ON me_cur.ErrorID = mel_cur.ErrorID
       WHERE mel_cur.MeasurementID = cm.CoreMeasurementID
         AND me_cur.ErrorSource = 'ingestion'
         AND mel_cur.IsResolved = FALSE
      ) AS CurrentFailureReasons,
      (SELECT GROUP_CONCAT(DISTINCT me_cur2.ErrorMessage ORDER BY me_cur2.ErrorCode SEPARATOR '; ')
       FROM ${schema}.measurement_error_log mel_cur2
       JOIN ${schema}.measurement_errors me_cur2 ON me_cur2.ErrorID = mel_cur2.ErrorID
       WHERE mel_cur2.MeasurementID = cm.CoreMeasurementID
         AND me_cur2.ErrorSource = 'ingestion'
         AND mel_cur2.IsResolved = FALSE
      ) AS FailureReasons,
      MAX(mel.CreatedAt) AS LastValidatedAt,
      cm.UploadFileID AS FileID,
      cm.UploadBatchID AS BatchID
    ${buildFailedMeasurementsBaseQuery(schema)}
    GROUP BY
      cm.CoreMeasurementID, c.PlotID, cm.CensusID,
      cm.RawTreeTag, cm.RawStemTag, cm.RawSpCode, cm.RawQuadrat,
      cm.RawX, cm.RawY, cm.MeasuredDBH, cm.MeasuredHOM, cm.MeasurementDate,
      cm.RawCodes, cm.RawComments, cm.UploadFileID, cm.UploadBatchID
  `;
}
