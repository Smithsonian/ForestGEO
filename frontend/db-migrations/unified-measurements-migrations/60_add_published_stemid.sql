-- =====================================================================================
-- Migration Script 60: Add PublishedStemID storage columns
-- =====================================================================================
-- Purpose:
--   Adds SI-assigned PublishedStemID to stems + failed-row provenance RawPublishedStemID
--   to coremeasurements. Nullable/additive/no-backfill. Idempotent via information_schema guards.
-- =====================================================================================

SET @schema_name := DATABASE();

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'stems' AND COLUMN_NAME = 'PublishedStemID');
SET @ddl := IF(@has_col = 0,
    'ALTER TABLE stems ADD COLUMN PublishedStemID int unsigned NULL AFTER StemCrossID', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'stems' AND INDEX_NAME = 'idx_stems_publishedstemid');
SET @ddl := IF(@has_idx = 0,
    'CREATE INDEX idx_stems_publishedstemid ON stems (PublishedStemID)', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'coremeasurements' AND COLUMN_NAME = 'RawPublishedStemID');
SET @ddl := IF(@has_col = 0,
    'ALTER TABLE coremeasurements ADD COLUMN RawPublishedStemID int unsigned NULL AFTER RawCodes', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'temporarymeasurements' AND COLUMN_NAME = 'PublishedStemID');
SET @ddl := IF(@has_col = 0,
    'ALTER TABLE temporarymeasurements ADD COLUMN PublishedStemID int unsigned NULL AFTER Comments', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
VALUES ('ingestion', 'PUBLISHED_STEMID_CONFLICT', 'Uploaded PublishedStemID conflicts with an existing stem identity');

SELECT 'Migration 60 complete: PublishedStemID columns, index, and conflict error seed ensured.' AS Status;
