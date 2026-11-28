import type ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import type { MeasurementScopeInput } from '@/config/editplan/scopeguard';
import { buildMeasurementOverrideEligibleSql } from '@/config/measurementstatefilters';
import { VALIDATION_ERROR_SOURCE } from '@/config/measurementerrors';
import { VALIDATION_SCOPE_SUMMARY_KIND, type ValidationOverrideResult } from '@/config/validationscopeactions';
import {
  CENSUS_OF_PLOT_PREDICATE_SQL,
  censusScopeParams,
  MEASUREMENT_ALIAS,
  readAffectedRows,
  readIsValidatedCounts,
  recordCensusValidationChange,
  SCHEMA_PLACEHOLDER,
  totalMeasurements
} from '@/lib/validations/census-validation-summary';

export interface ValidationOverrideInput extends MeasurementScopeInput {
  /** `unifiedchangelog.ChangedBy`: the signed-in user, never a cookie. */
  changedBy: string;
}

interface OverriddenValidationErrorCount {
  ErrorCode: string;
  Count: number;
}

/** The same predicate the View Data counts use for CountOverridable, so the button and the write never disagree. */
const OVERRIDE_ELIGIBLE_SQL = buildMeasurementOverrideEligibleSql(SCHEMA_PLACEHOLDER, MEASUREMENT_ALIAS);

const READ_OVERRIDDEN_ERROR_COUNTS_SQL = `SELECT me.ErrorCode AS ErrorCode, COUNT(*) AS ErrorCount
      FROM ??.measurement_error_log mel
      JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
      JOIN ??.coremeasurements cm ON mel.MeasurementID = cm.CoreMeasurementID
      JOIN ??.census c ON c.CensusID = cm.CensusID
     WHERE ${CENSUS_OF_PLOT_PREDICATE_SQL}
       AND me.ErrorSource = ?
       AND ${OVERRIDE_ELIGIBLE_SQL}
     GROUP BY me.ErrorCode
     ORDER BY me.ErrorCode`;

// The audit row below is the record of both writes, so the connection logger must not add its own.
const DELETE_OVERRIDDEN_VALIDATION_ERRORS_SQL = `/* skip_changelog */ DELETE mel
      FROM ??.measurement_error_log AS mel
      JOIN ??.measurement_errors AS me ON me.ErrorID = mel.ErrorID
      JOIN ??.coremeasurements AS cm ON mel.MeasurementID = cm.CoreMeasurementID
      JOIN ??.census AS c ON c.CensusID = cm.CensusID
     WHERE ${CENSUS_OF_PLOT_PREDICATE_SQL}
       AND me.ErrorSource = ?
       AND ${OVERRIDE_ELIGIBLE_SQL}`;

const MARK_OVERRIDDEN_MEASUREMENTS_PASSED_SQL = `/* skip_changelog */ UPDATE ??.coremeasurements AS cm
      JOIN ??.census AS c ON c.CensusID = cm.CensusID
       SET cm.IsValidated = TRUE
     WHERE ${CENSUS_OF_PLOT_PREDICATE_SQL}
       AND ${OVERRIDE_ELIGIBLE_SQL}`;

async function readOverriddenValidationErrorCounts(
  cm: ConnectionManager,
  input: ValidationOverrideInput,
  transactionID: string
): Promise<OverriddenValidationErrorCount[]> {
  const rows = await cm.executeQuery(
    safeFormatQuery(input.schema, READ_OVERRIDDEN_ERROR_COUNTS_SQL),
    [...censusScopeParams(input), VALIDATION_ERROR_SOURCE],
    transactionID
  );
  if (!Array.isArray(rows)) throw new Error(`overridden validation error read returned no row set for census ${input.censusID}`);
  return rows.map(row => ({ ErrorCode: String(row.ErrorCode), Count: Number(row.ErrorCount) }));
}

/**
 * Inside the caller's locked-scope transaction, overrides validation for every eligible measurement of the census:
 * a linked measurement (real StemGUID) that has not passed and has no unresolved ingestion-source error. It deletes
 * those rows' validation-source log entries, sets IsValidated = TRUE and writes one Recent Changes summary row with
 * the previous IsValidated split and the deleted error codes. Ingestion failures, ingestion-source log entries and
 * rows that already passed are never touched. With nothing eligible it writes nothing and returns zero counts.
 */
export async function overrideCensusValidations(
  cm: ConnectionManager,
  input: ValidationOverrideInput,
  transactionID: string
): Promise<ValidationOverrideResult> {
  const previous = await readIsValidatedCounts(cm, input, OVERRIDE_ELIGIBLE_SQL, transactionID);
  if (totalMeasurements(previous) === 0) return { overriddenMeasurementCount: 0, removedValidationErrorCount: 0 };

  const overriddenErrors = await readOverriddenValidationErrorCounts(cm, input, transactionID);
  const deleted = await cm.executeQuery(
    safeFormatQuery(input.schema, DELETE_OVERRIDDEN_VALIDATION_ERRORS_SQL),
    [...censusScopeParams(input), VALIDATION_ERROR_SOURCE],
    transactionID
  );
  const removedValidationErrorCount = readAffectedRows(deleted, 'override validation-error DELETE');
  const updated = await cm.executeQuery(safeFormatQuery(input.schema, MARK_OVERRIDDEN_MEASUREMENTS_PASSED_SQL), censusScopeParams(input), transactionID);
  const overriddenMeasurementCount = readAffectedRows(updated, 'override IsValidated UPDATE');

  await recordCensusValidationChange(
    cm,
    input,
    input.changedBy,
    {
      summaryKind: VALIDATION_SCOPE_SUMMARY_KIND.override,
      before: {
        MeasurementCount: totalMeasurements(previous),
        IsValidated: { failed: previous.failed, pending: previous.pending },
        ValidationErrors: overriddenErrors
      },
      after: { MeasurementCount: overriddenMeasurementCount, IsValidated: { passed: overriddenMeasurementCount }, ValidationErrors: [] }
    },
    transactionID
  );
  return { overriddenMeasurementCount, removedValidationErrorCount };
}
