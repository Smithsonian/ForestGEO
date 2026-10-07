import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VALIDATION_TASK_TIMEOUT_MS,
  getValidationTaskTimeoutMs,
  resolveValidationRunPersistence,
  SHARED_CROSS_CENSUS_TASK_TIMEOUT_MS
} from './validation-runner-utils';

describe('validation-runner-utils', () => {
  it('uses the longer timeout budget for shared cross-census validations', () => {
    expect(getValidationTaskTimeoutMs('ValidateQuadratMismatchAcrossCensuses+ValidateCoordinateDriftAcrossCensuses')).toBe(SHARED_CROSS_CENSUS_TASK_TIMEOUT_MS);
    expect(getValidationTaskTimeoutMs('ValidateDBHGrowthExceedsMax+ValidateDBHShrinkageExceedsMax')).toBe(DEFAULT_VALIDATION_TASK_TIMEOUT_MS);
  });

  it('disables persistence when validation run creation fails', () => {
    expect(resolveValidationRunPersistence(false, { error: 'Table validation_runs does not exist' })).toEqual({
      conflict: false,
      existingRunID: null,
      persistenceEnabled: false,
      runID: null,
      reason: 'Table validation_runs does not exist'
    });
  });

  it('treats an active existing run as a conflict', () => {
    expect(resolveValidationRunPersistence(true, { conflict: true, existingRunID: '42' })).toEqual({
      conflict: true,
      existingRunID: 42,
      persistenceEnabled: true,
      runID: null
    });
  });

  it('enables persistence when a run id is returned', () => {
    expect(resolveValidationRunPersistence(true, { runID: 17 })).toEqual({
      conflict: false,
      existingRunID: null,
      persistenceEnabled: true,
      runID: 17
    });
  });

  it('rejects nonpositive, non-integer, unsafe, or missing run ids even on an OK response', () => {
    // A runID the caller intends to execute procedures/finalization against
    // must be a genuine, usable row id. Each of these is a distinct way a
    // 200 response could still be unusable: zero/negative, non-integer,
    // outside the safe-integer range, a non-numeric string, or absent.
    const malformedRunIDs: unknown[] = [0, -5, 1.5, Number.MAX_SAFE_INTEGER + 1, 'abc', undefined];

    for (const runID of malformedRunIDs) {
      expect(resolveValidationRunPersistence(true, { runID })).toEqual({
        conflict: false,
        existingRunID: null,
        persistenceEnabled: false,
        runID: null,
        reason: 'Validation run API did not return a runID'
      });
    }
  });

  it('still accepts a positive integer runID delivered as a numeric string', () => {
    expect(resolveValidationRunPersistence(true, { runID: '42' })).toEqual({
      conflict: false,
      existingRunID: null,
      persistenceEnabled: true,
      runID: 42
    });
  });
});
