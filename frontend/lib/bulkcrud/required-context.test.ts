import { describe, expect, it } from 'vitest';
import { BULKCRUD_REJECTION_MESSAGES, findMissingBulkcrudContext } from './required-context';

const PLOT = { plotID: 1 };
const CENSUS = { dateRanges: [{ censusID: 2 }] };

describe('findMissingBulkcrudContext', () => {
  it.each(['attributes', 'species', 'personnel'])('%s is site-level: no plot or census needed', gridType => {
    expect(findMissingBulkcrudContext(gridType, undefined, undefined)).toBeNull();
  });

  it('quadrats need a plot but not a census', () => {
    expect(findMissingBulkcrudContext('quadrats', undefined, undefined)).toBe(BULKCRUD_REJECTION_MESSAGES.missingPlot);
    expect(findMissingBulkcrudContext('quadrats', PLOT, undefined)).toBeNull();
  });

  it.each(['measurements', 'measurementssummary', 'measurementssummaryview'])('%s needs a plot, then a census', gridType => {
    expect(findMissingBulkcrudContext(gridType, undefined, CENSUS)).toBe(BULKCRUD_REJECTION_MESSAGES.missingPlot);
    expect(findMissingBulkcrudContext(gridType, PLOT, undefined)).toBe(BULKCRUD_REJECTION_MESSAGES.missingCensus);
    expect(findMissingBulkcrudContext(gridType, PLOT, CENSUS)).toBeNull();
  });

  it('rejects an unknown grid type by name', () => {
    expect(findMissingBulkcrudContext('trees', PLOT, CENSUS)).toBe('Unsupported grid type: trees');
  });

  it('rejects a grid type inherited from Object.prototype instead of treating it as known', () => {
    expect(findMissingBulkcrudContext('constructor', PLOT, CENSUS)).toBe('Unsupported grid type: constructor');
  });

  it('rejects a missing grid type', () => {
    expect(findMissingBulkcrudContext(undefined, PLOT, CENSUS)).toBe(BULKCRUD_REJECTION_MESSAGES.missingGridType);
  });
});
