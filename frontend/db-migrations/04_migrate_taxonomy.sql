-- ================================================================
-- Migration Script 04: Migrate Taxonomy (Family -> Genus -> Species)
-- ================================================================
-- Purpose: Migrate taxonomic hierarchy from stable_mpala to forestgeo_testing
-- Migrates in order: family -> genus -> species
-- Handles subspecies by combining with species name
-- ================================================================

USE forestgeo_testing;

-- ================================================================
-- STEP 1: Migrate Family
-- ================================================================
INSERT INTO family (
    Family,
    ReferenceID,
    IsActive
)
SELECT DISTINCT
    v.Family,
    NULL AS ReferenceID,
    1 AS IsActive
FROM stable_mpala.viewfulltable v
WHERE v.Family IS NOT NULL
ORDER BY v.Family;

-- Populate family mapping table
INSERT INTO id_map_family (old_FamilyID, new_FamilyID)
SELECT DISTINCT
    -- Get old FamilyID from a reference table or derive from family name
    sf.FamilyID AS old_FamilyID,
    nf.FamilyID AS new_FamilyID
FROM stable_mpala.family sf
JOIN family nf ON sf.Family = nf.Family
WHERE nf.IsActive = 1;

SELECT 'Family migration complete' AS Status, COUNT(*) AS FamilyCount FROM family;

-- ================================================================
-- STEP 2: Migrate Genus
-- ================================================================
INSERT INTO genus (
    FamilyID,
    Genus,
    ReferenceID,
    GenusAuthority,
    IsActive
)
SELECT DISTINCT
    f_map.new_FamilyID AS FamilyID,
    v.Genus,
    NULL AS ReferenceID,
    NULL AS GenusAuthority,
    1 AS IsActive
FROM stable_mpala.viewfulltable v
JOIN stable_mpala.family sf ON v.Family = sf.Family
JOIN id_map_family f_map ON sf.FamilyID = f_map.old_FamilyID
WHERE v.Genus IS NOT NULL
GROUP BY f_map.new_FamilyID, v.Genus
ORDER BY v.Genus;

-- Populate genus mapping table
INSERT INTO id_map_genus (old_GenusID, new_GenusID)
SELECT DISTINCT
    sg.GenusID AS old_GenusID,
    ng.GenusID AS new_GenusID
FROM stable_mpala.genus sg
JOIN stable_mpala.family sf ON sg.FamilyID = sf.FamilyID
JOIN id_map_family f_map ON sf.FamilyID = f_map.old_FamilyID
JOIN genus ng ON ng.FamilyID = f_map.new_FamilyID AND ng.Genus = sg.Genus
WHERE ng.IsActive = 1;

SELECT 'Genus migration complete' AS Status, COUNT(*) AS GenusCount FROM genus;

-- ================================================================
-- STEP 3: Migrate Species
-- ================================================================
-- Note: Combining SpeciesName and SubspeciesName into the new schema
INSERT INTO species (
    GenusID,
    SpeciesCode,
    SpeciesName,
    SubspeciesName,
    IDLevel,
    IsActive
)
SELECT DISTINCT
    g_map.new_GenusID AS GenusID,
    v.Mnemonic AS SpeciesCode,
    v.SpeciesName,
    v.Subspecies AS SubspeciesName,
    CASE
        WHEN v.Subspecies IS NOT NULL THEN 'subspecies'
        WHEN v.SpeciesName IS NOT NULL THEN 'species'
        WHEN v.Genus IS NOT NULL THEN 'genus'
        ELSE 'family'
    END AS IDLevel,
    1 AS IsActive
FROM stable_mpala.viewfulltable v
JOIN stable_mpala.species ss ON v.SpeciesID = ss.SpeciesID
JOIN stable_mpala.genus sg ON ss.GenusID = sg.GenusID
JOIN id_map_genus g_map ON sg.GenusID = g_map.old_GenusID
WHERE v.SpeciesName IS NOT NULL OR v.Subspecies IS NOT NULL
GROUP BY g_map.new_GenusID, v.Mnemonic, v.SpeciesName, v.Subspecies;

-- Populate species mapping table
-- This is complex because we need to handle both SpeciesID and SubspeciesID
INSERT INTO id_map_species (old_SpeciesID, new_SpeciesID, old_SubspeciesID)
SELECT DISTINCT
    v.SpeciesID AS old_SpeciesID,
    ns.SpeciesID AS new_SpeciesID,
    v.SubspeciesID AS old_SubspeciesID
FROM stable_mpala.viewfulltable v
JOIN stable_mpala.species ss ON v.SpeciesID = ss.SpeciesID
JOIN stable_mpala.genus sg ON ss.GenusID = sg.GenusID
JOIN id_map_genus g_map ON sg.GenusID = g_map.old_GenusID
JOIN species ns ON
    ns.GenusID = g_map.new_GenusID
    AND ns.SpeciesCode = v.Mnemonic
    AND (ns.SpeciesName = v.SpeciesName OR (ns.SpeciesName IS NULL AND v.SpeciesName IS NULL))
    AND (ns.SubspeciesName = v.Subspecies OR (ns.SubspeciesName IS NULL AND v.Subspecies IS NULL))
WHERE ns.IsActive = 1;

SELECT 'Species migration complete' AS Status, COUNT(*) AS SpeciesCount FROM species;

-- ================================================================
-- Validation Queries
-- ================================================================
SELECT
    'Taxonomy Migration Summary' AS Description,
    (SELECT COUNT(*) FROM family) AS TotalFamilies,
    (SELECT COUNT(*) FROM genus) AS TotalGenera,
    (SELECT COUNT(*) FROM species) AS TotalSpecies;

SELECT
    'Mapping Summary' AS Description,
    (SELECT COUNT(*) FROM id_map_family) AS FamilyMappings,
    (SELECT COUNT(*) FROM id_map_genus) AS GenusMappings,
    (SELECT COUNT(*) FROM id_map_species) AS SpeciesMappings;

-- Verify taxonomic hierarchy
SELECT
    'Verify hierarchy' AS Check_Type,
    f.Family,
    g.Genus,
    s.SpeciesName,
    s.SubspeciesName,
    s.SpeciesCode
FROM species s
JOIN genus g ON s.GenusID = g.GenusID
JOIN family f ON g.FamilyID = f.FamilyID
LIMIT 10;
