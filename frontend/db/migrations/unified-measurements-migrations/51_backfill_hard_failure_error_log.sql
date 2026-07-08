-- =====================================================================================
-- Migration Script 51: Backfill measurement_error_log for orphaned hard failures
-- =====================================================================================
-- Purpose:
--   Hard-failed records are inserted into coremeasurements with StemGUID = NULL and
--   linked to measurement_error_log via an INNER JOIN on measurement_errors. If the
--   measurement_errors seed row for an ErrorCode was missing at ingestion time, the
--   error log link was silently dropped. The hard-failed record exists but is invisible
--   in View Errors.
--
--   This migration:
--   1. Ensures all ingestion ErrorCodes exist in measurement_errors (idempotent seed)
--   2. Finds coremeasurements rows where StemGUID IS NULL (hard failures) whose
--      Description matches known failure patterns
--   3. Inserts the missing measurement_error_log links via INSERT IGNORE
--   4. Catch-all: tags remaining true hard-failure orphans with SQL_EXCEPTION
--      so they appear in View Errors
--
--   Important:
--   Invalid attribute codes were briefly treated as hard failures by mistake,
--   but the committed contract has reverted them to soft validation 14. This
--   migration intentionally does NOT backfill those rows into
--   measurement_error_log as ingestion failures. They should be repaired by
--   re-ingestion / one-off data repair under the current soft-validation path.
--
--   Idempotent: INSERT IGNORE on the PK (MeasurementID, ErrorID) ensures
--   re-running this migration never creates duplicate entries.
-- =====================================================================================

-- Step 1: Ensure all ingestion error codes exist.
-- Safety net for schemas that missed earlier seed migrations (30, 37, 39, 49).
INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
VALUES ('ingestion', 'MISSING_FIELD_TREETAG',       'Missing required field: TreeTag'),
       ('ingestion', 'MISSING_FIELD_STEMTAG',       'Missing required field: StemTag'),
       ('ingestion', 'MISSING_FIELD_SPECIESCODE',   'Missing required field: SpeciesCode'),
       ('ingestion', 'MISSING_FIELD_QUADRATNAME',   'Missing required field: QuadratName'),
       ('ingestion', 'MISSING_FIELD_DATE',          'Missing required field: MeasurementDate'),
       ('ingestion', 'INVALID_QUADRAT',             'Invalid quadrat reference'),
       ('ingestion', 'INVALID_SPECIES',             'Invalid species reference'),
       ('ingestion', 'AMBIGUOUS_QUADRAT',           'Quadrat name resolves to multiple active quadrats in the same plot'),
       ('ingestion', 'AMBIGUOUS_SPECIES',           'Species code resolves to multiple active species records'),
       ('ingestion', 'QUADRAT_MISMATCH',            'Quadrat mismatch across censuses'),
       ('ingestion', 'COORDINATE_DRIFT',            'Coordinate drift exceeds allowed threshold'),
       ('ingestion', 'DUPLICATE_ENTRY',             'Duplicate measurement row detected'),
       ('ingestion', 'DUPLICATE_TAG_STEMTAG',       'Duplicate TreeTag/StemTag within upload batch'),
       ('ingestion', 'DUPLICATE_TAG_CONFLICT',      'Conflicting duplicate TreeTag/StemTag rows detected in upload batch'),
       ('ingestion', 'DUPLICATE_TAG_CONFLICT_EXISTING', 'Conflicting TreeTag/StemTag matches existing census measurement'),
       ('ingestion', 'NEGATIVE_DBH',                'DBH must be non-negative'),
       ('ingestion', 'NEGATIVE_HOM',                'HOM must be non-negative'),
       ('ingestion', 'INVALID_COORDINATE',          'Coordinate value is negative'),
       ('ingestion', 'FIELD_TOO_LONG',              'One or more fields exceed column length limits'),
       ('ingestion', 'MISSING_MEASUREMENT_DATA',    'Missing measurement data'),
       ('ingestion', 'AMBIGUOUS_PREVIOUS_MATCH',    'Ambiguous previous census match'),
       ('ingestion', 'MISSING_CENSUS_FOR_TREE',     'Tree insert blocked by missing census'),
       ('ingestion', 'MISSING_SPECIES_FOR_TREE',    'Tree insert blocked by missing species'),
       ('ingestion', 'TREE_RESOLUTION_FAILED',      'Tree resolution failed after tree materialization'),
       ('ingestion', 'STEM_TREE_RESOLUTION_FAILED', 'Stem resolution failed because no active tree matched'),
       ('ingestion', 'STEM_RESOLUTION_FAILED',      'Stem resolution failed after stem materialization'),
       ('ingestion', 'MEASUREMENT_INSERT_SKIPPED',  'Measurement insert skipped during core materialization'),
       ('ingestion', 'SQL_EXCEPTION',               'Ingestion SQL exception');

-- Step 2: Backfill measurement_error_log for hard-failure rows.
--
-- Hard-failed rows have StemGUID IS NULL and their Description contains the
-- concatenated failure reasons from hard_failure_rows (separated by '; ').
-- We match Description substrings to error codes using the same patterns
-- that bulkingestionprocess uses to classify failures.
--
-- A single row can match multiple patterns (e.g., missing both TreeTag and
-- StemTag). INSERT IGNORE on the composite PK (MeasurementID, ErrorID)
-- ensures idempotency -- existing entries are silently skipped.

-- MISSING_FIELD_TREETAG: "Missing required field: TreeTag"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'MISSING_FIELD_TREETAG'
  AND cm.Description LIKE '%Missing required field: TreeTag%';

-- MISSING_FIELD_STEMTAG: "Missing required field: StemTag"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'MISSING_FIELD_STEMTAG'
  AND cm.Description LIKE '%Missing required field: StemTag%';

-- MISSING_FIELD_SPECIESCODE: "Missing required field: SpeciesCode"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'MISSING_FIELD_SPECIESCODE'
  AND cm.Description LIKE '%Missing required field: SpeciesCode%';

-- MISSING_FIELD_QUADRATNAME: "Missing required field: QuadratName"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'MISSING_FIELD_QUADRATNAME'
  AND cm.Description LIKE '%Missing required field: QuadratName%';

-- MISSING_FIELD_DATE: "Missing required field: MeasurementDate"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'MISSING_FIELD_DATE'
  AND cm.Description LIKE '%Missing required field: MeasurementDate%';

-- MISSING_MEASUREMENT_DATA: "Missing measurement data"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'MISSING_MEASUREMENT_DATA'
  AND cm.Description LIKE '%Missing measurement data%';

-- INVALID_COORDINATE: "Invalid Local" (pattern from validation_failures)
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'INVALID_COORDINATE'
  AND cm.Description LIKE '%Invalid Local%';

-- FIELD_TOO_LONG: "exceeds maximum length"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'FIELD_TOO_LONG'
  AND cm.Description LIKE '%exceeds maximum length%';

-- NEGATIVE_DBH: "Invalid DBH"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'NEGATIVE_DBH'
  AND cm.Description LIKE '%Invalid DBH%';

-- NEGATIVE_HOM: "Invalid HOM"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'NEGATIVE_HOM'
  AND cm.Description LIKE '%Invalid HOM%';

-- DUPLICATE_ENTRY: "Duplicate entry: Same TreeTag/StemTag/DBH/HOM/Date"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'DUPLICATE_ENTRY'
  AND cm.Description LIKE '%Duplicate entry:%';

-- DUPLICATE_TAG_STEMTAG: "Duplicate TreeTag/StemTag within upload batch"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'DUPLICATE_TAG_STEMTAG'
  AND cm.Description LIKE '%Duplicate TreeTag/StemTag within upload batch%';

-- AMBIGUOUS_QUADRAT: "Ambiguous quadrat name"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'AMBIGUOUS_QUADRAT'
  AND cm.Description LIKE '%Ambiguous quadrat name%';

-- AMBIGUOUS_SPECIES: "Ambiguous species code"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'AMBIGUOUS_SPECIES'
  AND cm.Description LIKE '%Ambiguous species code%';

-- INVALID_QUADRAT: "Invalid quadrat name"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'INVALID_QUADRAT'
  AND cm.Description LIKE '%Invalid quadrat name%';

-- INVALID_SPECIES: "Invalid species code"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'INVALID_SPECIES'
  AND cm.Description LIKE '%Invalid species code%';

-- AMBIGUOUS_PREVIOUS_MATCH: "Ambiguous previous census"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'AMBIGUOUS_PREVIOUS_MATCH'
  AND cm.Description LIKE '%Ambiguous previous census%';

-- QUADRAT_MISMATCH: "Quadrat mismatch:"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'QUADRAT_MISMATCH'
  AND cm.Description LIKE '%Quadrat mismatch:%';

-- COORDINATE_DRIFT: "Coordinate drift:"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'COORDINATE_DRIFT'
  AND cm.Description LIKE '%Coordinate drift:%';

-- MISSING_CENSUS_FOR_TREE: "Tree insert blocked: Census"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'MISSING_CENSUS_FOR_TREE'
  AND cm.Description LIKE '%Tree insert blocked: Census%';

-- MISSING_SPECIES_FOR_TREE: "Tree insert blocked: species"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'MISSING_SPECIES_FOR_TREE'
  AND cm.Description LIKE '%Tree insert blocked: species%';

-- TREE_RESOLUTION_FAILED: "Tree resolution failed"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'TREE_RESOLUTION_FAILED'
  AND cm.Description LIKE '%Tree resolution failed%';

-- STEM_TREE_RESOLUTION_FAILED: "Stem resolution failed: no active tree"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'STEM_TREE_RESOLUTION_FAILED'
  AND cm.Description LIKE '%Stem resolution failed: no active tree%';

-- STEM_RESOLUTION_FAILED: "Stem resolution failed" (excluding "no active tree" = STEM_TREE_RESOLUTION_FAILED)
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'STEM_RESOLUTION_FAILED'
  AND cm.Description LIKE '%Stem resolution failed%'
  AND cm.Description NOT LIKE '%Stem resolution failed: no active tree%';

-- MEASUREMENT_INSERT_SKIPPED: "Measurement insert skipped"
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'MEASUREMENT_INSERT_SKIPPED'
  AND cm.Description LIKE '%Measurement insert skipped%';

-- Step 3: Catch-all for remaining true hard-failure orphans that still have
-- NO error_log entry after all pattern-specific inserts above. These get the
-- generic SQL_EXCEPTION code so they at least appear in View Errors rather
-- than being invisible.
--
-- Deliberately skip the reverted invalid-attribute regression
-- ("Invalid attribute code(s): ..."). Those rows should be reprocessed under
-- the current soft-validation contract, not relabeled as hard ingestion errors.
INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
FROM coremeasurements cm
CROSS JOIN measurement_errors me
WHERE cm.StemGUID IS NULL
  AND cm.IsActive = 1
  AND me.ErrorSource = 'ingestion' AND me.ErrorCode = 'SQL_EXCEPTION'
  AND cm.Description IS NOT NULL AND TRIM(cm.Description) != ''
  AND cm.Description NOT LIKE 'Invalid attribute code(s):%'
  AND NOT EXISTS (
      SELECT 1 FROM measurement_error_log mel
      WHERE mel.MeasurementID = cm.CoreMeasurementID
  );

SELECT 'Migration 51 complete: measurement_error_log backfilled for orphaned hard-failure rows.' AS Status;
