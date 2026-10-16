-- =====================================================================================
-- Migration 2026-10-14-02: backfill edit_operations history into unifiedchangelog
-- =====================================================================================
-- #507: one-time backfill of edit_operations rows written before writeEditOperation's
-- dual-write, using the SAME mapping as edit-operation-projection.ts:
--   single-row-edit / revert : pairs BeforeState/AfterState by (table, primaryKeyValue);
--     after-only -> INSERT (Branch 1), changed both-sides -> UPDATE (Branch 2),
--     before-only -> DELETE (Branch 3); value-equal JSON (either key order) is a no-op.
--   bulk-revision-row : one UPDATE per entry from BeforeState[0] (Branch 4), tagged
--     summaryKind = 'bulk-revision-apply' — a summary, never a row diff.
--   species_correction_metadata rows are undo bookkeeping, not a real table;
--     Branches 1-3 exclude them.
--
-- RecordID `${primaryKeyValue}::edit-op-${EditOperationID}` matches the dual-write's
-- scheme; the NOT EXISTS guard on every INSERT skips entries already dual-written,
-- so this is safe to run at any time and a no-op on rerun. CreatedBy/CreatedAt/
-- PlotID/CensusID are carried from the original ledger row, preserving the original
-- author and timestamp rather than the migration's own.
--
-- edit_operations has no entry in tablestructures.sql or the migration manifest —
-- it's created lazily by ensureEditOperationsTable() on first write, so CREATE
-- TABLE IF NOT EXISTS below is required before the INSERT ... SELECT statements.
--
-- Every JSON_TABLE string column pins COLLATE utf8mb4_0900_ai_ci (the schema contract
-- collation). Unpinned, those columns inherit the session collation, and the deploy
-- runner's mysql2 connection negotiates utf8mb4_unicode_ci, so each comparison with a
-- unifiedchangelog column fails with "Illegal mix of collations".
-- =====================================================================================

CREATE TABLE IF NOT EXISTS edit_operations (
    EditOperationID INT AUTO_INCREMENT PRIMARY KEY,
    OperationType ENUM('single-row-edit', 'bulk-revision-row', 'revert') NOT NULL,
    Revertable BOOLEAN NOT NULL DEFAULT TRUE,
    DataType ENUM('measurementssummary', 'failedmeasurements') NOT NULL,
    TargetID BIGINT NULL,
    PlotID INT NOT NULL,
    CensusID INT NOT NULL,
    PlanHash CHAR(64) NOT NULL,
    BeforeState JSON NOT NULL,
    AfterState JSON NOT NULL,
    CreatedBy VARCHAR(255) NOT NULL,
    CreatedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    RevertedByEditOperationID INT NULL,
    INDEX idx_edit_operations_target (DataType, TargetID, CreatedAt DESC),
    INDEX idx_edit_operations_scope (PlotID, CensusID, CreatedAt DESC),
    INDEX idx_edit_operations_reverted (RevertedByEditOperationID),
    CONSTRAINT fk_edit_operations_revert
        FOREIGN KEY (RevertedByEditOperationID)
        REFERENCES edit_operations(EditOperationID)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Branch 1: INSERT — an AfterState key with no materialized row in BeforeState.
INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
SELECT
    a.tbl,
    CONCAT(a.pkval, '::edit-op-', eo.EditOperationID),
    'INSERT',
    NULL,
    a.row_json,
    eo.CreatedAt,
    LEFT(eo.CreatedBy, 64),
    IF(eo.PlotID > 0, eo.PlotID, NULL),
    IF(eo.CensusID > 0, eo.CensusID, NULL)
FROM edit_operations eo
JOIN JSON_TABLE(
    eo.AfterState, '$[*]'
    COLUMNS (
        tbl VARCHAR(64) COLLATE utf8mb4_0900_ai_ci PATH '$.table',
        pkval VARCHAR(255) COLLATE utf8mb4_0900_ai_ci PATH '$.primaryKeyValue',
        row_json JSON PATH '$.row'
    )
) a ON a.row_json IS NOT NULL AND JSON_TYPE(a.row_json) <> 'NULL'
WHERE eo.OperationType IN ('single-row-edit', 'revert')
  AND a.tbl <> 'species_correction_metadata'
  AND NOT EXISTS (
      SELECT 1 FROM JSON_TABLE(
          eo.BeforeState, '$[*]'
          COLUMNS (
              tbl VARCHAR(64) COLLATE utf8mb4_0900_ai_ci PATH '$.table',
              pkval VARCHAR(255) COLLATE utf8mb4_0900_ai_ci PATH '$.primaryKeyValue',
              row_json JSON PATH '$.row'
          )
      ) b
      WHERE b.tbl = a.tbl AND b.pkval = a.pkval
        AND b.row_json IS NOT NULL AND JSON_TYPE(b.row_json) <> 'NULL'
  )
  AND NOT EXISTS (
      SELECT 1 FROM unifiedchangelog existing
      WHERE existing.TableName = a.tbl
        AND existing.RecordID = CONCAT(a.pkval, '::edit-op-', eo.EditOperationID)
  );

-- Branch 2: UPDATE — a key with a materialized row on both sides that differs.
-- MySQL's JSON `<>` compares structurally, so key order needs no normalization here.
INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
SELECT
    a.tbl,
    CONCAT(a.pkval, '::edit-op-', eo.EditOperationID),
    'UPDATE',
    b.row_json,
    a.row_json,
    eo.CreatedAt,
    LEFT(eo.CreatedBy, 64),
    IF(eo.PlotID > 0, eo.PlotID, NULL),
    IF(eo.CensusID > 0, eo.CensusID, NULL)
FROM edit_operations eo
JOIN JSON_TABLE(
    eo.AfterState, '$[*]'
    COLUMNS (
        tbl VARCHAR(64) COLLATE utf8mb4_0900_ai_ci PATH '$.table',
        pkval VARCHAR(255) COLLATE utf8mb4_0900_ai_ci PATH '$.primaryKeyValue',
        row_json JSON PATH '$.row'
    )
) a ON a.row_json IS NOT NULL AND JSON_TYPE(a.row_json) <> 'NULL'
JOIN JSON_TABLE(
    eo.BeforeState, '$[*]'
    COLUMNS (
        tbl VARCHAR(64) COLLATE utf8mb4_0900_ai_ci PATH '$.table',
        pkval VARCHAR(255) COLLATE utf8mb4_0900_ai_ci PATH '$.primaryKeyValue',
        row_json JSON PATH '$.row'
    )
) b ON b.tbl = a.tbl AND b.pkval = a.pkval
    AND b.row_json IS NOT NULL AND JSON_TYPE(b.row_json) <> 'NULL'
WHERE eo.OperationType IN ('single-row-edit', 'revert')
  AND a.tbl <> 'species_correction_metadata'
  AND b.row_json <> a.row_json
  AND NOT EXISTS (
      SELECT 1 FROM unifiedchangelog existing
      WHERE existing.TableName = a.tbl
        AND existing.RecordID = CONCAT(a.pkval, '::edit-op-', eo.EditOperationID)
  );

-- Branch 3: DELETE — a BeforeState key with no materialized row in AfterState.
INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
SELECT
    b.tbl,
    CONCAT(b.pkval, '::edit-op-', eo.EditOperationID),
    'DELETE',
    b.row_json,
    NULL,
    eo.CreatedAt,
    LEFT(eo.CreatedBy, 64),
    IF(eo.PlotID > 0, eo.PlotID, NULL),
    IF(eo.CensusID > 0, eo.CensusID, NULL)
FROM edit_operations eo
JOIN JSON_TABLE(
    eo.BeforeState, '$[*]'
    COLUMNS (
        tbl VARCHAR(64) COLLATE utf8mb4_0900_ai_ci PATH '$.table',
        pkval VARCHAR(255) COLLATE utf8mb4_0900_ai_ci PATH '$.primaryKeyValue',
        row_json JSON PATH '$.row'
    )
) b ON b.row_json IS NOT NULL AND JSON_TYPE(b.row_json) <> 'NULL'
WHERE eo.OperationType IN ('single-row-edit', 'revert')
  AND b.tbl <> 'species_correction_metadata'
  AND NOT EXISTS (
      SELECT 1 FROM JSON_TABLE(
          eo.AfterState, '$[*]'
          COLUMNS (
              tbl VARCHAR(64) COLLATE utf8mb4_0900_ai_ci PATH '$.table',
              pkval VARCHAR(255) COLLATE utf8mb4_0900_ai_ci PATH '$.primaryKeyValue',
              row_json JSON PATH '$.row'
          )
      ) a
      WHERE a.tbl = b.tbl AND a.pkval = b.pkval
        AND a.row_json IS NOT NULL AND JSON_TYPE(a.row_json) <> 'NULL'
  )
  AND NOT EXISTS (
      SELECT 1 FROM unifiedchangelog existing
      WHERE existing.TableName = b.tbl
        AND existing.RecordID = CONCAT(b.pkval, '::edit-op-', eo.EditOperationID)
  );

-- Branch 4: bulk-revision-row — one summary row from BeforeState[0], tagged summaryKind.
INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
SELECT
    s.tbl,
    CONCAT(s.pkval, '::edit-op-', eo.EditOperationID),
    'UPDATE',
    NULL,
    JSON_SET(s.row_json, '$.summaryKind', 'bulk-revision-apply'),
    eo.CreatedAt,
    LEFT(eo.CreatedBy, 64),
    IF(eo.PlotID > 0, eo.PlotID, NULL),
    IF(eo.CensusID > 0, eo.CensusID, NULL)
FROM edit_operations eo
JOIN JSON_TABLE(
    eo.BeforeState, '$[0]'
    COLUMNS (
        tbl VARCHAR(64) COLLATE utf8mb4_0900_ai_ci PATH '$.table',
        pkval VARCHAR(255) COLLATE utf8mb4_0900_ai_ci PATH '$.primaryKeyValue',
        row_json JSON PATH '$.row'
    )
) s ON s.row_json IS NOT NULL AND JSON_TYPE(s.row_json) <> 'NULL'
WHERE eo.OperationType = 'bulk-revision-row'
  AND NOT EXISTS (
      SELECT 1 FROM unifiedchangelog existing
      WHERE existing.TableName = s.tbl
        AND existing.RecordID = CONCAT(s.pkval, '::edit-op-', eo.EditOperationID)
  );

SELECT 'Migration 2026-10-14-02 complete: edit_operations history projected into unifiedchangelog.' AS Status;
