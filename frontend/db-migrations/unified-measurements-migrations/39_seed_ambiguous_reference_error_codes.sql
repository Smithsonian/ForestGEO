-- =====================================================================================
-- Migration Script 39: Seed ambiguous reference lookup error codes
-- =====================================================================================
-- Purpose:
--   Register AMBIGUOUS_QUADRAT and AMBIGUOUS_SPECIES ingestion error codes used by
--   bulkingestionprocess Stage 3 reference lookups. These fire when a quadrat name
--   or species code in an upload resolves to more than one active row in the
--   reference table, instead of letting the source row silently fan out into
--   multiple downstream candidates.
--
--   Idempotent via INSERT IGNORE (safe to re-run).
-- =====================================================================================

INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
VALUES ('ingestion', 'AMBIGUOUS_QUADRAT',
        'Quadrat name resolves to multiple active quadrats in the same plot'),
       ('ingestion', 'AMBIGUOUS_SPECIES',
        'Species code resolves to multiple active species records');

SELECT 'Migration 39 complete: ambiguous reference error codes seeded.' AS Status;
