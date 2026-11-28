import type { Session } from 'next-auth';
import type ConnectionManager from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { toError } from '@/lib/errorhelpers';
import { ScopeLockHeldError } from '@/config/editplan/apply';
import { createFreshAuthorizationCheck } from '@/config/editplan/authorization';
import {
  assertCanEditMeasurementScope,
  assertNoActiveMeasurementScopeConflict,
  ScopeAccessError,
  type MeasurementScopeInput
} from '@/config/editplan/scopeguard';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';

// A share lock is enough: deleting or deactivating the census needs an exclusive lock on this row, so it waits for us.
const PIN_ACTIVE_CENSUS_SQL = 'SELECT CensusID FROM ??.census WHERE PlotID = ? AND CensusID = ? AND IsActive IS TRUE FOR SHARE';

async function pinActiveCensusOfPlot(cm: ConnectionManager, scope: MeasurementScopeInput, transactionID: string): Promise<void> {
  const rows = await cm.executeQuery(safeFormatQuery(scope.schema, PIN_ACTIVE_CENSUS_SQL), [scope.plotID, scope.censusID], transactionID);
  if (!Array.isArray(rows) || rows.length === 0) throw new ScopeAccessError('the census is no longer an active census of this plot');
}

async function rollbackKeepingTheOriginalError(cm: ConnectionManager, transactionID: string): Promise<void> {
  try {
    await cm.rollbackTransaction(transactionID);
  } catch (rollbackError: unknown) {
    ailogger.error('Locked measurement scope: rollback failed', toError(rollbackError));
  }
}

/**
 * Runs `write` in one transaction that holds the plot/census measurement-scope lock from before the busy check until
 * COMMIT, so no upload session or validation run can start between the check and the write: both take the same lock
 * to start (app/api/uploadsession, lib/validations/run-records.ts). In order: the session may address the scope
 * (403 ScopeAccessError), the lock is free (ScopeLockHeldError), the census is still an active census of the plot, no
 * upload or validation run is active (ScopeBusyError), and the user's role and sites are unchanged at the authority
 * (SessionExpiredError). Any failure before COMMIT rolls back and rethrows; a failed COMMIT rethrows as is.
 */
export async function runInLockedMeasurementScope<T>(
  cm: ConnectionManager,
  session: Session,
  scope: MeasurementScopeInput,
  write: (transactionID: string) => Promise<T>
): Promise<T> {
  await assertCanEditMeasurementScope(cm, session, scope);
  const assertAuthorizationFresh = createFreshAuthorizationCheck(session, scope);
  const transactionID = await cm.beginTransaction();
  let commitStarted = false;
  try {
    const scopeLockAcquired = await cm.acquireApplicationLock(
      buildMeasurementScopeLockName(scope.schema, scope.plotID, scope.censusID),
      transactionID,
      MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS
    );
    if (!scopeLockAcquired) throw new ScopeLockHeldError('measurement scope is locked by another operation');
    await pinActiveCensusOfPlot(cm, scope, transactionID);
    await assertNoActiveMeasurementScopeConflict(cm, scope, transactionID);
    await assertAuthorizationFresh();
    const result = await write(transactionID);
    commitStarted = true;
    await cm.commitTransaction(transactionID);
    return result;
  } catch (error: unknown) {
    if (!commitStarted) await rollbackKeepingTheOriginalError(cm, transactionID);
    throw error;
  }
}
