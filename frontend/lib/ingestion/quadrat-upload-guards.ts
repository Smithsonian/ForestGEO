/**
 * Guards for quadrat CSV uploads.
 *
 * Background: a Revisions upload updates existing quadrats matched by QuadratName
 * (case-insensitive) and inserts every non-matching row as new. When a plot was
 * provisioned with an auto-generated placeholder grid (e.g. Q00001…Q00527) and a
 * researcher then uploads their real quadrats under a different naming scheme
 * (e.g. C01, D01, …), NONE of the incoming names match, so every real quadrat is
 * appended on top of the placeholders — silently doubling the quadrat count.
 *
 * These helpers detect the specific generated-placeholder replacement case so the
 * upload can be refused before any row is written. Ordinary Revisions uploads
 * must still be allowed to add a new quadrat to an established layout.
 */

import { SEQUENTIAL_QUADRAT_NAME_PATTERN } from '@/lib/provisioning/grid-generator';

const MAX_SAMPLE_NAMES = 10;
const MIN_REPLACEMENT_FRACTION = 0.5;
const MAX_MATCH_FRACTION = 0.1;

function normalizeQuadratName(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * True when a large, almost entirely non-matching file appears to replace a
 * generated sequential placeholder grid. This deliberately does not reject
 * ordinary non-overlapping Revisions uploads: those are the supported way to add
 * new quadrats to an established layout.
 */
export function quadratRevisionAppendsDivergentSet(existingActiveNames: string[], incomingNames: string[]): boolean {
  const existing = new Set(existingActiveNames.map(normalizeQuadratName).filter(Boolean));
  if (existing.size === 0) return false;

  // Only the old sequential grid is known to be a disposable placeholder. Other
  // layouts may legitimately receive a wholly new set of quadrats by revision.
  if (![...existing].every(name => SEQUENTIAL_QUADRAT_NAME_PATTERN.test(name))) return false;

  const incoming = new Set(incomingNames.map(normalizeQuadratName).filter(Boolean));
  if (incoming.size === 0) return false;

  // A large Q##### extension is still the same generated naming scheme, not a
  // replacement layout. This also lets later chunks of one clean re-upload append
  // after the first chunk performed the reset.
  if ([...incoming].every(name => SEQUENTIAL_QUADRAT_NAME_PATTERN.test(name))) return false;

  // A single (or otherwise small) addition to a placeholder grid is still a valid
  // Revisions upload. A near-full replacement is the dangerous case seen at Cooks
  // Branch. Count a tiny accidental overlap as divergent too, so it cannot bypass
  // the guard simply by sharing one generated name.
  if (incoming.size < Math.ceil(existing.size * MIN_REPLACEMENT_FRACTION)) return false;
  const matchingNames = [...incoming].filter(name => existing.has(name)).length;

  return matchingNames / incoming.size <= MAX_MATCH_FRACTION;
}

/**
 * Human-readable refusal explaining why the divergent-append upload was blocked
 * and how to proceed. Kept separate from the detection so both can be unit-tested.
 */
export function buildDivergentQuadratUploadError(plotID: number, existingSampleNames: string[], incomingCount: number): string {
  const sample = existingSampleNames
    .map(name => name.trim())
    .filter(Boolean)
    .slice(0, MAX_SAMPLE_NAMES);
  const sampleText = sample.length > 0 ? ` (existing names look like: ${sample.join(', ')}${existingSampleNames.length > sample.length ? ', …' : ''})` : '';

  return (
    `Revisions upload refused: this ${incomingCount}-quadrat file appears to replace the generated placeholder grid in plot ${plotID}` +
    `${sampleText}. A Revisions upload would ADD these as a second layout rather than replace the placeholders, duplicating the plot's ` +
    `quadrats. If the uploaded file is the correct, complete quadrat list, use Clean Re-Upload to replace the existing quadrats. ` +
    `Otherwise upload only the new quadrats or correct the QuadratName values so they match the existing quadrats.`
  );
}
