-- =====================================================================================
-- Catalog migration: schema contract gate
-- =====================================================================================
-- Ledger id: 2026-09-02-01-schema-contract-gate
--
-- Scope: the SHARED `catalog` database only. Runs exactly once per server through
-- scripts/apply-catalog-migrations.ts, never once per forestgeo_* schema. The
-- per-site manifest (db/migrations/manifest.ts) must never carry this id.
--
-- Purpose: one row per site schema recording the outcome of the deploy-time schema
-- contract gate (scripts/apply-schema-migrations.ts --all-sites --apply).
--   LastPassedAt      last time the schema passed migrate + audit
--   LastFailedAt      last time it failed
--   QuarantinedAt     set when a schema that has NEVER passed fails; cleared on pass
--   QuarantineReason  the audit lines that caused the quarantine
--   LastRunRef        Actions run URL, or local:<hostname>
--
-- A schema that has passed before and then fails is NOT quarantined: that is a
-- regression this deploy introduced, so the gate blocks. Quarantine is only for a
-- schema that has never reached a verified contract, so one such site cannot take
-- the whole deploy down. See #429.
--
-- Written only by the deploy scripts (scripts/lib/schema-gate.ts). Read by
-- check-schema-contract, the procedure and view sweeps, and lib/schema-quarantine.ts
-- (API refusal). Every statement is additive and re-runnable.
-- =====================================================================================

CREATE DATABASE IF NOT EXISTS catalog CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS catalog.schema_contract_gate
(
    SchemaName       VARCHAR(64)  NOT NULL PRIMARY KEY,
    LastPassedAt     DATETIME     NULL,
    LastFailedAt     DATETIME     NULL,
    QuarantinedAt    DATETIME     NULL,
    QuarantineReason TEXT         NULL,
    LastRunRef       VARCHAR(255) NULL,
    UpdatedAt        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;
