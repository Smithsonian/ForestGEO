-- =====================================================================================
-- INDEX OPTIMIZATION SCRIPT FOR BULK INGESTION PERFORMANCE
-- =====================================================================================
-- This script adds strategic indexes and removes redundant ones to improve
-- the performance of the bulkingestionprocess_fixed procedure
-- =====================================================================================

USE forestgeo_testing;

-- =====================================================================================
-- 1. CLEANUP REDUNDANT INDEXES ON TEMPORARYMEASUREMENTS
-- =====================================================================================
-- The temporarymeasurements table has many overlapping indexes that slow down INSERTs
-- Let's keep only the most essential ones

-- Check if redundant indexes exist before dropping them
DROP INDEX IF EXISTS temporarymeasurements_id_index ON temporarymeasurements;
DROP INDEX IF EXISTS temporarymeasurements_FileID_index ON temporarymeasurements;
DROP INDEX IF EXISTS temporarymeasurements_TreeTag_index ON temporarymeasurements;
DROP INDEX IF EXISTS temporarymeasurements_StemTag_index ON temporarymeasurements;
DROP INDEX IF EXISTS temporarymeasurements_StemTag_LocalX_LocalY_index ON temporarymeasurements;
DROP INDEX IF EXISTS temporarymeasurements_QuadratName_index ON temporarymeasurements;
DROP INDEX IF EXISTS temporarymeasurements_Codes_index ON temporarymeasurements;
DROP INDEX IF EXISTS temporarymeasurements_DBH_HOM_MeasurementDate_index ON temporarymeasurements;

-- Keep only the most efficient composite indexes:
-- 1. ingest_temporarymeasurements_FBPC_index (FileID, BatchID, PlotID, CensusID) - for procedure queries
-- 2. temporarymeasurements_FileID_BatchID_index (FileID, BatchID) - for cleanup operations  
-- 3. temporarymeasurements_TreeTag_SpeciesCode_index (TreeTag, SpeciesCode) - for JOIN operations
-- 4. idx_cid_md_dbh_hom_qn_tt - for complex filtering
-- 5. idx_tm_tag_xy_cid - for stem operations

-- =====================================================================================
-- 2. ADD STRATEGIC INDEXES FOR BETTER JOIN PERFORMANCE
-- =====================================================================================

-- Add composite index for trees table lookups in the procedure
CREATE INDEX IF NOT EXISTS idx_trees_tag_census_active ON trees (TreeTag, CensusID, IsActive);

-- Add composite index for stems table lookups
CREATE INDEX IF NOT EXISTS idx_stems_tag_tree_census ON stems (StemTag, TreeID, CensusID, IsActive);

-- Add index for quadrats lookups by name and active status
CREATE INDEX IF NOT EXISTS idx_quadrats_name_active ON quadrats (QuadratName, IsActive);

-- Add index for species lookups by code and active status  
CREATE INDEX IF NOT EXISTS idx_species_code_active ON species (SpeciesCode, IsActive);

-- =====================================================================================
-- 3. OPTIMIZE CORE MEASUREMENT INDEXES
-- =====================================================================================

-- The coremeasurements table is heavily accessed - ensure optimal indexing
-- The existing ux_measure_unique index covers most cases, but we can add supporting indexes

-- Add index for census-based queries
CREATE INDEX IF NOT EXISTS idx_cm_census_active ON coremeasurements (CensusID, IsActive);

-- Add index for StemGUID lookups (if not covered by existing indexes)
CREATE INDEX IF NOT EXISTS idx_cm_stemguid_active ON coremeasurements (StemGUID, IsActive);

-- =====================================================================================
-- 4. OPTIMIZE STEMS TABLE FOR BULK OPERATIONS
-- =====================================================================================

-- Add composite index for efficient stem insertions and lookups
CREATE INDEX IF NOT EXISTS idx_stems_tree_quadrat_census ON stems (TreeID, QuadratID, CensusID, IsActive);

-- Add index for StemCrossID updates
CREATE INDEX IF NOT EXISTS idx_stems_crossid_census ON stems (CensusID, StemCrossID);

-- =====================================================================================
-- 5. ATTRIBUTES AND CMATTRIBUTES OPTIMIZATION
-- =====================================================================================

-- Ensure efficient attribute code validation
CREATE INDEX IF NOT EXISTS idx_attributes_code_active ON attributes (Code, IsActive);

-- Add index for cmattributes insertions
CREATE INDEX IF NOT EXISTS idx_cmattr_measurement_code ON cmattributes (CoreMeasurementID, Code);

-- =====================================================================================
-- 6. ANALYZE TABLES TO UPDATE STATISTICS
-- =====================================================================================
-- Update table statistics for the query optimizer

ANALYZE TABLE temporarymeasurements;
ANALYZE TABLE trees;
ANALYZE TABLE stems;
ANALYZE TABLE coremeasurements;
ANALYZE TABLE quadrats;
ANALYZE TABLE species;
ANALYZE TABLE attributes;
ANALYZE TABLE cmattributes;
ANALYZE TABLE failedmeasurements;

-- =====================================================================================
-- 7. SHOW FINAL INDEX STATUS
-- =====================================================================================

SELECT 
    'temporarymeasurements' as table_name, 
    COUNT(*) as index_count 
FROM information_schema.statistics 
WHERE table_schema = 'forestgeo_testing' 
  AND table_name = 'temporarymeasurements'
UNION ALL
SELECT 
    'trees' as table_name, 
    COUNT(*) as index_count 
FROM information_schema.statistics 
WHERE table_schema = 'forestgeo_testing' 
  AND table_name = 'trees'
UNION ALL
SELECT 
    'stems' as table_name, 
    COUNT(*) as index_count 
FROM information_schema.statistics 
WHERE table_schema = 'forestgeo_testing' 
  AND table_name = 'stems'
UNION ALL
SELECT 
    'coremeasurements' as table_name, 
    COUNT(*) as index_count 
FROM information_schema.statistics 
WHERE table_schema = 'forestgeo_testing' 
  AND table_name = 'coremeasurements';

SELECT 'Index optimization completed successfully' as status;