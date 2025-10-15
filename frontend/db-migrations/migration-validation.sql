-- ================================================================
-- Migration Validation Script
-- ================================================================
-- Purpose: Comprehensive validation of data migration from stable_mpala
-- Compares source vs target counts and identifies data loss
-- ================================================================

-- Note: Run this script after migration completes
-- Replace 'forestgeo_testing' with your target schema

SET @target_schema = DATABASE();

SELECT CONCAT('Validating migration to schema: ', @target_schema) AS Info;

-- ================================================================
-- SECTION 1: Record Count Comparison
-- ================================================================
SELECT '======================================' AS '';
SELECT 'SECTION 1: Record Count Comparison' AS '';
SELECT '======================================' AS '';

-- Create temporary table for comparison results
DROP TEMPORARY TABLE IF EXISTS temp_validation_results;
CREATE TEMPORARY TABLE temp_validation_results (
    Category VARCHAR(50),
    Entity VARCHAR(50),
    Source_Count INT,
    Target_Count INT,
    Difference INT,
    Percent_Migrated DECIMAL(5,2),
    Status VARCHAR(20)
);

-- Family counts (from actual data, not full lookup table)
INSERT INTO temp_validation_results
SELECT
    'Taxonomy' AS Category,
    'Families' AS Entity,
    (SELECT COUNT(DISTINCT Family) FROM stable_mpala.viewfulltable WHERE Family IS NOT NULL) AS Source_Count,
    (SELECT COUNT(*) FROM family) AS Target_Count,
    (SELECT COUNT(*) FROM family) - (SELECT COUNT(DISTINCT Family) FROM stable_mpala.viewfulltable WHERE Family IS NOT NULL) AS Difference,
    ROUND(100.0 * (SELECT COUNT(*) FROM family) / NULLIF((SELECT COUNT(DISTINCT Family) FROM stable_mpala.viewfulltable WHERE Family IS NOT NULL), 0), 2) AS Percent_Migrated,
    CASE
        WHEN (SELECT COUNT(*) FROM family) >= (SELECT COUNT(DISTINCT Family) FROM stable_mpala.viewfulltable WHERE Family IS NOT NULL) THEN 'PASS'
        ELSE 'FAIL'
    END AS Status;

-- Genus counts (from actual data, not full lookup table)
INSERT INTO temp_validation_results
SELECT
    'Taxonomy' AS Category,
    'Genera' AS Entity,
    (SELECT COUNT(DISTINCT Genus) FROM stable_mpala.viewfulltable WHERE Genus IS NOT NULL) AS Source_Count,
    (SELECT COUNT(*) FROM genus) AS Target_Count,
    (SELECT COUNT(*) FROM genus) - (SELECT COUNT(DISTINCT Genus) FROM stable_mpala.viewfulltable WHERE Genus IS NOT NULL) AS Difference,
    ROUND(100.0 * (SELECT COUNT(*) FROM genus) / NULLIF((SELECT COUNT(DISTINCT Genus) FROM stable_mpala.viewfulltable WHERE Genus IS NOT NULL), 0), 2) AS Percent_Migrated,
    CASE
        WHEN (SELECT COUNT(*) FROM genus) >= (SELECT COUNT(DISTINCT Genus) FROM stable_mpala.viewfulltable WHERE Genus IS NOT NULL) THEN 'PASS'
        ELSE 'FAIL'
    END AS Status;

-- Species counts
INSERT INTO temp_validation_results
SELECT
    'Taxonomy' AS Category,
    'Species' AS Entity,
    (SELECT COUNT(DISTINCT SpeciesID) FROM stable_mpala.viewfulltable WHERE SpeciesID IS NOT NULL) AS Source_Count,
    (SELECT COUNT(*) FROM species) AS Target_Count,
    (SELECT COUNT(*) FROM species) - (SELECT COUNT(DISTINCT SpeciesID) FROM stable_mpala.viewfulltable WHERE SpeciesID IS NOT NULL) AS Difference,
    ROUND(100.0 * (SELECT COUNT(*) FROM species) / NULLIF((SELECT COUNT(DISTINCT SpeciesID) FROM stable_mpala.viewfulltable WHERE SpeciesID IS NOT NULL), 0), 2) AS Percent_Migrated,
    CASE
        WHEN (SELECT COUNT(*) FROM species) >= (SELECT COUNT(DISTINCT SpeciesID) FROM stable_mpala.viewfulltable WHERE SpeciesID IS NOT NULL) THEN 'PASS'
        ELSE 'FAIL'
    END AS Status;

-- Plot counts
INSERT INTO temp_validation_results
SELECT
    'Spatial' AS Category,
    'Plots' AS Entity,
    (SELECT COUNT(DISTINCT PlotID) FROM stable_mpala.viewfulltable WHERE PlotID IS NOT NULL) AS Source_Count,
    (SELECT COUNT(*) FROM plots) AS Target_Count,
    (SELECT COUNT(*) FROM plots) - (SELECT COUNT(DISTINCT PlotID) FROM stable_mpala.viewfulltable WHERE PlotID IS NOT NULL) AS Difference,
    ROUND(100.0 * (SELECT COUNT(*) FROM plots) / NULLIF((SELECT COUNT(DISTINCT PlotID) FROM stable_mpala.viewfulltable WHERE PlotID IS NOT NULL), 0), 2) AS Percent_Migrated,
    CASE
        WHEN (SELECT COUNT(*) FROM plots) >= (SELECT COUNT(DISTINCT PlotID) FROM stable_mpala.viewfulltable WHERE PlotID IS NOT NULL) THEN 'PASS'
        ELSE 'FAIL'
    END AS Status;

-- Quadrat counts
INSERT INTO temp_validation_results
SELECT
    'Spatial' AS Category,
    'Quadrats' AS Entity,
    (SELECT COUNT(DISTINCT QuadratID) FROM stable_mpala.viewfulltable WHERE QuadratID IS NOT NULL) AS Source_Count,
    (SELECT COUNT(*) FROM quadrats) AS Target_Count,
    (SELECT COUNT(*) FROM quadrats) - (SELECT COUNT(DISTINCT QuadratID) FROM stable_mpala.viewfulltable WHERE QuadratID IS NOT NULL) AS Difference,
    ROUND(100.0 * (SELECT COUNT(*) FROM quadrats) / NULLIF((SELECT COUNT(DISTINCT QuadratID) FROM stable_mpala.viewfulltable WHERE QuadratID IS NOT NULL), 0), 2) AS Percent_Migrated,
    CASE
        WHEN (SELECT COUNT(*) FROM quadrats) >= (SELECT COUNT(DISTINCT QuadratID) FROM stable_mpala.viewfulltable WHERE QuadratID IS NOT NULL) THEN 'PASS'
        ELSE 'FAIL'
    END AS Status;

-- Census counts
INSERT INTO temp_validation_results
SELECT
    'Temporal' AS Category,
    'Censuses' AS Entity,
    (SELECT COUNT(DISTINCT CensusID) FROM stable_mpala.census WHERE CensusID IS NOT NULL) AS Source_Count,
    (SELECT COUNT(*) FROM census) AS Target_Count,
    (SELECT COUNT(*) FROM census) - (SELECT COUNT(DISTINCT CensusID) FROM stable_mpala.census WHERE CensusID IS NOT NULL) AS Difference,
    ROUND(100.0 * (SELECT COUNT(*) FROM census) / NULLIF((SELECT COUNT(DISTINCT CensusID) FROM stable_mpala.census WHERE CensusID IS NOT NULL), 0), 2) AS Percent_Migrated,
    CASE
        WHEN (SELECT COUNT(*) FROM census) >= (SELECT COUNT(DISTINCT CensusID) FROM stable_mpala.census WHERE CensusID IS NOT NULL) THEN 'PASS'
        ELSE 'FAIL'
    END AS Status;

-- Tree counts
INSERT INTO temp_validation_results
SELECT
    'Biological' AS Category,
    'Trees' AS Entity,
    (SELECT COUNT(DISTINCT TreeID) FROM stable_mpala.viewfulltable WHERE TreeID IS NOT NULL) AS Source_Count,
    (SELECT COUNT(*) FROM trees) AS Target_Count,
    (SELECT COUNT(*) FROM trees) - (SELECT COUNT(DISTINCT TreeID) FROM stable_mpala.viewfulltable WHERE TreeID IS NOT NULL) AS Difference,
    ROUND(100.0 * (SELECT COUNT(*) FROM trees) / NULLIF((SELECT COUNT(DISTINCT TreeID) FROM stable_mpala.viewfulltable WHERE TreeID IS NOT NULL), 0), 2) AS Percent_Migrated,
    CASE
        WHEN (SELECT COUNT(*) FROM trees) >= (SELECT COUNT(DISTINCT TreeID) FROM stable_mpala.viewfulltable WHERE TreeID IS NOT NULL) * 0.99 THEN 'PASS'
        ELSE 'FAIL'
    END AS Status;

-- Stem counts
INSERT INTO temp_validation_results
SELECT
    'Biological' AS Category,
    'Stems' AS Entity,
    (SELECT COUNT(DISTINCT StemID) FROM stable_mpala.viewfulltable WHERE StemID IS NOT NULL) AS Source_Count,
    (SELECT COUNT(*) FROM stems) AS Target_Count,
    (SELECT COUNT(*) FROM stems) - (SELECT COUNT(DISTINCT StemID) FROM stable_mpala.viewfulltable WHERE StemID IS NOT NULL) AS Difference,
    ROUND(100.0 * (SELECT COUNT(*) FROM stems) / NULLIF((SELECT COUNT(DISTINCT StemID) FROM stable_mpala.viewfulltable WHERE StemID IS NOT NULL), 0), 2) AS Percent_Migrated,
    CASE
        WHEN (SELECT COUNT(*) FROM stems) >= (SELECT COUNT(DISTINCT StemID) FROM stable_mpala.viewfulltable WHERE StemID IS NOT NULL) * 0.99 THEN 'PASS'
        ELSE 'FAIL'
    END AS Status;

-- Core Measurements
INSERT INTO temp_validation_results
SELECT
    'Measurements' AS Category,
    'CoreMeasurements' AS Entity,
    (SELECT COUNT(DISTINCT DBHID) FROM stable_mpala.dbh WHERE DBH IS NOT NULL) AS Source_Count,
    (SELECT COUNT(*) FROM coremeasurements) AS Target_Count,
    (SELECT COUNT(*) FROM coremeasurements) - (SELECT COUNT(DISTINCT DBHID) FROM stable_mpala.dbh WHERE DBH IS NOT NULL) AS Difference,
    ROUND(100.0 * (SELECT COUNT(*) FROM coremeasurements) / NULLIF((SELECT COUNT(DISTINCT DBHID) FROM stable_mpala.dbh WHERE DBH IS NOT NULL), 0), 2) AS Percent_Migrated,
    CASE
        WHEN (SELECT COUNT(*) FROM coremeasurements) >= (SELECT COUNT(DISTINCT DBHID) FROM stable_mpala.dbh WHERE DBH IS NOT NULL) * 0.99 THEN 'PASS'
        ELSE 'FAIL'
    END AS Status;

-- Display results
SELECT * FROM temp_validation_results ORDER BY Category, Entity;

-- ================================================================
-- SECTION 2: Data Loss Analysis
-- ================================================================
SELECT '' AS '';
SELECT '======================================' AS '';
SELECT 'SECTION 2: Data Loss Analysis' AS '';
SELECT '======================================' AS '';

-- Summary of potential data loss
SELECT
    Entity,
    Source_Count,
    Target_Count,
    Difference AS Records_Lost,
    Percent_Migrated AS Migration_Percent,
    Status
FROM temp_validation_results
WHERE Difference < 0
ORDER BY ABS(Difference) DESC;

-- Check for unmapped records
SELECT 'Checking for unmapped records...' AS Info;

-- Unmapped Trees
SELECT
    'Unmapped Trees' AS Check_Type,
    COUNT(DISTINCT v.TreeID) AS Count,
    ROUND(100.0 * COUNT(DISTINCT v.TreeID) / (SELECT COUNT(DISTINCT TreeID) FROM stable_mpala.viewfulltable WHERE TreeID IS NOT NULL), 2) AS Percent_Of_Source
FROM stable_mpala.viewfulltable v
LEFT JOIN id_map_trees t_map ON v.TreeID = t_map.old_TreeID
WHERE v.TreeID IS NOT NULL
  AND t_map.new_TreeID IS NULL;

-- Unmapped Stems
SELECT
    'Unmapped Stems' AS Check_Type,
    COUNT(DISTINCT v.StemID) AS Count,
    ROUND(100.0 * COUNT(DISTINCT v.StemID) / (SELECT COUNT(DISTINCT StemID) FROM stable_mpala.viewfulltable WHERE StemID IS NOT NULL), 2) AS Percent_Of_Source
FROM stable_mpala.viewfulltable v
LEFT JOIN id_map_stems s_map ON v.StemID = s_map.old_StemID
WHERE v.StemID IS NOT NULL
  AND s_map.new_StemGUID IS NULL;

-- ================================================================
-- SECTION 3: Data Integrity Checks
-- ================================================================
SELECT '' AS '';
SELECT '======================================' AS '';
SELECT 'SECTION 3: Data Integrity Checks' AS '';
SELECT '======================================' AS '';

-- Orphaned records check
SELECT 'Checking for orphaned records...' AS Info;

-- Trees without species
SELECT
    'Trees without Species' AS Integrity_Check,
    COUNT(*) AS Count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS Status
FROM trees t
LEFT JOIN species s ON t.SpeciesID = s.SpeciesID
WHERE s.SpeciesID IS NULL;

-- Stems without trees
SELECT
    'Stems without Trees' AS Integrity_Check,
    COUNT(*) AS Count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS Status
FROM stems st
LEFT JOIN trees t ON st.TreeID = t.TreeID
WHERE t.TreeID IS NULL;

-- Measurements without stems
SELECT
    'Measurements without Stems' AS Integrity_Check,
    COUNT(*) AS Count,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS Status
FROM coremeasurements cm
LEFT JOIN stems st ON cm.StemGUID = st.StemGUID
WHERE st.StemGUID IS NULL;

-- ================================================================
-- SECTION 4: Summary Statistics
-- ================================================================
SELECT '' AS '';
SELECT '======================================' AS '';
SELECT 'SECTION 4: Migration Summary' AS '';
SELECT '======================================' AS '';

SELECT
    CONCAT(SUM(CASE WHEN Status = 'PASS' THEN 1 ELSE 0 END), ' / ', COUNT(*)) AS Tests_Passed,
    CONCAT(ROUND(AVG(Percent_Migrated), 2), '%') AS Average_Migration_Rate,
    SUM(CASE WHEN Status = 'FAIL' THEN 1 ELSE 0 END) AS Failed_Checks,
    SUM(ABS(Difference)) AS Total_Record_Difference
FROM temp_validation_results;

-- Final status
SELECT
    CASE
        WHEN (SELECT COUNT(*) FROM temp_validation_results WHERE Status = 'FAIL') = 0
        THEN 'MIGRATION VALIDATION: PASSED ✓'
        ELSE 'MIGRATION VALIDATION: FAILED ✗'
    END AS Final_Status;

-- ================================================================
-- SECTION 5: Cleanup Check
-- ================================================================
SELECT '' AS '';
SELECT '======================================' AS '';
SELECT 'SECTION 5: Temporary Objects Check' AS '';
SELECT '======================================' AS '';

-- Check for temporary tables that should be cleaned up
SELECT
    TABLE_NAME,
    TABLE_TYPE,
    CREATE_TIME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = @target_schema
  AND (TABLE_NAME LIKE 'temp_%'
    OR TABLE_NAME LIKE 'id_map_%'
    OR TABLE_NAME LIKE '%_temp');

-- Cleanup temp tables created by this validation
DROP TEMPORARY TABLE IF EXISTS temp_validation_results;

SELECT 'Validation complete!' AS Status;
