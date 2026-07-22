import { generateGrid } from './grid-generator';
import { ProvisioningQuadratsRequestSchema } from './input-schema';
import { findFirstOverlap } from './geometry';
import { normalizeToSouthwest } from './coordinate-reference-corner';
import type { ProvisioningRequestInput } from './types';

/**
 * The Quadrats-step Next-button gate. Lives outside app/(hub)/admin/provision/page.tsx
 * (rather than being exported from it) because Next.js's generated page-entry type check
 * (build/types/app/.../page.ts) only permits a page.tsx to export a fixed set of route
 * symbols (default, metadata, generateStaticParams, ...) — any other named export fails
 * that check under `tsc --noEmit`. The page still owns `deriveCanAdvance` and imports this.
 */
export function quadratLayoutIsValid(input: ProvisioningRequestInput): boolean {
  if (!ProvisioningQuadratsRequestSchema.safeParse(input.quadrats).success) return false;

  if (input.quadrats.mode === 'grid') {
    try {
      generateGrid(input.plot, input.quadrats);
      return true;
    } catch {
      return false;
    }
  }

  if (input.quadrats.mode === 'none') {
    return true;
  }

  const csvQuadrats = input.quadrats;
  const rows = csvQuadrats.rows.map(row => normalizeToSouthwest(row, csvQuadrats.coordinateReferenceCorner));
  if (rows.length === 0) return false;
  for (const row of rows) {
    if (row.startX < 0 || row.startY < 0) return false;
    if (row.startX + row.dimensionX > input.plot.dimensionX) return false;
    if (row.startY + row.dimensionY > input.plot.dimensionY) return false;
  }

  if (findFirstOverlap(rows)) return false;

  return true;
}
