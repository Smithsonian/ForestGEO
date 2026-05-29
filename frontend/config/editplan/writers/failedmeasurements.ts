// failedmeasurements writer — applies a single-row edit that the analyzer
// has already validated.
//
// Ported from `frontend/config/macros/coreapifunctions.ts::PATCH` (the
// `dataType === 'failedmeasurements'` branch, roughly lines 417–494). The
// legacy PATCH handler is still in place for other dataTypes but will be
// removed by Task 18.
//
// Failed rows are "hard-failed" coremeasurements rows with `StemGUID IS NULL`.
// They never resolve to trees/stems/cmattributes — edits only touch the raw
// staging columns and the measurement error log. The writer runs INSIDE an
// outer transaction and MUST NOT begin, commit, or rollback.
import ConnectionManager from '@/config/connectionmanager';
import { EditPlan } from '../types';
import type { ApplyInTransactionInput } from '../apply';
import type { EditOperationStateRow } from '@/config/editoperations';
import { refreshIngestionErrorsForMeasurement } from '@/config/measurementerrors';
import type { WriterResult } from './measurementssummary';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

function normalizeFailedRowDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'string') {
    if (!value.includes('T')) return value;
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
    return null;
  }
  return null;
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickCanonical<T>(
  changedFields: Set<string>,
  newValues: Record<string, unknown>,
  currentRow: Record<string, unknown>,
  field: string,
  rawColumn: string,
  coerce: (value: unknown) => T
): T {
  if (changedFields.has(field)) return coerce(newValues[field]);
  return coerce(currentRow[rawColumn]);
}

function toOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return String(value);
}

async function loadFailedRow(cm: ConnectionManager, schema: string, coreMeasurementID: number, transactionID: string): Promise<Record<string, unknown>> {
  const rows = await cm.executeQuery(
    safeFormatQuery(schema, `SELECT * FROM ??.coremeasurements WHERE CoreMeasurementID = ? AND StemGUID IS NULL LIMIT 1`),
    [coreMeasurementID],
    transactionID
  );
  if (!rows.length) {
    throw new Error(`failedmeasurements writer: row ${coreMeasurementID} not found or StemGUID is not NULL`);
  }
  return rows[0] as Record<string, unknown>;
}

function buildStateRow(table: string, primaryKey: string, primaryKeyValue: string | number, row: Record<string, unknown> | null): EditOperationStateRow {
  return { table, primaryKey, primaryKeyValue, row };
}

export async function writeFailedMeasurements(cm: ConnectionManager, input: ApplyInTransactionInput, plan: EditPlan, txID: string): Promise<WriterResult> {
  const { schema, censusID, targetID } = input;
  const coreMeasurementID = Number(targetID);

  const changedFields = new Set<string>(plan.fieldChanges.map(fc => fc.field));
  const newValues: Record<string, unknown> = {};
  for (const { field, to } of plan.fieldChanges) {
    newValues[field] = to;
  }

  const beforeRow = await loadFailedRow(cm, schema, coreMeasurementID, txID);

  const resolvedTag = pickCanonical(changedFields, newValues, beforeRow, 'Tag', 'RawTreeTag', toOptionalString);
  const resolvedStemTag = pickCanonical(changedFields, newValues, beforeRow, 'StemTag', 'RawStemTag', toOptionalString);
  const resolvedSpCode = pickCanonical(changedFields, newValues, beforeRow, 'SpCode', 'RawSpCode', toOptionalString);
  const resolvedQuadrat = pickCanonical(changedFields, newValues, beforeRow, 'Quadrat', 'RawQuadrat', toOptionalString);
  const resolvedX = pickCanonical(changedFields, newValues, beforeRow, 'X', 'RawX', toOptionalNumber);
  const resolvedY = pickCanonical(changedFields, newValues, beforeRow, 'Y', 'RawY', toOptionalNumber);
  const resolvedDBH = pickCanonical(changedFields, newValues, beforeRow, 'DBH', 'MeasuredDBH', toOptionalNumber);
  const resolvedHOM = pickCanonical(changedFields, newValues, beforeRow, 'HOM', 'MeasuredHOM', toOptionalNumber);

  const rawDateValue = changedFields.has('Date') ? newValues.Date : beforeRow.MeasurementDate;
  const resolvedDate = normalizeFailedRowDate(rawDateValue);

  const resolvedCodes = pickCanonical(changedFields, newValues, beforeRow, 'Codes', 'RawCodes', toOptionalString);
  const resolvedComments = pickCanonical(changedFields, newValues, beforeRow, 'Comments', 'RawComments', toOptionalString);

  // Description mirrors RawComments on write (legacy PATCH passed Comments twice:
  // once for RawComments, once for Description). Revalidation may overwrite it
  // below with concatenated error messages.
  const initialDescription = resolvedComments;

  // UploadFileID / UploadBatchID are intentionally not in the failedmeasurements
  // allowlist (fieldpolicy.ts), so rejectDisallowedFields blocks any caller from
  // supplying them. A failed-measurement edit preserves the original upload
  // provenance columns untouched.
  const updateQuery = safeFormatQuery(
    schema,
    `UPDATE ??.coremeasurements
     SET RawTreeTag = ?, RawStemTag = ?, RawSpCode = ?, RawQuadrat = ?,
         RawX = ?, RawY = ?, MeasuredDBH = ?, MeasuredHOM = ?, MeasurementDate = ?,
         RawCodes = ?, RawComments = ?, Description = ?,
         IsValidated = FALSE
     WHERE CoreMeasurementID = ? AND StemGUID IS NULL`
  );
  await cm.executeQuery(
    updateQuery,
    [
      resolvedTag,
      resolvedStemTag,
      resolvedSpCode,
      resolvedQuadrat,
      resolvedX,
      resolvedY,
      resolvedDBH,
      resolvedHOM,
      resolvedDate,
      resolvedCodes,
      resolvedComments,
      initialDescription,
      coreMeasurementID
    ],
    txID
  );

  const effectiveCensusID = Number(beforeRow.CensusID ?? censusID);
  const validationErrors = await refreshIngestionErrorsForMeasurement(
    cm,
    schema,
    coreMeasurementID,
    effectiveCensusID,
    {
      Tag: resolvedTag,
      StemTag: resolvedStemTag,
      SpCode: resolvedSpCode,
      Quadrat: resolvedQuadrat,
      X: resolvedX,
      Y: resolvedY,
      DBH: resolvedDBH,
      HOM: resolvedHOM,
      Date: resolvedDate,
      Codes: resolvedCodes,
      Comments: resolvedComments
    },
    txID
  );

  if (validationErrors.length > 0) {
    const descriptionText = validationErrors.map(e => e.errorMessage).join('; ');
    const updateDescQuery = safeFormatQuery(schema, 'UPDATE ??.coremeasurements SET Description = ? WHERE CoreMeasurementID = ?');
    await cm.executeQuery(updateDescQuery, [descriptionText, coreMeasurementID], txID);
  }

  const afterRow = await loadFailedRow(cm, schema, coreMeasurementID, txID);

  const beforeState: EditOperationStateRow[] = [buildStateRow('coremeasurements', 'CoreMeasurementID', coreMeasurementID, beforeRow)];
  const afterState: EditOperationStateRow[] = [buildStateRow('coremeasurements', 'CoreMeasurementID', coreMeasurementID, afterRow)];

  return {
    updatedIDs: { CoreMeasurementID: coreMeasurementID },
    beforeState,
    afterState,
    validationPending: true,
    postValidation: undefined
  };
}
