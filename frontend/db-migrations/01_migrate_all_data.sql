-- =====================================================================================
-- Consolidated Data Migration Script
-- =====================================================================================
-- Purpose: Migrate all data from source (stable_*) schema to target (forestgeo_*) schema
-- This consolidates scripts 01-09 into a single atomic migration with checkpointing
--
-- Prerequisites:
--   1. Run 00_migration_framework.sql first
--   2. Call migration_init() with your parameters
--   3. Source schema must exist with viewfulltable
--
-- Usage:
--   -- First, initialize the migration:
--   CALL migration_init('stable_mpala', 'forestgeo_mpala', 'Mpala', 'Mpala', 'Kenya');
--   -- Then run this script
--
-- Note: Uses @source_schema variable set by the orchestration script
--       Falls back to migration_config table if not set
-- =====================================================================================

-- =====================================================================================
-- CONFIGURATION: Get parameters from migration_config or use defaults
-- =====================================================================================

SET @source_schema = COALESCE(@source_schema, (SELECT config_value FROM migration_config WHERE config_key = 'source_schema'));
SET @location_name = COALESCE(@location_name, (SELECT config_value FROM migration_config WHERE config_key = 'location_name'), 'Unknown');
SET @country_name = COALESCE(@country_name, (SELECT config_value FROM migration_config WHERE config_key = 'country_name'), 'Unknown');

-- Validate configuration
SELECT CASE WHEN @source_schema IS NULL
    THEN 'ERROR: @source_schema not set. Run migration_init() first or SET @source_schema = "your_schema"'
    ELSE CONCAT('Migrating from: ', @source_schema)
END AS configuration_status;

-- =====================================================================================
-- STEP 1: Create Mapping Tables (Census-Aware)
-- =====================================================================================

CALL migration_step_start('01_create_mapping_tables');

-- Only proceed if not skipped
SET @do_step_1 = (@migration_skip_step = 0);

-- Plot ID mapping
DROP TABLE IF EXISTS id_map_plots;
CREATE TABLE IF NOT EXISTS id_map_plots (
    old_PlotID INT PRIMARY KEY,
    new_PlotID INT NOT NULL,
    INDEX idx_new (new_PlotID)
);

-- Quadrat ID mapping
DROP TABLE IF EXISTS id_map_quadrats;
CREATE TABLE IF NOT EXISTS id_map_quadrats (
    old_QuadratID INT PRIMARY KEY,
    new_QuadratID INT NOT NULL,
    INDEX idx_new (new_QuadratID)
);

-- Family ID mapping
DROP TABLE IF EXISTS id_map_family;
CREATE TABLE IF NOT EXISTS id_map_family (
    old_FamilyID INT PRIMARY KEY,
    new_FamilyID INT NOT NULL,
    INDEX idx_new (new_FamilyID)
);

-- Genus ID mapping
DROP TABLE IF EXISTS id_map_genus;
CREATE TABLE IF NOT EXISTS id_map_genus (
    old_GenusID INT PRIMARY KEY,
    new_GenusID INT NOT NULL,
    INDEX idx_new (new_GenusID)
);

-- Species ID mapping (includes subspecies tracking)
DROP TABLE IF EXISTS id_map_species;
CREATE TABLE IF NOT EXISTS id_map_species (
    old_SpeciesID INT PRIMARY KEY,
    new_SpeciesID INT NOT NULL,
    old_SubspeciesID INT NULL,
    INDEX idx_new (new_SpeciesID),
    INDEX idx_subspecies (old_SubspeciesID)
);

-- Census ID mapping
DROP TABLE IF EXISTS id_map_census;
CREATE TABLE IF NOT EXISTS id_map_census (
    old_CensusID INT PRIMARY KEY,
    new_CensusID INT NOT NULL,
    INDEX idx_new (new_CensusID)
);

-- Tree ID mapping (CENSUS-AWARE: composite key)
DROP TABLE IF EXISTS id_map_trees;
CREATE TABLE IF NOT EXISTS id_map_trees (
    old_TreeID INT,
    old_CensusID INT,
    new_TreeID INT NOT NULL,
    PRIMARY KEY (old_TreeID, old_CensusID),
    INDEX idx_new (new_TreeID),
    INDEX idx_old_tree (old_TreeID),
    INDEX idx_old_census (old_CensusID)
);

-- Stem ID mapping (CENSUS-AWARE: composite key)
DROP TABLE IF EXISTS id_map_stems;
CREATE TABLE IF NOT EXISTS id_map_stems (
    old_StemID INT,
    old_CensusID INT,
    new_StemGUID INT NOT NULL,
    PRIMARY KEY (old_StemID, old_CensusID),
    INDEX idx_new (new_StemGUID),
    INDEX idx_old_stem (old_StemID),
    INDEX idx_old_census (old_CensusID)
);

CALL migration_step_complete('01_create_mapping_tables', 8);

-- =====================================================================================
-- STEP 2: Migrate Plots
-- =====================================================================================

CALL migration_step_start('02_migrate_plots');

-- Pre-calculate plot dimensions from coordinate extents
DROP TEMPORARY TABLE IF EXISTS plot_dimensions;
SET @sql = CONCAT('
CREATE TEMPORARY TABLE plot_dimensions AS
SELECT
    q.PlotID,
    COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0) AS DimensionX,
    COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0) AS DimensionY,
    (COALESCE(MAX(co.PX), 0) - COALESCE(MIN(co.PX), 0)) *
    (COALESCE(MAX(co.PY), 0) - COALESCE(MIN(co.PY), 0)) AS Area
FROM ', @source_schema, '.coordinates co
JOIN ', @source_schema, '.quadrat q ON co.QuadratID = q.QuadratID
GROUP BY q.PlotID
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE INDEX idx_plot_dimensions_plotid ON plot_dimensions(PlotID);

-- Insert plots with parameterized location/country
SET foreign_key_checks = 0;
SET @sql = CONCAT('
INSERT INTO plots (
    PlotName, LocationName, CountryName, DimensionX, DimensionY, Area,
    PlotDescription, DefaultDimensionUnits, DefaultCoordinateUnits,
    DefaultAreaUnits, DefaultDBHUnits, DefaultHOMUnits
)
SELECT DISTINCT
    v.PlotName,
    ''', @location_name, ''' AS LocationName,
    ''', @country_name, ''' AS CountryName,
    LEAST(COALESCE(pd.DimensionX, 0), 999999.999999) AS DimensionX,
    LEAST(COALESCE(pd.DimensionY, 0), 999999.999999) AS DimensionY,
    LEAST(COALESCE(pd.Area, 0), 999999.999999) AS Area,
    ''Migrated from ', @source_schema, ''' AS PlotDescription,
    ''m'' AS DefaultDimensionUnits,
    ''m'' AS DefaultCoordinateUnits,
    ''m2'' AS DefaultAreaUnits,
    ''mm'' AS DefaultDBHUnits,
    ''m'' AS DefaultHOMUnits
FROM ', @source_schema, '.viewfulltable v
LEFT JOIN plot_dimensions pd ON v.PlotID = pd.PlotID
GROUP BY v.PlotID, v.PlotName, pd.DimensionX, pd.DimensionY, pd.Area
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
SET @plots_inserted = ROW_COUNT();
DEALLOCATE PREPARE stmt;
SET foreign_key_checks = 1;

-- Populate plot mapping
SET @sql = CONCAT('
INSERT INTO id_map_plots (old_PlotID, new_PlotID)
SELECT DISTINCT source.PlotID AS old_PlotID, p.PlotID AS new_PlotID
FROM (SELECT DISTINCT PlotID, PlotName FROM ', @source_schema, '.viewfulltable) AS source
JOIN plots p ON source.PlotName = p.PlotName
WHERE p.PlotDescription LIKE ''Migrated from ', @source_schema, '%''
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP TEMPORARY TABLE IF EXISTS plot_dimensions;
CALL migration_step_complete('02_migrate_plots', @plots_inserted);

-- =====================================================================================
-- STEP 3: Migrate Quadrats
-- =====================================================================================

CALL migration_step_start('03_migrate_quadrats');

-- Pre-calculate quadrat coordinates
DROP TEMPORARY TABLE IF EXISTS quadrat_coords;
SET @sql = CONCAT('
CREATE TEMPORARY TABLE quadrat_coords AS
SELECT QuadratID, MIN(PX) AS StartX, MIN(PY) AS StartY
FROM ', @source_schema, '.coordinates
GROUP BY QuadratID
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE INDEX idx_quadrat_coords_id ON quadrat_coords(QuadratID);

-- Insert quadrats
SET @sql = CONCAT('
INSERT INTO quadrats (
    PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY,
    Area, QuadratShape, IsActive
)
SELECT DISTINCT
    p_map.new_PlotID AS PlotID,
    v.QuadratName,
    COALESCE(qc.StartX, 0) AS StartX,
    COALESCE(qc.StartY, 0) AS StartY,
    20 AS DimensionX,
    20 AS DimensionY,
    400 AS Area,
    ''square'' AS QuadratShape,
    1 AS IsActive
FROM ', @source_schema, '.viewfulltable v
JOIN id_map_plots p_map ON v.PlotID = p_map.old_PlotID
LEFT JOIN quadrat_coords qc ON v.QuadratID = qc.QuadratID
WHERE v.QuadratName IS NOT NULL
GROUP BY v.QuadratID, v.QuadratName, p_map.new_PlotID, qc.StartX, qc.StartY
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
SET @quadrats_inserted = ROW_COUNT();
DEALLOCATE PREPARE stmt;

-- Populate quadrat mapping
SET @sql = CONCAT('
INSERT INTO id_map_quadrats (old_QuadratID, new_QuadratID)
SELECT DISTINCT source.QuadratID AS old_QuadratID, q.QuadratID AS new_QuadratID
FROM (
    SELECT DISTINCT v.QuadratID, v.QuadratName, p_map.new_PlotID
    FROM ', @source_schema, '.viewfulltable v
    JOIN id_map_plots p_map ON v.PlotID = p_map.old_PlotID
    WHERE v.QuadratName IS NOT NULL
) AS source
JOIN quadrats q ON q.PlotID = source.new_PlotID AND q.QuadratName = source.QuadratName
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP TEMPORARY TABLE IF EXISTS quadrat_coords;
CALL migration_step_complete('03_migrate_quadrats', @quadrats_inserted);

-- =====================================================================================
-- STEP 4: Migrate Taxonomy (Family -> Genus -> Species)
-- =====================================================================================

CALL migration_step_start('04_migrate_taxonomy');

-- 4a: Migrate Family
SET @sql = CONCAT('
INSERT INTO family (Family, ReferenceID, IsActive)
SELECT DISTINCT v.Family, NULL AS ReferenceID, 1 AS IsActive
FROM ', @source_schema, '.viewfulltable v
WHERE v.Family IS NOT NULL
ORDER BY v.Family
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
SET @families_inserted = ROW_COUNT();
DEALLOCATE PREPARE stmt;

-- Family mapping
SET @sql = CONCAT('
INSERT INTO id_map_family (old_FamilyID, new_FamilyID)
SELECT DISTINCT sf.FamilyID AS old_FamilyID, nf.FamilyID AS new_FamilyID
FROM ', @source_schema, '.family sf
JOIN family nf ON sf.Family = nf.Family
WHERE nf.IsActive = 1
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4b: Migrate Genus
SET @sql = CONCAT('
INSERT INTO genus (FamilyID, Genus, ReferenceID, GenusAuthority, IsActive)
SELECT DISTINCT
    f_map.new_FamilyID AS FamilyID,
    v.Genus,
    NULL AS ReferenceID,
    NULL AS GenusAuthority,
    1 AS IsActive
FROM ', @source_schema, '.viewfulltable v
JOIN ', @source_schema, '.family sf ON v.Family = sf.Family
JOIN id_map_family f_map ON sf.FamilyID = f_map.old_FamilyID
WHERE v.Genus IS NOT NULL
GROUP BY f_map.new_FamilyID, v.Genus
ORDER BY v.Genus
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
SET @genera_inserted = ROW_COUNT();
DEALLOCATE PREPARE stmt;

-- Genus mapping
SET @sql = CONCAT('
INSERT INTO id_map_genus (old_GenusID, new_GenusID)
SELECT DISTINCT sg.GenusID AS old_GenusID, ng.GenusID AS new_GenusID
FROM ', @source_schema, '.genus sg
JOIN ', @source_schema, '.family sf ON sg.FamilyID = sf.FamilyID
JOIN id_map_family f_map ON sf.FamilyID = f_map.old_FamilyID
JOIN genus ng ON ng.FamilyID = f_map.new_FamilyID AND ng.Genus = sg.Genus
WHERE ng.IsActive = 1
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4c: Migrate Species
SET @sql = CONCAT('
INSERT INTO species (GenusID, SpeciesCode, SpeciesName, SubspeciesName, IDLevel, IsActive)
SELECT DISTINCT
    g_map.new_GenusID AS GenusID,
    v.Mnemonic AS SpeciesCode,
    v.SpeciesName,
    v.Subspecies AS SubspeciesName,
    CASE
        WHEN v.Subspecies IS NOT NULL THEN ''subspecies''
        WHEN v.SpeciesName IS NOT NULL THEN ''species''
        WHEN v.Genus IS NOT NULL THEN ''genus''
        ELSE ''family''
    END AS IDLevel,
    1 AS IsActive
FROM ', @source_schema, '.viewfulltable v
JOIN ', @source_schema, '.species ss ON v.SpeciesID = ss.SpeciesID
JOIN ', @source_schema, '.genus sg ON ss.GenusID = sg.GenusID
JOIN id_map_genus g_map ON sg.GenusID = g_map.old_GenusID
WHERE v.SpeciesName IS NOT NULL OR v.Subspecies IS NOT NULL
GROUP BY g_map.new_GenusID, v.Mnemonic, v.SpeciesName, v.Subspecies, v.Genus
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
SET @species_inserted = ROW_COUNT();
DEALLOCATE PREPARE stmt;

-- Species mapping
SET @sql = CONCAT('
INSERT INTO id_map_species (old_SpeciesID, new_SpeciesID, old_SubspeciesID)
SELECT
    v.SpeciesID AS old_SpeciesID,
    MIN(ns.SpeciesID) AS new_SpeciesID,
    MIN(v.SubspeciesID) AS old_SubspeciesID
FROM ', @source_schema, '.viewfulltable v
JOIN ', @source_schema, '.species ss ON v.SpeciesID = ss.SpeciesID
JOIN ', @source_schema, '.genus sg ON ss.GenusID = sg.GenusID
JOIN id_map_genus g_map ON sg.GenusID = g_map.old_GenusID
JOIN species ns ON
    ns.GenusID = g_map.new_GenusID
    AND ns.SpeciesCode = v.Mnemonic
    AND (ns.SpeciesName = v.SpeciesName OR (ns.SpeciesName IS NULL AND v.SpeciesName IS NULL))
    AND (ns.SubspeciesName = v.Subspecies OR (ns.SubspeciesName IS NULL AND v.Subspecies IS NULL))
WHERE ns.IsActive = 1
GROUP BY v.SpeciesID
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @taxonomy_total = @families_inserted + @genera_inserted + @species_inserted;
CALL migration_step_complete('04_migrate_taxonomy', @taxonomy_total);

-- =====================================================================================
-- STEP 5: Migrate Census
-- =====================================================================================

CALL migration_step_start('05_migrate_census');

-- Store and modify SQL mode to handle zero dates
SET @original_sql_mode = @@sql_mode;
SET sql_mode = (SELECT REPLACE(@@sql_mode, 'NO_ZERO_DATE,', ''));
SET sql_mode = (SELECT REPLACE(@@sql_mode, 'NO_ZERO_IN_DATE,', ''));
SET sql_mode = (SELECT REPLACE(@@sql_mode, 'STRICT_TRANS_TABLES,', ''));

SET @sql = CONCAT('
INSERT INTO census (PlotID, StartDate, EndDate, Description, PlotCensusNumber, IsActive)
SELECT DISTINCT
    p_map.new_PlotID AS PlotID,
    NULLIF(sc.StartDate, ''0000-00-00'') AS StartDate,
    NULLIF(sc.EndDate, ''0000-00-00'') AS EndDate,
    sc.Description,
    sc.PlotCensusNumber,
    1 AS IsActive
FROM ', @source_schema, '.census sc
JOIN id_map_plots p_map ON sc.PlotID = p_map.old_PlotID
ORDER BY sc.PlotCensusNumber
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
SET @census_inserted = ROW_COUNT();
DEALLOCATE PREPARE stmt;

SET sql_mode = @original_sql_mode;

-- Census mapping
SET @sql = CONCAT('
INSERT INTO id_map_census (old_CensusID, new_CensusID)
SELECT DISTINCT sc.CensusID AS old_CensusID, nc.CensusID AS new_CensusID
FROM ', @source_schema, '.census sc
JOIN id_map_plots p_map ON sc.PlotID = p_map.old_PlotID
JOIN census nc ON nc.PlotID = p_map.new_PlotID AND nc.PlotCensusNumber = sc.PlotCensusNumber
WHERE nc.IsActive = 1
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CALL migration_step_complete('05_migrate_census', @census_inserted);

-- =====================================================================================
-- STEP 6: Migrate Trees (Census-Aware)
-- =====================================================================================

CALL migration_step_start('06_migrate_trees');

-- Insert trees: each tree gets a record per census it appears in
SET @sql = CONCAT('
INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive)
SELECT DISTINCT
    v.Tag AS TreeTag,
    s_map.new_SpeciesID AS SpeciesID,
    c_map.new_CensusID AS CensusID,
    1 AS IsActive
FROM ', @source_schema, '.viewfulltable v
JOIN id_map_species s_map ON
    v.SpeciesID = s_map.old_SpeciesID
    AND (v.SubspeciesID = s_map.old_SubspeciesID OR (v.SubspeciesID IS NULL AND s_map.old_SubspeciesID IS NULL))
JOIN id_map_census c_map ON v.CensusID = c_map.old_CensusID
WHERE v.Tag IS NOT NULL AND v.TreeID IS NOT NULL
GROUP BY v.TreeID, v.Tag, s_map.new_SpeciesID, c_map.new_CensusID
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
SET @trees_inserted = ROW_COUNT();
DEALLOCATE PREPARE stmt;

-- Populate CENSUS-AWARE tree mapping
SET @sql = CONCAT('
INSERT INTO id_map_trees (old_TreeID, old_CensusID, new_TreeID)
SELECT
    v.TreeID AS old_TreeID,
    v.CensusID AS old_CensusID,
    nt.TreeID AS new_TreeID
FROM ', @source_schema, '.viewfulltable v
JOIN id_map_species s_map ON
    v.SpeciesID = s_map.old_SpeciesID
    AND (v.SubspeciesID = s_map.old_SubspeciesID OR (v.SubspeciesID IS NULL AND s_map.old_SubspeciesID IS NULL))
JOIN id_map_census c_map ON v.CensusID = c_map.old_CensusID
JOIN trees nt ON
    nt.TreeTag = v.Tag
    AND nt.SpeciesID = s_map.new_SpeciesID
    AND nt.CensusID = c_map.new_CensusID
WHERE v.TreeID IS NOT NULL AND v.Tag IS NOT NULL AND nt.IsActive = 1
GROUP BY v.TreeID, v.CensusID, nt.TreeID
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CALL migration_step_complete('06_migrate_trees', @trees_inserted);

-- =====================================================================================
-- STEP 7: Migrate Stems (Census-Aware)
-- =====================================================================================

CALL migration_step_start('07_migrate_stems');

-- Insert stems with coordinates from stem table
SET @sql = CONCAT('
INSERT INTO stems (
    TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY,
    Moved, StemDescription, IsActive
)
SELECT DISTINCT
    t_map.new_TreeID AS TreeID,
    q_map.new_QuadratID AS QuadratID,
    c_map.new_CensusID AS CensusID,
    v.StemTag,
    ss.QX AS LocalX,
    ss.QY AS LocalY,
    CASE WHEN ss.Moved = ''Y'' THEN 1 ELSE 0 END AS Moved,
    ss.StemDescription,
    1 AS IsActive
FROM ', @source_schema, '.viewfulltable v
JOIN ', @source_schema, '.stem ss ON v.StemID = ss.StemID
-- CRITICAL: Census-aware tree mapping
JOIN id_map_trees t_map ON v.TreeID = t_map.old_TreeID AND v.CensusID = t_map.old_CensusID
JOIN id_map_quadrats q_map ON v.QuadratID = q_map.old_QuadratID
JOIN id_map_census c_map ON v.CensusID = c_map.old_CensusID
WHERE v.StemID IS NOT NULL
GROUP BY v.StemID, v.CensusID, t_map.new_TreeID, q_map.new_QuadratID, c_map.new_CensusID,
         v.StemTag, ss.QX, ss.QY, ss.Moved, ss.StemDescription
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
SET @stems_inserted = ROW_COUNT();
DEALLOCATE PREPARE stmt;

-- Populate CENSUS-AWARE stem mapping
SET @sql = CONCAT('
INSERT INTO id_map_stems (old_StemID, old_CensusID, new_StemGUID)
SELECT
    v.StemID AS old_StemID,
    v.CensusID AS old_CensusID,
    ns.StemGUID AS new_StemGUID
FROM ', @source_schema, '.viewfulltable v
JOIN ', @source_schema, '.stem ss ON v.StemID = ss.StemID
-- CRITICAL: Census-aware tree mapping
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
WHERE v.StemID IS NOT NULL AND ns.IsActive = 1
GROUP BY v.StemID, v.CensusID, ns.StemGUID
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CALL migration_step_complete('07_migrate_stems', @stems_inserted);

-- =====================================================================================
-- STEP 7b: Populate StemCrossID (Census-by-Census Sequential Processing)
-- =====================================================================================
-- Purpose: Link stems across censuses to track the same physical stem over time
-- Algorithm: Exactly mirrors bulkingestionprocess stored procedure logic
--   - Process censuses in order (earliest first)
--   - For first-census stems: StemCrossID = StemGUID (self-reference)
--   - For later-census stems: Inherit StemCrossID from most recent previous census
--     stem with matching TreeTag + StemTag, or self-reference if no match
-- =====================================================================================

CALL migration_step_start('07b_populate_stemcrossid');

SELECT '=== POPULATING StemCrossID (Census-by-Census) ===' AS Section;

-- Get ordered list of censuses
DROP TEMPORARY TABLE IF EXISTS ordered_censuses;
CREATE TEMPORARY TABLE ordered_censuses AS
SELECT CensusID, PlotCensusNumber, ROW_NUMBER() OVER (ORDER BY PlotCensusNumber) AS census_order
FROM census
WHERE IsActive = 1
ORDER BY PlotCensusNumber;

CREATE INDEX idx_oc_order ON ordered_censuses(census_order);
CREATE INDEX idx_oc_censusid ON ordered_censuses(CensusID);

SELECT COUNT(*) INTO @total_censuses FROM ordered_censuses;
SELECT CONCAT('Processing ', @total_censuses, ' censuses in order...') AS Status;

-- Initialize counters for validation
SET @total_stems_updated = 0;
SET @self_referenced_stems = 0;
SET @inherited_stems = 0;

-- Process each census in order
SET @current_order = 1;

WHILE @current_order <= @total_censuses DO
    -- Get current census ID
    SELECT CensusID, PlotCensusNumber INTO @current_census_id, @current_census_number
    FROM ordered_censuses
    WHERE census_order = @current_order;

    SELECT CONCAT('  Processing Census ', @current_census_number, ' (CensusID: ', @current_census_id, ')...') AS Progress;

    -- Count stems in this census before update
    SELECT COUNT(*) INTO @stems_in_census
    FROM stems WHERE CensusID = @current_census_id AND StemCrossID IS NULL;

    IF @current_order = 1 THEN
        -- First census: All stems get StemCrossID = StemGUID (self-reference)
        UPDATE stems
        SET StemCrossID = StemGUID
        WHERE CensusID = @current_census_id AND StemCrossID IS NULL;

        SET @updated_count = ROW_COUNT();
        SET @self_referenced_stems = @self_referenced_stems + @updated_count;
        SET @total_stems_updated = @total_stems_updated + @updated_count;

        SELECT CONCAT('    First census: ', @updated_count, ' stems set to self-reference') AS Result;
    ELSE
        -- Later censuses: Find matching stem from previous census and inherit StemCrossID
        -- This exactly mirrors the stored procedure logic

        -- Create temporary mapping table for this census
        DROP TEMPORARY TABLE IF EXISTS stem_crossid_mapping;
        CREATE TEMPORARY TABLE stem_crossid_mapping AS
        SELECT
            s_curr.StemGUID AS CurrentStemGUID,
            COALESCE(
                (
                    SELECT s_prev.StemCrossID
                    FROM stems s_prev
                    INNER JOIN trees t_prev ON s_prev.TreeID = t_prev.TreeID
                    INNER JOIN trees t_curr ON t_curr.TreeID = s_curr.TreeID
                    WHERE t_prev.TreeTag = t_curr.TreeTag
                      AND s_prev.StemTag = s_curr.StemTag
                      AND t_prev.CensusID < @current_census_id
                      AND t_prev.IsActive = 1
                      AND s_prev.IsActive = 1
                      AND s_prev.StemCrossID IS NOT NULL
                    ORDER BY t_prev.CensusID DESC
                    LIMIT 1
                ),
                s_curr.StemGUID  -- Fallback to self-reference if no previous match
            ) AS NewStemCrossID,
            CASE
                WHEN (
                    SELECT s_prev.StemCrossID
                    FROM stems s_prev
                    INNER JOIN trees t_prev ON s_prev.TreeID = t_prev.TreeID
                    INNER JOIN trees t_curr ON t_curr.TreeID = s_curr.TreeID
                    WHERE t_prev.TreeTag = t_curr.TreeTag
                      AND s_prev.StemTag = s_curr.StemTag
                      AND t_prev.CensusID < @current_census_id
                      AND t_prev.IsActive = 1
                      AND s_prev.IsActive = 1
                      AND s_prev.StemCrossID IS NOT NULL
                    ORDER BY t_prev.CensusID DESC
                    LIMIT 1
                ) IS NOT NULL THEN 'inherited'
                ELSE 'self'
            END AS LinkType
        FROM stems s_curr
        WHERE s_curr.CensusID = @current_census_id
          AND s_curr.StemCrossID IS NULL
          AND s_curr.IsActive = 1;

        CREATE INDEX idx_scm_stemguid ON stem_crossid_mapping(CurrentStemGUID);

        -- Count inherited vs self-referenced
        SELECT COUNT(*) INTO @inherited_count FROM stem_crossid_mapping WHERE LinkType = 'inherited';
        SELECT COUNT(*) INTO @self_count FROM stem_crossid_mapping WHERE LinkType = 'self';

        -- Apply the mapping
        UPDATE stems s
        INNER JOIN stem_crossid_mapping scm ON s.StemGUID = scm.CurrentStemGUID
        SET s.StemCrossID = scm.NewStemCrossID;

        SET @updated_count = ROW_COUNT();
        SET @inherited_stems = @inherited_stems + @inherited_count;
        SET @self_referenced_stems = @self_referenced_stems + @self_count;
        SET @total_stems_updated = @total_stems_updated + @updated_count;

        SELECT CONCAT('    Census ', @current_census_number, ': ', @updated_count, ' stems updated (',
                      @inherited_count, ' inherited, ', @self_count, ' new stems)') AS Result;

        DROP TEMPORARY TABLE IF EXISTS stem_crossid_mapping;
    END IF;

    SET @current_order = @current_order + 1;
END WHILE;

DROP TEMPORARY TABLE IF EXISTS ordered_censuses;

SELECT CONCAT('StemCrossID population complete: ', @total_stems_updated, ' stems updated') AS Summary;

-- =====================================================================================
-- StemCrossID VALIDATION
-- =====================================================================================

SELECT '=== StemCrossID VALIDATION ===' AS Section;

-- Initialize validation error counters
SET @v_null_stemcrossid = 0;
SET @v_invalid_reference = 0;
SET @v_census1_not_self = 0;
SET @v_broken_chain = 0;

-- Validation 1: Check for NULL StemCrossID values (should be zero)
SELECT COUNT(*) INTO @v_null_stemcrossid
FROM stems WHERE StemCrossID IS NULL AND IsActive = 1;

SELECT CASE WHEN @v_null_stemcrossid > 0
    THEN CONCAT('CRITICAL: ', @v_null_stemcrossid, ' active stems have NULL StemCrossID')
    ELSE CONCAT('OK: All ', (SELECT COUNT(*) FROM stems WHERE IsActive = 1), ' active stems have StemCrossID populated')
END AS Validation_NullCheck;

-- Validation 2: Check that all StemCrossID values reference valid StemGUIDs
SELECT COUNT(*) INTO @v_invalid_reference
FROM stems s
WHERE s.StemCrossID IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM stems s2 WHERE s2.StemGUID = s.StemCrossID);

SELECT CASE WHEN @v_invalid_reference > 0
    THEN CONCAT('CRITICAL: ', @v_invalid_reference, ' stems have StemCrossID pointing to non-existent StemGUID')
    ELSE 'OK: All StemCrossID values reference valid stems'
END AS Validation_ValidReference;

-- Validation 3: First census stems should have StemCrossID = StemGUID
SELECT MIN(PlotCensusNumber) INTO @first_census_number FROM census WHERE IsActive = 1;
SELECT CensusID INTO @first_census_id FROM census WHERE PlotCensusNumber = @first_census_number AND IsActive = 1 LIMIT 1;

SELECT COUNT(*) INTO @v_census1_not_self
FROM stems
WHERE CensusID = @first_census_id
  AND IsActive = 1
  AND StemCrossID != StemGUID;

SELECT CASE WHEN @v_census1_not_self > 0
    THEN CONCAT('WARNING: ', @v_census1_not_self, ' first-census stems have StemCrossID != StemGUID')
    ELSE 'OK: All first-census stems correctly self-reference'
END AS Validation_FirstCensus;

-- Validation 4: Check for broken chains (StemCrossID points to a stem that itself has NULL StemCrossID)
SELECT COUNT(*) INTO @v_broken_chain
FROM stems s1
JOIN stems s2 ON s1.StemCrossID = s2.StemGUID
WHERE s1.IsActive = 1 AND s2.StemCrossID IS NULL;

SELECT CASE WHEN @v_broken_chain > 0
    THEN CONCAT('WARNING: ', @v_broken_chain, ' stems have broken StemCrossID chains')
    ELSE 'OK: No broken StemCrossID chains detected'
END AS Validation_ChainIntegrity;

-- Validation 5: Summary statistics
SELECT
    'StemCrossID Statistics' AS Description,
    COUNT(*) AS Total_Active_Stems,
    SUM(CASE WHEN StemCrossID = StemGUID THEN 1 ELSE 0 END) AS Self_Referenced,
    SUM(CASE WHEN StemCrossID != StemGUID THEN 1 ELSE 0 END) AS Cross_Census_Linked,
    COUNT(DISTINCT StemCrossID) AS Unique_Physical_Stems,
    ROUND(100.0 * SUM(CASE WHEN StemCrossID != StemGUID THEN 1 ELSE 0 END) / COUNT(*), 2) AS Pct_Linked
FROM stems WHERE IsActive = 1;

-- Validation 6: Cross-census linkage by census
SELECT
    c.PlotCensusNumber AS Census,
    COUNT(s.StemGUID) AS Total_Stems,
    SUM(CASE WHEN s.StemCrossID = s.StemGUID THEN 1 ELSE 0 END) AS New_Stems,
    SUM(CASE WHEN s.StemCrossID != s.StemGUID THEN 1 ELSE 0 END) AS Linked_To_Previous,
    ROUND(100.0 * SUM(CASE WHEN s.StemCrossID != s.StemGUID THEN 1 ELSE 0 END) / COUNT(*), 2) AS Pct_Linked
FROM stems s
JOIN census c ON s.CensusID = c.CensusID
WHERE s.IsActive = 1
GROUP BY c.CensusID, c.PlotCensusNumber
ORDER BY c.PlotCensusNumber;

-- Validation 7: Verify chain consistency - all stems with same StemCrossID should have matching TreeTag+StemTag
SELECT
    'Chain Consistency Check' AS Description,
    COUNT(DISTINCT scid_group) AS Total_Physical_Stems,
    SUM(CASE WHEN tag_count > 1 THEN 1 ELSE 0 END) AS Inconsistent_Chains
FROM (
    SELECT
        s.StemCrossID AS scid_group,
        COUNT(DISTINCT CONCAT(t.TreeTag, '|', COALESCE(s.StemTag, ''))) AS tag_count
    FROM stems s
    JOIN trees t ON s.TreeID = t.TreeID
    WHERE s.IsActive = 1 AND s.StemCrossID IS NOT NULL
    GROUP BY s.StemCrossID
) chain_check;

-- Validation 8: Sample of cross-census linked stems (for manual verification)
SELECT
    'Sample Cross-Census Links (first 10)' AS Description,
    s.StemGUID,
    s.StemCrossID,
    s.StemTag,
    t.TreeTag,
    c.PlotCensusNumber AS Census,
    (SELECT c2.PlotCensusNumber FROM stems s2
     JOIN census c2 ON s2.CensusID = c2.CensusID
     WHERE s2.StemGUID = s.StemCrossID) AS Linked_To_Census
FROM stems s
JOIN trees t ON s.TreeID = t.TreeID
JOIN census c ON s.CensusID = c.CensusID
WHERE s.IsActive = 1 AND s.StemCrossID != s.StemGUID
LIMIT 10;

-- Calculate total validation errors
SET @total_stemcrossid_errors = @v_null_stemcrossid + @v_invalid_reference;
SET @total_stemcrossid_warnings = @v_census1_not_self + @v_broken_chain;

SELECT
    'StemCrossID Validation Summary' AS Section,
    @total_stemcrossid_errors AS Critical_Errors,
    @total_stemcrossid_warnings AS Warnings,
    CASE
        WHEN @total_stemcrossid_errors > 0 THEN 'FAILED - Critical issues detected'
        WHEN @total_stemcrossid_warnings > 0 THEN 'PASSED with warnings'
        ELSE 'PASSED - All validations successful'
    END AS Overall_Status;

-- Store validation results for later reporting
CALL migration_step_complete('07b_populate_stemcrossid', @total_stems_updated);

-- =====================================================================================
-- STEP 8: Migrate Core Measurements (Census-Aware)
-- =====================================================================================

CALL migration_step_start('08_migrate_coremeasurements');

SET @sql = CONCAT('
INSERT INTO coremeasurements (
    CensusID, StemGUID, IsValidated, MeasurementDate,
    MeasuredDBH, MeasuredHOM, Description, IsActive
)
SELECT DISTINCT
    c_map.new_CensusID AS CensusID,
    s_map.new_StemGUID AS StemGUID,
    NULL AS IsValidated,  -- Pending validation
    sdbh.ExactDate AS MeasurementDate,
    sdbh.DBH AS MeasuredDBH,
    CAST(sdbh.HOM AS DECIMAL(12,6)) AS MeasuredHOM,
    CASE WHEN sdbh.PrimaryStem IS NOT NULL
         THEN CONCAT(''Primary stem: '', sdbh.PrimaryStem)
         ELSE NULL
    END AS Description,
    1 AS IsActive
FROM ', @source_schema, '.dbh sdbh
-- CRITICAL: Census-aware stem mapping using BOTH StemID AND CensusID
JOIN id_map_stems s_map ON sdbh.StemID = s_map.old_StemID AND sdbh.CensusID = s_map.old_CensusID
JOIN id_map_census c_map ON sdbh.CensusID = c_map.old_CensusID
WHERE sdbh.DBH IS NOT NULL
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
SET @measurements_inserted = ROW_COUNT();
DEALLOCATE PREPARE stmt;

CALL migration_step_complete('08_migrate_coremeasurements', @measurements_inserted);

-- =====================================================================================
-- STEP 9: Migrate Attributes (Census-Aware - FIXED)
-- =====================================================================================

CALL migration_step_start('09_migrate_attributes');

-- 9a: Populate attributes table from tsmattributes
SET @sql = CONCAT('
INSERT IGNORE INTO attributes (Code, Description, Status, IsActive)
SELECT DISTINCT
    tsm.TSMCode AS Code,
    tsm.Description,
    CASE
        WHEN tsm.Status = ''alive'' THEN ''alive''
        WHEN tsm.Status = ''dead'' THEN ''dead''
        WHEN tsm.Status LIKE ''%dead%'' THEN ''dead''
        WHEN tsm.Status LIKE ''%broken below%'' THEN ''broken below''
        WHEN tsm.Status LIKE ''%missing%'' THEN ''missing''
        ELSE ''alive''
    END AS Status,
    1 AS IsActive
FROM ', @source_schema, '.tsmattributes tsm
WHERE tsm.TSMCode IS NOT NULL AND tsm.TSMCode != ''''
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
SET @attributes_inserted = ROW_COUNT();
DEALLOCATE PREPARE stmt;

-- 9b: Create temp table to parse ListOfTSM
DROP TEMPORARY TABLE IF EXISTS temp_tsm_links;
CREATE TEMPORARY TABLE temp_tsm_links (
    old_DBHID INT,
    TSMCode VARCHAR(10),
    old_StemID INT,
    old_CensusID INT,
    INDEX idx_dbhid (old_DBHID),
    INDEX idx_stem_census (old_StemID, old_CensusID),
    INDEX idx_code (TSMCode)
);

SET @sql = CONCAT('
INSERT INTO temp_tsm_links (old_DBHID, TSMCode, old_StemID, old_CensusID)
SELECT DISTINCT
    v.DBHID AS old_DBHID,
    TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(v.ListOfTSM, '','', numbers.n), '','', -1)) AS TSMCode,
    v.StemID AS old_StemID,
    v.CensusID AS old_CensusID
FROM ', @source_schema, '.viewfulltable v
CROSS JOIN (
    SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
    UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10
) numbers
WHERE v.ListOfTSM IS NOT NULL
    AND CHAR_LENGTH(v.ListOfTSM) > 0
    AND numbers.n <= 1 + CHAR_LENGTH(v.ListOfTSM) - CHAR_LENGTH(REPLACE(v.ListOfTSM, '','', ''''))
    AND TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(v.ListOfTSM, '','', numbers.n), '','', -1)) != ''''
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 9c: Link attributes to measurements (CENSUS-AWARE FIX)
INSERT IGNORE INTO cmattributes (CoreMeasurementID, Code)
SELECT DISTINCT cm.CoreMeasurementID, ttl.TSMCode AS Code
FROM temp_tsm_links ttl
-- CRITICAL FIX: Join using BOTH StemID AND CensusID
JOIN id_map_stems s_map ON ttl.old_StemID = s_map.old_StemID AND ttl.old_CensusID = s_map.old_CensusID
JOIN id_map_census c_map ON ttl.old_CensusID = c_map.old_CensusID
JOIN coremeasurements cm ON cm.StemGUID = s_map.new_StemGUID AND cm.CensusID = c_map.new_CensusID
JOIN attributes a ON a.Code = ttl.TSMCode
WHERE ttl.TSMCode IS NOT NULL AND ttl.TSMCode != '';

SET @attr_links_inserted = ROW_COUNT();

-- 9d: Add standard status codes
INSERT IGNORE INTO attributes (Code, Description, Status, IsActive)
VALUES
    ('ALIVE', 'Tree/Stem is alive', 'alive', 1),
    ('DEAD', 'Tree/Stem is dead', 'dead', 1),
    ('STEM_DEAD', 'Stem is dead', 'stem dead', 1),
    ('BROKEN_BELOW', 'Broken below measurement height', 'broken below', 1),
    ('OMITTED', 'Measurement omitted', 'omitted', 1),
    ('MISSING', 'Tree/Stem is missing', 'missing', 1);

-- 9e: Link status codes (CENSUS-AWARE FIX)
SET @sql = CONCAT('
INSERT IGNORE INTO cmattributes (CoreMeasurementID, Code)
SELECT DISTINCT cm.CoreMeasurementID,
    CASE v.Status
        WHEN ''alive'' THEN ''ALIVE''
        WHEN ''dead'' THEN ''DEAD''
        WHEN ''stem dead'' THEN ''STEM_DEAD''
        WHEN ''broken below'' THEN ''BROKEN_BELOW''
        WHEN ''omitted'' THEN ''OMITTED''
        WHEN ''missing'' THEN ''MISSING''
        ELSE ''ALIVE''
    END AS Code
FROM ', @source_schema, '.viewfulltable v
JOIN ', @source_schema, '.dbh sdbh ON v.DBHID = sdbh.DBHID
-- CRITICAL FIX: Join using BOTH StemID AND CensusID
JOIN id_map_stems s_map ON sdbh.StemID = s_map.old_StemID AND sdbh.CensusID = s_map.old_CensusID
JOIN id_map_census c_map ON sdbh.CensusID = c_map.old_CensusID
JOIN coremeasurements cm ON cm.StemGUID = s_map.new_StemGUID AND cm.CensusID = c_map.new_CensusID
WHERE v.Status IS NOT NULL
');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP TEMPORARY TABLE IF EXISTS temp_tsm_links;

SET @total_attrs = @attributes_inserted + @attr_links_inserted;
CALL migration_step_complete('09_migrate_attributes', @total_attrs);

-- =====================================================================================
-- SUMMARY
-- =====================================================================================

SELECT '=== DATA MIGRATION COMPLETE ===' AS Section;

CALL migration_progress();

SELECT
    'Migration Summary' AS Description,
    (SELECT COUNT(*) FROM plots) AS Plots,
    (SELECT COUNT(*) FROM quadrats) AS Quadrats,
    (SELECT COUNT(*) FROM family) AS Families,
    (SELECT COUNT(*) FROM genus) AS Genera,
    (SELECT COUNT(*) FROM species) AS Species,
    (SELECT COUNT(*) FROM census) AS Censuses,
    (SELECT COUNT(*) FROM trees) AS Trees,
    (SELECT COUNT(*) FROM stems) AS Stems,
    (SELECT COUNT(*) FROM coremeasurements) AS Measurements,
    (SELECT COUNT(*) FROM cmattributes) AS AttributeLinks;
