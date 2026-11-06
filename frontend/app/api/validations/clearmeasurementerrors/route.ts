// POST /api/validations/clearmeasurementerrors — sends one linked measurement back to pending. The clear and the
// rebuild of both stored views commit together or not at all (View Errors spec P2-9), so no client rebuild follows.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import ailogger from '@/ailogger';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { CLEAR_MEASUREMENT_ERRORS_CODES } from '@/config/errorsexplorer';
import { isValidSchema } from '@/lib/db/sqlsecurity';
import { authenticatedSessionIdentity } from '@/lib/changelog/identity';
import { fromBody, withRouteAuthz, type RouteContext } from '@/lib/route-authz';
import { assertSessionMayEdit, createFreshAuthorizationCheck, PendingUserEditForbiddenError, SessionExpiredError } from '@/config/editplan/authorization';
import { ScopeLockHeldError } from '@/config/editplan/apply';
import { assertCanEditMeasurementScope, assertNoActiveMeasurementScopeConflict, ScopeAccessError, ScopeBusyError } from '@/config/editplan/scopeguard';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';
import {
  clearUnresolvedValidationErrors,
  ClearMeasurementNotFoundError,
  FailedMeasurementNotClearableError,
  NothingToClearError
} from '@/config/measurementerrors';
import { refreshMeasurementViewsForCoreMeasurements } from '@/lib/measurementviewrefresh';
import { TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE, TransactionCommitOutcomeUnknownError } from '@/lib/db/transactionerrors';

export const runtime = 'nodejs';

const ClearBody = z
  .object({
    schema: z.string().refine(isValidSchema),
    plotID: z.number().int().positive(),
    censusID: z.number().int().positive(),
    measurementID: z.number().int().positive()
  })
  .strict();

const RESPONSE_TEXT = {
  invalidRequest: 'Invalid clear request',
  pendingUser: 'Pending users cannot clear validation errors',
  sessionExpired: 'Your session is no longer authorized to clear validation errors',
  scopeForbidden: 'This plot or census is outside your scope',
  scopeBusy: 'An upload or validation run is active for this census',
  notInScope: 'Measurement not found in this plot and census',
  failedRow: 'This row failed ingestion; correct it and re-ingest it from Fix failed uploads',
  nothingToClear: 'This row has no unresolved validation error to clear',
  commitUnknown: 'Could not confirm whether the validation errors were cleared',
  failed: 'Unable to clear validation errors'
} as const;

function respond(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

async function rollbackKeepingTheOriginalError(cm: ConnectionManager, transactionID: string): Promise<void> {
  try {
    await cm.rollbackTransaction(transactionID);
  } catch (rollbackError: unknown) {
    ailogger.error('Clear validation errors: rollback failed', rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)));
  }
}

async function handler(request: NextRequest, _context: RouteContext) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: HTTPResponses.UNAUTHORIZED });

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error;
    return respond(RESPONSE_TEXT.invalidRequest, CLEAR_MEASUREMENT_ERRORS_CODES.invalidRequest, HTTPResponses.BAD_REQUEST);
  }
  const parsed = ClearBody.safeParse(rawBody);
  if (!parsed.success) return respond(RESPONSE_TEXT.invalidRequest, CLEAR_MEASUREMENT_ERRORS_CODES.invalidRequest, HTTPResponses.BAD_REQUEST);
  const input = parsed.data;

  try {
    assertSessionMayEdit(session);
  } catch (error: unknown) {
    if (error instanceof PendingUserEditForbiddenError)
      return respond(RESPONSE_TEXT.pendingUser, CLEAR_MEASUREMENT_ERRORS_CODES.pendingUser, HTTPResponses.FORBIDDEN);
    throw error;
  }

  const cm = ConnectionManager.getInstance();
  const scope = { schema: input.schema, plotID: input.plotID, censusID: input.censusID };
  const assertAuthorizationFresh = createFreshAuthorizationCheck(session, scope);
  let transactionID: string | undefined;
  let commitStarted = false;
  try {
    await assertCanEditMeasurementScope(cm, session, scope);
    transactionID = await cm.beginTransaction();
    // The authoritative scope lock comes first, as in applyEdit (config/editplan/apply.ts:74-91), so the probe below
    // pins the rows and no validation run or upload can start between the probe and the clear (P2-1).
    const scopeLockAcquired = await cm.acquireApplicationLock(
      buildMeasurementScopeLockName(input.schema, input.plotID, input.censusID),
      transactionID,
      MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS
    );
    if (!scopeLockAcquired) throw new ScopeLockHeldError('scope locked');
    await assertNoActiveMeasurementScopeConflict(cm, scope, transactionID);
    // Re-read role and sites from the authority under the lock and before the first write, as edits/apply does,
    // so a user demoted or removed after sign-in cannot clear until their session expires.
    await assertAuthorizationFresh();
    const changedBy = authenticatedSessionIdentity(session.user);
    const { clearedErrorCount } = await clearUnresolvedValidationErrors(cm, { ...input, changedBy }, transactionID);
    await refreshMeasurementViewsForCoreMeasurements(cm, input.schema, [input.measurementID], transactionID);
    commitStarted = true;
    await cm.commitTransaction(transactionID);
    return NextResponse.json({ clearedErrorCount }, { status: HTTPResponses.OK });
  } catch (error: unknown) {
    if (transactionID && !commitStarted) await rollbackKeepingTheOriginalError(cm, transactionID);
    if (error instanceof TransactionCommitOutcomeUnknownError) {
      ailogger.error('Clear validation errors: COMMIT outcome unknown; not retrying', error);
      return respond(RESPONSE_TEXT.commitUnknown, TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE, HTTPResponses.INTERNAL_SERVER_ERROR);
    }
    if (error instanceof SessionExpiredError)
      return respond(RESPONSE_TEXT.sessionExpired, CLEAR_MEASUREMENT_ERRORS_CODES.sessionExpired, HTTPResponses.UNAUTHORIZED);
    if (error instanceof ScopeAccessError) return respond(RESPONSE_TEXT.scopeForbidden, CLEAR_MEASUREMENT_ERRORS_CODES.scopeForbidden, HTTPResponses.FORBIDDEN);
    if (error instanceof ScopeBusyError || error instanceof ScopeLockHeldError)
      return respond(RESPONSE_TEXT.scopeBusy, CLEAR_MEASUREMENT_ERRORS_CODES.scopeBusy, HTTPResponses.LOCKED);
    if (error instanceof ClearMeasurementNotFoundError)
      return respond(RESPONSE_TEXT.notInScope, CLEAR_MEASUREMENT_ERRORS_CODES.notInScope, HTTPResponses.NOT_FOUND);
    if (error instanceof FailedMeasurementNotClearableError)
      return respond(RESPONSE_TEXT.failedRow, CLEAR_MEASUREMENT_ERRORS_CODES.failedRow, HTTPResponses.CONFLICT);
    if (error instanceof NothingToClearError)
      return respond(RESPONSE_TEXT.nothingToClear, CLEAR_MEASUREMENT_ERRORS_CODES.nothingToClear, HTTPResponses.CONFLICT);
    ailogger.error('Clear validation errors failed', error instanceof Error ? error : new Error(String(error)));
    return respond(RESPONSE_TEXT.failed, CLEAR_MEASUREMENT_ERRORS_CODES.failed, HTTPResponses.INTERNAL_SERVER_ERROR);
  } finally {
    await cm.closeConnection();
  }
}

export const POST = withRouteAuthz('validations/clearmeasurementerrors', handler, { schema: fromBody('schema') });
