-- Provisioning run state tables. Live in the catalog schema, not in per-site
-- schemas, because they coordinate cross-schema work.

CREATE TABLE IF NOT EXISTS catalog.provisioning_runs (
  RunID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  Status ENUM('running','completed','failed','aborted') NOT NULL,
  StartedBy VARCHAR(255) NOT NULL,
  StartedAt DATETIME NOT NULL,
  FinishedAt DATETIME NULL,
  SiteName VARCHAR(255) NOT NULL,
  SchemaName VARCHAR(255) NOT NULL,
  InputPayload JSON NOT NULL,
  KEY idx_provisioning_runs_schema (SchemaName),
  KEY idx_provisioning_runs_status (Status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS catalog.provisioning_steps (
  StepID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  RunID INT NOT NULL,
  StepIndex INT NOT NULL,
  StepKey VARCHAR(64) NOT NULL,
  Status ENUM('pending','running','completed','failed','skipped') NOT NULL,
  StartedAt DATETIME NULL,
  FinishedAt DATETIME NULL,
  ErrorMessage TEXT NULL,
  ErrorStack TEXT NULL,
  CONSTRAINT fk_provisioning_steps_run
    FOREIGN KEY (RunID) REFERENCES catalog.provisioning_runs(RunID) ON DELETE CASCADE,
  UNIQUE KEY uk_provisioning_steps_run_index (RunID, StepIndex)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
