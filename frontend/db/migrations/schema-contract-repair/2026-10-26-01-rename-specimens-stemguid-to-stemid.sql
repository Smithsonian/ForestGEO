-- =====================================================================================
-- Migration 2026-10-26-01: specimens.StemGUID -> StemID
-- =====================================================================================
-- The canonical DDL (db/sql/tablestructures.sql) names the specimens stem reference
-- StemID: a foreign key, specimens_stems_StemID_fk, into stems.StemGUID. Four live
-- schemas carry the column as StemGUID instead: forestgeo_mpala, forestgeo_panama,
-- forestgeo_serc and forestgeo_testing (measured 2026-10-26, issue #552).
--
-- Why the drift exists. The 2025-09-04 identity rename (StemID => StemGUID, commits
-- 615e83da and 0d63f681) renamed the specimens column only in the TypeScript type
-- SpecimensRDS and in the hand-run script db/sql/migration_no_mapping.sql. The
-- canonical DDL kept StemID. These four schemas were created outside the canonical
-- DDL and took the renamed shape.
--
-- Why it is fatal now. #489 (commit 5dacd44d, 2026-09-25) added a leftover-stems
-- guard to bulkingestionprocess that reads specimens.StemID on every batch. MySQL
-- resolves the column when the statement runs, whether or not any row matches, so
-- every measurement upload to the four schemas fails with Error 1054 (unknown column
-- sp.StemID in the where clause) and the whole batch is parked as SQL_EXCEPTION rows.
--
-- The specimens table was measured empty on all four schemas. RENAME COLUMN is a
-- metadata-only ALTER in MySQL 8: stored values, the foreign key (its name and its
-- delete rule) and the foreign key index all move to the renamed column unchanged.
--
-- Decision, from information_schema for DATABASE():
--   specimens present, StemGUID only  -> rename StemGUID to StemID
--   specimens present, StemID only    -> no-op (already canonical)
--   specimens present, both columns   -> conflict: nothing says which column holds the
--                                        specimen links or carries the foreign key
--   specimens present, neither column -> conflict
--   no specimens table                -> conflict
-- A conflict raises a named error rather than recording a silent success (the
-- 2026-08-27-01 rule) and changes nothing. A person reconciles the schema by hand;
-- the runner retries a failed migration on every deploy, and the next run takes the
-- canonical branch. Row count and column type are not probed: specimens is a
-- critical table in lib/db/schema-contract.ts, so the post-apply audit compares
-- every specimens column against the canonical DDL.
--
-- MySQL rejects SIGNAL inside a prepared statement, and the branch can only be chosen
-- at runtime, which outside a stored program requires dynamic SQL. So each conflict
-- branch CALLs a short-lived helper procedure that performs the SIGNAL natively. This
-- file drops the helper at the end; when an early SIGNAL skips that DROP, the
-- manifest entry failureCleanup drops it. SIGNAL MESSAGE_TEXT is capped at 128
-- characters by MySQL, so every message is trimmed to 120.
--
-- This file is listed in db/migrations/manifest.ts and is frozen once any schema has
-- applied it: any byte change fails every later deploy with TamperedMigrationError.
-- A correction must be a new migration.
DROP PROCEDURE IF EXISTS mig_2026_10_26_01_raise_contract_conflict;
CREATE PROCEDURE mig_2026_10_26_01_raise_contract_conflict(IN conflict_message VARCHAR(120))
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = conflict_message;
END;

SET @specimens_table_count := (SELECT COUNT(*) FROM information_schema.TABLES
                               WHERE TABLE_SCHEMA = DATABASE()
                                 AND TABLE_NAME = 'specimens');
SET @stemid_column_count := (SELECT COUNT(*) FROM information_schema.COLUMNS
                             WHERE TABLE_SCHEMA = DATABASE()
                               AND TABLE_NAME = 'specimens'
                               AND COLUMN_NAME = 'StemID');
SET @stemguid_column_count := (SELECT COUNT(*) FROM information_schema.COLUMNS
                               WHERE TABLE_SCHEMA = DATABASE()
                                 AND TABLE_NAME = 'specimens'
                                 AND COLUMN_NAME = 'StemGUID');
SET @conflict_prefix := 'specimens stem column conflict:';
SET @sql := CASE
  WHEN @specimens_table_count = 0 THEN
    CONCAT('CALL mig_2026_10_26_01_raise_contract_conflict(',
           QUOTE(LEFT(CONCAT(@conflict_prefix, ' table specimens is missing'), 120)), ')')
  WHEN @stemid_column_count = 1 AND @stemguid_column_count = 0 THEN
    'DO 0'
  WHEN @stemid_column_count = 0 AND @stemguid_column_count = 1 THEN
    'ALTER TABLE `specimens` RENAME COLUMN `StemGUID` TO `StemID`'
  WHEN @stemid_column_count = 1 AND @stemguid_column_count = 1 THEN
    CONCAT('CALL mig_2026_10_26_01_raise_contract_conflict(',
           QUOTE(LEFT(CONCAT(@conflict_prefix, ' both StemID and StemGUID exist; reconcile by hand'), 120)), ')')
  ELSE
    CONCAT('CALL mig_2026_10_26_01_raise_contract_conflict(',
           QUOTE(LEFT(CONCAT(@conflict_prefix, ' neither StemID nor StemGUID exists'), 120)), ')')
END;
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

DROP PROCEDURE IF EXISTS mig_2026_10_26_01_raise_contract_conflict;

SELECT 'Migration 2026-10-26-01 complete: specimens stem column matches canonical StemID.' AS Status;
