-- =====================================================================================
-- Migration Script 17: Create upload_errors table
-- =====================================================================================

CREATE TABLE IF NOT EXISTS upload_errors
(
    UploadErrorID  INT AUTO_INCREMENT PRIMARY KEY,
    FileID         VARCHAR(255)                       NULL,
    BatchID        VARCHAR(36)                        NULL,
    PlotID         INT                                NULL,
    CensusID       INT                                NULL,
    RowNumber      INT                                NULL,
    ErrorType      VARCHAR(100)                       NULL,
    ErrorMessage   TEXT                               NULL,
    RawRow         JSON                               NULL,
    CreatedAt      DATETIME DEFAULT CURRENT_TIMESTAMP NULL
);

SET @schema = DATABASE();

SELECT COUNT(*) INTO @idx_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'upload_errors'
  AND INDEX_NAME = 'idx_upload_errors_file_batch';

SET @sql = IF(
    @idx_exists = 0,
    'CREATE INDEX idx_upload_errors_file_batch ON upload_errors (FileID, BatchID)',
    'SELECT ''idx_upload_errors_file_batch already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @idx_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'upload_errors'
  AND INDEX_NAME = 'idx_upload_errors_plot_census';

SET @sql = IF(
    @idx_exists = 0,
    'CREATE INDEX idx_upload_errors_plot_census ON upload_errors (PlotID, CensusID)',
    'SELECT ''idx_upload_errors_plot_census already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 17 complete: upload_errors table is available.' AS Status;
