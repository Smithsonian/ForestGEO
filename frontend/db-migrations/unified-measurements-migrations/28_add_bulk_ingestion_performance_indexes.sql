-- =====================================================================================
-- Migration Script 28: Add add-only indexes for bulk ingestion performance
-- =====================================================================================
-- Purpose:
--   - Speed up the hottest bulkingestionprocess JOINs without removing any existing indexes
--   - Keep rollout risk low by making this migration strictly additive
-- =====================================================================================

-- 1) attributes(Code, IsActive)
SET @tbl = 'attributes';
SET @idx = 'idx_attributes_code_active';
SET @q = (
    SELECT IF(
        COUNT(*) > 0,
        'SELECT 1',
        CONCAT('ALTER TABLE ', @tbl, ' ADD INDEX `', @idx, '` (Code, IsActive)')
    )
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = @tbl
      AND INDEX_NAME = @idx
    LIMIT 1
);
PREPARE stmt FROM @q;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) quadrats(QuadratName, IsActive)
SET @tbl = 'quadrats';
SET @idx = 'idx_quadrats_name_active';
SET @q = (
    SELECT IF(
        COUNT(*) > 0,
        'SELECT 1',
        CONCAT('ALTER TABLE ', @tbl, ' ADD INDEX `', @idx, '` (QuadratName, IsActive)')
    )
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = @tbl
      AND INDEX_NAME = @idx
    LIMIT 1
);
PREPARE stmt FROM @q;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) species(SpeciesCode, IsActive)
SET @tbl = 'species';
SET @idx = 'idx_species_code_active';
SET @q = (
    SELECT IF(
        COUNT(*) > 0,
        'SELECT 1',
        CONCAT('ALTER TABLE ', @tbl, ' ADD INDEX `', @idx, '` (SpeciesCode, IsActive)')
    )
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = @tbl
      AND INDEX_NAME = @idx
    LIMIT 1
);
PREPARE stmt FROM @q;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4) trees(TreeTag, CensusID, IsActive)
SET @tbl = 'trees';
SET @idx = 'idx_trees_tag_census_active';
SET @q = (
    SELECT IF(
        COUNT(*) > 0,
        'SELECT 1',
        CONCAT('ALTER TABLE ', @tbl, ' ADD INDEX `', @idx, '` (TreeTag, CensusID, IsActive)')
    )
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = @tbl
      AND INDEX_NAME = @idx
    LIMIT 1
);
PREPARE stmt FROM @q;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5) trees(TreeTag, SpeciesID, CensusID, IsActive)
SET @idx = 'idx_trees_tag_species_census_active';
SET @q = (
    SELECT IF(
        COUNT(*) > 0,
        'SELECT 1',
        CONCAT('ALTER TABLE ', @tbl, ' ADD INDEX `', @idx, '` (TreeTag, SpeciesID, CensusID, IsActive)')
    )
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = @tbl
      AND INDEX_NAME = @idx
    LIMIT 1
);
PREPARE stmt FROM @q;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6) stems(CensusID, StemCrossID)
SET @tbl = 'stems';
SET @idx = 'idx_stems_census_crossid';
SET @q = (
    SELECT IF(
        COUNT(*) > 0,
        'SELECT 1',
        CONCAT('ALTER TABLE ', @tbl, ' ADD INDEX `', @idx, '` (CensusID, StemCrossID)')
    )
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = @tbl
      AND INDEX_NAME = @idx
    LIMIT 1
);
PREPARE stmt FROM @q;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 7) stems(StemTag, TreeID, CensusID, IsActive)
SET @idx = 'idx_stems_tag_tree_census_active';
SET @q = (
    SELECT IF(
        COUNT(*) > 0,
        'SELECT 1',
        CONCAT('ALTER TABLE ', @tbl, ' ADD INDEX `', @idx, '` (StemTag, TreeID, CensusID, IsActive)')
    )
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = @tbl
      AND INDEX_NAME = @idx
    LIMIT 1
);
PREPARE stmt FROM @q;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 8) stems(TreeID, QuadratID, CensusID, IsActive)
SET @idx = 'idx_stems_tree_quadrat_census_active';
SET @q = (
    SELECT IF(
        COUNT(*) > 0,
        'SELECT 1',
        CONCAT('ALTER TABLE ', @tbl, ' ADD INDEX `', @idx, '` (TreeID, QuadratID, CensusID, IsActive)')
    )
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = @tbl
      AND INDEX_NAME = @idx
    LIMIT 1
);
PREPARE stmt FROM @q;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 9) coremeasurements(CensusID, IsActive)
SET @tbl = 'coremeasurements';
SET @idx = 'idx_cm_census_active';
SET @q = (
    SELECT IF(
        COUNT(*) > 0,
        'SELECT 1',
        CONCAT('ALTER TABLE ', @tbl, ' ADD INDEX `', @idx, '` (CensusID, IsActive)')
    )
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = @tbl
      AND INDEX_NAME = @idx
    LIMIT 1
);
PREPARE stmt FROM @q;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 10) coremeasurements(StemGUID, IsActive)
SET @idx = 'idx_cm_stemguid_active';
SET @q = (
    SELECT IF(
        COUNT(*) > 0,
        'SELECT 1',
        CONCAT('ALTER TABLE ', @tbl, ' ADD INDEX `', @idx, '` (StemGUID, IsActive)')
    )
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = @tbl
      AND INDEX_NAME = @idx
    LIMIT 1
);
PREPARE stmt FROM @q;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ANALYZE TABLE attributes;
ANALYZE TABLE quadrats;
ANALYZE TABLE species;
ANALYZE TABLE trees;
ANALYZE TABLE stems;
ANALYZE TABLE coremeasurements;

SELECT 'Migration 28 complete: add-only bulk ingestion performance indexes ensured.' AS Status;
