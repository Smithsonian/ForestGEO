-- =====================================================================================
-- Migration Script 55: Extend edit_operations for bulk row audit records
-- =====================================================================================
-- Purpose:
--   - Allow revision apply to write audit-only bulk row ledger entries.
--   - Track whether a ledger row can be restored through the single-row revert path.
--
-- Runtime pairing:
--   `frontend/config/editoperations.ts::ensureEditOperationsTable` performs the
--   same upgrades at boot, so a schema that skipped this migration still converges.
-- =====================================================================================

SET @schema = DATABASE();

-- Widen OperationType only if 'bulk-revision-row' is not already in the enum.
-- Unconditional MODIFY COLUMN rebuilds table metadata on each run; gating keeps
-- re-runs against production schemas a no-op.
SELECT COLUMN_TYPE INTO @operation_type_def
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'edit_operations'
  AND COLUMN_NAME = 'OperationType'
LIMIT 1;

SET @alter_operation_type = IF(
  @operation_type_def IS NOT NULL AND INSTR(@operation_type_def, 'bulk-revision-row') = 0,
  'ALTER TABLE edit_operations MODIFY COLUMN OperationType ENUM(''single-row-edit'', ''bulk-revision-row'', ''revert'') NOT NULL',
  'SELECT "edit_operations.OperationType already includes bulk-revision-row" AS status'
);
PREPARE stmt FROM @alter_operation_type;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'edit_operations'
  AND COLUMN_NAME = 'Revertable';

SET @add_col = IF(@col_exists = 0,
  'ALTER TABLE edit_operations ADD COLUMN Revertable BOOLEAN NOT NULL DEFAULT TRUE AFTER OperationType',
  'SELECT "edit_operations.Revertable already exists" AS status');
PREPARE stmt FROM @add_col;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 55 complete: edit_operations bulk rows and revertability ensured.' AS Status;
