import { describe, it, expect } from 'vitest';
import {
  acknowledgmentCoversLayout,
  buildQuadratOverlapAcknowledgment,
  toQuadratGeometry,
  validateQuadratCollectionDetailed,
  type UploadShapedRow
} from './quadrat-collection-validation';
import type { QuadratCsvRow, QuadratReferenceCorner } from './types';

const PLOT_100x60 = { dimensionX: 100, dimensionY: 60 };
const ALL_CORNERS: QuadratReferenceCorner[] = ['SW', 'SE', 'NW', 'NE'];

function fatalIssuesFor(rows: QuadratCsvRow[], plot: { dimensionX: number; dimensionY: number } | null, corner: QuadratReferenceCorner) {
  return validateQuadratCollectionDetailed(rows, plot, corner).fatalIssues;
}

/**
 * Inverse of normalizeToSouthwest: given a canonical (south-west) row, produces the row a file
 * would declare if it named `corner` as its reference corner instead. Used to build fixtures
 * that describe the *same physical layout* from every corner.
 */
function declareFromCorner(canonicalRow: QuadratCsvRow, corner: QuadratReferenceCorner): QuadratCsvRow {
  const shiftX = corner === 'SE' || corner === 'NE' ? canonicalRow.dimensionX : 0;
  const shiftY = corner === 'NW' || corner === 'NE' ? canonicalRow.dimensionY : 0;
  return { ...canonicalRow, startX: canonicalRow.startX + shiftX, startY: canonicalRow.startY + shiftY };
}

describe('toQuadratGeometry', () => {
  it('maps upload field names onto the geometry shape, coercing numeric strings', () => {
    const row: UploadShapedRow = { quadrat: 'Q7', startx: '12.5', starty: '3', dimx: '20', dimy: '10' };
    expect(toQuadratGeometry(row)).toEqual({ quadratName: 'Q7', startX: 12.5, startY: 3, dimensionX: 20, dimensionY: 10 });
  });

  it('maps a non-square (rectangular) quadrat without transposing its axes', () => {
    const row: UploadShapedRow = { quadrat: 'Rect', startx: '0', starty: '0', dimx: '30', dimy: '10' };
    const result = toQuadratGeometry(row);
    expect(result?.dimensionX).toBe(30);
    expect(result?.dimensionY).toBe(10);
  });

  it('returns null for a non-numeric startx', () => {
    const row: UploadShapedRow = { quadrat: 'Q1', startx: 'abc', starty: '3', dimx: '20', dimy: '10' };
    expect(toQuadratGeometry(row)).toBeNull();
  });

  it('returns null for a non-numeric dimy', () => {
    const row: UploadShapedRow = { quadrat: 'Q1', startx: '0', starty: '3', dimx: '20', dimy: 'ten' };
    expect(toQuadratGeometry(row)).toBeNull();
  });

  it('returns null (not 0) for a blank starty string', () => {
    const row: UploadShapedRow = { quadrat: 'Q1', startx: '0', starty: '', dimx: '20', dimy: '10' };
    const result = toQuadratGeometry(row);
    expect(result).toBeNull();
    expect(result).not.toEqual(expect.objectContaining({ startY: 0 }));
  });

  it('returns null (not 0) for a whitespace-only startx string', () => {
    const row: UploadShapedRow = { quadrat: 'Q1', startx: '   ', starty: '5', dimx: '20', dimy: '10' };
    const result = toQuadratGeometry(row);
    expect(result).toBeNull();
    expect(result).not.toEqual(expect.objectContaining({ startX: 0 }));
  });

  it('returns null (not 0) for a missing dimx field entirely', () => {
    const row: UploadShapedRow = { quadrat: 'Q1', startx: '0', starty: '5', dimy: '10' };
    const result = toQuadratGeometry(row);
    expect(result).toBeNull();
    expect(result).not.toEqual(expect.objectContaining({ dimensionX: 0 }));
  });

  it('returns null for an explicit null starty (as FileRow legitimately produces)', () => {
    const row: UploadShapedRow = { quadrat: 'Q1', startx: '0', starty: null, dimx: '20', dimy: '10' };
    expect(toQuadratGeometry(row)).toBeNull();
  });

  it('returns null for a blank quadrat name', () => {
    const row: UploadShapedRow = { quadrat: '', startx: '0', starty: '0', dimx: '20', dimy: '10' };
    expect(toQuadratGeometry(row)).toBeNull();
  });

  it('returns null for a whitespace-only quadrat name', () => {
    const row: UploadShapedRow = { quadrat: '   ', startx: '0', starty: '0', dimx: '20', dimy: '10' };
    expect(toQuadratGeometry(row)).toBeNull();
  });

  it('returns null for a missing quadrat name field', () => {
    const row: UploadShapedRow = { startx: '0', starty: '0', dimx: '20', dimy: '10' };
    expect(toQuadratGeometry(row)).toBeNull();
  });
});

describe('validateQuadratCollection', () => {
  it('returns no issues for a valid south-west collection, including a non-square quadrat', () => {
    const rows: QuadratCsvRow[] = [
      { quadratName: 'A', startX: 0, startY: 0, dimensionX: 30, dimensionY: 10 },
      { quadratName: 'B', startX: 40, startY: 0, dimensionX: 20, dimensionY: 20 }
    ];
    expect(fatalIssuesFor(rows, PLOT_100x60, 'SW')).toEqual([]);
  });

  it('reports a row extending past the plot, naming the offending quadrat', () => {
    const rows: QuadratCsvRow[] = [{ quadratName: 'TooFarEast', startX: 95, startY: 0, dimensionX: 20, dimensionY: 10 }];
    const issues = fatalIssuesFor(rows, PLOT_100x60, 'SW');
    expect(issues).toHaveLength(1);
    expect(issues[0].rowIndex).toBe(0);
    expect(issues[0].quadratName).toBe('TooFarEast');
    expect(issues[0].message).toMatch(/extends past plot dimensionX/);
  });

  it('rejects a zero-width dimension', () => {
    const rows: QuadratCsvRow[] = [{ quadratName: 'ZeroWidth', startX: 0, startY: 0, dimensionX: 0, dimensionY: 10 }];
    const issues = fatalIssuesFor(rows, PLOT_100x60, 'SW');
    expect(issues).toHaveLength(1);
    expect(issues[0].rowIndex).toBe(0);
    expect(issues[0].quadratName).toBe('ZeroWidth');
    expect(issues[0].message).toMatch(/non-positive dimension/);
  });

  it('rejects a negative-height dimension', () => {
    const rows: QuadratCsvRow[] = [{ quadratName: 'NegativeHeight', startX: 0, startY: 0, dimensionX: 10, dimensionY: -5 }];
    const issues = fatalIssuesFor(rows, PLOT_100x60, 'SW');
    expect(issues).toHaveLength(1);
    expect(issues[0].rowIndex).toBe(0);
    expect(issues[0].quadratName).toBe('NegativeHeight');
    expect(issues[0].message).toMatch(/non-positive dimension/);
  });

  it('excludes non-positive-dimension rows from the bounds check rather than reporting a misleading bounds pass or crash', () => {
    // dimensionX is negative, so startX + dimensionX < plot.dimensionX would otherwise
    // look "in bounds" to a naive check even though the row is nonsensical.
    const rows: QuadratCsvRow[] = [{ quadratName: 'InvalidButWouldPassBoundsMath', startX: 98, startY: 0, dimensionX: -5, dimensionY: 10 }];
    const issues = fatalIssuesFor(rows, PLOT_100x60, 'SW');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/non-positive dimension/);
    expect(issues.some(issue => /extends past plot/.test(issue.message))).toBe(false);
  });

  it('maps a bounds issue back to the original array index when a preceding row was filtered out for a non-positive dimension (NE reference corner)', () => {
    // Index 0 has a non-positive dimension and is dropped before collectQuadratBoundsIssues
    // ever runs, so the filtered array handed to it has only one entry (the out-of-bounds
    // row) sitting at filtered-index 0. That makes this fixture diverge from a single-row
    // array: without the remap back to the caller's original index, the bounds issue below
    // would misreport rowIndex 0 instead of its real position, 1.
    const rows: QuadratCsvRow[] = [
      { quadratName: 'FilteredZeroDim', startX: 10, startY: 10, dimensionX: -5, dimensionY: 10 },
      { quadratName: 'OutOfBoundsNE', startX: 115, startY: 10, dimensionX: 20, dimensionY: 10 }
    ];
    const issues = fatalIssuesFor(rows, PLOT_100x60, 'NE');

    const dimensionIssue = issues.find(issue => /non-positive dimension/.test(issue.message));
    const boundsIssue = issues.find(issue => /extends past plot/.test(issue.message));

    expect(dimensionIssue?.rowIndex).toBe(0);
    expect(dimensionIssue?.quadratName).toBe('FilteredZeroDim');
    expect(boundsIssue?.rowIndex).toBe(1);
    expect(boundsIssue?.quadratName).toBe('OutOfBoundsNE');
  });

  it('excludes a non-positive-dimension row from the overlap summary', () => {
    const rows: QuadratCsvRow[] = [
      { quadratName: 'FilteredZeroDim', startX: 50, startY: 50, dimensionX: 0, dimensionY: 10 },
      { quadratName: 'OverlapLeftNE', startX: 10, startY: 10, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'OverlapRightNE', startX: 15, startY: 15, dimensionX: 10, dimensionY: 10 }
    ];
    const validation = validateQuadratCollectionDetailed(rows, PLOT_100x60, 'NE');

    expect(validation.fatalIssues).toHaveLength(1);
    expect(validation.overlapSummary?.pairs).toHaveLength(1);
    expect(validation.overlapSummary?.pairs[0].message).toMatch(/OverlapLeftNE.*overlaps.*OverlapRightNE/);
    expect(validation.overlapSummary?.pairs[0].message).not.toContain('FilteredZeroDim');
  });

  it('reports duplicate quadrat names, including two names differing only by case', () => {
    const rows: QuadratCsvRow[] = [
      { quadratName: 'Dup', startX: 0, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'dup', startX: 50, startY: 0, dimensionX: 10, dimensionY: 10 }
    ];
    const issues = fatalIssuesFor(rows, PLOT_100x60, 'SW');
    expect(issues).toHaveLength(2);
    expect(issues.map(issue => issue.rowIndex)).toEqual([0, 1]);
    expect(issues.map(issue => issue.quadratName)).toEqual(['Dup', 'dup']);
    for (const issue of issues) {
      expect(issue.message).toMatch(/used by more than one row/);
    }
  });

  it('reports overlaps across the whole collection, not just adjacent rows', () => {
    // 'Distant' sits between 'Left' and 'Right' in array order but overlaps neither,
    // so a naive neighbour-only check would miss the real Left/Right overlap.
    const rows: QuadratCsvRow[] = [
      { quadratName: 'Left', startX: 0, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'Distant', startX: 50, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'Right', startX: 5, startY: 5, dimensionX: 10, dimensionY: 10 }
    ];
    const validation = validateQuadratCollectionDetailed(rows, PLOT_100x60, 'SW');
    expect(validation.fatalIssues).toEqual([]);
    expect(validation.overlapSummary?.pairs).toHaveLength(1);
    expect(validation.overlapSummary?.pairs[0].message).toMatch(/Left.*overlaps.*Right/);
    expect(validation.overlapSummary?.pairs[0].message).not.toContain('Distant');
  });

  it('skips only the bounds checks when the plot is null; overlap and duplicate-name checks still run', () => {
    // Callers degrade to null bounds when the plot record has no usable dimensions
    // (nullable columns). That must not disable the checks that need no bounds.
    const rows: QuadratCsvRow[] = [
      { quadratName: 'WayOut', startX: 5000, startY: 5000, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'A', startX: 0, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'a', startX: 5, startY: 5, dimensionX: 10, dimensionY: 10 }
    ];
    const validation = validateQuadratCollectionDetailed(rows, null, 'SW');
    const issues = validation.fatalIssues;

    expect(issues.some(issue => /extends past plot/.test(issue.message))).toBe(false);
    expect(issues.some(issue => /negative start coordinate/.test(issue.message))).toBe(false);
    expect(issues.filter(issue => /used by more than one row/.test(issue.message))).toHaveLength(2);
    expect(validation.overlapSummary?.pairs).toHaveLength(1);
  });

  it('reports every overlapping pair, not just the first', () => {
    // Two disjoint overlapping pairs: (A1,A2) and (B1,B2). First-overlap-only reporting
    // would mask the second pair, which matters to callers that decide per-pair (the
    // Revisions write boundary blocks only pairs the upload introduces).
    const rows: QuadratCsvRow[] = [
      { quadratName: 'A1', startX: 0, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'A2', startX: 5, startY: 5, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'B1', startX: 50, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'B2', startX: 55, startY: 5, dimensionX: 10, dimensionY: 10 }
    ];
    const summary = validateQuadratCollectionDetailed(rows, PLOT_100x60, 'SW').overlapSummary;
    expect(summary?.pairs.map(pair => pair.message)).toEqual(['Quadrat "A1" overlaps quadrat "A2".', 'Quadrat "B1" overlaps quadrat "B2".']);
  });

  it('marks dense overlap reports as truncated and binds acknowledgment to the complete layout', () => {
    const rows: QuadratCsvRow[] = Array.from({ length: 8 }, (_, index) => ({
      quadratName: `Q${index + 1}`,
      startX: 0,
      startY: 0,
      dimensionX: 10,
      dimensionY: 10
    }));
    const summary = validateQuadratCollectionDetailed(rows, PLOT_100x60, 'SW').overlapSummary;
    expect(summary).toMatchObject({
      reportedPairCount: 25,
      minimumPairCount: 26,
      truncated: true
    });
    if (!summary) throw new Error('expected overlap summary');

    const acknowledgment = buildQuadratOverlapAcknowledgment([summary.layoutSignature]);
    expect(acknowledgmentCoversLayout(acknowledgment, summary.layoutSignature)).toBe(true);

    const changedRows = rows.map((row, index) => (index === 0 ? { ...row, dimensionX: 11 } : row));
    const changedSummary = validateQuadratCollectionDetailed(changedRows, PLOT_100x60, 'SW').overlapSummary;
    if (!changedSummary) throw new Error('expected changed overlap summary');
    expect(changedSummary.layoutSignature).not.toBe(summary.layoutSignature);
    expect(acknowledgmentCoversLayout(acknowledgment, changedSummary.layoutSignature)).toBe(false);
  });

  it('produces the same result for the same physical layout declared from all four reference corners', () => {
    const canonicalRows: QuadratCsvRow[] = [
      { quadratName: 'X', startX: 0, startY: 0, dimensionX: 30, dimensionY: 10 },
      { quadratName: 'x', startX: 50, startY: 0, dimensionX: 10, dimensionY: 10 }
    ];
    const expected = validateQuadratCollectionDetailed(canonicalRows, PLOT_100x60, 'SW');
    expect(expected.fatalIssues.length).toBeGreaterThan(0); // sanity: this fixture is deliberately not clean (duplicate name)

    for (const corner of ALL_CORNERS) {
      const declaredRows = canonicalRows.map(row => declareFromCorner(row, corner));
      const actual = validateQuadratCollectionDetailed(declaredRows, PLOT_100x60, corner);
      expect(actual).toEqual(expected);
    }
  });

  it('correctly validates as clean under its true NE reference corner', () => {
    const canonicalRow: QuadratCsvRow = { quadratName: 'NEQuadrat', startX: 80, startY: 45, dimensionX: 15, dimensionY: 10 };
    const declaredAsNE = declareFromCorner(canonicalRow, 'NE');
    expect(fatalIssuesFor([declaredAsNE], PLOT_100x60, 'NE')).toEqual([]);
  });

  it('flags a north-east file misread as south-west', () => {
    const canonicalRow: QuadratCsvRow = { quadratName: 'NEQuadrat', startX: 80, startY: 45, dimensionX: 15, dimensionY: 10 };
    const declaredAsNE = declareFromCorner(canonicalRow, 'NE');

    const issues = fatalIssuesFor([declaredAsNE], PLOT_100x60, 'SW');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].quadratName).toBe('NEQuadrat');
    expect(issues[0].message).toMatch(/extends past plot/);
  });
});
