import type { QuadratCsvRow, QuadratOverlapAcknowledgment, QuadratReferenceCorner } from './types';
import { collectOverlappingPairs, collectQuadratBoundsIssues, type QuadratBoundsIssue } from './geometry';
import { normalizeToSouthwest } from './coordinate-reference-corner';

/**
 * Bounds the overlap sweep's result on pathological inputs where every quadrat overlaps every
 * other (quadratic pair count). Message output is capped separately by the callers' truncation,
 * so this only needs to be comfortably larger than what a user can act on in one pass.
 */
const MAX_REPORTED_OVERLAP_PAIRS = 25;
const MAX_ACKNOWLEDGED_LAYOUT_SIGNATURES = 1000;
const LAYOUT_SIGNATURE_PREFIX = 'quadrat-layout-v1-';

/**
 * Overlap is policy-separable from the other kinds: real surveyed quadrats can overlap
 * (measured widths at SERC exceed the grid pitch), so callers treat 'overlap' as a
 * warn-and-acknowledge condition while every other kind stays a hard error. The kind is
 * carried on the issue so that split never relies on message-string matching.
 */
export type QuadratIssueKind = 'non-positive-dimension' | 'bounds' | 'duplicate-name';

/**
 * The confirmation statement a user accepts when proceeding with overlapping quadrat
 * footprints. Shared by the upload preflight and the provisioning wizard so the stored
 * acknowledgment text is identical wherever it was given.
 */
export const QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT = 'I confirm the overlapping quadrat footprints in this upload reflect field measurements.';

export interface QuadratOverlapPairSummary {
  key: string;
  message: string;
}

/**
 * Bounded, truthful description of an overlapping layout. `truncated` explicitly distinguishes
 * an exhaustive pair list from a sample. `minimumPairCount` is exact when not truncated and a
 * lower bound otherwise. The layout signature still binds the acknowledgment to the complete
 * geometry even when enumerating every pair would be quadratic.
 */
export interface QuadratOverlapSummary {
  layoutSignature: string;
  reportedPairCount: number;
  minimumPairCount: number;
  truncated: boolean;
  pairs: QuadratOverlapPairSummary[];
}

export interface QuadratCollectionValidationResult {
  fatalIssues: QuadratCollectionIssue[];
  overlapSummary: QuadratOverlapSummary | null;
}

/** QuadratBoundsIssue plus the machine-readable kind; callers can still concatenate/handle both issue sources uniformly. */
export interface QuadratCollectionIssue extends QuadratBoundsIssue {
  kind: QuadratIssueKind;
}

function fnv1a64(value: string): string {
  let high = 0x811c9dc5;
  let low = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    high = Math.imul(high ^ code, 0x01000193) >>> 0;
    low = Math.imul(low ^ code, 0x85ebca6b) >>> 0;
  }
  return `${high.toString(16).padStart(8, '0')}${low.toString(16).padStart(8, '0')}`;
}

function canonicalRowTuple(row: QuadratCsvRow): [string, number, number, number, number] {
  return [row.quadratName.trim().toLowerCase(), row.startX, row.startY, row.dimensionX, row.dimensionY];
}

function compareCanonicalTuples(left: [string, number, number, number, number], right: [string, number, number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === rightValue) continue;
    return leftValue < rightValue ? -1 : 1;
  }
  return 0;
}

/** Stable in browser and server runtimes; this is a scope fingerprint, not an authentication secret. */
export function createQuadratLayoutSignature(rows: QuadratCsvRow[]): string {
  const canonicalRows = rows.map(canonicalRowTuple).sort(compareCanonicalTuples);
  return `${LAYOUT_SIGNATURE_PREFIX}${fnv1a64(JSON.stringify(canonicalRows))}`;
}

function createOverlapPairKey(first: QuadratCsvRow, second: QuadratCsvRow): string {
  const pair = [canonicalRowTuple(first), canonicalRowTuple(second)].sort(compareCanonicalTuples);
  return fnv1a64(JSON.stringify(pair));
}

export function summarizeQuadratOverlaps(
  canonicalRows: QuadratCsvRow[],
  isReportable: (first: QuadratCsvRow, second: QuadratCsvRow) => boolean = () => true
): QuadratOverlapSummary | null {
  const observedOverlapPairs = collectOverlappingPairs(canonicalRows, MAX_REPORTED_OVERLAP_PAIRS + 1, isReportable);
  if (observedOverlapPairs.length === 0) return null;

  const overlapPairs = observedOverlapPairs.slice(0, MAX_REPORTED_OVERLAP_PAIRS);
  return {
    layoutSignature: createQuadratLayoutSignature(canonicalRows),
    reportedPairCount: overlapPairs.length,
    minimumPairCount: observedOverlapPairs.length,
    truncated: observedOverlapPairs.length > MAX_REPORTED_OVERLAP_PAIRS,
    pairs: overlapPairs.map(([first, second]) => ({
      key: createOverlapPairKey(first, second),
      message: `Quadrat "${first.quadratName}" overlaps quadrat "${second.quadratName}".`
    }))
  };
}

export function buildQuadratOverlapAcknowledgment(layoutSignatures: string[]): QuadratOverlapAcknowledgment {
  return {
    statement: QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT,
    layoutSignatures: [...new Set(layoutSignatures)].sort()
  };
}

export function isQuadratOverlapAcknowledgment(value: unknown): value is QuadratOverlapAcknowledgment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.statement !== QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT) return false;
  if (!Array.isArray(candidate.layoutSignatures) || candidate.layoutSignatures.length === 0) return false;
  if (candidate.layoutSignatures.length > MAX_ACKNOWLEDGED_LAYOUT_SIGNATURES) return false;
  return candidate.layoutSignatures.every(signature => typeof signature === 'string' && new RegExp(`^${LAYOUT_SIGNATURE_PREFIX}[0-9a-f]{16}$`).test(signature));
}

export function acknowledgmentCoversLayout(value: unknown, layoutSignature: string): value is QuadratOverlapAcknowledgment {
  return isQuadratOverlapAcknowledgment(value) && value.layoutSignatures.includes(layoutSignature);
}

/** The Quadrats-page upload row shape (see app/api/sqlpacketload/route.ts). Values come straight off a parsed file row. */
export interface UploadShapedRow {
  quadrat?: unknown;
  startx?: unknown;
  starty?: unknown;
  dimx?: unknown;
  dimy?: unknown;
  area?: unknown;
  quadratshape?: unknown;
}

function isBlankValue(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === '';
}

/** Matches the write boundary's padding policy: name and all geometry cells are blank. */
export function isBlankQuadratPaddingRow(row: UploadShapedRow): boolean {
  return [row.quadrat, row.startx, row.starty, row.dimx, row.dimy].every(isBlankValue);
}

/**
 * Parses a required numeric field. Returns null for missing, blank, or non-numeric input —
 * never 0. `Number('')` is 0 in JavaScript, so a naive `Number(value)` would silently turn a
 * missing coordinate into a quadrat pinned to the plot origin.
 */
function parseRequiredNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Adapts a Quadrats-page upload row onto the canonical QuadratCsvRow geometry shape shared
 * with provisioning. Returns null when the row cannot be interpreted as geometry at all
 * (missing/blank/non-numeric coordinate or dimension, or a blank quadrat name) so callers
 * can route it to their existing missing-field handling instead of silently geo-locating it
 * at (0, 0).
 */
export function toQuadratGeometry(row: UploadShapedRow): QuadratCsvRow | null {
  const quadratName = typeof row.quadrat === 'string' ? row.quadrat.trim() : String(row.quadrat ?? '').trim();
  if (!quadratName) return null;

  const startX = parseRequiredNumber(row.startx);
  const startY = parseRequiredNumber(row.starty);
  const dimensionX = parseRequiredNumber(row.dimx);
  const dimensionY = parseRequiredNumber(row.dimy);

  if (startX === null || startY === null || dimensionX === null || dimensionY === null) return null;

  return { quadratName, startX, startY, dimensionX, dimensionY };
}

/**
 * Validates a whole collection of quadrat rows declared against `referenceCorner`, composing
 * the existing single-source-of-truth checks rather than re-implementing them:
 *   - `collectQuadratBoundsIssues` for negative coordinates / exceeding plot dimensions
 *   - `collectOverlappingPairs` for pairwise geometric overlap across the whole set
 * This module adds the two checks that were genuinely missing: non-positive dimensions and
 * duplicate quadrat names (case-insensitive, matching the upload path's `LOWER()` SQL comparison).
 *
 * `plot` may be null when the plot has no usable recorded dimensions: overlap, duplicate-name,
 * and non-positive-dimension checks still run, and only the bounds checks are skipped. Callers
 * choosing that degraded mode are responsible for telling the user bounds went unvalidated.
 *
 * Ordering: rows are normalized to south-west first, since every downstream check assumes that
 * convention. Non-positive dimensions are checked, and flagged, before bounds/overlap — a row
 * with a zero or negative dimension has no meaningful footprint, so running bounds/overlap math
 * on it would produce a misleading pass (or a nonsensical extra failure) rather than a useful
 * one. Those rows are excluded from the bounds and overlap checks and reported solely via their
 * own dimension issue; their original row index is preserved when translating results back.
 */
export function validateQuadratCollectionDetailed(
  rows: QuadratCsvRow[],
  plot: { dimensionX: number; dimensionY: number } | null,
  referenceCorner: QuadratReferenceCorner
): QuadratCollectionValidationResult {
  const fatalIssues: QuadratCollectionIssue[] = [];
  const normalizedRows = rows.map(row => normalizeToSouthwest(row, referenceCorner));

  const geometricallyValidRows: QuadratCsvRow[] = [];
  const originalIndexByGeometricRow = new Map<QuadratCsvRow, number>();

  normalizedRows.forEach((row, rowIndex) => {
    if (row.dimensionX <= 0 || row.dimensionY <= 0) {
      fatalIssues.push({
        kind: 'non-positive-dimension',
        rowIndex,
        quadratName: row.quadratName,
        message: `Quadrat "${row.quadratName}" has a non-positive dimension (dimensionX=${row.dimensionX}, dimensionY=${row.dimensionY}). Dimensions must be greater than zero.`
      });
      return;
    }
    geometricallyValidRows.push(row);
    originalIndexByGeometricRow.set(row, rowIndex);
  });

  if (plot !== null) {
    const boundsIssues = collectQuadratBoundsIssues(geometricallyValidRows, plot).map(
      (issue): QuadratCollectionIssue => ({
        ...issue,
        kind: 'bounds',
        rowIndex: originalIndexByGeometricRow.get(geometricallyValidRows[issue.rowIndex]) ?? issue.rowIndex
      })
    );
    fatalIssues.push(...boundsIssues);
  }

  const nameOccurrences = new Map<string, number>();
  normalizedRows.forEach(row => {
    const key = row.quadratName.trim().toLowerCase();
    nameOccurrences.set(key, (nameOccurrences.get(key) ?? 0) + 1);
  });
  normalizedRows.forEach((row, rowIndex) => {
    const key = row.quadratName.trim().toLowerCase();
    if ((nameOccurrences.get(key) ?? 0) > 1) {
      fatalIssues.push({
        kind: 'duplicate-name',
        rowIndex,
        quadratName: row.quadratName,
        message: `Quadrat name "${row.quadratName}" is used by more than one row. Quadrat names must be unique (compared case-insensitively).`
      });
    }
  });

  // Overlaps are represented once, as a bounded summary. Callers no longer receive duplicate
  // directional issues that they immediately have to filter back out before applying policy.
  const geometricOverlapSummary = summarizeQuadratOverlaps(geometricallyValidRows);
  const overlapSummary = geometricOverlapSummary ? { ...geometricOverlapSummary, layoutSignature: createQuadratLayoutSignature(normalizedRows) } : null;

  return { fatalIssues, overlapSummary };
}
