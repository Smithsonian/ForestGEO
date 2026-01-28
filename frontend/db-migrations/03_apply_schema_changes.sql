-- =====================================================================================
-- Consolidated Schema Modifications Script
-- =====================================================================================
-- Purpose: Apply all post-migration schema changes in one idempotent script
-- Consolidates: 11, 12, 13, 14 (FK removal, column sizes, tracking, indexes)
--
-- All operations are idempotent - safe to run multiple times
-- Uses helper procedures from 00_migration_framework.sql
-- =====================================================================================

CALL migration_step_start('11_apply_schema_changes');

SET @schema = DATABASE();

-- =====================================================================================
-- SECTION 1: Remove FK Constraint from CMAttributes.Code
-- =====================================================================================
-- This allows invalid attribute codes to be stored and corrected via UI

SELECT '=== Removing CMAttributes FK Constraint ===' AS Section;

SET @constraint_name = 'CMAttributes_Attributes_Code_fk';

SELECT COUNT(*) INTO @constraint_exists
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = @schema
  AND TABLE_NAME = 'cmattributes'
  AND CONSTRAINT_NAME = @constraint_name
  AND CONSTRAINT_TYPE = 'FOREIGN KEY';

SET @drop_fk = IF(@constraint_exists > 0,
    CONCAT('ALTER TABLE cmattributes DROP FOREIGN KEY ', @constraint_name),
    'SELECT "FK constraint does not exist or already removed" AS status');

PREPARE stmt FROM @drop_fk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT CASE WHEN @constraint_exists > 0
    THEN 'Removed CMAttributes_Attributes_Code_fk constraint'
    ELSE 'Constraint was already removed'
END AS FK_Constraint_Status;

-- =====================================================================================
-- SECTION 2: Ensure Upload Session Tables Exist
-- =====================================================================================

SELECT '=== Creating Upload Session Tables ===' AS Section;

-- upload_sessions table
CREATE TABLE IF NOT EXISTS upload_sessions (
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

-- uploadintegrityalerts table
CREATE TABLE IF NOT EXISTS uploadintegrityalerts (
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

-- uploadmetrics table
CREATE TABLE IF NOT EXISTS uploadmetrics (
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

SELECT 'Upload session tables created/verified' AS Status;

-- =====================================================================================
-- SECTION 3: Add FileID and BatchID to failedmeasurements
-- =====================================================================================

SELECT '=== Adding Upload Tracking Columns ===' AS Section;

-- Use helper procedure if available, otherwise inline check
CALL add_column_if_not_exists('failedmeasurements', 'FileID', 'VARCHAR(255) NULL COMMENT "Source file name from upload" AFTER FailedMeasurementID');
CALL add_column_if_not_exists('failedmeasurements', 'BatchID', 'VARCHAR(36) NULL COMMENT "Batch identifier for this upload chunk" AFTER FileID');

SELECT 'FileID and BatchID columns verified on failedmeasurements' AS Status;

-- =====================================================================================
-- SECTION 4: Increase Column Sizes for Test Data
-- =====================================================================================

SELECT '=== Adjusting Column Sizes ===' AS Section;

-- Increase FileID in temporarymeasurements from VARCHAR(36) to VARCHAR(50)
SELECT CHARACTER_MAXIMUM_LENGTH INTO @tm_fileid_len
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'temporarymeasurements'
  AND COLUMN_NAME = 'FileID';

SET @modify_tm_fileid = IF(@tm_fileid_len IS NOT NULL AND @tm_fileid_len < 50,
    'ALTER TABLE temporarymeasurements MODIFY COLUMN FileID VARCHAR(50)',
    'SELECT "temporarymeasurements.FileID already adequate" AS status');
PREPARE stmt FROM @modify_tm_fileid;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Increase BatchID in temporarymeasurements
SELECT CHARACTER_MAXIMUM_LENGTH INTO @tm_batchid_len
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'temporarymeasurements'
  AND COLUMN_NAME = 'BatchID';

SET @modify_tm_batchid = IF(@tm_batchid_len IS NOT NULL AND @tm_batchid_len < 50,
    'ALTER TABLE temporarymeasurements MODIFY COLUMN BatchID VARCHAR(50)',
    'SELECT "temporarymeasurements.BatchID already adequate" AS status');
PREPARE stmt FROM @modify_tm_batchid;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Column sizes adjusted' AS Status;

-- =====================================================================================
-- SECTION 5: Add Performance Indexes (Idempotent)
-- =====================================================================================

SELECT '=== Adding Performance Indexes ===' AS Section;

-- upload_sessions indexes
CALL add_index_if_not_exists('upload_sessions', 'idx_state', 'state');
CALL add_index_if_not_exists('upload_sessions', 'idx_heartbeat', 'last_heartbeat');
CALL add_index_if_not_exists('upload_sessions', 'idx_plot_census', 'plot_id, census_id');

-- uploadintegrityalerts indexes
CALL add_index_if_not_exists('uploadintegrityalerts', 'idx_alerts_uploadid', 'uploadId');
CALL add_index_if_not_exists('uploadintegrityalerts', 'idx_alerts_severity', 'severity');
CALL add_index_if_not_exists('uploadintegrityalerts', 'idx_alerts_type', 'type');

-- uploadmetrics indexes
CALL add_index_if_not_exists('uploadmetrics', 'idx_uploadmetrics_fileid', 'fileID');
CALL add_index_if_not_exists('uploadmetrics', 'idx_uploadmetrics_status', 'status');

-- failedmeasurements indexes
CALL add_index_if_not_exists('failedmeasurements', 'idx_upload_session', 'FileID, BatchID');
CALL add_index_if_not_exists('failedmeasurements', 'idx_plot_census_upload', 'PlotID, CensusID, FileID, BatchID');

-- coremeasurements indexes (additional performance indexes)
CALL add_index_if_not_exists('coremeasurements', 'idx_coremeasurements_census_plot', 'CensusID');
CALL add_index_if_not_exists('coremeasurements', 'idx_coremeasurements_census_validation', 'CensusID, IsValidated');

-- stems indexes
CALL add_index_if_not_exists('stems', 'idx_stems_censusid', 'CensusID');
CALL add_index_if_not_exists('stems', 'idx_stems_treeid_censusid', 'TreeID, CensusID');

-- trees indexes
CALL add_index_if_not_exists('trees', 'idx_trees_censusid', 'CensusID');

-- cmverrors indexes
CALL add_index_if_not_exists('cmverrors', 'idx_cmverrors_coreMeasurementID', 'CoreMeasurementID');

SELECT 'Performance indexes added/verified' AS Status;

-- =====================================================================================
-- SECTION 6: Verification
-- =====================================================================================

SELECT '=== Schema Changes Verification ===' AS Section;

-- Show key indexes
SELECT
    TABLE_NAME,
    INDEX_NAME,
    GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS COLUMNS
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('coremeasurements', 'stems', 'trees', 'cmverrors',
                     'upload_sessions', 'uploadintegrityalerts', 'uploadmetrics', 'failedmeasurements')
  AND INDEX_NAME != 'PRIMARY'
GROUP BY TABLE_NAME, INDEX_NAME
ORDER BY TABLE_NAME, INDEX_NAME;

-- Show column structure for key tables
SELECT
    'failedmeasurements columns' AS Info,
    COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'failedmeasurements'
ORDER BY ORDINAL_POSITION;

CALL migration_step_complete('11_apply_schema_changes', 0);

SELECT '=== SCHEMA CHANGES COMPLETE ===' AS Section;
