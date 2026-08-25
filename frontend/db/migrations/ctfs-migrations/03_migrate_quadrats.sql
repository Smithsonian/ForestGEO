-- ================================================================
-- Migration Script 03: Migrate Quadrats
-- ================================================================
-- Purpose: Migrate quadrat data from stable_mpala to forestgeo_testing
-- Uses coordinates table to get quadrat positions
-- Assumes 20m x 20m quadrats (400 sq m area)
-- ================================================================


-- Pre-calculate quadrat coordinates to avoid correlated subqueries
DROP TEMPORARY TABLE IF EXISTS quadrat_coords;
CREATE TEMPORARY TABLE quadrat_coords AS
SELECT
    QuadratID,
    MIN(PX) AS StartX,
    MIN(PY) AS StartY
FROM stable_mpala.coordinates
GROUP BY QuadratID;

-- Create index for faster joins
CREATE INDEX idx_quadrat_coords_id ON quadrat_coords(QuadratID);

-- Insert quadrats with pre-calculated coordinates
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
    COALESCE(qc.StartX, 0) AS StartX,
    COALESCE(qc.StartY, 0) AS StartY,
    20 AS DimensionX,  -- Standard quadrat dimensions (20m x 20m)
    20 AS DimensionY,
    400 AS Area,
    'square' AS QuadratShape,
    1 AS IsActive
FROM stable_mpala.viewfulltable v
JOIN id_map_plots p_map ON v.PlotID = p_map.old_PlotID
LEFT JOIN quadrat_coords qc ON v.QuadratID = qc.QuadratID
WHERE v.QuadratName IS NOT NULL
GROUP BY v.QuadratID, v.QuadratName, p_map.new_PlotID, qc.StartX, qc.StartY;

-- Progress indicator
SELECT 'Quadrat data inserted' AS Status, COUNT(*) AS QuadratCount FROM quadrats;

-- Populate mapping table (optimized with distinct source)
INSERT INTO id_map_quadrats (old_QuadratID, new_QuadratID)
SELECT DISTINCT
    source.QuadratID AS old_QuadratID,
    q.QuadratID AS new_QuadratID
FROM (
    SELECT DISTINCT v.QuadratID, v.QuadratName, p_map.new_PlotID
    FROM stable_mpala.viewfulltable v
    JOIN id_map_plots p_map ON v.PlotID = p_map.old_PlotID
    WHERE v.QuadratName IS NOT NULL
) AS source
JOIN quadrats q ON q.PlotID = source.new_PlotID AND q.QuadratName = source.QuadratName;

-- Progress indicator
SELECT 'Mapping table populated' AS Status, COUNT(*) AS MappingCount FROM id_map_quadrats;

-- Cleanup temporary table
DROP TEMPORARY TABLE IF EXISTS quadrat_coords;

-- Validation query
SELECT
    'Quadrats Migration Summary' AS Description,
    COUNT(*) AS TotalQuadratsMigrated,
    MIN(QuadratName) AS SampleQuadratName,
    COUNT(DISTINCT PlotID) AS PlotsWithQuadrats
FROM quadrats;

SELECT
    'Mapping Validation' AS Description,
    COUNT(*) AS MappingCount,
    COUNT(DISTINCT old_QuadratID) AS UniqueOldQuadrats,
    COUNT(DISTINCT new_QuadratID) AS UniqueNewQuadrats
FROM id_map_quadrats;

-- Check for any quadrats without coordinates
SELECT
    'Quadrats with NULL coordinates' AS Warning,
    COUNT(*) AS Count
FROM quadrats
WHERE StartX IS NULL OR StartY IS NULL;
