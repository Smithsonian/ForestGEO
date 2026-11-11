import type { OrgCensus } from '@/lib/db/definitions/timekeeping';

/**
 * Every physical CensusID behind the selected plot census, as the Errors page
 * queries them: distinct positive IDs in dateRanges order (highest first, as the
 * census list sorts them). Lives outside timekeeping.ts because every unit test
 * replaces that module with an empty stub (tests/mocks/platform-mocks.ts).
 */
export function getDateRangeCensusIDs(census: OrgCensus): number[] {
  const censusIDs = (census?.dateRanges ?? []).map(dateRange => dateRange.censusID).filter(censusID => Number.isInteger(censusID) && censusID > 0);
  return Array.from(new Set(censusIDs));
}
