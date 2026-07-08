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

-- Tree counts (CENSUS-AWARE: Trees are per-census in new schema)
-- Source count uses DISTINCT (TreeID, CensusID) combinations
INSERT INTO temp_validation_results
SELECT
    'Biological' AS Category,
    'Trees (per-census)' AS Entity,
    (SELECT COUNT(DISTINCT CONCAT(TreeID, '-', CensusID)) FROM stable_mpala.viewfulltable WHERE TreeID IS NOT NULL AND Tag IS NOT NULL) AS Source_Count,
    (SELECT COUNT(*) FROM trees) AS Target_Count,
    (SELECT COUNT(*) FROM trees) - (SELECT COUNT(DISTINCT CONCAT(TreeID, '-', CensusID)) FROM stable_mpala.viewfulltable WHERE TreeID IS NOT NULL AND Tag IS NOT NULL) AS Difference,
    ROUND(100.0 * (SELECT COUNT(*) FROM trees) / NULLIF((SELECT COUNT(DISTINCT CONCAT(TreeID, '-', CensusID)) FROM stable_mpala.viewfulltable WHERE TreeID IS NOT NULL AND Tag IS NOT NULL), 0), 2) AS Percent_Migrated,
    CASE
        WHEN (SELECT COUNT(*) FROM trees) >= (SELECT COUNT(DISTINCT CONCAT(TreeID, '-', CensusID)) FROM stable_mpala.viewfulltable WHERE TreeID IS NOT NULL AND Tag IS NOT NULL) * 0.99 THEN 'PASS'
        ELSE 'FAIL'
    END AS Status;

-- Stem counts (CENSUS-AWARE: Stems are per-census in new schema)
-- Source count uses DISTINCT (StemID, CensusID) combinations
INSERT INTO temp_validation_results
SELECT
    'Biological' AS Category,
    'Stems (per-census)' AS Entity,
    (SELECT COUNT(DISTINCT CONCAT(StemID, '-', CensusID)) FROM stable_mpala.viewfulltable WHERE StemID IS NOT NULL) AS Source_Count,
    (SELECT COUNT(*) FROM stems) AS Target_Count,
    (SELECT COUNT(*) FROM stems) - (SELECT COUNT(DISTINCT CONCAT(StemID, '-', CensusID)) FROM stable_mpala.viewfulltable WHERE StemID IS NOT NULL) AS Difference,
    ROUND(100.0 * (SELECT COUNT(*) FROM stems) / NULLIF((SELECT COUNT(DISTINCT CONCAT(StemID, '-', CensusID)) FROM stable_mpala.viewfulltable WHERE StemID IS NOT NULL), 0), 2) AS Percent_Migrated,
    CASE
        WHEN (SELECT COUNT(*) FROM stems) >= (SELECT COUNT(DISTINCT CONCAT(StemID, '-', CensusID)) FROM stable_mpala.viewfulltable WHERE StemID IS NOT NULL) * 0.99 THEN 'PASS'
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

-- Check for unmapped records (CENSUS-AWARE)
SELECT 'Checking for unmapped records...' AS Info;

-- Unmapped Tree-Census Combinations
SELECT
    'Unmapped Tree-Census Combinations' AS Check_Type,
    COUNT(*) AS Count,
    ROUND(100.0 * COUNT(*) / (SELECT COUNT(DISTINCT CONCAT(TreeID, '-', CensusID)) FROM stable_mpala.viewfulltable WHERE TreeID IS NOT NULL AND Tag IS NOT NULL), 2) AS Percent_Of_Source
FROM (
    SELECT DISTINCT v.TreeID, v.CensusID
    FROM stable_mpala.viewfulltable v
    WHERE v.TreeID IS NOT NULL AND v.Tag IS NOT NULL
) src
LEFT JOIN id_map_trees t_map ON src.TreeID = t_map.old_TreeID AND src.CensusID = t_map.old_CensusID
WHERE t_map.new_TreeID IS NULL;

-- Unmapped Stem-Census Combinations
SELECT
    'Unmapped Stem-Census Combinations' AS Check_Type,
    COUNT(*) AS Count,
    ROUND(100.0 * COUNT(*) / (SELECT COUNT(DISTINCT CONCAT(StemID, '-', CensusID)) FROM stable_mpala.viewfulltable WHERE StemID IS NOT NULL), 2) AS Percent_Of_Source
FROM (
    SELECT DISTINCT v.StemID, v.CensusID
    FROM stable_mpala.viewfulltable v
    WHERE v.StemID IS NOT NULL
) src
LEFT JOIN id_map_stems s_map ON src.StemID = s_map.old_StemID AND src.CensusID = s_map.old_CensusID
WHERE s_map.new_StemGUID IS NULL;

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
-- CRITICAL: Census Consistency Checks
-- These checks validate the fix for the census mismatch issue
-- ================================================================
SELECT '' AS '';
SELECT 'CENSUS CONSISTENCY CHECKS (Critical):' AS Info;

-- Measurement-Stem Census Consistency
-- This was the ROOT CAUSE of the original issue
SELECT
    'Measurement-Stem Census Mismatch' AS Integrity_Check,
    SUM(CASE WHEN cm.CensusID != st.CensusID THEN 1 ELSE 0 END) AS Count,
    CASE WHEN SUM(CASE WHEN cm.CensusID != st.CensusID THEN 1 ELSE 0 END) = 0 THEN 'PASS' ELSE 'FAIL' END AS Status
FROM coremeasurements cm
JOIN stems st ON cm.StemGUID = st.StemGUID;

-- Stem-Tree Census Consistency
SELECT
    'Stem-Tree Census Mismatch' AS Integrity_Check,
    SUM(CASE WHEN st.CensusID != t.CensusID THEN 1 ELSE 0 END) AS Count,
    CASE WHEN SUM(CASE WHEN st.CensusID != t.CensusID THEN 1 ELSE 0 END) = 0 THEN 'PASS' ELSE 'FAIL' END AS Status
FROM stems st
JOIN trees t ON st.TreeID = t.TreeID;

-- Measurements that will be excluded from MeasurementsSummary
SELECT
    'Measurements Excluded from MeasurementsSummary' AS Integrity_Check,
    (SELECT COUNT(*) FROM coremeasurements) -
    (SELECT COUNT(*)
     FROM coremeasurements cm
     JOIN census c ON cm.CensusID = c.CensusID
     JOIN stems st ON cm.StemGUID = st.StemGUID AND st.CensusID = c.CensusID
     JOIN trees t ON t.TreeID = st.TreeID AND t.CensusID = c.CensusID
     JOIN species sp ON t.SpeciesID = sp.SpeciesID
     JOIN quadrats q ON q.QuadratID = st.QuadratID) AS Count,
    CASE
        WHEN (SELECT COUNT(*) FROM coremeasurements) =
             (SELECT COUNT(*)
              FROM coremeasurements cm
              JOIN census c ON cm.CensusID = c.CensusID
              JOIN stems st ON cm.StemGUID = st.StemGUID AND st.CensusID = c.CensusID
              JOIN trees t ON t.TreeID = st.TreeID AND t.CensusID = c.CensusID
              JOIN species sp ON t.SpeciesID = sp.SpeciesID
              JOIN quadrats q ON q.QuadratID = st.QuadratID)
        THEN 'PASS'
        ELSE 'FAIL'
    END AS Status;

-- Unique ID Checks
SELECT '' AS '';
SELECT 'UNIQUE ID VALIDATION:' AS Info;

-- StemGUID uniqueness
SELECT
    'StemGUID Uniqueness' AS Integrity_Check,
    CASE WHEN COUNT(*) = COUNT(DISTINCT StemGUID) THEN 0 ELSE COUNT(*) - COUNT(DISTINCT StemGUID) END AS Count,
    CASE WHEN COUNT(*) = COUNT(DISTINCT StemGUID) THEN 'PASS' ELSE 'FAIL' END AS Status
FROM stems;

-- TreeID uniqueness
SELECT
    'TreeID Uniqueness' AS Integrity_Check,
    CASE WHEN COUNT(*) = COUNT(DISTINCT TreeID) THEN 0 ELSE COUNT(*) - COUNT(DISTINCT TreeID) END AS Count,
    CASE WHEN COUNT(*) = COUNT(DISTINCT TreeID) THEN 'PASS' ELSE 'FAIL' END AS Status
FROM trees;

-- CoreMeasurementID uniqueness
SELECT
    'CoreMeasurementID Uniqueness' AS Integrity_Check,
    CASE WHEN COUNT(*) = COUNT(DISTINCT CoreMeasurementID) THEN 0 ELSE COUNT(*) - COUNT(DISTINCT CoreMeasurementID) END AS Count,
    CASE WHEN COUNT(*) = COUNT(DISTINCT CoreMeasurementID) THEN 'PASS' ELSE 'FAIL' END AS Status
FROM coremeasurements;

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
