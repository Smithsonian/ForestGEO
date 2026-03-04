-- ================================================================
-- Migration Script 01: Create Mapping Tables
-- ================================================================
-- Purpose: Create temporary tables to track old ID -> new ID mappings
-- These tables are essential for preserving relationships during migration
--
-- IMPORTANT: Trees and Stems are census-specific in the new schema.
-- The mapping tables for these entities must include CensusID as part
-- of the composite primary key to correctly map old IDs to new IDs
-- for each census.
-- ================================================================


-- Drop mapping tables if they exist (for re-running migration)
DROP TABLE IF EXISTS id_map_plots;
DROP TABLE IF EXISTS id_map_quadrats;
DROP TABLE IF EXISTS id_map_family;
DROP TABLE IF EXISTS id_map_genus;
DROP TABLE IF EXISTS id_map_species;
DROP TABLE IF EXISTS id_map_census;
DROP TABLE IF EXISTS id_map_trees;
DROP TABLE IF EXISTS id_map_stems;

-- Plot ID mapping
CREATE TABLE id_map_plots (
    old_PlotID INT,
    new_PlotID INT,
    PRIMARY KEY (old_PlotID),
    INDEX idx_new (new_PlotID)
);

-- Quadrat ID mapping
CREATE TABLE id_map_quadrats (
    old_QuadratID INT,
    new_QuadratID INT,
    PRIMARY KEY (old_QuadratID),
    INDEX idx_new (new_QuadratID)
);

-- Family ID mapping
CREATE TABLE id_map_family (
    old_FamilyID INT,
    new_FamilyID INT,
    PRIMARY KEY (old_FamilyID),
    INDEX idx_new (new_FamilyID)
);

-- Genus ID mapping
CREATE TABLE id_map_genus (
    old_GenusID INT,
    new_GenusID INT,
    PRIMARY KEY (old_GenusID),
    INDEX idx_new (new_GenusID)
);

-- Species ID mapping
CREATE TABLE id_map_species (
    old_SpeciesID INT,
    new_SpeciesID INT,
    old_SubspeciesID INT NULL,
    PRIMARY KEY (old_SpeciesID),
    INDEX idx_new (new_SpeciesID),
    INDEX idx_old_sub (old_SubspeciesID)
);

-- Census ID mapping
CREATE TABLE id_map_census (
    old_CensusID INT,
    new_CensusID INT,
    PRIMARY KEY (old_CensusID),
    INDEX idx_new (new_CensusID)
);

-- Tree ID mapping (CENSUS-AWARE)
-- In the new schema, trees are census-specific: each census has its own tree records.
-- The same physical tree (old_TreeID) may have different new_TreeID values per census.
CREATE TABLE id_map_trees (
    old_TreeID INT,
    old_CensusID INT,
    new_TreeID INT,
    PRIMARY KEY (old_TreeID, old_CensusID),
    INDEX idx_new (new_TreeID),
    INDEX idx_old_tree (old_TreeID),
    INDEX idx_old_census (old_CensusID)
);

-- Stem ID mapping (CENSUS-AWARE)
-- In the new schema, stems are census-specific: each census has its own stem records.
-- The same physical stem (old_StemID) may have different new_StemGUID values per census.
CREATE TABLE id_map_stems (
    old_StemID INT,
    old_CensusID INT,
    new_StemGUID INT,
    PRIMARY KEY (old_StemID, old_CensusID),
    INDEX idx_new (new_StemGUID),
    INDEX idx_old_stem (old_StemID),
    INDEX idx_old_census (old_CensusID)
);

SELECT 'Mapping tables created successfully' AS Status;

-- Verification: Display table structures
SELECT 'id_map_trees structure (census-aware):' AS Info;
DESCRIBE id_map_trees;

SELECT 'id_map_stems structure (census-aware):' AS Info;
DESCRIBE id_map_stems;
