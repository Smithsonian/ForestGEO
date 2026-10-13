import ConnectionManager from '@/lib/db/connectionmanager';
import { format } from 'mysql2/promise';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { MANAGER_OVERRIDE_ERROR_CODE, MANAGER_OVERRIDE_ERROR_MESSAGE } from '@/config/validationoverride';
import { type MeasurementScopeInput } from '@/config/editplan/scopeguard';
import {
  assertValidMeasurementScope,
  type FormattedQueryRequest,
  lockActiveScope,
  refreshMeasurementViewsInBatches
} from '@/lib/validations/scope-transaction';

/**
 * Ordered statements for overriding every failed or pending row in one plot census.
 * Occurrences are resolved rather than deleted and each overridden row gets a
 * resolved manager-override marker, so the override stays auditable.
 */
function createValidationOverrideQueries(schema: string, plotID: number, censusID: number): FormattedQueryRequest[] {
  const censusScope = `c.PlotID = ? AND c.CensusID = ? AND (cm.IsValidated = FALSE OR cm.IsValidated IS NULL)`;
  return [
    {
      query: `INSERT IGNORE INTO ??.measurement_errors (ErrorSource, ErrorCode, ErrorMessage) VALUES ('validation', ?, ?)`,
      params: [schema, MANAGER_OVERRIDE_ERROR_CODE, MANAGER_OVERRIDE_ERROR_MESSAGE]
    },
    {
      query: `UPDATE ??.measurement_error_log mel
              JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
              JOIN ??.coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
              JOIN ??.census c ON c.CensusID = cm.CensusID
              SET mel.IsResolved = TRUE,
                  mel.ResolvedAt = NOW()
              WHERE me.ErrorSource = 'validation'
                AND mel.IsResolved = FALSE
                AND ${censusScope}`,
      params: [schema, schema, schema, schema, plotID, censusID]
    },
    {
      query: `INSERT INTO ??.measurement_error_log (MeasurementID, ErrorID, IsResolved, ResolvedAt)
              SELECT cm.CoreMeasurementID, me.ErrorID, TRUE, NOW()
              FROM ??.coremeasurements cm
              JOIN ??.census c ON c.CensusID = cm.CensusID
              JOIN ??.measurement_errors me ON me.ErrorSource = 'validation' AND me.ErrorCode = ?
              WHERE ${censusScope}
              ON DUPLICATE KEY UPDATE IsResolved = TRUE, ResolvedAt = NOW()`,
      params: [schema, schema, schema, schema, MANAGER_OVERRIDE_ERROR_CODE, plotID, censusID]
    },
    {
      query: `UPDATE ??.coremeasurements cm
              JOIN ??.census c ON c.CensusID = cm.CensusID
              SET cm.IsValidated = TRUE
              WHERE ${censusScope}`,
      params: [schema, schema, plotID, censusID]
    }
  ];
}

/** The override marker, resolved occurrences, validity, and views commit together. */
export async function overrideValidationScope(cm: ConnectionManager, scope: MeasurementScopeInput): Promise<number> {
  assertValidMeasurementScope(scope);
  return cm.withTransaction(async tx => {
    await lockActiveScope(cm, tx, scope);
    const targets = await tx.query<Array<{ CoreMeasurementID: number }>>(
      safeFormatQuery(
        scope.schema,
        'SELECT CoreMeasurementID FROM ??.coremeasurements WHERE CensusID = ? AND (IsValidated = FALSE OR IsValidated IS NULL) ORDER BY CoreMeasurementID FOR UPDATE'
      ),
      [scope.censusID]
    );
    if (targets.length === 0) return 0;
    let affectedRows = 0;
    for (const step of createValidationOverrideQueries(scope.schema, scope.plotID, scope.censusID)) {
      const result = await tx.query<{ affectedRows: number }>(format(step.query, step.params));
      affectedRows = result.affectedRows;
    }
    await refreshMeasurementViewsInBatches(
      cm,
      scope.schema,
      targets.map(row => row.CoreMeasurementID),
      tx.id
    );
    return affectedRows;
  });
}
