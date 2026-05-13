import { describe, it, expect } from 'vitest';
import { generateGrid, MAX_GENERATED_QUADRATS } from './grid-generator';
import type { ProvisioningInput, QuadratGridConfig } from './types';

const PLOT_100x100: ProvisioningInput['plot'] = {
  plotName: 'P',
  dimensionX: 100,
  dimensionY: 100,
  area: 10000,
  globalX: 0,
  globalY: 0,
  globalZ: 0,
  plotShape: 'square',
  description: '',
  defaultDimensionUnits: 'm',
  defaultCoordinateUnits: 'm',
  defaultAreaUnits: 'm2',
  defaultDBHUnits: 'mm',
  defaultHOMUnits: 'm'
};

describe('generateGrid', () => {
  it('generates 25 rows for a 100x100 plot with 20x20 quadrats', () => {
    const cfg: QuadratGridConfig = {
      mode: 'grid',
      quadratSizeX: 20,
      quadratSizeY: 20,
      namingPattern: 'sequential'
    };
    const rows = generateGrid(PLOT_100x100, cfg);
    expect(rows).toHaveLength(25);
  });

  it('sequential naming: Q0001 to Q0025, zero-padded to 4 digits', () => {
    const cfg: QuadratGridConfig = {
      mode: 'grid',
      quadratSizeX: 20,
      quadratSizeY: 20,
      namingPattern: 'sequential'
    };
    const rows = generateGrid(PLOT_100x100, cfg);
    expect(rows[0].quadratName).toBe('Q0001');
    expect(rows[24].quadratName).toBe('Q0025');
  });

  it('row-col naming: <row>-<col>, 1-indexed', () => {
    const cfg: QuadratGridConfig = {
      mode: 'grid',
      quadratSizeX: 20,
      quadratSizeY: 20,
      namingPattern: 'row-col'
    };
    const rows = generateGrid(PLOT_100x100, cfg);
    expect(rows[0].quadratName).toBe('1-1');
    expect(rows[1].quadratName).toBe('1-2');
    expect(rows[5].quadratName).toBe('2-1');
    expect(rows[24].quadratName).toBe('5-5');
  });

  it('coordinates: rows ordered row-major (Y-major)', () => {
    const cfg: QuadratGridConfig = {
      mode: 'grid',
      quadratSizeX: 20,
      quadratSizeY: 20,
      namingPattern: 'sequential'
    };
    const rows = generateGrid(PLOT_100x100, cfg);
    expect(rows[0]).toMatchObject({ startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 });
    expect(rows[1]).toMatchObject({ startX: 20, startY: 0 });
    expect(rows[4]).toMatchObject({ startX: 80, startY: 0 });
    expect(rows[5]).toMatchObject({ startX: 0, startY: 20 });
  });

  it('throws when dimensions not divisible', () => {
    const cfg: QuadratGridConfig = {
      mode: 'grid',
      quadratSizeX: 30,
      quadratSizeY: 20,
      namingPattern: 'sequential'
    };
    expect(() => generateGrid(PLOT_100x100, cfg)).toThrow(/not divisible/);
  });

  it('throws before materializing more than the allowed quadrat cap', () => {
    const cfg: QuadratGridConfig = {
      mode: 'grid',
      quadratSizeX: 1,
      quadratSizeY: 1,
      namingPattern: 'sequential'
    };
    const hugePlot = {
      ...PLOT_100x100,
      dimensionX: MAX_GENERATED_QUADRATS + 1,
      dimensionY: 1
    };

    expect(() => generateGrid(hugePlot, cfg)).toThrow(/maximum allowed/);
  });
});
