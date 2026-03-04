-- =====================================================================================
-- Migration Script 23: Redeploy bulkingestionprocess (eliminate failedmeasurements)
-- =====================================================================================
-- Purpose:
--   - Redeploy the rewritten bulkingestionprocess stored procedure that writes failures
--     directly to coremeasurements (StemGUID=NULL) + measurement_error_log instead of
--     the legacy failedmeasurements table.
--   - Drop legacy failedmeasurements-only procedures (reingestfailedrows,
--     refresh_failedmeasurements_current, reviewfailed).
--
-- IMPORTANT: This migration MUST run BEFORE migration 22 (deprecate_legacy_error_tables).
-- Migration 22's safety check queries INFORMATION_SCHEMA.ROUTINES for references to
-- 'failedmeasurements'. Once this migration removes those references, migration 22
-- will proceed with the DROP TABLE.
--
-- The canonical source for the stored procedure is:
--   frontend/sqlscripting/storedprocedures.sql
--
-- To apply: Run the full storedprocedures.sql against the target schema, which includes
-- the rewritten bulkingestionprocess and drops the legacy procedures.
-- =====================================================================================

-- Drop legacy procedures that operated on failedmeasurements
DROP PROCEDURE IF EXISTS reingestfailedrows;
DROP PROCEDURE IF EXISTS reviewfailed;
DROP PROCEDURE IF EXISTS refresh_failedmeasurements_current;

-- Drop the old version of bulkingestionprocess
DROP PROCEDURE IF EXISTS bulkingestionprocess;

-- NOTE: The new bulkingestionprocess is deployed automatically by
-- 00_run_all_migrations.sh which sources ../sqlscripting/storedprocedures.sql
-- immediately after this migration.

SELECT 'Migration 23: Legacy failedmeasurements procedures dropped. storedprocedures.sql will be deployed next.' AS Status;
