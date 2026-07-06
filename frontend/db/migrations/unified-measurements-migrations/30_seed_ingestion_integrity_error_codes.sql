-- =====================================================================================
-- Migration Script 30: Seed all missing measurement error codes
-- =====================================================================================
-- Purpose:
--   - Register ingestion integrity error codes used by bulkingestionprocess
--     that were not included in migration 18's initial seed.
--   - Register validation error codes ('14', '20', '21') used by the SP's
--     attribute materialization and species mismatch checks.
--   - Idempotent via INSERT IGNORE (safe to re-run).
-- =====================================================================================

-- Ingestion codes missing from migration 18
INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
VALUES ('ingestion', 'MISSING_FIELD_SPECIESCODE', 'Missing required field: SpeciesCode'),
       ('ingestion', 'MISSING_FIELD_QUADRATNAME', 'Missing required field: QuadratName'),
       ('ingestion', 'MISSING_FIELD_DATE', 'Missing required field: MeasurementDate'),
       ('ingestion', 'INVALID_COORDINATE', 'Coordinate value is negative'),
       ('ingestion', 'AMBIGUOUS_PREVIOUS_MATCH', 'Ambiguous previous census match');

-- Ingestion integrity codes for detailed orphan tracking
INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
VALUES ('ingestion', 'MISSING_CENSUS_FOR_TREE', 'Tree insert blocked by missing census'),
       ('ingestion', 'MISSING_SPECIES_FOR_TREE', 'Tree insert blocked by missing species'),
       ('ingestion', 'TREE_RESOLUTION_FAILED', 'Tree resolution failed after tree materialization'),
       ('ingestion', 'STEM_TREE_RESOLUTION_FAILED', 'Stem resolution failed because no active tree matched'),
       ('ingestion', 'STEM_RESOLUTION_FAILED', 'Stem resolution failed after stem materialization'),
       ('ingestion', 'MEASUREMENT_INSERT_SKIPPED', 'Measurement insert skipped during core materialization');

-- Validation codes used by bulkingestionprocess stages 9 and 10
-- (not covered by the dynamic sitespecificvalidations seed in migration 18)
INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
VALUES ('validation', '14', 'Invalid attribute code'),
       ('validation', '20', 'Species mismatch from previous census'),
       ('validation', '21', 'Same-batch species conflict');

SELECT 'Migration 30 complete: all missing measurement error codes seeded.' AS Status;
