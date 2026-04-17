import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { OrgCensusRDS } from './timekeeping';

let reconcileCurrentCensusSelection: typeof import('./timekeeping').reconcileCurrentCensusSelection;

beforeAll(async () => {
  vi.unmock('@/config/sqlrdsdefinitions/timekeeping');
  ({ reconcileCurrentCensusSelection } = await import('./timekeeping'));
});

describe('reconcileCurrentCensusSelection', () => {
  const censusList: OrgCensusRDS[] = [
    {
      plotID: 1,
      plotCensusNumber: 2,
      censusIDs: [6],
      dateRanges: [{ censusID: 6, startDate: new Date('2020-01-01'), endDate: new Date('2020-12-31') }],
      description: 'Second census'
    },
    {
      plotID: 1,
      plotCensusNumber: 1,
      censusIDs: [1],
      dateRanges: [{ censusID: 1, startDate: new Date('2010-06-06'), endDate: new Date('2012-10-17') }],
      description: 'First census'
    }
  ];

  it('returns the exact census when the persisted censusID still exists', () => {
    const currentCensus: OrgCensusRDS = {
      plotID: 1,
      plotCensusNumber: 1,
      censusIDs: [1],
      dateRanges: [{ censusID: 1, startDate: new Date('2010-06-06'), endDate: new Date('2012-10-17') }],
      description: 'Persisted'
    };

    expect(reconcileCurrentCensusSelection(currentCensus, censusList)).toBe(censusList[1]);
  });

  it('falls back to plot census number when the persisted censusID is stale', () => {
    const staleCurrentCensus: OrgCensusRDS = {
      plotID: 1,
      plotCensusNumber: 1,
      censusIDs: [14],
      dateRanges: [{ censusID: 14, startDate: new Date('2010-06-06'), endDate: new Date('2012-10-17') }],
      description: 'Stale persisted census'
    };

    expect(reconcileCurrentCensusSelection(staleCurrentCensus, censusList)).toBe(censusList[1]);
  });

  it('returns undefined when neither censusID nor plot census number matches', () => {
    const missingCurrentCensus: OrgCensusRDS = {
      plotID: 1,
      plotCensusNumber: 9,
      censusIDs: [99],
      dateRanges: [{ censusID: 99, startDate: new Date('2030-01-01') }],
      description: 'Missing census'
    };

    expect(reconcileCurrentCensusSelection(missingCurrentCensus, censusList)).toBeUndefined();
  });
});
