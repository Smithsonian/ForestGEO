import { CENSUS_REPLACEMENT_STATEMENT } from './census-replacement-statement-patterns';

/**
 * Test-side recognisers for the statements the #562 walk and the failed-first-census recovery issue.
 * One copy, so barriers, injections and log checks cannot drift apart. Every pattern tolerates the
 * newlines and indentation of the production templates.
 */
export const WINDOW_WALK_STATEMENT = {
  /** The walk's one non-locking read: no LIMIT, no lock (C1's is RECOVERY_SCOPE_READ, which also matches this). */
  SCOPE_READ: /^\s*SELECT\s+(DISTINCT\s+cm\.)?CoreMeasurementID\s+FROM\s[\s\S]*\sORDER BY\s+(cm\.)?CoreMeasurementID\s*$/,
  RECOVERY_SCOPE_READ: /^\s*SELECT\s+CoreMeasurementID\s+FROM\s+\S+\.coremeasurements\s+WHERE\s+CensusID = \?\s+ORDER BY\s+CoreMeasurementID\s*$/,
  /** A window: primary-key hint, explicit id list, row locks. */
  WINDOW_LOCK:
    /^\s*SELECT\s+\/\*\+\s+(JOIN_PREFIX\(cm\)\s+INDEX\(cm PRIMARY\)|INDEX\(coremeasurements PRIMARY\))\s+\*\/[\s\S]*\sIN\s+\([\s\S]*\sFOR UPDATE(\s+OF\s+[\w, ]+)?\s*$/,
  /** The walk's locking confirmation (today's window statement, once per walk). */
  CONFIRMATION: /^\s*SELECT\s+(DISTINCT\s+cm\.)?CoreMeasurementID\s+FROM\s[\s\S]*\sLIMIT\s+\d+\s+FOR UPDATE(\s+OF\s+[\w, ]+)?\s*$/,
  CENSUS_LOCK: /^\s*SELECT CensusID FROM\s+\S+\.census WHERE CensusID = \? FOR UPDATE\s*$/,
  COMPLETED_UPLOADS_GUARD: /^\s*SELECT COUNT\(\*\) AS completedUploads FROM\s+\S+\.uploadmetrics/,
  RECOVERY_STATE_READ: /AS completedUploads,[\s\S]*AS coreMeasurementCount/,
  RECOVERY_FINAL_READ: /^\s*SELECT CoreMeasurementID FROM\s+\S+\.coremeasurements WHERE CensusID = \? ORDER BY CoreMeasurementID LIMIT \d+\s*$/,
  DELETE_AUDIT: CENSUS_REPLACEMENT_STATEMENT.DELETE_AUDIT,
  MEASUREMENT_DELETE: CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_DELETE,
  STEMS_DELETE: /^\s*DELETE FROM\s+\S+\.stems WHERE CensusID = \?/,
  RECOVERY_METRICS_DELETE: /^\s*DELETE FROM\s+\S+\.uploadmetrics WHERE PlotID = \? AND CensusID = \? AND status IN/,
  SETUP_FAMILY_DISCOVERY: /GROUP BY BatchID\s+ORDER BY BatchID FOR UPDATE\s*$/,
  PRE_CALL_SNAPSHOT: /FROM\s+\S+\.coremeasurements\s+WHERE UploadFileID = \? AND UploadBatchID = \?\s*$/,
  BULK_INGESTION_CALL: /CALL\s+\S*bulkingestionprocess/i
} as const;

/** Markers that tell one caller's walk statements from another's inside one transaction. */
export const WALK_SCOPE_MARKER = {
  C1: /WHERE\s+\(?CensusID = \?\)?\s+(AND CoreMeasurementID IN|ORDER BY)/,
  C2: /UploadFileID = \? AND NOT \(UploadBatchID <=> \?/,
  C3: /DISTINCT cm\.CoreMeasurementID/,
  C4: /\(UploadBatchID = \? OR UploadBatchID LIKE \?/
} as const;
