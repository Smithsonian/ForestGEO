-- ================================================================
-- Validation Script: Comprehensive Data Integrity Checks
-- ================================================================
-- Purpose: Validate the entire migration and check data integrity
-- Run this after all migration scripts have completed
-- ================================================================

USE forestgeo_testing;

-- ================================================================
-- SECTION 1: Row Count Comparison
-- ================================================================
SELECT '=== ROW COUNT COMPARISON ===' AS Section;

SELECT
    'Source vs Target Row Counts' AS Description,
    (SELECT COUNT(*) FROM stable_mpala.viewfulltable) AS Source_ViewFullTable_Rows,
    (SELECT COUNT(DISTINCT PlotID) FROM stable_mpala.viewfulltable) AS Source_Unique_Plots,
    (SELECT COUNT(DISTINCT QuadratID) FROM stable_mpala.viewfulltable) AS Source_Unique_Quadrats,
    (SELECT COUNT(DISTINCT TreeID) FROM stable_mpala.viewfulltable) AS Source_Unique_Trees,
    (SELECT COUNT(DISTINCT StemID) FROM stable_mpala.viewfulltable) AS Source_Unique_Stems,
    (SELECT COUNT(DISTINCT DBHID) FROM stable_mpala.viewfulltable) AS Source_Unique_Measurements,
    (SELECT COUNT(*) FROM plots) AS Target_Plots,
    (SELECT COUNT(*) FROM quadrats) AS Target_Quadrats,
    (SELECT COUNT(*) FROM trees) AS Target_Trees,
    (SELECT COUNT(*) FROM stems) AS Target_Stems,
    (SELECT COUNT(*) FROM coremeasurements) AS Target_Measurements;

-- ================================================================
-- SECTION 2: Taxonomy Validation
-- ================================================================
SELECT '=== TAXONOMY VALIDATION ===' AS Section;

-- Check family counts
SELECT
    'Family Counts' AS Check_Type,
    (SELECT COUNT(DISTINCT Family) FROM stable_mpala.viewfulltable WHERE Family IS NOT NULL) AS Source_Families,
    (SELECT COUNT(*) FROM family) AS Target_Families;

-- Check genus counts
SELECT
    'Genus Counts' AS Check_Type,
    (SELECT COUNT(DISTINCT Genus) FROM stable_mpala.viewfulltable WHERE Genus IS NOT NULL) AS Source_Genera,
    (SELECT COUNT(*) FROM genus) AS Target_Genera;

-- Check species counts
SELECT
    'Species Counts' AS Check_Type,
    (SELECT COUNT(DISTINCT SpeciesID) FROM stable_mpala.viewfulltable WHERE SpeciesID IS NOT NULL) AS Source_Species,
    (SELECT COUNT(*) FROM species) AS Target_Species;

-- Verify taxonomy hierarchy integrity
SELECT
    'Orphaned Genus Records' AS Check_Type,
    COUNT(*) AS Count
FROM genus g
LEFT JOIN family f ON g.FamilyID = f.FamilyID
WHERE f.FamilyID IS NULL;

SELECT
    'Orphaned Species Records' AS Check_Type,
    COUNT(*) AS Count
FROM species s
LEFT JOIN genus g ON s.GenusID = g.GenusID
WHERE g.GenusID IS NULL;

-- ================================================================
-- SECTION 3: Spatial Data Validation
-- ================================================================
SELECT '=== SPATIAL DATA VALIDATION ===' AS Section;

-- Check for quadrats with NULL coordinates
SELECT
    'Quadrats with NULL Coordinates' AS Check_Type,
    COUNT(*) AS Count
FROM quadrats
WHERE StartX IS NULL OR StartY IS NULL;

-- Check for stems with NULL coordinates
SELECT
    'Stems with NULL Coordinates' AS Check_Type,
    COUNT(*) AS Count,
    ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM stems), 2) AS Percentage
FROM stems
WHERE LocalX IS NULL OR LocalY IS NULL;

-- Validate coordinate ranges
SELECT
    'Coordinate Ranges' AS Check_Type,
    MIN(LocalX) AS Min_LocalX,
    MAX(LocalX) AS Max_LocalX,
    MIN(LocalY) AS Min_LocalY,
    MAX(LocalY) AS Max_LocalY
FROM stems
WHERE LocalX IS NOT NULL AND LocalY IS NOT NULL;

-- ================================================================
-- SECTION 4: Relationship Integrity
-- ================================================================
SELECT '=== RELATIONSHIP INTEGRITY ===' AS Section;

-- Check trees without valid species
SELECT
    'Trees without Species' AS Check_Type,
    COUNT(*) AS Count
FROM trees t
LEFT JOIN species s ON t.SpeciesID = s.SpeciesID
WHERE s.SpeciesID IS NULL;

-- Check stems without valid trees
SELECT
    'Stems without Trees' AS Check_Type,
    COUNT(*) AS Count
FROM stems st
LEFT JOIN trees t ON st.TreeID = t.TreeID
WHERE t.TreeID IS NULL;

-- Check stems without valid quadrats
SELECT
    'Stems without Quadrats' AS Check_Type,
    COUNT(*) AS Count
FROM stems st
LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
WHERE q.QuadratID IS NULL;

-- Check measurements without valid stems
SELECT
    'Measurements without Stems' AS Check_Type,
    COUNT(*) AS Count
FROM coremeasurements cm
LEFT JOIN stems st ON cm.StemGUID = st.StemGUID
WHERE st.StemGUID IS NULL;

-- Check measurements without valid census
SELECT
    'Measurements without Census' AS Check_Type,
    COUNT(*) AS Count
FROM coremeasurements cm
LEFT JOIN census c ON cm.CensusID = c.CensusID
WHERE c.CensusID IS NULL;

-- ================================================================
-- SECTION 5: Measurement Data Validation
-- ================================================================
SELECT '=== MEASUREMENT DATA VALIDATION ===' AS Section;

-- Check DBH value ranges
SELECT
    'DBH Statistics' AS Check_Type,
    COUNT(*) AS Total_Measurements,
    MIN(MeasuredDBH) AS Min_DBH,
    MAX(MeasuredDBH) AS Max_DBH,
    AVG(MeasuredDBH) AS Avg_DBH,
    STDDEV(MeasuredDBH) AS StdDev_DBH
FROM coremeasurements
WHERE MeasuredDBH IS NOT NULL;

-- Check for suspicious DBH values (outliers)
SELECT
    'Suspicious DBH Values' AS Check_Type,
    COUNT(*) AS Count
FROM coremeasurements
WHERE MeasuredDBH < 10 OR MeasuredDBH > 2000;  -- Typical range is 10-2000mm

-- Check HOM value ranges
SELECT
    'HOM Statistics' AS Check_Type,
    COUNT(*) AS Total_Measurements,
    MIN(MeasuredHOM) AS Min_HOM,
    MAX(MeasuredHOM) AS Max_HOM,
    AVG(MeasuredHOM) AS Avg_HOM
FROM coremeasurements
WHERE MeasuredHOM IS NOT NULL;

-- Check measurement dates
SELECT
    'Measurement Date Coverage' AS Check_Type,
    MIN(MeasurementDate) AS Earliest_Date,
    MAX(MeasurementDate) AS Latest_Date,
    COUNT(DISTINCT MeasurementDate) AS Unique_Dates,
    SUM(CASE WHEN MeasurementDate IS NULL THEN 1 ELSE 0 END) AS Null_Dates
FROM coremeasurements;

-- ================================================================
-- SECTION 6: Attribute Validation
-- ================================================================
SELECT '=== ATTRIBUTE VALIDATION ===' AS Section;

-- Check attribute distribution
SELECT
    'Attribute Distribution' AS Check_Type,
    a.Code,
    a.Description,
    COUNT(cma.CoreMeasurementID) AS Usage_Count
FROM attributes a
LEFT JOIN cmattributes cma ON a.Code = cma.Code
GROUP BY a.Code, a.Description
ORDER BY Usage_Count DESC;

-- Check measurements without attributes
SELECT
    'Measurements without Attributes' AS Check_Type,
    COUNT(*) AS Count,
    ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM coremeasurements), 2) AS Percentage
FROM coremeasurements cm
WHERE NOT EXISTS (
    SELECT 1 FROM cmattributes cma WHERE cma.CoreMeasurementID = cm.CoreMeasurementID
);

-- ================================================================
-- SECTION 7: Census Coverage
-- ================================================================
SELECT '=== CENSUS COVERAGE ===' AS Section;

SELECT
    c.PlotCensusNumber,
    c.StartDate,
    c.EndDate,
    COUNT(DISTINCT st.StemGUID) AS Stems_Measured,
    COUNT(DISTINCT cm.CoreMeasurementID) AS Total_Measurements,
    AVG(cm.MeasuredDBH) AS Avg_DBH
FROM census c
LEFT JOIN coremeasurements cm ON c.CensusID = cm.CensusID
LEFT JOIN stems st ON cm.StemGUID = st.StemGUID
GROUP BY c.PlotCensusNumber, c.StartDate, c.EndDate
ORDER BY c.PlotCensusNumber;

-- ================================================================
-- SECTION 8: ID Mapping Verification
-- ================================================================
SELECT '=== ID MAPPING VERIFICATION ===' AS Section;

SELECT
    'ID Mapping Summary' AS Description,
    (SELECT COUNT(*) FROM id_map_plots) AS Plot_Mappings,
    (SELECT COUNT(*) FROM id_map_quadrats) AS Quadrat_Mappings,
    (SELECT COUNT(*) FROM id_map_family) AS Family_Mappings,
    (SELECT COUNT(*) FROM id_map_genus) AS Genus_Mappings,
    (SELECT COUNT(*) FROM id_map_species) AS Species_Mappings,
    (SELECT COUNT(*) FROM id_map_census) AS Census_Mappings,
    (SELECT COUNT(*) FROM id_map_trees) AS Tree_Mappings,
    (SELECT COUNT(*) FROM id_map_stems) AS Stem_Mappings;

-- ================================================================
-- SECTION 9: Sample Data Verification
-- ================================================================
SELECT '=== SAMPLE DATA VERIFICATION ===' AS Section;

-- Sample of complete data chain: plot -> quadrat -> tree -> stem -> measurement
SELECT
    p.PlotName,
    q.QuadratName,
    f.Family,
    g.Genus,
    s.SpeciesName,
    s.SpeciesCode,
    t.TreeTag,
    st.StemTag,
    st.LocalX,
    st.LocalY,
    cm.MeasuredDBH,
    cm.MeasuredHOM,
    cm.MeasurementDate,
    GROUP_CONCAT(DISTINCT a.Code ORDER BY a.Code SEPARATOR ', ') AS Attributes
FROM coremeasurements cm
JOIN stems st ON cm.StemGUID = st.StemGUID
JOIN trees t ON st.TreeID = t.TreeID
JOIN species s ON t.SpeciesID = s.SpeciesID
JOIN genus g ON s.GenusID = g.GenusID
JOIN family f ON g.FamilyID = f.FamilyID
JOIN quadrats q ON st.QuadratID = q.QuadratID
JOIN plots p ON q.PlotID = p.PlotID
LEFT JOIN cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
LEFT JOIN attributes a ON cma.Code = a.Code
GROUP BY p.PlotName, q.QuadratName, f.Family, g.Genus, s.SpeciesName, s.SpeciesCode,
         t.TreeTag, st.StemTag, st.LocalX, st.LocalY, cm.MeasuredDBH, cm.MeasuredHOM, cm.MeasurementDate
ORDER BY p.PlotName, q.QuadratName, t.TreeTag
LIMIT 20;

-- ================================================================
-- SECTION 10: Final Summary
-- ================================================================
SELECT '=== MIGRATION SUMMARY ===' AS Section;

SELECT
    'Migration Complete' AS Status,
    NOW() AS Validation_Time,
    (SELECT COUNT(*) FROM plots) AS Total_Plots,
    (SELECT COUNT(*) FROM quadrats) AS Total_Quadrats,
    (SELECT COUNT(*) FROM family) AS Total_Families,
    (SELECT COUNT(*) FROM genus) AS Total_Genera,
    (SELECT COUNT(*) FROM species) AS Total_Species,
    (SELECT COUNT(*) FROM census) AS Total_Censuses,
    (SELECT COUNT(*) FROM trees) AS Total_Trees,
    (SELECT COUNT(*) FROM stems) AS Total_Stems,
    (SELECT COUNT(*) FROM coremeasurements) AS Total_Measurements,
    (SELECT COUNT(*) FROM attributes) AS Total_Attribute_Codes,
    (SELECT COUNT(*) FROM cmattributes) AS Total_Attribute_Links;

SELECT 'Validation queries completed successfully!' AS Final_Status;
