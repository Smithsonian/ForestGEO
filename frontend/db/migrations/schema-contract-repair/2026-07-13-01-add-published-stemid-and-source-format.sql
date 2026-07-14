-- =====================================================================================
-- Migration 2026-07-13-01: repair known temporarymeasurements + collation drift
-- =====================================================================================
-- Purpose
--   Bring live schemas up to the canonical write contract (db/sql/tablestructures.sql)
--   BEFORE app code that depends on the new columns deploys. This repairs the three
--   known live-schema drifts that produced runtime 500s ("Unknown column
--   'PublishedStemID'/'SourceFormat' in 'field list'") and collation mismatches:
--     1. temporarymeasurements.SourceFormat missing  (canonical: varchar(32) NOT NULL DEFAULT 'csv')
--     2. temporarymeasurements.PublishedStemID missing (canonical: int unsigned NULL)
--     3. text columns / database default left on a legacy collation instead of
--        utf8mb4_0900_ai_ci.
--
-- Idempotency
--   Every statement is guarded against information_schema so a re-apply is a no-op:
--     - column adds run only when the column is absent;
--     - the database-default fix runs only when the default collation differs;
--     - each table is rebuilt (CONVERT TO) only when it still has a non-generated
--       text column off the target collation.
--   Column adds are intentionally reviewed-additive: no data column is dropped or
--   narrowed.
--
-- MySQL notes
--   - ADD COLUMN IF NOT EXISTS is MariaDB-only, so the guarded-PREPARE pattern
--     (matching the existing unified-measurements migrations) is used instead.
--   - DDL implicitly commits in MySQL, so this file is NOT wrapped in a transaction
--     inside the SQL; the runner records the ledger entry as a single atomic
--     statement and relies on these guards for re-run safety.
--   - CONVERT TO CHARACTER SET rebuilds the table. It is guarded so it only runs on
--     schemas that actually carry legacy-collation text columns; on a large
--     coremeasurements this is a one-time, drift-only repair, never a re-run cost.
--   - CONVERT TO leaves STORED/VIRTUAL generated columns (e.g. species.unique_sig)
--     untouched and preserves each column's type, nullability, and default.
-- =====================================================================================

-- ---------------------------------------------------------------------------
-- 1. temporarymeasurements.SourceFormat  (add before collation normalization so
--    the CONVERT pass below also normalizes the freshly-added column's collation)
-- ---------------------------------------------------------------------------
SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'temporarymeasurements'
      AND COLUMN_NAME = 'SourceFormat'
);
SET @ddl := IF(@col_exists > 0,
    'SELECT ''temporarymeasurements.SourceFormat already present'' AS Status',
    'ALTER TABLE `temporarymeasurements` ADD COLUMN `SourceFormat` varchar(32) NOT NULL DEFAULT ''csv'''
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 2. temporarymeasurements.PublishedStemID
-- ---------------------------------------------------------------------------
SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'temporarymeasurements'
      AND COLUMN_NAME = 'PublishedStemID'
);
SET @ddl := IF(@col_exists > 0,
    'SELECT ''temporarymeasurements.PublishedStemID already present'' AS Status',
    'ALTER TABLE `temporarymeasurements` ADD COLUMN `PublishedStemID` int unsigned NULL'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 3. database default collation
-- ---------------------------------------------------------------------------
SET @db_collation := (
    SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA
    WHERE SCHEMA_NAME = DATABASE()
);
SET @ddl := IF(@db_collation = 'utf8mb4_0900_ai_ci',
    'SELECT ''database default collation already utf8mb4_0900_ai_ci'' AS Status',
    CONCAT('ALTER DATABASE `', DATABASE(), '` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci')
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 4. text-column collation normalization for every critical (write-contract) table.
--    The guard counts only NON-generated text columns still off the target
--    collation, so the rebuild runs only where genuine drift exists and re-apply
--    is a no-op. Table set mirrors CRITICAL_TABLES in lib/db/schema-contract.ts.
-- ---------------------------------------------------------------------------
SET @target_collation := 'utf8mb4_0900_ai_ci';

-- temporarymeasurements
SET @needs_convert := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'temporarymeasurements'
      AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME <> @target_collation
      AND EXTRA NOT LIKE '%GENERATED%'
);
SET @ddl := IF(@needs_convert = 0,
    'SELECT ''temporarymeasurements collation ok'' AS Status',
    'ALTER TABLE `temporarymeasurements` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- coremeasurements
SET @needs_convert := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coremeasurements'
      AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME <> @target_collation
      AND EXTRA NOT LIKE '%GENERATED%'
);
SET @ddl := IF(@needs_convert = 0,
    'SELECT ''coremeasurements collation ok'' AS Status',
    'ALTER TABLE `coremeasurements` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- species
SET @needs_convert := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'species'
      AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME <> @target_collation
      AND EXTRA NOT LIKE '%GENERATED%'
);
SET @ddl := IF(@needs_convert = 0,
    'SELECT ''species collation ok'' AS Status',
    'ALTER TABLE `species` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- quadrats
SET @needs_convert := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quadrats'
      AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME <> @target_collation
      AND EXTRA NOT LIKE '%GENERATED%'
);
SET @ddl := IF(@needs_convert = 0,
    'SELECT ''quadrats collation ok'' AS Status',
    'ALTER TABLE `quadrats` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- trees
SET @needs_convert := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trees'
      AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME <> @target_collation
      AND EXTRA NOT LIKE '%GENERATED%'
);
SET @ddl := IF(@needs_convert = 0,
    'SELECT ''trees collation ok'' AS Status',
    'ALTER TABLE `trees` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- stems
SET @needs_convert := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stems'
      AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME <> @target_collation
      AND EXTRA NOT LIKE '%GENERATED%'
);
SET @ddl := IF(@needs_convert = 0,
    'SELECT ''stems collation ok'' AS Status',
    'ALTER TABLE `stems` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- measurement_error_log
SET @needs_convert := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'measurement_error_log'
      AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME <> @target_collation
      AND EXTRA NOT LIKE '%GENERATED%'
);
SET @ddl := IF(@needs_convert = 0,
    'SELECT ''measurement_error_log collation ok'' AS Status',
    'ALTER TABLE `measurement_error_log` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- uploadintegrityalerts
SET @needs_convert := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'uploadintegrityalerts'
      AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME <> @target_collation
      AND EXTRA NOT LIKE '%GENERATED%'
);
SET @ddl := IF(@needs_convert = 0,
    'SELECT ''uploadintegrityalerts collation ok'' AS Status',
    'ALTER TABLE `uploadintegrityalerts` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- uploadmetrics
SET @needs_convert := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'uploadmetrics'
      AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME <> @target_collation
      AND EXTRA NOT LIKE '%GENERATED%'
);
SET @ddl := IF(@needs_convert = 0,
    'SELECT ''uploadmetrics collation ok'' AS Status',
    'ALTER TABLE `uploadmetrics` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 2026-07-13-01 complete: temporarymeasurements columns + critical-table collation ensured.' AS Status;
