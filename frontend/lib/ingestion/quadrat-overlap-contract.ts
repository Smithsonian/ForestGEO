import type { QuadratOverlapSummary } from '@/lib/provisioning/quadrat-collection-validation';

export const QUADRAT_OVERLAP_ACKNOWLEDGMENT_REQUIRED_CODE = 'QUADRAT_OVERLAPS_REQUIRE_ACKNOWLEDGMENT';

export function parseQuadratOverlapSummaries(payload: unknown): QuadratOverlapSummary[] | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (record.code !== QUADRAT_OVERLAP_ACKNOWLEDGMENT_REQUIRED_CODE || !Array.isArray(record.overlapSummaries)) return null;

  const summaries = record.overlapSummaries.filter((summary): summary is QuadratOverlapSummary => {
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return false;
    const candidate = summary as Record<string, unknown>;
    return (
      typeof candidate.layoutSignature === 'string' &&
      typeof candidate.reportedPairCount === 'number' &&
      typeof candidate.minimumPairCount === 'number' &&
      typeof candidate.truncated === 'boolean' &&
      Array.isArray(candidate.pairs)
    );
  });

  return summaries.length > 0 ? summaries : null;
}
