-- ================================================================
-- Migration Script 08: Migrate Core Measurements
-- ================================================================
-- Purpose: Migrate measurement data from stable_mpala.dbh to forestgeo_testing.coremeasurements
-- Uses ExactDate when available, falls back to computed date from Date field
-- Links measurements to stems and census
-- ================================================================

USE forestgeo_testing;

-- Insert core measurements from the dbh table
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
    0 AS IsValidated,  -- Default to not validated
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
JOIN id_map_stems s_map ON sdbh.StemID = s_map.old_StemID
JOIN id_map_census c_map ON sdbh.CensusID = c_map.old_CensusID
WHERE sdbh.DBH IS NOT NULL  -- Only migrate records with actual measurements
ORDER BY sdbh.DBHID;

-- Validation query
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

-- Check measurement distribution by census
SELECT
    c.PlotCensusNumber,
    c.Description AS CensusDescription,
    COUNT(cm.CoreMeasurementID) AS MeasurementCount,
    AVG(cm.MeasuredDBH) AS AvgDBH
FROM coremeasurements cm
JOIN census c ON cm.CensusID = c.CensusID
GROUP BY c.PlotCensusNumber, c.Description
ORDER BY c.PlotCensusNumber;

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
