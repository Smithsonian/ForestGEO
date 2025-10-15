-- ================================================================
-- Migration Script 05: Migrate Census
-- ================================================================
-- Purpose: Migrate census data from stable_mpala to forestgeo_testing
-- Uses census table for start/end dates and plot census numbers
-- ================================================================


-- Store original SQL mode
SET @original_sql_mode = @@sql_mode;

-- Temporarily allow zero dates for migration
SET sql_mode = (SELECT REPLACE(@@sql_mode, 'NO_ZERO_DATE,', ''));
SET sql_mode = (SELECT REPLACE(@@sql_mode, 'NO_ZERO_IN_DATE,', ''));
SET sql_mode = (SELECT REPLACE(@@sql_mode, 'STRICT_TRANS_TABLES,', ''));

-- Insert census records
-- Note: Using NULLIF to handle invalid dates (0000-00-00)
INSERT INTO census (
    PlotID,
    StartDate,
    EndDate,
    Description,
    PlotCensusNumber,
    IsActive
)
SELECT DISTINCT
    p_map.new_PlotID AS PlotID,
    -- Handle invalid dates by converting to NULL
    NULLIF(sc.StartDate, '0000-00-00') AS StartDate,
    NULLIF(sc.EndDate, '0000-00-00') AS EndDate,
    sc.Description,
    sc.PlotCensusNumber,
    1 AS IsActive
FROM stable_mpala.census sc
JOIN id_map_plots p_map ON sc.PlotID = p_map.old_PlotID
ORDER BY sc.PlotCensusNumber;

-- Restore original SQL mode
SET sql_mode = @original_sql_mode;

-- Populate mapping table
INSERT INTO id_map_census (old_CensusID, new_CensusID)
SELECT DISTINCT
    sc.CensusID AS old_CensusID,
    nc.CensusID AS new_CensusID
FROM stable_mpala.census sc
JOIN id_map_plots p_map ON sc.PlotID = p_map.old_PlotID
JOIN census nc ON
    nc.PlotID = p_map.new_PlotID
    AND nc.PlotCensusNumber = sc.PlotCensusNumber
WHERE nc.IsActive = 1;

-- Validation query
SELECT
    'Census Migration Summary' AS Description,
    COUNT(*) AS TotalCensusesMigrated,
    MIN(PlotCensusNumber) AS FirstCensusNumber,
    MAX(PlotCensusNumber) AS LastCensusNumber,
    MIN(StartDate) AS EarliestStartDate,
    MAX(EndDate) AS LatestEndDate
FROM census;

SELECT 'Mapping entries created' AS Status, COUNT(*) AS MappingCount FROM id_map_census;

-- Check census by plot
SELECT
    p.PlotName,
    COUNT(c.CensusID) AS CensusCount,
    MIN(c.StartDate) AS FirstCensus,
    MAX(c.EndDate) AS LastCensus
FROM census c
JOIN plots p ON c.PlotID = p.PlotID
GROUP BY p.PlotName;
