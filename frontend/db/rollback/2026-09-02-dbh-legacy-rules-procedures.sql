-- Prepared rollback revision for the DBH annualisation change.
--
-- Apply this file only to the isolated rollback target after selecting its schema.
-- It replaces only the two shared DBH routines.  It intentionally leaves the
-- atomic rescore service, resolution/retirement behavior, and diagnostics API alone.
-- The companion seed file updates only ValidationIDs 1 and 2.

DROP PROCEDURE IF EXISTS RunSharedDBHChangeValidations;
DROP PROCEDURE IF EXISTS BuildDBHChangePairs;

DELIMITER $$

-- Keep the current diagnostic table shape.  Floor, HOM, and interval columns are
-- facts for the read-only diagnostic; legacy verdicts below do not use them.
CREATE PROCEDURE BuildDBHChangePairs(
    IN p_CensusID INT,
    IN p_PlotID INT,
    IN p_CoreMeasurementID INT
)
SQL SECURITY DEFINER
BEGIN
    DECLARE cGrowthMaxMm DECIMAL(10, 4) DEFAULT 65;
    DECLARE cShrinkageMultiplier DECIMAL(10, 6) DEFAULT 0.95;
    DECLARE cMinDbhMm DECIMAL(10, 4) DEFAULT 10;
    DECLARE cDaysPerYear DECIMAL(8, 3) DEFAULT 365.25;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        DROP TEMPORARY TABLE IF EXISTS dbh_change_pairs;
        RESIGNAL;
    END;

    DROP TEMPORARY TABLE IF EXISTS dbh_change_pairs;
    CREATE TEMPORARY TABLE dbh_change_pairs (
        PresentCoreMeasurementID INT NOT NULL,
        PriorCoreMeasurementID INT NOT NULL,
        PresentCensusID INT NOT NULL,
        PriorCensusID INT NOT NULL,
        PresentIsValidated TINYINT NULL,
        PresentDBH DECIMAL(12, 6) NULL,
        PriorDBH DECIMAL(12, 6) NULL,
        PresentHOM DECIMAL(12, 6) NULL,
        PriorHOM DECIMAL(12, 6) NULL,
        PresentMeasurementDate DATE NULL,
        PriorMeasurementDate DATE NULL,
        UnitToMm DECIMAL(12, 4) NOT NULL,
        IntervalDays INT NULL,
        IntervalYears DECIMAL(20, 10) NULL,
        StatusExempt TINYINT NOT NULL DEFAULT 0,
        DbhsMeetFloor TINYINT NOT NULL DEFAULT 0,
        HomEligible TINYINT NOT NULL DEFAULT 0,
        IntervalSkipReason VARCHAR(32) NULL,
        IsEligible TINYINT NOT NULL DEFAULT 0,
        GrowthViolates TINYINT NOT NULL DEFAULT 0,
        ShrinkageViolates TINYINT NOT NULL DEFAULT 0,
        PRIMARY KEY (PresentCoreMeasurementID, PriorCoreMeasurementID),
        KEY dbh_change_pairs_present_pending (PresentIsValidated, PresentCoreMeasurementID),
        KEY dbh_change_pairs_verdicts (GrowthViolates, ShrinkageViolates)
    ) ENGINE=InnoDB;

    INSERT INTO dbh_change_pairs (
        PresentCoreMeasurementID, PriorCoreMeasurementID, PresentCensusID, PriorCensusID,
        PresentIsValidated, PresentDBH, PriorDBH, PresentHOM, PriorHOM,
        PresentMeasurementDate, PriorMeasurementDate, UnitToMm, StatusExempt
    )
    SELECT cm_present.CoreMeasurementID, cm_past.CoreMeasurementID,
           cm_present.CensusID, cm_past.CensusID, cm_present.IsValidated,
           cm_present.MeasuredDBH, cm_past.MeasuredDBH, cm_present.MeasuredHOM, cm_past.MeasuredHOM,
           cm_present.MeasurementDate, cm_past.MeasurementDate,
           CASE p.DefaultDBHUnits
               WHEN 'km' THEN 1000000 WHEN 'hm' THEN 100000 WHEN 'dam' THEN 10000
               WHEN 'm' THEN 1000 WHEN 'dm' THEN 100 WHEN 'cm' THEN 10 WHEN 'mm' THEN 1 ELSE 1 END,
           CASE WHEN EXISTS (
                    SELECT 1 FROM cmattributes cma_present JOIN attributes a_present
                      ON a_present.Code = cma_present.Code AND a_present.IsActive = 1
                    WHERE cma_present.CoreMeasurementID = cm_present.CoreMeasurementID
                      AND a_present.Status IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted')
                ) OR EXISTS (
                    SELECT 1 FROM cmattributes cma_past JOIN attributes a_past
                      ON a_past.Code = cma_past.Code AND a_past.IsActive = 1
                    WHERE cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
                      AND a_past.Status IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted')
                ) THEN 1 ELSE 0 END
    FROM coremeasurements cm_present
      JOIN census c_present ON cm_present.CensusID = c_present.CensusID AND c_present.IsActive = 1
      JOIN stems s_present ON s_present.StemGUID = cm_present.StemGUID AND s_present.CensusID = cm_present.CensusID AND s_present.IsActive = 1
      JOIN trees t_present ON t_present.TreeID = s_present.TreeID AND t_present.CensusID = s_present.CensusID AND t_present.IsActive = 1
      JOIN plots p ON c_present.PlotID = p.PlotID
      JOIN census c_past ON c_past.PlotID = c_present.PlotID AND c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1 AND c_past.IsActive = 1
      JOIN trees t_past ON t_past.CensusID = c_past.CensusID AND t_past.TreeTag = t_present.TreeTag AND t_past.IsActive = 1
      JOIN stems s_past ON s_past.TreeID = t_past.TreeID AND s_past.CensusID = c_past.CensusID AND s_past.StemTag = s_present.StemTag AND s_past.IsActive = 1
      JOIN coremeasurements cm_past ON cm_past.StemGUID = s_past.StemGUID AND cm_past.CensusID = c_past.CensusID AND cm_past.IsActive = 1 AND cm_past.IsValidated = 1
    WHERE cm_present.IsActive = 1
      AND (p_CensusID IS NULL OR cm_present.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR c_present.PlotID = p_PlotID)
      AND (p_CoreMeasurementID IS NULL OR cm_present.CoreMeasurementID = p_CoreMeasurementID);

    UPDATE dbh_change_pairs
    SET IntervalDays = CASE WHEN PresentMeasurementDate IS NULL OR PriorMeasurementDate IS NULL THEN NULL ELSE DATEDIFF(PresentMeasurementDate, PriorMeasurementDate) END,
        DbhsMeetFloor = CASE WHEN PresentDBH * UnitToMm >= cMinDbhMm AND PriorDBH * UnitToMm >= cMinDbhMm THEN 1 ELSE 0 END,
        HomEligible = CASE WHEN PresentHOM IS NULL OR PriorHOM IS NULL OR PresentHOM = PriorHOM THEN 1 ELSE 0 END;

    UPDATE dbh_change_pairs
    SET IntervalYears = CASE WHEN IntervalDays IS NULL THEN NULL ELSE CAST(IntervalDays AS DECIMAL(20, 10)) / cDaysPerYear END,
        IntervalSkipReason = CASE WHEN IntervalDays IS NULL THEN 'missing-date' WHEN IntervalDays = 0 THEN 'zero-interval' WHEN IntervalDays < 0 THEN 'negative-interval' ELSE NULL END;

    -- Legacy eligibility excludes only status-exempt pairs.  The floor, HOM and
    -- date fields remain populated for diagnostics but are deliberately not gates.
    UPDATE dbh_change_pairs
    SET IsEligible = CASE WHEN StatusExempt = 0 THEN 1 ELSE 0 END;

    -- Exact legacy predicates: absolute growth in millimetres and strict 5%
    -- shrinkage.  No annualisation, DBH floor, HOM, or date predicate belongs here.
    UPDATE dbh_change_pairs
    SET GrowthViolates = CASE WHEN IsEligible = 1
                 AND (PresentDBH - PriorDBH) * UnitToMm > cGrowthMaxMm THEN 1 ELSE 0 END,
        ShrinkageViolates = CASE WHEN IsEligible = 1 AND PriorDBH > 0
                 AND PresentDBH < PriorDBH * cShrinkageMultiplier THEN 1 ELSE 0 END;
END $$

CREATE PROCEDURE RunSharedDBHChangeValidations(
    IN p_CensusID INT,
    IN p_PlotID INT,
    IN p_RunGrowth TINYINT,
    IN p_RunShrinkage TINYINT
)
SQL SECURITY DEFINER
shared_dbh:
BEGIN
    DECLARE vRunGrowth TINYINT DEFAULT 0;
    DECLARE vRunShrinkage TINYINT DEFAULT 0;
    DECLARE vGrowthErrorID INT DEFAULT NULL;
    DECLARE vShrinkageErrorID INT DEFAULT NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        DROP TEMPORARY TABLE IF EXISTS dbh_change_candidates;
        DROP TEMPORARY TABLE IF EXISTS dbh_change_pairs;
        RESIGNAL;
    END;

    SELECT CASE WHEN p_RunGrowth = 1 AND EXISTS (SELECT 1 FROM sitespecificvalidations WHERE ValidationID = 1 AND IsEnabled = TRUE) THEN 1 ELSE 0 END,
           CASE WHEN p_RunShrinkage = 1 AND EXISTS (SELECT 1 FROM sitespecificvalidations WHERE ValidationID = 2 AND IsEnabled = TRUE) THEN 1 ELSE 0 END
      INTO vRunGrowth, vRunShrinkage;
    IF vRunGrowth = 0 AND vRunShrinkage = 0 THEN
        SELECT 0 AS SkippedNoInterval, 0 AS SkippedMissingDate, 0 AS SkippedZeroInterval, 0 AS SkippedNegativeInterval;
        LEAVE shared_dbh;
    END IF;

    IF vRunGrowth = 1 THEN
        SELECT ErrorID INTO vGrowthErrorID FROM measurement_errors WHERE ErrorSource = 'validation' AND ErrorCode = '1' LIMIT 1;
        IF vGrowthErrorID IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Missing measurement_errors row for ValidationID 1'; END IF;
    END IF;
    IF vRunShrinkage = 1 THEN
        SELECT ErrorID INTO vShrinkageErrorID FROM measurement_errors WHERE ErrorSource = 'validation' AND ErrorCode = '2' LIMIT 1;
        IF vShrinkageErrorID IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Missing measurement_errors row for ValidationID 2'; END IF;
    END IF;

    CALL BuildDBHChangePairs(p_CensusID, p_PlotID, NULL);
    DROP TEMPORARY TABLE IF EXISTS dbh_change_candidates;
    CREATE TEMPORARY TABLE dbh_change_candidates (
        CoreMeasurementID INT NOT NULL, ErrorID INT NOT NULL, PriorCensusID INT NULL,
        PriorDBH DECIMAL(12, 6) NULL, PriorHOM DECIMAL(12, 6) NULL,
        PRIMARY KEY (CoreMeasurementID, ErrorID)
    ) ENGINE=InnoDB;
    INSERT INTO dbh_change_candidates (CoreMeasurementID, ErrorID, PriorCensusID, PriorDBH, PriorHOM)
    SELECT ranked.CoreMeasurementID, ranked.ErrorID, ranked.PriorCensusID, ranked.PriorDBH, ranked.PriorHOM
    FROM (
        SELECT pair.CoreMeasurementID, pair.ErrorID, pair.PriorCensusID, pair.PriorDBH, pair.PriorHOM,
               ROW_NUMBER() OVER (PARTITION BY pair.CoreMeasurementID, pair.ErrorID ORDER BY pair.PriorCoreMeasurementID DESC) AS rn
        FROM (
            SELECT pairs.PresentCoreMeasurementID AS CoreMeasurementID, err.ErrorID,
                   pairs.PriorCensusID, pairs.PriorDBH, pairs.PriorHOM, pairs.PriorCoreMeasurementID
            FROM dbh_change_pairs pairs
            CROSS JOIN (SELECT vGrowthErrorID AS ErrorID, 'growth' AS Kind FROM DUAL WHERE vRunGrowth = 1
                        UNION ALL SELECT vShrinkageErrorID, 'shrinkage' FROM DUAL WHERE vRunShrinkage = 1) err
            WHERE pairs.PresentIsValidated IS NULL
              AND ((err.Kind = 'growth' AND pairs.GrowthViolates = 1) OR (err.Kind = 'shrinkage' AND pairs.ShrinkageViolates = 1))
        ) pair
    ) ranked WHERE ranked.rn = 1;
    IF vRunGrowth = 1 THEN
        INSERT INTO measurement_error_log (MeasurementID, ErrorID, PriorCensusID, PriorDBH, PriorHOM)
        SELECT CoreMeasurementID, ErrorID, PriorCensusID, PriorDBH, PriorHOM FROM dbh_change_candidates WHERE ErrorID = vGrowthErrorID
        ON DUPLICATE KEY UPDATE IsResolved = FALSE, ResolvedAt = NULL, PriorCensusID = VALUES(PriorCensusID), PriorDBH = VALUES(PriorDBH), PriorHOM = VALUES(PriorHOM);
    END IF;
    IF vRunShrinkage = 1 THEN
        INSERT INTO measurement_error_log (MeasurementID, ErrorID, PriorCensusID, PriorDBH, PriorHOM)
        SELECT CoreMeasurementID, ErrorID, PriorCensusID, PriorDBH, PriorHOM FROM dbh_change_candidates WHERE ErrorID = vShrinkageErrorID
        ON DUPLICATE KEY UPDATE IsResolved = FALSE, ResolvedAt = NULL, PriorCensusID = VALUES(PriorCensusID), PriorDBH = VALUES(PriorDBH), PriorHOM = VALUES(PriorHOM);
    END IF;
    SELECT COALESCE(SUM(IntervalSkipReason IS NOT NULL), 0) AS SkippedNoInterval,
           COALESCE(SUM(IntervalSkipReason = 'missing-date'), 0) AS SkippedMissingDate,
           COALESCE(SUM(IntervalSkipReason = 'zero-interval'), 0) AS SkippedZeroInterval,
           COALESCE(SUM(IntervalSkipReason = 'negative-interval'), 0) AS SkippedNegativeInterval
    FROM dbh_change_pairs WHERE PresentIsValidated IS NULL AND StatusExempt = 0 AND DbhsMeetFloor = 1 AND HomEligible = 1;
    DROP TEMPORARY TABLE IF EXISTS dbh_change_candidates;
    DROP TEMPORARY TABLE IF EXISTS dbh_change_pairs;
END $$

DELIMITER ;
