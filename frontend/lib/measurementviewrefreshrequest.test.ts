import { describe, expect, it } from 'vitest';
import { hasCoreMeasurementIDs, MAX_VIEW_REFRESH_MEASUREMENT_IDS, parseMeasurementViewRefreshIDs } from './measurementviewrefreshrequest';

const TWO_IDS = [31, 7];
const SECRET_VALUE = 'secret-value-that-must-not-be-logged';

function idsUpTo(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

describe('hasCoreMeasurementIDs', () => {
  it.each([
    [{ coreMeasurementIDs: TWO_IDS }, true],
    [{ coreMeasurementIDs: undefined }, true],
    [{ coreMeasurementIDs: TWO_IDS, plotID: 1 }, true],
    [{ plotID: 1, censusID: 2 }, false],
    [{}, false],
    [null, false],
    [[], false],
    ['coreMeasurementIDs', false]
  ])('%j → %s', (body, expected) => {
    expect(hasCoreMeasurementIDs(body)).toBe(expected);
  });
});

describe('parseMeasurementViewRefreshIDs', () => {
  it('accepts one ID, two IDs and exactly the bound, in the order sent', () => {
    for (const ids of [[7], TWO_IDS, idsUpTo(MAX_VIEW_REFRESH_MEASUREMENT_IDS)]) {
      const result = parseMeasurementViewRefreshIDs({ coreMeasurementIDs: ids });
      console.log('[view-errors refreshviews ids accepted]', ids.length, JSON.stringify(result).slice(0, 120));
      expect(result, JSON.stringify(result)).toEqual({ ok: true, coreMeasurementIDs: ids });
    }
  });

  it.each([
    ['an empty list', { coreMeasurementIDs: [] }],
    ['one more than the bound', { coreMeasurementIDs: idsUpTo(MAX_VIEW_REFRESH_MEASUREMENT_IDS + 1) }],
    ['zero', { coreMeasurementIDs: [0] }],
    ['a negative ID', { coreMeasurementIDs: [-3] }],
    ['a fraction', { coreMeasurementIDs: [1.5] }],
    ['an unsafe integer', { coreMeasurementIDs: [Number.MAX_SAFE_INTEGER + 1] }],
    ['a digit string', { coreMeasurementIDs: ['7'] }],
    ['a duplicate', { coreMeasurementIDs: [7, 7] }],
    ['null', { coreMeasurementIDs: null }],
    ['a bare number', { coreMeasurementIDs: 7 }],
    ['plot and census alongside', { coreMeasurementIDs: [7], plotID: 1, censusID: 2 }],
    ['runPostValidation alongside', { coreMeasurementIDs: [7], runPostValidation: true }],
    ['an unknown key', { coreMeasurementIDs: [7], surprise: true }]
  ])('rejects %s', (label, body) => {
    const result = parseMeasurementViewRefreshIDs(body);
    console.log('[view-errors refreshviews ids rejected]', label, JSON.stringify(result));
    expect(result.ok, JSON.stringify(result)).toBe(false);
  });

  it('reports issue paths and codes only, never the rejected values', () => {
    const result = parseMeasurementViewRefreshIDs({ coreMeasurementIDs: [SECRET_VALUE] });
    console.log('[view-errors refreshviews ids issues]', JSON.stringify(result));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.issues)).not.toContain(SECRET_VALUE);
    expect(result.issues[0]).toEqual({ path: 'coreMeasurementIDs.0', code: expect.any(String) });
  });
});
