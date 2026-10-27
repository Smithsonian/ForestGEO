import { CENSUS_REPLACEMENT_SCAN_INDEX } from '@/lib/ingestion/temporary-measurements';

/** Test-side recognisers for the statements a census replacement issues. One copy, so fakes, barriers and log checks cannot drift apart. */
export const CENSUS_REPLACEMENT_STATEMENT = {
  MARKER_COLUMN_STATE: /information_schema\.TABLES[\s\S]*upload_sessions/,
  SESSION_LOCK: /FROM\s+\S+\.upload_sessions\s+WHERE session_id = \?\s+FOR UPDATE/,
  MARKER_PROBE: /^\s*SELECT census_replacement_completed_at FROM\s+\S+\.upload_sessions/,
  MARKER_UPDATE: /^\s*UPDATE\s+\S+\.upload_sessions\s+SET census_replacement_completed_at/,
  FAMILY_PROBE: /SELECT 1 AS staged FROM/,
  MEASUREMENT_ID_SELECT: new RegExp(`^\\s*SELECT /\\*\\+ INDEX\\(coremeasurements ${CENSUS_REPLACEMENT_SCAN_INDEX}\\) \\*/ CoreMeasurementID FROM`),
  ERROR_LINK_DELETE: /^\s*DELETE FROM\s+\S+\.(measurement_error_log|cmverrors)\b/,
  DELETE_AUDIT: /^\s*INSERT INTO\s+\S+\.unifiedchangelog[\s\S]*FROM\s+\S+\.coremeasurements cm\b/,
  MEASUREMENT_DELETE: /^\s*DELETE FROM\s+\S+\.coremeasurements WHERE CoreMeasurementID IN/,
  LEGACY_DELETE: /^\s*DELETE FROM\s+\S+\.failedmeasurements\b/,
  METRICS_DELETE: /^\s*DELETE FROM\s+\S+\.uploadmetrics\b/
} as const;

/** Acceptance criterion 1's list: none of these may run in a transaction that stages rows. */
export const CENSUS_REPLACEMENT_WRITE_PATTERNS: readonly RegExp[] = [
  CENSUS_REPLACEMENT_STATEMENT.ERROR_LINK_DELETE,
  CENSUS_REPLACEMENT_STATEMENT.DELETE_AUDIT,
  CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_DELETE,
  CENSUS_REPLACEMENT_STATEMENT.LEGACY_DELETE,
  CENSUS_REPLACEMENT_STATEMENT.METRICS_DELETE,
  CENSUS_REPLACEMENT_STATEMENT.MARKER_UPDATE
];
