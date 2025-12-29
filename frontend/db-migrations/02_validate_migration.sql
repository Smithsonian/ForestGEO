-- =====================================================================================
-- Consolidated Migration Validation Script
-- =====================================================================================
-- Purpose: Comprehensive validation of migrated data
-- Combines: 10_validation_queries.sql, 10a_critical_validation.sql, migration-validation.sql
--
-- This script performs:
--   1. Critical checks (MUST pass for migration to succeed)
--   2. Data integrity checks (relationships, orphans)
--   3. Census consistency checks (the fix we implemented)
--   4. Row count verification
--   5. Data quality checks
--
-- The script will FAIL (signal error) if critical checks don't pass
-- =====================================================================================

CALL migration_step_start('10_validate_migration');

SET @source_schema = COALESCE(@source_schema, (SELECT config_value FROM migration_config WHERE config_key = 'source_schema'));

-- =====================================================================================
-- SECTION 1: CRITICAL CHECKS (Must Pass)
-- =====================================================================================

SELECT '=== CRITICAL VALIDATION CHECKS ===' AS Section;

-- Initialize error counters
SET @orphaned_genus = 0;
SET @orphaned_species = 0;
SET @trees_no_species = 0;
SET @stems_no_trees = 0;
SET @stems_no_quadrats = 0;
SET @measurements_no_stems = 0;
SET @measurements_no_census = 0;
SET @census_mismatch_stem = 0;
SET @census_mismatch_tree = 0;

-- Check 1: Orphaned genus records
SELECT COUNT(*) INTO @orphaned_genus
FROM genus g LEFT JOIN family f ON g.FamilyID = f.FamilyID
WHERE f.FamilyID IS NULL;

SELECT CASE WHEN @orphaned_genus > 0
    THEN CONCAT('CRITICAL: ', @orphaned_genus, ' genus records without valid family')
    ELSE 'OK: All genus records have valid family'
END AS Genus_Family_Check;

-- Check 2: Orphaned species records
SELECT COUNT(*) INTO @orphaned_species
FROM species s LEFT JOIN genus g ON s.GenusID = g.GenusID
WHERE g.GenusID IS NULL;

SELECT CASE WHEN @orphaned_species > 0
    THEN CONCAT('CRITICAL: ', @orphaned_species, ' species records without valid genus')
    ELSE 'OK: All species records have valid genus'
END AS Species_Genus_Check;

-- Check 3: Trees without species
SELECT COUNT(*) INTO @trees_no_species
FROM trees t LEFT JOIN species s ON t.SpeciesID = s.SpeciesID
WHERE s.SpeciesID IS NULL;

SELECT CASE WHEN @trees_no_species > 0
    THEN CONCAT('CRITICAL: ', @trees_no_species, ' trees without valid species')
    ELSE 'OK: All trees have valid species'
END AS Trees_Species_Check;

-- Check 4: Stems without trees
SELECT COUNT(*) INTO @stems_no_trees
FROM stems st LEFT JOIN trees t ON st.TreeID = t.TreeID
WHERE t.TreeID IS NULL;

SELECT CASE WHEN @stems_no_trees > 0
    THEN CONCAT('CRITICAL: ', @stems_no_trees, ' stems without valid trees')
    ELSE 'OK: All stems have valid trees'
END AS Stems_Trees_Check;

-- Check 5: Stems without quadrats
SELECT COUNT(*) INTO @stems_no_quadrats
FROM stems st LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
WHERE q.QuadratID IS NULL;

SELECT CASE WHEN @stems_no_quadrats > 0
    THEN CONCAT('CRITICAL: ', @stems_no_quadrats, ' stems without valid quadrats')
    ELSE 'OK: All stems have valid quadrats'
END AS Stems_Quadrats_Check;

-- Check 6: Measurements without stems
SELECT COUNT(*) INTO @measurements_no_stems
FROM coremeasurements cm LEFT JOIN stems st ON cm.StemGUID = st.StemGUID
WHERE st.StemGUID IS NULL;

SELECT CASE WHEN @measurements_no_stems > 0
    THEN CONCAT('CRITICAL: ', @measurements_no_stems, ' measurements without valid stems')
    ELSE 'OK: All measurements have valid stems'
END AS Measurements_Stems_Check;

-- Check 7: Measurements without census
SELECT COUNT(*) INTO @measurements_no_census
FROM coremeasurements cm LEFT JOIN census c ON cm.CensusID = c.CensusID
WHERE c.CensusID IS NULL;

SELECT CASE WHEN @measurements_no_census > 0
    THEN CONCAT('CRITICAL: ', @measurements_no_census, ' measurements without valid census')
    ELSE 'OK: All measurements have valid census'
END AS Measurements_Census_Check;

-- =====================================================================================
-- SECTION 2: CENSUS CONSISTENCY CHECKS (The Critical Fix)
-- =====================================================================================

SELECT '=== CENSUS CONSISTENCY CHECKS ===' AS Section;

-- Check 8: Measurement-Stem census mismatch (ROOT CAUSE OF ORIGINAL BUG)
SELECT COUNT(*) INTO @census_mismatch_stem
FROM coremeasurements cm
JOIN stems st ON cm.StemGUID = st.StemGUID
WHERE cm.CensusID != st.CensusID;

SELECT
    CASE WHEN @census_mismatch_stem > 0
        THEN CONCAT('CRITICAL: ', @census_mismatch_stem, ' measurements reference wrong-census stems!')
        ELSE 'OK: All measurements reference correct-census stems'
    END AS Measurement_Stem_Census_Check;

-- Check 9: Stem-Tree census mismatch
SELECT COUNT(*) INTO @census_mismatch_tree
FROM stems st
JOIN trees t ON st.TreeID = t.TreeID
WHERE st.CensusID != t.CensusID;

SELECT
    CASE WHEN @census_mismatch_tree > 0
        THEN CONCAT('CRITICAL: ', @census_mismatch_tree, ' stems reference wrong-census trees!')
        ELSE 'OK: All stems reference correct-census trees'
    END AS Stem_Tree_Census_Check;

-- =====================================================================================
-- SECTION 3: DATA EXISTENCE CHECKS
-- =====================================================================================

SELECT '=== DATA EXISTENCE CHECKS ===' AS Section;

SET @no_plots = (SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM plots);
SET @no_quadrats = (SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM quadrats);
SET @no_species = (SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM species);
SET @no_trees = (SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM trees);
SET @no_stems = (SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM stems);
SET @no_measurements = (SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM coremeasurements);

SELECT
    CASE @no_plots WHEN 1 THEN 'CRITICAL: No plots migrated' ELSE CONCAT('OK: ', (SELECT COUNT(*) FROM plots), ' plots') END AS Plots_Check,
    CASE @no_quadrats WHEN 1 THEN 'CRITICAL: No quadrats migrated' ELSE CONCAT('OK: ', (SELECT COUNT(*) FROM quadrats), ' quadrats') END AS Quadrats_Check,
    CASE @no_species WHEN 1 THEN 'CRITICAL: No species migrated' ELSE CONCAT('OK: ', (SELECT COUNT(*) FROM species), ' species') END AS Species_Check,
    CASE @no_trees WHEN 1 THEN 'CRITICAL: No trees migrated' ELSE CONCAT('OK: ', (SELECT COUNT(*) FROM trees), ' trees') END AS Trees_Check,
    CASE @no_stems WHEN 1 THEN 'CRITICAL: No stems migrated' ELSE CONCAT('OK: ', (SELECT COUNT(*) FROM stems), ' stems') END AS Stems_Check,
    CASE @no_measurements WHEN 1 THEN 'CRITICAL: No measurements migrated' ELSE CONCAT('OK: ', (SELECT COUNT(*) FROM coremeasurements), ' measurements') END AS Measurements_Check;

-- =====================================================================================
-- SECTION 4: ROW COUNT COMPARISON
-- =====================================================================================

SELECT '=== ROW COUNT COMPARISON ===' AS Section;

SET @sql = CONCAT('
SELECT
    ''Source vs Target'' AS Comparison,
    (SELECT COUNT(*) FROM ', @source_schema, '.viewfulltable) AS Source_ViewFullTable,
    (SELECT COUNT(DISTINCT PlotID) FROM ', @source_schema, '.viewfulltable) AS Source_Plots,
    (SELECT COUNT(DISTINCT QuadratID) FROM ', @source_schema, '.viewfulltable) AS Source_Quadrats,
    (SELECT COUNT(DISTINCT TreeID) FROM ', @source_schema, '.viewfulltable) AS Source_Trees,
    (SELECT COUNT(DISTINCT StemID) FROM ', @source_schema, '.viewfulltable) AS Source_Stems,
    (SELECT COUNT(DISTINCT DBHID) FROM ', @source_schema, '.viewfulltable) AS Source_Measurements,
    (SELECT COUNT(*) FROM plots) AS Target_Plots,
    (SELECT COUNT(*) FROM quadrats) AS Target_Quadrats,
    (SELECT COUNT(*) FROM trees) AS Target_Trees,
    (SELECT COUNT(*) FROM stems) AS Target_Stems,
    (SELECT COUNT(*) FROM coremeasurements) AS Target_Measurements
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =====================================================================================
-- SECTION 5: MAPPING TABLE VERIFICATION
-- =====================================================================================

SELECT '=== MAPPING TABLE VERIFICATION ===' AS Section;

SELECT
    (SELECT COUNT(*) FROM id_map_plots) AS Plot_Mappings,
    (SELECT COUNT(*) FROM id_map_quadrats) AS Quadrat_Mappings,
    (SELECT COUNT(*) FROM id_map_family) AS Family_Mappings,
    (SELECT COUNT(*) FROM id_map_genus) AS Genus_Mappings,
    (SELECT COUNT(*) FROM id_map_species) AS Species_Mappings,
    (SELECT COUNT(*) FROM id_map_census) AS Census_Mappings,
    (SELECT COUNT(*) FROM id_map_trees) AS Tree_Mappings,
    (SELECT COUNT(*) FROM id_map_stems) AS Stem_Mappings;

-- Check for unmapped items
SET @sql = CONCAT('
SELECT
    ''Unmapped Items'' AS Check_Type,
    (SELECT COUNT(DISTINCT TreeID) FROM ', @source_schema, '.viewfulltable v
     WHERE v.TreeID IS NOT NULL AND v.Tag IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM id_map_trees m WHERE m.old_TreeID = v.TreeID AND m.old_CensusID = v.CensusID)
    ) AS Unmapped_Trees,
    (SELECT COUNT(DISTINCT StemID) FROM ', @source_schema, '.viewfulltable v
     WHERE v.StemID IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM id_map_stems m WHERE m.old_StemID = v.StemID AND m.old_CensusID = v.CensusID)
    ) AS Unmapped_Stems
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =====================================================================================
-- SECTION 6: CENSUS DISTRIBUTION
-- =====================================================================================

SELECT '=== CENSUS DISTRIBUTION ===' AS Section;

SELECT
    c.CensusID,
    c.PlotCensusNumber,
    COUNT(DISTINCT t.TreeID) AS Trees,
    COUNT(DISTINCT st.StemGUID) AS Stems,
    COUNT(DISTINCT cm.CoreMeasurementID) AS Measurements,
    AVG(cm.MeasuredDBH) AS Avg_DBH
FROM census c
LEFT JOIN trees t ON c.CensusID = t.CensusID
LEFT JOIN stems st ON c.CensusID = st.CensusID
LEFT JOIN coremeasurements cm ON c.CensusID = cm.CensusID
GROUP BY c.CensusID, c.PlotCensusNumber
ORDER BY c.PlotCensusNumber;

-- =====================================================================================
-- SECTION 7: MEASUREMENTSSUMMARY PROJECTION
-- =====================================================================================

SELECT '=== MEASUREMENTSSUMMARY PROJECTION ===' AS Section;

-- This query simulates what RefreshMeasurementsSummary will return
-- If this count differs significantly from coremeasurements, there's a problem

SELECT
    'MeasurementsSummary Check' AS Description,
    (SELECT COUNT(*) FROM coremeasurements) AS Total_Measurements,
    COUNT(*) AS Expected_In_Summary,
    (SELECT COUNT(*) FROM coremeasurements) - COUNT(*) AS Would_Be_Missing
FROM coremeasurements cm
JOIN census c ON cm.CensusID = c.CensusID
JOIN stems st ON cm.StemGUID = st.StemGUID AND st.CensusID = c.CensusID
JOIN trees t ON t.TreeID = st.TreeID AND t.CensusID = c.CensusID
JOIN species sp ON t.SpeciesID = sp.SpeciesID
JOIN quadrats q ON q.QuadratID = st.QuadratID;

-- =====================================================================================
-- SECTION 8: DATA QUALITY CHECKS
-- =====================================================================================

SELECT '=== DATA QUALITY CHECKS ===' AS Section;

-- DBH statistics
SELECT
    'DBH Statistics' AS Metric,
    COUNT(*) AS Total,
    MIN(MeasuredDBH) AS Min_DBH,
    MAX(MeasuredDBH) AS Max_DBH,
    ROUND(AVG(MeasuredDBH), 2) AS Avg_DBH,
    SUM(CASE WHEN MeasuredDBH < 10 OR MeasuredDBH > 2000 THEN 1 ELSE 0 END) AS Suspicious_Values
FROM coremeasurements
WHERE MeasuredDBH IS NOT NULL;

-- NULL value analysis
SELECT
    'NULL Values' AS Check_Type,
    SUM(CASE WHEN MeasuredDBH IS NULL THEN 1 ELSE 0 END) AS NULL_DBH,
    SUM(CASE WHEN MeasuredHOM IS NULL THEN 1 ELSE 0 END) AS NULL_HOM,
    SUM(CASE WHEN MeasurementDate IS NULL THEN 1 ELSE 0 END) AS NULL_Date
FROM coremeasurements;

-- Stems with missing coordinates
SELECT
    'Missing Coordinates' AS Check_Type,
    COUNT(*) AS Stems_Without_Coords,
    ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM stems), 2) AS Percentage
FROM stems
WHERE LocalX IS NULL OR LocalY IS NULL;

-- =====================================================================================
-- SECTION 8b: STEMCROSSID VALIDATION
-- =====================================================================================
-- Validates that StemCrossID is properly populated for cross-census stem tracking

SELECT '=== STEMCROSSID VALIDATION ===' AS Section;

-- Initialize StemCrossID error counters
SET @stemcrossid_null = 0;
SET @stemcrossid_invalid_ref = 0;
SET @stemcrossid_chain_broken = 0;

-- Check 1: NULL StemCrossID on active stems (CRITICAL for stem tracking)
SELECT COUNT(*) INTO @stemcrossid_null
FROM stems WHERE StemCrossID IS NULL AND IsActive = 1;

SELECT CASE WHEN @stemcrossid_null > 0
    THEN CONCAT('CRITICAL: ', @stemcrossid_null, ' active stems have NULL StemCrossID - cross-census tracking broken')
    ELSE 'OK: All active stems have StemCrossID populated'
END AS StemCrossID_Null_Check;

-- Check 2: Invalid StemCrossID references (points to non-existent StemGUID)
SELECT COUNT(*) INTO @stemcrossid_invalid_ref
FROM stems s
WHERE s.StemCrossID IS NOT NULL
  AND s.IsActive = 1
  AND NOT EXISTS (SELECT 1 FROM stems s2 WHERE s2.StemGUID = s.StemCrossID);

SELECT CASE WHEN @stemcrossid_invalid_ref > 0
    THEN CONCAT('CRITICAL: ', @stemcrossid_invalid_ref, ' stems have StemCrossID pointing to non-existent StemGUID')
    ELSE 'OK: All StemCrossID values reference valid stems'
END AS StemCrossID_Reference_Check;

-- Check 3: Broken chains (StemCrossID points to stem with NULL StemCrossID)
SELECT COUNT(*) INTO @stemcrossid_chain_broken
FROM stems s1
JOIN stems s2 ON s1.StemCrossID = s2.StemGUID
WHERE s1.IsActive = 1 AND s2.StemCrossID IS NULL;

SELECT CASE WHEN @stemcrossid_chain_broken > 0
    THEN CONCAT('WARNING: ', @stemcrossid_chain_broken, ' stems have broken StemCrossID chains')
    ELSE 'OK: No broken StemCrossID chains'
END AS StemCrossID_Chain_Check;

-- StemCrossID Statistics Summary
SELECT
    'StemCrossID Summary' AS Description,
    COUNT(*) AS Total_Active_Stems,
    SUM(CASE WHEN StemCrossID IS NOT NULL THEN 1 ELSE 0 END) AS Has_StemCrossID,
    SUM(CASE WHEN StemCrossID = StemGUID THEN 1 ELSE 0 END) AS Self_Referenced,
    SUM(CASE WHEN StemCrossID IS NOT NULL AND StemCrossID != StemGUID THEN 1 ELSE 0 END) AS Cross_Census_Linked,
    COUNT(DISTINCT StemCrossID) AS Unique_Physical_Stems
FROM stems WHERE IsActive = 1;

-- Cross-census linkage breakdown by census
SELECT
    c.PlotCensusNumber AS Census,
    COUNT(s.StemGUID) AS Total_Stems,
    SUM(CASE WHEN s.StemCrossID = s.StemGUID THEN 1 ELSE 0 END) AS First_Appearance,
    SUM(CASE WHEN s.StemCrossID != s.StemGUID THEN 1 ELSE 0 END) AS Linked_From_Previous,
    ROUND(100.0 * SUM(CASE WHEN s.StemCrossID != s.StemGUID THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS Pct_Linked
FROM stems s
JOIN census c ON s.CensusID = c.CensusID
WHERE s.IsActive = 1
GROUP BY c.CensusID, c.PlotCensusNumber
ORDER BY c.PlotCensusNumber;

-- Tag consistency check: stems linked by StemCrossID should have same TreeTag+StemTag
SELECT
    'Tag Consistency' AS Check_Type,
    SUM(CASE WHEN inconsistent_tags > 0 THEN 1 ELSE 0 END) AS Inconsistent_Groups,
    COUNT(*) AS Total_Physical_Stems
FROM (
    SELECT
        s.StemCrossID,
        COUNT(DISTINCT CONCAT(t.TreeTag, '|', COALESCE(s.StemTag, ''))) - 1 AS inconsistent_tags
    FROM stems s
    JOIN trees t ON s.TreeID = t.TreeID
    WHERE s.IsActive = 1 AND s.StemCrossID IS NOT NULL
    GROUP BY s.StemCrossID
) tag_check;

-- =====================================================================================
-- SECTION 9: CRITICAL ERROR SUMMARY AND FAILURE SIGNAL
-- =====================================================================================

SELECT '=== CRITICAL VALIDATION SUMMARY ===' AS Section;

SET @total_critical_errors =
    @orphaned_genus +
    @orphaned_species +
    @trees_no_species +
    @stems_no_trees +
    @stems_no_quadrats +
    @measurements_no_stems +
    @measurements_no_census +
    @census_mismatch_stem +
    @census_mismatch_tree +
    @no_plots +
    @no_quadrats +
    @no_species +
    @no_trees +
    @no_stems +
    @no_measurements +
    @stemcrossid_null +
    @stemcrossid_invalid_ref;

SELECT
    @total_critical_errors AS Total_Critical_Errors,
    CASE WHEN @total_critical_errors = 0
        THEN 'PASSED - All critical validations passed'
        ELSE 'FAILED - Critical data integrity issues detected'
    END AS Validation_Result;

-- Detailed breakdown
SELECT
    'Error Breakdown' AS Section,
    @orphaned_genus AS Orphaned_Genus,
    @orphaned_species AS Orphaned_Species,
    @trees_no_species AS Trees_No_Species,
    @stems_no_trees AS Stems_No_Trees,
    @stems_no_quadrats AS Stems_No_Quadrats,
    @measurements_no_stems AS Measurements_No_Stems,
    @measurements_no_census AS Measurements_No_Census,
    @census_mismatch_stem AS Census_Mismatch_Stem,
    @census_mismatch_tree AS Census_Mismatch_Tree,
    @stemcrossid_null AS StemCrossID_Null,
    @stemcrossid_invalid_ref AS StemCrossID_Invalid_Ref;

-- =====================================================================================
-- SECTION 10: FAIL IF CRITICAL ERRORS EXIST
-- =====================================================================================

-- Create temporary procedure to signal failure
DROP PROCEDURE IF EXISTS check_migration_validation;
DELIMITER $$
CREATE PROCEDURE check_migration_validation(IN error_count INT)
BEGIN
    IF error_count > 0 THEN
        -- Update migration state
        UPDATE migration_state
        SET status = 'failed',
            error_message = CONCAT('Validation failed with ', error_count, ' critical errors')
        WHERE step_name = '10_validate_migration';

        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'MIGRATION VALIDATION FAILED: Critical data integrity issues detected. Check log for details.';
    ELSE
        SELECT 'Critical validation completed successfully!' AS Final_Status;
    END IF;
END$$
DELIMITER ;

CALL check_migration_validation(@total_critical_errors);

DROP PROCEDURE IF EXISTS check_migration_validation;

-- If we get here, validation passed
CALL migration_step_complete('10_validate_migration', @total_critical_errors);

SELECT '=== VALIDATION COMPLETE ===' AS Section;
