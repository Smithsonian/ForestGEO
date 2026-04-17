-- Migration 35: Add SessionID column to temporarymeasurements
--
-- Fixes a TOCTOU race in orphan cleanup: cleanupOrphanedData() queries
-- temporarymeasurements by (PlotID, CensusID) and can accidentally move
-- a newer session's rows to failures. Adding SessionID lets cleanup
-- scope its DELETEs to only the abandoned session's rows.

ALTER TABLE temporarymeasurements
  ADD COLUMN SessionID VARCHAR(64) NULL AFTER BatchID;

CREATE INDEX idx_tmpm_session ON temporarymeasurements (SessionID);
