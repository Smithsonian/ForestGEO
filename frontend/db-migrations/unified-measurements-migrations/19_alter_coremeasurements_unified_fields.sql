-- =====================================================================================
-- Migration Script 19: Alter coremeasurements for unified ingestion lifecycle
-- =====================================================================================
-- Purpose:
--   - Allow unresolved rows by making StemGUID nullable
--   - Add raw upload columns used by unresolved ingestion rows
--   - Add dedupe index for (UploadBatchID, SourceRowIndex)
-- =====================================================================================

SET @schema = DATABASE();

-- Add UploadFileID (must exist before Raw* columns reference AFTER UploadBatchID)
SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'coremeasurements'
  AND COLUMN_NAME = 'UploadFileID';
SET @sql = IF(
    @col_exists = 0,
    'ALTER TABLE coremeasurements ADD COLUMN UploadFileID VARCHAR(255) NULL AFTER UserDefinedFields',
    'SELECT ''UploadFileID already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add UploadBatchID
SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'coremeasurements'
  AND COLUMN_NAME = 'UploadBatchID';
SET @sql = IF(
    @col_exists = 0,
    'ALTER TABLE coremeasurements ADD COLUMN UploadBatchID VARCHAR(36) NULL AFTER UploadFileID',
    'SELECT ''UploadBatchID already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COALESCE(IS_NULLABLE, 'YES') INTO @stemguid_nullable
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'coremeasurements'
  AND COLUMN_NAME = 'StemGUID'
LIMIT 1;

SET @sql = IF(
    @stemguid_nullable = 'YES',
    'SELECT ''StemGUID already nullable'' AS Status',
    'ALTER TABLE coremeasurements MODIFY COLUMN StemGUID INT NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'coremeasurements'
  AND COLUMN_NAME = 'RawTreeTag';
SET @sql = IF(
    @col_exists = 0,
    'ALTER TABLE coremeasurements ADD COLUMN RawTreeTag VARCHAR(20) NULL AFTER UploadBatchID',
    'SELECT ''RawTreeTag already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'coremeasurements'
  AND COLUMN_NAME = 'RawStemTag';
SET @sql = IF(
    @col_exists = 0,
    'ALTER TABLE coremeasurements ADD COLUMN RawStemTag VARCHAR(10) NULL AFTER RawTreeTag',
    'SELECT ''RawStemTag already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'coremeasurements'
  AND COLUMN_NAME = 'RawSpCode';
SET @sql = IF(
    @col_exists = 0,
    'ALTER TABLE coremeasurements ADD COLUMN RawSpCode VARCHAR(25) NULL AFTER RawStemTag',
    'SELECT ''RawSpCode already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'coremeasurements'
  AND COLUMN_NAME = 'RawQuadrat';
SET @sql = IF(
    @col_exists = 0,
    'ALTER TABLE coremeasurements ADD COLUMN RawQuadrat VARCHAR(255) NULL AFTER RawSpCode',
    'SELECT ''RawQuadrat already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'coremeasurements'
  AND COLUMN_NAME = 'RawX';
SET @sql = IF(
    @col_exists = 0,
    'ALTER TABLE coremeasurements ADD COLUMN RawX DECIMAL(12,6) NULL AFTER RawQuadrat',
    'SELECT ''RawX already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'coremeasurements'
  AND COLUMN_NAME = 'RawY';
SET @sql = IF(
    @col_exists = 0,
    'ALTER TABLE coremeasurements ADD COLUMN RawY DECIMAL(12,6) NULL AFTER RawX',
    'SELECT ''RawY already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'coremeasurements'
  AND COLUMN_NAME = 'RawCodes';
SET @sql = IF(
    @col_exists = 0,
    'ALTER TABLE coremeasurements ADD COLUMN RawCodes VARCHAR(255) NULL AFTER RawY',
    'SELECT ''RawCodes already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'coremeasurements'
  AND COLUMN_NAME = 'RawComments';
SET @sql = IF(
    @col_exists = 0,
    'ALTER TABLE coremeasurements ADD COLUMN RawComments VARCHAR(255) NULL AFTER RawCodes',
    'SELECT ''RawComments already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'coremeasurements'
  AND COLUMN_NAME = 'SourceRowIndex';
SET @sql = IF(
    @col_exists = 0,
    'ALTER TABLE coremeasurements ADD COLUMN SourceRowIndex INT NULL AFTER RawComments',
    'SELECT ''SourceRowIndex already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @idx_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'coremeasurements'
  AND INDEX_NAME = 'ux_cm_uploadbatch_rowindex';

SET @sql = IF(
    @idx_exists = 0,
    'CREATE UNIQUE INDEX ux_cm_uploadbatch_rowindex ON coremeasurements (UploadBatchID, SourceRowIndex)',
    'SELECT ''ux_cm_uploadbatch_rowindex already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @idx_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'coremeasurements'
  AND INDEX_NAME = 'idx_cm_unresolved_lookup';

SET @sql = IF(
    @idx_exists = 0,
    'CREATE INDEX idx_cm_unresolved_lookup ON coremeasurements (StemGUID, CensusID, UploadBatchID)',
    'SELECT ''idx_cm_unresolved_lookup already exists'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 19 complete: coremeasurements supports unresolved ingestion rows.' AS Status;
