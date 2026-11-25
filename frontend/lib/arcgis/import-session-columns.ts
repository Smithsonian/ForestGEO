/**
 * Commit-progress columns of `arcgis_import_sessions` (#561, migration 2026-10-28-02). Kept free of imports so the
 * schema contract, which deploy scripts load, can name them without pulling in the database layer.
 */
export const ARCGIS_IMPORT_COMMIT_PROGRESS_COLUMNS = [
  'committed_upload_mode',
  'commit_attempt_id',
  'census_replacement_completed_at',
  'staging_next_row_index'
] as const;
