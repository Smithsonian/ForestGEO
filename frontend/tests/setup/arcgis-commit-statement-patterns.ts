import { BATCH_FAMILY_SCAN_INDEX, STALE_BATCH_SCAN_INDEX } from '@/lib/ingestion/temporary-measurements';

/** Test-side recognisers for the statements an ArcGIS commit (#561) issues. One copy for unit, integration and rehearsal tests. */
export const ARCGIS_COMMIT_STATEMENT = {
  IMPORT_ROW_CLAIM_LOCK: /FROM\s+\S+\.arcgis_import_sessions\s+WHERE import_session_id = \? LIMIT 1 FOR UPDATE\s*$/,
  IMPORT_ROW_UNIT_LOCK:
    /^\s*SELECT state, row_count, staging_next_row_index, committed_row_count, census_replacement_completed_at, committed_batch_id, commit_attempt_id, file_id\s+FROM\s+\S+\.arcgis_import_sessions\s+WHERE import_session_id = \? FOR UPDATE\s*$/,
  IMPORT_ROW_RANGE:
    /^\s*SELECT MIN\(row_index\) AS firstRowIndex, MAX\(row_index\) AS lastRowIndex\s+FROM\s+\S+\.arcgis_import_rows\s+WHERE import_session_id = \?/,
  COMMITTING_IMPORT_PROBE:
    /^\s*SELECT import_session_id FROM\s+\S+\.arcgis_import_sessions\s+WHERE state = \? AND committed_upload_session_id = \? AND import_session_id <> \? LIMIT 1/,
  UPLOAD_SESSION_STATE_LOCK: /^\s*SELECT state FROM\s+\S+\.upload_sessions\s+WHERE session_id = \? FOR UPDATE/,
  PREDECESSOR_FAIL: /^\s*UPDATE\s+\S+\.upload_sessions\s+SET state = \?, error_message = \?\s+WHERE session_id = \? AND state = \?/,
  CLAIM_UPDATE: /^\s*UPDATE\s+\S+\.arcgis_import_sessions\s+SET state = \?, committed_file_id = file_id/,
  ROW_WINDOW_SELECT:
    /^\s*SELECT row_index, row_json FROM\s+\S+\.arcgis_import_rows\s+WHERE import_session_id = \? AND row_index >= \? AND row_index < \? ORDER BY row_index/,
  CURSOR_CAS: /^\s*UPDATE\s+\S+\.arcgis_import_sessions\s+SET staging_next_row_index = \?, committed_row_count = committed_row_count \+ \?/,
  IMPORT_MARKER_UPDATE: /^\s*UPDATE\s+\S+\.arcgis_import_sessions\s+SET census_replacement_completed_at = CURRENT_TIMESTAMP/,
  FINALIZE_UPDATE: /^\s*UPDATE\s+\S+\.arcgis_import_sessions\s+SET state = \?, committed_at = NOW\(\)/,
  STAGED_CLEAR_DELETE: new RegExp(
    `^\\s*DELETE /\\*\\+ INDEX\\(temporarymeasurements ${STALE_BATCH_SCAN_INDEX}\\) \\*/ FROM\\s+\\S+\\.temporarymeasurements\\s+WHERE PlotID = \\? AND CensusID = \\? AND FileID = \\? LIMIT \\d+`
  ),
  FAMILY_ID_SELECT: new RegExp(`^\\s*SELECT /\\*\\+ INDEX\\(coremeasurements ${BATCH_FAMILY_SCAN_INDEX}\\) \\*/ CoreMeasurementID FROM`),
  STAGED_FAMILY_COUNT: /^\s*SELECT COUNT\(\*\) as count FROM\s+\S+\.temporarymeasurements\b/,
  FAMILY_FAILURE_COUNT: /^\s*SELECT COUNT\(\*\) AS failureRowCount FROM\s+\S+\.coremeasurements\b/,
  STAGING_INSERT: /^\s*INSERT IGNORE INTO\s+\S+\.temporarymeasurements\b/,
  FILE_UPLOAD_CHANGELOG_LOCK: /^\s*SELECT ChangeID, NewRowState FROM\s+\S+\.unifiedchangelog\b[\s\S]*FOR UPDATE\s*$/,
  FILE_UPLOAD_CHANGELOG_INSERT: /^\s*INSERT INTO\s+\S+\.unifiedchangelog\s*\(TableName, RecordID, Operation, NewRowState/
} as const;

/** Any data-changing statement; used to prove a rejected unit wrote nothing. */
export const WRITE_STATEMENT = /^\s*(UPDATE|INSERT|DELETE|REPLACE)\b/i;
