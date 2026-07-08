-- =====================================================================================
-- Migration Script 33: Redeploy RefreshMeasurementsSummary via storedprocedures.sql
-- =====================================================================================
-- Purpose:
--   - Force existing fully-migrated schemas back through the canonical
--     storedprocedures.sql deployment path so they pick up the updated
--     RefreshMeasurementsSummary procedure.
--   - No schema/table changes are required here; the runner redeploys the
--     procedures immediately after recording this migration.
-- =====================================================================================

SELECT 'Migration 33: storedprocedures.sql will be redeployed to refresh RefreshMeasurementsSummary.' AS Status;
