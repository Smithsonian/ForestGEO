-- =====================================================================================
-- Migration Script 00b: Ensure Table Structures
-- =====================================================================================
-- Purpose: Ensure all required tables exist in the target schema before migration
-- Creates any missing tables that may not exist in older schema versions
--
-- Note: Uses DATABASE() to work with any target schema - schema is selected by the caller
-- =====================================================================================

SET @schema = DATABASE();

-- =====================================================================================
-- Create upload_sessions table if it doesn't exist
-- =====================================================================================
CREATE TABLE IF NOT EXISTS upload_sessions
(
    session_id        VARCHAR(64)  NOT NULL PRIMARY KEY,
    schema_name       VARCHAR(64)  NOT NULL,
    plot_id           INT          NOT NULL,
    census_id         INT          NOT NULL,
    user_id           VARCHAR(255) NOT NULL,
    state             ENUM('initialized', 'uploading', 'uploaded', 'processing', 'collapsing', 'completed', 'failed', 'abandoned', 'cleaned_up') DEFAULT 'initialized' NOT NULL,
    file_id           VARCHAR(255) NULL,
    total_chunks      INT          DEFAULT 0 NULL,
    uploaded_chunks   INT          DEFAULT 0 NULL,
    processed_batches INT          DEFAULT 0 NULL,
    total_batches     INT          DEFAULT 0 NULL,
    last_heartbeat    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP NULL,
    created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP NULL,
    updated_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
    error_message     TEXT         NULL,
    idempotency_key   VARCHAR(255) NULL
);

-- Add indexes if they don't exist (idempotent)
SELECT COUNT(*) INTO @idx_state_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'upload_sessions' AND INDEX_NAME = 'idx_state';

SET @create_idx_state = IF(@idx_state_exists = 0,
    'CREATE INDEX idx_state ON upload_sessions (state)',
    'SELECT "idx_state already exists" as status');
PREPARE stmt FROM @create_idx_state;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @idx_heartbeat_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'upload_sessions' AND INDEX_NAME = 'idx_heartbeat';

SET @create_idx_heartbeat = IF(@idx_heartbeat_exists = 0,
    'CREATE INDEX idx_heartbeat ON upload_sessions (last_heartbeat)',
    'SELECT "idx_heartbeat already exists" as status');
PREPARE stmt FROM @create_idx_heartbeat;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @idx_plot_census_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'upload_sessions' AND INDEX_NAME = 'idx_plot_census';

SET @create_idx_plot_census = IF(@idx_plot_census_exists = 0,
    'CREATE INDEX idx_plot_census ON upload_sessions (plot_id, census_id)',
    'SELECT "idx_plot_census already exists" as status');
PREPARE stmt FROM @create_idx_plot_census;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =====================================================================================
-- Create uploadintegrityalerts table if it doesn't exist
-- =====================================================================================
CREATE TABLE IF NOT EXISTS uploadintegrityalerts
(
    id               INT AUTO_INCREMENT PRIMARY KEY,
    uploadId         VARCHAR(50)                              NOT NULL,
    severity         ENUM('info', 'warning', 'critical')      NOT NULL DEFAULT 'warning',
    type             VARCHAR(50)                              NOT NULL,
    message          TEXT                                     NOT NULL,
    fileID           VARCHAR(50)                              NOT NULL,
    batchID          VARCHAR(50)                              NOT NULL,
    plotID           INT                                      NOT NULL,
    censusID         INT                                      NOT NULL,
    sourceRecords    INT                                      NOT NULL,
    processedRecords INT                                      NOT NULL,
    failedRecords    INT                                      NOT NULL,
    missingRecords   INT                                      NOT NULL,
    details          JSON                                     NULL,
    resolved         TINYINT(1)                               DEFAULT 0 NULL,
    resolvedAt       DATETIME                                 NULL,
    resolvedBy       VARCHAR(100)                             NULL,
    resolution       TEXT                                     NULL,
    createdAt        DATETIME                                 DEFAULT CURRENT_TIMESTAMP NULL
);

-- Add indexes for uploadintegrityalerts
SELECT COUNT(*) INTO @idx_alerts_uploadid_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'uploadintegrityalerts' AND INDEX_NAME = 'idx_alerts_uploadid';

SET @create_idx = IF(@idx_alerts_uploadid_exists = 0,
    'CREATE INDEX idx_alerts_uploadid ON uploadintegrityalerts (uploadId)',
    'SELECT "idx_alerts_uploadid already exists" as status');
PREPARE stmt FROM @create_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @idx_alerts_severity_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'uploadintegrityalerts' AND INDEX_NAME = 'idx_alerts_severity';

SET @create_idx = IF(@idx_alerts_severity_exists = 0,
    'CREATE INDEX idx_alerts_severity ON uploadintegrityalerts (severity)',
    'SELECT "idx_alerts_severity already exists" as status');
PREPARE stmt FROM @create_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @idx_alerts_type_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'uploadintegrityalerts' AND INDEX_NAME = 'idx_alerts_type';

SET @create_idx = IF(@idx_alerts_type_exists = 0,
    'CREATE INDEX idx_alerts_type ON uploadintegrityalerts (type)',
    'SELECT "idx_alerts_type already exists" as status');
PREPARE stmt FROM @create_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =====================================================================================
-- Create uploadmetrics table if it doesn't exist
-- =====================================================================================
CREATE TABLE IF NOT EXISTS uploadmetrics
(
    id                         INT AUTO_INCREMENT PRIMARY KEY,
    uploadId                   VARCHAR(50)                                           NOT NULL,
    fileID                     VARCHAR(50)                                           NOT NULL,
    batchID                    VARCHAR(50)                                           NOT NULL,
    schema_name                VARCHAR(100)                                          NOT NULL,
    plotID                     INT                                                   NOT NULL,
    censusID                   INT                                                   NOT NULL,
    sourceRecords              INT                                                   NOT NULL DEFAULT 0,
    processedRecords           INT                                                   NOT NULL DEFAULT 0,
    failedRecords              INT                                                   NOT NULL DEFAULT 0,
    missingRecords             INT                                                   NOT NULL DEFAULT 0,
    dataLossDetected           TINYINT(1)                                            DEFAULT 0 NULL,
    referentialIntegrityPassed TINYINT(1)                                            NULL,
    duplicatesDetected         TINYINT(1)                                            DEFAULT 0 NULL,
    durationMs                 INT                                                   NULL,
    attemptsNeeded             INT                                                   DEFAULT 1 NULL,
    status                     ENUM('pending', 'processing', 'completed', 'failed')  DEFAULT 'pending' NULL,
    errorMessage               TEXT                                                  NULL,
    startTime                  DATETIME                                              NOT NULL,
    endTime                    DATETIME                                              NULL,
    createdAt                  DATETIME                                              DEFAULT CURRENT_TIMESTAMP NULL,
    CONSTRAINT uploadId UNIQUE (uploadId)
);

-- Add indexes for uploadmetrics
SELECT COUNT(*) INTO @idx_uploadmetrics_fileid_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'uploadmetrics' AND INDEX_NAME = 'idx_uploadmetrics_fileid';

SET @create_idx = IF(@idx_uploadmetrics_fileid_exists = 0,
    'CREATE INDEX idx_uploadmetrics_fileid ON uploadmetrics (fileID)',
    'SELECT "idx_uploadmetrics_fileid already exists" as status');
PREPARE stmt FROM @create_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @idx_uploadmetrics_status_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'uploadmetrics' AND INDEX_NAME = 'idx_uploadmetrics_status';

SET @create_idx = IF(@idx_uploadmetrics_status_exists = 0,
    'CREATE INDEX idx_uploadmetrics_status ON uploadmetrics (status)',
    'SELECT "idx_uploadmetrics_status already exists" as status');
PREPARE stmt FROM @create_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =====================================================================================
-- Ensure failedmeasurements has FileID and BatchID columns
-- =====================================================================================
SELECT COUNT(*) INTO @fileIdExists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'failedmeasurements'
  AND COLUMN_NAME = 'FileID';

SET @addFileId = IF(@fileIdExists = 0,
    'ALTER TABLE failedmeasurements ADD COLUMN FileID VARCHAR(255) NULL COMMENT ''Source file name from upload'' AFTER FailedMeasurementID',
    'SELECT "FileID column already exists" as status');
PREPARE stmt FROM @addFileId;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @batchIdExists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'failedmeasurements'
  AND COLUMN_NAME = 'BatchID';

SET @addBatchId = IF(@batchIdExists = 0,
    'ALTER TABLE failedmeasurements ADD COLUMN BatchID VARCHAR(36) NULL COMMENT ''Batch identifier for this upload chunk'' AFTER FileID',
    'SELECT "BatchID column already exists" as status');
PREPARE stmt FROM @addBatchId;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =====================================================================================
-- Verification
-- =====================================================================================
SELECT 'Table structures verified/created' AS Status,
       DATABASE() AS SchemaName,
       NOW() AS CheckTime;

-- Show all tables in schema
SELECT TABLE_NAME, TABLE_ROWS
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = @schema
  AND TABLE_TYPE = 'BASE TABLE'
ORDER BY TABLE_NAME;
