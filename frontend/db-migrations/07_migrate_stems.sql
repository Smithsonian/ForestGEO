-- ================================================================
-- Migration Script 07: Migrate Stems
-- ================================================================
-- Purpose: Migrate stem data from stable_mpala to forestgeo_testing
-- Uses stable_mpala.stem table for accurate coordinates (QX, QY)
-- Links stems to trees, quadrats, and census
-- ================================================================

USE forestgeo_testing;

-- Insert stems with coordinates from the stem table
-- Note: Using QX, QY as local coordinates within the quadrat
INSERT INTO stems (
    TreeID,
    QuadratID,
    CensusID,
    StemTag,
    LocalX,
    LocalY,
    Moved,
    StemDescription,
    IsActive
)
SELECT DISTINCT
    t_map.new_TreeID AS TreeID,
    q_map.new_QuadratID AS QuadratID,
    c_map.new_CensusID AS CensusID,
    v.StemTag,
    -- Use coordinates from stem table (QX, QY are quadrat-local coordinates)
    ss.QX AS LocalX,
    ss.QY AS LocalY,
    -- Convert Moved field from Y/N to bit
    CASE WHEN ss.Moved = 'Y' THEN 1 ELSE 0 END AS Moved,
    ss.StemDescription,
    1 AS IsActive
FROM stable_mpala.viewfulltable v
JOIN stable_mpala.stem ss ON v.StemID = ss.StemID
JOIN id_map_trees t_map ON v.TreeID = t_map.old_TreeID
JOIN id_map_quadrats q_map ON v.QuadratID = q_map.old_QuadratID
JOIN id_map_census c_map ON v.CensusID = c_map.old_CensusID
WHERE v.StemID IS NOT NULL
GROUP BY v.StemID, t_map.new_TreeID, q_map.new_QuadratID, c_map.new_CensusID,
         v.StemTag, ss.QX, ss.QY, ss.Moved, ss.StemDescription
ORDER BY v.StemID;

-- Populate mapping table
INSERT INTO id_map_stems (old_StemID, new_StemGUID)
SELECT DISTINCT
    v.StemID AS old_StemID,
    ns.StemGUID AS new_StemGUID
FROM stable_mpala.viewfulltable v
JOIN stable_mpala.stem ss ON v.StemID = ss.StemID
JOIN id_map_trees t_map ON v.TreeID = t_map.old_TreeID
JOIN id_map_quadrats q_map ON v.QuadratID = q_map.old_QuadratID
JOIN id_map_census c_map ON v.CensusID = c_map.old_CensusID
JOIN stems ns ON
    ns.TreeID = t_map.new_TreeID
    AND ns.QuadratID = q_map.new_QuadratID
    AND ns.CensusID = c_map.new_CensusID
    AND (ns.StemTag = v.StemTag OR (ns.StemTag IS NULL AND v.StemTag IS NULL))
    AND (ns.LocalX = ss.QX OR (ns.LocalX IS NULL AND ss.QX IS NULL))
    AND (ns.LocalY = ss.QY OR (ns.LocalY IS NULL AND ss.QY IS NULL))
WHERE ns.IsActive = 1;

-- Validation query
SELECT
    'Stems Migration Summary' AS Description,
    COUNT(*) AS TotalStemsMigrated,
    COUNT(DISTINCT TreeID) AS UniqueTreesWithStems,
    COUNT(DISTINCT QuadratID) AS QuadratsWithStems,
    SUM(CASE WHEN LocalX IS NOT NULL AND LocalY IS NOT NULL THEN 1 ELSE 0 END) AS StemsWithCoordinates,
    SUM(CASE WHEN LocalX IS NULL OR LocalY IS NULL THEN 1 ELSE 0 END) AS StemsWithoutCoordinates
FROM stems;

SELECT 'Mapping entries created' AS Status, COUNT(*) AS MappingCount FROM id_map_stems;

-- Check stem distribution by quadrat
SELECT
    q.QuadratName,
    p.PlotName,
    COUNT(s.StemGUID) AS StemCount
FROM stems s
JOIN quadrats q ON s.QuadratID = q.QuadratID
JOIN plots p ON q.PlotID = p.PlotID
GROUP BY q.QuadratName, p.PlotName
ORDER BY StemCount DESC
LIMIT 10;

-- Check for stems with missing coordinates
SELECT
    'Stems with missing coordinates' AS Warning,
    COUNT(*) AS Count
FROM stems
WHERE LocalX IS NULL OR LocalY IS NULL;

-- Check for any unmapped stems
SELECT
    'Unmapped Stems' AS Warning,
    COUNT(DISTINCT v.StemID) AS UnmappedCount
FROM stable_mpala.viewfulltable v
LEFT JOIN id_map_stems s_map ON v.StemID = s_map.old_StemID
WHERE v.StemID IS NOT NULL AND s_map.new_StemGUID IS NULL;
