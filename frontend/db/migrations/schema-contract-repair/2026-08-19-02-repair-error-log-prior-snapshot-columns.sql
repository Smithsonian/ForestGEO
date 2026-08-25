-- Follow-up repair for schemas where PriorCensusID existed before migration
-- 2026-08-17-01 but one or both numeric snapshot columns did not. Each column
-- is checked independently so any partial prior state converges safely.

SET @table_exists := (
    SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'measurement_error_log'
);

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'measurement_error_log' AND COLUMN_NAME = 'PriorCensusID'
);
SET @ddl := IF(@table_exists = 0 OR @col_exists > 0,
    'SELECT 1',
    'ALTER TABLE `measurement_error_log` ADD COLUMN `PriorCensusID` INT NULL AFTER `ResolvedAt`'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'measurement_error_log' AND COLUMN_NAME = 'PriorDBH'
);
SET @ddl := IF(@table_exists = 0 OR @col_exists > 0,
    'SELECT 1',
    'ALTER TABLE `measurement_error_log` ADD COLUMN `PriorDBH` DECIMAL(12, 6) NULL AFTER `PriorCensusID`'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'measurement_error_log' AND COLUMN_NAME = 'PriorHOM'
);
SET @ddl := IF(@table_exists = 0 OR @col_exists > 0,
    'SELECT 1',
    'ALTER TABLE `measurement_error_log` ADD COLUMN `PriorHOM` DECIMAL(12, 6) NULL AFTER `PriorDBH`'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 2026-08-19-02 complete: prior-census snapshot columns independently repaired.' AS Status;
