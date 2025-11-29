-- =====================================================================================
-- Migration: Increase FileID and BatchID column sizes (idempotent)
-- =====================================================================================
-- Date: 2025-10-14
-- Description: Increase FileID and BatchID columns from VARCHAR(36) to VARCHAR(50)
-- to accommodate test data that uses longer IDs:
--   - 'test_file_<uuid>' (10 + 36 = 46 characters)
--   - 'test_batch_<uuid>' (11 + 36 = 47 characters)
-- =====================================================================================

SET @schema = DATABASE();

-- Check and modify FileID column size in temporarymeasurements table
SELECT CHARACTER_MAXIMUM_LENGTH INTO @fileIdLength
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'temporarymeasurements'
  AND COLUMN_NAME = 'FileID';

SET @modifyFileId = IF(@fileIdLength IS NOT NULL AND @fileIdLength < 50,
    'ALTER TABLE temporarymeasurements MODIFY COLUMN FileID VARCHAR(50)',
    'SELECT "FileID already VARCHAR(50) or larger" as status');
PREPARE stmt FROM @modifyFileId;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check and modify BatchID column size in temporarymeasurements table
SELECT CHARACTER_MAXIMUM_LENGTH INTO @batchIdLength
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'temporarymeasurements'
  AND COLUMN_NAME = 'BatchID';

SET @modifyBatchId = IF(@batchIdLength IS NOT NULL AND @batchIdLength < 50,
    'ALTER TABLE temporarymeasurements MODIFY COLUMN BatchID VARCHAR(50)',
    'SELECT "BatchID already VARCHAR(50) or larger" as status');
PREPARE stmt FROM @modifyBatchId;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verify the changes
SELECT
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'temporarymeasurements'
  AND COLUMN_NAME IN ('FileID', 'BatchID')
ORDER BY COLUMN_NAME;
