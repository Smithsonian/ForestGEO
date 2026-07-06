-- =====================================================================================
-- Migration Script 37: Seed duplicate conflict ingestion error codes
-- =====================================================================================
-- Purpose:
--   - Register ingestion error codes used by duplicate conflict hard-failure
--     detection in bulkingestionprocess.
--   - Required by both migration runners once migration 37 is registered.
--   - Idempotent via INSERT IGNORE (safe to re-run).
-- =====================================================================================

INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
VALUES ('ingestion', 'DUPLICATE_TAG_CONFLICT', 'Conflicting duplicate TreeTag/StemTag rows detected in upload batch'),
       ('ingestion', 'DUPLICATE_TAG_CONFLICT_EXISTING', 'Conflicting TreeTag/StemTag matches existing census measurement');

SELECT 'Migration 37 complete: duplicate conflict ingestion error codes seeded.' AS Status;
