// Census-wide validation actions (issue #465): the View Data "Override validations" and "Reset validation states"
// buttons. Shared by the routes, the server modules and the browser, so it must stay free of server imports.

export const VALIDATION_OVERRIDE_ENDPOINT = '/api/validations/override';
export const VALIDATION_RESET_ENDPOINT = '/api/validations/reset';

export const VALIDATION_SCOPE_ACTION_CODES = {
  invalidRequest: 'INVALID_VALIDATION_SCOPE_REQUEST',
  adminRequired: 'ADMIN_REQUIRED',
  sessionExpired: 'SESSION_EXPIRED',
  scopeForbidden: 'SCOPE_FORBIDDEN',
  scopeBusy: 'SCOPE_BUSY',
  failed: 'VALIDATION_SCOPE_ACTION_FAILED'
} as const;

/** `unifiedchangelog` OldRowState/NewRowState `summaryKind` of the one row each action records for the census. */
export const VALIDATION_SCOPE_SUMMARY_KIND = {
  override: 'validation-override',
  reset: 'validation-reset'
} as const;

export const VALIDATION_SCOPE_BUSY_MESSAGE = 'An upload or validation run is active for this census. Nothing was changed; try again when it finishes.';
export const VALIDATION_SCOPE_ADMIN_REQUIRED_MESSAGE = 'Only administrators can change validation results for a whole census. Nothing was changed.';
export const VALIDATION_SCOPE_UNCONFIRMED_MESSAGE = 'Could not confirm whether the change was saved. Refresh the page before trying again.';
export const VALIDATION_RESET_FAILED_MESSAGE = 'Validation states could not be reset. Nothing was changed.';
export const VALIDATION_OVERRIDE_FAILED_MESSAGE = 'Validation results could not be overridden. Nothing was changed.';
export const VALIDATION_RESET_SUCCESS_MESSAGE = 'Validation states reset. Rows are pending validation.';

export interface ValidationScopeRequest {
  schema: string;
  plotID: number;
  censusID: number;
}

export interface ValidationOverrideResult {
  overriddenMeasurementCount: number;
  removedValidationErrorCount: number;
}

export interface ValidationResetResult {
  resetMeasurementCount: number;
  resolvedValidationErrorCount: number;
}
