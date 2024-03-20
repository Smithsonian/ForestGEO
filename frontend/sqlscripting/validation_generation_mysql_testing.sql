create
    definer = azureroot@`%` procedure CheckIfQuadratByNameExistsInPlot(IN quadratName text, IN plotID int)
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM forestgeo_testing.quadrats
        WHERE QuadratName = quadratName AND PlotID = plotID
    ) AS QuadratExists;
END;

create
    definer = azureroot@`%` procedure CheckIfTreeTagExists(IN inputTreeTag varchar(10))
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM forestgeo_testing.trees
        WHERE TreeTag = inputTreeTag
    ) AS TreeTagExists;
END;

create
    definer = azureroot@`%` procedure CountNumDeadMissingStems()
BEGIN
    SELECT
        cm.CensusID,
        a.Status,
        COUNT(s.StemID) AS NumberOfStems
    FROM
        forestgeo_testing.coremeasurements cm
            JOIN
        forestgeo_testing.stems s ON cm.StemID = s.StemID
            JOIN
        forestgeo_testing.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
            JOIN
        forestgeo_testing.attributes a ON cma.Code = a.Code
    WHERE
        a.Status IN ('dead', 'stem dead', 'missing') AND cm.IsValidated IS TRUE
    GROUP BY
        cm.CensusID, a.Status;
END;

create
    definer = azureroot@`%` procedure CountNumRecordsByQuadrat()
BEGIN
    SELECT
        q.PlotID,
        cm.CensusID,
        q.QuadratName,
        COUNT(DISTINCT s.StemID) AS NumberOfStems,
        SUM(CASE WHEN a.Status NOT IN ('dead', 'missing', 'stem dead') THEN 1 ELSE 0 END) AS NumberOfLivingStems,
        COUNT(DISTINCT t.TreeID) AS NumberOfTrees
    FROM
        forestgeo_testing.quadrats q
            JOIN
        forestgeo_testing.stems s ON q.QuadratID = s.QuadratID
            JOIN
        forestgeo_testing.coremeasurements cm ON s.StemID = cm.StemID
            JOIN
        forestgeo_testing.trees t ON s.TreeID = t.TreeID
            LEFT JOIN
        forestgeo_testing.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
            LEFT JOIN
        forestgeo_testing.attributes a ON cma.Code = a.Code
    WHERE
        cm.IsValidated IS TRUE
    GROUP BY
        q.PlotID, cm.CensusID, q.QuadratName;
END;

create
    definer = azureroot@`%` procedure GenerateMeasurementsView(IN schemaName varchar(255))
BEGIN
    SET @s = CONCAT('
        SELECT
            `cm`.`CoreMeasurementID`                        AS `CoreMeasurementID`,
            `p`.`PlotName`                                 AS `PlotName`,
            `c`.`PlotCensusNumber`                         AS `PlotCensusNumber`,
            `c`.`StartDate`                                AS `CensusStartDate`,
            `c`.`EndDate`                                  AS `CensusEndDate`,
            `q`.`QuadratName`                              AS `QuadratName`,
            `t`.`TreeTag`                                  AS `TreeTag`,
            `st`.`StemTag`                                 AS `StemTag`,
            `s`.`SpeciesName`                              AS `SpeciesName`,
            `ss`.`SubSpeciesName`                          AS `SubSpeciesName`,
            `g`.`Genus`                                    AS `Genus`,
            `f`.`Family`                                   AS `Family`,
            CONCAT(`pe`.`FirstName`, '' '', `pe`.`LastName`) AS `PersonnelName`,
            `cm`.`MeasurementDate`                         AS `MeasurementDate`,
            `cm`.`MeasuredDBH`                             AS `MeasuredDBH`,
            `cm`.`MeasuredHOM`                             AS `MeasuredHOM`,
            `cm`.`Description`                             AS `Description`
        FROM ', schemaName, '.`coremeasurements` `cm`
        LEFT JOIN ', schemaName, '.`plots` `p` ON `cm`.`PlotID` = `p`.`PlotID`
        LEFT JOIN ', schemaName, '.`census` `c` ON `cm`.`CensusID` = `c`.`CensusID`
        LEFT JOIN ', schemaName, '.`quadrats` `q` ON `cm`.`QuadratID` = `q`.`QuadratID`
        LEFT JOIN ', schemaName, '.`trees` `t` ON `cm`.`TreeID` = `t`.`TreeID`
        LEFT JOIN ', schemaName, '.`stems` `st` ON `cm`.`StemID` = `st`.`StemID`
        LEFT JOIN ', schemaName, '.`species` `s` ON `t`.`SpeciesID` = `s`.`SpeciesID`
        LEFT JOIN ', schemaName, '.`subspecies` `ss` ON `t`.`SubSpeciesID` = `ss`.`SubSpeciesID`
        LEFT JOIN ', schemaName, '.`genus` `g` ON `s`.`GenusID` = `g`.`GenusID`
        LEFT JOIN ', schemaName, '.`family` `f` ON `g`.`FamilyID` = `f`.`FamilyID`
        LEFT JOIN ', schemaName, '.`personnel` `pe` ON `cm`.`PersonnelID` = `pe`.`PersonnelID`
        ORDER BY `cm`.`CoreMeasurementID` ASC;');

    PREPARE stmt FROM @s;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    END;

create
    definer = azureroot@`%` procedure MigrateDBHtoCoreMeasurements()
BEGIN
    -- Declare variables
    DECLARE vCensusID INT;
    DECLARE vStemID INT;
    DECLARE vDBH DECIMAL(10, 2); -- Ensure compatibility with the table definition
    DECLARE vHOM DECIMAL(10, 2); -- Ensure compatibility with the table definition
    DECLARE vExactDate DATE;
    DECLARE vComments VARCHAR(128);
    DECLARE vPlotID INT;
    DECLARE vQuadratID INT;
    DECLARE vTreeID INT;
    DECLARE vIsRemeasurement TINYINT(1);
    DECLARE vRowCount INT DEFAULT 0;
    DECLARE vMaxRows INT; -- Variable to store the maximum number of rows to insert
    DECLARE done INT DEFAULT FALSE;

    -- Declare a cursor for a simulated FULL OUTER JOIN result set from dbh and remeasurements
    DECLARE combinedCursor CURSOR FOR
        SELECT d.CensusID, d.StemID, d.DBH, d.HOM, d.ExactDate, d.Comments, 0 AS IsRemeasurement
        FROM ctfsweb.dbh d
                 LEFT JOIN ctfsweb.remeasurement r ON d.StemID = r.StemID AND d.CensusID = r.CensusID
        UNION
        SELECT r.CensusID, r.StemID, r.DBH, r.HOM, r.ExactDate, NULL AS Comments, 1 AS IsRemeasurement
        FROM ctfsweb.remeasurement r
                 LEFT JOIN ctfsweb.dbh d ON d.StemID = r.StemID AND d.CensusID = r.CensusID
        WHERE d.StemID IS NULL
        ORDER BY StemID, ExactDate;

    -- Declare the continue handler
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- Set the maximum number of rows to insert (e.g., 100)
    SET vMaxRows = 2756583;

    -- Reset auto-increment of CoreMeasurements to 1
    ALTER TABLE forestgeo_testing.CoreMeasurements AUTO_INCREMENT = 1;

    -- Open the combined cursor
    OPEN combinedCursor;

    -- Loop through all rows in the combined result set
    combined_loop:
    LOOP
        -- Check if the row count has reached the maximum limit
        IF vRowCount >= vMaxRows THEN
            LEAVE combined_loop;
        END IF;

        -- Fetch next row from cursor
        FETCH combinedCursor INTO vCensusID, vStemID, vDBH, vHOM, vExactDate, vComments, vIsRemeasurement;
        IF done THEN
            LEAVE combined_loop;
        END IF;

        -- Retrieve PlotID, QuadratID, and TreeID from forestgeo_testing
        SELECT stems.TreeID,
               stems.QuadratID,
               census.PlotID
        INTO vTreeID, vQuadratID, vPlotID
        FROM forestgeo_testing.Stems AS stems
                 JOIN forestgeo_testing.Census AS census ON census.CensusID = vCensusID
        WHERE stems.StemID = vStemID;

        -- Insert a row for DBH measurement or remeasurement
        INSERT INTO forestgeo_testing.CoreMeasurements (CensusID, PlotID, QuadratID, TreeID, StemID, MeasuredDBH,
                                                    MeasuredHOM, MeasurementDate, Description, IsRemeasurement, IsCurrent)
        VALUES (vCensusID, vPlotID, vQuadratID, vTreeID, vStemID, CAST(vDBH AS DECIMAL(10, 2)), CAST(vHOM AS DECIMAL(10, 2)), vExactDate, vComments, vIsRemeasurement, FALSE);

        -- Increment the row count
        SET vRowCount = vRowCount + 1;
    END LOOP;

    -- Close the cursor
    CLOSE combinedCursor;

    -- Update the IsCurrent field for the most recent measurement of each stem
    UPDATE forestgeo_testing.CoreMeasurements cm
        INNER JOIN (
            SELECT MAX(CoreMeasurementID) AS LatestMeasurementID, StemID
            FROM forestgeo_testing.CoreMeasurements
            GROUP BY StemID
        ) AS latest ON cm.CoreMeasurementID = latest.LatestMeasurementID
    SET cm.IsCurrent = TRUE;
END;

create
    definer = azureroot@`%` procedure UpdateValidationStatus(IN p_PlotID int, IN p_CensusID int, OUT RowsValidated int)
BEGIN
    -- Create a temporary table to store CoreMeasurementIDs
    CREATE TEMPORARY TABLE IF NOT EXISTS TempUpdatedIDs (CoreMeasurementID INT);

    -- Clear the temporary table
    TRUNCATE TABLE TempUpdatedIDs;

    -- Insert the CoreMeasurementIDs of the rows to be updated into the temporary table
    INSERT INTO TempUpdatedIDs (CoreMeasurementID)
    SELECT cm.CoreMeasurementID
    FROM forestgeo_testing.coremeasurements cm
    LEFT JOIN forestgeo_testing.cmverrors cme ON cm.CoreMeasurementID = cme.CoreMeasurementID
    WHERE cm.IsValidated = FALSE
      AND (cm.PlotID = p_PlotID OR p_PlotID IS NULL)
      AND (cm.CensusID = p_CensusID OR p_CensusID IS NULL)
      AND cme.CoreMeasurementID IS NULL;

    -- Update the IsValidated column
    UPDATE forestgeo_testing.coremeasurements cm
    INNER JOIN TempUpdatedIDs tmp ON cm.CoreMeasurementID = tmp.CoreMeasurementID
    SET cm.IsValidated = TRUE;

    -- Get the count of rows that have been updated
    SET RowsValidated = ROW_COUNT();

    -- Select the CoreMeasurementIDs from the temporary table
    SELECT CoreMeasurementID FROM TempUpdatedIDs;

    -- Optionally, drop the temporary table
    DROP TEMPORARY TABLE IF EXISTS TempUpdatedIDs;
END;

create
    definer = azureroot@`%` procedure ValidateDBHGrowthExceedsMax(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE vPrevDBH DECIMAL(10,2); -- Variable to hold previous DBH
    DECLARE vCurrDBH DECIMAL(10,2); -- Variable to hold current DBH
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT cm2.CoreMeasurementID, cm1.MeasuredDBH, cm2.MeasuredDBH
        FROM forestgeo_testing.coremeasurements cm1
        JOIN forestgeo_testing.coremeasurements cm2
            ON cm1.StemID = cm2.StemID
            AND cm1.TreeID = cm2.TreeID
            AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
        LEFT JOIN forestgeo_testing.cmattributes cma
            ON cm1.CoreMeasurementID = cma.CoreMeasurementID
        LEFT JOIN forestgeo_testing.attributes a
            ON cma.Code = a.Code
        WHERE (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR a.Status IS NULL)
          AND cm1.MeasuredDBH IS NOT NULL
          AND cm2.MeasuredDBH IS NOT NULL
          AND (cm2.MeasuredDBH - cm1.MeasuredDBH > 65)
          AND cm1.IsValidated IS TRUE
          AND cm2.IsValidated IS FALSE
          AND (p_CensusID IS NULL OR cm2.CensusID = p_CensusID)
          AND (p_PlotID IS NULL OR cm2.PlotID = p_PlotID);

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations (CoreMeasurementID INT);

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM forestgeo_testing.coremeasurements cm1
    JOIN forestgeo_testing.coremeasurements cm2
        ON cm1.StemID = cm2.StemID
        AND cm1.TreeID = cm2.TreeID
        AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
    LEFT JOIN forestgeo_testing.cmattributes cma
        ON cm1.CoreMeasurementID = cma.CoreMeasurementID
    LEFT JOIN forestgeo_testing.attributes a
        ON cma.Code = a.Code
    WHERE (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR a.Status IS NULL)
      AND cm1.MeasuredDBH IS NOT NULL
      AND cm2.MeasuredDBH IS NOT NULL
      AND (cm2.MeasuredDBH - cm1.MeasuredDBH > 65)
      AND cm1.IsValidated IS TRUE
      AND cm2.IsValidated IS FALSE
      AND (p_CensusID = -1 OR cm2.CensusID = p_CensusID)
      AND (p_PlotID = -1 OR cm2.PlotID = p_PlotID);

    OPEN cur;
    loop1: LOOP
        FETCH cur INTO vCoreMeasurementID, vPrevDBH, vCurrDBH;
        IF done THEN
            LEAVE loop1;
        END IF;

        IF vCurrDBH - vPrevDBH > 65 THEN
            SET validationResult = 0;
            SET errorMessage = 'Growth exceeds max threshold.';
            INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 14);
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, IsSuccessful, ErrorMessage)
        VALUES ('ValidateDBHGrowthExceedsMax', NOW(), vCoreMeasurementID, validationResult, errorMessage);
    END LOOP;
    CLOSE cur;

    SET successMessage = CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount  AS TotalRows,
           insertCount    AS FailedRows,
           successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateDBHShrinkageExceedsMax(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE vPrevDBH DECIMAL(10,2);
    DECLARE vCurrDBH DECIMAL(10,2);
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT cm2.CoreMeasurementID, cm1.MeasuredDBH, cm2.MeasuredDBH
        FROM forestgeo_testing.coremeasurements cm1
        JOIN forestgeo_testing.coremeasurements cm2
            ON cm1.StemID = cm2.StemID
            AND cm1.TreeID = cm2.TreeID
            AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
        LEFT JOIN forestgeo_testing.cmattributes cma
            ON cm1.CoreMeasurementID = cma.CoreMeasurementID
        LEFT JOIN forestgeo_testing.attributes a
            ON cma.Code = a.Code
        WHERE (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR a.Status IS NULL)
          AND cm1.MeasuredDBH IS NOT NULL
          AND cm2.MeasuredDBH IS NOT NULL
          AND cm1.IsValidated IS TRUE
          AND cm2.IsValidated IS FALSE
          AND (p_CensusID IS NULL OR cm2.CensusID = p_CensusID)
          AND (p_PlotID IS NULL OR cm2.PlotID = p_PlotID);

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations (CoreMeasurementID INT);

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM forestgeo_testing.coremeasurements cm1
    JOIN forestgeo_testing.coremeasurements cm2
        ON cm1.StemID = cm2.StemID
        AND cm1.TreeID = cm2.TreeID
        AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
    LEFT JOIN forestgeo_testing.cmattributes cma
        ON cm1.CoreMeasurementID = cma.CoreMeasurementID
    LEFT JOIN forestgeo_testing.attributes a
        ON cma.Code = a.Code
    WHERE (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR a.Status IS NULL)
      AND cm1.MeasuredDBH IS NOT NULL
      AND cm2.MeasuredDBH IS NOT NULL
      AND cm1.IsValidated IS TRUE
      AND cm2.IsValidated IS FALSE
      AND (p_CensusID IS NULL OR cm2.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR cm2.PlotID = p_PlotID);

    OPEN cur;
    loop1: LOOP
        FETCH cur INTO vCoreMeasurementID, vPrevDBH, vCurrDBH;
        IF done THEN
            LEAVE loop1;
        END IF;

        IF vCurrDBH < vPrevDBH * 0.95 THEN
            SET validationResult = 0;
            SET errorMessage = 'Shrinkage exceeds maximum allowed threshold.';
            INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 13);
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, IsSuccessful, ErrorMessage)
        VALUES ('ValidateDBHShrinkageExceedsMax', NOW(), vCoreMeasurementID, validationResult, errorMessage);
    END LOOP;
    CLOSE cur;

    SET successMessage = CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateFindAllInvalidSpeciesCodes(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE vSpeciesID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT cm.CoreMeasurementID, sp.SpeciesID
        FROM forestgeo_testing.stems s
        JOIN forestgeo_testing.trees t ON s.TreeID = t.TreeID
        LEFT JOIN forestgeo_testing.species sp ON t.SpeciesID = sp.SpeciesID
        JOIN forestgeo_testing.coremeasurements cm ON s.StemID = cm.StemID
        WHERE sp.SpeciesID IS NULL
        AND cm.IsValidated IS FALSE
        AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
        AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
        GROUP BY cm.CoreMeasurementID;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations (CoreMeasurementID INT);

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM forestgeo_testing.stems s
    JOIN forestgeo_testing.trees t ON s.TreeID = t.TreeID
    LEFT JOIN forestgeo_testing.species sp ON t.SpeciesID = sp.SpeciesID
    JOIN forestgeo_testing.coremeasurements cm ON s.StemID = cm.StemID
    WHERE sp.SpeciesID IS NULL
    AND cm.IsValidated IS FALSE
    AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
    AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
    GROUP BY cm.CoreMeasurementID;

    OPEN cur;
    loop1: LOOP
        FETCH cur INTO vCoreMeasurementID, vSpeciesID;
        IF done THEN
            LEAVE loop1;
        END IF;

        IF vSpeciesID IS NULL THEN
            SET validationResult = 0;
            SET errorMessage = 'Invalid species code detected.';
            INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 12);
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, IsSuccessful, ErrorMessage)
        VALUES ('ValidateFindAllInvalidSpeciesCodes', NOW(), vCoreMeasurementID, validationResult, errorMessage);
    END LOOP;
    CLOSE cur;

    SET successMessage = CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateFindDuplicateStemTreeTagCombinationsPerCensus(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT MIN(cm.CoreMeasurementID) AS CoreMeasurementID
        FROM forestgeo_testing.coremeasurements cm
        JOIN forestgeo_testing.stems s ON cm.StemID = s.StemID
        JOIN forestgeo_testing.trees t ON cm.TreeID = t.TreeID
        WHERE (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
        AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
        AND cm.IsValidated IS FALSE
        GROUP BY cm.CensusID, s.StemTag, t.TreeTag
        HAVING COUNT(cm.CoreMeasurementID) > 1;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations (CoreMeasurementID INT);

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM (
        SELECT cm.CoreMeasurementID
        FROM forestgeo_testing.coremeasurements cm
        JOIN forestgeo_testing.stems s ON cm.StemID = s.StemID
        JOIN forestgeo_testing.trees t ON cm.TreeID = t.TreeID
        WHERE s.StemTag IS NOT NULL
        AND s.StemTag <> ''
        AND t.TreeTag IS NOT NULL
        AND t.TreeTag <> ''
        AND cm.IsValidated IS FALSE
        AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
        AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
        GROUP BY cm.CensusID, s.StemTag, t.TreeTag
        HAVING COUNT(cm.CoreMeasurementID) > 1
    ) AS DuplicationCheck;

    OPEN cur;
    loop1: LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;

        -- Check for duplicate stem and tree tag combinations
        IF EXISTS (
            SELECT 1
            FROM forestgeo_testing.coremeasurements cm
            JOIN forestgeo_testing.stems s ON cm.StemID = s.StemID
            JOIN forestgeo_testing.trees t ON cm.TreeID = t.TreeID
            WHERE cm.CoreMeasurementID = vCoreMeasurementID
            GROUP BY cm.CensusID, s.StemTag, t.TreeTag
            HAVING COUNT(cm.CoreMeasurementID) > 1
        ) THEN
            SET validationResult = 0;
            SET errorMessage = 'Duplicate stem and tree tag combination detected.';
            INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 9);
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, IsSuccessful, ErrorMessage)
        VALUES ('ValidateFindDuplicateStemTreeTagCombinationsPerCensus', NOW(), vCoreMeasurementID, validationResult, errorMessage);
    END LOOP;
    CLOSE cur;

    SET successMessage = CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateFindDuplicatedQuadratsByName(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT cm.CoreMeasurementID
        FROM forestgeo_testing.quadrats q
        JOIN forestgeo_testing.coremeasurements cm ON q.QuadratID = cm.QuadratID
        WHERE cm.IsValidated IS FALSE
        AND (q.PlotID, q.QuadratName) IN (
            SELECT PlotID, QuadratName
            FROM forestgeo_testing.quadrats
            GROUP BY PlotID, QuadratName
            HAVING COUNT(*) > 1
        )
        AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
        AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
        GROUP BY cm.CoreMeasurementID;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations (CoreMeasurementID INT);

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM forestgeo_testing.quadrats q
    JOIN forestgeo_testing.coremeasurements cm ON q.QuadratID = cm.QuadratID
    WHERE cm.IsValidated IS FALSE
    AND (q.PlotID, q.QuadratName) IN (
        SELECT PlotID, QuadratName
        FROM forestgeo_testing.quadrats
        GROUP BY PlotID, QuadratName
        HAVING COUNT(*) > 1
    )
    AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
    AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
    GROUP BY cm.CoreMeasurementID;

    OPEN cur;
    loop1: LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;

        -- Check for duplicated quadrat names
        IF EXISTS (
            SELECT 1
            FROM forestgeo_testing.quadrats q
            WHERE q.QuadratID = vCoreMeasurementID
            AND (q.PlotID, q.QuadratName) IN (
                SELECT PlotID, QuadratName
                FROM forestgeo_testing.quadrats
                GROUP BY PlotID, QuadratName
                HAVING COUNT(*) > 1
            )
        ) THEN
            SET validationResult = 0;
            SET errorMessage = 'Duplicated quadrat name detected.';
            INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 11);
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, IsSuccessful, ErrorMessage)
        VALUES ('ValidateFindDuplicatedQuadratsByName', NOW(), vCoreMeasurementID, validationResult, errorMessage);
    END LOOP;
    CLOSE cur;

    SET successMessage = CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT MIN(cm.CoreMeasurementID) AS CoreMeasurementID
        FROM forestgeo_testing.coremeasurements cm
        JOIN forestgeo_testing.quadrats q ON cm.QuadratID = q.QuadratID
        JOIN forestgeo_testing.census c ON q.PlotID = c.PlotID
        WHERE (cm.MeasurementDate < c.StartDate OR cm.MeasurementDate > c.EndDate)
        AND cm.MeasurementDate IS NOT NULL
        AND cm.IsValidated IS FALSE
        AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
        AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
        GROUP BY q.QuadratID, c.CensusID, c.StartDate, c.EndDate;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations (CoreMeasurementID INT);

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM forestgeo_testing.coremeasurements cm
    JOIN forestgeo_testing.quadrats q ON cm.QuadratID = q.QuadratID
    JOIN forestgeo_testing.census c ON q.PlotID = c.PlotID
    WHERE (cm.MeasurementDate < c.StartDate OR cm.MeasurementDate > c.EndDate)
    AND cm.MeasurementDate IS NOT NULL
    AND cm.IsValidated IS FALSE
    AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
    AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);

    OPEN cur;
    loop1: LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;

        -- Check if measurement is outside of census date bounds
        IF EXISTS (
            SELECT 1
            FROM forestgeo_testing.coremeasurements cm
            JOIN forestgeo_testing.quadrats q ON cm.QuadratID = q.QuadratID
            JOIN forestgeo_testing.census c ON q.PlotID = c.PlotID
            WHERE cm.CoreMeasurementID = vCoreMeasurementID
            AND (cm.MeasurementDate < c.StartDate OR cm.MeasurementDate > c.EndDate)
        ) THEN
            SET validationResult = 0;
            SET errorMessage = 'Measurement outside census date bounds.';
            INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 8);
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, IsSuccessful, ErrorMessage)
        VALUES ('ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat', NOW(), vCoreMeasurementID, validationResult, errorMessage);
    END LOOP;
    CLOSE cur;

    SET successMessage = CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateFindStemsInTreeWithDifferentSpecies(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT cm.CoreMeasurementID
        FROM forestgeo_testing.stems s
        JOIN forestgeo_testing.trees t ON s.TreeID = t.TreeID
        JOIN forestgeo_testing.species sp ON t.SpeciesID = sp.SpeciesID
        JOIN forestgeo_testing.coremeasurements cm ON s.StemID = cm.StemID
        WHERE cm.IsValidated IS FALSE
        AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
        AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
        GROUP BY t.TreeID, cm.CoreMeasurementID
        HAVING COUNT(DISTINCT sp.SpeciesCode) > 1;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations (CoreMeasurementID INT);

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM forestgeo_testing.stems s
    JOIN forestgeo_testing.trees t ON s.TreeID = t.TreeID
    JOIN forestgeo_testing.species sp ON t.SpeciesID = sp.SpeciesID
    JOIN forestgeo_testing.coremeasurements cm ON s.StemID = cm.StemID
    WHERE cm.IsValidated IS FALSE
    AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
    AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
    GROUP BY t.TreeID, cm.CoreMeasurementID
    HAVING COUNT(DISTINCT sp.SpeciesCode) > 1;

    OPEN cur;
    loop1: LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;

        -- Check if there are different species codes within the same tree
        IF EXISTS (
            SELECT 1
            FROM forestgeo_testing.stems s
            JOIN forestgeo_testing.trees t ON s.TreeID = t.TreeID
            JOIN forestgeo_testing.species sp ON t.SpeciesID = sp.SpeciesID
            JOIN forestgeo_testing.coremeasurements cm ON s.StemID = cm.StemID
            WHERE cm.CoreMeasurementID = vCoreMeasurementID
            GROUP BY t.TreeID
            HAVING COUNT(DISTINCT sp.SpeciesCode) > 1
        ) THEN
            SET validationResult = 0;
            SET errorMessage = 'Stems in the same tree have different species codes.';
            INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 7);
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, IsSuccessful, ErrorMessage)
        VALUES ('ValidateFindStemsInTreeWithDifferentSpecies', NOW(), vCoreMeasurementID, validationResult, errorMessage);
    END LOOP;
    CLOSE cur;

    SET successMessage = CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateFindStemsOutsidePlots(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT cm.CoreMeasurementID
        FROM forestgeo_testing.stems s
        INNER JOIN forestgeo_testing.quadrats q ON s.QuadratID = q.QuadratID
        INNER JOIN forestgeo_testing.plots p ON q.PlotID = p.PlotID
        INNER JOIN forestgeo_testing.coremeasurements cm ON s.StemID = cm.StemID
        WHERE (s.StemPlotX > p.DimensionX OR s.StemPlotY > p.DimensionY)
        AND s.StemPlotX IS NOT NULL
        AND s.StemPlotY IS NOT NULL
        AND (p.DimensionX > 0 AND p.DimensionY > 0)
        AND cm.IsValidated IS FALSE
        AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
        AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
        GROUP BY cm.CoreMeasurementID;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations (CoreMeasurementID INT);

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM forestgeo_testing.stems s
    INNER JOIN forestgeo_testing.quadrats q ON s.QuadratID = q.QuadratID
    INNER JOIN forestgeo_testing.plots p ON q.PlotID = p.PlotID
    INNER JOIN forestgeo_testing.coremeasurements cm ON s.StemID = cm.StemID
    WHERE (s.StemPlotX > p.DimensionX OR s.StemPlotY > p.DimensionY)
    AND s.StemPlotX IS NOT NULL
    AND s.StemPlotY IS NOT NULL
    AND (p.DimensionX > 0 AND p.DimensionY > 0)
    AND cm.IsValidated IS FALSE
    AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
    AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);

    OPEN cur;
    loop1: LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;

        -- Check if stem is outside plot dimensions
        IF EXISTS (
            SELECT 1
            FROM forestgeo_testing.stems s
            INNER JOIN forestgeo_testing.quadrats q ON s.QuadratID = q.QuadratID
            INNER JOIN forestgeo_testing.plots p ON q.PlotID = p.PlotID
            INNER JOIN forestgeo_testing.coremeasurements cm ON s.StemID = cm.StemID
            WHERE cm.CoreMeasurementID = vCoreMeasurementID
            AND (s.StemPlotX > p.DimensionX OR s.StemPlotY > p.DimensionY)
        ) THEN
            SET validationResult = 0;
            SET errorMessage = 'Stem is outside plot dimensions.';
            INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 6);
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, IsSuccessful, ErrorMessage)
        VALUES ('ValidateFindStemsOutsidePlots', NOW(), vCoreMeasurementID, validationResult, errorMessage);
    END LOOP;
    CLOSE cur;

    SET successMessage = CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateFindTreeStemsInDifferentQuadrats(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT cm1.CoreMeasurementID
        FROM forestgeo_testing.stems s1
        JOIN forestgeo_testing.stems s2 ON s1.TreeID = s2.TreeID AND s1.StemID != s2.StemID
        JOIN forestgeo_testing.coremeasurements cm1 ON s1.StemID = cm1.StemID
        WHERE s1.QuadratID != s2.QuadratID
        AND cm1.IsValidated IS FALSE
        AND (p_CensusID IS NULL OR cm1.CensusID = p_CensusID)
        AND (p_PlotID IS NULL OR cm1.PlotID = p_PlotID)
        GROUP BY cm1.CoreMeasurementID;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations (CoreMeasurementID INT);

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM forestgeo_testing.stems s1
    JOIN forestgeo_testing.stems s2 ON s1.TreeID = s2.TreeID AND s1.StemID != s2.StemID
    JOIN forestgeo_testing.coremeasurements cm1 ON s1.StemID = cm1.StemID
    WHERE s1.QuadratID != s2.QuadratID
    AND cm1.IsValidated IS FALSE
    AND (p_CensusID IS NULL OR cm1.CensusID = p_CensusID)
    AND (p_PlotID IS NULL OR cm1.PlotID = p_PlotID)
    GROUP BY cm1.CoreMeasurementID;

    OPEN cur;
    loop1: LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;

        -- Check for stems in different quadrats within the same tree
        IF (SELECT COUNT(*)
            FROM forestgeo_testing.stems s1
            JOIN forestgeo_testing.stems s2 ON s1.TreeID = s2.TreeID AND s1.StemID != s2.StemID
            WHERE s1.StemID = (SELECT StemID FROM forestgeo_testing.coremeasurements WHERE CoreMeasurementID = vCoreMeasurementID)
            AND s1.QuadratID != s2.QuadratID
            ) > 0 THEN
            SET validationResult = 0;
            SET errorMessage = 'Stems in the same tree are in different quadrats.';
            INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 5);
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, IsSuccessful, ErrorMessage)
        VALUES ('ValidateFindTreeStemsInDifferentQuadrats', NOW(), vCoreMeasurementID, validationResult, errorMessage);
    END LOOP;
    CLOSE cur;

    SET successMessage = CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateHOMUpperAndLowerBounds(IN p_CensusID int, IN p_PlotID int,
                                                                     IN minHOM decimal(10, 2), IN maxHOM decimal(10, 2))
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT cm.CoreMeasurementID
        FROM forestgeo_testing.coremeasurements cm
        WHERE (MeasuredHOM < minHOM OR MeasuredHOM > maxHOM)
        AND IsValidated IS FALSE
        AND (cm.CensusID = p_CensusID)
        AND (cm.PlotID = p_PlotID);

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations (CoreMeasurementID INT);

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM forestgeo_testing.coremeasurements cm
    WHERE (MeasuredHOM < minHOM OR MeasuredHOM > maxHOM)
    AND IsValidated IS FALSE
    AND (cm.CensusID = p_CensusID)
    AND (cm.PlotID = p_PlotID);

    OPEN cur;
    loop1: LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;

        -- Check for HOM outside the specified bounds
        IF (SELECT MeasuredHOM
            FROM forestgeo_testing.coremeasurements
            WHERE CoreMeasurementID = vCoreMeasurementID
            AND (MeasuredHOM < minHOM OR MeasuredHOM > maxHOM)) THEN
            SET validationResult = 0;
            SET errorMessage = CONCAT('HOM outside bounds: ', minHOM, ' - ', maxHOM);
            INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 3);
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, IsSuccessful, ErrorMessage)
        VALUES ('ValidateHOMUpperAndLowerBounds', NOW(), vCoreMeasurementID, validationResult, errorMessage);
    END LOOP;
    CLOSE cur;

    SET successMessage = CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateScreenMeasuredDiameterMinMax(IN p_CensusID int, IN p_PlotID int,
                                                                           IN minDBH decimal(10, 2),
                                                                           IN maxDBH decimal(10, 2))
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT cm.CoreMeasurementID
        FROM forestgeo_testing.coremeasurements cm
        WHERE (MeasuredDBH < minDBH OR MeasuredDBH > maxDBH)
        AND IsValidated IS FALSE
        AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
        AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations (CoreMeasurementID INT);

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM forestgeo_testing.coremeasurements cm
    WHERE (MeasuredDBH < minDBH OR MeasuredDBH > maxDBH)
    AND IsValidated IS FALSE
    AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
    AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);

    OPEN cur;
    loop1: LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;

        -- Check if the DBH is outside the specified range
        IF (SELECT MeasuredDBH
            FROM forestgeo_testing.coremeasurements
            WHERE CoreMeasurementID = vCoreMeasurementID
            AND (MeasuredDBH < minDBH OR MeasuredDBH > maxDBH)) THEN
            SET validationResult = 0;
            SET errorMessage = CONCAT('DBH outside bounds: ', minDBH, ' - ', maxDBH);
            INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 2);
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, IsSuccessful, ErrorMessage)
        VALUES ('ValidateScreenMeasuredDiameterMinMax', NOW(), vCoreMeasurementID, validationResult, errorMessage);
    END LOOP;
    CLOSE cur;

    SET successMessage = CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateScreenStemsWithMeasurementsButDeadAttributes(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT cm.CoreMeasurementID
        FROM forestgeo_testing.coremeasurements cm
                 JOIN forestgeo_testing.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
                 JOIN forestgeo_testing.attributes a ON cma.Code = a.Code
        WHERE ((cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR
               (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0))
          AND a.Status IN ('dead', 'stem dead', 'missing', 'broken below', 'omitted')
          AND cm.IsValidated IS FALSE
          AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
          AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations (CoreMeasurementID INT);

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM forestgeo_testing.coremeasurements cm
             JOIN forestgeo_testing.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
             JOIN forestgeo_testing.attributes a ON cma.Code = a.Code
    WHERE ((cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0))
      AND a.Status IN ('dead', 'stem dead', 'missing', 'broken below', 'omitted')
      AND cm.IsValidated IS FALSE
      AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);

    OPEN cur;
    loop1: LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;

        -- Check for stems with measurements but dead attributes
        IF EXISTS (
            SELECT 1
            FROM forestgeo_testing.cmattributes cma
            JOIN forestgeo_testing.attributes a ON cma.Code = a.Code
            WHERE cma.CoreMeasurementID = vCoreMeasurementID
            AND a.Status IN ('dead', 'stem dead', 'missing', 'broken below', 'omitted')
            AND ((cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0))
        ) THEN
            SET validationResult = 0;
            SET errorMessage = 'Stem with measurements but dead attributes detected.';
            INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 1);
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, IsSuccessful, ErrorMessage)
        VALUES ('ValidateScreenStemsWithMeasurementsButDeadAttributes', NOW(), vCoreMeasurementID, validationResult, errorMessage);
    END LOOP;
    CLOSE cur;

    SET successMessage = CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

