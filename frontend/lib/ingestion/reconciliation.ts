/**
 * Upload reconciliation verdict.
 *
 * Mirrors the FINAL RECONCILIATION CHECK inside bulkingestionprocess
 * (db/sql/storedprocedures.sql): the procedure computes
 *
 *     @unaccounted = vBatchRowCount - @final_success - vDataLossCount
 *
 * and, when that delta is non-zero, logs a RECONCILIATION_MISMATCH row into
 * uploadintegrityalerts (severity 'critical' when rows were LOST, 'warning' when
 * MORE rows appeared than were input) and records missingRecords = ABS(delta) on
 * uploadmetrics.
 *
 * This module is the client-side authority that turns those same counts into a
 * BLOCKING verdict: an upload is "clean" only when every input row is accounted
 * for as either a success or a surfaced failure. A non-zero delta means at least
 * one row was silently swallowed or duplicated and MUST NOT be reported as a clean
 * completion. The math and the mismatch literal are grounded in the SQL, not
 * invented here.
 */

/**
 * uploadintegrityalerts.type literal the procedure emits for a reconciliation gap.
 * Verbatim from db/sql/storedprocedures.sql (FINAL RECONCILIATION CHECK).
 */
export const RECONCILIATION_MISMATCH_CODE = 'RECONCILIATION_MISMATCH' as const;

/**
 * Verdict severities. 'reconciled' is the only clean state; the two mismatch
 * severities mirror the procedure's own IF(@unaccounted > 0, 'critical', 'warning').
 */
export const ReconciliationSeverity = {
  RECONCILED: 'reconciled',
  CRITICAL: 'critical',
  WARNING: 'warning'
} as const;

export type ReconciliationSeverityValue = (typeof ReconciliationSeverity)[keyof typeof ReconciliationSeverity];

export interface UploadReconciliationInput {
  /** Input row count for the batch (temporarymeasurements rows / parsed source rows). */
  sourceRecords: number;
  /** Rows that landed as successful coremeasurements (StemGUID IS NOT NULL). */
  successfulRecords: number;
  /** Rows surfaced as failures (coremeasurements StemGUID IS NULL, linked to an ingestion error). */
  failedRecords: number;
}

export interface UploadReconciliationVerdict extends UploadReconciliationInput {
  /** True only when sourceRecords === successfulRecords + failedRecords. */
  reconciled: boolean;
  /** successfulRecords + failedRecords. */
  accountedRecords: number;
  /**
   * Signed gap: sourceRecords - accountedRecords. Positive means rows were LOST
   * (fewer accounted than input); negative means MORE rows materialized than were
   * input (duplication/over-count).
   */
  unaccountedRecords: number;
  /** ABS(unaccountedRecords); matches uploadmetrics.missingRecords. */
  missingRecords: number;
  severity: ReconciliationSeverityValue;
  /** RECONCILIATION_MISMATCH_CODE on a mismatch, null when reconciled. */
  code: typeof RECONCILIATION_MISMATCH_CODE | null;
  /** Human-readable diagnosis naming which side is off; safe to surface to the user. */
  detail: string;
}

function assertNonNegativeInteger(label: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`evaluateUploadReconciliation: ${label} must be a non-negative integer, received ${JSON.stringify(value)}`);
  }
}

/**
 * Evaluates whether every input row is accounted for. Pure and total: given the
 * three counts it returns a first-class verdict. Callers gate "clean completion"
 * on verdict.reconciled; a false verdict is a blocking signal, never a soft log.
 */
export function evaluateUploadReconciliation(input: UploadReconciliationInput): UploadReconciliationVerdict {
  assertNonNegativeInteger('sourceRecords', input.sourceRecords);
  assertNonNegativeInteger('successfulRecords', input.successfulRecords);
  assertNonNegativeInteger('failedRecords', input.failedRecords);

  const { sourceRecords, successfulRecords, failedRecords } = input;
  const accountedRecords = successfulRecords + failedRecords;
  const unaccountedRecords = sourceRecords - accountedRecords;
  const missingRecords = Math.abs(unaccountedRecords);
  const reconciled = unaccountedRecords === 0;

  if (reconciled) {
    return {
      ...input,
      reconciled: true,
      accountedRecords,
      unaccountedRecords,
      missingRecords,
      severity: ReconciliationSeverity.RECONCILED,
      code: null,
      detail: `Reconciled: ${sourceRecords} input row(s) = ${successfulRecords} succeeded + ${failedRecords} failed.`
    };
  }

  const lostRows = unaccountedRecords > 0;
  const severity = lostRows ? ReconciliationSeverity.CRITICAL : ReconciliationSeverity.WARNING;
  const detail = lostRows
    ? `${RECONCILIATION_MISMATCH_CODE}: ${missingRecords} input row(s) were not accounted for ` +
      `(${sourceRecords} input, ${successfulRecords} succeeded, ${failedRecords} failed). Rows were lost during ingestion.`
    : `${RECONCILIATION_MISMATCH_CODE}: ${missingRecords} more row(s) materialized than were input ` +
      `(${sourceRecords} input, ${successfulRecords} succeeded, ${failedRecords} failed). Rows were duplicated during ingestion.`;

  return {
    ...input,
    reconciled: false,
    accountedRecords,
    unaccountedRecords,
    missingRecords,
    severity,
    code: RECONCILIATION_MISMATCH_CODE,
    detail
  };
}
