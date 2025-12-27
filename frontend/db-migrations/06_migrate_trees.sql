-- ================================================================
-- Migration Script 06: Migrate Trees
-- ================================================================
-- Purpose: Migrate tree data from stable_mpala to forestgeo_testing
-- Links trees to species and census
--
-- IMPORTANT: Trees are census-specific in the new schema.
-- Each tree gets a separate record per census, with unique TreeID.
-- The mapping table tracks (old_TreeID, old_CensusID) -> new_TreeID
-- ================================================================


-- Insert trees
-- Note: Each tree has a unique Tag and is associated with a species and census
-- Trees are created per-census, so the same physical tree will have multiple records
INSERT INTO trees (
    TreeTag,
    SpeciesID,
    CensusID,
    IsActive
)
SELECT DISTINCT
    v.Tag AS TreeTag,
    s_map.new_SpeciesID AS SpeciesID,
    c_map.new_CensusID AS CensusID,
    1 AS IsActive
FROM stable_mpala.viewfulltable v
JOIN id_map_species s_map ON
    v.SpeciesID = s_map.old_SpeciesID
    AND (v.SubspeciesID = s_map.old_SubspeciesID OR (v.SubspeciesID IS NULL AND s_map.old_SubspeciesID IS NULL))
JOIN id_map_census c_map ON v.CensusID = c_map.old_CensusID
WHERE v.Tag IS NOT NULL AND v.TreeID IS NOT NULL
GROUP BY v.TreeID, v.Tag, s_map.new_SpeciesID, c_map.new_CensusID;

-- Populate CENSUS-AWARE mapping table
-- Each (old_TreeID, old_CensusID) combination maps to a unique new_TreeID
-- This ensures measurements from each census link to the correct census-specific tree
INSERT INTO id_map_trees (old_TreeID, old_CensusID, new_TreeID)
SELECT
    v.TreeID AS old_TreeID,
    v.CensusID AS old_CensusID,
    nt.TreeID AS new_TreeID
FROM stable_mpala.viewfulltable v
JOIN id_map_species s_map ON
    v.SpeciesID = s_map.old_SpeciesID
    AND (v.SubspeciesID = s_map.old_SubspeciesID OR (v.SubspeciesID IS NULL AND s_map.old_SubspeciesID IS NULL))
JOIN id_map_census c_map ON v.CensusID = c_map.old_CensusID
JOIN trees nt ON
    nt.TreeTag = v.Tag
    AND nt.SpeciesID = s_map.new_SpeciesID
    AND nt.CensusID = c_map.new_CensusID
WHERE v.TreeID IS NOT NULL
  AND v.Tag IS NOT NULL
  AND nt.IsActive = 1
GROUP BY v.TreeID, v.CensusID, nt.TreeID;

-- ================================================================
-- Validation Queries
-- ================================================================

-- Summary of migrated trees
SELECT
    'Trees Migration Summary' AS Description,
    COUNT(*) AS TotalTreesMigrated,
    COUNT(DISTINCT SpeciesID) AS UniqueSpecies,
    COUNT(DISTINCT CensusID) AS UniqueCensuses,
    MIN(TreeTag) AS SampleTreeTag
FROM trees;

-- Mapping entries per census (should match trees per census)
SELECT
    'Mapping entries by census' AS Description,
    old_CensusID,
    COUNT(*) AS MappingCount
FROM id_map_trees
GROUP BY old_CensusID;

-- Verify mapping completeness: count unique (TreeID, CensusID) in source vs mappings
SELECT
    'Source tree-census combinations' AS Description,
    COUNT(DISTINCT CONCAT(TreeID, '-', CensusID)) AS SourceCount,
    (SELECT COUNT(*) FROM id_map_trees) AS MappingCount
FROM stable_mpala.viewfulltable
WHERE TreeID IS NOT NULL AND Tag IS NOT NULL;

-- Check tree distribution by census
SELECT
    c.CensusID,
    c.PlotCensusNumber,
    COUNT(t.TreeID) AS TreeCount
FROM trees t
JOIN census c ON t.CensusID = c.CensusID
GROUP BY c.CensusID, c.PlotCensusNumber
ORDER BY c.CensusID;

-- Check tree distribution by species (top 10)
SELECT
    s.SpeciesCode,
    s.SpeciesName,
    COUNT(t.TreeID) AS TreeCount
FROM trees t
JOIN species s ON t.SpeciesID = s.SpeciesID
GROUP BY s.SpeciesCode, s.SpeciesName
ORDER BY TreeCount DESC
LIMIT 10;

-- Check for any unmapped tree-census combinations
SELECT
    'Unmapped Tree-Census Combinations' AS Warning,
    COUNT(*) AS UnmappedCount
FROM (
    SELECT DISTINCT v.TreeID, v.CensusID
    FROM stable_mpala.viewfulltable v
    WHERE v.TreeID IS NOT NULL AND v.Tag IS NOT NULL
) src
LEFT JOIN id_map_trees t_map ON src.TreeID = t_map.old_TreeID AND src.CensusID = t_map.old_CensusID
WHERE t_map.new_TreeID IS NULL;

-- Verify TreeID uniqueness in new table
SELECT
    'TreeID uniqueness check' AS Validation,
    COUNT(*) AS TotalRows,
    COUNT(DISTINCT TreeID) AS UniqueTreeIDs,
    CASE WHEN COUNT(*) = COUNT(DISTINCT TreeID) THEN 'PASS' ELSE 'FAIL' END AS Status
FROM trees;
