-- =====================================================================================
-- Performance Optimization: Add indexes for common query patterns (idempotent)
-- =====================================================================================
-- These indexes improve query performance for dashboard metrics and data grid operations
-- Estimated improvement: 50-200ms per complex query
--
-- Note: Uses prepared statements for idempotent index creation since MySQL doesn't
-- support CREATE INDEX IF NOT EXISTS syntax natively
-- =====================================================================================

SET @schema = DATABASE();

-- Helper procedure for idempotent index creation
DROP PROCEDURE IF EXISTS add_index_if_not_exists;
DELIMITER $$
CREATE PROCEDURE add_index_if_not_exists(
    IN p_table_name VARCHAR(64),
    IN p_index_name VARCHAR(64),
    IN p_columns VARCHAR(255)
)
BEGIN
    DECLARE v_exists INT DEFAULT 0;

    SELECT COUNT(*) INTO v_exists
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table_name
      AND INDEX_NAME = p_index_name;

    IF v_exists = 0 THEN
        SET @sql = CONCAT('CREATE INDEX ', p_index_name, ' ON ', p_table_name, '(', p_columns, ')');
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        SELECT CONCAT('Created index ', p_index_name, ' on ', p_table_name) AS status;
    ELSE
        SELECT CONCAT('Index ', p_index_name, ' already exists on ', p_table_name) AS status;
    END IF;
END$$
DELIMITER ;

-- =============================================================================
-- Core Measurements Indexes
-- =============================================================================

-- Note: Some indexes already exist on coremeasurements from the table structure
-- Only add additional indexes that don't exist

CALL add_index_if_not_exists('coremeasurements', 'idx_coremeasurements_census_plot', 'CensusID');
CALL add_index_if_not_exists('coremeasurements', 'idx_coremeasurements_census_plot_validation', 'CensusID, IsValidated');

-- =============================================================================
-- Stems Indexes
-- =============================================================================

-- Note: Most stem indexes already exist from the table structure
CALL add_index_if_not_exists('stems', 'idx_stems_censusid', 'CensusID');
CALL add_index_if_not_exists('stems', 'idx_stems_treeid_censusid', 'TreeID, CensusID');

-- =============================================================================
-- Tree Indexes
-- =============================================================================

CALL add_index_if_not_exists('trees', 'idx_trees_censusid', 'CensusID');

-- =============================================================================
-- Validation Indexes
-- =============================================================================

CALL add_index_if_not_exists('cmverrors', 'idx_cmverrors_coreMeasurementID', 'CoreMeasurementID');

-- =============================================================================
-- Upload Session Tracking Indexes
-- =============================================================================

-- Check if upload_sessions table exists before adding indexes
SELECT COUNT(*) INTO @upload_sessions_exists
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'upload_sessions';

-- These indexes are created by 00b_ensure_table_structures.sql, but verify they exist

-- =============================================================================
-- Cleanup helper procedure
-- =============================================================================
DROP PROCEDURE IF EXISTS add_index_if_not_exists;

-- =============================================================================
-- Verification and Statistics
-- =============================================================================

-- Show all indexes on key tables
SELECT
  TABLE_NAME,
  INDEX_NAME,
  GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS COLUMNS
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('coremeasurements', 'stems', 'trees', 'cmverrors', 'upload_sessions')
GROUP BY TABLE_NAME, INDEX_NAME
ORDER BY TABLE_NAME, INDEX_NAME;
