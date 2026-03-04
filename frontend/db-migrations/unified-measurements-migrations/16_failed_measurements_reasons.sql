-- =====================================================================================
-- Migration Script 16: Failed Measurements Reason Tracking
-- =====================================================================================
-- Purpose:
--   - Add OriginalFailureReasons, CurrentFailureReasons, LastValidatedAt columns
--   - Add refresh_failedmeasurements_current procedure
--   - Update reviewfailed to use refresh_failedmeasurements_current
-- =====================================================================================

SET @schema = DATABASE();

-- Add columns if missing (idempotent)
SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'failedmeasurements' AND COLUMN_NAME = 'OriginalFailureReasons';
SET @add_col = IF(@col_exists = 0,
  'ALTER TABLE failedmeasurements ADD COLUMN OriginalFailureReasons TEXT NULL',
  'SELECT "OriginalFailureReasons already exists" as status');
PREPARE stmt FROM @add_col;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'failedmeasurements' AND COLUMN_NAME = 'CurrentFailureReasons';
SET @add_col = IF(@col_exists = 0,
  'ALTER TABLE failedmeasurements ADD COLUMN CurrentFailureReasons TEXT NULL',
  'SELECT "CurrentFailureReasons already exists" as status');
PREPARE stmt FROM @add_col;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'failedmeasurements' AND COLUMN_NAME = 'LastValidatedAt';
SET @add_col = IF(@col_exists = 0,
  'ALTER TABLE failedmeasurements ADD COLUMN LastValidatedAt DATETIME NULL',
  'SELECT "LastValidatedAt already exists" as status');
PREPARE stmt FROM @add_col;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DELIMITER $$

DROP PROCEDURE IF EXISTS refresh_failedmeasurements_current$$
DROP PROCEDURE IF EXISTS reviewfailed$$

CREATE DEFINER = azureroot@`%` PROCEDURE refresh_failedmeasurements_current(IN pPlotID int, IN pCensusID int)
begin
    DROP TEMPORARY TABLE IF EXISTS fm_candidates, fm_reasons, fm_reason_agg, fm_dups, fm_old_trees, fm_quadrat_mismatch, fm_coordinate_drift;

    CREATE TEMPORARY TABLE fm_candidates AS
    SELECT FailedMeasurementID, PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes, Comments
    FROM failedmeasurements
    WHERE (pPlotID IS NULL OR PlotID = pPlotID)
      AND (pCensusID IS NULL OR CensusID = pCensusID);

    CREATE TEMPORARY TABLE fm_reasons (
        FailedMeasurementID int,
        Reason text
    );

    -- Required field checks
    INSERT INTO fm_reasons
    SELECT FailedMeasurementID, 'Missing required field: TreeTag'
    FROM fm_candidates
    WHERE Tag IS NULL OR TRIM(Tag) = '';

    INSERT INTO fm_reasons
    SELECT FailedMeasurementID, 'Missing required field: StemTag'
    FROM fm_candidates
    WHERE StemTag IS NULL OR TRIM(StemTag) = '';

    INSERT INTO fm_reasons
    SELECT FailedMeasurementID, 'Missing required field: SpeciesCode'
    FROM fm_candidates
    WHERE SpCode IS NULL OR TRIM(SpCode) = '';

    INSERT INTO fm_reasons
    SELECT FailedMeasurementID, 'Missing required field: QuadratName'
    FROM fm_candidates
    WHERE Quadrat IS NULL OR TRIM(Quadrat) = '';

    INSERT INTO fm_reasons
    SELECT FailedMeasurementID, 'Missing required field: MeasurementDate'
    FROM fm_candidates
    WHERE Date IS NULL OR Date = '1900-01-01';

    -- String length validations
    INSERT INTO fm_reasons
    SELECT FailedMeasurementID,
           CONCAT('TreeTag exceeds maximum length of 20 characters: "', LEFT(Tag, 25), '..." (', LENGTH(Tag), ' chars)')
    FROM fm_candidates
    WHERE Tag IS NOT NULL AND LENGTH(Tag) > 20;

    INSERT INTO fm_reasons
    SELECT FailedMeasurementID,
           CONCAT('StemTag exceeds maximum length of 10 characters: "', StemTag, '" (', LENGTH(StemTag), ' chars)')
    FROM fm_candidates
    WHERE StemTag IS NOT NULL AND LENGTH(StemTag) > 10;

    INSERT INTO fm_reasons
    SELECT FailedMeasurementID,
           CONCAT('SpeciesCode exceeds maximum length of 25 characters: "', SpCode, '" (', LENGTH(SpCode), ' chars)')
    FROM fm_candidates
    WHERE SpCode IS NOT NULL AND LENGTH(SpCode) > 25;

    INSERT INTO fm_reasons
    SELECT FailedMeasurementID,
           CONCAT('Comments exceed maximum length of 255 characters (', LENGTH(Comments), ' chars, truncated)')
    FROM fm_candidates
    WHERE Comments IS NOT NULL AND LENGTH(Comments) > 255;

    INSERT INTO fm_reasons
    SELECT FailedMeasurementID,
           CONCAT('Codes exceed maximum length of 255 characters (', LENGTH(Codes), ' chars, truncated)')
    FROM fm_candidates
    WHERE Codes IS NOT NULL AND LENGTH(Codes) > 255;

    -- Numeric validations
    INSERT INTO fm_reasons
    SELECT FailedMeasurementID, CONCAT('Invalid DBH: ', DBH, ' (must be >= 0 or NULL)')
    FROM fm_candidates
    WHERE DBH IS NOT NULL AND DBH < 0;

    INSERT INTO fm_reasons
    SELECT FailedMeasurementID, CONCAT('Invalid HOM: ', HOM, ' (must be >= 0 or NULL)')
    FROM fm_candidates
    WHERE HOM IS NOT NULL AND HOM < 0;

    INSERT INTO fm_reasons
    SELECT FailedMeasurementID, CONCAT('Invalid LocalX: ', X)
    FROM fm_candidates
    WHERE X IS NOT NULL AND X < 0;

    INSERT INTO fm_reasons
    SELECT FailedMeasurementID, CONCAT('Invalid LocalY: ', Y)
    FROM fm_candidates
    WHERE Y IS NOT NULL AND Y < 0;

    INSERT INTO fm_reasons
    SELECT FailedMeasurementID, 'Missing measurement data: DBH and HOM both 0 with no codes'
    FROM fm_candidates
    WHERE COALESCE(DBH, 0) = 0 AND COALESCE(HOM, 0) = 0 AND (Codes IS NULL OR TRIM(Codes) = '');

    -- Referential integrity checks
    INSERT INTO fm_reasons
    SELECT c.FailedMeasurementID, CONCAT('Invalid quadrat name: "', c.Quadrat, '" not found in database')
    FROM fm_candidates c
    WHERE c.Quadrat IS NOT NULL AND TRIM(c.Quadrat) != ''
      AND NOT EXISTS (
          SELECT 1 FROM quadrats q
          WHERE q.QuadratName = c.Quadrat AND q.PlotID = c.PlotID AND q.IsActive = 1
      );

    INSERT INTO fm_reasons
    SELECT c.FailedMeasurementID, CONCAT('Invalid species code: "', c.SpCode, '" not found in database')
    FROM fm_candidates c
    WHERE c.SpCode IS NOT NULL AND TRIM(c.SpCode) != ''
      AND NOT EXISTS (
          SELECT 1 FROM species s
          WHERE s.SpeciesCode = c.SpCode AND s.IsActive = 1
      );

    -- Duplicate detection within failed measurements (same key fields)
    CREATE TEMPORARY TABLE fm_dups AS
    SELECT c.FailedMeasurementID
    FROM fm_candidates c
    JOIN (
        SELECT Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, COUNT(*) as dup_count
        FROM fm_candidates
        GROUP BY Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date
        HAVING COUNT(*) > 1
    ) d ON c.Tag <=> d.Tag
        AND c.StemTag <=> d.StemTag
        AND c.SpCode <=> d.SpCode
        AND c.Quadrat <=> d.Quadrat
        AND c.X <=> d.X
        AND c.Y <=> d.Y
        AND c.DBH <=> d.DBH
        AND c.HOM <=> d.HOM
        AND c.Date <=> d.Date;

    INSERT INTO fm_reasons
    SELECT FailedMeasurementID, 'Duplicate entry: Same TreeTag/StemTag/DBH/HOM/Date'
    FROM fm_dups;

    -- Cross-census validation checks
    CREATE TEMPORARY TABLE fm_old_trees AS
    SELECT DISTINCT c.*
    FROM fm_candidates c
    WHERE c.Tag IS NOT NULL AND c.StemTag IS NOT NULL
      AND EXISTS (SELECT 1 FROM trees t WHERE t.TreeTag = c.Tag AND t.CensusID < c.CensusID AND t.IsActive = 1)
      AND EXISTS (SELECT 1 FROM trees t JOIN stems s ON s.TreeID = t.TreeID AND s.CensusID = t.CensusID
                  WHERE t.TreeTag = c.Tag AND s.StemTag = c.StemTag
                    AND t.CensusID < c.CensusID AND t.IsActive = 1 AND s.IsActive = 1);

    CREATE TEMPORARY TABLE fm_quadrat_mismatch AS
    SELECT DISTINCT f.FailedMeasurementID,
           CONCAT('Quadrat mismatch: Previous census quadrat was "', prev_stem.PrevQuadratName,
                  '", current is "', f.Quadrat,
                  '". Trees cannot change quadrats between censuses. Please verify TreeTag is correct or contact administrator if tree was genuinely moved.')
           as FailureReason
    FROM fm_old_trees f
    INNER JOIN (
        SELECT t.TreeTag, s.StemTag, q.QuadratName as PrevQuadratName
        FROM stems s
        INNER JOIN trees t ON s.TreeID = t.TreeID AND s.CensusID = t.CensusID
        INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
        INNER JOIN (
            SELECT t2.TreeTag, s2.StemTag, MAX(t2.CensusID) as MaxCensusID
            FROM trees t2
            JOIN stems s2 ON s2.TreeID = t2.TreeID AND s2.CensusID = t2.CensusID
            WHERE t2.CensusID < pCensusID
              AND t2.IsActive = 1
              AND s2.IsActive = 1
            GROUP BY t2.TreeTag, s2.StemTag
        ) max_census ON t.TreeTag = max_census.TreeTag
            AND s.StemTag = max_census.StemTag
            AND t.CensusID = max_census.MaxCensusID
        WHERE t.IsActive = 1 AND s.IsActive = 1
    ) prev_stem ON prev_stem.TreeTag = f.Tag
        AND prev_stem.StemTag = f.StemTag
    WHERE prev_stem.PrevQuadratName != f.Quadrat;

    CREATE TEMPORARY TABLE fm_coordinate_drift AS
    SELECT DISTINCT f.FailedMeasurementID,
           CONCAT('Coordinate drift: ',
                  ROUND(SQRT(POW(f.X - prev_stem.PrevX, 2) + POW(f.Y - prev_stem.PrevY, 2)), 2),
                  'm from previous census (>10m threshold). Previous: (', prev_stem.PrevX, ', ', prev_stem.PrevY,
                  '), Current: (', f.X, ', ', f.Y,
                  '). Please verify coordinates or mark as approved if tree genuinely moved.')
           as FailureReason
    FROM fm_old_trees f
    INNER JOIN (
        SELECT t.TreeTag, s.StemTag, s.LocalX as PrevX, s.LocalY as PrevY, q.QuadratName as PrevQuadratName
        FROM stems s
        INNER JOIN trees t ON s.TreeID = t.TreeID AND s.CensusID = t.CensusID
        INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
        INNER JOIN (
            SELECT t2.TreeTag, s2.StemTag, MAX(t2.CensusID) as MaxCensusID
            FROM trees t2
            JOIN stems s2 ON s2.TreeID = t2.TreeID AND s2.CensusID = t2.CensusID
            WHERE t2.CensusID < pCensusID
              AND t2.IsActive = 1
              AND s2.IsActive = 1
              AND s2.LocalX IS NOT NULL
              AND s2.LocalY IS NOT NULL
            GROUP BY t2.TreeTag, s2.StemTag
        ) max_census ON t.TreeTag = max_census.TreeTag
            AND s.StemTag = max_census.StemTag
            AND t.CensusID = max_census.MaxCensusID
        WHERE t.IsActive = 1 AND s.IsActive = 1
    ) prev_stem ON prev_stem.TreeTag = f.Tag
        AND prev_stem.StemTag = f.StemTag
        AND prev_stem.PrevQuadratName = f.Quadrat
    WHERE f.X IS NOT NULL
      AND f.Y IS NOT NULL
      AND SQRT(POW(f.X - prev_stem.PrevX, 2) + POW(f.Y - prev_stem.PrevY, 2)) > 10.0;

    INSERT INTO fm_reasons
    SELECT FailedMeasurementID, FailureReason
    FROM fm_quadrat_mismatch;

    INSERT INTO fm_reasons
    SELECT FailedMeasurementID, FailureReason
    FROM fm_coordinate_drift;

    CREATE TEMPORARY TABLE fm_reason_agg AS
    SELECT FailedMeasurementID,
           TRIM(BOTH '|' FROM GROUP_CONCAT(DISTINCT Reason ORDER BY Reason SEPARATOR ' | ')) as Reasons
    FROM fm_reasons
    GROUP BY FailedMeasurementID;

    UPDATE failedmeasurements fm
    LEFT JOIN fm_reason_agg fr ON fm.FailedMeasurementID = fr.FailedMeasurementID
    SET fm.CurrentFailureReasons = fr.Reasons,
        fm.LastValidatedAt = NOW(),
        fm.FailureReasons = CASE
            WHEN fr.Reasons IS NULL OR fr.Reasons = '' THEN 'Ready for reingestion'
            ELSE fr.Reasons
        END
    WHERE (pPlotID IS NULL OR fm.PlotID = pPlotID)
      AND (pCensusID IS NULL OR fm.CensusID = pCensusID);

    UPDATE failedmeasurements fm
    SET fm.OriginalFailureReasons = CASE
        WHEN (fm.OriginalFailureReasons IS NULL OR fm.OriginalFailureReasons = '')
             AND fm.FailureReasons IS NOT NULL
             AND fm.FailureReasons <> 'Ready for reingestion'
        THEN fm.FailureReasons
        ELSE fm.OriginalFailureReasons
    END
    WHERE (pPlotID IS NULL OR fm.PlotID = pPlotID)
      AND (pCensusID IS NULL OR fm.CensusID = pCensusID);

    DROP TEMPORARY TABLE IF EXISTS fm_candidates, fm_reasons, fm_reason_agg, fm_dups, fm_old_trees, fm_quadrat_mismatch, fm_coordinate_drift;
end$$

CREATE DEFINER = azureroot@`%` PROCEDURE reviewfailed()
begin
    DECLARE vPlotID int;
    DECLARE vCensusID int;
    DECLARE done int default 0;

    DECLARE cur CURSOR FOR
        SELECT DISTINCT PlotID, CensusID
        FROM failedmeasurements
        WHERE PlotID IS NOT NULL AND CensusID IS NOT NULL;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

    OPEN cur;
    read_loop: LOOP
        FETCH cur INTO vPlotID, vCensusID;
        IF done = 1 THEN
            LEAVE read_loop;
        END IF;
        CALL refresh_failedmeasurements_current(vPlotID, vCensusID);
    END LOOP;
    CLOSE cur;
end$$

DELIMITER ;
