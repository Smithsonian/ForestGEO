/**
 * Boundary + invariant tests for evaluateUploadReconciliation.
 *
 * The regression these guard against is the chunk-boundary off-by-one: a row that
 * fell across the 1000-row chunk boundary was silently dropped and the upload still
 * reported "clean". So the matrix deliberately probes BOTH sides of 1000
 * (999 / 1000 / 1001) plus 0 / 1 / 2001, and asserts that ANY unaccounted row
 * (input != success + failed) produces a blocking mismatch verdict while an exactly
 * balanced batch produces a clean one.
 *
 * Every assertion is verbose so a failure names the exact counts and field.
 */
import { describe, expect, it } from 'vitest';
import { evaluateUploadReconciliation, RECONCILIATION_MISMATCH_CODE, ReconciliationSeverity, type UploadReconciliationInput } from './reconciliation';

/**
 * The chunk size that produced the historical off-by-one. Not a magic number:
 * it is the boundary the batch chunker splits on, so 999/1000/1001 straddle it.
 */
const CHUNK_BOUNDARY = 1000;
const BOUNDARY_SOURCE_COUNTS = [0, 1, CHUNK_BOUNDARY - 1, CHUNK_BOUNDARY, CHUNK_BOUNDARY + 1, 2 * CHUNK_BOUNDARY + 1] as const;

describe('evaluateUploadReconciliation', () => {
  describe('exactly-reconciled batches yield a clean verdict', () => {
    it.each(BOUNDARY_SOURCE_COUNTS)('input=%i fully accounted as success+failed is reconciled', source => {
      // Split each boundary count across success and failure so both columns are exercised.
      const failed = source === 0 ? 0 : Math.min(1, source);
      const succeeded = source - failed;
      const verdict = evaluateUploadReconciliation({ sourceRecords: source, successfulRecords: succeeded, failedRecords: failed });

      expect(verdict.reconciled, `input=${source} succeeded=${succeeded} failed=${failed} should reconcile`).toBe(true);
      expect(verdict.accountedRecords).toBe(source);
      expect(verdict.unaccountedRecords).toBe(0);
      expect(verdict.missingRecords).toBe(0);
      expect(verdict.severity).toBe(ReconciliationSeverity.RECONCILED);
      expect(verdict.code).toBeNull();
    });

    it('all-success with no failures reconciles at the chunk boundary', () => {
      const verdict = evaluateUploadReconciliation({ sourceRecords: CHUNK_BOUNDARY, successfulRecords: CHUNK_BOUNDARY, failedRecords: 0 });
      expect(verdict.reconciled).toBe(true);
      expect(verdict.missingRecords).toBe(0);
    });
  });

  describe('a single lost row across the chunk boundary is a CRITICAL blocking mismatch', () => {
    it.each(BOUNDARY_SOURCE_COUNTS.filter(n => n >= 1))('input=%i with one row swallowed does NOT reconcile', source => {
      // One input row neither succeeds nor surfaces as a failure — the exact regression.
      const succeeded = source - 1;
      const verdict = evaluateUploadReconciliation({ sourceRecords: source, successfulRecords: succeeded, failedRecords: 0 });

      expect(verdict.reconciled, `input=${source} succeeded=${succeeded} failed=0 must be a mismatch`).toBe(false);
      expect(verdict.accountedRecords).toBe(succeeded);
      expect(verdict.unaccountedRecords).toBe(1);
      expect(verdict.missingRecords).toBe(1);
      expect(verdict.severity).toBe(ReconciliationSeverity.CRITICAL);
      expect(verdict.code).toBe(RECONCILIATION_MISMATCH_CODE);
      expect(verdict.detail).toContain('were lost');
    });
  });

  describe('more rows than were input is a WARNING mismatch (over-count / duplication)', () => {
    it.each(BOUNDARY_SOURCE_COUNTS.filter(n => n >= 1))('input=%i with one extra materialized row does NOT reconcile', source => {
      const verdict = evaluateUploadReconciliation({ sourceRecords: source, successfulRecords: source, failedRecords: 1 });

      expect(verdict.reconciled).toBe(false);
      expect(verdict.unaccountedRecords).toBe(-1);
      expect(verdict.missingRecords).toBe(1);
      expect(verdict.severity).toBe(ReconciliationSeverity.WARNING);
      expect(verdict.code).toBe(RECONCILIATION_MISMATCH_CODE);
      expect(verdict.detail).toContain('duplicated');
    });
  });

  describe("missingRecords matches the procedure's ABS(@unaccounted)", () => {
    it('reports the absolute gap size regardless of direction', () => {
      const lost = evaluateUploadReconciliation({ sourceRecords: CHUNK_BOUNDARY + 1, successfulRecords: CHUNK_BOUNDARY - 4, failedRecords: 0 });
      expect(lost.unaccountedRecords).toBe(5);
      expect(lost.missingRecords).toBe(5);
      expect(lost.severity).toBe(ReconciliationSeverity.CRITICAL);

      const over = evaluateUploadReconciliation({ sourceRecords: CHUNK_BOUNDARY, successfulRecords: CHUNK_BOUNDARY, failedRecords: 3 });
      expect(over.unaccountedRecords).toBe(-3);
      expect(over.missingRecords).toBe(3);
      expect(over.severity).toBe(ReconciliationSeverity.WARNING);
    });
  });

  describe('an empty batch is trivially reconciled', () => {
    it('input=0 success=0 failed=0 reconciles with no missing rows', () => {
      const verdict = evaluateUploadReconciliation({ sourceRecords: 0, successfulRecords: 0, failedRecords: 0 });
      expect(verdict.reconciled).toBe(true);
      expect(verdict.missingRecords).toBe(0);
      expect(verdict.code).toBeNull();
    });
  });

  describe('rejects malformed counts instead of silently coercing', () => {
    const badInputs: Array<[string, UploadReconciliationInput]> = [
      ['negative source', { sourceRecords: -1, successfulRecords: 0, failedRecords: 0 }],
      ['fractional success', { sourceRecords: 10, successfulRecords: 9.5, failedRecords: 0 }],
      ['NaN failed', { sourceRecords: 10, successfulRecords: 5, failedRecords: Number.NaN }]
    ];
    it.each(badInputs)('throws a TypeError on %s', (_label, input) => {
      expect(() => evaluateUploadReconciliation(input)).toThrow(TypeError);
    });
  });
});
