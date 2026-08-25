-- =====================================================================================
-- Migration 2026-07-16-02: normalize temporarymeasurements FileID/BatchID to contract
-- =====================================================================================
-- Canonical contract (db/sql/tablestructures.sql): FileID varchar(36) NULL,
-- BatchID varchar(36) NOT NULL. The 2026-07-16 read-only audit found 4 of 9
-- production schemas (harvard, mpala, rabi, testing) still on the pre-contract
-- varchar(50) definitions with BatchID nullable. Audited data on those schemas is
-- safe to narrow today (3 schemas have an empty staging table; rabi's max lengths
-- are 10/20 with zero NULL BatchIDs).
--
-- NON-DESTRUCTIVE BY DESIGN: if rows violating the target contract exist at apply
-- time (over-length IDs or NULL BatchID), this migration fails loudly via a call to
-- a deliberately nonexistent, self-describing procedure instead of letting a
-- non-strict sql_mode silently truncate values or coerce NULL to ''. An operator
-- must then inspect and clear the offending staging rows before re-running.

SET @needs_fileid := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'temporarymeasurements'
      AND COLUMN_NAME = 'FileID'
      AND (COLUMN_TYPE <> 'varchar(36)' OR IS_NULLABLE <> 'YES')
);
SET @needs_batchid := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'temporarymeasurements'
      AND COLUMN_NAME = 'BatchID'
      AND (COLUMN_TYPE <> 'varchar(36)' OR IS_NULLABLE <> 'NO')
);

-- Precondition: no staged rows may violate the target contract. Only checked when a
-- repair is actually needed, so conforming schemas skip the table scan entirely
-- (temporarymeasurements is a drained staging table, so the scan is cheap anyway).
SET @violating_rows := IF(@needs_fileid + @needs_batchid = 0, 0, (
    SELECT COUNT(*) FROM temporarymeasurements
    WHERE CHAR_LENGTH(FileID) > 36
       OR CHAR_LENGTH(BatchID) > 36
       OR BatchID IS NULL
));
SET @ddl := IF(@violating_rows > 0,
    'CALL mig_2026_07_16_02_blocked_staging_rows_violate_contract()',
    'SELECT ''temporarymeasurements ID precondition ok'' AS Status'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(@needs_fileid = 0,
    'SELECT ''temporarymeasurements.FileID already varchar(36) NULL'' AS Status',
    'ALTER TABLE `temporarymeasurements` MODIFY COLUMN `FileID` varchar(36) NULL'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(@needs_batchid = 0,
    'SELECT ''temporarymeasurements.BatchID already varchar(36) NOT NULL'' AS Status',
    'ALTER TABLE `temporarymeasurements` MODIFY COLUMN `BatchID` varchar(36) NOT NULL'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 2026-07-16-02 complete: temporarymeasurements FileID/BatchID normalized.' AS Status;
