-- =====================================================================================
-- Migration Script 43: Add UNIQUE (ProcedureName) to sitespecificvalidations
-- =====================================================================================
-- Purpose:
--   The sitespecificvalidations table previously had no constraint on ProcedureName --
--   only the PRIMARY KEY on ValidationID. Two validation records could share a
--   procedure name, which would silently break any code that resolves a validation
--   by name (and there are several such call sites in the validation runner).
--
--   Cross-schema audit: zero ProcedureName duplicates anywhere, so this migration
--   adds the constraint directly. ProcedureName is NOT NULL so a single-column
--   unique key is sufficient and unambiguous.
--
--   Idempotent via the conditional ALTER pattern.
-- =====================================================================================

SET @idx_exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'sitespecificvalidations'
      AND INDEX_NAME   = 'uq_sitespecificvalidations_procedurename'
);

SET @ddl := IF(@idx_exists = 0,
    'ALTER TABLE sitespecificvalidations ADD UNIQUE KEY uq_sitespecificvalidations_procedurename (ProcedureName)',
    'SELECT ''uq_sitespecificvalidations_procedurename already exists'' AS Status'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 43 complete: uq_sitespecificvalidations_procedurename ensured.' AS Status;
