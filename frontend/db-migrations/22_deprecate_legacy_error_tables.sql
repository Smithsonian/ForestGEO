-- =====================================================================================
-- Migration Script 22: Deprecate legacy failedmeasurements/cmverrors tables
-- =====================================================================================
-- Purpose:
--   - Drop legacy tables only when no routines/triggers still reference them
--   - Keep migration idempotent and safe across partially-upgraded schemas
-- =====================================================================================

SET @schema = DATABASE();

SELECT COUNT(*) INTO @failed_proc_refs
FROM INFORMATION_SCHEMA.ROUTINES
WHERE ROUTINE_SCHEMA = @schema
  AND LOWER(COALESCE(ROUTINE_DEFINITION, '')) LIKE '%failedmeasurements%';

SELECT COUNT(*) INTO @failed_trigger_refs
FROM INFORMATION_SCHEMA.TRIGGERS
WHERE TRIGGER_SCHEMA = @schema
  AND LOWER(COALESCE(ACTION_STATEMENT, '')) LIKE '%failedmeasurements%';

SET @drop_failed_sql = IF(
    @failed_proc_refs = 0 AND @failed_trigger_refs = 0,
    'DROP TABLE IF EXISTS failedmeasurements',
    CONCAT('SELECT ''Skipped dropping failedmeasurements: dependent routine/trigger refs found (procedures=', @failed_proc_refs,
           ', triggers=', @failed_trigger_refs, ')'' AS Status')
);
PREPARE stmt FROM @drop_failed_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @cmv_proc_refs
FROM INFORMATION_SCHEMA.ROUTINES
WHERE ROUTINE_SCHEMA = @schema
  AND LOWER(COALESCE(ROUTINE_DEFINITION, '')) LIKE '%cmverrors%';

SELECT COUNT(*) INTO @cmv_trigger_refs
FROM INFORMATION_SCHEMA.TRIGGERS
WHERE TRIGGER_SCHEMA = @schema
  AND LOWER(COALESCE(ACTION_STATEMENT, '')) LIKE '%cmverrors%';

SET @drop_cmv_sql = IF(
    @cmv_proc_refs = 0 AND @cmv_trigger_refs = 0,
    'DROP TABLE IF EXISTS cmverrors',
    CONCAT('SELECT ''Skipped dropping cmverrors: dependent routine/trigger refs found (procedures=', @cmv_proc_refs,
           ', triggers=', @cmv_trigger_refs, ')'' AS Status')
);
PREPARE stmt FROM @drop_cmv_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP PROCEDURE IF EXISTS refresh_failedmeasurements_current;
DROP PROCEDURE IF EXISTS reviewfailed;

SELECT 'Migration 22 complete: legacy error table cleanup evaluated.' AS Status;
