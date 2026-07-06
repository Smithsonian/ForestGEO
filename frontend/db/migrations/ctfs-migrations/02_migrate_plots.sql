-- ================================================================
-- Migration Script 02: Migrate Plots
-- ================================================================
-- Purpose: Migrate plot data from stable_mpala to forestgeo_testing
-- Calculates plot dimensions from coordinate extents
-- ================================================================


-- Pre-calculate plot dimensions to avoid correlated subqueries
-- This dramatically improves performance by calculating once per plot instead of once per row
-- Dynamic unit conversion: automatically scale units to fit within decimal(12,6) limit (999,999.999999)
DROP TEMPORARY TABLE IF EXISTS plot_dimensions;
CREATE TEMPORARY TABLE plot_dimensions AS
SELECT
    q.PlotID,
    -- Calculate raw values in meters
    COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0) AS DimensionX_raw,
    COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0) AS DimensionY_raw,
    (COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) *
    (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0)) AS Area_raw,

    -- Determine appropriate unit for DimensionX (m → dam → hm → km)
    CASE
        WHEN (COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) <= 999999.999999 THEN 'm'
        WHEN (COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) / 10 <= 999999.999999 THEN 'dam'
        WHEN (COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) / 100 <= 999999.999999 THEN 'hm'
        ELSE 'km'
    END AS DimensionXUnit,

    -- Determine appropriate unit for DimensionY
    CASE
        WHEN (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0)) <= 999999.999999 THEN 'm'
        WHEN (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0)) / 10 <= 999999.999999 THEN 'dam'
        WHEN (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0)) / 100 <= 999999.999999 THEN 'hm'
        ELSE 'km'
    END AS DimensionYUnit,

    -- Determine appropriate unit for Area (m² → dam² → hm² → km²)
    CASE
        WHEN ((COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) *
              (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0))) <= 999999.999999 THEN 'm2'
        WHEN ((COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) *
              (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0))) / 100 <= 999999.999999 THEN 'dam2'
        WHEN ((COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) *
              (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0))) / 10000 <= 999999.999999 THEN 'hm2'
        ELSE 'km2'
    END AS AreaUnit,

    -- Convert DimensionX to appropriate unit
    CASE
        WHEN (COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) <= 999999.999999
            THEN (COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0))
        WHEN (COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) / 10 <= 999999.999999
            THEN (COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) / 10
        WHEN (COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) / 100 <= 999999.999999
            THEN (COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) / 100
        ELSE (COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) / 1000
    END AS DimensionX,

    -- Convert DimensionY to appropriate unit
    CASE
        WHEN (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0)) <= 999999.999999
            THEN (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0))
        WHEN (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0)) / 10 <= 999999.999999
            THEN (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0)) / 10
        WHEN (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0)) / 100 <= 999999.999999
            THEN (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0)) / 100
        ELSE (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0)) / 1000
    END AS DimensionY,

    -- Convert Area to appropriate unit
    CASE
        WHEN ((COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) *
              (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0))) <= 999999.999999
            THEN ((COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) *
                  (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0)))
        WHEN ((COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) *
              (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0))) / 100 <= 999999.999999
            THEN ((COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) *
                  (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0))) / 100
        WHEN ((COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) *
              (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0))) / 10000 <= 999999.999999
            THEN ((COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) *
                  (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0))) / 10000
        ELSE ((COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) *
              (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0))) / 1000000
    END AS Area
FROM stable_mpala.coordinates co
JOIN stable_mpala.quadrat q ON co.QuadratID = q.QuadratID
GROUP BY q.PlotID;

-- Create index on temporary table for faster joins
CREATE INDEX idx_plot_dimensions_plotid ON plot_dimensions(PlotID);

-- Show unit conversion decisions
SELECT
    PlotID,
    DimensionX_raw AS 'Raw DimensionX (m)',
    DimensionX AS 'Converted DimensionX',
    DimensionXUnit AS 'Unit',
    DimensionY_raw AS 'Raw DimensionY (m)',
    DimensionY AS 'Converted DimensionY',
    DimensionYUnit AS 'Unit',
    Area_raw AS 'Raw Area (m²)',
    Area AS 'Converted Area',
    AreaUnit AS 'Unit'
FROM plot_dimensions;

-- Insert plots with pre-calculated dimensions and dynamically determined units
SET foreign_key_checks = 0;
INSERT INTO plots (
    PlotName,
    LocationName,
    CountryName,
    DimensionX,
    DimensionY,
    Area,
    PlotDescription,
    DefaultDimensionUnits,
    DefaultCoordinateUnits,
    DefaultAreaUnits,
    DefaultDBHUnits,
    DefaultHOMUnits
)
SELECT DISTINCT
    v.PlotName,
    'Mpala' AS LocationName,
    'Kenya' AS CountryName,
    COALESCE(pd.DimensionX, 0) AS DimensionX,
    COALESCE(pd.DimensionY, 0) AS DimensionY,
    COALESCE(pd.Area, 0) AS Area,
    'Migrated from stable_mpala' AS PlotDescription,
    COALESCE(pd.DimensionXUnit, 'm') AS DefaultDimensionUnits,
    COALESCE(pd.DimensionXUnit, 'm') AS DefaultCoordinateUnits,
    COALESCE(pd.AreaUnit, 'm2') AS DefaultAreaUnits,
    'mm' AS DefaultDBHUnits,
    'm' AS DefaultHOMUnits
FROM stable_mpala.viewfulltable v
LEFT JOIN plot_dimensions pd ON v.PlotID = pd.PlotID
GROUP BY v.PlotID, v.PlotName, pd.DimensionX, pd.DimensionY, pd.Area, pd.DimensionXUnit, pd.DimensionYUnit, pd.AreaUnit;
SET foreign_key_checks = 1;

-- Progress indicator
SELECT 'Plot data inserted' AS Status, COUNT(*) AS PlotCount FROM plots WHERE PlotDescription = 'Migrated from stable_mpala';

-- Populate mapping table (optimized to use distinct source data)
INSERT INTO id_map_plots (old_PlotID, new_PlotID)
SELECT DISTINCT
    source.PlotID AS old_PlotID,
    p.PlotID AS new_PlotID
FROM (
    SELECT DISTINCT PlotID, PlotName
    FROM stable_mpala.viewfulltable
) AS source
JOIN plots p ON source.PlotName = p.PlotName
WHERE p.PlotDescription = 'Migrated from stable_mpala';

-- Progress indicator
SELECT 'Mapping table populated' AS Status, COUNT(*) AS MappingCount FROM id_map_plots;

-- Cleanup temporary table
DROP TEMPORARY TABLE IF EXISTS plot_dimensions;

-- Validation queries
SELECT
    'Plots Migration Summary' AS Description,
    COUNT(*) AS TotalPlotsMigrated,
    MIN(PlotName) AS SamplePlotName,
    MAX(DimensionX) AS MaxDimensionX,
    MAX(DimensionY) AS MaxDimensionY
FROM plots
WHERE PlotDescription = 'Migrated from stable_mpala';

SELECT
    'Mapping Validation' AS Description,
    COUNT(*) AS MappingCount,
    COUNT(DISTINCT old_PlotID) AS UniqueOldPlots,
    COUNT(DISTINCT new_PlotID) AS UniqueNewPlots
FROM id_map_plots;
