-- ================================================================
-- Migration Script 06: Migrate Trees
-- ================================================================
-- Purpose: Migrate tree data from stable_mpala to forestgeo_testing
-- Links trees to species and census
-- ================================================================

USE forestgeo_testing;

-- Insert trees
-- Note: Each tree has a unique Tag and is associated with a species and census
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
GROUP BY v.TreeID, v.Tag, s_map.new_SpeciesID, c_map.new_CensusID
ORDER BY v.TreeID;

-- Populate mapping table
INSERT INTO id_map_trees (old_TreeID, new_TreeID)
SELECT DISTINCT
    v.TreeID AS old_TreeID,
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
WHERE nt.IsActive = 1;

-- Validation query
SELECT
    'Trees Migration Summary' AS Description,
    COUNT(*) AS TotalTreesMigrated,
    COUNT(DISTINCT SpeciesID) AS UniqueSpecies,
    COUNT(DISTINCT CensusID) AS UniqueCensuses,
    MIN(TreeTag) AS SampleTreeTag
FROM trees;

SELECT 'Mapping entries created' AS Status, COUNT(*) AS MappingCount FROM id_map_trees;

-- Check tree distribution by species
SELECT
    s.SpeciesCode,
    s.SpeciesName,
    COUNT(t.TreeID) AS TreeCount
FROM trees t
JOIN species s ON t.SpeciesID = s.SpeciesID
GROUP BY s.SpeciesCode, s.SpeciesName
ORDER BY TreeCount DESC
LIMIT 10;

-- Check for any unmapped trees
SELECT
    'Unmapped Trees' AS Warning,
    COUNT(DISTINCT v.TreeID) AS UnmappedCount
FROM stable_mpala.viewfulltable v
LEFT JOIN id_map_trees t_map ON v.TreeID = t_map.old_TreeID
WHERE v.TreeID IS NOT NULL AND t_map.new_TreeID IS NULL;
