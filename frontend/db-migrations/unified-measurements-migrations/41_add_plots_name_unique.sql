-- =====================================================================================
-- Migration Script 41: Add UNIQUE (PlotName) to plots
-- =====================================================================================
-- Purpose:
--   The plots table previously had no uniqueness constraint on PlotName -- only the
--   PRIMARY KEY on PlotID. Two plots could share a name with no constraint blocking
--   it, which would silently corrupt any UI dropdown or upload context that resolves
--   a plot by name.
--
--   Cross-schema audit: every production schema (harvard, mpala, ngel_nyaki, panama,
--   rabi, serc, testing, testing_mason) currently has zero PlotName duplicates, so
--   this migration is non-defensive -- it adds the constraint directly. If a future
--   migration finds duplicates, the ALTER will fail loudly and the duplicates must
--   be resolved by hand before the constraint can be installed.
--
--   Idempotent via the conditional ALTER pattern.
-- =====================================================================================

SET @idx_exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'plots'
      AND INDEX_NAME   = 'uq_plots_plotname'
);

SET @ddl := IF(@idx_exists = 0,
    'ALTER TABLE plots ADD UNIQUE KEY uq_plots_plotname (PlotName)',
    'SELECT ''uq_plots_plotname already exists'' AS Status'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 41 complete: uq_plots_plotname ensured.' AS Status;
