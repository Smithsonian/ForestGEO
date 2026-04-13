-- =====================================================================================
-- Migration Script 50: Relax measurementssummary constraints and add RawCodes
-- =====================================================================================
-- Purpose:
--   Hard-failed records (invalid species, duplicate tags) are inserted into
--   coremeasurements with StemGUID = NULL. The refresh_measurementssummary
--   procedure uses INSERT IGNORE, and the composite primary key on
--   measurementssummary includes StemGUID/TreeID/SpeciesID/QuadratID as NOT NULL
--   columns. This causes INSERT IGNORE to silently drop hard-failed rows,
--   making them invisible in the UI.
--
--   This migration:
--   1. Drops the composite PK and replaces it with PK(CoreMeasurementID) only
--   2. Makes StemGUID, TreeID, SpeciesID, QuadratID, MeasurementDate nullable
--   3. Adds RawCodes column to measurementssummary (original uploaded codes)
--   4. Adds RawCodes column to viewfulltable (original uploaded codes)
--
--   RawCodes preserves the raw attribute code string from coremeasurements.
--   The existing Attributes column holds only valid/materialized codes. When
--   they differ, the UI can indicate that some codes were dropped.
--
--   Idempotent: each step checks current state before applying changes.
-- =====================================================================================

-- Step 1: Drop composite PK and add single-column PK on CoreMeasurementID.
-- We check if the current PK has more than one column before attempting the change.
SET @pk_col_count := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'measurementssummary'
      AND INDEX_NAME   = 'PRIMARY'
);

SET @ddl_pk := IF(@pk_col_count > 1,
    'ALTER TABLE measurementssummary DROP PRIMARY KEY, ADD PRIMARY KEY (CoreMeasurementID)',
    'SELECT ''measurementssummary PK already single-column'' AS Status'
);

PREPARE stmt FROM @ddl_pk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 2: Make StemGUID nullable
SET @col_nullable := (
    SELECT IS_NULLABLE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'measurementssummary'
      AND COLUMN_NAME  = 'StemGUID'
);

SET @ddl := IF(@col_nullable = 'NO',
    'ALTER TABLE measurementssummary MODIFY COLUMN StemGUID INT NULL',
    'SELECT ''measurementssummary.StemGUID already nullable'' AS Status'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 3: Make TreeID nullable
SET @col_nullable := (
    SELECT IS_NULLABLE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'measurementssummary'
      AND COLUMN_NAME  = 'TreeID'
);

SET @ddl := IF(@col_nullable = 'NO',
    'ALTER TABLE measurementssummary MODIFY COLUMN TreeID INT NULL',
    'SELECT ''measurementssummary.TreeID already nullable'' AS Status'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 4: Make SpeciesID nullable
SET @col_nullable := (
    SELECT IS_NULLABLE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'measurementssummary'
      AND COLUMN_NAME  = 'SpeciesID'
);

SET @ddl := IF(@col_nullable = 'NO',
    'ALTER TABLE measurementssummary MODIFY COLUMN SpeciesID INT NULL',
    'SELECT ''measurementssummary.SpeciesID already nullable'' AS Status'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 5: Make QuadratID nullable
SET @col_nullable := (
    SELECT IS_NULLABLE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'measurementssummary'
      AND COLUMN_NAME  = 'QuadratID'
);

SET @ddl := IF(@col_nullable = 'NO',
    'ALTER TABLE measurementssummary MODIFY COLUMN QuadratID INT NULL',
    'SELECT ''measurementssummary.QuadratID already nullable'' AS Status'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 6: Make MeasurementDate nullable
SET @col_nullable := (
    SELECT IS_NULLABLE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'measurementssummary'
      AND COLUMN_NAME  = 'MeasurementDate'
);

SET @ddl := IF(@col_nullable = 'NO',
    'ALTER TABLE measurementssummary MODIFY COLUMN MeasurementDate DATE NULL',
    'SELECT ''measurementssummary.MeasurementDate already nullable'' AS Status'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 7: Add RawCodes column to measurementssummary
SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'measurementssummary'
      AND COLUMN_NAME  = 'RawCodes'
);

SET @ddl := IF(@col_exists = 0,
    'ALTER TABLE measurementssummary ADD COLUMN RawCodes VARCHAR(255) NULL AFTER Attributes',
    'SELECT ''measurementssummary.RawCodes already exists'' AS Status'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 8: Add RawCodes column to viewfulltable
SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'viewfulltable'
      AND COLUMN_NAME  = 'RawCodes'
);

SET @ddl := IF(@col_exists = 0,
    'ALTER TABLE viewfulltable ADD COLUMN RawCodes VARCHAR(255) NULL AFTER Attributes',
    'SELECT ''viewfulltable.RawCodes already exists'' AS Status'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 50 complete: measurementssummary PK relaxed to (CoreMeasurementID), nullable columns updated, RawCodes added to both materialized tables.' AS Status;
