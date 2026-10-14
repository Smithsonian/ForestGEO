-- Separate user notices and one-time recovery evidence from validation errors.
-- Retain these columns and historical records when the re-score CLI retires.
-- Existing records are left intact; reconciliation still recognizes legacy evidence.

SET @column_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'validation_runs' AND COLUMN_NAME = 'Notices'
);
SET @ddl := IF(@column_exists > 0,
    'SELECT 1',
    'ALTER TABLE `validation_runs` ADD COLUMN `Notices` JSON NULL'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'validation_runs' AND COLUMN_NAME = 'RescoreAttemptID'
);
SET @ddl := IF(@column_exists > 0,
    'SELECT 1',
    'ALTER TABLE `validation_runs` ADD COLUMN `RescoreAttemptID` VARCHAR(64) NULL'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
