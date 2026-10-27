import { FileRow } from '@/config/macros/formdetails';
import { AppliedSpeciesCorrectionBatchSummary, BulkEditPlan } from '@/config/editplan/types';

export interface RevisionMatchedRow {
  /**
   * 0-based row index from the source CSV (offset across multi-file uploads).
   * Used to surface the row number in the Invalid tab when a matched row is
   * demoted post-classification (e.g., TreeStemResolution: missing quadrat),
   * and to keep matched rows traceable back to their CSV origin in error UIs.
   */
  csvIndex: number;
  csvRow: FileRow;
  coreMeasurementID: number;
  /** Duplicate CoreMeasurementIDs that should be removed after this row survives. */
  duplicateMeasurementIDsToDelete?: number[];
  existingValues: {
    measuredDBH: number | null;
    measuredHOM: number | null;
    measurementDate: string | null;
    rawCodes: string | null;
    description: string | null;
  };
  /**
   * Per-field diff of CSV value vs current DB value. Phase 2 of revision
   * upload promoted identity columns (spcode, tag, stemtag, quadrat, lx, ly)
   * into this set, so identity edits flow through the same analyzer + writer
   * as the single-row PATCH path and surface R1a/R2/R3/R4 effects in the
   * bulk plan.
   */
  changes: Record<string, { from: unknown; to: unknown }>;
}

export type RevisionNewRowReason = 'no-match-key-in-db' | 'stemid-not-found';

export interface RevisionNewRowCandidate {
  csvRow: FileRow;
  csvIndex: number;
  /**
   * Why this row is being inserted as new.
   *
   * `stemid-not-found` means the user supplied a StemGUID intending to update
   * an existing measurement, but the StemGUID did not match any measurement
   * in the target census. The uploaded StemGUID is ignored on insert and a
   * brand new tree/stem is created through the standard ingestion pipeline.
   *
   * `no-match-key-in-db` means the user matched by tag/stemtag and no
   * existing measurement was found — intent was already "create new".
   */
  reason: RevisionNewRowReason;
}

export interface RevisionInvalidRow {
  csvRow: FileRow;
  csvIndex: number;
  reason: string;
}

/**
 * A later row that shares a match key (stemid, or tag+stemtag) with an
 * earlier row in the same upload and differs from it only beyond the stored
 * precision of coremeasurements' DECIMAL(12,6) measurement/coordinate
 * columns (frontend/db/sql/tablestructures.sql). Export-tool float rounding
 * can introduce a difference in, e.g., the 7th decimal of DBH that can never
 * be represented in storage — collapsing the row into the earlier occurrence
 * is accounting-only (no DB write at apply time): it is neither a failure
 * nor a silent drop, it is the same stored measurement counted once.
 */
export interface RevisionCollapsedRow {
  csvRow: FileRow;
  csvIndex: number;
  /** csvIndex of the first occurrence this row collapsed into. */
  collapsedIntoCsvIndex: number;
}

export interface RevisionMatchCounts {
  matched: number;
  matchedWithChanges: number;
  new: number;
  invalid: number;
  collapsed: number;
  total: number;
}

export interface RevisionUploadResponse {
  matchedRows: RevisionMatchedRow[];
  newRows: RevisionNewRowCandidate[];
  invalidRows: RevisionInvalidRow[];
  /** Rows collapsed into an earlier same-key occurrence; see RevisionCollapsedRow. */
  collapsedRows: RevisionCollapsedRow[];
  counts: RevisionMatchCounts;
  /**
   * Bulk edit plan for this revision match, surfacing downstream effects
   * (R5 attributes rebuild, R6 duplicate deletion) so the review screen
   * can render an impact summary and gate destructive applies behind a
   * typed-confirm prompt. See app/api/revisionupload/route.ts for Phase 1
   * scope (attributes + duplicates only).
   */
  bulkPlan: BulkEditPlan;
  /**
   * Per-attempt identity minted by this match call (UUID v4), echoed back
   * unchanged on /apply. Derives the failed-row batchID and scopes
   * invalidRowsIntegrityHash — see shared/invalidrowintegrity.ts.
   */
  uploadAttemptID: string;
  /**
   * Authenticated HMAC (computeInvalidRowsIntegrityHash) over this
   * response's invalidRows. Apply recomputes it and 409s on mismatch
   * before persisting anything, so a client can't edit a rejected row's
   * content after review without invalidating the plan.
   */
  invalidRowsIntegrityHash: string;
}

export interface RevisionApplyMatchedRow {
  /** 0-based row index from the source CSV, used to keep apply-time invalid-row plan hashes stable. */
  csvIndex?: number;
  coreMeasurementID: number;
  csvRow: FileRow;
  /** Duplicate CoreMeasurementIDs that should be removed after this row survives. */
  duplicateMeasurementIDsToDelete?: number[];
}

export interface RevisionApplyNewRow {
  csvRow: FileRow;
  csvIndex: number;
}

export interface RevisionDuplicateToDelete {
  /** The CoreMeasurementID of the duplicate row to remove. */
  coreMeasurementID: number;
  /** The CoreMeasurementID of the matched row that should survive. */
  survivorCoreMeasurementID: number;
}

export interface RevisionApplyError {
  coreMeasurementID: number;
  error: string;
}

export interface RevisionApplyResponse {
  updatedCount: number;
  skippedCount: number;
  insertedCount: number;
  deletedDuplicateCount: number;
  /**
   * Number of invalid rows persisted as failed measurements (StemGUID=NULL
   * coremeasurements rows tagged via measurement_errors/measurement_error_log,
   * e.g. DUPLICATE_ENTRY) during this apply. Every row submitted in the
   * request's invalidRows is accounted for here or in applyErrors — none are
   * silently dropped.
   */
  failedRowCount: number;
  applyErrors: RevisionApplyError[];
  validationPending: boolean;
  /** Present only when this batch applied #427 tree-wide species corrections. Not revertable. */
  speciesCorrections?: AppliedSpeciesCorrectionBatchSummary;
}

export const EMPTY_REVISION_MATCH_COUNTS: RevisionMatchCounts = {
  matched: 0,
  matchedWithChanges: 0,
  new: 0,
  invalid: 0,
  collapsed: 0,
  total: 0
};
