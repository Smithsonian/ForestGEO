// Client transport for POST /api/validations/override and /api/validations/reset. Mirrors
// lib/errorsexplorer/requestclearvalidationerrors.ts: never claims success or failure when the outcome is unknown,
// and never retries.
import { HTTPResponses } from '@/config/macros';
import { TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE } from '@/lib/db/transactionerrors';
import {
  VALIDATION_OVERRIDE_ENDPOINT,
  VALIDATION_RESET_ENDPOINT,
  VALIDATION_SCOPE_ACTION_CODES,
  VALIDATION_SCOPE_ADMIN_REQUIRED_MESSAGE,
  VALIDATION_SCOPE_BUSY_MESSAGE,
  VALIDATION_SCOPE_UNCONFIRMED_MESSAGE,
  type ValidationOverrideResult,
  type ValidationResetResult,
  type ValidationScopeRequest
} from '@/config/validationscopeactions';

const REQUEST_METHOD = 'POST';
const JSON_CONTENT_TYPE = 'application/json';

/** `failed` means nothing changed; `code` is the route's code (`VALIDATION_SCOPE_ACTION_CODES`), or null for a body without one. */
export type ValidationScopeActionOutcome<T> =
  | { status: 'done'; result: T }
  | { status: 'failed'; httpStatus: number; code: string | null }
  | { status: 'unconfirmed' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

async function postValidationScopeAction<T>(
  endpoint: string,
  request: ValidationScopeRequest,
  readResult: (body: Record<string, unknown>) => T | null
): Promise<ValidationScopeActionOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: REQUEST_METHOD,
      credentials: 'include',
      headers: { 'Content-Type': JSON_CONTENT_TYPE },
      body: JSON.stringify(request)
    });
  } catch {
    // Transport rejection: the server may have committed before the connection dropped.
    return { status: 'unconfirmed' };
  }

  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok) {
    const result = isPlainObject(body) ? readResult(body) : null;
    return result === null ? { status: 'unconfirmed' } : { status: 'done', result };
  }
  const code = isPlainObject(body) && typeof body.code === 'string' ? body.code : null;
  if (code === TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE) return { status: 'unconfirmed' };
  return { status: 'failed', httpStatus: response.status, code };
}

export function requestValidationOverride(request: ValidationScopeRequest): Promise<ValidationScopeActionOutcome<ValidationOverrideResult>> {
  return postValidationScopeAction(VALIDATION_OVERRIDE_ENDPOINT, request, body =>
    isCount(body.overriddenMeasurementCount) && isCount(body.removedValidationErrorCount)
      ? { overriddenMeasurementCount: body.overriddenMeasurementCount, removedValidationErrorCount: body.removedValidationErrorCount }
      : null
  );
}

export function requestValidationReset(request: ValidationScopeRequest): Promise<ValidationScopeActionOutcome<ValidationResetResult>> {
  return postValidationScopeAction(VALIDATION_RESET_ENDPOINT, request, body =>
    isCount(body.resetMeasurementCount) && isCount(body.resolvedValidationErrorCount)
      ? { resetMeasurementCount: body.resetMeasurementCount, resolvedValidationErrorCount: body.resolvedValidationErrorCount }
      : null
  );
}

/** The message to show for an outcome that is not `done`; `failedMessage` covers every failure without a specific one. */
export function describeValidationScopeActionProblem(
  outcome: Exclude<ValidationScopeActionOutcome<unknown>, { status: 'done' }>,
  failedMessage: string
): string {
  if (outcome.status === 'unconfirmed') return VALIDATION_SCOPE_UNCONFIRMED_MESSAGE;
  if (outcome.httpStatus === HTTPResponses.LOCKED || outcome.code === VALIDATION_SCOPE_ACTION_CODES.scopeBusy) return VALIDATION_SCOPE_BUSY_MESSAGE;
  if (outcome.code === VALIDATION_SCOPE_ACTION_CODES.adminRequired) return VALIDATION_SCOPE_ADMIN_REQUIRED_MESSAGE;
  return failedMessage;
}
