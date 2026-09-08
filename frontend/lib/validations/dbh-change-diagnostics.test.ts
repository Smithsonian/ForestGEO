import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      withTransaction: async (callback: (tx: { id: string; query: typeof query }) => Promise<unknown>) => callback({ id: 'diagnostic-tx', query })
    })
  }
}));

import { explainDbhChangePairs } from './dbh-change-diagnostics';

describe('explainDbhChangePairs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads pair facts from its transaction-local table and drops it before returning', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM `forestgeo_testing`.coremeasurements')) {
        return [{ CoreMeasurementID: 42, CensusID: 7, PlotID: 3, IsValidated: 0 }];
      }
      if (sql.includes('CALL `forestgeo_testing`.BuildDBHChangePairs')) return [];
      if (sql.includes('FROM dbh_change_pairs')) {
        return [
          {
            PresentCoreMeasurementID: 42,
            PriorCoreMeasurementID: 19,
            PresentCensusID: 7,
            PriorCensusID: 6,
            PresentIsValidated: 0,
            PresentDBH: '180.5',
            PriorDBH: '100',
            PresentHOM: '1.3',
            PriorHOM: '1.3',
            PresentMeasurementDate: '2024-01-01',
            PriorMeasurementDate: '2023-01-01',
            UnitToMm: 1,
            IntervalDays: 365,
            IntervalYears: '0.9993',
            StatusExempt: 0,
            DbhsMeetFloor: 1,
            HomEligible: 1,
            IntervalSkipReason: null,
            IsEligible: 1,
            GrowthViolates: 1,
            ShrinkageViolates: 0
          }
        ];
      }
      if (sql.includes('DROP TEMPORARY TABLE')) return [];
      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(explainDbhChangePairs({ schema: 'forestgeo_testing', coreMeasurementID: 42, censusID: 7, plotID: 3 })).resolves.toMatchObject({
      outcome: 'pairs-found',
      present: { coreMeasurementID: 42, isValidated: false, hasUnresolvedGrowthError: false, hasUnresolvedShrinkageError: false },
      pairs: [{ priorCoreMeasurementID: 19, growthViolates: true, shrinkageViolates: false }]
    });
    expect(query.mock.calls.at(-1)?.[0]).toContain('DROP TEMPORARY TABLE IF EXISTS dbh_change_pairs');
  });

  it('does not infer a reason from an empty pair table', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM `forestgeo_testing`.coremeasurements')) {
        return [{ CoreMeasurementID: 42, CensusID: 7, PlotID: 3, IsValidated: null }];
      }
      if (sql.includes('CALL `forestgeo_testing`.BuildDBHChangePairs') || sql.includes('FROM dbh_change_pairs') || sql.includes('DROP TEMPORARY TABLE'))
        return [];
      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(explainDbhChangePairs({ schema: 'forestgeo_testing', coreMeasurementID: 42 })).resolves.toEqual({
      outcome: 'no-eligible-prior-comparison',
      present: {
        coreMeasurementID: 42,
        censusID: 7,
        plotID: 3,
        isValidated: null,
        hasUnresolvedGrowthError: false,
        hasUnresolvedShrinkageError: false
      },
      pairs: []
    });
  });

  it('keeps existing unresolved occurrence state separate from computed pair facts', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM `forestgeo_testing`.coremeasurements')) {
        return [{ CoreMeasurementID: 42, CensusID: 7, PlotID: 3, IsValidated: 1, HasUnresolvedGrowthError: 1, HasUnresolvedShrinkageError: 0 }];
      }
      if (sql.includes('CALL `forestgeo_testing`.BuildDBHChangePairs') || sql.includes('DROP TEMPORARY TABLE')) return [];
      if (sql.includes('FROM dbh_change_pairs'))
        return [
          {
            PresentCoreMeasurementID: 42,
            PriorCoreMeasurementID: 19,
            PresentCensusID: 7,
            PriorCensusID: 6,
            PresentIsValidated: 1,
            PresentDBH: 100,
            PriorDBH: 100,
            PresentHOM: null,
            PriorHOM: null,
            PresentMeasurementDate: '2024-01-01',
            PriorMeasurementDate: '2023-01-01',
            UnitToMm: 1,
            IntervalDays: 365,
            IntervalYears: 1,
            StatusExempt: 0,
            DbhsMeetFloor: 1,
            HomEligible: 1,
            IntervalSkipReason: null,
            IsEligible: 1,
            GrowthViolates: 0,
            ShrinkageViolates: 0
          }
        ];
      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(explainDbhChangePairs({ schema: 'forestgeo_testing', coreMeasurementID: 42 })).resolves.toMatchObject({
      outcome: 'pairs-found',
      present: { isValidated: true, hasUnresolvedGrowthError: true, hasUnresolvedShrinkageError: false },
      pairs: [{ growthViolates: false, shrinkageViolates: false }]
    });
  });
});
