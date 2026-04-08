-- =====================================================================================
-- Branch Refresh Helper: Ensure upload tracking tables required by current branch
-- =====================================================================================
-- Purpose:
--   - Ensure upload_sessions, uploadintegrityalerts, and uploadmetrics exist
--   - Ensure the indexes and uniqueness guarantees expected by the current branch
--   - Stay idempotent so it is safe to run before every stored procedure redeploy
-- =====================================================================================

SET @schema = DATABASE();

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
    idempotency_key   VARCHAR(255) NULL,
    active_scope_key  VARCHAR(255)
        GENERATED ALWAYS AS (
            CASE
                WHEN state IN ('initialized', 'uploading', 'uploaded', 'processing', 'collapsing')
                    THEN CONCAT_WS('#', schema_name, plot_id, census_id)
                ELSE NULL
            END
        ) STORED
);

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

CREATE TABLE IF NOT EXISTS uploadmetrics
(
    id                         INT AUTO_INCREMENT PRIMARY KEY,
    uploadId                   VARCHAR(50)                                          NOT NULL,
    fileID                     VARCHAR(50)                                          NOT NULL,
    batchID                    VARCHAR(50)                                          NOT NULL,
    schema_name                VARCHAR(100)                                         NOT NULL,
    plotID                     INT                                                  NOT NULL,
    censusID                   INT                                                  NOT NULL,
    sourceRecords              INT                                                  NOT NULL DEFAULT 0,
    processedRecords           INT                                                  NOT NULL DEFAULT 0,
    failedRecords              INT                                                  NOT NULL DEFAULT 0,
    missingRecords             INT                                                  NOT NULL DEFAULT 0,
    dataLossDetected           TINYINT(1)                                           DEFAULT 0 NULL,
    referentialIntegrityPassed TINYINT(1)                                           NULL,
    duplicatesDetected         TINYINT(1)                                           DEFAULT 0 NULL,
    durationMs                 INT                                                  NULL,
    attemptsNeeded             INT                                                  DEFAULT 1 NULL,
    status                     ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending' NULL,
    errorMessage               TEXT                                                 NULL,
    startTime                  DATETIME                                             NOT NULL,
    endTime                    DATETIME                                             NULL,
    createdAt                  DATETIME                                             DEFAULT CURRENT_TIMESTAMP NULL
);

DROP PROCEDURE IF EXISTS add_index_if_not_exists;

DELIMITER //
CREATE PROCEDURE add_index_if_not_exists(
    IN p_table VARCHAR(64),
    IN p_index VARCHAR(64),
    IN p_columns VARCHAR(255)
)
BEGIN
    DECLARE index_exists INT DEFAULT 0;

    SELECT COUNT(*)
    INTO index_exists
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND INDEX_NAME = p_index;

    IF index_exists = 0 THEN
        SET @sql = CONCAT('CREATE INDEX `', p_index, '` ON `', p_table, '` (', p_columns, ')');
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END //
DELIMITER ;

CALL add_index_if_not_exists('upload_sessions', 'idx_state', 'state');
CALL add_index_if_not_exists('upload_sessions', 'idx_heartbeat', 'last_heartbeat');
CALL add_index_if_not_exists('upload_sessions', 'idx_plot_census', 'plot_id, census_id');
CALL add_index_if_not_exists('upload_sessions', 'idx_idempotency', 'idempotency_key');

CALL add_index_if_not_exists('uploadintegrityalerts', 'idx_alerts_uploadid', 'uploadId');
CALL add_index_if_not_exists('uploadintegrityalerts', 'idx_alerts_severity', 'severity');
CALL add_index_if_not_exists('uploadintegrityalerts', 'idx_alerts_type', 'type');
CALL add_index_if_not_exists('uploadintegrityalerts', 'idx_alerts_fileid', 'fileID');
CALL add_index_if_not_exists('uploadintegrityalerts', 'idx_alerts_batchid', 'batchID');
CALL add_index_if_not_exists('uploadintegrityalerts', 'idx_alerts_resolved', 'resolved');
CALL add_index_if_not_exists('uploadintegrityalerts', 'idx_alerts_created', 'createdAt');

SELECT COUNT(*)
INTO @uploadmetrics_uploadid_unique_exists
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'uploadmetrics'
  AND NON_UNIQUE = 0
  AND COLUMN_NAME = 'uploadId';

SET @sql = IF(
    @uploadmetrics_uploadid_unique_exists = 0,
    'ALTER TABLE uploadmetrics ADD CONSTRAINT uq_uploadmetrics_uploadid UNIQUE (uploadId)',
    'SELECT ''uploadmetrics uploadId uniqueness already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CALL add_index_if_not_exists('uploadmetrics', 'idx_uploadmetrics_fileid', 'fileID');
CALL add_index_if_not_exists('uploadmetrics', 'idx_uploadmetrics_batchid', 'batchID');
CALL add_index_if_not_exists('uploadmetrics', 'idx_uploadmetrics_plotid', 'plotID');
CALL add_index_if_not_exists('uploadmetrics', 'idx_uploadmetrics_censusid', 'censusID');
CALL add_index_if_not_exists('uploadmetrics', 'idx_uploadmetrics_status', 'status');
CALL add_index_if_not_exists('uploadmetrics', 'idx_uploadmetrics_dataloss', 'dataLossDetected');
CALL add_index_if_not_exists('uploadmetrics', 'idx_uploadmetrics_starttime', 'startTime');
CALL add_index_if_not_exists('uploadmetrics', 'idx_uploadmetrics_batch_census_status', 'batchID, censusID, status');

DROP PROCEDURE IF EXISTS add_index_if_not_exists;

SELECT 'Branch refresh helper complete: upload tracking tables ensured.' AS Status;
