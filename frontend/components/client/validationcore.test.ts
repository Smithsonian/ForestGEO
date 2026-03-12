import { describe, expect, it } from 'vitest';
import { hasBlockingValidationFailures, isNetworkValidationFetchFailure } from './validationcore';

describe('validationcore helpers', () => {
  it('treats browser network fetch failures as non-fallback errors', () => {
    expect(isNetworkValidationFetchFailure(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true);
    expect(isNetworkValidationFetchFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkValidationFetchFailure(new Error('HTTP 500'))).toBe(false);
  });

  it('flags failed validation results as blocking', () => {
    expect(
      hasBlockingValidationFailures([
        {
          status: 'fulfilled',
          value: [
            { procedureName: 'ValidateQuadratMismatchAcrossCensuses', success: false, error: 'NetworkError when attempting to fetch resource.' }
          ]
        }
      ])
    ).toBe(true);
  });

  it('does not treat aborted validation requests as blocking failures', () => {
    expect(
      hasBlockingValidationFailures([
        {
          status: 'rejected',
          reason: { name: 'AbortError' }
        }
      ])
    ).toBe(false);
  });

  it('does not block when every validation succeeded', () => {
    expect(
      hasBlockingValidationFailures([
        {
          status: 'fulfilled',
          value: [
            { procedureName: 'ValidateQuadratMismatchAcrossCensuses', success: true },
            { procedureName: 'ValidateCoordinateDriftAcrossCensuses', success: true }
          ]
        }
      ])
    ).toBe(false);
  });
});
