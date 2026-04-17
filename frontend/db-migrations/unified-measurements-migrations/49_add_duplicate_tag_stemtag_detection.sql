-- =====================================================================================
-- Migration Script 49: Within-batch TreeTag+StemTag collision detection
-- =====================================================================================
-- Purpose:
--   - Register the new DUPLICATE_TAG_STEMTAG ingestion error code so the
--     hard-failure pipeline can map ErrorCode -> ErrorID for collision rows.
--   - Force existing schemas through the canonical storedprocedures.sql
--     deployment path so bulkingestionprocess picks up the new Stage 2b
--     within-batch TreeTag+StemTag collision detection block.
--   - No table structure changes. The migration runner redeploys
--     storedprocedures.sql immediately after recording this migration.
-- =====================================================================================

INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
VALUES ('ingestion', 'DUPLICATE_TAG_STEMTAG', 'Duplicate TreeTag/StemTag within upload batch');

SELECT 'Migration 49: DUPLICATE_TAG_STEMTAG registered; storedprocedures.sql will be redeployed to enable Stage 2b collision detection.' AS Status;
