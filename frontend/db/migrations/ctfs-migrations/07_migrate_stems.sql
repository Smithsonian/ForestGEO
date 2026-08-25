-- ================================================================
-- Migration Script 07: Migrate Stems
-- ================================================================
-- Purpose: Migrate stem data from stable_mpala to forestgeo_testing
-- Uses stable_mpala.stem table for accurate coordinates (QX, QY)
-- Links stems to trees, quadrats, and census
--
-- IMPORTANT: Stems are census-specific in the new schema.
-- Each stem gets a separate record per census, with unique StemGUID.
-- The mapping table tracks (old_StemID, old_CensusID) -> new_StemGUID
--
-- This ensures coremeasurements from each census link to the correct
-- census-specific stem, preventing the RefreshMeasurementsSummary
-- join failures caused by CensusID mismatches.
-- ================================================================


-- Insert stems with coordinates from the stem table
-- Note: Using QX, QY as local coordinates within the quadrat
-- Stems are created per-census, linked to census-specific TreeIDs
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
-- CRITICAL: Join to census-aware tree mapping using BOTH TreeID AND CensusID
JOIN id_map_trees t_map ON v.TreeID = t_map.old_TreeID AND v.CensusID = t_map.old_CensusID
JOIN id_map_quadrats q_map ON v.QuadratID = q_map.old_QuadratID
JOIN id_map_census c_map ON v.CensusID = c_map.old_CensusID
WHERE v.StemID IS NOT NULL
GROUP BY v.StemID, v.CensusID, t_map.new_TreeID, q_map.new_QuadratID, c_map.new_CensusID,
         v.StemTag, ss.QX, ss.QY, ss.Moved, ss.StemDescription;

-- Populate CENSUS-AWARE mapping table
-- Each (old_StemID, old_CensusID) combination maps to a unique new_StemGUID
-- This is CRITICAL for coremeasurements to link to the correct census-specific stem
INSERT INTO id_map_stems (old_StemID, old_CensusID, new_StemGUID)
SELECT
    v.StemID AS old_StemID,
    v.CensusID AS old_CensusID,
    ns.StemGUID AS new_StemGUID
FROM stable_mpala.viewfulltable v
JOIN stable_mpala.stem ss ON v.StemID = ss.StemID
-- CRITICAL: Join to census-aware tree mapping using BOTH TreeID AND CensusID
JOIN id_map_trees t_map ON v.TreeID = t_map.old_TreeID AND v.CensusID = t_map.old_CensusID
JOIN id_map_quadrats q_map ON v.QuadratID = q_map.old_QuadratID
JOIN id_map_census c_map ON v.CensusID = c_map.old_CensusID
JOIN stems ns ON
    ns.TreeID = t_map.new_TreeID
    AND ns.QuadratID = q_map.new_QuadratID
    AND ns.CensusID = c_map.new_CensusID
    AND (ns.StemTag = v.StemTag OR (ns.StemTag IS NULL AND v.StemTag IS NULL))
    AND (ns.LocalX = ss.QX OR (ns.LocalX IS NULL AND ss.QX IS NULL))
    AND (ns.LocalY = ss.QY OR (ns.LocalY IS NULL AND ss.QY IS NULL))
WHERE v.StemID IS NOT NULL
  AND ns.IsActive = 1
GROUP BY v.StemID, v.CensusID, ns.StemGUID;

-- ================================================================
-- Validation Queries
-- ================================================================

-- Summary of migrated stems
SELECT
    'Stems Migration Summary' AS Description,
    COUNT(*) AS TotalStemsMigrated,
    COUNT(DISTINCT TreeID) AS UniqueTreesWithStems,
    COUNT(DISTINCT QuadratID) AS QuadratsWithStems,
    COUNT(DISTINCT CensusID) AS CensusesWithStems,
    SUM(CASE WHEN LocalX IS NOT NULL AND LocalY IS NOT NULL THEN 1 ELSE 0 END) AS StemsWithCoordinates,
    SUM(CASE WHEN LocalX IS NULL OR LocalY IS NULL THEN 1 ELSE 0 END) AS StemsWithoutCoordinates
FROM stems;

-- Mapping entries per census (should match stems per census)
SELECT
    'Mapping entries by census' AS Description,
    old_CensusID,
    COUNT(*) AS MappingCount
FROM id_map_stems
GROUP BY old_CensusID;

-- Stems per census in target table
SELECT
    'Stems by census' AS Description,
    CensusID,
    COUNT(*) AS StemCount
FROM stems
GROUP BY CensusID;

-- Verify mapping completeness: count unique (StemID, CensusID) in source vs mappings
SELECT
    'Source stem-census combinations' AS Description,
    COUNT(DISTINCT CONCAT(StemID, '-', CensusID)) AS SourceCount,
    (SELECT COUNT(*) FROM id_map_stems) AS MappingCount
FROM stable_mpala.viewfulltable
WHERE StemID IS NOT NULL;

-- Check stem distribution by quadrat (top 10)
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

-- Check for any unmapped stem-census combinations
SELECT
    'Unmapped Stem-Census Combinations' AS Warning,
    COUNT(*) AS UnmappedCount
FROM (
    SELECT DISTINCT v.StemID, v.CensusID
    FROM stable_mpala.viewfulltable v
    WHERE v.StemID IS NOT NULL
) src
LEFT JOIN id_map_stems s_map ON src.StemID = s_map.old_StemID AND src.CensusID = s_map.old_CensusID
WHERE s_map.new_StemGUID IS NULL;

-- Verify StemGUID uniqueness in new table
SELECT
    'StemGUID uniqueness check' AS Validation,
    COUNT(*) AS TotalRows,
    COUNT(DISTINCT StemGUID) AS UniqueStemGUIDs,
    CASE WHEN COUNT(*) = COUNT(DISTINCT StemGUID) THEN 'PASS' ELSE 'FAIL' END AS Status
FROM stems;

-- Verify census consistency between stems and their trees
SELECT
    'Stem-Tree Census Consistency' AS Validation,
    COUNT(*) AS TotalStems,
    SUM(CASE WHEN s.CensusID = t.CensusID THEN 1 ELSE 0 END) AS ConsistentCensus,
    SUM(CASE WHEN s.CensusID != t.CensusID THEN 1 ELSE 0 END) AS MismatchedCensus,
    CASE WHEN SUM(CASE WHEN s.CensusID != t.CensusID THEN 1 ELSE 0 END) = 0 THEN 'PASS' ELSE 'FAIL' END AS Status
FROM stems s
JOIN trees t ON s.TreeID = t.TreeID;
