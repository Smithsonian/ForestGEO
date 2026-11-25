-- =====================================================================================
-- Migration 2026-11-11-01: ensure measurementssummary has idx_mss_plot_census_scope
-- =====================================================================================
-- Every View Data query scopes measurementssummary by PlotID and CensusID. Without a
-- composite index MySQL intersects idx_censusid with idx_plotid (plot 1 holds every
-- Mpala census, so idx_plotid alone matches ~932k rows) and then fetches full rows
-- from the table: ~1.35 s per query before any real work, counts included. With the
-- scope columns in one index the scope is a single range scan, and the count queries
-- and the deferred join's inner query are answered from the index alone.
-- ALGORITHM=INPLACE, LOCK=NONE: a secondary index build permits concurrent DML and
-- fails fast, instead of silently copying the table, if that cannot be honoured.

SET @index_exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'measurementssummary'
      AND INDEX_NAME = 'idx_mss_plot_census_scope'
);
SET @ddl := IF(@index_exists > 0,
    'SELECT ''measurementssummary.idx_mss_plot_census_scope already present'' AS Status',
    'CREATE INDEX `idx_mss_plot_census_scope` ON `measurementssummary` (`PlotID`, `CensusID`, `MeasurementDate`, `StemGUID`, `IsValidated`) ALGORITHM=INPLACE LOCK=NONE'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 2026-11-11-01 complete: measurementssummary plot/census scope index ensured.' AS Status;
