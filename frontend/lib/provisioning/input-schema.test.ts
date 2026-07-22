import { describe, it, expect } from 'vitest';
import { ProvisioningPlotSchema, ProvisioningQuadratsSchema } from './input-schema';
import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';

describe('ProvisioningQuadratsSchema', () => {
  it('accepts grid mode', () => {
    const result = ProvisioningQuadratsSchema.safeParse({ mode: 'grid', quadratSizeX: 20, quadratSizeY: 20, namingPattern: 'sequential' });
    expect(result.success).toBe(true);
  });

  it('accepts csv mode with at least one row', () => {
    const result = ProvisioningQuadratsSchema.safeParse({
      mode: 'csv',
      rows: [{ quadratName: 'C01', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 }]
    });
    expect(result.success).toBe(true);
  });

  it('accepts none mode (create no quadrats now)', () => {
    const result = ProvisioningQuadratsSchema.safeParse({ mode: 'none' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown mode', () => {
    const result = ProvisioningQuadratsSchema.safeParse({ mode: 'auto' });
    expect(result.success).toBe(false);
  });
});

const VALID_PLOT = {
  plotName: 'Main Plot',
  dimensionX: 100,
  dimensionY: 100,
  area: 10000,
  globalX: 0,
  globalY: 0,
  globalZ: 0,
  plotShape: 'square' as const,
  description: '',
  defaultDimensionUnits: 'm',
  defaultCoordinateUnits: 'm',
  defaultAreaUnits: 'm2',
  defaultDBHUnits: 'mm',
  defaultHOMUnits: 'm'
};

describe('ProvisioningPlotSchema unit vocabulary', () => {
  it('accepts a plot whose units are all drawn from the app enums', () => {
    expect(ProvisioningPlotSchema.safeParse(VALID_PLOT).success).toBe(true);
  });

  it("rejects 'ha', which is not a member of areaSelectionOptions", () => {
    const result = ProvisioningPlotSchema.safeParse({ ...VALID_PLOT, defaultAreaUnits: 'ha' });
    expect(result.success).toBe(false);
  });

  it('rejects a free-text dimension unit', () => {
    const result = ProvisioningPlotSchema.safeParse({ ...VALID_PLOT, defaultDimensionUnits: 'metres' });
    expect(result.success).toBe(false);
  });

  it('accepts every member of the enums it draws from', () => {
    for (const unit of unitSelectionOptions) {
      expect(ProvisioningPlotSchema.safeParse({ ...VALID_PLOT, defaultDimensionUnits: unit }).success).toBe(true);
    }
    for (const unit of areaSelectionOptions) {
      expect(ProvisioningPlotSchema.safeParse({ ...VALID_PLOT, defaultAreaUnits: unit }).success).toBe(true);
    }
  });
});
