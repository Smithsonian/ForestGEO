-- =====================================================================================
-- Migration Script 10a: Critical Data Validation
-- =====================================================================================
-- Purpose: Perform critical validation checks that MUST pass for migration to succeed
-- This script will FAIL (cause an error) if any critical issues are detected
--
-- Critical checks:
-- 1. Orphaned records (broken relationships)
-- 2. Missing required data
-- 3. Data loss detection (source vs target counts)
--
-- Note: Uses DATABASE() to work with any target schema - schema is selected by the caller
-- =====================================================================================

-- =====================================================================================
-- CRITICAL CHECK 1: Verify no orphaned records exist
-- =====================================================================================

-- Check for orphaned genus records (genus without family)
SELECT
    CASE
        WHEN COUNT(*) > 0 THEN CONCAT('CRITICAL ERROR: ', COUNT(*), ' genus records without valid family')
        ELSE 'OK: All genus records have valid family'
    END AS Genus_Family_Check
FROM genus g
LEFT JOIN family f ON g.FamilyID = f.FamilyID
WHERE f.FamilyID IS NULL;

-- Fail if orphaned genus records exist
SET @orphaned_genus = (
    SELECT COUNT(*) FROM genus g
    LEFT JOIN family f ON g.FamilyID = f.FamilyID
    WHERE f.FamilyID IS NULL
);

-- Check for orphaned species records (species without genus)
SELECT
    CASE
        WHEN COUNT(*) > 0 THEN CONCAT('CRITICAL ERROR: ', COUNT(*), ' species records without valid genus')
        ELSE 'OK: All species records have valid genus'
    END AS Species_Genus_Check
FROM species s
LEFT JOIN genus g ON s.GenusID = g.GenusID
WHERE g.GenusID IS NULL;

SET @orphaned_species = (
    SELECT COUNT(*) FROM species s
    LEFT JOIN genus g ON s.GenusID = g.GenusID
    WHERE g.GenusID IS NULL
);

-- Check for trees without valid species
SELECT
    CASE
        WHEN COUNT(*) > 0 THEN CONCAT('CRITICAL ERROR: ', COUNT(*), ' trees without valid species')
        ELSE 'OK: All trees have valid species'
    END AS Trees_Species_Check
FROM trees t
LEFT JOIN species s ON t.SpeciesID = s.SpeciesID
WHERE s.SpeciesID IS NULL;

SET @trees_no_species = (
    SELECT COUNT(*) FROM trees t
    LEFT JOIN species s ON t.SpeciesID = s.SpeciesID
    WHERE s.SpeciesID IS NULL
);

-- Check for stems without valid trees
SELECT
    CASE
        WHEN COUNT(*) > 0 THEN CONCAT('CRITICAL ERROR: ', COUNT(*), ' stems without valid trees')
        ELSE 'OK: All stems have valid trees'
    END AS Stems_Trees_Check
FROM stems st
LEFT JOIN trees t ON st.TreeID = t.TreeID
WHERE t.TreeID IS NULL;

SET @stems_no_trees = (
    SELECT COUNT(*) FROM stems st
    LEFT JOIN trees t ON st.TreeID = t.TreeID
    WHERE t.TreeID IS NULL
);

-- Check for stems without valid quadrats
SELECT
    CASE
        WHEN COUNT(*) > 0 THEN CONCAT('CRITICAL ERROR: ', COUNT(*), ' stems without valid quadrats')
        ELSE 'OK: All stems have valid quadrats'
    END AS Stems_Quadrats_Check
FROM stems st
LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
WHERE q.QuadratID IS NULL;

SET @stems_no_quadrats = (
    SELECT COUNT(*) FROM stems st
    LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
    WHERE q.QuadratID IS NULL
);

-- Check for measurements without valid stems
SELECT
    CASE
        WHEN COUNT(*) > 0 THEN CONCAT('CRITICAL ERROR: ', COUNT(*), ' measurements without valid stems')
        ELSE 'OK: All measurements have valid stems'
    END AS Measurements_Stems_Check
FROM coremeasurements cm
LEFT JOIN stems st ON cm.StemGUID = st.StemGUID
WHERE st.StemGUID IS NULL;

SET @measurements_no_stems = (
    SELECT COUNT(*) FROM coremeasurements cm
    LEFT JOIN stems st ON cm.StemGUID = st.StemGUID
    WHERE st.StemGUID IS NULL
);

-- Check for measurements without valid census
SELECT
    CASE
        WHEN COUNT(*) > 0 THEN CONCAT('CRITICAL ERROR: ', COUNT(*), ' measurements without valid census')
        ELSE 'OK: All measurements have valid census'
    END AS Measurements_Census_Check
FROM coremeasurements cm
LEFT JOIN census c ON cm.CensusID = c.CensusID
WHERE c.CensusID IS NULL;

SET @measurements_no_census = (
    SELECT COUNT(*) FROM coremeasurements cm
    LEFT JOIN census c ON cm.CensusID = c.CensusID
    WHERE c.CensusID IS NULL
);

-- =====================================================================================
-- CRITICAL CHECK 2: Verify required data was migrated
-- =====================================================================================

-- Check that we have at least some data
SELECT
    CASE
        WHEN (SELECT COUNT(*) FROM plots) = 0 THEN 'CRITICAL ERROR: No plots migrated'
        ELSE CONCAT('OK: ', (SELECT COUNT(*) FROM plots), ' plots migrated')
    END AS Plots_Check;

SET @no_plots = (SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM plots);

SELECT
    CASE
        WHEN (SELECT COUNT(*) FROM quadrats) = 0 THEN 'CRITICAL ERROR: No quadrats migrated'
        ELSE CONCAT('OK: ', (SELECT COUNT(*) FROM quadrats), ' quadrats migrated')
    END AS Quadrats_Check;

SET @no_quadrats = (SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM quadrats);

SELECT
    CASE
        WHEN (SELECT COUNT(*) FROM species) = 0 THEN 'CRITICAL ERROR: No species migrated'
        ELSE CONCAT('OK: ', (SELECT COUNT(*) FROM species), ' species migrated')
    END AS Species_Check;

SET @no_species = (SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM species);

SELECT
    CASE
        WHEN (SELECT COUNT(*) FROM trees) = 0 THEN 'CRITICAL ERROR: No trees migrated'
        ELSE CONCAT('OK: ', (SELECT COUNT(*) FROM trees), ' trees migrated')
    END AS Trees_Check;

SET @no_trees = (SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM trees);

SELECT
    CASE
        WHEN (SELECT COUNT(*) FROM stems) = 0 THEN 'CRITICAL ERROR: No stems migrated'
        ELSE CONCAT('OK: ', (SELECT COUNT(*) FROM stems), ' stems migrated')
    END AS Stems_Check;

SET @no_stems = (SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM stems);

SELECT
    CASE
        WHEN (SELECT COUNT(*) FROM coremeasurements) = 0 THEN 'CRITICAL ERROR: No measurements migrated'
        ELSE CONCAT('OK: ', (SELECT COUNT(*) FROM coremeasurements), ' measurements migrated')
    END AS Measurements_Check;

SET @no_measurements = (SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM coremeasurements);

-- =====================================================================================
-- CRITICAL CHECK 3: Calculate total errors and FAIL if any exist
-- =====================================================================================

SET @total_critical_errors =
    @orphaned_genus +
    @orphaned_species +
    @trees_no_species +
    @stems_no_trees +
    @stems_no_quadrats +
    @measurements_no_stems +
    @measurements_no_census +
    @no_plots +
    @no_quadrats +
    @no_species +
    @no_trees +
    @no_stems +
    @no_measurements;

-- Summary of validation
SELECT '=== CRITICAL VALIDATION SUMMARY ===' AS Section;

SELECT
    @total_critical_errors AS Total_Critical_Errors,
    CASE
        WHEN @total_critical_errors = 0 THEN 'PASSED - All critical validations passed'
        ELSE 'FAILED - Critical data integrity issues detected'
    END AS Validation_Result;

-- Detail breakdown of errors
SELECT
    'Error Breakdown' AS Section,
    @orphaned_genus AS Orphaned_Genus,
    @orphaned_species AS Orphaned_Species,
    @trees_no_species AS Trees_No_Species,
    @stems_no_trees AS Stems_No_Trees,
    @stems_no_quadrats AS Stems_No_Quadrats,
    @measurements_no_stems AS Measurements_No_Stems,
    @measurements_no_census AS Measurements_No_Census,
    @no_plots AS No_Plots,
    @no_quadrats AS No_Quadrats,
    @no_species AS No_Species,
    @no_trees AS No_Trees,
    @no_stems AS No_Stems,
    @no_measurements AS No_Measurements;

-- Create a procedure to signal an error if validation fails
DROP PROCEDURE IF EXISTS check_migration_validation;
DELIMITER $$
CREATE PROCEDURE check_migration_validation(IN error_count INT)
BEGIN
    IF error_count > 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'MIGRATION VALIDATION FAILED: Critical data integrity issues detected. Check log for details.';
    ELSE
        SELECT 'Critical validation completed successfully!' AS Final_Status;
    END IF;
END$$
DELIMITER ;

-- Execute the validation check
CALL check_migration_validation(@total_critical_errors);

-- Cleanup
DROP PROCEDURE IF EXISTS check_migration_validation;
