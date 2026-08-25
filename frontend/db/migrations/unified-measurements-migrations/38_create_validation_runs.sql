-- =====================================================================================
-- Migration Script 38: Create validation_runs table
-- =====================================================================================
-- Purpose:
--   - Track background validation run state across page reloads
--   - One row per validation run (PlotID + CensusID combination)
--   - Enables client-driven orchestration with server-side persistence
-- =====================================================================================

CREATE TABLE IF NOT EXISTS validation_runs (
    RunID          INT AUTO_INCREMENT PRIMARY KEY,
    PlotID         INT NOT NULL,
    CensusID       INT NOT NULL,
    Status         ENUM('running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'running',
    TotalSteps     INT NOT NULL DEFAULT 0,
    CompletedSteps INT NOT NULL DEFAULT 0,
    FailedSteps    INT NOT NULL DEFAULT 0,
    CurrentStep    VARCHAR(100) NULL,
    ErrorMessages  JSON NULL,
    StartedAt      DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CompletedAt    DATETIME NULL,
    INDEX idx_validation_runs_active (PlotID, CensusID, Status)
);

SELECT 'validation_runs table created successfully' AS Status;
