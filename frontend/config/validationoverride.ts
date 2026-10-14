/**
 * A manager override is recorded as a resolved validation occurrence under this
 * code. It is invisible wherever unresolved errors are read, but lets a later
 * DBH re-score recognise the row as deliberately overridden rather than clean.
 */
export const MANAGER_OVERRIDE_ERROR_CODE = 'MANAGER_OVERRIDE';
export const MANAGER_OVERRIDE_ERROR_MESSAGE = 'Validation result overridden by a manager';
