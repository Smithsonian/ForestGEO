/**
 * Latency bounds for the ingestion scale benchmark
 * (tests/integration/ingestion-scale-benchmark.integration.test.ts).
 *
 * The benchmark applies TWO independent bounds to each sub-batch:
 *
 *   1. An ABSOLUTE ceiling — no sub-batch may take longer than
 *      {@link MAX_BATCH_DURATION_MS}, regardless of how the first one did.
 *   2. A RATIO bound on later sub-batches — a batch run against a filling
 *      census may cost at most {@link RATIO_LIMIT}x the first (empty-census)
 *      batch. This is the one that detects the incident signature: a stage whose
 *      cost scales with (existing measurements x batch rows) rather than with
 *      batch rows.
 *
 * They live here, apart from the benchmark, so the arithmetic that decides
 * whether the ratio bound can ever bind is unit-testable without a database.
 * That matters: the bound previously used a floor equal to the absolute ceiling,
 * which made `max(RATIO_LIMIT x first, floor)` never smaller than the ceiling the
 * benchmark had already asserted — so the advertised 5x gate was dead code and
 * the real detection threshold was the flat 30s (~14x on observed timings).
 */

/** A later sub-batch may cost at most this multiple of the first. */
export const RATIO_LIMIT = 5;

/**
 * Floor under the ratio bound, so an unusually fast first batch cannot produce a
 * hair-trigger threshold.
 *
 * It MUST stay well below {@link MAX_BATCH_DURATION_MS} or the ratio bound can
 * never bind. Sized from recorded local runs of the healthy plan, where the
 * first batch lands at ~2.0-2.4s and later batches within ~1.05x of it: a 10s
 * floor is ~4x the observed first-batch time, so normal variance cannot reach it
 * while a genuine plan flip (10x-100x) blows past it long before 30s.
 */
export const MIN_ALLOWED_MS = 10_000;

/** Absolute per-sub-batch ceiling, independent of the first batch's timing. */
export const MAX_BATCH_DURATION_MS = 30_000;

/** The bound a later sub-batch must stay under, given the first batch's duration. */
export function laterBatchBoundMs(firstBatchMs: number): number {
  return Math.max(RATIO_LIMIT * firstBatchMs, MIN_ALLOWED_MS);
}

/**
 * True when the ratio bound is capable of failing a batch that the absolute
 * ceiling would have let through — i.e. the ratio gate is live rather than
 * shadowed by {@link MAX_BATCH_DURATION_MS}.
 */
export function ratioBoundCanBind(firstBatchMs: number): boolean {
  return laterBatchBoundMs(firstBatchMs) < MAX_BATCH_DURATION_MS;
}
