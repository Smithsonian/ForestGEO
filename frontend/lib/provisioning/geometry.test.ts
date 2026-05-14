import { describe, it, expect } from 'vitest';
import { findFirstOverlap } from './geometry';

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
