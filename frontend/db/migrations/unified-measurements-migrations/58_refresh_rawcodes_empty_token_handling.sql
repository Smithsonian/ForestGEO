-- =====================================================================================
-- Migration Script 58: Refresh RawCodes parsing to ignore empty semicolon tokens
-- =====================================================================================
-- Purpose:
--   - Force existing schemas back through the canonical storedprocedures.sql
--     deployment path so bulkingestionprocess and ValidationID 14 ignore empty
--     tokens created by doubled, leading, or trailing semicolons in RawCodes.
--   - No table changes are required here; the migration runner redeploys
--     storedprocedures.sql immediately after recording this migration.
-- =====================================================================================

SELECT 'Migration 58: storedprocedures.sql will be redeployed to ignore empty RawCodes tokens.' AS Status;
