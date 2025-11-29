-- ================================================================
-- Migration Script 10: Cleanup
-- ================================================================
-- Purpose: Remove temporary mapping tables and validate cleanup
-- Run this after migration completes and validation passes
-- Note: Uses DATABASE() to work with any target schema
-- ================================================================

SELECT 'Starting cleanup process...' AS Status;

-- ================================================================
-- Drop mapping tables
-- ================================================================
SELECT 'Dropping ID mapping tables...' AS Status;

DROP TABLE IF EXISTS id_map_plots;
DROP TABLE IF EXISTS id_map_quadrats;
DROP TABLE IF EXISTS id_map_family;
DROP TABLE IF EXISTS id_map_genus;
DROP TABLE IF EXISTS id_map_species;
DROP TABLE IF EXISTS id_map_census;
DROP TABLE IF EXISTS id_map_trees;
DROP TABLE IF EXISTS id_map_stems;

SELECT 'Mapping tables dropped' AS Status;

-- ================================================================
-- Verify cleanup
-- ================================================================
SELECT 'Verifying cleanup...' AS Status;

-- Check for any remaining mapping tables
SELECT
    'Remaining Mapping Tables' AS Check_Type,
    COUNT(*) AS Count
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME LIKE 'id_map_%';

-- Check for any temporary tables
SELECT
    'Remaining Temporary Tables' AS Check_Type,
    COUNT(*) AS Count
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND (TABLE_NAME LIKE 'temp_%' OR TABLE_NAME LIKE '%_temp');

-- ================================================================
-- Final summary
-- ================================================================
SELECT
    'Cleanup Complete' AS Status,
    NOW() AS Timestamp,
    DATABASE() AS Schema_Cleaned;
