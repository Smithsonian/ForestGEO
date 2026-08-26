-- =====================================================================================
-- Migration 2026-08-26-01: widen temporarymeasurements.FileID to varchar(50)
-- =====================================================================================
-- FileID carries the canonical upload filename. The former varchar(36) contract
-- rejected otherwise-valid uploads before their rows could be evaluated.
--
-- BatchID deliberately remains varchar(36) NOT NULL: generated base IDs and
-- their __subNNN children fit within that independent identifier contract.

SET @fileid_length := (
    SELECT CHARACTER_MAXIMUM_LENGTH
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'temporarymeasurements'
      AND COLUMN_NAME = 'FileID'
);
SET @fileid_column_type := (
    SELECT COLUMN_TYPE
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'temporarymeasurements'
      AND COLUMN_NAME = 'FileID'
);
SET @fileid_nullable := (
    SELECT IS_NULLABLE
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'temporarymeasurements'
      AND COLUMN_NAME = 'FileID'
);

-- Never silently narrow a schema that is already wider than the new contract.
-- The post-migration contract requires exactly varchar(50), so an operator must
-- inspect such a schema and decide how to handle any over-length staged rows.
SET @ddl := CASE
    WHEN @fileid_length IS NULL THEN
        'CALL mig_2026_08_26_01_missing_temporarymeasurements_fileid()'
    WHEN @fileid_length > 50 THEN
        'CALL mig_2026_08_26_01_fileid_wider_than_contract()'
    WHEN @fileid_column_type = 'varchar(50)' AND @fileid_nullable = 'YES' THEN
        'SELECT ''temporarymeasurements.FileID already varchar(50) NULL'' AS Status'
    ELSE
        'ALTER TABLE `temporarymeasurements` MODIFY COLUMN `FileID` varchar(50) NULL'
END;
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 2026-08-26-01 complete: temporarymeasurements.FileID is varchar(50) NULL.' AS Status;
