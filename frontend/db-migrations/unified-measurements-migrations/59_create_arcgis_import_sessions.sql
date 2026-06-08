-- =====================================================================================
-- Migration Script 59: Create ArcGIS import staging tables
-- =====================================================================================
-- Purpose:
--   Persist ArcGIS workbook pre-flight rows server-side so the final upload step can
--   commit staged rows to temporarymeasurements without re-uploading workbook content.
--
--   The committed_* columns make each staged import single-use: repeated commit calls
--   for the same BatchID can return idempotently, while a second BatchID is rejected.
--
--   Idempotent via CREATE TABLE IF NOT EXISTS plus conditional ALTER/INDEX statements.
-- =====================================================================================

CREATE TABLE IF NOT EXISTS arcgis_import_sessions (
    import_session_id          VARCHAR(64)  NOT NULL PRIMARY KEY,
    plot_id                    INT          NOT NULL,
    census_id                  INT          NOT NULL,
    user_id                    VARCHAR(255) NOT NULL,
    file_id                    VARCHAR(255) NOT NULL,
    row_count                  INT          NOT NULL,
    warning_count              INT          NOT NULL,
    summary_json               JSON         NOT NULL,
    warnings_json              JSON         NOT NULL,
    state                      VARCHAR(32)  NOT NULL DEFAULT 'preflight',
    committed_file_id          VARCHAR(255) NULL,
    committed_batch_id         VARCHAR(64)  NULL,
    committed_upload_session_id VARCHAR(64) NULL,
    committed_row_count        INT          NULL,
    committed_at               TIMESTAMP    NULL,
    created_at                 TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                 TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_arcgis_import_scope (plot_id, census_id, user_id, state),
    KEY idx_arcgis_import_committed_batch (committed_batch_id),
    KEY idx_arcgis_import_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'arcgis_import_sessions'
      AND COLUMN_NAME = 'committed_file_id'
);
SET @ddl := IF(@col_exists = 0,
    'ALTER TABLE arcgis_import_sessions ADD COLUMN committed_file_id VARCHAR(255) NULL AFTER state',
    'SELECT ''arcgis_import_sessions.committed_file_id already exists'' AS Status'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'arcgis_import_sessions'
      AND COLUMN_NAME = 'committed_batch_id'
);
SET @ddl := IF(@col_exists = 0,
    'ALTER TABLE arcgis_import_sessions ADD COLUMN committed_batch_id VARCHAR(64) NULL AFTER committed_file_id',
    'SELECT ''arcgis_import_sessions.committed_batch_id already exists'' AS Status'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'arcgis_import_sessions'
      AND COLUMN_NAME = 'committed_upload_session_id'
);
SET @ddl := IF(@col_exists = 0,
    'ALTER TABLE arcgis_import_sessions ADD COLUMN committed_upload_session_id VARCHAR(64) NULL AFTER committed_batch_id',
    'SELECT ''arcgis_import_sessions.committed_upload_session_id already exists'' AS Status'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'arcgis_import_sessions'
      AND COLUMN_NAME = 'committed_row_count'
);
SET @ddl := IF(@col_exists = 0,
    'ALTER TABLE arcgis_import_sessions ADD COLUMN committed_row_count INT NULL AFTER committed_upload_session_id',
    'SELECT ''arcgis_import_sessions.committed_row_count already exists'' AS Status'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'arcgis_import_sessions'
      AND COLUMN_NAME = 'committed_at'
);
SET @ddl := IF(@col_exists = 0,
    'ALTER TABLE arcgis_import_sessions ADD COLUMN committed_at TIMESTAMP NULL AFTER committed_row_count',
    'SELECT ''arcgis_import_sessions.committed_at already exists'' AS Status'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'arcgis_import_sessions'
      AND INDEX_NAME = 'idx_arcgis_import_committed_batch'
);
SET @ddl := IF(@idx_exists = 0,
    'CREATE INDEX idx_arcgis_import_committed_batch ON arcgis_import_sessions (committed_batch_id)',
    'SELECT ''idx_arcgis_import_committed_batch already exists'' AS Status'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS arcgis_import_rows (
    import_session_id VARCHAR(64) NOT NULL,
    row_index         INT         NOT NULL,
    row_json          JSON        NOT NULL,
    PRIMARY KEY (import_session_id, row_index),
    CONSTRAINT fk_arcgis_import_rows_session
        FOREIGN KEY (import_session_id)
        REFERENCES arcgis_import_sessions(import_session_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT 'Migration 59 complete: ArcGIS import staging tables ensured.' AS Status;
