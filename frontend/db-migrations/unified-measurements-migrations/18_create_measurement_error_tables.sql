-- =====================================================================================
-- Migration Script 18: Create unified measurement error tables
-- =====================================================================================
-- Purpose:
--   - Create measurement_errors catalog table
--   - Create measurement_error_log junction table
--   - Seed ingestion and validation error definitions
-- =====================================================================================

SET @schema = DATABASE();

CREATE TABLE IF NOT EXISTS measurement_errors
(
    ErrorID      INT AUTO_INCREMENT PRIMARY KEY,
    ErrorSource  ENUM ('ingestion', 'validation') NOT NULL,
    ErrorCode    VARCHAR(50)                      NULL,
    ErrorMessage TEXT                             NOT NULL,
    UNIQUE KEY uq_measurement_error_source_code (ErrorSource, ErrorCode)
);

CREATE TABLE IF NOT EXISTS measurement_error_log
(
    MeasurementID INT                                NOT NULL,
    ErrorID       INT                                NOT NULL,
    CreatedAt     DATETIME DEFAULT CURRENT_TIMESTAMP NULL,
    IsResolved    BOOLEAN  DEFAULT FALSE             NOT NULL,
    ResolvedAt    DATETIME                           NULL,
    PRIMARY KEY (MeasurementID, ErrorID),
    CONSTRAINT measurement_error_log_coremeasurements_fk
        FOREIGN KEY (MeasurementID) REFERENCES coremeasurements (CoreMeasurementID)
            ON DELETE CASCADE,
    CONSTRAINT measurement_error_log_errors_fk
        FOREIGN KEY (ErrorID) REFERENCES measurement_errors (ErrorID)
            ON DELETE CASCADE
);

SELECT COUNT(*) INTO @idx_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'measurement_error_log'
  AND INDEX_NAME = 'idx_measurement_error_log_errorid';

SET @sql = IF(
    @idx_exists = 0,
    'CREATE INDEX idx_measurement_error_log_errorid ON measurement_error_log (ErrorID)',
    'SELECT ''idx_measurement_error_log_errorid already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @idx_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'measurement_error_log'
  AND INDEX_NAME = 'idx_measurement_error_log_resolved';

SET @sql = IF(
    @idx_exists = 0,
    'CREATE INDEX idx_measurement_error_log_resolved ON measurement_error_log (IsResolved, CreatedAt)',
    'SELECT ''idx_measurement_error_log_resolved already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
VALUES ('ingestion', 'MISSING_FIELD_TREETAG', 'Missing required field: TreeTag'),
       ('ingestion', 'MISSING_FIELD_STEMTAG', 'Missing required field: StemTag'),
       ('ingestion', 'INVALID_QUADRAT', 'Invalid quadrat reference'),
       ('ingestion', 'INVALID_SPECIES', 'Invalid species reference'),
       ('ingestion', 'QUADRAT_MISMATCH', 'Quadrat mismatch across censuses'),
       ('ingestion', 'COORDINATE_DRIFT', 'Coordinate drift exceeds allowed threshold'),
       ('ingestion', 'DUPLICATE_ENTRY', 'Duplicate measurement row detected'),
       ('ingestion', 'NEGATIVE_DBH', 'DBH must be non-negative'),
       ('ingestion', 'NEGATIVE_HOM', 'HOM must be non-negative'),
       ('ingestion', 'FIELD_TOO_LONG', 'One or more fields exceed column length limits'),
       ('ingestion', 'MISSING_MEASUREMENT_DATA', 'Missing measurement data'),
       ('ingestion', 'SQL_EXCEPTION', 'Ingestion SQL exception')
ON DUPLICATE KEY UPDATE ErrorMessage = VALUES(ErrorMessage);

SELECT COUNT(*) INTO @has_validations
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'sitespecificvalidations';

SET @seed_validation_sql = IF(
    @has_validations = 1,
    'INSERT INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
     SELECT ''validation'',
            CAST(ValidationID AS CHAR),
            CONCAT(''Validation '', ValidationID, '': '', COALESCE(NULLIF(TRIM(Description), ''''), ProcedureName, ''Validation check failed''))
     FROM sitespecificvalidations
     ON DUPLICATE KEY UPDATE ErrorMessage = VALUES(ErrorMessage)',
    'SELECT ''sitespecificvalidations not found; skipped validation error seed'' AS Status'
);
PREPARE stmt FROM @seed_validation_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 18 complete: measurement_errors + measurement_error_log are available.' AS Status;
