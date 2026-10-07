import ConnectionManager, { type TxExecutor } from '@/lib/db/connectionmanager';
import { format } from 'mysql2/promise';
import { safeFormatQuery, validateSchemaOrThrow } from '@/lib/db/sqlsecurity';
import { MANAGER_OVERRIDE_ERROR_CODE } from '@/config/validationoverride';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';
import { assertNoActiveMeasurementScopeConflict, ScopeAccessError, ScopeBusyError, type MeasurementScopeInput } from '@/config/editplan/scopeguard';
import { refreshMeasurementViewsForCoreMeasurements } from '@/lib/measurementviewrefresh';

// Bound SQL parameters for large resets; every batch stays in the same transaction.
const VALIDATION_RESET_VIEW_REFRESH_BATCH_SIZE = 1000;

export type RecheckMeasurementScope = MeasurementScopeInput & { coreMeasurementID: number };

interface FormattedQueryRequest {
  query: string;
  params: unknown[];
}

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

async function assertActiveScope(cm: ConnectionManager, tx: TxExecutor, scope: MeasurementScopeInput): Promise<void> {
  const census = await tx.query<Array<{ CensusID: number }>>(
    safeFormatQuery(scope.schema, 'SELECT CensusID FROM ??.census WHERE PlotID = ? AND CensusID = ? AND IsActive = TRUE FOR UPDATE'),
    [scope.plotID, scope.censusID]
  );
  if (census.length !== 1) {
    throw new ScopeAccessError('The active census does not belong to the selected plot');
  }
  await assertNoActiveMeasurementScopeConflict(cm, scope, tx.id);
}

async function acquireScopeLockOrThrow(cm: ConnectionManager, scope: MeasurementScopeInput, transactionID: string): Promise<void> {
  const locked = await cm.acquireApplicationLock(
    buildMeasurementScopeLockName(scope.schema, scope.plotID, scope.censusID),
    transactionID,
    MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS
  );
  if (!locked) throw new ScopeBusyError('A measurement operation is already in progress for this plot/census');
}

function assertValidMeasurementScope(scope: MeasurementScopeInput): void {
  validateSchemaOrThrow(scope.schema);
  if (!Number.isSafeInteger(scope.plotID) || scope.plotID <= 0 || !Number.isSafeInteger(scope.censusID) || scope.censusID <= 0) {
    throw new ScopeAccessError('A positive plot and census ID are required');
  }
}

/**
 * Marks every row in the selected plot+active census pending (IsValidated = NULL)
 * and resolves their unresolved validation occurrences — never deletes them, and
 * never touches ingestion occurrences or the manager-override marker. Returns the
 * number of coremeasurements rows reset (0 for an empty, otherwise-valid census).
 *
 * This does NOT repair parked ingestion failures (coremeasurements rows with
 * StemGUID = NULL): those still need the existing Failed Measurements
 * correction/reingestion flow.
 */
export async function resetValidationScope(cm: ConnectionManager, scope: MeasurementScopeInput): Promise<number> {
  assertValidMeasurementScope(scope);

  return cm.withTransaction(async tx => {
    await acquireScopeLockOrThrow(cm, scope, tx.id);
    await assertActiveScope(cm, tx, scope);

    const targets = await tx.query<Array<{ CoreMeasurementID: number }>>(
      safeFormatQuery(scope.schema, 'SELECT CoreMeasurementID FROM ??.coremeasurements WHERE CensusID = ? ORDER BY CoreMeasurementID FOR UPDATE'),
      [scope.censusID]
    );
    if (targets.length === 0) return 0;

    const resolveStep = buildResolveValidationOccurrencesStep(scope.schema, 'cm.CensusID = ?', [scope.censusID]);
    await tx.query(format(resolveStep.query, resolveStep.params));

    const resetStep = buildResetIsValidatedStep(scope.schema, 'cm.CensusID = ?', [scope.censusID]);
    await tx.query(format(resetStep.query, resetStep.params));

    for (let offset = 0; offset < targets.length; offset += VALIDATION_RESET_VIEW_REFRESH_BATCH_SIZE) {
      await refreshMeasurementViewsForCoreMeasurements(
        cm,
        scope.schema,
        targets.slice(offset, offset + VALIDATION_RESET_VIEW_REFRESH_BATCH_SIZE).map(row => row.CoreMeasurementID),
        tx.id
      );
    }
    return targets.length;
  });
}

/**
 * Marks a single measurement pending and resolves its unresolved validation
 * occurrences, scoped to the selected active census+plot. Clears every
 * unresolved validation error on the row (not a single selected error), and
 * does not run scientific validation synchronously. Rejects with
 * ScopeAccessError if the row is missing, belongs to a different
 * census/plot, or is itself inactive (cm.IsActive = FALSE), before any
 * mutation.
 */
export async function recheckMeasurementValidation(cm: ConnectionManager, scope: RecheckMeasurementScope): Promise<number> {
  assertValidMeasurementScope(scope);
  if (!Number.isSafeInteger(scope.coreMeasurementID) || scope.coreMeasurementID <= 0) {
    throw new ScopeAccessError('A positive measurement ID is required');
  }

  return cm.withTransaction(async tx => {
    await acquireScopeLockOrThrow(cm, scope, tx.id);
    await assertActiveScope(cm, tx, scope);

    const targets = await tx.query<Array<{ CoreMeasurementID: number }>>(
      safeFormatQuery(
        scope.schema,
        `SELECT CoreMeasurementID
         FROM ??.coremeasurements
         WHERE CensusID = ? AND CoreMeasurementID = ? AND IsActive = TRUE
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
