-- =====================================================================================
-- Migration Script 31: Enforce one active upload session per plot/census scope
-- =====================================================================================
-- Purpose:
--   - Add a generated scope key that is only populated for active upload states.
--   - Ensure at most one active upload session can own a given schema/plot/census.
--   - Abandon duplicate active sessions before adding the unique index so upgrades
--     can proceed safely on dirty environments.
-- =====================================================================================

SET @tbl = 'upload_sessions';
SET @col = 'active_scope_key';
SET @idx = 'uq_upload_sessions_active_scope';

SET @q = (
    SELECT IF(
        COUNT(*) > 0,
        'SELECT 1',
        CONCAT(
            'ALTER TABLE ', @tbl, ' ADD COLUMN ', @col, ' VARCHAR(255) ',
            'GENERATED ALWAYS AS (CASE ',
            'WHEN state IN (''initialized'', ''uploading'', ''uploaded'', ''processing'', ''collapsing'') ',
            'THEN CONCAT_WS(''#'', schema_name, plot_id, census_id) ',
            'ELSE NULL END) STORED'
        )
    )
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = @tbl
      AND COLUMN_NAME = @col
    LIMIT 1
);
PREPARE stmt FROM @q;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

WITH ranked_sessions AS (
    SELECT
        session_id,
        ROW_NUMBER() OVER (
            PARTITION BY schema_name, plot_id, census_id
            ORDER BY last_heartbeat DESC, updated_at DESC, created_at DESC, session_id DESC
        ) AS row_num
    FROM upload_sessions
    WHERE state IN ('initialized', 'uploading', 'uploaded', 'processing', 'collapsing')
)
UPDATE upload_sessions target
INNER JOIN ranked_sessions ranked
    ON ranked.session_id = target.session_id
SET target.state = 'abandoned',
    target.error_message = CONCAT_WS(' | ', NULLIF(target.error_message, ''), 'Superseded while enforcing active scope lock')
WHERE ranked.row_num > 1;

SET @q = (
    SELECT IF(
        COUNT(*) > 0,
        'SELECT 1',
        CONCAT('ALTER TABLE ', @tbl, ' ADD UNIQUE INDEX `', @idx, '` (', @col, ')')
    )
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = @tbl
      AND INDEX_NAME = @idx
    LIMIT 1
);
PREPARE stmt FROM @q;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 31 complete: upload session active scope lock ensured.' AS Status;
