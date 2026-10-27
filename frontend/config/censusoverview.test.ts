import { describe, expect, it } from 'vitest';
import {
  CENSUS_OVERVIEW_ERROR_CENSUS_IDS_PARAM,
  CENSUS_OVERVIEW_SUMMARY_ENDPOINT,
  formatAffectedMeasurementsLine,
  formatBlockerRowCount,
  formatExportedWithUnresolvedErrors,
  formatExportPreviewCounts,
  formatRemainingErrorTypes,
  formatSkipReason,
  formatStemsPerTree
} from './censusoverview';

const URL_BASE = 'http://localhost';

describe('CENSUS_OVERVIEW_SUMMARY_ENDPOINT', () => {
  it('puts the publish census in the path and the errors scope in the query, in order', () => {
    const endpoint = CENSUS_OVERVIEW_SUMMARY_ENDPOINT('forestgeo_x', 3, 12, [12, 11]);
    const parsed = new URL(endpoint, URL_BASE);
    console.log(`[#547 endpoint] ${endpoint}`);
    expect(parsed.pathname).toBe('/api/censusoverview/summary/forestgeo_x/3/12');
    expect(parsed.searchParams.get(CENSUS_OVERVIEW_ERROR_CENSUS_IDS_PARAM)).toBe('12,11');
  });
});

describe('census overview formatters', () => {
  it('states affected rows against the active total with one-decimal percent', () => {
    expect(formatAffectedMeasurementsLine(1204, 16084)).toBe('1,204 of 16,084 active measurements have unresolved errors (7.5%)');
  });

  it.each([
    [5, 3],
    [3, 0]
  ])('omits the percent when %i affected exceed %i active (counts come from different sources)', (affected, total) => {
    const line = formatAffectedMeasurementsLine(affected, total);
    console.log(`[#547 affected line] ${affected} of ${total}: ${line}`);
    expect(line).toBe(`${affected} of ${total} active measurements have unresolved errors`);
  });

  it('still shows 100% when every active measurement is affected', () => {
    expect(formatAffectedMeasurementsLine(20, 20)).toBe('20 of 20 active measurements have unresolved errors (100.0%)');
  });

  it.each([
    [1, '+ 1 more type'],
    [6, '+ 6 more types']
  ])('pluralizes the remaining error types (%i)', (remaining, expected) => {
    expect(formatRemainingErrorTypes(remaining)).toBe(expected);
  });

  it.each([
    [1, '1 row'],
    [12, '12 rows']
  ])('pluralizes blocker row counts (%i)', (count, expected) => {
    expect(formatBlockerRowCount(count)).toBe(expected);
  });

  it.each([
    [1, '1 exported row still has an unresolved error'],
    [37, '37 exported rows still have an unresolved error']
  ])('describes exported rows carrying an unresolved error (%i)', (count, expected) => {
    expect(formatExportedWithUnresolvedErrors(count)).toBe(expected);
  });

  it('formats exported vs skipped and one skip reason with its label', () => {
    expect(formatExportPreviewCounts(14580, 1504)).toBe('14,580 would be exported · 1,504 skipped');
    expect(formatSkipReason('missing-link', 2)).toBe('2 missing quadrat, species, genus or family link');
  });

  it('formats stems per tree to one decimal and guards an empty census', () => {
    expect(formatStemsPerTree(12408, 15932)).toBe('1.3');
    expect(formatStemsPerTree(0, 5)).toBe('0');
  });
});
