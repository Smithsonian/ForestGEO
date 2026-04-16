import { FileRow } from '@/config/macros/formdetails';

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
}

export interface RevisionNewRowCandidate {
  csvRow: FileRow;
  csvIndex: number;
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
}

export interface RevisionApplyMatchedRow {
  coreMeasurementID: number;
  csvRow: FileRow;
  /** Duplicate CoreMeasurementIDs that should be removed after this row survives. */
  duplicateMeasurementIDsToDelete?: number[];
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
