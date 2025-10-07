-- ================================================================
-- Migration Script 03: Migrate Quadrats
-- ================================================================
-- Purpose: Migrate quadrat data from stable_mpala to forestgeo_testing
-- Uses coordinates table to get quadrat positions
-- Assumes 20m x 20m quadrats (400 sq m area)
-- ================================================================

USE forestgeo_testing;

-- Insert quadrats with coordinates from the coordinates table
INSERT INTO quadrats (
    PlotID,
    QuadratName,
    StartX,
    StartY,
    DimensionX,
    DimensionY,
    Area,
    QuadratShape,
    IsActive
)
SELECT DISTINCT
    p_map.new_PlotID AS PlotID,
    v.QuadratName,
    -- Get the upper-left corner coordinates (PX, PY from coordinates table)
    (SELECT MIN(co.PX)
     FROM stable_mpala.coordinates co
     WHERE co.QuadratID = v.QuadratID) AS StartX,
    (SELECT MIN(co.PY)
     FROM stable_mpala.coordinates co
     WHERE co.QuadratID = v.QuadratID) AS StartY,
    -- Standard quadrat dimensions (20m x 20m)
    20 AS DimensionX,
    20 AS DimensionY,
    400 AS Area,
    'square' AS QuadratShape,
    1 AS IsActive
FROM stable_mpala.viewfulltable v
JOIN id_map_plots p_map ON v.PlotID = p_map.old_PlotID
WHERE v.QuadratName IS NOT NULL
GROUP BY v.QuadratID, v.QuadratName, p_map.new_PlotID;

-- Populate mapping table
INSERT INTO id_map_quadrats (old_QuadratID, new_QuadratID)
SELECT DISTINCT
    v.QuadratID AS old_QuadratID,
    q.QuadratID AS new_QuadratID
FROM stable_mpala.viewfulltable v
JOIN id_map_plots p_map ON v.PlotID = p_map.old_PlotID
JOIN quadrats q ON q.PlotID = p_map.new_PlotID AND q.QuadratName = v.QuadratName
WHERE v.QuadratName IS NOT NULL;

-- Validation query
SELECT
    'Quadrats Migration Summary' AS Description,
    COUNT(*) AS TotalQuadratsMigrated,
    MIN(QuadratName) AS SampleQuadratName,
    COUNT(DISTINCT PlotID) AS PlotsWithQuadrats
FROM quadrats;

SELECT 'Mapping entries created' AS Status, COUNT(*) AS MappingCount FROM id_map_quadrats;

-- Check for any quadrats without coordinates
SELECT
    'Quadrats with NULL coordinates' AS Warning,
    COUNT(*) AS Count
FROM quadrats
WHERE StartX IS NULL OR StartY IS NULL;
