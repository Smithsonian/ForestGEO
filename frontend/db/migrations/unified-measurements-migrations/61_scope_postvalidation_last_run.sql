-- =====================================================================================
-- Migration Script 61: Scope postvalidationqueries last-run status
-- =====================================================================================
-- Purpose:
--   postvalidationqueries stores one row per query. The dashboard Data Quality card
--   needs to know whether LastRunStatus was produced for the currently selected
--   plot/census, otherwise a status from another census can be displayed as current.
--   Nullable/additive/no-backfill. Idempotent via information_schema guards.
-- =====================================================================================

SET @schema_name := DATABASE();

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'postvalidationqueries' AND COLUMN_NAME = 'LastRunPlotID');
SET @ddl := IF(@has_col = 0,
    'ALTER TABLE postvalidationqueries ADD COLUMN LastRunPlotID INT NULL AFTER LastRunStatus', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'postvalidationqueries' AND COLUMN_NAME = 'LastRunCensusID');
SET @ddl := IF(@has_col = 0,
    'ALTER TABLE postvalidationqueries ADD COLUMN LastRunCensusID INT NULL AFTER LastRunPlotID', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'postvalidationqueries' AND INDEX_NAME = 'idx_lastruncontext');
SET @ddl := IF(@has_idx = 0,
    'CREATE INDEX idx_lastruncontext ON postvalidationqueries (LastRunPlotID, LastRunCensusID)', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 61 complete: postvalidation last-run plot/census context ensured.' AS Status;
