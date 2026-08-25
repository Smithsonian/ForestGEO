-- =====================================================================================
-- Migration 2026-07-16-01: ensure coremeasurements has idx_cm_uploadbatch_census
-- =====================================================================================
-- The 2026-07-16 read-only contract audit of the production server found this index
-- (canonical in db/sql/tablestructures.sql) missing on 6 of 9 site schemas: harvard,
-- mpala, panama, rabi, serc, testing. Batch-scoped upload verification and the
-- ingestion procedures filter coremeasurements by (UploadBatchID, CensusID), so the
-- missing index is both a contract failure and a per-upload full-scan cost.
-- CREATE INDEX on InnoDB runs in-place and permits concurrent DML.

SET @index_exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'coremeasurements'
      AND INDEX_NAME = 'idx_cm_uploadbatch_census'
);
SET @ddl := IF(@index_exists > 0,
    'SELECT ''coremeasurements.idx_cm_uploadbatch_census already present'' AS Status',
    'CREATE INDEX `idx_cm_uploadbatch_census` ON `coremeasurements` (`UploadBatchID`, `CensusID`)'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 2026-07-16-01 complete: coremeasurements upload-batch index ensured.' AS Status;
