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
--   Idempotent: uses stored procedure wrapper to check state before applying.
-- =====================================================================================

-- Use a stored procedure to allow IF/THEN logic within piped mysql input.
-- The procedure is created, called, then dropped immediately.

DROP PROCEDURE IF EXISTS _run_migration_50;

DELIMITER $$

CREATE PROCEDURE _run_migration_50()
BEGIN
    DECLARE pk_col_count INT;
    DECLARE col_nullable VARCHAR(3);
    DECLARE col_exists INT;

    -- Step 1: Drop composite PK and add single-column PK
    SELECT COUNT(*) INTO pk_col_count
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'measurementssummary'
      AND INDEX_NAME   = 'PRIMARY';

    IF pk_col_count > 1 THEN
        ALTER TABLE measurementssummary DROP PRIMARY KEY, ADD PRIMARY KEY (CoreMeasurementID);
    END IF;

    -- Step 2: Make StemGUID nullable
    SELECT IS_NULLABLE INTO col_nullable
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'measurementssummary'
      AND COLUMN_NAME  = 'StemGUID';

    IF col_nullable = 'NO' THEN
        ALTER TABLE measurementssummary MODIFY COLUMN StemGUID INT NULL;
    END IF;

    -- Step 3: Make TreeID nullable
    SELECT IS_NULLABLE INTO col_nullable
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'measurementssummary'
      AND COLUMN_NAME  = 'TreeID';

    IF col_nullable = 'NO' THEN
        ALTER TABLE measurementssummary MODIFY COLUMN TreeID INT NULL;
    END IF;

    -- Step 4: Make SpeciesID nullable
    SELECT IS_NULLABLE INTO col_nullable
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'measurementssummary'
      AND COLUMN_NAME  = 'SpeciesID';

    IF col_nullable = 'NO' THEN
        ALTER TABLE measurementssummary MODIFY COLUMN SpeciesID INT NULL;
    END IF;

    -- Step 5: Make QuadratID nullable
    SELECT IS_NULLABLE INTO col_nullable
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'measurementssummary'
      AND COLUMN_NAME  = 'QuadratID';

    IF col_nullable = 'NO' THEN
        ALTER TABLE measurementssummary MODIFY COLUMN QuadratID INT NULL;
    END IF;

    -- Step 6: Make MeasurementDate nullable
    SELECT IS_NULLABLE INTO col_nullable
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'measurementssummary'
      AND COLUMN_NAME  = 'MeasurementDate';

    IF col_nullable = 'NO' THEN
        ALTER TABLE measurementssummary MODIFY COLUMN MeasurementDate DATE NULL;
    END IF;

    -- Step 7: Add RawCodes column to measurementssummary
    SELECT COUNT(*) INTO col_exists
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'measurementssummary'
      AND COLUMN_NAME  = 'RawCodes';

    IF col_exists = 0 THEN
        ALTER TABLE measurementssummary ADD COLUMN RawCodes VARCHAR(255) NULL AFTER Attributes;
    END IF;

    -- Step 8: Add RawCodes column to viewfulltable
    SELECT COUNT(*) INTO col_exists
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'viewfulltable'
      AND COLUMN_NAME  = 'RawCodes';

    IF col_exists = 0 THEN
        ALTER TABLE viewfulltable ADD COLUMN RawCodes VARCHAR(255) NULL AFTER Attributes;
    END IF;

    SELECT 'Migration 50 complete.' AS Status;
END$$

DELIMITER ;

CALL _run_migration_50();
DROP PROCEDURE IF EXISTS _run_migration_50;
