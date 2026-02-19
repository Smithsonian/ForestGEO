-- Migration 17: Add upload_errors table and split-ingestion procedure entrypoints
-- Date: 2026-02-18
-- Purpose:
--   1) Introduce upload_errors for un-insertable/batch-failure tracking.
--   2) Add ingest_measurements + validate_measurements procedure entrypoints.

CREATE TABLE IF NOT EXISTS upload_errors
(
    id           INT AUTO_INCREMENT PRIMARY KEY,
    FileID       VARCHAR(36) NULL,
    BatchID      VARCHAR(36) NULL,
    PlotID       INT NULL,
    CensusID     INT NULL,
    RowIndex     INT NULL,
    RawData      JSON NULL,
    ErrorType    VARCHAR(50) NOT NULL,
    ErrorMessage TEXT NOT NULL,
    CreatedAt    DATETIME DEFAULT CURRENT_TIMESTAMP NULL,
    INDEX idx_upload_errors_file_batch (FileID, BatchID),
    INDEX idx_upload_errors_plot_census (PlotID, CensusID),
    INDEX idx_upload_errors_created (CreatedAt),
    INDEX idx_upload_errors_type (ErrorType)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

DROP PROCEDURE IF EXISTS ingest_measurements;
DROP PROCEDURE IF EXISTS validate_measurements;

DELIMITER $$

CREATE
    DEFINER = azureroot@`%` PROCEDURE ingest_measurements(IN vFileID VARCHAR(36), IN vBatchID VARCHAR(36))
BEGIN
    -- Compatibility entrypoint: delegates to existing ingestion implementation.
    CALL bulkingestionprocess(vFileID, vBatchID);
END $$

CREATE
    DEFINER = azureroot@`%` PROCEDURE validate_measurements(IN vPlotID INT, IN vCensusID INT)
BEGIN
    -- Stamps IsValidated based on existing cmverrors rows.
    -- Visibility contract:
    --   TRUE  -> clean (no validation errors)
    --   FALSE -> flagged (has validation errors)
    --   NULL  -> not yet validated
    UPDATE coremeasurements cm
        JOIN census c ON cm.CensusID = c.CensusID
        LEFT JOIN (
            SELECT DISTINCT CoreMeasurementID FROM cmverrors
        ) errs ON errs.CoreMeasurementID = cm.CoreMeasurementID
    SET cm.IsValidated = IF(errs.CoreMeasurementID IS NULL, 1, 0)
    WHERE cm.CensusID = vCensusID
      AND c.PlotID = vPlotID
      AND cm.IsActive = 1;
END $$

DELIMITER ;
