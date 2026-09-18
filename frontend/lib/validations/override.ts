import ConnectionManager from '@/lib/db/connectionmanager';
import { format } from 'mysql2/promise';
import { safeFormatQuery, validateSchemaOrThrow } from '@/lib/db/sqlsecurity';
import { MANAGER_OVERRIDE_ERROR_CODE, MANAGER_OVERRIDE_ERROR_MESSAGE } from '@/config/validationoverride';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';
import { assertNoActiveMeasurementScopeConflict, ScopeAccessError, ScopeBusyError, type MeasurementScopeInput } from '@/config/editplan/scopeguard';
import { refreshMeasurementViewsForCoreMeasurements } from '@/lib/measurementviewrefresh';

// Bound SQL parameters for large overrides; every batch stays in the same transaction.
const OVERRIDE_VIEW_REFRESH_BATCH_SIZE = 1000;

interface FormattedQueryRequest {
  query: string;
  params: unknown[];
}

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
  validateSchemaOrThrow(scope.schema);
  if (!Number.isSafeInteger(scope.plotID) || scope.plotID <= 0 || !Number.isSafeInteger(scope.censusID) || scope.censusID <= 0) {
    throw new ScopeAccessError('A positive plot and census ID are required');
  }
  return cm.withTransaction(async tx => {
    const locked = await cm.acquireApplicationLock(
      buildMeasurementScopeLockName(scope.schema, scope.plotID, scope.censusID),
      tx.id,
      MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS
    );
    if (!locked) throw new ScopeBusyError('A measurement operation is already in progress for this plot/census');
    const census = await tx.query<Array<{ CensusID: number }>>(
      safeFormatQuery(scope.schema, 'SELECT CensusID FROM ??.census WHERE PlotID = ? AND CensusID = ? AND IsActive = TRUE FOR UPDATE'),
      [scope.plotID, scope.censusID]
    );
    if (census.length !== 1) throw new ScopeAccessError('The active census does not belong to the selected plot');
    await assertNoActiveMeasurementScopeConflict(cm, scope, tx.id);
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
    for (let offset = 0; offset < targets.length; offset += OVERRIDE_VIEW_REFRESH_BATCH_SIZE) {
      await refreshMeasurementViewsForCoreMeasurements(
        cm,
        scope.schema,
        targets.slice(offset, offset + OVERRIDE_VIEW_REFRESH_BATCH_SIZE).map(row => row.CoreMeasurementID),
        tx.id
      );
    }
    return affectedRows;
  });
}
