import { describe, expect, it } from 'vitest';
import { getEndpointHeaderName, getGridTypeLabel, siteConfigNav } from './siteconfigs';

describe('siteConfigNav', () => {
  it('orders Census Hub as Census Overview, View Data, View Errors', () => {
    const censusHub = siteConfigNav.find(item => item.label === 'Census Hub');

    expect(censusHub).toBeDefined();
    expect(censusHub?.expanded[0]?.label).toBe('Census Overview');
    expect(censusHub?.expanded[1]?.label).toBe('View Data');
    expect(censusHub?.expanded[2]?.label).toBe('View Errors');
    expect(censusHub?.expanded[2]?.href).toBe('/errors');
  });

  it('returns the expected header for the errors route', () => {
    expect(getEndpointHeaderName('/measurementshub/errors')).toBe('View Errors');
  });
});

describe('getGridTypeLabel', () => {
  it('MUST map attributes to the user-facing "Stem Codes" name', () => {
    expect(getGridTypeLabel('attributes')).toBe('Stem Codes');
  });
  it('MUST map failedmeasurements to a spaced, capitalized label', () => {
    expect(getGridTypeLabel('failedmeasurements')).toBe('Failed Measurements');
  });
  it('MUST map alltaxonomiesview to "Species List"', () => {
    expect(getGridTypeLabel('alltaxonomiesview')).toBe('Species List');
  });
  it('MUST Title-Case an unknown machine name as a fallback', () => {
    expect(getGridTypeLabel('somefuture_view')).toBe('Somefuture View');
  });
  it('MUST never return an empty string', () => {
    expect(getGridTypeLabel('')).not.toBe('');
  });
});
