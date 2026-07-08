-- =====================================================================================
-- Migration Script 40: Persist upload mode on upload_sessions
-- =====================================================================================
-- Purpose:
--   Add a `mode` column to upload_sessions so the chosen UploadMode
--   (clean_reupload | revisions | ...) is recorded for every session.
--
--   Without this, there is no way to retrospectively distinguish a CLEAN_REUPLOAD
--   session from a REVISIONS session — the mode previously lived only in the
--   client request body and was discarded after the request returned. That gap
--   makes it impossible to audit historical upload behavior, and in particular
--   it prevents anyone from telling whether a past species upload at a site
--   may have triggered a cascade-delete of measurement data.
--
--   This migration is purely additive: existing rows get NULL for the new
--   column. The application code is updated separately to write the value
--   on new sessions.
--
--   Idempotent via the conditional ALTER pattern below.
-- =====================================================================================

SET @col_exists := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'upload_sessions'
      AND COLUMN_NAME = 'mode'
);

SET @ddl := IF(@col_exists = 0,
    'ALTER TABLE upload_sessions ADD COLUMN mode VARCHAR(32) NULL AFTER idempotency_key',
    'SELECT ''upload_sessions.mode already exists'' AS Status'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 40 complete: upload_sessions.mode column ensured.' AS Status;
