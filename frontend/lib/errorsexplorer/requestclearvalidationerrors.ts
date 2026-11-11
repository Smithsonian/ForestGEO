// Client transport for POST /api/validations/clearmeasurementerrors. Mirrors requestrevert.ts: never claims
// success or failure when the outcome is unknown, and never retries.
import { CLEAR_VALIDATION_ERRORS_ENDPOINT } from '@/config/errorsexplorer';
import { TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE } from '@/lib/db/transactionerrors';

const CLEAR_METHOD = 'POST';
const JSON_CONTENT_TYPE = 'application/json';

export interface ClearValidationErrorsRequest {
  schema: string;
  plotID: number;
  censusID: number;
  measurementID: number;
}

/** `failed` means nothing changed; `code` is the route's code (`CLEAR_MEASUREMENT_ERRORS_CODES`), or null for a body without one. */
export type ClearValidationErrorsOutcome =
  | { status: 'cleared'; clearedErrorCount: number }
  | { status: 'failed'; httpStatus: number; code: string | null }
  | { status: 'unconfirmed' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function requestClearValidationErrors(request: ClearValidationErrorsRequest): Promise<ClearValidationErrorsOutcome> {
  let response: Response;
  try {
    response = await fetch(CLEAR_VALIDATION_ERRORS_ENDPOINT, {
      method: CLEAR_METHOD,
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
    const clearedErrorCount = isPlainObject(body) ? body.clearedErrorCount : undefined;
    return typeof clearedErrorCount === 'number' && Number.isSafeInteger(clearedErrorCount) && clearedErrorCount >= 0
      ? { status: 'cleared', clearedErrorCount }
      : { status: 'unconfirmed' };
  }
  const code = isPlainObject(body) && typeof body.code === 'string' ? body.code : null;
  if (code === TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE) return { status: 'unconfirmed' };
  return { status: 'failed', httpStatus: response.status, code };
}
