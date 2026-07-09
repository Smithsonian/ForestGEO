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
 * These helpers detect that divergent-append case so the upload can be refused
 * before any row is written, steering the operator to a Clean Re-Upload (replace)
 * instead.
 */

const MAX_SAMPLE_NAMES = 10;

function normalizeQuadratName(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * True when a Revisions upload would append a wholly new, non-overlapping set of
 * quadrats on top of existing ones — i.e. quadrats already exist for the plot but
 * not one incoming name matches any existing name. That is the fingerprint of two
 * naming schemes coexisting, which produces duplicate physical quadrats.
 */
export function quadratRevisionAppendsDivergentSet(existingActiveNames: string[], incomingNames: string[]): boolean {
  const existing = new Set(existingActiveNames.map(normalizeQuadratName).filter(Boolean));
  if (existing.size === 0) return false;

  const incoming = incomingNames.map(normalizeQuadratName).filter(Boolean);
  if (incoming.length === 0) return false;

  return incoming.every(name => !existing.has(name));
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
    `Revisions upload refused: none of the ${incomingCount} quadrat name(s) in this file match any existing quadrat in plot ${plotID}` +
    `${sampleText}. A Revisions upload would ADD these as a new set rather than update the existing quadrats, duplicating the plot's ` +
    `quadrats under two naming schemes. If the uploaded file is the correct, complete quadrat list, use Clean Re-Upload to replace the ` +
    `existing quadrats. Otherwise correct the QuadratName values so they match the existing quadrats.`
  );
}
