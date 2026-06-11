import type { Pool } from 'mysql2/promise';

const BACKGROUND_JOB_BOOTSTRAP_STATEMENTS: readonly string[] = [
  `CREATE DATABASE IF NOT EXISTS catalog CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS catalog.background_jobs (
     JobID BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     JobType ENUM('upload_validation') NOT NULL,
     Status ENUM('created','queued','running','waiting_retry','completed','failed','cancelled','dead_lettered') NOT NULL DEFAULT 'created',
     Phase ENUM('created','blob_received','queued','staging','ingestion','collapsing','validation','refreshing_views','completed','failed','cancelled') NOT NULL DEFAULT 'created',
     SchemaName VARCHAR(64) NOT NULL,
     PlotID INT NOT NULL,
     CensusID INT NOT NULL,
     UploadMode VARCHAR(32) NULL,
     SourceFormat VARCHAR(32) NULL,
     FormType VARCHAR(32) NULL,
     CreatedBy VARCHAR(255) NOT NULL,
     IdempotencyKey VARCHAR(255) NULL,
     PercentComplete DECIMAL(5,2) NOT NULL DEFAULT 0,
     TotalFiles INT NOT NULL DEFAULT 0,
     TotalRows INT NOT NULL DEFAULT 0,
     ProcessedRows INT NOT NULL DEFAULT 0,
     FailedRows INT NOT NULL DEFAULT 0,
     RetryCount INT NOT NULL DEFAULT 0,
     MaxRetries INT NOT NULL DEFAULT 10,
     NextAttemptAt DATETIME NULL,
     LastError TEXT NULL,
     LastMessageID VARCHAR(128) NULL,
     WorkerID VARCHAR(128) NULL,
     WorkerHeartbeatAt DATETIME NULL,
     Payload JSON NULL,
     CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     StartedAt DATETIME NULL,
     FinishedAt DATETIME NULL,
     KEY idx_background_jobs_user_status (CreatedBy, Status, UpdatedAt),
     KEY idx_background_jobs_scope_status (SchemaName, PlotID, CensusID, Status),
     KEY idx_background_jobs_retry (Status, NextAttemptAt),
     UNIQUE KEY uq_background_jobs_user_idempotency (CreatedBy, IdempotencyKey)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS catalog.background_job_files (
     JobFileID BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     JobID BIGINT NOT NULL,
     FileName VARCHAR(512) NOT NULL,
     BlobContainer VARCHAR(255) NOT NULL,
     BlobName VARCHAR(1024) NOT NULL,
     ContentType VARCHAR(255) NULL,
     ByteSize BIGINT NULL,
     ChecksumSHA256 CHAR(64) NULL,
     SourceFormat VARCHAR(32) NULL,
     FormType VARCHAR(32) NULL,
     ExpectedRows INT NULL,
     ProcessedRows INT NOT NULL DEFAULT 0,
     FailedRows INT NOT NULL DEFAULT 0,
     Status ENUM('pending','staged','processed','failed','skipped') NOT NULL DEFAULT 'pending',
     ErrorMessage TEXT NULL,
     CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     CONSTRAINT fk_background_job_files_job
       FOREIGN KEY (JobID) REFERENCES catalog.background_jobs(JobID) ON DELETE CASCADE,
     KEY idx_background_job_files_job_status (JobID, Status),
     UNIQUE KEY uq_background_job_files_blob (JobID, BlobContainer, BlobName(255))
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS catalog.background_job_events (
     EventID BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
     JobID BIGINT NOT NULL,
     EventType VARCHAR(64) NOT NULL,
     Message TEXT NULL,
     Details JSON NULL,
     CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT fk_background_job_events_job
       FOREIGN KEY (JobID) REFERENCES catalog.background_jobs(JobID) ON DELETE CASCADE,
     KEY idx_background_job_events_job_created (JobID, CreatedAt)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
];

const catalogBootstrapPromises = new WeakMap<Pool, Promise<void>>();

async function runBackgroundJobCatalogBootstrap(catalogPool: Pool): Promise<void> {
  for (const statement of BACKGROUND_JOB_BOOTSTRAP_STATEMENTS) {
    await catalogPool.query(statement);
  }
}

export async function ensureBackgroundJobCatalogTables(catalogPool: Pool): Promise<void> {
  const cached = catalogBootstrapPromises.get(catalogPool);
  if (cached) return cached;

  const promise = runBackgroundJobCatalogBootstrap(catalogPool).catch(err => {
    catalogBootstrapPromises.delete(catalogPool);
    throw err;
  });
  catalogBootstrapPromises.set(catalogPool, promise);
  return promise;
}
