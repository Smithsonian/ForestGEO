import { describe, expect, it, vi } from 'vitest';
import {
  refreshMeasurementsSummaryForCoreMeasurements,
  refreshMeasurementsSummaryForScope,
  refreshMeasurementViewsForCoreMeasurements,
  refreshViewFullTableForCoreMeasurements,
  refreshViewFullTableForScope
} from './measurementviewrefresh';

function makeConnectionManager() {
  return {
    executeQuery: vi.fn(async () => [])
  } as any;
}

function normalizeRefreshFilter(sql: string): string {
  return sql.replace(/WHERE c\.PlotID = \?\s+AND cm\.CensusID = \?/g, 'WHERE <FILTER>').replace(/WHERE cm\.CoreMeasurementID IN \([^)]+\)/g, 'WHERE <FILTER>');
}

describe('measurement view refresh', () => {
  it('refreshes both derived views by CoreMeasurementID without scope-wide deletes', async () => {
    const cm = makeConnectionManager();

    await refreshMeasurementViewsForCoreMeasurements(cm, 'forestgeo_testing', [7, 3, 7, 0], 'tx-1');

    expect(cm.executeQuery).toHaveBeenCalledTimes(4);
    expect(cm.executeQuery).toHaveBeenNthCalledWith(1, 'DELETE FROM `forestgeo_testing`.measurementssummary WHERE CoreMeasurementID IN (?, ?)', [3, 7], 'tx-1');
    expect(cm.executeQuery.mock.calls[1][0]).toContain('INSERT IGNORE INTO `forestgeo_testing`.measurementssummary');
    expect(cm.executeQuery.mock.calls[1][0]).toContain('WHERE cm.CoreMeasurementID IN (?, ?)');
    expect(cm.executeQuery.mock.calls[1][1]).toEqual([3, 7]);
    expect(cm.executeQuery).toHaveBeenNthCalledWith(3, 'DELETE FROM `forestgeo_testing`.viewfulltable WHERE CoreMeasurementID IN (?, ?)', [3, 7], 'tx-1');
    expect(cm.executeQuery.mock.calls[3][0]).toContain('INSERT IGNORE INTO `forestgeo_testing`.viewfulltable');
    expect(cm.executeQuery.mock.calls[3][0]).toContain('WHERE cm.CoreMeasurementID IN (?, ?)');
    expect(cm.executeQuery.mock.calls[3][1]).toEqual([3, 7]);
  });

  it('does nothing when no valid CoreMeasurementIDs are provided', async () => {
    const cm = makeConnectionManager();

    await refreshMeasurementViewsForCoreMeasurements(cm, 'forestgeo_testing', [0, -1, Number.NaN], 'tx-1');

    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('uses the same measurementssummary projection for scope and targeted refreshes', async () => {
    const scopeCM = makeConnectionManager();
    const targetedCM = makeConnectionManager();

    await refreshMeasurementsSummaryForScope(scopeCM, 'forestgeo_testing', 17, 42, 'tx-1');
    await refreshMeasurementsSummaryForCoreMeasurements(targetedCM, 'forestgeo_testing', [101], 'tx-1');

    const scopeInsert = scopeCM.executeQuery.mock.calls[1][0] as string;
    const targetedInsert = targetedCM.executeQuery.mock.calls[1][0] as string;
    expect(normalizeRefreshFilter(targetedInsert)).toBe(normalizeRefreshFilter(scopeInsert));
  });

  it('uses the same viewfulltable projection for scope and targeted refreshes', async () => {
    const scopeCM = makeConnectionManager();
    const targetedCM = makeConnectionManager();

    await refreshViewFullTableForScope(scopeCM, 'forestgeo_testing', 17, 42, 'tx-1');
    await refreshViewFullTableForCoreMeasurements(targetedCM, 'forestgeo_testing', [101], 'tx-1');

    const scopeInsert = scopeCM.executeQuery.mock.calls[1][0] as string;
    const targetedInsert = targetedCM.executeQuery.mock.calls[1][0] as string;
    expect(normalizeRefreshFilter(targetedInsert)).toBe(normalizeRefreshFilter(scopeInsert));
  });
});
