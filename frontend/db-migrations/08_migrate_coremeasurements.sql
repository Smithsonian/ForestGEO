-- ================================================================
-- Migration Script 08: Migrate Core Measurements
-- ================================================================
-- Purpose: Migrate measurement data from stable_mpala.dbh to forestgeo_testing.coremeasurements
-- Uses ExactDate when available, falls back to computed date from Date field
-- Links measurements to stems and census
--
-- CRITICAL: Uses census-aware stem mapping to ensure each measurement
-- links to the correct census-specific stem (StemGUID).
--
-- The mapping join uses BOTH StemID AND CensusID to get the correct
-- StemGUID for each census, preventing the CensusID mismatch issue
-- that caused RefreshMeasurementsSummary join failures.
-- ================================================================


-- Insert core measurements from the dbh table
-- CRITICAL: Join to census-aware stem mapping using BOTH StemID AND CensusID
INSERT INTO coremeasurements (
    CensusID,
    StemGUID,
    IsValidated,
    MeasurementDate,
    MeasuredDBH,
    MeasuredHOM,
    Description,
    IsActive
)
SELECT DISTINCT
    c_map.new_CensusID AS CensusID,
    s_map.new_StemGUID AS StemGUID,
    NULL AS IsValidated,  -- Default to NULL (pending validation), not 0 (invalid)
    -- Use ExactDate when available, otherwise NULL
    sdbh.ExactDate AS MeasurementDate,
    -- Convert DBH from mm to the standard unit (assuming mm)
    sdbh.DBH AS MeasuredDBH,
    -- Convert HOM to decimal (currently stored as char)
    CAST(sdbh.HOM AS DECIMAL(12,6)) AS MeasuredHOM,
    CASE
        WHEN sdbh.PrimaryStem IS NOT NULL THEN CONCAT('Primary stem: ', sdbh.PrimaryStem)
        ELSE NULL
    END AS Description,
    1 AS IsActive
FROM stable_mpala.dbh sdbh
-- CRITICAL: Join using BOTH StemID AND CensusID to get correct census-specific StemGUID
JOIN id_map_stems s_map ON sdbh.StemID = s_map.old_StemID AND sdbh.CensusID = s_map.old_CensusID
JOIN id_map_census c_map ON sdbh.CensusID = c_map.old_CensusID
WHERE sdbh.DBH IS NOT NULL;  -- Only migrate records with actual measurements

-- ================================================================
-- Validation Queries
-- ================================================================

-- Summary of migrated measurements
SELECT
    'Core Measurements Migration Summary' AS Description,
    COUNT(*) AS TotalMeasurementsMigrated,
    COUNT(DISTINCT StemGUID) AS UniqueStemsWithMeasurements,
    COUNT(DISTINCT CensusID) AS CensusesWithMeasurements,
    SUM(CASE WHEN MeasurementDate IS NOT NULL THEN 1 ELSE 0 END) AS MeasurementsWithDate,
    SUM(CASE WHEN MeasurementDate IS NULL THEN 1 ELSE 0 END) AS MeasurementsWithoutDate,
    AVG(MeasuredDBH) AS AvgDBH,
    MIN(MeasuredDBH) AS MinDBH,
    MAX(MeasuredDBH) AS MaxDBH
FROM coremeasurements;

-- Measurements per census
SELECT
    c.CensusID,
    c.PlotCensusNumber,
    c.Description AS CensusDescription,
    COUNT(cm.CoreMeasurementID) AS MeasurementCount,
    AVG(cm.MeasuredDBH) AS AvgDBH
FROM coremeasurements cm
JOIN census c ON cm.CensusID = c.CensusID
GROUP BY c.CensusID, c.PlotCensusNumber, c.Description
ORDER BY c.CensusID;

-- CRITICAL VALIDATION: Verify CensusID consistency between measurements and stems
-- This was the root cause of the original issue
SELECT
    'Measurement-Stem Census Consistency' AS Validation,
    COUNT(*) AS TotalMeasurements,
    SUM(CASE WHEN cm.CensusID = st.CensusID THEN 1 ELSE 0 END) AS ConsistentCensus,
    SUM(CASE WHEN cm.CensusID != st.CensusID THEN 1 ELSE 0 END) AS MismatchedCensus,
    CASE WHEN SUM(CASE WHEN cm.CensusID != st.CensusID THEN 1 ELSE 0 END) = 0 THEN 'PASS' ELSE 'FAIL' END AS Status
FROM coremeasurements cm
JOIN stems st ON cm.StemGUID = st.StemGUID;

-- Verify all measurements can join through to trees (no orphaned references)
SELECT
    'Measurement-Tree Join Integrity' AS Validation,
    COUNT(cm.CoreMeasurementID) AS TotalMeasurements,
    COUNT(t.TreeID) AS JoinableToTrees,
    COUNT(cm.CoreMeasurementID) - COUNT(t.TreeID) AS OrphanedMeasurements,
    CASE WHEN COUNT(cm.CoreMeasurementID) = COUNT(t.TreeID) THEN 'PASS' ELSE 'FAIL' END AS Status
FROM coremeasurements cm
JOIN census c ON cm.CensusID = c.CensusID
JOIN stems st ON cm.StemGUID = st.StemGUID AND st.CensusID = c.CensusID
LEFT JOIN trees t ON t.TreeID = st.TreeID AND t.CensusID = c.CensusID;

-- Count how many measurements will appear in measurementssummary after refresh
SELECT
    'Expected MeasurementsSummary Rows' AS Description,
    COUNT(*) AS ExpectedRows
FROM coremeasurements cm
JOIN census c ON cm.CensusID = c.CensusID
JOIN stems st ON cm.StemGUID = st.StemGUID AND st.CensusID = c.CensusID
JOIN trees t ON t.TreeID = st.TreeID AND t.CensusID = c.CensusID
JOIN species sp ON t.SpeciesID = sp.SpeciesID
JOIN quadrats q ON q.QuadratID = st.QuadratID;

-- Verify CoreMeasurementID uniqueness
SELECT
    'CoreMeasurementID uniqueness check' AS Validation,
    COUNT(*) AS TotalRows,
    COUNT(DISTINCT CoreMeasurementID) AS UniqueIDs,
    CASE WHEN COUNT(*) = COUNT(DISTINCT CoreMeasurementID) THEN 'PASS' ELSE 'FAIL' END AS Status
FROM coremeasurements;

-- Check for measurements with NULL DBH or HOM
SELECT
    'Measurements with NULL values' AS Warning,
    SUM(CASE WHEN MeasuredDBH IS NULL THEN 1 ELSE 0 END) AS NullDBH,
    SUM(CASE WHEN MeasuredHOM IS NULL THEN 1 ELSE 0 END) AS NullHOM
FROM coremeasurements;

-- Check date coverage
SELECT
    'Date Coverage' AS Info,
    MIN(MeasurementDate) AS EarliestMeasurement,
    MAX(MeasurementDate) AS LatestMeasurement,
    COUNT(DISTINCT MeasurementDate) AS UniqueDates
FROM coremeasurements
WHERE MeasurementDate IS NOT NULL;

-- Sample of migrated measurements with tree and species info
SELECT
    p.PlotName,
    q.QuadratName,
    t.TreeTag,
    sp.SpeciesCode,
    sp.SpeciesName,
    cm.CensusID AS MeasurementCensus,
    st.CensusID AS StemCensus,
    cm.MeasuredDBH,
    cm.MeasuredHOM,
    cm.MeasurementDate
FROM coremeasurements cm
JOIN stems st ON cm.StemGUID = st.StemGUID
JOIN trees t ON st.TreeID = t.TreeID
JOIN species sp ON t.SpeciesID = sp.SpeciesID
JOIN quadrats q ON st.QuadratID = q.QuadratID
JOIN plots p ON q.PlotID = p.PlotID
ORDER BY cm.MeasurementDate DESC
LIMIT 10;
