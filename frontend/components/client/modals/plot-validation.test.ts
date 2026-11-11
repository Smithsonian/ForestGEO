import { describe, expect, it } from 'vitest';
import { validatePlot } from './plot-validation';

const validPlot = { plotName: 'Alpha', dimensionX: 100, dimensionY: 50, area: 5000, globalX: 10, globalY: 20, globalZ: 0, globalCoordinatesEPSG: 26916 };

describe('validatePlot', () => {
  it('accepts a complete valid plot', () => {
    expect(validatePlot(validPlot)).toEqual({});
  });

  it('requires a non-blank trimmed name', () => {
    expect(validatePlot({ ...validPlot, plotName: '' }).plotName).toBeDefined();
    expect(validatePlot({ ...validPlot, plotName: '   ' }).plotName).toBeDefined();
    expect(validatePlot({ ...validPlot, plotName: undefined }).plotName).toBeDefined();
  });

  it('rejects zero, negative and non-finite dimensions and area, including mid-edit strings', () => {
    for (const bad of [0, -5, '0', '-5', 'abc', Number.NaN, Number.POSITIVE_INFINITY]) {
      const errors = validatePlot({ ...validPlot, dimensionX: bad as number, dimensionY: bad as number, area: bad as number });
      expect(errors.dimensionX, `dimensionX ${String(bad)}`).toBeDefined();
      expect(errors.dimensionY, `dimensionY ${String(bad)}`).toBeDefined();
      expect(errors.area, `area ${String(bad)}`).toBeDefined();
    }
  });

  it('allows blank optional dimensions, area and coordinates', () => {
    expect(
      validatePlot({
        plotName: 'Alpha',
        dimensionX: undefined,
        dimensionY: '' as unknown as number,
        area: undefined,
        globalX: undefined,
        globalY: undefined,
        globalZ: undefined,
        globalCoordinatesEPSG: null
      })
    ).toEqual({});
  });

  it('allows signed global coordinates but rejects non-numeric ones', () => {
    expect(validatePlot({ ...validPlot, globalX: -81.5, globalY: '-12.25' as unknown as number })).toEqual({});
    expect(validatePlot({ ...validPlot, globalX: 'north' as unknown as number }).globalX).toBeDefined();
  });

  it('validates EPSG through parseEpsgForSave: 4326 is valid, 0 and junk are not, blank means not recorded', () => {
    expect(validatePlot({ ...validPlot, globalCoordinatesEPSG: 4326 })).toEqual({});
    expect(validatePlot({ ...validPlot, globalCoordinatesEPSG: null })).toEqual({});
    expect(validatePlot({ ...validPlot, globalCoordinatesEPSG: 0 }).globalCoordinatesEPSG).toBeDefined();
    expect(validatePlot({ ...validPlot, globalCoordinatesEPSG: 'abc' as unknown as number }).globalCoordinatesEPSG).toBeDefined();
  });
});
