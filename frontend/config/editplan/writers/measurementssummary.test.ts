import { describe, expect, it, vi } from 'vitest';
import { resolveMeasurementViewRefreshTargets } from './measurementssummary';

function makeConnectionManager(rows: Array<Record<string, unknown>> = []) {
  return {
    executeQuery: vi.fn(async () => rows)
  } as any;
}

describe('resolveMeasurementViewRefreshTargets', () => {
  it('targets only the edited row for measurement-local fields', async () => {
    const cm = makeConnectionManager();

    const result = await resolveMeasurementViewRefreshTargets(cm, 'forestgeo_testing', {
      coreMeasurementID: 42,
      plotID: 1,
      censusID: 2,
      changedFields: new Set(['MeasuredDBH', 'Attributes']),
      beforeStemGUID: 11,
      afterStemGUID: 11,
      transactionID: 'tx-1'
    });

    expect(result).toEqual({ mode: 'targeted', coreMeasurementIDs: [42] });
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('includes measurements on old and new stems for identity and coordinate edits', async () => {
    const cm = makeConnectionManager([{ CoreMeasurementID: 5 }, { CoreMeasurementID: 101 }]);

    const result = await resolveMeasurementViewRefreshTargets(cm, 'forestgeo_testing', {
      coreMeasurementID: 42,
      plotID: 1,
      censusID: 2,
      changedFields: new Set(['StemLocalX']),
      beforeStemGUID: 22,
      afterStemGUID: 11,
      transactionID: 'tx-1'
    });

    expect(cm.executeQuery).toHaveBeenCalledTimes(1);
    expect(cm.executeQuery.mock.calls[0][0]).toContain('FROM `forestgeo_testing`.coremeasurements cm');
    expect(cm.executeQuery.mock.calls[0][0]).toContain('WHERE cm.StemGUID IN (?, ?)');
    expect(cm.executeQuery.mock.calls[0][0]).toContain('AND c.PlotID = ?');
    expect(cm.executeQuery.mock.calls[0][0]).toContain('AND cm.CensusID = ?');
    expect(cm.executeQuery.mock.calls[0][1]).toEqual([11, 22, 1, 2]);
    expect(result).toEqual({ mode: 'targeted', coreMeasurementIDs: [5, 42, 101] });
  });

  it('falls back to the scope refresh for unsupported changed fields', async () => {
    const cm = makeConnectionManager();

    const result = await resolveMeasurementViewRefreshTargets(cm, 'forestgeo_testing', {
      coreMeasurementID: 42,
      plotID: 1,
      censusID: 2,
      changedFields: new Set(['UnexpectedField']),
      beforeStemGUID: 11,
      afterStemGUID: 11,
      transactionID: 'tx-1'
    });

    expect(result).toEqual({ mode: 'scope', reason: 'unsupported-field' });
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('falls back when the target CoreMeasurementID is not a positive integer', async () => {
    const cm = makeConnectionManager();

    const result = await resolveMeasurementViewRefreshTargets(cm, 'forestgeo_testing', {
      coreMeasurementID: 0,
      plotID: 1,
      censusID: 2,
      changedFields: new Set(['MeasuredDBH']),
      beforeStemGUID: 11,
      afterStemGUID: 11,
      transactionID: 'tx-1'
    });

    expect(result).toEqual({ mode: 'scope', reason: 'invalid-target-id' });
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('falls back when stem-neighbor expansion cannot be bounded to a valid scope', async () => {
    const cm = makeConnectionManager();

    const result = await resolveMeasurementViewRefreshTargets(cm, 'forestgeo_testing', {
      coreMeasurementID: 42,
      plotID: 0,
      censusID: 2,
      changedFields: new Set(['TreeTag']),
      beforeStemGUID: 11,
      afterStemGUID: 12,
      transactionID: 'tx-1'
    });

    expect(result).toEqual({ mode: 'scope', reason: 'invalid-scope' });
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });
});
