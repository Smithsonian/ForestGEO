import { describe, it, expect } from 'vitest';
import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';
import { applyAreaDerivation, AreaUnit, deriveArea, deriveAreaUnit, DimensionUnit, resolvePlotAreaChange } from './area';

const PLOT: {
  dimensionX: number;
  dimensionY: number;
  area: number;
  defaultDimensionUnits: DimensionUnit;
  defaultAreaUnits: AreaUnit;
} = {
  dimensionX: 40,
  dimensionY: 25,
  area: 999,
  defaultDimensionUnits: 'm',
  defaultAreaUnits: 'km2'
};

describe('deriveArea', () => {
  it('multiplies the two dimensions', () => {
    expect(deriveArea(100, 100)).toBe(10000);
    expect(deriveArea(40, 25)).toBe(1000);
  });

  it('handles fractional dimensions without rounding', () => {
    expect(deriveArea(2.5, 4)).toBe(10);
  });
});

describe('deriveAreaUnit', () => {
  it('maps a dimension unit to the area unit at the same index', () => {
    expect(deriveAreaUnit('m')).toBe('m2');
    expect(deriveAreaUnit('km')).toBe('km2');
    expect(deriveAreaUnit('hm')).toBe('hm2');
  });

  it('throws on a unit outside the vocabulary rather than guessing', () => {
    // 'ha' deliberately simulates untyped runtime input (e.g. unvalidated JSON)
    // that bypasses the DimensionUnit compile-time narrowing.
    expect(() => deriveAreaUnit('ha' as DimensionUnit)).toThrow(/ha/);
  });

  it('produces a valid area unit for every dimension unit', () => {
    for (const unit of unitSelectionOptions) {
      expect(areaSelectionOptions).toContain(deriveAreaUnit(unit));
    }
  });
});

describe('unit list parallelism guard', () => {
  it('keeps the two enums the same length and in the same order', () => {
    expect(areaSelectionOptions).toHaveLength(unitSelectionOptions.length);
    unitSelectionOptions.forEach((unit, index) => {
      expect(areaSelectionOptions[index]).toBe(`${unit}2`);
    });
  });
});

describe('applyAreaDerivation', () => {
  it('overwrites area and area unit in derived mode', () => {
    const result = applyAreaDerivation(PLOT, 'derived');
    expect(result.area).toBe(1000);
    expect(result.defaultAreaUnits).toBe('m2');
  });

  it('leaves area and area unit untouched in manual mode', () => {
    const result = applyAreaDerivation(PLOT, 'manual');
    expect(result.area).toBe(999);
    expect(result.defaultAreaUnits).toBe('km2');
  });

  it('returns the same object reference in manual mode so React state setters do not see a new value', () => {
    expect(applyAreaDerivation(PLOT, 'manual')).toBe(PLOT);
  });

  it('does not mutate its argument', () => {
    applyAreaDerivation(PLOT, 'derived');
    expect(PLOT.area).toBe(999);
  });

  it('preserves unrelated plot fields', () => {
    const withName = { ...PLOT, plotName: 'Niobrara' };
    expect(applyAreaDerivation(withName, 'derived').plotName).toBe('Niobrara');
  });
});

describe('resolvePlotAreaChange', () => {
  it('keeps the current mode when no mode is requested', () => {
    const result = resolvePlotAreaChange(PLOT, 'manual');
    expect(result.areaMode).toBe('manual');
    expect(result.plot.area).toBe(999);
  });

  it('lets a requested manual mode win over a current derived mode, without re-deriving the returned plot', () => {
    // This is the regression that would have shipped a wrong area: the plot passed in
    // already carries the user's just-typed manual value (area: 999), so resolving to
    // 'manual' must hand that value straight through rather than overwriting it with
    // dimensionX * dimensionY.
    const result = resolvePlotAreaChange(PLOT, 'derived', 'manual');
    expect(result.areaMode).toBe('manual');
    expect(result.plot.area).toBe(999);
    expect(result.plot.defaultAreaUnits).toBe('km2');
  });

  it('lets a requested derived mode win over a current manual mode, and re-derives the returned plot', () => {
    const result = resolvePlotAreaChange(PLOT, 'manual', 'derived');
    expect(result.areaMode).toBe('derived');
    expect(result.plot.area).toBe(1000);
    expect(result.plot.defaultAreaUnits).toBe('m2');
  });
});
