import { describe, expect, it } from 'vitest';
import { shouldRecoverFailedInitialCensus } from './failedinitialcensusrecovery';

describe('shouldRecoverFailedInitialCensus', () => {
  it('recovers the original failed/processing uploadmetrics case', () => {
    expect(
      shouldRecoverFailedInitialCensus({
        completedUploads: 0,
        incompleteUploads: 1,
        treeCount: 0,
        stemCount: 0,
        coreMeasurementCount: 10
      })
    ).toBe(true);
  });

  it('recovers orphaned failed coremeasurements when no completed upload exists', () => {
    expect(
      shouldRecoverFailedInitialCensus({
        completedUploads: 0,
        incompleteUploads: 0,
        treeCount: 0,
        stemCount: 0,
        coreMeasurementCount: 244
      })
    ).toBe(true);
  });

  it('does not recover orphaned failed coremeasurements when a completed upload already exists', () => {
    expect(
      shouldRecoverFailedInitialCensus({
        completedUploads: 1,
        incompleteUploads: 0,
        treeCount: 0,
        stemCount: 0,
        coreMeasurementCount: 244
      })
    ).toBe(false);
  });

  it('does not recover when a completed upload already exists', () => {
    expect(
      shouldRecoverFailedInitialCensus({
        completedUploads: 1,
        incompleteUploads: 0,
        treeCount: 10,
        stemCount: 10,
        coreMeasurementCount: 244
      })
    ).toBe(false);
  });
});
