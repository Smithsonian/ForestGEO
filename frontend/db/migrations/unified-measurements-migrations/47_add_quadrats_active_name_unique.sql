-- =====================================================================================
-- Migration Script 47: Add UNIQUE (PlotID, QuadratName, IsActive) to quadrats
-- =====================================================================================
-- Purpose:
--   The quadrats table currently has two unique indexes -- unique_full_quadrat
--   on (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, IsActive)
--   and uq_quadrats_full on a generated unique_sig column -- both of which include
--   coordinate fields. Two quadrats with the same name in the same plot but with
--   different StartY values are allowed, which is exactly how Ngel Nyaki ended up
--   with quadrats '0437' and '0438' as adjacent 20x20 cells with the same name --
--   the resolver fans measurements out across both candidate quadrats and the
--   rows fail downstream.
--
--   This migration installs a tighter constraint: UNIQUE (PlotID, QuadratName,
--   IsActive). At most one IsActive=1 row per (plot, name) can exist, which is
--   what every name-based resolver assumes.
--
--   If pre-existing duplicates would block the constraint, the ALTER will fail
--   with MySQL's native ERROR 1062 ("Duplicate entry '<plot>-<name>-1' for key
--   'quadrats.uq_quadrats_active_name'") -- which already names the offending
--   key and pair. Auto-cleanup is intentionally NOT performed because the
--   duplicates may represent legitimate physical quadrats that need to be
--   RENAMED rather than merged, or may represent typos that need to be merged
--   with care to preserve downstream stems and measurements.
--
--   Idempotent via the conditional ALTER pattern.
-- =====================================================================================

SET @idx_exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'quadrats'
      AND INDEX_NAME   = 'uq_quadrats_active_name'
);

SET @ddl := IF(@idx_exists > 0,
    'SELECT ''uq_quadrats_active_name already exists'' AS Status',
    'ALTER TABLE quadrats ADD UNIQUE KEY uq_quadrats_active_name (PlotID, QuadratName, IsActive)'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 47 complete: uq_quadrats_active_name ensured.' AS Status;
