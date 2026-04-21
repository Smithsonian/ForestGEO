-- Keep in sync with ensureEditOperationsTable DDL in frontend/config/editoperations.ts (CREATE_EDIT_OPERATIONS_TABLE_SQL).
CREATE TABLE IF NOT EXISTS edit_operations (
  EditOperationID INT AUTO_INCREMENT PRIMARY KEY,
  OperationType ENUM('single-row-edit', 'revert') NOT NULL,
  DataType ENUM('measurementssummary', 'failedmeasurements') NOT NULL,
  TargetID BIGINT NOT NULL,
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
