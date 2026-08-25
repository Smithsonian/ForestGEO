-- =====================================================================================
-- Migration 2026-07-29-01: upload_sessions.census_replacement_completed_at
-- =====================================================================================
-- A CLEAN_REUPLOAD must replace the census exactly ONCE per upload session. That
-- was inferred from "this session has already staged rows", which is only almost
-- the same thing: when every row of the session's first file dropped as an
-- INSERT IGNORE duplicate, nothing was staged, so the second file read "no staged
-- rows", re-ran the census-wide cleanup, and deleted the failure rows the first
-- file had just recorded.
--
-- This column replaces the inference with a durable fact. It is written in the
-- same transaction as the cleanup, so the marker and the cleanup can never
-- disagree.
--
-- ADD COLUMN on InnoDB runs in-place and permits concurrent DML. Existing rows
-- get NULL, which reads as "this session has not replaced the census yet" — the
-- correct answer for a session created before the column existed.

SET @column_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'upload_sessions'
      AND COLUMN_NAME = 'census_replacement_completed_at'
);
SET @table_exists := (
    SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'upload_sessions'
);
SET @ddl := IF(@table_exists = 0,
    'SELECT ''upload_sessions does not exist in this schema; nothing to repair'' AS Status',
    IF(@column_exists > 0,
        'SELECT ''upload_sessions.census_replacement_completed_at already present'' AS Status',
        'ALTER TABLE `upload_sessions` ADD COLUMN `census_replacement_completed_at` TIMESTAMP NULL DEFAULT NULL'
    )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 2026-07-29-01 complete: upload session census-replacement marker ensured.' AS Status;
