-- =====================================================================================
-- Migration Script 00a: Reset Target Schema
-- =====================================================================================
-- Purpose: Clear ALL tables in the target schema before migration
-- This ensures a clean state for migration without conflicts or duplicate data
--
-- WARNING: This script TRUNCATES ALL data tables in the target schema!
--
-- Note: Uses DATABASE() to work with any target schema - schema is selected by the caller
-- =====================================================================================

-- Disable foreign key checks for the duration of truncation
SET foreign_key_checks = 0;

-- =====================================================================================
-- Clear ALL data tables (in dependency order, though FK checks are disabled)
-- =====================================================================================

-- Measurement and attribute data
TRUNCATE TABLE cmattributes;
TRUNCATE TABLE cmverrors;
TRUNCATE TABLE coremeasurements;
TRUNCATE TABLE measurementssummary;

-- Tree/stem data
TRUNCATE TABLE stems;
TRUNCATE TABLE trees;

-- Census data
TRUNCATE TABLE census;
TRUNCATE TABLE censusactivepersonnel;

-- Spatial data
TRUNCATE TABLE quadrats;
TRUNCATE TABLE plots;

-- Taxonomy data
TRUNCATE TABLE specieslimits;
TRUNCATE TABLE specimens;
TRUNCATE TABLE species;
TRUNCATE TABLE genus;
TRUNCATE TABLE family;

-- Attribute definitions
TRUNCATE TABLE attributes;

-- Reference and configuration data
TRUNCATE TABLE reference;
TRUNCATE TABLE personnel;
TRUNCATE TABLE roles;
TRUNCATE TABLE sitespecificvalidations;
TRUNCATE TABLE postvalidationqueries;

-- Upload and tracking data
TRUNCATE TABLE temporarymeasurements;
TRUNCATE TABLE failedmeasurements;
TRUNCATE TABLE unifiedchangelog;
TRUNCATE TABLE validationchangelog;

-- Upload session tracking tables (check if they exist first)
SET @schema = DATABASE();

SELECT COUNT(*) INTO @upload_sessions_exists
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'upload_sessions';

SET @truncate_upload_sessions = IF(@upload_sessions_exists > 0,
    'TRUNCATE TABLE upload_sessions',
    'SELECT "upload_sessions table does not exist" as status');
PREPARE stmt FROM @truncate_upload_sessions;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @uploadintegrityalerts_exists
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'uploadintegrityalerts';

SET @truncate_uploadintegrityalerts = IF(@uploadintegrityalerts_exists > 0,
    'TRUNCATE TABLE uploadintegrityalerts',
    'SELECT "uploadintegrityalerts table does not exist" as status');
PREPARE stmt FROM @truncate_uploadintegrityalerts;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @uploadmetrics_exists
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'uploadmetrics';

SET @truncate_uploadmetrics = IF(@uploadmetrics_exists > 0,
    'TRUNCATE TABLE uploadmetrics',
    'SELECT "uploadmetrics table does not exist" as status');
PREPARE stmt FROM @truncate_uploadmetrics;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Re-enable foreign key checks
SET foreign_key_checks = 1;

-- =====================================================================================
-- Verification
-- =====================================================================================
SELECT 'Target schema reset complete - ALL tables truncated' AS Status,
       DATABASE() AS SchemaName,
       NOW() AS ResetTime;

-- Show row counts for all tables to verify they are empty
SELECT 'Verification - All tables should be empty:' AS Info;

SELECT 'coremeasurements' AS TableName, COUNT(*) AS RowCount FROM coremeasurements
UNION ALL SELECT 'cmattributes', COUNT(*) FROM cmattributes
UNION ALL SELECT 'cmverrors', COUNT(*) FROM cmverrors
UNION ALL SELECT 'stems', COUNT(*) FROM stems
UNION ALL SELECT 'trees', COUNT(*) FROM trees
UNION ALL SELECT 'census', COUNT(*) FROM census
UNION ALL SELECT 'quadrats', COUNT(*) FROM quadrats
UNION ALL SELECT 'plots', COUNT(*) FROM plots
UNION ALL SELECT 'species', COUNT(*) FROM species
UNION ALL SELECT 'genus', COUNT(*) FROM genus
UNION ALL SELECT 'family', COUNT(*) FROM family
UNION ALL SELECT 'attributes', COUNT(*) FROM attributes
UNION ALL SELECT 'personnel', COUNT(*) FROM personnel
UNION ALL SELECT 'roles', COUNT(*) FROM roles
UNION ALL SELECT 'reference', COUNT(*) FROM reference
UNION ALL SELECT 'failedmeasurements', COUNT(*) FROM failedmeasurements
UNION ALL SELECT 'temporarymeasurements', COUNT(*) FROM temporarymeasurements;
