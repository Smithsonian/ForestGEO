import type ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import type { MeasurementScopeInput } from '@/config/editplan/scopeguard';
import { VALIDATION_ERROR_SOURCE } from '@/config/measurementerrors';
import { VALIDATION_SCOPE_SUMMARY_KIND, type ValidationResetResult } from '@/config/validationscopeactions';
import {
  CENSUS_OF_PLOT_PREDICATE_SQL,
  censusScopeParams,
  readAffectedRows,
  readIsValidatedCounts,
  recordCensusValidationChange,
  totalMeasurements
} from '@/lib/validations/census-validation-summary';

export interface ValidationResetInput extends MeasurementScopeInput {
  /** `unifiedchangelog.ChangedBy`: the signed-in user, never a cookie. */
  changedBy: string;
}

// The audit row below is the record of both writes, so the connection logger must not add its own.
const RESOLVE_UNRESOLVED_VALIDATION_ERRORS_SQL = `/* skip_changelog */ UPDATE ??.measurement_error_log mel
      JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
      JOIN ??.coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
      JOIN ??.census c ON c.CensusID = cm.CensusID
       SET mel.IsResolved = TRUE,
           mel.ResolvedAt = NOW()
     WHERE ${CENSUS_OF_PLOT_PREDICATE_SQL}
       AND me.ErrorSource = ?
       AND mel.IsResolved = FALSE`;

const MARK_CENSUS_MEASUREMENTS_PENDING_SQL = `/* skip_changelog */ UPDATE ??.coremeasurements cm
      JOIN ??.census c ON c.CensusID = cm.CensusID
       SET cm.IsValidated = NULL
     WHERE ${CENSUS_OF_PLOT_PREDICATE_SQL}`;

/**
 * Inside the caller's locked-scope transaction, sends every measurement of the census back to pending: it marks each
 * unresolved validation-source log entry resolved (ResolvedAt = NOW(), so the history stays), sets IsValidated = NULL
 * on every row of the census and writes one Recent Changes summary row with the previous IsValidated split. Ingestion
 * -source entries stay unresolved, so ingestion failures still show as failures. An empty census writes nothing.
 */
export async function resetCensusValidations(cm: ConnectionManager, input: ValidationResetInput, transactionID: string): Promise<ValidationResetResult> {
  const previous = await readIsValidatedCounts(cm, input, null, transactionID);
  if (totalMeasurements(previous) === 0) return { resetMeasurementCount: 0, resolvedValidationErrorCount: 0 };

  const resolved = await cm.executeQuery(
    safeFormatQuery(input.schema, RESOLVE_UNRESOLVED_VALIDATION_ERRORS_SQL),
    [...censusScopeParams(input), VALIDATION_ERROR_SOURCE],
    transactionID
  );
  const resolvedValidationErrorCount = readAffectedRows(resolved, 'reset validation-error UPDATE');
  const updated = await cm.executeQuery(safeFormatQuery(input.schema, MARK_CENSUS_MEASUREMENTS_PENDING_SQL), censusScopeParams(input), transactionID);
  const resetMeasurementCount = readAffectedRows(updated, 'reset IsValidated UPDATE');

  await recordCensusValidationChange(
    cm,
    input,
    input.changedBy,
    {
      summaryKind: VALIDATION_SCOPE_SUMMARY_KIND.reset,
      before: { MeasurementCount: totalMeasurements(previous), IsValidated: previous, UnresolvedValidationErrorCount: resolvedValidationErrorCount },
      after: { MeasurementCount: resetMeasurementCount, IsValidated: { pending: resetMeasurementCount }, UnresolvedValidationErrorCount: 0 }
    },
    transactionID
  );
  return { resetMeasurementCount, resolvedValidationErrorCount };
}
