-- Migration: Increase FileID and BatchID column sizes
-- Date: 2025-10-14
-- Description: Increase FileID and BatchID columns from VARCHAR(36) to VARCHAR(50)
-- to accommodate test data that uses longer IDs:
--   - 'test_file_<uuid>' (10 + 36 = 46 characters)
--   - 'test_batch_<uuid>' (11 + 36 = 47 characters)

-- Change FileID column size in temporarymeasurements table
ALTER TABLE temporarymeasurements
MODIFY COLUMN FileID VARCHAR(50);

-- Change BatchID column size in temporarymeasurements table
ALTER TABLE temporarymeasurements
MODIFY COLUMN BatchID VARCHAR(50);

-- Verify the changes
SELECT
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'temporarymeasurements'
  AND COLUMN_NAME IN ('FileID', 'BatchID')
ORDER BY COLUMN_NAME;
