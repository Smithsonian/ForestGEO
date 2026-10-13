import ConnectionManager, { type TxExecutor } from '@/lib/db/connectionmanager';
import { safeFormatQuery, validateSchemaOrThrow } from '@/lib/db/sqlsecurity';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';
import { assertNoActiveMeasurementScopeConflict, ScopeAccessError, ScopeBusyError, type MeasurementScopeInput } from '@/config/editplan/scopeguard';
import { refreshMeasurementViewsForCoreMeasurements } from '@/lib/measurementviewrefresh';

// Bound SQL parameters for large scope mutations; every batch stays in the same transaction.
export const SCOPE_VIEW_REFRESH_BATCH_SIZE = 1000;

export interface FormattedQueryRequest {
  query: string;
  params: unknown[];
}

export function assertValidMeasurementScope(scope: MeasurementScopeInput): void {
  validateSchemaOrThrow(scope.schema);
  if (!Number.isSafeInteger(scope.plotID) || scope.plotID <= 0 || !Number.isSafeInteger(scope.censusID) || scope.censusID <= 0) {
    throw new ScopeAccessError('A positive plot and census ID are required');
  }
}

async function acquireScopeLockOrThrow(cm: ConnectionManager, scope: MeasurementScopeInput, transactionID: string): Promise<void> {
  const locked = await cm.acquireApplicationLock(
    buildMeasurementScopeLockName(scope.schema, scope.plotID, scope.censusID),
    transactionID,
    MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS
  );
  if (!locked) throw new ScopeBusyError('A measurement operation is already in progress for this plot/census');
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

export async function lockActiveScope(cm: ConnectionManager, tx: TxExecutor, scope: MeasurementScopeInput): Promise<void> {
  await acquireScopeLockOrThrow(cm, scope, tx.id);
  await assertActiveScope(cm, tx, scope);
}

export async function refreshMeasurementViewsInBatches(
  cm: ConnectionManager,
  schema: string,
  coreMeasurementIDs: number[],
  transactionID: string
): Promise<void> {
  for (let offset = 0; offset < coreMeasurementIDs.length; offset += SCOPE_VIEW_REFRESH_BATCH_SIZE) {
    await refreshMeasurementViewsForCoreMeasurements(cm, schema, coreMeasurementIDs.slice(offset, offset + SCOPE_VIEW_REFRESH_BATCH_SIZE), transactionID);
  }
}
