-- =====================================================================================
-- Migration Script 27: Add indexes for file+batch scoped ingestion/verification paths
-- =====================================================================================
-- Purpose:
--   - Support file+batch scoped predicates added to bulkingestionprocess
--   - Accelerate verification endpoints that filter by UploadFileID
--   - Accelerate temporarymeasurements batch discovery filtered by PlotID/CensusID
-- =====================================================================================

-- 1) temporarymeasurements lookup by plot/census/file/batch
SET @tbl = 'temporarymeasurements';
SET @idx = 'idx_tmpm_plot_census_file_batch';
SET @q = (
    SELECT IF(
        COUNT(*) > 0,
        'SELECT 1',
        CONCAT('ALTER TABLE ', @tbl, ' ADD INDEX `', @idx, '` (PlotID, CensusID, FileID, BatchID)')
    )
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = @tbl
      AND INDEX_NAME = @idx
    LIMIT 1
);
PREPARE stmt FROM @q;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) coremeasurements verification by file+census+stem status
SET @tbl = 'coremeasurements';
SET @idx = 'idx_cm_uploadfile_census_stem';
SET @q = (
    SELECT IF(
        COUNT(*) > 0,
        'SELECT 1',
        CONCAT('ALTER TABLE ', @tbl, ' ADD INDEX `', @idx, '` (UploadFileID, CensusID, StemGUID)')
    )
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = @tbl
      AND INDEX_NAME = @idx
    LIMIT 1
);
PREPARE stmt FROM @q;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) coremeasurements file+batch scoped procedure paths
SET @idx = 'idx_cm_uploadfile_batch_census_stem';
SET @q = (
    SELECT IF(
        COUNT(*) > 0,
        'SELECT 1',
        CONCAT('ALTER TABLE ', @tbl, ' ADD INDEX `', @idx, '` (UploadFileID, UploadBatchID, CensusID, StemGUID)')
    )
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = @tbl
      AND INDEX_NAME = @idx
    LIMIT 1
);
PREPARE stmt FROM @q;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 27 complete: upload-scope indexes ensured.' AS Status;
