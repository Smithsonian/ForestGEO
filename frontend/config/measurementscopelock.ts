/**
 * Shared plot+census scope lock for measurement-affecting operations.
 *
 * This is used to keep revision apply, validation-run startup, and upload
 * session creation from beginning conflicting work on the same scope at the
 * same time.
 *
 * A timeout of 0 is intentional: these user-driven actions fail fast instead
 * of waiting on another in-flight operation to release the scope.
 */
export const MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS = 0;

export function buildMeasurementScopeLockName(schema: string, plotID: number | string, censusID: number | string): string {
  return `measurement-scope:${schema}:${plotID}:${censusID}`;
}
