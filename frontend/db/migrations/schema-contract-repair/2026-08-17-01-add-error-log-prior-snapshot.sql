-- =====================================================================================
-- Migration 2026-08-17-01: measurement_error_log prior-census comparison snapshot
-- =====================================================================================
-- ValidationIDs 1/2 (DBH growth/shrinkage) compare a current measurement against the
-- prior census but historically discarded the compared values. These columns record
-- exactly what the check compared, written by RunSharedDBHChangeValidations at flag
-- time. Nullable; every other error type leaves them NULL. PriorCensusID is
-- deliberately NOT a foreign key: the snapshot must not create a lifecycle
-- dependency on a historical census row.

SET @table_exists := (
    SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'measurement_error_log'
);

SET @col := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'measurement_error_log' AND COLUMN_NAME = 'PriorCensusID'
);
SET @ddl := IF(@table_exists = 0,
    'SELECT ''measurement_error_log does not exist in this schema; nothing to add'' AS Status',
    IF(@col > 0,
        'SELECT ''measurement_error_log.PriorCensusID already present'' AS Status',
        'ALTER TABLE `measurement_error_log`
            ADD COLUMN `PriorCensusID` INT NULL AFTER `ResolvedAt`,
            ADD COLUMN `PriorDBH` DECIMAL(12, 6) NULL AFTER `PriorCensusID`,
            ADD COLUMN `PriorHOM` DECIMAL(12, 6) NULL AFTER `PriorDBH`'
    )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 2026-08-17-01 complete: prior-census snapshot columns ensured.' AS Status;
