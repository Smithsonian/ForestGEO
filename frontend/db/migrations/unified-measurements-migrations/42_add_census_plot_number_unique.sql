-- =====================================================================================
-- Migration Script 42: Add UNIQUE (PlotID, PlotCensusNumber) to census
-- =====================================================================================
-- Purpose:
--   The census table previously had no constraint on (PlotID, PlotCensusNumber) --
--   only the PRIMARY KEY on CensusID. Two census records for the same plot/number
--   could coexist, which would silently break any UI lookup or stored procedure
--   that selects a census by (plot, number).
--
--   Cross-schema audit: zero (PlotID, PlotCensusNumber) duplicates anywhere, so this
--   migration adds the constraint directly. Failing-loud-on-conflict is enforced by
--   MySQL itself if a future state ever introduces duplicates.
--
--   Idempotent via the conditional ALTER pattern.
-- =====================================================================================

SET @idx_exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'census'
      AND INDEX_NAME   = 'uq_census_plot_number'
);

SET @ddl := IF(@idx_exists = 0,
    'ALTER TABLE census ADD UNIQUE KEY uq_census_plot_number (PlotID, PlotCensusNumber)',
    'SELECT ''uq_census_plot_number already exists'' AS Status'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 42 complete: uq_census_plot_number ensured.' AS Status;
