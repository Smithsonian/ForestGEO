-- =====================================================================================
-- Migration 62: trim the redundant coremeasurements indexes
-- Hand-run twin of manifest migration 2026-10-28-01 (issue #560)
-- =====================================================================================
-- run-migrations.sh and run-branch-refresh.sh apply migration 28, which re-creates
-- idx_cm_census_active when it is absent. On a schema the manifest migration already
-- trimmed, that takes coremeasurements back to 15 indexes. This file runs after 28 in
-- both lists and converges the table to the canonical 14 again.
--
-- It carries the successor refusal of the manifest migration unchanged: nothing is
-- dropped unless idx_censusid (CensusID), idx_cm_census_validated_stem (CensusID,
-- IsValidated, IsActive, StemGUID), idx_cm_stemguid_active (StemGUID, IsActive) and
-- ux_measure_unique (StemGUID, CensusID, MeasurementDate, MeasuredDBH, MeasuredHOM)
-- exist, visible, with no key part prefixed or functional, ux_measure_unique still unique, with exactly
-- those ordered columns. These runners do not load
-- tablestructures.sql, applied migrations can be skipped, and the foreign keys only
-- guarantee some leading-column index, so nothing else guarantees the successors.
-- A refusal raises SQLSTATE 45000 naming the missing or reshaped successors. The mysql
-- client stops there and the helper procedure stays in the schema until the next run of
-- this file, whose first statement drops it. Nothing is dropped.
--
-- The drop list, the successor list and the refusal message must stay identical to
-- schema-contract-repair/2026-10-28-01-trim-coremeasurements-redundant-indexes.sql;
-- tests/coremeasurements-index-trim-twin-migration.test.ts enforces that. One file cannot
-- serve both runners: the mysql client splits the bare CREATE PROCEDURE body of the
-- manifest file at its first semicolon, and the Node runner cannot load DELIMITER. This
-- file uses DELIMITER, like 32_add_cross_census_validation_indexes.sql.
--
-- Rollback: schema-contract-repair/rollback/2026-10-28-01-trim-coremeasurements-redundant-indexes.rollback.sql
DROP PROCEDURE IF EXISTS mig_62_trim_coremeasurements_redundant_indexes;
DELIMITER //
CREATE PROCEDURE mig_62_trim_coremeasurements_redundant_indexes()
BEGIN
  DECLARE missing_successors TEXT DEFAULT NULL;
  DECLARE drop_clauses TEXT DEFAULT NULL;
  DECLARE refusal_message VARCHAR(128);

  SELECT GROUP_CONCAT(expected.index_name ORDER BY expected.index_name SEPARATOR ',')
    INTO missing_successors
  FROM (
    SELECT 'idx_censusid' AS index_name, 'CensusID' AS columns_csv, 0 AS unique_required
    UNION ALL SELECT 'idx_cm_census_validated_stem', 'CensusID,IsValidated,IsActive,StemGUID', 0
    UNION ALL SELECT 'idx_cm_stemguid_active', 'StemGUID,IsActive', 0
    UNION ALL SELECT 'ux_measure_unique', 'StemGUID,CensusID,MeasurementDate,MeasuredDBH,MeasuredHOM', 1
  ) expected
  LEFT JOIN (
    SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS columns_csv, MAX(NON_UNIQUE) AS non_unique
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coremeasurements' AND IS_VISIBLE = 'YES'
    GROUP BY INDEX_NAME
    HAVING COUNT(SUB_PART) = 0 AND COUNT(COLUMN_NAME) = COUNT(*) AND COUNT(EXPRESSION) = 0
  ) live ON live.INDEX_NAME = expected.index_name AND live.columns_csv = expected.columns_csv
         AND (expected.unique_required = 0 OR live.non_unique = 0)
  WHERE live.INDEX_NAME IS NULL;

  IF missing_successors IS NOT NULL THEN
    SET refusal_message = LEFT(CONCAT('index trim refused, missing or reshaped: ', missing_successors), 128);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = refusal_message;
  END IF;

  SELECT GROUP_CONCAT(CONCAT('DROP INDEX `', present.INDEX_NAME, '`') ORDER BY present.INDEX_NAME SEPARATOR ', ')
    INTO drop_clauses
  FROM (
    SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coremeasurements'
      AND INDEX_NAME IN ('idx_stemid', 'idx_cm_stem_cid_date_dbh_hom', 'idx_description', 'idx_measurementdate', 'idx_cm_census_active',
                         'idx_coremeasurements_census_plot', 'idx_coremeasurements_census_plot_validation', 'idx_coremeasurements_census_validation')
  ) present;

  IF drop_clauses IS NOT NULL THEN
    SET @mig_62_trim_ddl = CONCAT('ALTER TABLE `coremeasurements` ', drop_clauses, ', ALGORITHM=INPLACE, LOCK=NONE');
    PREPARE mig_62_trim_stmt FROM @mig_62_trim_ddl;
    EXECUTE mig_62_trim_stmt;
    DEALLOCATE PREPARE mig_62_trim_stmt;
  END IF;
END //
DELIMITER ;

SET SESSION lock_wait_timeout = CAST(LEAST(@@SESSION.lock_wait_timeout, 60) AS UNSIGNED);
CALL mig_62_trim_coremeasurements_redundant_indexes();
DROP PROCEDURE IF EXISTS mig_62_trim_coremeasurements_redundant_indexes;
SELECT 'Migration 62 complete: coremeasurements redundant indexes absent.' AS Status;
