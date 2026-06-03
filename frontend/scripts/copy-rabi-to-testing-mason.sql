-- =====================================================================================
-- Copy Full Dataset: forestgeo_rabi → forestgeo_testing_mason
-- =====================================================================================
-- Purpose: Copy all data from Rabi plot to Mason Test Site for testing
-- Run in: DataGrip connected to Azure MySQL
--
-- INSTRUCTIONS:
--   1. Run SECTION 0 first to verify data exists
--   2. Run SECTION 1 to clear target and disable FK checks
--   3. Run SECTIONS 2-6 to copy data (can run all at once)
--   4. Run SECTION 7 to re-enable FK checks and verify
--   5. Run SECTION 8 to refresh validation reasons
-- =====================================================================================


-- =====================================================================================
-- SECTION 0: Pre-flight checks
-- =====================================================================================

-- Verify source has data
SELECT 'Source Schema: forestgeo_rabi' as Info;
SELECT 'failedmeasurements' as TableName, COUNT(*) as RowCount FROM forestgeo_rabi.failedmeasurements
UNION ALL SELECT 'coremeasurements', COUNT(*) FROM forestgeo_rabi.coremeasurements
UNION ALL SELECT 'trees', COUNT(*) FROM forestgeo_rabi.trees
UNION ALL SELECT 'stems', COUNT(*) FROM forestgeo_rabi.stems
UNION ALL SELECT 'quadrats', COUNT(*) FROM forestgeo_rabi.quadrats
UNION ALL SELECT 'species', COUNT(*) FROM forestgeo_rabi.species
UNION ALL SELECT 'plots', COUNT(*) FROM forestgeo_rabi.plots
UNION ALL SELECT 'census', COUNT(*) FROM forestgeo_rabi.census;


-- =====================================================================================
-- SECTION 1: Disable foreign key checks and clear target tables
-- =====================================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- Clear target tables (ignore errors if tables don't exist)
DELETE FROM forestgeo_testing_mason.cmverrors;
DELETE FROM forestgeo_testing_mason.cmattributes;
DELETE FROM forestgeo_testing_mason.coremeasurements;
DELETE FROM forestgeo_testing_mason.failedmeasurements;
DELETE FROM forestgeo_testing_mason.stems;
DELETE FROM forestgeo_testing_mason.trees;
DELETE FROM forestgeo_testing_mason.quadrats;
DELETE FROM forestgeo_testing_mason.census;
DELETE FROM forestgeo_testing_mason.plots;
DELETE FROM forestgeo_testing_mason.species;
DELETE FROM forestgeo_testing_mason.genus;
DELETE FROM forestgeo_testing_mason.family;
DELETE FROM forestgeo_testing_mason.reference;
DELETE FROM forestgeo_testing_mason.roles;
DELETE FROM forestgeo_testing_mason.personnel;
DELETE FROM forestgeo_testing_mason.attributes;
DELETE FROM forestgeo_testing_mason.specieslimits;


-- =====================================================================================
-- SECTION 2: Copy reference/lookup tables
-- =====================================================================================

-- Family
INSERT IGNORE INTO forestgeo_testing_mason.family
SELECT * FROM forestgeo_rabi.family;

-- Genus
INSERT IGNORE INTO forestgeo_testing_mason.genus
SELECT * FROM forestgeo_rabi.genus;

-- Species
INSERT IGNORE INTO forestgeo_testing_mason.species
SELECT * FROM forestgeo_rabi.species;

-- Reference
INSERT IGNORE INTO forestgeo_testing_mason.reference
SELECT * FROM forestgeo_rabi.reference;

-- Attributes
INSERT IGNORE INTO forestgeo_testing_mason.attributes
SELECT * FROM forestgeo_rabi.attributes;

-- Roles
INSERT IGNORE INTO forestgeo_testing_mason.roles
SELECT * FROM forestgeo_rabi.roles;

-- Personnel
INSERT IGNORE INTO forestgeo_testing_mason.personnel
SELECT * FROM forestgeo_rabi.personnel;

-- SpeciesLimits
INSERT IGNORE INTO forestgeo_testing_mason.specieslimits
SELECT * FROM forestgeo_rabi.specieslimits;


-- =====================================================================================
-- SECTION 3: Copy structural tables (plots, census, quadrats)
-- =====================================================================================

-- Plots
INSERT IGNORE INTO forestgeo_testing_mason.plots
SELECT * FROM forestgeo_rabi.plots;

-- Census
INSERT IGNORE INTO forestgeo_testing_mason.census
SELECT * FROM forestgeo_rabi.census;

-- Quadrats
INSERT IGNORE INTO forestgeo_testing_mason.quadrats
SELECT * FROM forestgeo_rabi.quadrats;



-- =====================================================================================
-- SECTION 4: Copy tree/stem data
-- =====================================================================================

-- Trees
INSERT IGNORE INTO forestgeo_testing_mason.trees
SELECT * FROM forestgeo_rabi.trees;

-- Stems
INSERT IGNORE INTO forestgeo_testing_mason.stems
SELECT * FROM forestgeo_rabi.stems;


-- =====================================================================================
-- SECTION 5: Copy measurement data
-- =====================================================================================

-- CoreMeasurements
INSERT IGNORE INTO forestgeo_testing_mason.coremeasurements
SELECT * FROM forestgeo_rabi.coremeasurements;

-- CMAttributes
INSERT IGNORE INTO forestgeo_testing_mason.cmattributes
SELECT * FROM forestgeo_rabi.cmattributes;

-- CMVErrors
INSERT IGNORE INTO forestgeo_testing_mason.cmverrors
SELECT * FROM forestgeo_rabi.cmverrors;


-- =====================================================================================
-- SECTION 6: Copy failed measurements
-- =====================================================================================

-- NOTE: If source schema doesn't have the new columns yet, use the explicit version below
-- Try this first (works if columns match):
INSERT IGNORE INTO forestgeo_testing_mason.failedmeasurements
SELECT * FROM forestgeo_rabi.failedmeasurements;

-- If that fails due to column mismatch, run this instead:

INSERT INTO forestgeo_testing_mason.failedmeasurements
  (FailedMeasurementID, FileID, BatchID, PlotID, CensusID, Tag, StemTag, SpCode,
   Quadrat, X, Y, DBH, HOM, Date, Codes, Comments, FailureReasons)
SELECT
  FailedMeasurementID, FileID, BatchID, PlotID, CensusID, Tag, StemTag, SpCode,
  Quadrat, X, Y, DBH, HOM, Date, Codes, Comments, FailureReasons
FROM forestgeo_rabi.failedmeasurements;




-- =====================================================================================
-- SECTION 7: Re-enable foreign key checks and verify
-- =====================================================================================

SET FOREIGN_KEY_CHECKS = 1;

-- Verify copy completed
SELECT 'Copy Complete! Verifying target schema...' as Info;

SELECT 'failedmeasurements' as TableName, COUNT(*) as RowCount FROM forestgeo_testing_mason.failedmeasurements
UNION ALL SELECT 'coremeasurements', COUNT(*) FROM forestgeo_testing_mason.coremeasurements
UNION ALL SELECT 'trees', COUNT(*) FROM forestgeo_testing_mason.trees
UNION ALL SELECT 'stems', COUNT(*) FROM forestgeo_testing_mason.stems
UNION ALL SELECT 'quadrats', COUNT(*) FROM forestgeo_testing_mason.quadrats
UNION ALL SELECT 'species', COUNT(*) FROM forestgeo_testing_mason.species
UNION ALL SELECT 'plots', COUNT(*) FROM forestgeo_testing_mason.plots
UNION ALL SELECT 'census', COUNT(*) FROM forestgeo_testing_mason.census;


-- =====================================================================================
-- SECTION 8: Deploy new stored procedure and refresh validation reasons
-- =====================================================================================

-- Step 8a: Add new columns to failedmeasurements (if not already present)
-- Run these one at a time, ignore errors if columns already exist:

ALTER TABLE forestgeo_testing_mason.failedmeasurements
ADD COLUMN OriginalFailureReasons TEXT NULL;

ALTER TABLE forestgeo_testing_mason.failedmeasurements
ADD COLUMN CurrentFailureReasons TEXT NULL;

ALTER TABLE forestgeo_testing_mason.failedmeasurements
ADD COLUMN LastValidatedAt DATETIME NULL;


-- Step 8b: Copy FailureReasons to OriginalFailureReasons for existing rows
UPDATE forestgeo_testing_mason.failedmeasurements
SET OriginalFailureReasons = FailureReasons
WHERE OriginalFailureReasons IS NULL
  AND FailureReasons IS NOT NULL
  AND FailureReasons != 'Ready for reingestion';


-- Step 8c: Deploy the new refresh procedure
-- Copy and run the content from: frontend/db-migrations/16_failed_measurements_reasons.sql
-- Make sure to run it against forestgeo_testing_mason schema


-- Step 8d: Refresh validation reasons for all failed measurements
-- Get the PlotID and CensusID first:
SELECT DISTINCT PlotID, CensusID FROM forestgeo_testing_mason.failedmeasurements;

-- Then call the refresh procedure (replace with actual values):
CALL forestgeo_testing_mason.refresh_failedmeasurements_current(1, 1);

-- Or refresh all at once (slower):
CALL forestgeo_testing_mason.reviewfailed();


-- =====================================================================================
-- SECTION 9: Verify the fix worked
-- =====================================================================================

-- Check that OriginalFailureReasons are now preserved
SELECT
    COUNT(*) as TotalFailed,
    SUM(CASE WHEN OriginalFailureReasons IS NOT NULL THEN 1 ELSE 0 END) as HasOriginalReason,
    SUM(CASE WHEN CurrentFailureReasons IS NOT NULL THEN 1 ELSE 0 END) as HasCurrentReason,
    SUM(CASE WHEN FailureReasons = 'Ready for reingestion' THEN 1 ELSE 0 END) as MarkedReady
FROM forestgeo_testing_mason.failedmeasurements;

-- Sample some rows to see the difference
SELECT
    FailedMeasurementID,
    Tag,
    StemTag,
    LEFT(OriginalFailureReasons, 50) as OriginalReason,
    LEFT(CurrentFailureReasons, 50) as CurrentReason,
    LEFT(FailureReasons, 30) as DisplayReason,
    LastValidatedAt
FROM forestgeo_testing_mason.failedmeasurements
LIMIT 20;
