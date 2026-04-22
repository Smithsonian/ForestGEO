-- =====================================================================================
-- Migration Script 55: Extend edit_operations for bulk row audit records
-- =====================================================================================
-- Purpose:
--   - Allow revision apply to write audit-only bulk row ledger entries.
--   - Track whether a ledger row can be restored through the single-row revert path.
-- =====================================================================================

SET @schema = DATABASE();

ALTER TABLE edit_operations
  MODIFY COLUMN OperationType ENUM('single-row-edit', 'bulk-revision-row', 'revert') NOT NULL;

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
