-- =====================================================================================
-- Catalog migration: background job tables
-- =====================================================================================
-- Ledger id: 2026-07-27-01-background-job-tables
--
-- Scope: the SHARED `catalog` database only. This migration must never contain a
-- site-schema statement — it runs exactly once per server through
-- scripts/apply-catalog-migrations.ts, not once per forestgeo_* schema. The
-- per-site manifest (db/migrations/manifest.ts) and its `schema_migrations`
-- ledger must never carry this id.
--
-- Purpose:
--   - durable upload/validation jobs that outlive the browser session
--   - user-visible progress, retry bookkeeping, and job event history
--
-- Every statement is additive and re-runnable (IF NOT EXISTS), so a partially
-- applied migration can be retried safely.
--
-- UNRELEASED FEATURE: these tables have never carried production data. Tables
-- left behind by the pre-migration app bootstrap may have an incompatible shape
-- (ENUM values 'created' / 'dead_lettered' / 'blob_received', or a LastMessageID
-- column). CREATE TABLE IF NOT EXISTS would silently leave such a table in place,
-- so the runner's read-only preflight classifies existing tables and fails closed
-- rather than letting this file paper over the drift.
-- =====================================================================================

CREATE DATABASE IF NOT EXISTS catalog CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS catalog.background_jobs
(
    JobID             BIGINT AUTO_INCREMENT PRIMARY KEY,
    JobType           ENUM ('upload_validation')                                                                                                         NOT NULL,
    Status            ENUM ('queued','running','cancel_requested','waiting_retry','completed','failed','cancelled')                          NOT NULL DEFAULT 'queued',
    Phase             ENUM ('queued','staging','ingestion','collapsing','validation','refreshing_views','completed','failed','cancelled')     NOT NULL DEFAULT 'queued',
    SchemaName        VARCHAR(64)                                                                                                                        NOT NULL,
    PlotID            INT                                                                                                                                NOT NULL,
    CensusID          INT                                                                                                                                NOT NULL,
    UploadMode        VARCHAR(32)                                                                                                                        NULL,
    SourceFormat      VARCHAR(32)                                                                                                                        NULL,
    FormType          VARCHAR(32)                                                                                                                        NULL,
    CreatedBy         VARCHAR(255)                                                                                                                       NOT NULL,
    IdempotencyKey    VARCHAR(255)                                                                                                                       NULL,
    PercentComplete   DECIMAL(5, 2)                                                                                                                      NOT NULL DEFAULT 0,
    TotalFiles        INT                                                                                                                                NOT NULL DEFAULT 0,
    TotalRows         INT                                                                                                                                NOT NULL DEFAULT 0,
    ProcessedRows     INT                                                                                                                                NOT NULL DEFAULT 0,
    FailedRows        INT                                                                                                                                NOT NULL DEFAULT 0,
    RetryCount        INT                                                                                                                                NOT NULL DEFAULT 0,
    MaxRetries        INT                                                                                                                                NOT NULL DEFAULT 3,
    NextAttemptAt     DATETIME                                                                                                                           NULL,
    LastError         TEXT                                                                                                                               NULL,
    WorkerID          VARCHAR(128)                                                                                                                       NULL,
    WorkerHeartbeatAt DATETIME                                                                                                                           NULL,
    Payload           JSON                                                                                                                               NULL,
    CreatedAt         DATETIME                                                                                                                           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt         DATETIME                                                                                                                           NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    StartedAt         DATETIME                                                                                                                           NULL,
    FinishedAt        DATETIME                                                                                                                           NULL,
    KEY idx_background_jobs_user_status (CreatedBy, Status, UpdatedAt),
    KEY idx_background_jobs_scope_status (SchemaName, PlotID, CensusID, Status),
    KEY idx_background_jobs_retry (Status, NextAttemptAt),
    UNIQUE KEY uq_background_jobs_user_idempotency (CreatedBy, IdempotencyKey)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS catalog.background_job_files
(
    JobFileID      BIGINT AUTO_INCREMENT PRIMARY KEY,
    JobID          BIGINT                                                                     NOT NULL,
    FileName       VARCHAR(512)                                                               NOT NULL,
    BlobContainer  VARCHAR(255)                                                               NOT NULL,
    BlobName       VARCHAR(1024)                                                              NOT NULL,
    ContentType    VARCHAR(255)                                                               NULL,
    ByteSize       BIGINT                                                                     NULL,
    ChecksumSHA256 CHAR(64)                                                                   NULL,
    SourceFormat   VARCHAR(32)                                                                NULL,
    FormType       VARCHAR(32)                                                                NULL,
    BatchID        VARCHAR(36)                                                                NULL,
    ExpectedRows   INT                                                                        NULL,
    ProcessedRows  INT                                                                        NOT NULL DEFAULT 0,
    FailedRows     INT                                                                        NOT NULL DEFAULT 0,
    Status         ENUM ('pending','staged','processed','failed','skipped')                   NOT NULL DEFAULT 'pending',
    ErrorMessage   TEXT                                                                       NULL,
    CreatedAt      DATETIME                                                                   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt      DATETIME                                                                   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_background_job_files_job
        FOREIGN KEY (JobID) REFERENCES catalog.background_jobs (JobID) ON DELETE CASCADE,
    KEY idx_background_job_files_job_status (JobID, Status),
    UNIQUE KEY uq_background_job_files_blob (JobID, BlobContainer, BlobName(255))
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS catalog.background_job_events
(
    EventID   BIGINT AUTO_INCREMENT PRIMARY KEY,
    JobID     BIGINT      NOT NULL,
    EventType VARCHAR(64) NOT NULL,
    Message   TEXT        NULL,
    Details   JSON        NULL,
    CreatedAt DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_background_job_events_job
        FOREIGN KEY (JobID) REFERENCES catalog.background_jobs (JobID) ON DELETE CASCADE,
    KEY idx_background_job_events_job_created (JobID, CreatedAt)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;
