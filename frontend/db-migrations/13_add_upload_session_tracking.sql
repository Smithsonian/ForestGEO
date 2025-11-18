-- =====================================================================================
-- Migration: Add Upload Session Tracking
-- =====================================================================================
-- Purpose: Enable per-upload verification by tracking FileID and BatchID
--
-- Changes:
-- 1. Add FileID and BatchID columns to failedmeasurements table
-- 2. coremeasurements already has UserDefinedFields JSON - will use that
--
-- This allows verification queries like:
--   SELECT COUNT(*) FROM coremeasurements WHERE JSON_EXTRACT(UserDefinedFields, '$.uploadSession.fileID') = ?
--   SELECT COUNT(*) FROM failedmeasurements WHERE FileID = ? AND BatchID = ?
-- =====================================================================================

USE forestgeo;

-- Add upload session tracking to failedmeasurements
ALTER TABLE failedmeasurements
ADD COLUMN FileID VARCHAR(255) NULL COMMENT 'Source file name from upload' AFTER FailedMeasurementID,
ADD COLUMN BatchID VARCHAR(36) NULL COMMENT 'Batch identifier for this upload chunk' AFTER FileID,
ADD INDEX idx_upload_session (FileID, BatchID) COMMENT 'Index for upload session queries';

-- Add index for common verification queries
ALTER TABLE failedmeasurements
ADD INDEX idx_plot_census_upload (PlotID, CensusID, FileID, BatchID)
COMMENT 'Composite index for verification queries by plot, census, and upload session';

-- Document the change
SELECT 'Upload session tracking columns added to failedmeasurements' as migration_status,
       'FileID and BatchID columns added with indexes' as details,
       'coremeasurements will use UserDefinedFields JSON' as note;

-- Verify the changes
DESCRIBE failedmeasurements;
