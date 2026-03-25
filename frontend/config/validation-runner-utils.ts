const SHARED_CROSS_CENSUS_TASK_NAME = 'ValidateQuadratMismatchAcrossCensuses+ValidateCoordinateDriftAcrossCensuses';

export const DEFAULT_VALIDATION_TASK_TIMEOUT_MS = 11 * 60 * 1000;
export const SHARED_CROSS_CENSUS_TASK_TIMEOUT_MS = 26 * 60 * 1000;

export interface ValidationRunPersistenceState {
  conflict: boolean;
  existingRunID: number | null;
  persistenceEnabled: boolean;
  runID: number | null;
  reason?: string;
}

function normalizeNumericID(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function getValidationTaskTimeoutMs(taskName: string): number {
  return taskName === SHARED_CROSS_CENSUS_TASK_NAME ? SHARED_CROSS_CENSUS_TASK_TIMEOUT_MS : DEFAULT_VALIDATION_TASK_TIMEOUT_MS;
}

export function resolveValidationRunPersistence(responseOK: boolean, payload: unknown): ValidationRunPersistenceState {
  const data = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};

  if (data.conflict === true) {
    return {
      conflict: true,
      existingRunID: normalizeNumericID(data.existingRunID),
      persistenceEnabled: true,
      runID: null
    };
  }

  const runID = normalizeNumericID(data.runID);
  if (responseOK && runID !== null) {
    return {
      conflict: false,
      existingRunID: null,
      persistenceEnabled: true,
      runID
    };
  }

  const reasonValue = data.error;
  const reason =
    typeof reasonValue === 'string' && reasonValue.trim() !== ''
      ? reasonValue
      : responseOK
        ? 'Validation run API did not return a runID'
        : 'Validation run API request failed';

  return {
    conflict: false,
    existingRunID: null,
    persistenceEnabled: false,
    runID: null,
    reason
  };
}
