import type { QuadratCsvRow } from './types';

interface SweepEvent {
  type: 'open' | 'close';
  x: number;
  row: QuadratCsvRow;
}

export interface QuadratBoundsIssue {
  rowIndex: number;
  quadratName: string;
  message: string;
}

/**
 * Bounds-check every CSV row against the plot, reporting every offending row (not just the first).
 * Rows arriving here are already declared against a reference corner (see coordinate-reference-corner.ts),
 * so a violation is phrased as a normalization/declaration problem, not just "bad data".
 */
export function collectQuadratBoundsIssues(rows: QuadratCsvRow[], plot: { dimensionX: number; dimensionY: number }): QuadratBoundsIssue[] {
  const issues: QuadratBoundsIssue[] = [];

  rows.forEach((row, rowIndex) => {
    if (row.startX < 0 || row.startY < 0) {
      issues.push({
        rowIndex,
        quadratName: row.quadratName,
        message: `Quadrat "${row.quadratName}" normalizes to a negative start coordinate. Check the declared reference corner.`
      });
      return;
    }
    if (row.startX + row.dimensionX > plot.dimensionX) {
      issues.push({
        rowIndex,
        quadratName: row.quadratName,
        message: `Quadrat "${row.quadratName}" extends past plot dimensionX. Check the declared reference corner.`
      });
      return;
    }
    if (row.startY + row.dimensionY > plot.dimensionY) {
      issues.push({
        rowIndex,
        quadratName: row.quadratName,
        message: `Quadrat "${row.quadratName}" extends past plot dimensionY. Check the declared reference corner.`
      });
    }
  });

  return issues;
}

/**
 * Sweep-line: for each row at coordinate X, maintain an active set of rows whose X-interval overlaps.
 * For each new row entering the active set, check against rows already active for Y-overlap.
 * O(n log n) for the sort + O(n * |active|) for the scan. |active| is bounded by horizontal density;
 * worst case O(n^2) for fully-overlapping inputs, but realistic forest-plot grids are nearly disjoint
 * along X so |active| approximates sqrt(n) in practice.
 */
export function findFirstOverlap(rows: QuadratCsvRow[]): [QuadratCsvRow, QuadratCsvRow] | null {
  if (rows.length < 2) return null;

  const events: SweepEvent[] = [];
  for (const row of rows) {
    events.push({ type: 'open', x: row.startX, row });
    events.push({ type: 'close', x: row.startX + row.dimensionX, row });
  }
  // Process closes before opens at the same x (touching edges don't overlap).
  events.sort((a, b) => a.x - b.x || (a.type === 'close' ? -1 : 1));

  const active: QuadratCsvRow[] = [];
  for (const event of events) {
    if (event.type === 'open') {
      for (const other of active) {
        const yOverlap = event.row.startY < other.startY + other.dimensionY && event.row.startY + event.row.dimensionY > other.startY;
        if (yOverlap) return [other, event.row];
      }
      active.push(event.row);
    } else {
      const idx = active.indexOf(event.row);
      if (idx >= 0) active.splice(idx, 1);
    }
  }
  return null;
}
