-- Migration 32: Add indexes to speed up RunSharedCrossCensusLocationValidations
--
-- The cross-census location validation stored procedure joins coremeasurements,
-- census, stems, trees, and quadrats.  On 212K+ row datasets it was running for
-- 54+ minutes because the existing indexes did not cover the join/filter patterns.
--
-- New indexes:
--   census(PlotID, PlotCensusNumber, IsActive)  — self-join to find previous census
--   coremeasurements(CensusID, IsValidated, IsActive, StemGUID) — WHERE filter
--   stems(CensusID, TreeID, StemTag, IsActive) — Phase 2 previous-census stem lookup
--   trees(CensusID, TreeTag, IsActive) — Phase 2 previous-census tree lookup

-- Helper procedure to add an index only if it doesn't already exist
DROP PROCEDURE IF EXISTS add_index_if_not_exists;

DELIMITER //
CREATE PROCEDURE add_index_if_not_exists(
    IN p_table VARCHAR(64),
    IN p_index VARCHAR(64),
    IN p_columns VARCHAR(255)
)
BEGIN
    DECLARE index_exists INT DEFAULT 0;

    SELECT COUNT(*) INTO index_exists
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND INDEX_NAME = p_index;

    IF index_exists = 0 THEN
        SET @sql = CONCAT('CREATE INDEX ', p_index, ' ON ', p_table, ' (', p_columns, ')');
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END //
DELIMITER ;

-- census: composite index for the c_prev self-join
CALL add_index_if_not_exists('census', 'idx_census_plot_pcn_active', 'PlotID, PlotCensusNumber, IsActive');

-- coremeasurements: covers WHERE cm.CensusID=? AND cm.IsValidated IS NULL AND cm.IsActive=1
-- and includes StemGUID so the index can be a covering index for the initial filter.
CALL add_index_if_not_exists('coremeasurements', 'idx_cm_census_validated_stem', 'CensusID, IsValidated, IsActive, StemGUID');

-- stems: covers the Phase 2 join  s_prev.CensusID = ?, s_prev.TreeID = ?, s_prev.StemTag = ?
CALL add_index_if_not_exists('stems', 'idx_stems_census_tree_tag_active', 'CensusID, TreeID, StemTag, IsActive');

-- trees: covers the Phase 2 join  t_prev.CensusID = ?, t_prev.TreeTag = ?
-- (existing idx_trees_tag_census_active has (TreeTag, CensusID) order which
--  requires an index scan + filter; this reversal enables a direct range scan)
CALL add_index_if_not_exists('trees', 'idx_trees_census_tag_active', 'CensusID, TreeTag, IsActive');

-- Clean up helper
DROP PROCEDURE IF EXISTS add_index_if_not_exists;
