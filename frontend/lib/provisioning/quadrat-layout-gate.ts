import { generateGrid } from './grid-generator';
import { ProvisioningQuadratsRequestSchema } from './input-schema';
import { normalizeToSouthwest } from './coordinate-reference-corner';
import { validateQuadratCollection } from './quadrat-collection-validation';
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
  return validateQuadratCollection(rows, input.plot, 'SW').length === 0;
}
