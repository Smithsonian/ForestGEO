-- =====================================================================================
-- Migration Framework: State Tracking and Helper Procedures
-- =====================================================================================
-- Purpose: Provides checkpoint/state management for database migrations
-- This enables:
--   - Resume from failure point
--   - Audit trail of execution
--   - Prevention of re-running completed steps
--   - Rollback capability
--
-- Usage: Run this FIRST before any migration scripts
-- =====================================================================================

-- =====================================================================================
-- SECTION 1: Migration State Table
-- =====================================================================================

CREATE TABLE IF NOT EXISTS migration_state (
    step_name VARCHAR(100) PRIMARY KEY,
    step_order INT NOT NULL,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    status ENUM('pending', 'running', 'completed', 'failed', 'skipped') DEFAULT 'pending',
    source_schema VARCHAR(64) NULL,
    target_schema VARCHAR(64) NULL,
    rows_affected INT DEFAULT 0,
    error_message TEXT NULL,
    execution_time_ms INT NULL,
    INDEX idx_status (status),
    INDEX idx_order (step_order)
);

-- =====================================================================================
-- SECTION 2: Migration Configuration Table
-- =====================================================================================

CREATE TABLE IF NOT EXISTS migration_config (
    config_key VARCHAR(100) PRIMARY KEY,
    config_value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- =====================================================================================
-- SECTION 3: Helper Procedures
-- =====================================================================================

-- Procedure: Initialize migration run
DROP PROCEDURE IF EXISTS migration_init;
DELIMITER $$
CREATE PROCEDURE migration_init(
    IN p_source_schema VARCHAR(64),
    IN p_target_schema VARCHAR(64),
    IN p_site_name VARCHAR(100),
    IN p_location_name VARCHAR(100),
    IN p_country_name VARCHAR(100)
)
BEGIN
    -- Store configuration for this migration run
    INSERT INTO migration_config (config_key, config_value) VALUES
        ('source_schema', p_source_schema),
        ('target_schema', p_target_schema),
        ('site_name', p_site_name),
        ('location_name', p_location_name),
        ('country_name', p_country_name),
        ('migration_started', NOW())
    ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);

    -- Initialize migration steps (aligned with provisioning system checkpoints)
    INSERT IGNORE INTO migration_state (step_name, step_order, status) VALUES
        ('00_reset_schema', 0, 'pending'),
        ('01_create_mapping_tables', 1, 'pending'),
        ('02_migrate_plots', 2, 'pending'),
        ('03_migrate_quadrats', 3, 'pending'),
        ('04_migrate_taxonomy', 4, 'pending'),
        ('05_migrate_census', 5, 'pending'),
        ('06_migrate_trees', 6, 'pending'),
        ('07_migrate_stems', 7, 'pending'),
        ('08_migrate_coremeasurements', 8, 'pending'),
        ('09_migrate_attributes', 9, 'pending'),
        ('10_validate_migration', 10, 'pending'),
        ('11_apply_schema_changes', 11, 'pending'),
        ('12_deploy_procedures', 12, 'pending'),
        ('13_cleanup', 13, 'pending');

    SELECT 'Migration initialized' AS status,
           p_source_schema AS source_schema,
           p_target_schema AS target_schema;
END$$
DELIMITER ;

-- Procedure: Start a migration step
DROP PROCEDURE IF EXISTS migration_step_start;
DELIMITER $$
CREATE PROCEDURE migration_step_start(IN p_step_name VARCHAR(100))
BEGIN
    DECLARE v_already_completed INT DEFAULT 0;

    -- Check if already completed
    SELECT COUNT(*) INTO v_already_completed
    FROM migration_state
    WHERE step_name = p_step_name AND status = 'completed';

    IF v_already_completed > 0 THEN
        SELECT CONCAT('Step "', p_step_name, '" already completed, skipping') AS status;
        UPDATE migration_state SET status = 'skipped' WHERE step_name = p_step_name;
        -- Signal to caller that this step should be skipped
        SET @migration_skip_step = 1;
    ELSE
        UPDATE migration_state
        SET status = 'running',
            started_at = NOW(),
            error_message = NULL
        WHERE step_name = p_step_name;

        SET @migration_skip_step = 0;
        SELECT CONCAT('Starting step: ', p_step_name) AS status;
    END IF;
END$$
DELIMITER ;

-- Procedure: Complete a migration step successfully
DROP PROCEDURE IF EXISTS migration_step_complete;
DELIMITER $$
CREATE PROCEDURE migration_step_complete(
    IN p_step_name VARCHAR(100),
    IN p_rows_affected INT
)
BEGIN
    DECLARE v_start_time TIMESTAMP;

    SELECT started_at INTO v_start_time
    FROM migration_state WHERE step_name = p_step_name;

    UPDATE migration_state
    SET status = 'completed',
        completed_at = NOW(),
        rows_affected = p_rows_affected,
        execution_time_ms = TIMESTAMPDIFF(MICROSECOND, v_start_time, NOW()) / 1000
    WHERE step_name = p_step_name;

    SELECT CONCAT('Completed step: ', p_step_name, ' (', p_rows_affected, ' rows)') AS status;
END$$
DELIMITER ;

-- Procedure: Mark a migration step as failed
DROP PROCEDURE IF EXISTS migration_step_fail;
DELIMITER $$
CREATE PROCEDURE migration_step_fail(
    IN p_step_name VARCHAR(100),
    IN p_error_message TEXT
)
BEGIN
    UPDATE migration_state
    SET status = 'failed',
        completed_at = NOW(),
        error_message = p_error_message
    WHERE step_name = p_step_name;

    SELECT CONCAT('FAILED step: ', p_step_name) AS status, p_error_message AS error;
END$$
DELIMITER ;

-- Procedure: Get migration progress
DROP PROCEDURE IF EXISTS migration_progress;
DELIMITER $$
CREATE PROCEDURE migration_progress()
BEGIN
    SELECT
        step_order,
        step_name,
        status,
        rows_affected,
        execution_time_ms,
        CASE
            WHEN status = 'completed' THEN 'OK'
            WHEN status = 'running' THEN 'IN PROGRESS'
            WHEN status = 'failed' THEN CONCAT('ERROR: ', LEFT(error_message, 50))
            ELSE '-'
        END AS details
    FROM migration_state
    ORDER BY step_order;

    SELECT
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_steps,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_steps,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_steps,
        COUNT(*) AS total_steps,
        ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 1) AS progress_pct
    FROM migration_state;
END$$
DELIMITER ;

-- Procedure: Reset migration to start fresh
DROP PROCEDURE IF EXISTS migration_reset;
DELIMITER $$
CREATE PROCEDURE migration_reset()
BEGIN
    UPDATE migration_state
    SET status = 'pending',
        started_at = NULL,
        completed_at = NULL,
        rows_affected = 0,
        error_message = NULL,
        execution_time_ms = NULL;

    SELECT 'Migration state reset to pending' AS status;
END$$
DELIMITER ;

-- Procedure: Resume migration from last successful checkpoint
DROP PROCEDURE IF EXISTS migration_get_resume_point;
DELIMITER $$
CREATE PROCEDURE migration_get_resume_point()
BEGIN
    SELECT step_name, step_order
    FROM migration_state
    WHERE status IN ('pending', 'failed')
    ORDER BY step_order
    LIMIT 1;
END$$
DELIMITER ;

-- Procedure: Add index if not exists (reusable helper)
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
    END IF;
END$$
DELIMITER ;

-- Procedure: Add column if not exists (reusable helper)
DROP PROCEDURE IF EXISTS add_column_if_not_exists;
DELIMITER $$
CREATE PROCEDURE add_column_if_not_exists(
    IN p_table_name VARCHAR(64),
    IN p_column_name VARCHAR(64),
    IN p_column_def VARCHAR(255)
)
BEGIN
    DECLARE v_exists INT DEFAULT 0;

    SELECT COUNT(*) INTO v_exists
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table_name
      AND COLUMN_NAME = p_column_name;

    IF v_exists = 0 THEN
        SET @sql = CONCAT('ALTER TABLE ', p_table_name, ' ADD COLUMN ', p_column_name, ' ', p_column_def);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

-- Procedure: Get config value
DROP PROCEDURE IF EXISTS get_migration_config;
DELIMITER $$
CREATE PROCEDURE get_migration_config(IN p_key VARCHAR(100), OUT p_value TEXT)
BEGIN
    SELECT config_value INTO p_value
    FROM migration_config
    WHERE config_key = p_key;
END$$
DELIMITER ;

-- =====================================================================================
-- SECTION 4: Verification
-- =====================================================================================

SELECT 'Migration framework installed successfully' AS status,
       DATABASE() AS target_schema,
       NOW() AS installed_at;

-- Show available procedures
SELECT ROUTINE_NAME, ROUTINE_TYPE
FROM INFORMATION_SCHEMA.ROUTINES
WHERE ROUTINE_SCHEMA = DATABASE()
  AND ROUTINE_NAME LIKE 'migration%'
ORDER BY ROUTINE_NAME;
