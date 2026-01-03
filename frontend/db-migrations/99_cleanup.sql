-- =====================================================================================
-- Migration Cleanup Script
-- =====================================================================================
-- Purpose: Remove ALL migration artifacts from the target schema
-- This includes:
--   - ID mapping tables (id_map_*)
--   - Migration state tracking tables (migration_state, migration_config)
--   - Migration helper procedures
--
-- Run this AFTER migration is complete and validated
-- WARNING: This will remove all migration tracking data - ensure migration succeeded first!
--
-- Usage:
--   ./run_migration.sh --cleanup --target forestgeo_mpala
--   OR manually: SOURCE frontend/db-migrations/99_cleanup.sql;
-- =====================================================================================

SELECT '================================================================' AS '';
SELECT 'MIGRATION CLEANUP - Removing all migration artifacts' AS Status;
SELECT '================================================================' AS '';

-- =====================================================================================
-- SECTION 1: Pre-Cleanup Validation
-- =====================================================================================

SELECT '=== Pre-Cleanup Validation ===' AS Section;

-- Check migration status before cleanup
SELECT
    CASE
        WHEN EXISTS (SELECT 1 FROM migration_state WHERE status = 'failed')
        THEN 'WARNING: Migration has failed steps - cleanup will remove tracking data!'
        WHEN EXISTS (SELECT 1 FROM migration_state WHERE status IN ('pending', 'running'))
        THEN 'WARNING: Migration is incomplete - cleanup will remove tracking data!'
        ELSE 'OK: Migration completed successfully'
    END AS Migration_Status;

-- Show current state before cleanup
SELECT
    'Migration State Summary' AS Info,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS Completed,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS Failed,
    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS Pending
FROM migration_state;

-- =====================================================================================
-- SECTION 2: Drop ID Mapping Tables
-- =====================================================================================

SELECT '=== Dropping ID Mapping Tables ===' AS Section;

DROP TABLE IF EXISTS id_map_plots;
DROP TABLE IF EXISTS id_map_quadrats;
DROP TABLE IF EXISTS id_map_family;
DROP TABLE IF EXISTS id_map_genus;
DROP TABLE IF EXISTS id_map_species;
DROP TABLE IF EXISTS id_map_census;
DROP TABLE IF EXISTS id_map_trees;
DROP TABLE IF EXISTS id_map_stems;

SELECT 'ID mapping tables dropped (8 tables)' AS Status;

-- =====================================================================================
-- SECTION 3: Drop Migration State Tables
-- =====================================================================================

SELECT '=== Dropping Migration State Tables ===' AS Section;

DROP TABLE IF EXISTS migration_state;
DROP TABLE IF EXISTS migration_config;

SELECT 'Migration state tables dropped (2 tables)' AS Status;

-- =====================================================================================
-- SECTION 4: Drop Migration Helper Procedures
-- =====================================================================================

SELECT '=== Dropping Migration Helper Procedures ===' AS Section;

DROP PROCEDURE IF EXISTS migration_init;
DROP PROCEDURE IF EXISTS migration_step_start;
DROP PROCEDURE IF EXISTS migration_step_complete;
DROP PROCEDURE IF EXISTS migration_step_fail;
DROP PROCEDURE IF EXISTS migration_progress;
DROP PROCEDURE IF EXISTS migration_reset;
DROP PROCEDURE IF EXISTS migration_get_resume_point;
DROP PROCEDURE IF EXISTS add_index_if_not_exists;
DROP PROCEDURE IF EXISTS add_column_if_not_exists;
DROP PROCEDURE IF EXISTS get_migration_config;

SELECT 'Migration helper procedures dropped (10 procedures)' AS Status;

-- =====================================================================================
-- SECTION 5: Verification
-- =====================================================================================

SELECT '=== Cleanup Verification ===' AS Section;

-- Check for any remaining migration tables
SELECT
    'Remaining Migration Tables' AS Check_Type,
    COUNT(*) AS Count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL - Tables still exist' END AS Status
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND (TABLE_NAME LIKE 'id_map_%'
       OR TABLE_NAME = 'migration_state'
       OR TABLE_NAME = 'migration_config');

-- Check for any remaining migration procedures
SELECT
    'Remaining Migration Procedures' AS Check_Type,
    COUNT(*) AS Count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL - Procedures still exist' END AS Status
FROM INFORMATION_SCHEMA.ROUTINES
WHERE ROUTINE_SCHEMA = DATABASE()
  AND (ROUTINE_NAME LIKE 'migration_%'
       OR ROUTINE_NAME IN ('add_index_if_not_exists', 'add_column_if_not_exists', 'get_migration_config'));

-- Check for any temporary tables that may have been left behind
SELECT
    'Remaining Temp Tables' AS Check_Type,
    COUNT(*) AS Count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARNING - Temp tables exist' END AS Status
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND (TABLE_NAME LIKE 'temp_%' OR TABLE_NAME LIKE '%_temp');

-- =====================================================================================
-- SECTION 6: Final Summary
-- =====================================================================================

SELECT '================================================================' AS '';
SELECT 'CLEANUP COMPLETE' AS Status;
SELECT '================================================================' AS '';

SELECT
    'Cleanup Summary' AS Description,
    DATABASE() AS Schema_Cleaned,
    NOW() AS Completed_At,
    '10 tables dropped, 10 procedures dropped' AS Artifacts_Removed;

-- List remaining tables (should only be core ForestGEO tables)
SELECT
    'Core Tables Remaining' AS Info,
    GROUP_CONCAT(TABLE_NAME ORDER BY TABLE_NAME SEPARATOR ', ') AS Tables
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_TYPE = 'BASE TABLE'
  AND TABLE_NAME NOT LIKE 'temp_%';

SELECT '================================================================' AS '';
SELECT 'Migration artifacts have been removed. Schema is now clean.' AS Status;
SELECT '================================================================' AS '';
