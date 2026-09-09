-- =====================================================================================
-- Migration 2026-09-09-01: upload_sessions.reference_replacement_completed_at
-- =====================================================================================
-- A CLEAN_REUPLOAD of a reference table (species, attributes, personnel) deletes
-- the whole active table before writing the incoming rows. The upload route
-- issues one request per file, so a multi-file upload ran that delete once per
-- file: the second file erased the rows the first file had just committed, with
-- no error shown to the uploader (#472).
--
-- This column makes "this session has already replaced the reference table" a
-- durable fact instead of an assumption about request counts. It is written in
-- the same transaction as the delete it guards, so the marker and the delete can
-- never disagree. It is the reference-table twin of
-- census_replacement_completed_at (2026-07-29-01).
--
-- ADD COLUMN on InnoDB runs in-place and permits concurrent DML. Existing rows
-- get NULL, which reads as "this session has not replaced the reference table
-- yet" — the correct answer for a session created before the column existed.

SET @column_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'upload_sessions'
      AND COLUMN_NAME = 'reference_replacement_completed_at'
);
SET @table_exists := (
    SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'upload_sessions'
);
SET @ddl := IF(@table_exists = 0,
    'SELECT ''upload_sessions does not exist in this schema; nothing to repair'' AS Status',
    IF(@column_exists > 0,
        'SELECT ''upload_sessions.reference_replacement_completed_at already present'' AS Status',
        'ALTER TABLE `upload_sessions` ADD COLUMN `reference_replacement_completed_at` TIMESTAMP NULL DEFAULT NULL'
    )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 2026-09-09-01 complete: upload session reference-replacement marker ensured.' AS Status;
