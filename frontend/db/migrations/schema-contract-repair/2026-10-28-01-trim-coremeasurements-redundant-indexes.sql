-- =====================================================================================
-- Migration 2026-10-28-01: drop the redundant coremeasurements indexes (issue #560)
-- =====================================================================================
-- Every coremeasurements insert and delete maintains every index on the table. Issue
-- #555 measured a census-replacement DELETE at 82-93 us per row against 4-5 us with the
-- primary key alone, and the index count sets the range-optimizer limit that bounds
-- every census-replacement window (CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE). The canonical
-- table carried 19 indexes; forestgeo_harvard, forestgeo_mpala and forestgeo_rabi
-- carried 21. This migration leaves the 14 that tablestructures.sql now defines.
--
-- Dropped, each covered by an index that stays (evidence: the issue #560 design):
--   idx_cm_stem_cid_date_dbh_hom  same columns, same order as ux_measure_unique
--   idx_stemid                    leading prefix of ux_measure_unique and idx_cm_stemguid_active
--   idx_cm_census_active          (CensusID, IsActive): served by idx_censusid and
--                                 idx_cm_census_validated_stem
--   idx_description               no query filters, sorts or groups on Description
--   idx_measurementdate           its callers plan identically without it
-- And three indexes the hand-run CTFS import scripts created outside the canonical DDL
-- (ctfs-migrations/03_apply_schema_changes.sql and 14_add_performance_indexes.sql, which
-- no longer create them):
--   idx_coremeasurements_census_plot             (CensusID): duplicate of idx_censusid
--   idx_coremeasurements_census_plot_validation  (CensusID, IsValidated): prefix of idx_cm_census_validated_stem
--   idx_coremeasurements_census_validation       (CensusID, IsValidated): prefix of idx_cm_census_validated_stem
--
-- Successor check. Nothing is dropped unless the four indexes that replace the dropped
-- ones exist, visible, with no prefix length, ux_measure_unique still unique, and with
-- exactly these ordered columns:
--   idx_censusid                  (CensusID), also hinted by name by the census-replacement cursor
--   idx_cm_census_validated_stem  (CensusID, IsValidated, IsActive, StemGUID)
--   idx_cm_stemguid_active        (StemGUID, IsActive)
--   ux_measure_unique             (StemGUID, CensusID, MeasurementDate, MeasuredDBH, MeasuredHOM)
-- A missing or reshaped successor raises a named conflict and changes nothing. The runner
-- records the migration failed and retries it on every deploy, never a silent success
-- (the 2026-08-27-01 rule). A person restores the successor and the next deploy applies.
--
-- The drop list is read from information_schema for coremeasurements only, so the file
-- is idempotent on every drift shape (19, 21, partially trimmed, already trimmed) and
-- never touches the same-named indexes on measurementssummary or unifiedchangelog. One
-- ALTER drops them all: MySQL applies it atomically, and with ALGORITHM=INPLACE,
-- LOCK=NONE as an online metadata-only change, or refuses it. It waits at most the
-- runner session lock_wait_timeout (60 s) for the metadata lock.
--
-- MySQL rejects SIGNAL inside a prepared statement, so the conflict branch CALLs a
-- short-lived helper procedure that performs the SIGNAL natively. This file drops the
-- helper at the end; when the SIGNAL skips that DROP, the manifest entry failureCleanup
-- drops it. SIGNAL caps MESSAGE_TEXT at 128 characters, so the message is trimmed to 120.
--
-- Rollback (hand-run, per schema; its banner gives the procedure):
--   db/migrations/schema-contract-repair/rollback/2026-10-28-01-trim-coremeasurements-redundant-indexes.rollback.sql
-- Hand-run twin for run-migrations.sh and run-branch-refresh.sh, which re-apply
-- migration 28 (it re-creates idx_cm_census_active):
--   db/migrations/unified-measurements-migrations/62_trim_coremeasurements_redundant_indexes.sql
--
-- This file is listed in db/migrations/manifest.ts and is frozen once any schema has
-- applied it: any byte change fails every later deploy with TamperedMigrationError.
-- A correction must be a new migration.
DROP PROCEDURE IF EXISTS mig_2026_10_28_01_raise_contract_conflict;
CREATE PROCEDURE mig_2026_10_28_01_raise_contract_conflict(IN conflict_message VARCHAR(120))
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = conflict_message;
END;

SET @missing_successors := (
  SELECT GROUP_CONCAT(expected.index_name ORDER BY expected.index_name SEPARATOR ',')
  FROM (
    SELECT 'idx_censusid' AS index_name, 'CensusID' AS columns_csv, 0 AS unique_required
    UNION ALL SELECT 'idx_cm_census_validated_stem', 'CensusID,IsValidated,IsActive,StemGUID', 0
    UNION ALL SELECT 'idx_cm_stemguid_active', 'StemGUID,IsActive', 0
    UNION ALL SELECT 'ux_measure_unique', 'StemGUID,CensusID,MeasurementDate,MeasuredDBH,MeasuredHOM', 1
  ) expected
  LEFT JOIN (
    SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS columns_csv, MAX(NON_UNIQUE) AS non_unique
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coremeasurements' AND IS_VISIBLE = 'YES' AND SUB_PART IS NULL
    GROUP BY INDEX_NAME
  ) live ON live.INDEX_NAME = expected.index_name AND live.columns_csv = expected.columns_csv
         AND (expected.unique_required = 0 OR live.non_unique = 0)
  WHERE live.INDEX_NAME IS NULL
);

SET @drop_clauses := (
  SELECT GROUP_CONCAT(CONCAT('DROP INDEX `', present.INDEX_NAME, '`') ORDER BY present.INDEX_NAME SEPARATOR ', ')
  FROM (
    SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coremeasurements'
      AND INDEX_NAME IN ('idx_stemid', 'idx_cm_stem_cid_date_dbh_hom', 'idx_description', 'idx_measurementdate', 'idx_cm_census_active',
                         'idx_coremeasurements_census_plot', 'idx_coremeasurements_census_plot_validation', 'idx_coremeasurements_census_validation')
  ) present
);

SET @sql := CASE
  WHEN @missing_successors IS NOT NULL THEN
    CONCAT('CALL mig_2026_10_28_01_raise_contract_conflict(', QUOTE(LEFT(CONCAT('coremeasurements index trim refused, missing or reshaped: ', @missing_successors), 120)), ')')
  WHEN @drop_clauses IS NULL THEN 'DO 0'
  ELSE CONCAT('ALTER TABLE `coremeasurements` ', @drop_clauses, ', ALGORITHM=INPLACE, LOCK=NONE')
END;
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

DROP PROCEDURE IF EXISTS mig_2026_10_28_01_raise_contract_conflict;
SELECT 'Migration 2026-10-28-01 complete: coremeasurements redundant indexes absent.' AS Status;
