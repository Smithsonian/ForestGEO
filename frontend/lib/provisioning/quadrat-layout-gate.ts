import { generateGrid } from './grid-generator';
import { ProvisioningQuadratsSchema } from './input-schema';
import { acknowledgmentCoversLayout, validateQuadratCollectionDetailed } from './quadrat-collection-validation';
import type { ProvisioningInput } from './types';

/**
 * The Quadrats-step Next-button gate. Lives outside app/(hub)/admin/provision/page.tsx
 * (rather than being exported from it) because Next.js's generated page-entry type check
 * (build/types/app/.../page.ts) only permits a page.tsx to export a fixed set of route
 * symbols (default, metadata, generateStaticParams, ...) — any other named export fails
 * that check under `tsc --noEmit`. The page still owns `deriveCanAdvance` and imports this.
 */
export function quadratLayoutIsValid(input: ProvisioningInput): boolean {
  if (!ProvisioningQuadratsSchema.safeParse(input.quadrats).success) return false;

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
  const rows = csvQuadrats.rows;
  if (rows.length === 0) return false;
  // Acknowledged overlaps are valid field measurements, not layout defects (mirrors the
  // input schema's superRefine policy). Unacknowledged overlaps still fail the gate.
  const { fatalIssues, overlapSummary } = validateQuadratCollectionDetailed(rows, input.plot);
  const overlapsAcknowledged = overlapSummary !== null && acknowledgmentCoversLayout(csvQuadrats.overlapAcknowledgment, overlapSummary.layoutSignature);
  return fatalIssues.length === 0 && (overlapSummary === null || overlapsAcknowledged);
}
