-- Delete measurements from all censuses in forestgeo_testing
-- Retains supporting data: Species, Attributes, Personnel, Quadrats, Plots, Census records

USE forestgeo_testing;

-- Start transaction for safety
START TRANSACTION;

-- 1. Delete measurement error log (validation + ingestion errors)
DELETE FROM measurement_error_log;
SELECT 'Deleted measurement error log rows' as Step, ROW_COUNT() as RowsAffected;

-- 2. Delete coremeasurement attributes junction table
DELETE FROM cmattributes;
SELECT 'Deleted coremeasurement attributes' as Step, ROW_COUNT() as RowsAffected;

-- 3. Delete core measurements
DELETE FROM coremeasurements;
SELECT 'Deleted core measurements' as Step, ROW_COUNT() as RowsAffected;

-- 4. Delete stems
DELETE FROM stems;
SELECT 'Deleted stems' as Step, ROW_COUNT() as RowsAffected;

-- 5. Delete temporary measurements (if any remain)
DELETE FROM temporarymeasurements;
SELECT 'Deleted temporary measurements' as Step, ROW_COUNT() as RowsAffected;

-- Show what's retained
SELECT 'RETAINED TABLES:' as Status;
SELECT COUNT(*) as SpeciesCount FROM species;
SELECT COUNT(*) as AttributesCount FROM attributes;
SELECT COUNT(*) as PersonnelCount FROM personnel;
SELECT COUNT(*) as QuadratsCount FROM quadrats;
SELECT COUNT(*) as PlotsCount FROM plots;
SELECT COUNT(*) as CensusCount FROM census;

-- Commit the transaction
COMMIT;

SELECT 'All measurements deleted successfully. Supporting data retained.' as FinalStatus;
