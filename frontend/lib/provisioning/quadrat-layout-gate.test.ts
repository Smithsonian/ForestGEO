/**
 * quadratLayoutIsValid — the Quadrats-step Next-button gate.
 *
 * This is the exact function `deriveCanAdvance` in app/(hub)/admin/provision/page.tsx calls
 * to decide whether the wizard's Next button is enabled on the Quadrats step. It lives in
 * lib/provisioning/quadrat-layout-gate.ts (rather than being exported from page.tsx itself)
 * because Next.js's generated page-entry type check (build/types/app/.../page.ts) only
 * permits a page.tsx to export a fixed set of route symbols, so any other named export
 * fails `tsc --noEmit`. Co-located here alongside quadrat-layout-gate.ts per the convention
 * every other file in lib/provisioning/ follows — which also means it runs under
 * vitest.integration.config.mts (lib/provisioning/** is excluded from the unit config),
 * not the unit config page.tsx itself is tested from.
 *
 * South-west is the only coordinate convention the gate reads. A CSV whose rows name the
 * north-east corner of each quadrat (e.g. the Niobrara plot) must therefore be rejected —
 * its outer row and column fall outside the plot — rather than silently re-oriented.
 */

import { describe, it, expect } from 'vitest';
import { quadratLayoutIsValid } from '@/lib/provisioning/quadrat-layout-gate';
import type { ProvisioningInput, QuadratCsvRow } from '@/lib/provisioning/types';
import { buildQuadratOverlapAcknowledgment, validateQuadratCollectionDetailed } from '@/lib/provisioning/quadrat-collection-validation';

const SITE: ProvisioningInput['site'] = {
  siteName: 'Niobrara',
  schemaName: 'forestgeo_niobrara',
  sqDimX: 5,
  sqDimY: 5,
  defaultUOMDBH: 'mm',
  defaultUOMHOM: 'm',
  doubleDataEntry: false,
  location: 'Nebraska',
  country: 'USA'
};

const PLOT_100x100: ProvisioningInput['plot'] = {
  plotName: 'Niobrara Plot',
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

const QUADRAT_SIZE = 20;
const GRID_ORIGINS = [0, 20, 40, 60, 80];

/** A 5×5 grid of 20×20 quadrats tiling the 100×100 plot exactly, in the supported south-west convention. */
const SOUTHWEST_GRID_ROWS: QuadratCsvRow[] = GRID_ORIGINS.flatMap((startY, rowIndex) =>
  GRID_ORIGINS.map((startX, colIndex) => ({
    quadratName: `Q${String(rowIndex * GRID_ORIGINS.length + colIndex + 1).padStart(4, '0')}`,
    startX,
    startY,
    dimensionX: QUADRAT_SIZE,
    dimensionY: QUADRAT_SIZE
  }))
);

// The same physical grid recorded against each quadrat's upper-right (north-east) corner:
// SOUTHWEST_GRID_ROWS with 20 added to every coordinate. The outer row and column then
// extend to 120, past the 100×100 plot.
const NORTHEAST_GRID_ROWS: QuadratCsvRow[] = [
  { quadratName: 'Q0001', startX: 20, startY: 20, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0002', startX: 40, startY: 20, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0003', startX: 60, startY: 20, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0004', startX: 80, startY: 20, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0005', startX: 100, startY: 20, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0006', startX: 20, startY: 40, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0007', startX: 40, startY: 40, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0008', startX: 60, startY: 40, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0009', startX: 80, startY: 40, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0010', startX: 100, startY: 40, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0011', startX: 20, startY: 60, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0012', startX: 40, startY: 60, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0013', startX: 60, startY: 60, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0014', startX: 80, startY: 60, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0015', startX: 100, startY: 60, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0016', startX: 20, startY: 80, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0017', startX: 40, startY: 80, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0018', startX: 60, startY: 80, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0019', startX: 80, startY: 80, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0020', startX: 100, startY: 80, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0021', startX: 20, startY: 100, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0022', startX: 40, startY: 100, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0023', startX: 60, startY: 100, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0024', startX: 80, startY: 100, dimensionX: 20, dimensionY: 20 },
  { quadratName: 'Q0025', startX: 100, startY: 100, dimensionX: 20, dimensionY: 20 }
];

function buildInput(rows: QuadratCsvRow[]): ProvisioningInput {
  return {
    site: SITE,
    plot: PLOT_100x100,
    quadrats: {
      mode: 'csv',
      rows
    }
  };
}

describe('quadratLayoutIsValid', () => {
  it('accepts a south-west grid that tiles the plot exactly', () => {
    expect(quadratLayoutIsValid(buildInput(SOUTHWEST_GRID_ROWS))).toBe(true);
  });

  it('rejects the north-east-labeled grid: the outer row and column extend past the plot', () => {
    expect(quadratLayoutIsValid(buildInput(NORTHEAST_GRID_ROWS))).toBe(false);
  });

  it('blocks duplicate quadrat names even when their geometry does not overlap', () => {
    const input = buildInput([
      { quadratName: 'Q01', startX: 20, startY: 20, dimensionX: 20, dimensionY: 20 },
      { quadratName: 'q01', startX: 40, startY: 20, dimensionX: 20, dimensionY: 20 }
    ]);

    expect(quadratLayoutIsValid(input)).toBe(false);
  });

  it('blocks overlapping rows without an acknowledgment, and passes them with one', () => {
    const input = buildInput([
      { quadratName: 'Q01', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 },
      { quadratName: 'Q02', startX: 10, startY: 10, dimensionX: 20, dimensionY: 20 }
    ]);
    if (input.quadrats.mode !== 'csv') throw new Error('expected csv mode');

    expect(quadratLayoutIsValid(input)).toBe(false);

    const summary = validateQuadratCollectionDetailed(input.quadrats.rows, input.plot).overlapSummary;
    if (!summary) throw new Error('expected overlap summary');
    input.quadrats.overlapAcknowledgment = buildQuadratOverlapAcknowledgment([summary.layoutSignature]);
    expect(quadratLayoutIsValid(input)).toBe(true);
  });
});
