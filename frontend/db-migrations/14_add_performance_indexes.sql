-- Performance Optimization: Add indexes for common query patterns
-- These indexes improve query performance for dashboard metrics and data grid operations
-- Estimated improvement: 50-200ms per complex query

-- =============================================================================
-- Core Measurements Indexes
-- =============================================================================

-- Index for census-based queries (dashboard metrics, validation queries)
-- Covers queries filtering by CensusID
CREATE INDEX IF NOT EXISTS idx_coremeasurements_censusid
  ON coremeasurements(CensusID);

-- Composite index for census + plot queries (most common pattern)
-- Covers dashboard metrics and filtered data grids
CREATE INDEX IF NOT EXISTS idx_coremeasurements_census_plot
  ON coremeasurements(CensusID, PlotID);

-- Index for quadrat-based queries
CREATE INDEX IF NOT EXISTS idx_coremeasurements_quadratid
  ON coremeasurements(QuadratID);

-- Composite index for validation queries by census and plot
CREATE INDEX IF NOT EXISTS idx_coremeasurements_census_plot_validation
  ON coremeasurements(CensusID, PlotID, IsValidated);

-- =============================================================================
-- Stems Indexes
-- =============================================================================

-- Index for census-based stem queries
CREATE INDEX IF NOT EXISTS idx_stems_censusid
  ON stems(CensusID);

-- Composite index for tree-based queries
CREATE INDEX IF NOT EXISTS idx_stems_treeid_censusid
  ON stems(TreeID, CensusID);

-- Index for quadrat-based stem queries
CREATE INDEX IF NOT EXISTS idx_stems_quadratid
  ON stems(QuadratID);

-- =============================================================================
-- Tree Indexes
-- =============================================================================

-- Index for plot-based tree queries
CREATE INDEX IF NOT EXISTS idx_trees_plotid
  ON trees(PlotID);

-- Composite index for species queries
CREATE INDEX IF NOT EXISTS idx_trees_speciesid_plotid
  ON trees(SpeciesID, PlotID);

-- =============================================================================
-- Quadrat Indexes
-- =============================================================================

-- Index for plot-based quadrat queries (dashboard progress metrics)
CREATE INDEX IF NOT EXISTS idx_quadrats_plotid
  ON quadrats(PlotID);

-- Composite index for census quadrat queries
CREATE INDEX IF NOT EXISTS idx_quadrats_censusid_plotid
  ON quadrats(CensusID, PlotID);

-- =============================================================================
-- Personnel Indexes
-- =============================================================================

-- Index for active personnel queries
CREATE INDEX IF NOT EXISTS idx_personnel_censusid
  ON personnel(CensusID);

-- =============================================================================
-- Validation Indexes
-- =============================================================================

-- Index for validation error queries
CREATE INDEX IF NOT EXISTS idx_cmverrors_coreMeasurementID
  ON cmverrors(CoreMeasurementID);

-- Composite index for validation status queries
CREATE INDEX IF NOT EXISTS idx_cmverrors_censusid_plotid
  ON cmverrors(CensusID, PlotID);

-- =============================================================================
-- Upload Session Tracking Indexes (if table exists)
-- =============================================================================

-- Index for session-based queries
CREATE INDEX IF NOT EXISTS idx_upload_sessions_session_id
  ON upload_sessions(session_id);

-- Index for user-based session queries
CREATE INDEX IF NOT EXISTS idx_upload_sessions_user_id
  ON upload_sessions(user_id);

-- Composite index for active sessions
CREATE INDEX IF NOT EXISTS idx_upload_sessions_user_status
  ON upload_sessions(user_id, status);

-- =============================================================================
-- Verification and Statistics
-- =============================================================================

-- Show all newly created indexes
SELECT
  TABLE_NAME,
  INDEX_NAME,
  COLUMN_NAME,
  SEQ_IN_INDEX,
  INDEX_TYPE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND INDEX_NAME LIKE 'idx_%'
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;
