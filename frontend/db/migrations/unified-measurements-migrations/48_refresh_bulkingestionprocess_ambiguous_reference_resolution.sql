-- =====================================================================================
-- Migration Script 48: Redeploy bulkingestionprocess for ambiguous-reference hardening
-- =====================================================================================
-- Purpose:
--   - Force existing schemas that have applied migrations 39-47 back through the
--     canonical storedprocedures.sql deployment path so bulkingestionprocess picks
--     up the Stage 3 ambiguous quadrat/species resolution changes from Phase 1.
--   - No table changes are required here; the migration runner redeploys
--     storedprocedures.sql immediately after recording this migration.
-- =====================================================================================

SELECT 'Migration 48: storedprocedures.sql will be redeployed to refresh bulkingestionprocess ambiguity handling.' AS Status;
