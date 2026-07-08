-- Migration 36: Add composite indexes for measurement_error_log and measurement_errors
-- to speed up validation error display and failed measurements queries.

-- 1) measurement_error_log lookup by MeasurementID with ErrorID and IsResolved
SET @tbl = 'measurement_error_log';
SET @idx = 'idx_mel_measurement_error_resolved';
SET @q = (
    SELECT IF(
        COUNT(*) > 0,
        'SELECT 1',
        CONCAT('ALTER TABLE ', @tbl, ' ADD INDEX `', @idx, '` (MeasurementID, ErrorID, IsResolved)')
    )
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = @tbl
      AND INDEX_NAME = @idx
    LIMIT 1
);
PREPARE stmt FROM @q;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) measurement_errors lookup by ErrorID and ErrorSource
SET @tbl = 'measurement_errors';
SET @idx = 'idx_me_error_source';
SET @q = (
    SELECT IF(
        COUNT(*) > 0,
        'SELECT 1',
        CONCAT('ALTER TABLE ', @tbl, ' ADD INDEX `', @idx, '` (ErrorID, ErrorSource)')
    )
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = @tbl
      AND INDEX_NAME = @idx
    LIMIT 1
);
PREPARE stmt FROM @q;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 36 complete: error log indexes ensured.' AS Status;
