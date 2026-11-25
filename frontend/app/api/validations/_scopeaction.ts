// Shared request handling for the census-wide validation actions (override, reset; issue #465). Each route wraps
// this in withRouteAuthz, which has already checked the caller may address the body's schema.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import ailogger from '@/ailogger';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { isAdminSession } from '@/lib/authz';
import { isValidSchema } from '@/lib/db/sqlsecurity';
import { INTERNAL_SERVER_ERROR_MESSAGE, toError } from '@/lib/errorhelpers';
import { authenticatedSessionIdentity } from '@/lib/changelog/identity';
import { ScopeLockHeldError } from '@/config/editplan/apply';
import { SessionExpiredError } from '@/config/editplan/authorization';
import { ScopeAccessError, ScopeBusyError, type MeasurementScopeInput } from '@/config/editplan/scopeguard';
import { TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE, TransactionCommitOutcomeUnknownError } from '@/lib/db/transactionerrors';
import { runInLockedMeasurementScope } from '@/lib/validations/locked-measurement-scope';
import {
  VALIDATION_SCOPE_ACTION_CODES,
  VALIDATION_SCOPE_ADMIN_REQUIRED_MESSAGE,
  VALIDATION_SCOPE_BUSY_MESSAGE,
  VALIDATION_SCOPE_UNCONFIRMED_MESSAGE
} from '@/config/validationscopeactions';

const ValidationScopeBody = z
  .object({
    schema: z.string().refine(isValidSchema),
    plotID: z.number().int().positive(),
    censusID: z.number().int().positive()
  })
  .strict();

const RESPONSE_TEXT = {
  unauthorized: 'unauthorized',
  invalidRequest: 'A schema and a positive plot and census ID are required',
  sessionExpired: 'Your session is no longer authorized to change validation results',
  scopeForbidden: 'This plot or census is outside your scope'
} as const;

export type ValidationScopeWrite<T> = (cm: ConnectionManager, input: MeasurementScopeInput & { changedBy: string }, transactionID: string) => Promise<T>;

function respond(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

/**
 * Validates the body, requires an admin session (the only callers /api/query let write SQL, which is how these
 * actions ran before), then runs `write` under the census's measurement-scope lock (lib/validations/locked-measurement-scope)
 * and answers its result with 200. A busy census is 423, nothing written.
 */
export async function handleValidationScopeAction<T extends object>(
  request: NextRequest,
  actionLabel: string,
  write: ValidationScopeWrite<T>
): Promise<NextResponse> {
  const session = await auth();
  if (!session) return respond(RESPONSE_TEXT.unauthorized, VALIDATION_SCOPE_ACTION_CODES.sessionExpired, HTTPResponses.UNAUTHORIZED);

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error;
    return respond(RESPONSE_TEXT.invalidRequest, VALIDATION_SCOPE_ACTION_CODES.invalidRequest, HTTPResponses.BAD_REQUEST);
  }
  const parsed = ValidationScopeBody.safeParse(rawBody);
  if (!parsed.success) return respond(RESPONSE_TEXT.invalidRequest, VALIDATION_SCOPE_ACTION_CODES.invalidRequest, HTTPResponses.BAD_REQUEST);
  if (!isAdminSession(session)) return respond(VALIDATION_SCOPE_ADMIN_REQUIRED_MESSAGE, VALIDATION_SCOPE_ACTION_CODES.adminRequired, HTTPResponses.FORBIDDEN);

  const scope = parsed.data;
  const cm = ConnectionManager.getInstance();
  const changedBy = authenticatedSessionIdentity(session.user);
  try {
    const result = await runInLockedMeasurementScope(cm, session, scope, transactionID => write(cm, { ...scope, changedBy }, transactionID));
    return NextResponse.json(result, { status: HTTPResponses.OK });
  } catch (error: unknown) {
    if (error instanceof TransactionCommitOutcomeUnknownError) {
      ailogger.error(`${actionLabel}: COMMIT outcome unknown; not retrying`, error);
      return respond(VALIDATION_SCOPE_UNCONFIRMED_MESSAGE, TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE, HTTPResponses.INTERNAL_SERVER_ERROR);
    }
    if (error instanceof SessionExpiredError)
      return respond(RESPONSE_TEXT.sessionExpired, VALIDATION_SCOPE_ACTION_CODES.sessionExpired, HTTPResponses.UNAUTHORIZED);
    if (error instanceof ScopeAccessError) return respond(RESPONSE_TEXT.scopeForbidden, VALIDATION_SCOPE_ACTION_CODES.scopeForbidden, HTTPResponses.FORBIDDEN);
    if (error instanceof ScopeBusyError || error instanceof ScopeLockHeldError)
      return respond(VALIDATION_SCOPE_BUSY_MESSAGE, VALIDATION_SCOPE_ACTION_CODES.scopeBusy, HTTPResponses.LOCKED);
    ailogger.error(`${actionLabel} failed`, toError(error));
    return respond(INTERNAL_SERVER_ERROR_MESSAGE, VALIDATION_SCOPE_ACTION_CODES.failed, HTTPResponses.INTERNAL_SERVER_ERROR);
  }
}
