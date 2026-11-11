import { describe, expect, it } from 'vitest';
import type { OrgCensusRDS } from '@/lib/db/definitions/timekeeping';
import { getDateRangeCensusIDs } from './censusscope';

function censusWithDateRangeIDs(censusIDs: number[]): OrgCensusRDS {
  return {
    plotID: 1,
    plotCensusNumber: 2,
    censusIDs,
    dateRanges: censusIDs.map(censusID => ({ censusID })),
    description: 'grouped census'
  } as OrgCensusRDS;
}

describe('getDateRangeCensusIDs', () => {
  it('returns no IDs when no census is selected', () => {
    expect(getDateRangeCensusIDs(undefined)).toEqual([]);
  });

  it('keeps dateRanges order, drops duplicates and non-positive IDs', () => {
    const census = censusWithDateRangeIDs([9, 8, 9, 0, -1]);
    const censusIDs = getDateRangeCensusIDs(census);
    console.log(`[#547 census scope] ${JSON.stringify(census.dateRanges)} -> ${JSON.stringify(censusIDs)}`);
    expect(censusIDs).toEqual([9, 8]);
  });
});
