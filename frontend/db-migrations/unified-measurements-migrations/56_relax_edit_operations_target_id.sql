-- =====================================================================================
-- Migration Script 56: Allow NULL TargetID for batch-scoped edit_operations ledger rows
-- =====================================================================================
-- Purpose:
--   Bulk revision-apply writes a single summary ledger row covering the full
--   batch. Previously TargetID held the first updated CoreMeasurementID as an
--   arbitrary sentinel, which was misleading for anyone filtering by TargetID.
--   The full set of affected IDs is already captured inside BeforeState JSON.
--
--   Making TargetID nullable lets batch rows store NULL (semantically honest:
--   no single measurement is "the" target) while single-row-edit and revert
--   rows continue to record the measurement they operated on.
--
-- Runtime pairing:
--   frontend/config/editoperations.ts::ensureEditOperationsTable converges a
--   freshly bootstrapped schema to the same shape.
-- =====================================================================================

SELECT IS_NULLABLE INTO @target_id_nullable
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'edit_operations'
  AND COLUMN_NAME = 'TargetID'
LIMIT 1;

SET @relax_target_id = IF(
  @target_id_nullable IS NOT NULL AND @target_id_nullable = 'NO',
  'ALTER TABLE edit_operations MODIFY COLUMN TargetID BIGINT NULL',
  'SELECT "edit_operations.TargetID already nullable" AS status'
);
PREPARE stmt FROM @relax_target_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 56 complete: edit_operations.TargetID is now nullable.' AS Status;
