import { FileRow } from '@/config/macros/formdetails';
import { BulkEditPlan } from '@/config/editplan/types';

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

export interface RevisionMatchCounts {
  matched: number;
  matchedWithChanges: number;
  new: number;
  invalid: number;
  total: number;
}

export interface RevisionUploadResponse {
  matchedRows: RevisionMatchedRow[];
  newRows: RevisionNewRowCandidate[];
  invalidRows: RevisionInvalidRow[];
  counts: RevisionMatchCounts;
  /**
   * Bulk edit plan for this revision match, surfacing downstream effects
   * (R5 attributes rebuild, R6 duplicate deletion) so the review screen
   * can render an impact summary and gate destructive applies behind a
   * typed-confirm prompt. See app/api/revisionupload/route.ts for Phase 1
   * scope (attributes + duplicates only).
   */
  bulkPlan: BulkEditPlan;
}

export interface RevisionApplyMatchedRow {
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
  applyErrors: RevisionApplyError[];
  validationPending: boolean;
}

export const EMPTY_REVISION_MATCH_COUNTS: RevisionMatchCounts = {
  matched: 0,
  matchedWithChanges: 0,
  new: 0,
  invalid: 0,
  total: 0
};
