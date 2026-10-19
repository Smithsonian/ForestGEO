import ConnectionManager from '@/lib/db/connectionmanager';
import { format } from 'mysql2/promise';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { MANAGER_OVERRIDE_ERROR_CODE } from '@/config/validationoverride';
import { ScopeAccessError, type MeasurementScopeInput } from '@/config/editplan/scopeguard';
import { refreshMeasurementViewsForCoreMeasurements } from '@/lib/measurementviewrefresh';
import {
  assertValidMeasurementScope,
  type FormattedQueryRequest,
  lockActiveScope,
  refreshMeasurementViewsInBatches
} from '@/lib/validations/scope-transaction';

// Validation only ever finalizes active rows with a resolved stem, so only those may be put back to pending.
const REVALIDATABLE_ROW_CLAUSE = 'cm.IsActive = TRUE AND cm.StemGUID IS NOT NULL';

export type RecheckMeasurementScope = MeasurementScopeInput & { coreMeasurementID: number };

/**
 * Resolves every unresolved *validation* occurrence in `scopeClause`, excluding
 * the manager-override marker. Used by both reset (census-wide clause) and
 * recheck (single-row clause) so the resolve semantics never drift between them.
 */
function buildResolveValidationOccurrencesStep(schema: string, scopeClause: string, scopeParams: unknown[]): FormattedQueryRequest {
  return {
    query: `UPDATE ??.measurement_error_log mel
            JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
            JOIN ??.coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
            SET mel.IsResolved = TRUE,
                mel.ResolvedAt = NOW()
            WHERE me.ErrorSource = 'validation'
              AND me.ErrorCode <> ?
              AND mel.IsResolved = FALSE
              AND ${scopeClause}`,
    params: [schema, schema, schema, MANAGER_OVERRIDE_ERROR_CODE, ...scopeParams]
  };
}

/** Marks every row in `scopeClause` pending. No filter on the prior value: every row in scope is reset. */
function buildResetIsValidatedStep(schema: string, scopeClause: string, scopeParams: unknown[]): FormattedQueryRequest {
  return {
    query: `UPDATE ??.coremeasurements cm
            SET cm.IsValidated = NULL
            WHERE ${scopeClause}`,
    params: [schema, ...scopeParams]
  };
}

/**
 * Marks every active, stem-resolved row in the selected plot+active census pending
 * and resolves their unresolved validation occurrences, leaving ingestion
 * occurrences and the manager-override marker alone. Parked ingestion failures
 * (StemGUID = NULL) and inactive rows are skipped: validation never finalizes
 * them, so resetting them would leave them pending forever.
 */
export async function resetValidationScope(cm: ConnectionManager, scope: MeasurementScopeInput): Promise<number> {
  assertValidMeasurementScope(scope);

  return cm.withTransaction(async tx => {
    await lockActiveScope(cm, tx, scope);

    const censusScopeClause = `cm.CensusID = ? AND ${REVALIDATABLE_ROW_CLAUSE}`;
    const targets = await tx.query<Array<{ CoreMeasurementID: number }>>(
      safeFormatQuery(
        scope.schema,
        `SELECT cm.CoreMeasurementID FROM ??.coremeasurements cm WHERE ${censusScopeClause} ORDER BY cm.CoreMeasurementID FOR UPDATE`
      ),
      [scope.censusID]
    );
    if (targets.length === 0) return 0;

    const resolveStep = buildResolveValidationOccurrencesStep(scope.schema, censusScopeClause, [scope.censusID]);
    await tx.query(format(resolveStep.query, resolveStep.params));

    const resetStep = buildResetIsValidatedStep(scope.schema, censusScopeClause, [scope.censusID]);
    await tx.query(format(resetStep.query, resetStep.params));

    await refreshMeasurementViewsInBatches(
      cm,
      scope.schema,
      targets.map(row => row.CoreMeasurementID),
      tx.id
    );
    return targets.length;
  });
}

/**
 * Marks a single measurement pending and resolves its unresolved validation
 * occurrences, scoped to the selected active census+plot. Clears every
 * unresolved validation error on the row (not a single selected error), and
 * does not run scientific validation synchronously. Rejects with
 * ScopeAccessError if the row is missing, belongs to a different
 * census/plot, is inactive, or is a parked ingestion failure, before any
 * mutation.
 */
export async function recheckMeasurementValidation(cm: ConnectionManager, scope: RecheckMeasurementScope): Promise<number> {
  assertValidMeasurementScope(scope);
  if (!Number.isSafeInteger(scope.coreMeasurementID) || scope.coreMeasurementID <= 0) {
    throw new ScopeAccessError('A positive measurement ID is required');
  }

  return cm.withTransaction(async tx => {
    await lockActiveScope(cm, tx, scope);

    const targets = await tx.query<Array<{ CoreMeasurementID: number }>>(
      safeFormatQuery(
        scope.schema,
        `SELECT cm.CoreMeasurementID
         FROM ??.coremeasurements cm
         WHERE cm.CensusID = ? AND cm.CoreMeasurementID = ? AND ${REVALIDATABLE_ROW_CLAUSE}
         FOR UPDATE`
      ),
      [scope.censusID, scope.coreMeasurementID]
    );
    if (targets.length !== 1) throw new ScopeAccessError('The measurement does not belong to the selected plot/census');

    const rowScopeClause = 'cm.CoreMeasurementID = ? AND cm.CensusID = ?';
    const rowScopeParams = [scope.coreMeasurementID, scope.censusID];

    const resolveStep = buildResolveValidationOccurrencesStep(scope.schema, rowScopeClause, rowScopeParams);
    await tx.query(format(resolveStep.query, resolveStep.params));

    const resetStep = buildResetIsValidatedStep(scope.schema, rowScopeClause, rowScopeParams);
    await tx.query(format(resetStep.query, resetStep.params));

    await refreshMeasurementViewsForCoreMeasurements(cm, scope.schema, [scope.coreMeasurementID], tx.id);
    return 1;
  });
}
