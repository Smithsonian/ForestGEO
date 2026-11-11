/** Counts a revisions apply reports; shared by the apply screen and the completion screen. */
export interface RevisionApplyOutcomeCounts {
  updatedCount: number;
  deletedDuplicateCount: number;
  insertedCount: number;
  failedRowCount: number;
  skippedCount: number;
  applyErrorCount: number;
  hasDuplicateCleanupOnlyRows: boolean;
}

/** Reconciled totals: insertedRows + failedRows === sourceRows, read back from the database. */
export interface IngestionUploadOutcome {
  kind: 'ingestion';
  sourceRows: number;
  insertedRows: number;
  failedRows: number;
}

export interface RevisionsUploadOutcome extends RevisionApplyOutcomeCounts {
  kind: 'revisions';
}

export type UploadOutcome = IngestionUploadOutcome | RevisionsUploadOutcome;
