import { describe, it, expect } from 'vitest';
import { collectOverlappingPairs, findFirstOverlap, collectQuadratBoundsIssues, SOUTHWEST_CONVENTION_HINT } from './geometry';

const PERF_QUADRAT_COUNT = 10_000;
const PERF_BUDGET_MS = 500;
const FORCED_OVERLAP_INDEX = 5000;

describe('findFirstOverlap', () => {
  it('returns null for an empty array', () => {
    expect(findFirstOverlap([])).toBeNull();
  });

  it('returns null for a single row (cannot overlap itself)', () => {
    expect(findFirstOverlap([{ quadratName: 'A', startX: 0, startY: 0, dimensionX: 10, dimensionY: 10 }])).toBeNull();
  });

  it('returns null for non-overlapping quadrats', () => {
    const rows = [
      { quadratName: 'A', startX: 0, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'B', startX: 10, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'C', startX: 0, startY: 10, dimensionX: 10, dimensionY: 10 }
    ];
    expect(findFirstOverlap(rows)).toBeNull();
  });

  it('detects a partial overlap', () => {
    const rows = [
      { quadratName: 'A', startX: 0, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'B', startX: 5, startY: 5, dimensionX: 10, dimensionY: 10 }
    ];
    const result = findFirstOverlap(rows);
    expect(result).not.toBeNull();
    const names = result!.map(r => r.quadratName).sort();
    expect(names).toEqual(['A', 'B']);
  });

  it('detects a fully nested rectangle as overlap', () => {
    const rows = [
      { quadratName: 'Outer', startX: 0, startY: 0, dimensionX: 100, dimensionY: 100 },
      { quadratName: 'Inner', startX: 20, startY: 20, dimensionX: 10, dimensionY: 10 }
    ];
    const result = findFirstOverlap(rows);
    expect(result).not.toBeNull();
    const names = result!.map(r => r.quadratName).sort();
    expect(names).toEqual(['Inner', 'Outer']);
  });

  it('treats touching horizontal edges as non-overlapping', () => {
    const rows = [
      { quadratName: 'A', startX: 0, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'B', startX: 10, startY: 0, dimensionX: 10, dimensionY: 10 }
    ];
    expect(findFirstOverlap(rows)).toBeNull();
  });

  it('treats touching vertical edges as non-overlapping', () => {
    const rows = [
      { quadratName: 'A', startX: 0, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'B', startX: 0, startY: 10, dimensionX: 10, dimensionY: 10 }
    ];
    expect(findFirstOverlap(rows)).toBeNull();
  });

  it('treats touching at a corner as non-overlapping', () => {
    const rows = [
      { quadratName: 'A', startX: 0, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'B', startX: 10, startY: 10, dimensionX: 10, dimensionY: 10 }
    ];
    expect(findFirstOverlap(rows)).toBeNull();
  });

  it('detects overlap among many disjoint rows when a single bad one is inserted', () => {
    const rows = [
      { quadratName: 'A', startX: 0, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'B', startX: 10, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'C', startX: 20, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'BAD', startX: 5, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'D', startX: 30, startY: 0, dimensionX: 10, dimensionY: 10 }
    ];
    const result = findFirstOverlap(rows);
    expect(result).not.toBeNull();
    const names = result!.map(r => r.quadratName);
    expect(names).toContain('BAD');
  });

  it(`detects overlap in ${PERF_QUADRAT_COUNT} quadrats in under ${PERF_BUDGET_MS}ms`, () => {
    const rows = Array.from({ length: PERF_QUADRAT_COUNT }, (_, i) => ({
      quadratName: `Q${i}`,
      startX: i * 2,
      startY: 0,
      dimensionX: 1,
      dimensionY: 1
    }));
    // Force one overlap by aligning Q5000 onto Q4999's startX
    rows[FORCED_OVERLAP_INDEX] = { ...rows[FORCED_OVERLAP_INDEX], startX: rows[FORCED_OVERLAP_INDEX - 1].startX };
    const start = Date.now();
    const result = findFirstOverlap(rows);
    const elapsed = Date.now() - start;
    expect(result).not.toBeNull();
    expect(elapsed).toBeLessThan(PERF_BUDGET_MS);
  });

  it(`handles ${PERF_QUADRAT_COUNT} disjoint quadrats (no overlap) in under ${PERF_BUDGET_MS}ms`, () => {
    const rows = Array.from({ length: PERF_QUADRAT_COUNT }, (_, i) => ({
      quadratName: `Q${i}`,
      startX: i * 2,
      startY: 0,
      dimensionX: 1,
      dimensionY: 1
    }));
    const start = Date.now();
    const result = findFirstOverlap(rows);
    const elapsed = Date.now() - start;
    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(PERF_BUDGET_MS);
  });
});

describe('collectOverlappingPairs', () => {
  it('reports every overlapping pair up to the cap', () => {
    const rows = [
      { quadratName: 'A1', startX: 0, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'A2', startX: 5, startY: 5, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'B1', startX: 50, startY: 0, dimensionX: 10, dimensionY: 10 },
      { quadratName: 'B2', startX: 55, startY: 5, dimensionX: 10, dimensionY: 10 }
    ];
    const pairs = collectOverlappingPairs(rows, 10);
    expect(pairs).toHaveLength(2);
    const named = pairs.map(([a, b]) => [a.quadratName, b.quadratName].sort().join('-')).sort();
    expect(named).toEqual(['A1-A2', 'B1-B2']);
  });

  it('stops collecting once the cap is reached', () => {
    const stacked = Array.from({ length: 10 }, (_, i) => ({ quadratName: `S${i}`, startX: 0, startY: 0, dimensionX: 10, dimensionY: 10 }));
    expect(collectOverlappingPairs(stacked, 3)).toHaveLength(3);
  });

  it('non-reportable pairs do not consume the cap', () => {
    // Many stacked "existing" rows saturate any small cap on their own; the one pair
    // involving the "incoming" row must still be reported when a predicate scopes the
    // sweep to it. This is the masking case the predicate exists to prevent.
    const stackedExisting = Array.from({ length: 20 }, (_, i) => ({
      quadratName: `EXIST${i}`,
      startX: 0,
      startY: 0,
      dimensionX: 10,
      dimensionY: 10
    }));
    const farExisting = { quadratName: 'FAR', startX: 100, startY: 100, dimensionX: 10, dimensionY: 10 };
    const incoming = { quadratName: 'INCOMING', startX: 105, startY: 105, dimensionX: 10, dimensionY: 10 };
    const rows = [...stackedExisting, farExisting, incoming];

    const cappedWithoutPredicate = collectOverlappingPairs(rows, 5);
    expect(
      cappedWithoutPredicate.some(([a, b]) => a.quadratName === 'INCOMING' || b.quadratName === 'INCOMING'),
      'sanity: without a predicate the small cap is consumed by stacked pairs and the incoming pair is masked'
    ).toBe(false);

    const scoped = collectOverlappingPairs(rows, 5, (a, b) => a === incoming || b === incoming);
    expect(scoped).toHaveLength(1);
    const [a, b] = scoped[0];
    expect([a.quadratName, b.quadratName].sort()).toEqual(['FAR', 'INCOMING']);
  });
});

describe('collectQuadratBoundsIssues', () => {
  const PLOT_100x100 = { dimensionX: 100, dimensionY: 100 };

  it('returns an empty array when every row fits inside the plot', () => {
    const rows = [
      { quadratName: 'A', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 },
      { quadratName: 'B', startX: 80, startY: 80, dimensionX: 20, dimensionY: 20 }
    ];
    expect(collectQuadratBoundsIssues(rows, PLOT_100x100)).toEqual([]);
  });

  it('reports a row that extends past plot dimensionX, with its name and row index', () => {
    const rows = [{ quadratName: 'TooFarEast', startX: 90, startY: 0, dimensionX: 20, dimensionY: 20 }];
    const issues = collectQuadratBoundsIssues(rows, PLOT_100x100);
    expect(issues).toHaveLength(1);
    expect(issues[0].rowIndex).toBe(0);
    expect(issues[0].quadratName).toBe('TooFarEast');
    expect(issues[0].message).toMatch(/extends past plot dimensionX/);
    expect(issues[0].message).toContain(SOUTHWEST_CONVENTION_HINT);
  });

  it('reports a row that extends past plot dimensionY, with its name and row index', () => {
    const rows = [{ quadratName: 'TooFarNorth', startX: 0, startY: 90, dimensionX: 20, dimensionY: 20 }];
    const issues = collectQuadratBoundsIssues(rows, PLOT_100x100);
    expect(issues).toHaveLength(1);
    expect(issues[0].rowIndex).toBe(0);
    expect(issues[0].quadratName).toBe('TooFarNorth');
    expect(issues[0].message).toMatch(/extends past plot dimensionY/);
    expect(issues[0].message).toContain(SOUTHWEST_CONVENTION_HINT);
  });

  it('reports a row with negative start coordinates', () => {
    const rows = [{ quadratName: 'BelowOrigin', startX: -5, startY: 0, dimensionX: 20, dimensionY: 20 }];
    const issues = collectQuadratBoundsIssues(rows, PLOT_100x100);
    expect(issues).toHaveLength(1);
    expect(issues[0].rowIndex).toBe(0);
    expect(issues[0].quadratName).toBe('BelowOrigin');
    expect(issues[0].message).toMatch(/negative start coordinate/);
    expect(issues[0].message).toContain(SOUTHWEST_CONVENTION_HINT);
  });

  it('reports every offending row in a single pass, not just the first', () => {
    const rows = [
      { quadratName: 'Good', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 },
      { quadratName: 'TooFarEast', startX: 90, startY: 0, dimensionX: 20, dimensionY: 20 },
      { quadratName: 'BelowOrigin', startX: 0, startY: -5, dimensionX: 20, dimensionY: 20 },
      { quadratName: 'TooFarNorth', startX: 0, startY: 90, dimensionX: 20, dimensionY: 20 }
    ];
    const issues = collectQuadratBoundsIssues(rows, PLOT_100x100);
    expect(issues).toHaveLength(3);
    expect(issues.map(issue => issue.quadratName)).toEqual(['TooFarEast', 'BelowOrigin', 'TooFarNorth']);
    expect(issues.map(issue => issue.rowIndex)).toEqual([1, 2, 3]);
  });
});
