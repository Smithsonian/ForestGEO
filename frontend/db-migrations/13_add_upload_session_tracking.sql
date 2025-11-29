-- =====================================================================================
-- Migration: Add Upload Session Tracking
-- =====================================================================================
-- Purpose: Enable per-upload verification by tracking FileID and BatchID
--
-- Changes:
-- 1. Add FileID and BatchID columns to failedmeasurements table (if not exists)
-- 2. coremeasurements already has UserDefinedFields JSON - will use that
--
-- This allows verification queries like:
--   SELECT COUNT(*) FROM coremeasurements WHERE JSON_EXTRACT(UserDefinedFields, '$.uploadSession.fileID') = ?
--   SELECT COUNT(*) FROM failedmeasurements WHERE FileID = ? AND BatchID = ?
-- Note: Uses DATABASE() to work with any target schema - schema is selected by the caller
-- =====================================================================================

-- No USE statement - schema is selected by the caller

-- Add upload session tracking to failedmeasurements (idempotent)
-- Check and add FileID column if it doesn't exist
SET @dbname = DATABASE();

SELECT COUNT(*) INTO @fileIdExists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @dbname
  AND TABLE_NAME = 'failedmeasurements'
  AND COLUMN_NAME = 'FileID';

SET @addFileId = IF(@fileIdExists = 0,
    'ALTER TABLE failedmeasurements ADD COLUMN FileID VARCHAR(255) NULL COMMENT ''Source file name from upload'' AFTER FailedMeasurementID',
    'SELECT ''FileID column already exists'' as status');
PREPARE stmt FROM @addFileId;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and add BatchID column if it doesn't exist
SELECT COUNT(*) INTO @batchIdExists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @dbname
  AND TABLE_NAME = 'failedmeasurements'
  AND COLUMN_NAME = 'BatchID';

SET @addBatchId = IF(@batchIdExists = 0,
    'ALTER TABLE failedmeasurements ADD COLUMN BatchID VARCHAR(36) NULL COMMENT ''Batch identifier for this upload chunk'' AFTER FileID',
    'SELECT ''BatchID column already exists'' as status');
PREPARE stmt FROM @addBatchId;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and add idx_upload_session index if it doesn't exist
SELECT COUNT(*) INTO @idxUploadSessionExists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @dbname
  AND TABLE_NAME = 'failedmeasurements'
  AND INDEX_NAME = 'idx_upload_session';

SET @addIdxUploadSession = IF(@idxUploadSessionExists = 0,
    'ALTER TABLE failedmeasurements ADD INDEX idx_upload_session (FileID, BatchID) COMMENT ''Index for upload session queries''',
    'SELECT ''idx_upload_session index already exists'' as status');
PREPARE stmt FROM @addIdxUploadSession;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and add idx_plot_census_upload index if it doesn't exist
SELECT COUNT(*) INTO @idxPlotCensusUploadExists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @dbname
  AND TABLE_NAME = 'failedmeasurements'
  AND INDEX_NAME = 'idx_plot_census_upload';

SET @addIdxPlotCensusUpload = IF(@idxPlotCensusUploadExists = 0,
    'ALTER TABLE failedmeasurements ADD INDEX idx_plot_census_upload (PlotID, CensusID, FileID, BatchID) COMMENT ''Composite index for verification queries by plot, census, and upload session''',
    'SELECT ''idx_plot_census_upload index already exists'' as status');
PREPARE stmt FROM @addIdxPlotCensusUpload;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Document the change
SELECT 'Upload session tracking migration completed (idempotent)' as migration_status,
       'FileID and BatchID columns verified/added with indexes' as details,
       'coremeasurements will use UserDefinedFields JSON' as note;

-- Verify the changes
DESCRIBE failedmeasurements;
