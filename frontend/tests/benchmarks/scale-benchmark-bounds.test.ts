/**
 * Proves the ingestion scale benchmark's ratio gate can actually fail.
 *
 * The benchmark asserts both an absolute per-batch ceiling and a "later batches
 * stay within RATIO_LIMIT x the first" bound. When the ratio bound's floor was
 * set equal to the ceiling, the second assertion was unreachable: every bound it
 * could compute was >= the ceiling the first assertion had already enforced. The
 * suite advertised a 5x regression detector and shipped a flat 30s one (~14x on
 * observed timings). Nothing failed, so nothing revealed it.
 *
 * These are arithmetic assertions over recorded durations — no database, so they
 * run on every unit pass rather than only when someone opts into the benchmark.
 */

import { describe, expect, it } from 'vitest';
import { laterBatchBoundMs, MAX_BATCH_DURATION_MS, MIN_ALLOWED_MS, ratioBoundCanBind, RATIO_LIMIT } from './scale-benchmark-bounds';

/**
 * First-batch durations recorded on the healthy (STRAIGHT_JOIN) plan: four local
 * docker-MySQL runs plus the GitHub Actions integration job, which is the
 * slowest host the benchmark runs on.
 */
const RECORDED_HEALTHY_FIRST_BATCH_MS = [2102, 2237, 2104, 2334, 5883] as const;

/** Later-batch durations recorded alongside them. */
const RECORDED_HEALTHY_LATER_BATCH_MS = [2084, 2110, 2049, 2091, 5912] as const;

describe('scale benchmark latency bounds', () => {
  it('keeps the ratio floor below the absolute ceiling, or the ratio gate is dead code', () => {
    expect(MIN_ALLOWED_MS).toBeLessThan(MAX_BATCH_DURATION_MS);
  });

  it('produces a binding ratio bound for every recorded healthy first-batch time', () => {
    for (const firstBatchMs of RECORDED_HEALTHY_FIRST_BATCH_MS) {
      expect(ratioBoundCanBind(firstBatchMs), `ratio bound is shadowed by the ${MAX_BATCH_DURATION_MS}ms ceiling at firstBatch=${firstBatchMs}ms`).toBe(true);
    }
  });

  it('records where the ratio gate stops binding, so the margin is not a surprise', () => {
    // Above this first-batch time the ratio bound reaches the absolute ceiling
    // and the scaling assertion is inert. The benchmark reports that condition
    // rather than failing on it — a slow host is not a code regression — so the
    // margin is pinned here instead. CI's slowest recorded first batch is
    // 5883ms, which leaves very little room: if CI gets slower, the benchmark
    // silently degrades to a flat-ceiling check and this test is the record of
    // why.
    const shadowThresholdMs = MAX_BATCH_DURATION_MS / RATIO_LIMIT;

    expect(ratioBoundCanBind(shadowThresholdMs - 1)).toBe(true);
    expect(ratioBoundCanBind(shadowThresholdMs)).toBe(false);
    expect(Math.max(...RECORDED_HEALTHY_FIRST_BATCH_MS)).toBeLessThan(shadowThresholdMs);
  });

  it('fails a later batch that sits between the ratio bound and the absolute ceiling', () => {
    // The exact regression class the gate exists for: slower than the ratio
    // allows, yet fast enough that the flat 30s ceiling would never notice.
    const firstBatchMs = 2102;
    const bound = laterBatchBoundMs(firstBatchMs);
    const regressedLaterBatchMs = Math.round((bound + MAX_BATCH_DURATION_MS) / 2);

    expect(regressedLaterBatchMs).toBeGreaterThan(bound);
    expect(regressedLaterBatchMs).toBeLessThan(MAX_BATCH_DURATION_MS);
    expect(regressedLaterBatchMs >= bound, `a ${regressedLaterBatchMs}ms later batch must breach the ${bound}ms ratio bound`).toBe(true);
  });

  it('passes every recorded healthy run', () => {
    for (const [index, firstBatchMs] of RECORDED_HEALTHY_FIRST_BATCH_MS.entries()) {
      const laterMs = RECORDED_HEALTHY_LATER_BATCH_MS[index];
      expect(laterMs, `recorded healthy run ${index} would now be flaky`).toBeLessThan(laterBatchBoundMs(firstBatchMs));
      expect(laterMs).toBeLessThan(MAX_BATCH_DURATION_MS);
    }
  });

  it('leaves headroom of at least 2x over the fastest recorded first batch', () => {
    // Guards the floor against being lowered into normal-variance territory.
    const fastestFirstBatchMs = Math.min(...RECORDED_HEALTHY_FIRST_BATCH_MS);
    expect(MIN_ALLOWED_MS / fastestFirstBatchMs).toBeGreaterThan(2);
  });

  it('uses the ratio, not the floor, once the first batch is slow enough', () => {
    const slowFirstBatchMs = MIN_ALLOWED_MS / RATIO_LIMIT + 1000;
    expect(laterBatchBoundMs(slowFirstBatchMs)).toBe(RATIO_LIMIT * slowFirstBatchMs);
  });
});
