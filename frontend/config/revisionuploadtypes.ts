import { FileRow } from '@/config/macros/formdetails';
import { BulkEditPlan } from '@/config/editplan/types';

export interface RevisionMatchedRow {
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
  changes: Record<string, { from: unknown; to: unknown }>;
  /**
   * Edits detected on columns that are present in the revision CSV but not
   * updatable through revision upload in Phase 1 (e.g. spcode, lx, ly,
   * quadrat, tag, stemtag). These are surfaced in the UI so the user knows
   * their edits were dropped rather than silently applied.
   */
  ignoredEdits?: Record<string, { from: unknown; to: unknown }>;
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
