-- Migration 24: Change measurement_error_log FK on ErrorID from CASCADE to RESTRICT
--
-- measurement_errors is a configuration/seed table. Accidentally deleting an error
-- definition should NOT cascade-delete all associated error logs. RESTRICT prevents
-- deletion of error definitions that are still referenced.

SET @schema = DATABASE();

SELECT COUNT(*) INTO @fk_exists
FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'measurement_error_log'
  AND CONSTRAINT_NAME = 'measurement_error_log_errors_fk'
  AND CONSTRAINT_TYPE = 'FOREIGN KEY';

SET @sql = IF(
    @fk_exists = 1,
    'ALTER TABLE measurement_error_log DROP FOREIGN KEY measurement_error_log_errors_fk',
    'SELECT ''measurement_error_log_errors_fk not found, skipping drop'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Re-add with RESTRICT (idempotent: if FK was just dropped above, or was already
-- missing, this ADD will succeed either way)
SELECT COUNT(*) INTO @fk_exists
FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'measurement_error_log'
  AND CONSTRAINT_NAME = 'measurement_error_log_errors_fk'
  AND CONSTRAINT_TYPE = 'FOREIGN KEY';

SET @sql = IF(
    @fk_exists = 0,
    'ALTER TABLE measurement_error_log ADD CONSTRAINT measurement_error_log_errors_fk FOREIGN KEY (ErrorID) REFERENCES measurement_errors (ErrorID) ON DELETE RESTRICT',
    'SELECT ''measurement_error_log_errors_fk already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 24 complete: measurement_error_log FK set to RESTRICT.' AS Status;
