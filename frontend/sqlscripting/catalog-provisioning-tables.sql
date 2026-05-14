-- Provisioning run state tables. Live in the catalog schema, not in per-site
-- schemas, because they coordinate cross-schema work.

CREATE DATABASE IF NOT EXISTS catalog
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS catalog.provisioning_runs (
  RunID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  Status ENUM('running','completed','failed','aborted') NOT NULL,
  StartedBy VARCHAR(255) NOT NULL,
  StartedAt DATETIME NOT NULL,
  FinishedAt DATETIME NULL,
  WorkerHeartbeatAt DATETIME NULL,
  WorkerPID VARCHAR(64) NULL,
  SiteName VARCHAR(255) NOT NULL,
  SchemaName VARCHAR(255) NOT NULL,
  InputPayload JSON NOT NULL,
  KEY idx_provisioning_runs_schema (SchemaName),
  KEY idx_provisioning_runs_status (Status),
  KEY idx_provisioning_runs_heartbeat (Status, WorkerHeartbeatAt)
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

-- Idempotent migration for existing installs. The CREATE TABLE above already
-- includes the heartbeat columns on fresh installs. This block adds them to
-- previously-deployed catalogs the first time this DDL file is replayed.
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = 'catalog' AND TABLE_NAME = 'provisioning_runs' AND COLUMN_NAME = 'WorkerHeartbeatAt');
SET @stmt := IF(@col_exists = 0,
  'ALTER TABLE catalog.provisioning_runs ADD COLUMN WorkerHeartbeatAt DATETIME NULL AFTER FinishedAt, ADD COLUMN WorkerPID VARCHAR(64) NULL AFTER WorkerHeartbeatAt, ADD KEY idx_provisioning_runs_heartbeat (Status, WorkerHeartbeatAt)',
  'SELECT 1');
PREPARE migrate_heartbeat FROM @stmt;
EXECUTE migrate_heartbeat;
DEALLOCATE PREPARE migrate_heartbeat;
