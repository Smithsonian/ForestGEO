import { describe, it, expect } from 'vitest';
import { isQuadratReferenceCorner, normalizeToSouthwest, upgradeLegacyQuadratConfig, REFERENCE_CORNER_OPTIONS } from './coordinate-reference-corner';
import { generateGrid } from './grid-generator';
import { findFirstOverlap } from './geometry';

const PLOT_100 = {
  plotName: 'T',
  dimensionX: 100,
  dimensionY: 100,
  area: 10000,
  globalX: 0,
  globalY: 0,
  globalZ: 0,
  plotShape: 'square' as const,
  description: '',
  defaultDimensionUnits: 'm' as const,
  defaultCoordinateUnits: 'm' as const,
  defaultAreaUnits: 'm2' as const,
  defaultDBHUnits: 'mm' as const,
  defaultHOMUnits: 'm' as const
};

const ROW = { quadratName: 'A', startX: 20, startY: 20, dimensionX: 20, dimensionY: 20 };

describe('normalizeToSouthwest', () => {
  it('leaves a south-west referenced row unchanged', () => {
    expect(normalizeToSouthwest(ROW, 'SW')).toEqual(ROW);
  });

  it('returns the same row reference for the south-west identity case', () => {
    expect(normalizeToSouthwest(ROW, 'SW')).toBe(ROW);
  });

  it('subtracts the width for a south-east referenced row', () => {
    expect(normalizeToSouthwest(ROW, 'SE')).toEqual({ ...ROW, startX: 0, startY: 20 });
  });

  it('subtracts the height for a north-west referenced row', () => {
    expect(normalizeToSouthwest(ROW, 'NW')).toEqual({ ...ROW, startX: 20, startY: 0 });
  });

  it('subtracts both for a north-east referenced row', () => {
    expect(normalizeToSouthwest(ROW, 'NE')).toEqual({ ...ROW, startX: 0, startY: 0 });
  });

  it('never alters the dimensions', () => {
    for (const corner of REFERENCE_CORNER_OPTIONS.map(o => o.value)) {
      const out = normalizeToSouthwest(ROW, corner);
      expect(out.dimensionX).toBe(20);
      expect(out.dimensionY).toBe(20);
    }
  });

  it('preserves the quadrat name', () => {
    expect(normalizeToSouthwest(ROW, 'NE').quadratName).toBe('A');
  });

  it('offers exactly the four corners', () => {
    expect(REFERENCE_CORNER_OPTIONS.map(o => o.value)).toEqual(['SW', 'SE', 'NW', 'NE']);
  });

  it('recognizes only supported reference-corner values', () => {
    expect(['SW', 'SE', 'NW', 'NE'].every(isQuadratReferenceCorner)).toBe(true);
    expect(isQuadratReferenceCorner('south-west')).toBe(false);
    expect(isQuadratReferenceCorner('')).toBe(false);
    expect(isQuadratReferenceCorner(null)).toBe(false);
  });
});

describe('north-east referenced grid regression', () => {
  // The case currently hard-blocked in the wizard: a full 100x100 plot of
  // 20x20 quadrats whose coordinates name the upper-right corner, so the
  // outer row and column read as 100 and trip the bounds check.
  const canonical = generateGrid(PLOT_100, { mode: 'grid', quadratSizeX: 20, quadratSizeY: 20, namingPattern: 'sequential' });
  const northEastRows = canonical.map(row => ({
    ...row,
    startX: row.startX + row.dimensionX,
    startY: row.startY + row.dimensionY
  }));

  it('has outer-edge coordinates equal to the plot dimensions before normalization', () => {
    expect(Math.max(...northEastRows.map(r => r.startX))).toBe(100);
    expect(Math.min(...northEastRows.map(r => r.startX))).toBe(20);
  });

  it('normalizes back to exactly the canonical south-west grid', () => {
    const normalized = northEastRows.map(row => normalizeToSouthwest(row, 'NE'));
    expect(normalized).toEqual(canonical);
  });

  it('produces no out-of-bounds rows and no overlaps after normalization', () => {
    const normalized = northEastRows.map(row => normalizeToSouthwest(row, 'NE'));
    for (const row of normalized) {
      expect(row.startX).toBeGreaterThanOrEqual(0);
      expect(row.startY).toBeGreaterThanOrEqual(0);
      expect(row.startX + row.dimensionX).toBeLessThanOrEqual(PLOT_100.dimensionX);
      expect(row.startY + row.dimensionY).toBeLessThanOrEqual(PLOT_100.dimensionY);
    }
    expect(findFirstOverlap(normalized)).toBeNull();
  });
});

describe('upgradeLegacyQuadratConfig', () => {
  it('marks a pre-change stored CSV payload as canonical south-west', () => {
    const legacy = { mode: 'csv' as const, rows: [ROW] };
    expect(upgradeLegacyQuadratConfig(legacy)).toEqual({
      mode: 'csv',
      rows: [ROW],
      coordinates: 'canonical-sw',
      sourceCoordinateReferenceCorner: 'SW'
    });
  });

  it('leaves an already-canonical payload untouched', () => {
    const canonical = { mode: 'csv' as const, rows: [ROW], coordinates: 'canonical-sw' as const, sourceCoordinateReferenceCorner: 'NE' as const };
    expect(upgradeLegacyQuadratConfig(canonical)).toBe(canonical);
  });

  it('passes grid and none payloads straight through', () => {
    const grid = { mode: 'grid' as const, quadratSizeX: 20, quadratSizeY: 20, namingPattern: 'sequential' as const };
    expect(upgradeLegacyQuadratConfig(grid)).toBe(grid);
    const none = { mode: 'none' as const };
    expect(upgradeLegacyQuadratConfig(none)).toBe(none);
  });
});
