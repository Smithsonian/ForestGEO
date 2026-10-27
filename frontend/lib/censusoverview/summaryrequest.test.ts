import { describe, expect, it } from 'vitest';
import { CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS, parseCensusOverviewSummaryRequest, parseStrictPositiveInteger } from './summaryrequest';

const VALID_RAW_REQUEST = { schema: 'forestgeo_testing', plotID: '3', censusID: '12', errorCensusIDs: '12,11' };
const UNSAFE_INTEGER = '9007199254740993';

describe('parseStrictPositiveInteger', () => {
  it.each(['1', '42', String(Number.MAX_SAFE_INTEGER)])('accepts %s', raw => {
    expect(parseStrictPositiveInteger(raw)).toBe(Number(raw));
  });

  it.each(['0', '-1', '01', '1.5', 'abc', ' 1', '1 ', '', UNSAFE_INTEGER, undefined])('rejects %s', raw => {
    expect(parseStrictPositiveInteger(raw)).toBeNull();
  });
});

describe('parseCensusOverviewSummaryRequest', () => {
  it('parses a valid request and keeps the errors scope in order', () => {
    const result = parseCensusOverviewSummaryRequest(VALID_RAW_REQUEST);
    console.log('[#547 summary request]', JSON.stringify(result));
    expect(result).toEqual({ ok: true, request: { schema: 'forestgeo_testing', plotID: 3, censusID: 12, errorCensusIDs: [12, 11] } });
  });

  it('drops duplicate errors-scope IDs', () => {
    const result = parseCensusOverviewSummaryRequest({ ...VALID_RAW_REQUEST, errorCensusIDs: '12,11,12' });
    expect(result.ok && result.request.errorCensusIDs).toEqual([12, 11]);
  });

  it.each([
    ['an invalid schema', { ...VALID_RAW_REQUEST, schema: 'not a schema!' }, CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.invalidSchema],
    ['a missing schema', { ...VALID_RAW_REQUEST, schema: undefined }, CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.invalidSchema],
    ['a non-integer plot ID', { ...VALID_RAW_REQUEST, plotID: 'abc' }, CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.invalidPlotOrCensusID],
    ['a zero census ID', { ...VALID_RAW_REQUEST, censusID: '0' }, CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.invalidPlotOrCensusID],
    ['a decimal census ID', { ...VALID_RAW_REQUEST, censusID: '1.5' }, CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.invalidPlotOrCensusID],
    ['a missing errorCensusIDs', { ...VALID_RAW_REQUEST, errorCensusIDs: null }, CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.missingErrorCensusIDs],
    ['an empty errorCensusIDs', { ...VALID_RAW_REQUEST, errorCensusIDs: '' }, CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.missingErrorCensusIDs],
    ['an empty list member', { ...VALID_RAW_REQUEST, errorCensusIDs: '12,,11' }, CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.malformedErrorCensusIDs],
    ['a non-integer list member', { ...VALID_RAW_REQUEST, errorCensusIDs: '12,x' }, CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.malformedErrorCensusIDs],
    ['a spaced list member', { ...VALID_RAW_REQUEST, errorCensusIDs: '12, 11' }, CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.malformedErrorCensusIDs],
    ['a list without the path census', { ...VALID_RAW_REQUEST, errorCensusIDs: '11' }, CENSUS_OVERVIEW_SUMMARY_REQUEST_ERRORS.errorCensusIDsOmitPathCensus]
  ])('rejects %s', (_label, raw, expectedError) => {
    const result = parseCensusOverviewSummaryRequest(raw);
    console.log(`[#547 summary request] ${JSON.stringify(raw)} -> ${JSON.stringify(result)}`);
    expect(result).toEqual({ ok: false, error: expectedError });
  });
});
