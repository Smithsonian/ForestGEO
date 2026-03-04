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

CREATE INDEX idx_upload_errors_file_batch
    ON upload_errors (FileID, BatchID);

CREATE INDEX idx_upload_errors_plot_census
    ON upload_errors (PlotID, CensusID);

SELECT 'Migration 17 complete: upload_errors table is available.' AS Status;
