// Client-side transport for POST /api/edits/revert. Centralizes the
// confirmedPlanHash contract and CONFLICT (409) parsing; mirrors the
// response contract in frontend/app/api/edits/revert/route.ts.
import { HTTPResponses } from '@/config/macros';
import { ApplyResult, EditPlan, EditPlanDataType, Effect, FieldChange, PreviewError, Severity, SEVERITY_RANK } from '@/config/editplan/types';

const REVERT_ENDPOINT = '/api/edits/revert';
const REVERT_METHOD = 'POST';
const JSON_CONTENT_TYPE = 'application/json';

const GENERIC_FAILURE_MESSAGE_TEMPLATE = (httpStatus: number) => `Revert failed (status ${httpStatus}).`;
const ALREADY_REVERTED_MESSAGE_TEMPLATE = (byEditOperationID: number) => `This edit was already reverted by edit #${byEditOperationID}.`;
// Used when we genuinely do not know whether the revert happened (malformed
// body, or a dropped connection after the server may have applied it): never
// claim success, never claim failure, never auto-retry.
export const UNCONFIRMED_OUTCOME_MESSAGE = 'Could not confirm whether the revert completed. Refresh before retrying.';

const EDIT_PLAN_DATA_TYPES: readonly EditPlanDataType[] = ['measurementssummary', 'failedmeasurements'];

export interface EditRevertRequest {
  schema: string;
  plotID: number;
  censusID: number;
  editOperationID: number;
  confirmedPlanHash?: string;
}

export type EditRevertOutcome =
  | { status: 'reverted'; result: ApplyResult }
  | { status: 'confirmation-required'; freshPlan: EditPlan }
  | { status: 'unconfirmed'; message: string }
  | { status: 'failed'; httpStatus: number; message: string };

interface RevertErrorBody {
  error?: unknown;
  freshPlan?: unknown;
  byEditOperationID?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isEditPlanDataType(value: unknown): value is EditPlanDataType {
  return typeof value === 'string' && (EDIT_PLAN_DATA_TYPES as readonly string[]).includes(value);
}

// `value in SEVERITY_RANK` also matches inherited Object.prototype keys
// ("toString", "constructor", "hasOwnProperty", "__proto__"), so it must not
// be used here: check SEVERITY_RANK's own keys only.
function isSeverityKey(value: unknown): value is Severity {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SEVERITY_RANK, value);
}

// previewdialog.tsx only reads FieldChange.field (as a React key / data-testid
// / aria-label and in the "Field change: X" heading); `from`/`to` are passed
// through formatValue(value: unknown), which already tolerates any type.
function isRenderableFieldChange(value: unknown): value is FieldChange {
  return isPlainObject(value) && isNonEmptyString(value.field);
}

// Validates only what editeffectrow.tsx reads; severity must be a
// SEVERITY_RANK key or the color lookup is undefined.
function isRenderableEffect(value: unknown): value is Effect {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isSeverityKey(value.severity) &&
    typeof value.title === 'string' &&
    typeof value.detail === 'string' &&
    isFiniteNumber(value.affectedRowCount)
  );
}

// previewdialog.tsx only reads PreviewError.blocking (via `.some(e => e.blocking)`
// to compute isBlocked); kind/field/role/message/rowIndex are never read.
function isRenderablePreviewError(value: unknown): value is PreviewError {
  return isPlainObject(value) && typeof value.blocking === 'boolean';
}

// Validates only the EditPlan fields the preview renderers read; a malformed
// plan falls through to the ordinary `failed` path, never repaired/manufactured.
function isUsableFreshPlan(value: unknown): value is EditPlan {
  if (!isPlainObject(value)) return false;

  if (!isEditPlanDataType(value.dataType)) return false;
  // A target identifier must be a positive integer (a real row ID); 0,
  // negatives, fractional values, NaN and Infinity are never valid.
  if (!isPositiveInteger(value.targetID)) return false;
  if (!isNonEmptyString(value.planHash)) return false;
  if (typeof value.generatedAt !== 'string') return false;
  if (!isSeverityKey(value.maxSeverity)) return false;

  if (!Array.isArray(value.fieldChanges) || !value.fieldChanges.every(isRenderableFieldChange)) return false;
  if (!Array.isArray(value.effects) || !value.effects.every(isRenderableEffect)) return false;

  if (value.canApply !== undefined && typeof value.canApply !== 'boolean') return false;
  if (value.errors !== undefined && (!Array.isArray(value.errors) || !value.errors.every(isRenderablePreviewError))) return false;

  return true;
}

// Mirrors ApplyResult from revert.ts; editOperationID must be a positive
// integer or it does not prove a recorded, revertable write happened.
function isValidApplyErrorEntry(value: unknown): value is ApplyResult['applyErrors'][number] {
  if (!isPlainObject(value)) return false;
  if (typeof value.reason !== 'string') return false;
  if (value.ruleID !== undefined && typeof value.ruleID !== 'string') return false;
  if (value.coreMeasurementID !== undefined && typeof value.coreMeasurementID !== 'number') return false;
  if (value.csvIndex !== undefined && typeof value.csvIndex !== 'number') return false;
  return true;
}

function isValidUpdatedIDs(value: unknown): value is Record<string, number> {
  return isPlainObject(value) && Object.values(value).every(isFiniteNumber);
}

function isValidPostValidation(value: unknown): value is { newErrors: number; clearedErrors: number } {
  return isPlainObject(value) && isFiniteNumber(value.newErrors) && isFiniteNumber(value.clearedErrors);
}

function isValidApplyResult(value: unknown): value is ApplyResult {
  if (!isPlainObject(value)) return false;
  if (!isValidUpdatedIDs(value.updatedIDs)) return false;
  if (!Array.isArray(value.applyErrors) || !value.applyErrors.every(isValidApplyErrorEntry)) return false;
  if (!isPositiveInteger(value.editOperationID)) return false;
  if (typeof value.validationPending !== 'boolean') return false;
  if (value.postValidation !== undefined && !isValidPostValidation(value.postValidation)) return false;
  return true;
}

function buildFailureMessage(httpStatus: number, body: unknown): string {
  const errorBody = body as RevertErrorBody | undefined;
  if (errorBody && typeof errorBody.error === 'string') {
    if (errorBody.error === 'already reverted' && typeof errorBody.byEditOperationID === 'number') {
      return ALREADY_REVERTED_MESSAGE_TEMPLATE(errorBody.byEditOperationID);
    }
    return errorBody.error;
  }
  return GENERIC_FAILURE_MESSAGE_TEMPLATE(httpStatus);
}

export async function requestEditRevert(request: EditRevertRequest): Promise<EditRevertOutcome> {
  const body: Record<string, unknown> = {
    schema: request.schema,
    plotID: request.plotID,
    censusID: request.censusID,
    editOperationID: request.editOperationID,
    ...(request.confirmedPlanHash ? { confirmedPlanHash: request.confirmedPlanHash } : {})
  };

  let response: Response;
  try {
    response = await fetch(REVERT_ENDPOINT, {
      method: REVERT_METHOD,
      credentials: 'include',
      headers: { 'Content-Type': JSON_CONTENT_TYPE },
      body: JSON.stringify(body)
    });
  } catch {
    // Transport rejection: unknown whether the server applied the revert first.
    return { status: 'unconfirmed', message: UNCONFIRMED_OUTCOME_MESSAGE };
  }

  const parsedBody: unknown = await response.json().catch(() => undefined);

  if (response.ok) {
    if (isValidApplyResult(parsedBody)) {
      return { status: 'reverted', result: parsedBody };
    }
    // 2xx with a non-ApplyResult body: cannot confirm success or failure.
    return { status: 'unconfirmed', message: UNCONFIRMED_OUTCOME_MESSAGE };
  }

  if (response.status === HTTPResponses.CONFLICT) {
    const freshPlan = (parsedBody as RevertErrorBody | undefined)?.freshPlan;
    if (isUsableFreshPlan(freshPlan)) {
      return { status: 'confirmation-required', freshPlan };
    }
  }

  return { status: 'failed', httpStatus: response.status, message: buildFailureMessage(response.status, parsedBody) };
}
