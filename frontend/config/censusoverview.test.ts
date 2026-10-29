import { describe, expect, it } from 'vitest';
import {
  CENSUS_OVERVIEW_ERROR_CENSUS_IDS_PARAM,
  CENSUS_OVERVIEW_SUMMARY_ENDPOINT,
  EXPORT_SKIP_REASON_ROW_LABELS,
  formatAffectedMeasurementsLine,
  formatAffectedOfActive,
  formatBlockerRowCount,
  formatCensusDateRange,
  formatErrorTypesFootnote,
  formatExportedOfActive,
  formatExportedWithUnresolvedErrors,
  formatExportPreviewCounts,
  formatPercentOf,
  formatRemainingErrorTypes,
  formatShareOfActive,
  formatShareOfActiveHeading,
  formatSkipReason,
  formatStemsPerTree,
  toBarPercent
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

describe('census overview option A formatters', () => {
  it('formats a share to one decimal and refuses a share it cannot state honestly', () => {
    const cases = [
      { part: 21, whole: 88, expected: '23.9%' },
      { part: 4, whole: 625, expected: '0.6%' },
      { part: 88, whole: 88, expected: '100.0%' },
      { part: 3, whole: 0, expected: null },
      { part: 5, whole: 4, expected: null }
    ];
    for (const { part, whole, expected } of cases) {
      const actual = formatPercentOf(part, whole);
      console.log(`[option A] formatPercentOf(${part}, ${whole}) = ${actual}`);
      expect(actual, `${part} of ${whole}`).toBe(expected);
    }
  });

  it('caps a bar at 100 and draws an empty bar for an empty whole', () => {
    expect(toBarPercent(21, 88)).toBeCloseTo(23.86, 2);
    expect(toBarPercent(5, 4)).toBe(100);
    expect(toBarPercent(3, 0)).toBe(0);
  });

  it('states affected measurements against the active total, dropping a percent it cannot state', () => {
    expect(formatAffectedOfActive(21, 88)).toBe('of 88 measurements · 23.9%');
    expect(formatAffectedOfActive(1204, 16084)).toBe('of 16,084 measurements · 7.5%');
    expect(formatAffectedOfActive(3, 0)).toBe('of 0 measurements');
    expect(formatAffectedOfActive(30, 20)).toBe('of 20 measurements');
  });

  it('labels the share column with the active total and shows a dash for an impossible share', () => {
    expect(formatShareOfActiveHeading(88)).toBe('Share of 88 active');
    expect(formatShareOfActiveHeading(16084)).toBe('Share of 16,084 active');
    expect(formatShareOfActive(3, 88)).toBe('3.4%');
    expect(formatShareOfActive(2, 88)).toBe('2.3%');
    expect(formatShareOfActive(3, 0)).toBe('—');
  });

  it('counts the error types beyond the listed five and always notes that errors overlap', () => {
    expect(formatErrorTypesFootnote(0)).toBe('One measurement can carry several errors.');
    expect(formatErrorTypesFootnote(1)).toBe('Plus 1 more error type. One measurement can carry several errors.');
    expect(formatErrorTypesFootnote(8)).toBe('Plus 8 more error types. One measurement can carry several errors.');
  });

  it('states what a publish would export against the active total', () => {
    expect(formatExportedOfActive(88)).toBe('of 88 measurements exported');
    expect(formatExportedOfActive(16084)).toBe('of 16,084 measurements exported');
  });

  it('formats a census date range, an open-ended census, and a census with no start', () => {
    // Local-time constructors keep the display date timezone-stable across CI runners.
    expect(formatCensusDateRange(new Date(2026, 2, 15), new Date(2026, 5, 20))).toBe('Mar 15, 2026 – Jun 20, 2026');
    expect(formatCensusDateRange(new Date(2026, 2, 15), undefined)).toBe('From Mar 15, 2026');
    expect(formatCensusDateRange(undefined, undefined)).toBe('');
  });

  it('gives every skip reason a sentence-case row label', () => {
    expect(EXPORT_SKIP_REASON_ROW_LABELS).toEqual({
      'not-validated': 'Not validated',
      'no-stem-guid': 'Failed (no stem)',
      'inactive-stem-or-tree': 'Inactive tree or stem',
      'missing-link': 'Missing quadrat, species, genus or family link',
      other: 'Other reason'
    });
  });
});
