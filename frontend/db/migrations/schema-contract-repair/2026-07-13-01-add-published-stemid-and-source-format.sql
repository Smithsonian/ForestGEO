-- =====================================================================================
-- Migration 2026-07-13-01: repair the temporarymeasurements write contract
-- =====================================================================================
-- This migration is deliberately additive. Charset/collation normalization is
-- reported by the contract audit but is not performed automatically during an
-- application deploy because table-wide CONVERT operations can rebuild and lock
-- large ingestion tables and can widen TEXT-family column types.

-- temporarymeasurements.SourceFormat
SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'temporarymeasurements'
      AND COLUMN_NAME = 'SourceFormat'
);
SET @ddl := IF(@col_exists > 0,
    'SELECT ''temporarymeasurements.SourceFormat already present'' AS Status',
    'ALTER TABLE `temporarymeasurements` ADD COLUMN `SourceFormat` varchar(32) NOT NULL DEFAULT ''csv'''
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- temporarymeasurements.PublishedStemID
SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'temporarymeasurements'
      AND COLUMN_NAME = 'PublishedStemID'
);
SET @ddl := IF(@col_exists > 0,
    'SELECT ''temporarymeasurements.PublishedStemID already present'' AS Status',
    'ALTER TABLE `temporarymeasurements` ADD COLUMN `PublishedStemID` int unsigned NULL'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 2026-07-13-01 complete: temporarymeasurements write columns ensured.' AS Status;
