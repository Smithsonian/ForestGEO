-- ================================================================
-- Migration Script 02: Migrate Plots
-- ================================================================
-- Purpose: Migrate plot data from stable_mpala to forestgeo_testing
-- Calculates plot dimensions from coordinate extents
-- ================================================================

USE forestgeo_testing;

-- Insert plots with calculated dimensions
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
    -- Calculate plot dimensions from coordinate extents
    (SELECT MAX(co.PX) - MIN(co.PX)
     FROM stable_mpala.coordinates co
     JOIN stable_mpala.quadrat q ON co.QuadratID = q.QuadratID
     WHERE q.PlotID = v.PlotID) AS DimensionX,
    (SELECT MAX(co.PY) - MIN(co.PY)
     FROM stable_mpala.coordinates co
     JOIN stable_mpala.quadrat q ON co.QuadratID = q.QuadratID
     WHERE q.PlotID = v.PlotID) AS DimensionY,
    -- Calculate total area from dimensions
    (SELECT (MAX(co.PX) - MIN(co.PX)) * (MAX(co.PY) - MIN(co.PY))
     FROM stable_mpala.coordinates co
     JOIN stable_mpala.quadrat q ON co.QuadratID = q.QuadratID
     WHERE q.PlotID = v.PlotID) AS Area,
    'Migrated from stable_mpala' AS PlotDescription,
    'm' AS DefaultDimensionUnits,
    'm' AS DefaultCoordinateUnits,
    'm2' AS DefaultAreaUnits,
    'mm' AS DefaultDBHUnits,
    'm' AS DefaultHOMUnits
FROM stable_mpala.viewfulltable v
GROUP BY v.PlotID, v.PlotName;

-- Populate mapping table
INSERT INTO id_map_plots (old_PlotID, new_PlotID)
SELECT DISTINCT
    v.PlotID AS old_PlotID,
    p.PlotID AS new_PlotID
FROM stable_mpala.viewfulltable v
JOIN plots p ON v.PlotName = p.PlotName
WHERE p.PlotDescription = 'Migrated from stable_mpala';

-- Validation query
SELECT
    'Plots Migration Summary' AS Description,
    COUNT(*) AS TotalPlotsMigrated,
    MIN(PlotName) AS SamplePlotName,
    MAX(DimensionX) AS MaxDimensionX,
    MAX(DimensionY) AS MaxDimensionY
FROM plots
WHERE PlotDescription = 'Migrated from stable_mpala';

SELECT 'Mapping entries created' AS Status, COUNT(*) AS MappingCount FROM id_map_plots;
