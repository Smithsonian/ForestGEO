import { describe, it, expect } from 'vitest';
import {
  EPSG_CODE_MAX,
  EPSG_CODE_MIN,
  GLOBAL_COORDINATE_ABS_MAX,
  ProvisioningInputSchema,
  ProvisioningPlotSchema,
  ProvisioningQuadratsSchema
} from './input-schema';
import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';
import {
  buildQuadratOverlapAcknowledgment,
  QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT,
  validateQuadratCollectionDetailed
} from './quadrat-collection-validation';

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

describe('ProvisioningPlotSchema global coordinates', () => {
  // Provisioning run 5 (forestgeo_ldw, 2026-08-04): NAD83 / UTM zone 16N origin.
  // GlobalY 4343000 overflowed the old DECIMAL(12,6) column mid-run; the widened
  // DECIMAL(15,6) column and this schema must both accept it.
  const UTM_ZONE_16N_ORIGIN = { globalX: 567225, globalY: 4343000, globalZ: 224 };
  const NAD83_UTM_ZONE_16N_EPSG = 26916;

  it('accepts a projected UTM origin (the forestgeo_ldw regression values)', () => {
    const result = ProvisioningPlotSchema.safeParse({ ...VALID_PLOT, ...UTM_ZONE_16N_ORIGIN });
    expect(result.success).toBe(true);
  });

  it('accepts the extreme southern-hemisphere UTM northing of 10,000,000 m', () => {
    expect(ProvisioningPlotSchema.safeParse({ ...VALID_PLOT, globalY: 10_000_000 }).success).toBe(true);
  });

  it('rejects a coordinate beyond the DECIMAL(15,6) column ceiling, explaining the expected units', () => {
    const result = ProvisioningPlotSchema.safeParse({ ...VALID_PLOT, globalY: GLOBAL_COORDINATE_ABS_MAX * 10 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(i => i.path.join('.') === 'globalY');
      expect(issue?.message).toContain('linear coordinate');
      expect(issue?.message).toContain('UTM');
    }
  });

  it('rejects a non-finite coordinate', () => {
    expect(ProvisioningPlotSchema.safeParse({ ...VALID_PLOT, globalX: Infinity }).success).toBe(false);
    expect(ProvisioningPlotSchema.safeParse({ ...VALID_PLOT, globalX: NaN }).success).toBe(false);
  });

  it('accepts a recorded EPSG code and carries it through parsing', () => {
    const result = ProvisioningPlotSchema.safeParse({ ...VALID_PLOT, ...UTM_ZONE_16N_ORIGIN, globalCoordinatesEPSG: NAD83_UTM_ZONE_16N_EPSG });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.globalCoordinatesEPSG).toBe(NAD83_UTM_ZONE_16N_EPSG);
    }
  });

  it('accepts an absent EPSG code as "not recorded"', () => {
    const result = ProvisioningPlotSchema.safeParse(VALID_PLOT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.globalCoordinatesEPSG).toBeUndefined();
    }
  });

  it('rejects EPSG codes outside the registry range and non-integers', () => {
    expect(ProvisioningPlotSchema.safeParse({ ...VALID_PLOT, globalCoordinatesEPSG: EPSG_CODE_MIN - 1 }).success).toBe(false);
    expect(ProvisioningPlotSchema.safeParse({ ...VALID_PLOT, globalCoordinatesEPSG: EPSG_CODE_MAX + 1 }).success).toBe(false);
    expect(ProvisioningPlotSchema.safeParse({ ...VALID_PLOT, globalCoordinatesEPSG: 26916.5 }).success).toBe(false);
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
    rows: [
      { quadratName: 'A', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 },
      { quadratName: 'B', startX: 80, startY: 80, dimensionX: 20, dimensionY: 20 }
    ]
  }
};

describe('ProvisioningInputSchema', () => {
  it('accepts a south-west payload that lies inside the plot', () => {
    expect(ProvisioningInputSchema.safeParse(BASE_REQUEST).success).toBe(true);
  });

  it('returns the submitted rows unchanged: coordinates are validated, never re-oriented', () => {
    const result = ProvisioningInputSchema.safeParse(BASE_REQUEST);
    if (!result.success) throw new Error('expected success');
    const quadrats = result.data.quadrats;
    if (quadrats.mode !== 'csv') throw new Error('expected csv mode');
    expect(quadrats.rows).toEqual(BASE_REQUEST.quadrats.rows);
  });

  it('rejects a payload whose coordinates name each quadrat’s north-east corner', () => {
    // The same physical layout as BASE_REQUEST recorded against the upper-right corner:
    // 'B' then reaches 120, past the 100×100 plot. The researcher converts the file; the
    // schema does not.
    const result = ProvisioningInputSchema.safeParse({
      ...BASE_REQUEST,
      quadrats: {
        mode: 'csv',
        rows: [
          { quadratName: 'A', startX: 20, startY: 20, dimensionX: 20, dimensionY: 20 },
          { quadratName: 'B', startX: 100, startY: 100, dimensionX: 20, dimensionY: 20 }
        ]
      }
    });
    expect(result.success).toBe(false);
  });

  it('ignores a stale coordinateReferenceCorner field instead of re-orienting the rows', () => {
    const result = ProvisioningInputSchema.safeParse({
      ...BASE_REQUEST,
      quadrats: {
        mode: 'csv',
        coordinateReferenceCorner: 'NE',
        rows: [{ quadratName: 'B', startX: 100, startY: 100, dimensionX: 20, dimensionY: 20 }]
      }
    });
    expect(result.success).toBe(false);
  });

  it('rejects a genuinely out-of-bounds layout', () => {
    const result = ProvisioningInputSchema.safeParse({
      ...BASE_REQUEST,
      quadrats: {
        mode: 'csv',
        rows: [{ quadratName: 'Way out', startX: 500, startY: 500, dimensionX: 20, dimensionY: 20 }]
      }
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative start coordinate', () => {
    const result = ProvisioningInputSchema.safeParse({
      ...BASE_REQUEST,
      quadrats: {
        mode: 'csv',
        rows: [{ quadratName: 'Below origin', startX: -10, startY: -10, dimensionX: 20, dimensionY: 20 }]
      }
    });
    expect(result.success).toBe(false);
  });

  it('detects overlapping footprints', () => {
    const result = ProvisioningInputSchema.safeParse({
      ...BASE_REQUEST,
      quadrats: {
        mode: 'csv',
        rows: [
          { quadratName: 'A', startX: 30, startY: 30, dimensionX: 30, dimensionY: 30 },
          { quadratName: 'B', startX: 50, startY: 50, dimensionX: 30, dimensionY: 30 }
        ]
      }
    });
    expect(result.success).toBe(false);
  });

  it('accepts overlapping rows when acknowledged, carrying the acknowledgment text into the parsed payload', () => {
    const rows = [
      { quadratName: 'A', startX: 30, startY: 30, dimensionX: 30, dimensionY: 30 },
      { quadratName: 'B', startX: 50, startY: 50, dimensionX: 30, dimensionY: 30 }
    ];
    const overlapSummary = validateQuadratCollectionDetailed(rows, BASE_REQUEST.plot).overlapSummary;
    if (!overlapSummary) throw new Error('expected overlap summary');
    const ACKNOWLEDGMENT = buildQuadratOverlapAcknowledgment([overlapSummary.layoutSignature]);
    const result = ProvisioningInputSchema.safeParse({
      ...BASE_REQUEST,
      quadrats: {
        mode: 'csv',
        overlapAcknowledgment: ACKNOWLEDGMENT,
        rows
      }
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.quadrats.mode === 'csv') {
      // The stored run payload is the provenance record, so the text must survive parsing.
      expect(result.data.quadrats.overlapAcknowledgment).toEqual(ACKNOWLEDGMENT);
    }
  });

  it('rejects a free-form overlap acknowledgment instead of treating any non-empty string as confirmation', () => {
    const result = ProvisioningInputSchema.safeParse({
      ...BASE_REQUEST,
      quadrats: {
        mode: 'csv',
        overlapAcknowledgment: 'acknowledged',
        rows: [
          { quadratName: 'A', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 },
          { quadratName: 'B', startX: 10, startY: 10, dimensionX: 20, dimensionY: 20 }
        ]
      }
    });
    expect(result.success).toBe(false);
  });

  it('acknowledgment does not bypass non-overlap defects (out-of-bounds row still rejects)', () => {
    const result = ProvisioningInputSchema.safeParse({
      ...BASE_REQUEST,
      quadrats: {
        mode: 'csv',
        overlapAcknowledgment: {
          statement: QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT,
          layoutSignatures: ['quadrat-layout-v1-0000000000000000']
        },
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
        rows: [{ quadratName: ' Q01 ', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 }]
      }
    });

    if (!result.success) throw new Error('expected success');
    if (result.data.quadrats.mode !== 'csv') throw new Error('expected csv mode');
    expect(result.data.quadrats.rows[0].quadratName).toBe('Q01');
  });

  it('leaves grid mode untouched', () => {
    const result = ProvisioningInputSchema.safeParse({
      ...BASE_REQUEST,
      quadrats: { mode: 'grid', quadratSizeX: 20, quadratSizeY: 20, namingPattern: 'sequential' }
    });
    if (!result.success) throw new Error('expected success');
    expect(result.data.quadrats.mode).toBe('grid');
  });

  it('is idempotent, so re-parsing a stored payload never shifts its coordinates', () => {
    const first = ProvisioningInputSchema.safeParse(BASE_REQUEST);
    if (!first.success) throw new Error('expected success');
    const second = ProvisioningInputSchema.safeParse(JSON.parse(JSON.stringify(first.data)));
    if (!second.success) throw new Error('expected re-parse to succeed');
    expect(second.data).toEqual(first.data);
  });
});
