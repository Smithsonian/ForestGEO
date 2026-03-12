import { describe, expect, it } from 'vitest';
import { getEndpointHeaderName, siteConfigNav } from './siteconfigs';

describe('siteConfigNav', () => {
  it('adds View Errors directly below View Data in Census Hub', () => {
    const censusHub = siteConfigNav.find(item => item.label === 'Census Hub');

    expect(censusHub).toBeDefined();
    expect(censusHub?.expanded[0]?.label).toBe('View Data');
    expect(censusHub?.expanded[1]?.label).toBe('View Errors');
    expect(censusHub?.expanded[1]?.href).toBe('/errors');
  });

  it('returns the expected header for the errors route', () => {
    expect(getEndpointHeaderName('/measurementshub/errors')).toBe('View Errors');
  });
});
