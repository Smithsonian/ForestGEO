import type { QuadratCsvRow, QuadratReferenceCorner } from './types';
import { collectQuadratBoundsIssues, findFirstOverlap, type QuadratBoundsIssue } from './geometry';
import { normalizeToSouthwest } from './coordinate-reference-corner';

/** Same shape as QuadratBoundsIssue so callers can concatenate/handle both issue sources uniformly. */
export type QuadratCollectionIssue = QuadratBoundsIssue;

/** The Quadrats-page upload row shape (see app/api/sqlpacketload/route.ts). Values come straight off a parsed file row. */
export interface UploadShapedRow {
  quadrat?: string | null;
  startx?: string | null;
  starty?: string | null;
  dimx?: string | null;
  dimy?: string | null;
  area?: string | null;
  quadratshape?: string | null;
}

/**
 * Parses a required numeric field. Returns null for missing, blank, or non-numeric input —
 * never 0. `Number('')` is 0 in JavaScript, so a naive `Number(value)` would silently turn a
 * missing coordinate into a quadrat pinned to the plot origin.
 */
function parseRequiredNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
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
  const quadratName = row.quadrat?.trim();
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
 *   - `findFirstOverlap` for pairwise geometric overlap across the whole set
 * This module adds the two checks that were genuinely missing: non-positive dimensions and
 * duplicate quadrat names (case-insensitive, matching the upload path's `LOWER()` SQL comparison).
 *
 * Ordering: rows are normalized to south-west first, since every downstream check assumes that
 * convention. Non-positive dimensions are checked, and flagged, before bounds/overlap — a row
 * with a zero or negative dimension has no meaningful footprint, so running bounds/overlap math
 * on it would produce a misleading pass (or a nonsensical extra failure) rather than a useful
 * one. Those rows are excluded from the bounds and overlap checks and reported solely via their
 * own dimension issue; their original row index is preserved when translating results back.
 */
export function validateQuadratCollection(
  rows: QuadratCsvRow[],
  plot: { dimensionX: number; dimensionY: number },
  referenceCorner: QuadratReferenceCorner
): QuadratCollectionIssue[] {
  const issues: QuadratCollectionIssue[] = [];
  const normalizedRows = rows.map(row => normalizeToSouthwest(row, referenceCorner));

  const geometricallyValidRows: QuadratCsvRow[] = [];
  const originalIndexByGeometricRow = new Map<QuadratCsvRow, number>();

  normalizedRows.forEach((row, rowIndex) => {
    if (row.dimensionX <= 0 || row.dimensionY <= 0) {
      issues.push({
        rowIndex,
        quadratName: row.quadratName,
        message: `Quadrat "${row.quadratName}" has a non-positive dimension (dimensionX=${row.dimensionX}, dimensionY=${row.dimensionY}). Dimensions must be greater than zero.`
      });
      return;
    }
    geometricallyValidRows.push(row);
    originalIndexByGeometricRow.set(row, rowIndex);
  });

  const boundsIssues = collectQuadratBoundsIssues(geometricallyValidRows, plot).map(issue => ({
    ...issue,
    rowIndex: originalIndexByGeometricRow.get(geometricallyValidRows[issue.rowIndex]) ?? issue.rowIndex
  }));
  issues.push(...boundsIssues);

  const nameOccurrences = new Map<string, number>();
  normalizedRows.forEach(row => {
    const key = row.quadratName.trim().toLowerCase();
    nameOccurrences.set(key, (nameOccurrences.get(key) ?? 0) + 1);
  });
  normalizedRows.forEach((row, rowIndex) => {
    const key = row.quadratName.trim().toLowerCase();
    if ((nameOccurrences.get(key) ?? 0) > 1) {
      issues.push({
        rowIndex,
        quadratName: row.quadratName,
        message: `Quadrat name "${row.quadratName}" is used by more than one row. Quadrat names must be unique (compared case-insensitively).`
      });
    }
  });

  const overlap = findFirstOverlap(geometricallyValidRows);
  if (overlap) {
    const [first, second] = overlap;
    issues.push({
      rowIndex: originalIndexByGeometricRow.get(first) ?? -1,
      quadratName: first.quadratName,
      message: `Quadrat "${first.quadratName}" overlaps quadrat "${second.quadratName}".`
    });
    issues.push({
      rowIndex: originalIndexByGeometricRow.get(second) ?? -1,
      quadratName: second.quadratName,
      message: `Quadrat "${second.quadratName}" overlaps quadrat "${first.quadratName}".`
    });
  }

  return issues;
}
