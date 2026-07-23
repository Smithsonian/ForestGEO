import { describe, it, expect } from 'vitest';
import { ProvisioningInputSchema, ProvisioningPlotSchema, ProvisioningQuadratsRequestSchema } from './input-schema';
import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';

describe('ProvisioningQuadratsRequestSchema', () => {
  it('accepts grid mode', () => {
    const result = ProvisioningQuadratsRequestSchema.safeParse({ mode: 'grid', quadratSizeX: 20, quadratSizeY: 20, namingPattern: 'sequential' });
    expect(result.success).toBe(true);
  });

  it('accepts csv mode with at least one row', () => {
    const result = ProvisioningQuadratsRequestSchema.safeParse({
      mode: 'csv',
      rows: [{ quadratName: 'C01', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 }],
      coordinateReferenceCorner: 'SW'
    });
    expect(result.success).toBe(true);
  });

  it('accepts none mode (create no quadrats now)', () => {
    const result = ProvisioningQuadratsRequestSchema.safeParse({ mode: 'none' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown mode', () => {
    const result = ProvisioningQuadratsRequestSchema.safeParse({ mode: 'auto' });
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

  it("rejects 'm', a dimension unit, in the area slot", () => {
    const result = ProvisioningPlotSchema.safeParse({ ...VALID_PLOT, defaultAreaUnits: 'm' });
    expect(result.success).toBe(false);
  });

  it('rejects a free-text dimension unit', () => {
    const result = ProvisioningPlotSchema.safeParse({ ...VALID_PLOT, defaultDimensionUnits: 'metres' });
    expect(result.success).toBe(false);
  });

  const DIMENSION_UNIT_FIELDS = ['defaultDimensionUnits', 'defaultCoordinateUnits', 'defaultDBHUnits', 'defaultHOMUnits'] as const;

  it('accepts every member of the enums it draws from', () => {
    for (const field of DIMENSION_UNIT_FIELDS) {
      for (const unit of unitSelectionOptions) {
        expect(ProvisioningPlotSchema.safeParse({ ...VALID_PLOT, [field]: unit }).success).toBe(true);
      }
    }
    for (const unit of areaSelectionOptions) {
      expect(ProvisioningPlotSchema.safeParse({ ...VALID_PLOT, defaultAreaUnits: unit }).success).toBe(true);
    }
  });
});

const BASE_REQUEST = {
  site: {
    siteName: 'Niobrara',
    schemaName: 'forestgeo_niobrara',
    sqDimX: 5,
    sqDimY: 5,
    defaultUOMDBH: 'mm',
    defaultUOMHOM: 'm',
    doubleDataEntry: false,
    location: 'Nebraska',
    country: 'USA'
  },
  plot: VALID_PLOT,
  quadrats: {
    mode: 'csv' as const,
    coordinateReferenceCorner: 'NE' as const,
    rows: [
      { quadratName: 'A', startX: 20, startY: 20, dimensionX: 20, dimensionY: 20 },
      { quadratName: 'B', startX: 100, startY: 100, dimensionX: 20, dimensionY: 20 }
    ]
  }
};

describe('ProvisioningInputSchema canonicalization', () => {
  it('accepts a north-east referenced payload that the south-west reading would reject', () => {
    expect(ProvisioningInputSchema.safeParse(BASE_REQUEST).success).toBe(true);
  });

  it('returns canonical south-west rows as the parsed output, not just a validation copy', () => {
    const result = ProvisioningInputSchema.safeParse(BASE_REQUEST);
    if (!result.success) throw new Error('expected success');
    const quadrats = result.data.quadrats;
    if (quadrats.mode !== 'csv') throw new Error('expected csv mode');
    expect(quadrats.rows).toEqual([
      { quadratName: 'A', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 },
      { quadratName: 'B', startX: 80, startY: 80, dimensionX: 20, dimensionY: 20 }
    ]);
    expect(quadrats.coordinates).toBe('canonical-sw');
    expect(quadrats.sourceCoordinateReferenceCorner).toBe('NE');
  });

  it('rejects a genuinely out-of-bounds layout under every reference corner', () => {
    for (const corner of ['SW', 'SE', 'NW', 'NE'] as const) {
      const result = ProvisioningInputSchema.safeParse({
        ...BASE_REQUEST,
        quadrats: {
          mode: 'csv',
          coordinateReferenceCorner: corner,
          rows: [{ quadratName: 'Way out', startX: 500, startY: 500, dimensionX: 20, dimensionY: 20 }]
        }
      });
      expect(result.success, `corner ${corner} should be rejected`).toBe(false);
    }
  });

  it('rejects rows that normalize to negative coordinates', () => {
    const result = ProvisioningInputSchema.safeParse({
      ...BASE_REQUEST,
      quadrats: {
        mode: 'csv',
        coordinateReferenceCorner: 'NE',
        rows: [{ quadratName: 'Below origin', startX: 10, startY: 10, dimensionX: 20, dimensionY: 20 }]
      }
    });
    expect(result.success).toBe(false);
  });

  it('detects overlaps after normalization', () => {
    const result = ProvisioningInputSchema.safeParse({
      ...BASE_REQUEST,
      quadrats: {
        mode: 'csv',
        coordinateReferenceCorner: 'NE',
        rows: [
          { quadratName: 'A', startX: 30, startY: 30, dimensionX: 30, dimensionY: 30 },
          { quadratName: 'B', startX: 50, startY: 50, dimensionX: 30, dimensionY: 30 }
        ]
      }
    });
    expect(result.success).toBe(false);
  });

  it('accepts overlapping rows when acknowledged, carrying the acknowledgment text into the canonical payload', () => {
    const ACKNOWLEDGMENT = 'I confirm the overlapping quadrat footprints in this upload reflect field measurements.';
    const result = ProvisioningInputSchema.safeParse({
      ...BASE_REQUEST,
      quadrats: {
        mode: 'csv',
        coordinateReferenceCorner: 'NE',
        overlapAcknowledgment: ACKNOWLEDGMENT,
        rows: [
          { quadratName: 'A', startX: 30, startY: 30, dimensionX: 30, dimensionY: 30 },
          { quadratName: 'B', startX: 50, startY: 50, dimensionX: 30, dimensionY: 30 }
        ]
      }
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.quadrats.mode === 'csv') {
      // The stored run payload is the provenance record, so the text must survive canonicalization.
      expect(result.data.quadrats.overlapAcknowledgment).toBe(ACKNOWLEDGMENT);
    }
  });

  it('acknowledgment does not bypass non-overlap defects (out-of-bounds row still rejects)', () => {
    const result = ProvisioningInputSchema.safeParse({
      ...BASE_REQUEST,
      quadrats: {
        mode: 'csv',
        coordinateReferenceCorner: 'SW',
        overlapAcknowledgment: 'Overlaps reflect field measurements.',
        rows: [{ quadratName: 'TooFar', startX: 95, startY: 0, dimensionX: 20, dimensionY: 20 }]
      }
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate quadrat names case-insensitively after trimming', () => {
    const result = ProvisioningInputSchema.safeParse({
      ...BASE_REQUEST,
      quadrats: {
        mode: 'csv',
        coordinateReferenceCorner: 'SW',
        rows: [
          { quadratName: ' Q01 ', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 },
          { quadratName: 'q01', startX: 20, startY: 0, dimensionX: 20, dimensionY: 20 }
        ]
      }
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(issue => issue.message.includes('must be unique'))).toBe(true);
    }
  });

  it('trims quadrat names in canonical output', () => {
    const result = ProvisioningInputSchema.safeParse({
      ...BASE_REQUEST,
      quadrats: {
        mode: 'csv',
        coordinateReferenceCorner: 'SW',
        rows: [{ quadratName: ' Q01 ', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 }]
      }
    });

    if (!result.success) throw new Error('expected success');
    if (result.data.quadrats.mode !== 'csv') throw new Error('expected csv mode');
    expect(result.data.quadrats.rows[0].quadratName).toBe('Q01');
  });

  it('leaves grid mode untouched by canonicalization', () => {
    const result = ProvisioningInputSchema.safeParse({
      ...BASE_REQUEST,
      quadrats: { mode: 'grid', quadratSizeX: 20, quadratSizeY: 20, namingPattern: 'sequential' }
    });
    if (!result.success) throw new Error('expected success');
    expect(result.data.quadrats.mode).toBe('grid');
  });

  it('requires the reference corner to be declared on the wire', () => {
    const result = ProvisioningQuadratsRequestSchema.safeParse({
      mode: 'csv',
      rows: [{ quadratName: 'A', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 }]
    });
    expect(result.success).toBe(false);
  });
});
