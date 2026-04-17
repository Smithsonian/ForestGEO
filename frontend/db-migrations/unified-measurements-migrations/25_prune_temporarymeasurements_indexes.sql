-- Migration 25: Prune redundant indexes on temporarymeasurements
--
-- The staging table had 13 indexes, many of which are strict prefixes of other
-- composite indexes or duplicate the primary key. Each redundant index adds
-- write amplification on INSERT (every bulk upload row must update all B-trees).
-- For 100k-row uploads this is significant.
--
-- Indexes being dropped and why:
--   (id)                        - duplicates the AUTO_INCREMENT primary key
--   (FileID)                    - prefix of (FileID, BatchID, CensusID)
--   (FileID, BatchID)           - prefix of (FileID, BatchID, CensusID)
--   (BatchID)                   - never queried alone; always paired with FileID
--   (StemTag)                   - prefix of (StemTag, LocalX, LocalY, CensusID)
--   (StemTag, LocalX, LocalY)   - prefix of (StemTag, LocalX, LocalY, CensusID)
--   (TreeTag)                   - prefix of (TreeTag, SpeciesCode)
--   (Codes)                     - not used by any stored procedure or API query
--   (DBH, HOM, MeasurementDate) - superseded by (CensusID, MeasurementDate, DBH, HOM, QuadratName, TreeTag)
--
-- Remaining indexes after this migration:
--   PRIMARY KEY (id)
--   idx_tmpm_file_batch_census           (FileID, BatchID, CensusID)
--   ingest_temporarymeasurements_FBPC    (FileID, BatchID, PlotID, CensusID)
--   idx_cid_md_dbh_hom_qn_tt            (CensusID, MeasurementDate, DBH, HOM, QuadratName, TreeTag)
--   idx_tm_tag_xy_cid                    (StemTag, LocalX, LocalY, CensusID)
--   temporarymeasurements_TreeTag_SpeciesCode_index (TreeTag, SpeciesCode)
--   temporarymeasurements_QuadratName_index         (QuadratName)

-- Guard each DROP so the migration is idempotent (safe to re-run).

SET @tbl = 'temporarymeasurements';

-- 1. (id) - duplicates PK
SET @idx = 'temporarymeasurements_id_index';
SET @q = (SELECT IF(COUNT(*) > 0,
    CONCAT('ALTER TABLE ', @tbl, ' DROP INDEX `', @idx, '`'),
    'SELECT 1') FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND INDEX_NAME = @idx LIMIT 1);
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. (FileID) - prefix of (FileID, BatchID, CensusID)
SET @idx = 'temporarymeasurements_FileID_index';
SET @q = (SELECT IF(COUNT(*) > 0,
    CONCAT('ALTER TABLE ', @tbl, ' DROP INDEX `', @idx, '`'),
    'SELECT 1') FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND INDEX_NAME = @idx LIMIT 1);
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. (FileID, BatchID) - prefix of (FileID, BatchID, CensusID)
SET @idx = 'temporarymeasurements_FileID_BatchID_index';
SET @q = (SELECT IF(COUNT(*) > 0,
    CONCAT('ALTER TABLE ', @tbl, ' DROP INDEX `', @idx, '`'),
    'SELECT 1') FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND INDEX_NAME = @idx LIMIT 1);
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. (BatchID) - never queried alone
SET @idx = 'ingest_temporarymeasurements_batchID_index';
SET @q = (SELECT IF(COUNT(*) > 0,
    CONCAT('ALTER TABLE ', @tbl, ' DROP INDEX `', @idx, '`'),
    'SELECT 1') FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND INDEX_NAME = @idx LIMIT 1);
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5. (StemTag) - prefix of (StemTag, LocalX, LocalY, CensusID)
SET @idx = 'temporarymeasurements_StemTag_index';
SET @q = (SELECT IF(COUNT(*) > 0,
    CONCAT('ALTER TABLE ', @tbl, ' DROP INDEX `', @idx, '`'),
    'SELECT 1') FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND INDEX_NAME = @idx LIMIT 1);
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 6. (StemTag, LocalX, LocalY) - prefix of (StemTag, LocalX, LocalY, CensusID)
SET @idx = 'temporarymeasurements_StemTag_LocalX_LocalY_index';
SET @q = (SELECT IF(COUNT(*) > 0,
    CONCAT('ALTER TABLE ', @tbl, ' DROP INDEX `', @idx, '`'),
    'SELECT 1') FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND INDEX_NAME = @idx LIMIT 1);
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 7. (TreeTag) - prefix of (TreeTag, SpeciesCode)
SET @idx = 'temporarymeasurements_TreeTag_index';
SET @q = (SELECT IF(COUNT(*) > 0,
    CONCAT('ALTER TABLE ', @tbl, ' DROP INDEX `', @idx, '`'),
    'SELECT 1') FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND INDEX_NAME = @idx LIMIT 1);
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 8. (Codes) - not used by any query
SET @idx = 'temporarymeasurements_Codes_index';
SET @q = (SELECT IF(COUNT(*) > 0,
    CONCAT('ALTER TABLE ', @tbl, ' DROP INDEX `', @idx, '`'),
    'SELECT 1') FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND INDEX_NAME = @idx LIMIT 1);
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 9. (DBH, HOM, MeasurementDate) - superseded by idx_cid_md_dbh_hom_qn_tt
SET @idx = 'temporarymeasurements_DBH_HOM_MeasurementDate_index';
SET @q = (SELECT IF(COUNT(*) > 0,
    CONCAT('ALTER TABLE ', @tbl, ' DROP INDEX `', @idx, '`'),
    'SELECT 1') FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND INDEX_NAME = @idx LIMIT 1);
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;
