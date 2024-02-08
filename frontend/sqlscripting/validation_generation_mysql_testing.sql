create
    definer = azureroot@`%` procedure forestgeo_testing.CheckIfQuadratByNameExistsInPlot(IN quadratName text, IN plotID int)
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM forestgeo_testing.quadrats
        WHERE QuadratName = quadratName AND PlotID = plotID
    ) AS QuadratExists;
END;

create
    definer = azureroot@`%` procedure forestgeo_testing.CheckIfTreeTagExists(IN inputTreeTag varchar(10))
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM forestgeo_testing.trees
        WHERE TreeTag = inputTreeTag
    ) AS TreeTagExists;
END;

create
    definer = azureroot@`%` procedure forestgeo_testing.CountNumDeadMissingStems()
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
    definer = azureroot@`%` procedure forestgeo_testing.CountNumRecordsByQuadrat()
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
    definer = azureroot@`%` procedure forestgeo_testing.MigrateDBHtoCoreMeasurements()
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
    definer = azureroot@`%` procedure forestgeo_testing.ValidateDBHGrowthExceedsMax(IN p_CensusID int, IN p_PlotID int)
begin
    DECLARE vCoreMeasurementID INT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE updateCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR SELECT cm2.CoreMeasurementID
                           FROM forestgeo_testing.coremeasurements cm1
                                    JOIN forestgeo_testing.coremeasurements cm2
                                         ON cm1.StemID = cm2.StemID
                                             AND cm1.TreeID = cm2.TreeID
                                             AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
                                    LEFT JOIN forestgeo_testing.cmattributes cma
                                              ON cm1.CoreMeasurementID = cma.CoreMeasurementID
                                    LEFT JOIN forestgeo_testing.attributes a
                                              ON cma.Code = a.Code
                           WHERE (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR
                                  a.Status IS NULL)
                             AND cm1.MeasuredDBH IS NOT NULL
                             AND cm2.MeasuredDBH IS NOT NULL
                             AND (cm2.MeasuredDBH - cm1.MeasuredDBH > 65)
                             AND cm1.IsValidated IS TRUE
                             AND cm2.IsValidated IS FALSE
                             AND (p_CensusID IS NULL OR cm2.CensusID = p_CensusID)
                             AND (p_PlotID IS NULL OR cm2.PlotID = p_PlotID);
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- Set default values within the procedure if parameters are NULL
    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1; -- Using -1 or another value that would not be a valid CensusID
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1; -- Using -1 or another value that would not be a valid PlotID
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
      AND (p_CensusID IS NULL OR cm2.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR cm2.PlotID = p_PlotID);

    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 14);
        SET insertCount = insertCount + 1;
        UPDATE forestgeo_testing.coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = vCoreMeasurementID;
        SET updateCount = updateCount + 1;
    END LOOP;
    CLOSE cur;

    SET successMessage = 'Validation completed successfully.';
    SELECT expectedCount  AS ExpectedRows,
           insertCount    AS InsertedRows,
           updateCount    AS UpdatedRows,
           successMessage AS Message;
end;

create
    definer = azureroot@`%` procedure forestgeo_testing.ValidateDBHShrinkageExceedsMax(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE updateCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR SELECT cm2.CoreMeasurementID
                           FROM forestgeo_testing.coremeasurements cm1
                                    JOIN forestgeo_testing.coremeasurements cm2
                                         ON cm1.StemID = cm2.StemID
                                             AND cm1.TreeID = cm2.TreeID
                                             AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
                                    LEFT JOIN forestgeo_testing.cmattributes cma
                                              ON cm1.CoreMeasurementID = cma.CoreMeasurementID
                                    LEFT JOIN forestgeo_testing.attributes a
                                              ON cma.Code = a.Code
                           WHERE (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR
                                  a.Status IS NULL)
                             AND cm1.MeasuredDBH IS NOT NULL
                             AND cm2.MeasuredDBH IS NOT NULL
                             AND (cm2.MeasuredDBH < cm1.MeasuredDBH * 0.95)
                             AND cm1.IsValidated IS TRUE
                             AND cm2.IsValidated IS FALSE
                             AND (p_CensusID IS NULL OR cm2.CensusID = p_CensusID)
                             AND (p_PlotID IS NULL OR cm2.PlotID = p_PlotID);
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- Set default values within the procedure if parameters are NULL
    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1; -- Using -1 or another value that would not be a valid CensusID
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1; -- Using -1 or another value that would not be a valid PlotID
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
      AND (cm2.MeasuredDBH < cm1.MeasuredDBH * 0.95)
      AND cm1.IsValidated IS TRUE
      AND cm2.IsValidated IS FALSE
      AND (p_CensusID IS NULL OR cm2.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR cm2.PlotID = p_PlotID);

    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 13);
        SET insertCount = insertCount + 1;
        UPDATE forestgeo_testing.coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = vCoreMeasurementID;
        SET updateCount = updateCount + 1;
    END LOOP;
    CLOSE cur;

    SET successMessage = 'Validation completed successfully.';
    SELECT expectedCount  AS ExpectedRows,
           insertCount    AS InsertedRows,
           updateCount    AS UpdatedRows,
           successMessage AS Message;
END;

create
    definer = azureroot@`%` procedure forestgeo_testing.ValidateFindAllInvalidSpeciesCodes(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE updateCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR SELECT cm.CoreMeasurementID
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

    -- Set default values within the procedure if parameters are NULL
    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1; -- Using -1 or another value that would not be a valid CensusID
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1; -- Using -1 or another value that would not be a valid PlotID
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
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 12);
        SET insertCount = insertCount + 1;
        UPDATE forestgeo_testing.coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = vCoreMeasurementID;
        SET updateCount = updateCount + 1;
    END LOOP;
    CLOSE cur;

    SET successMessage = 'Validation completed successfully.';
    SELECT expectedCount  AS ExpectedRows,
           insertCount    AS InsertedRows,
           updateCount    AS UpdatedRows,
           successMessage AS Message;
END;

create
    definer = azureroot@`%` procedure forestgeo_testing.ValidateFindDuplicateStemTreeTagCombinationsCurrentCensus(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE updateCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR SELECT cm.CoreMeasurementID
                           FROM forestgeo_testing.coremeasurements cm
                                    JOIN forestgeo_testing.stems s ON cm.StemID = s.StemID
                                    JOIN forestgeo_testing.trees t ON cm.TreeID = t.TreeID
                                    JOIN (SELECT MAX(CensusID) AS LatestCensusID FROM forestgeo_testing.census) latest
                                         ON cm.CensusID = latest.LatestCensusID
                           WHERE s.StemTag IS NOT NULL
                             AND s.StemTag <> ''
                             AND t.TreeTag IS NOT NULL
                             AND t.TreeTag <> ''
                             AND cm.IsValidated IS FALSE
                             AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
                             AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
                           GROUP BY s.StemTag, t.TreeTag
                           HAVING COUNT(*) > 1;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- Set default values within the procedure if parameters are NULL
    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1; -- Using -1 or another value that would not be a valid CensusID
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1; -- Using -1 or another value that would not be a valid PlotID
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM forestgeo_testing.coremeasurements cm
             JOIN forestgeo_testing.stems s ON cm.StemID = s.StemID
             JOIN forestgeo_testing.trees t ON cm.TreeID = t.TreeID
             JOIN (SELECT MAX(CensusID) AS LatestCensusID FROM forestgeo_testing.census) latest
                  ON cm.CensusID = latest.LatestCensusID
    WHERE s.StemTag IS NOT NULL
      AND s.StemTag <> ''
      AND t.TreeTag IS NOT NULL
      AND t.TreeTag <> ''
      AND cm.IsValidated IS FALSE
      AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
    GROUP BY s.StemTag, t.TreeTag
    HAVING COUNT(*) > 1;

    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 10);
        SET insertCount = insertCount + 1;
        UPDATE forestgeo_testing.coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = vCoreMeasurementID;
        SET updateCount = updateCount + 1;
    END LOOP;
    CLOSE cur;

    SET successMessage = 'Validation completed successfully.';
    SELECT expectedCount  AS ExpectedRows,
           insertCount    AS InsertedRows,
           updateCount    AS UpdatedRows,
           successMessage AS Message;
END;

create
    definer = azureroot@`%` procedure forestgeo_testing.ValidateFindDuplicateStemTreeTagCombinationsPerCensus(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE updateCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR SELECT cm.CoreMeasurementID
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
                           HAVING COUNT(*) > 1;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- Set default values within the procedure if parameters are NULL
    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1; -- Using -1 or another value that would not be a valid CensusID
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1; -- Using -1 or another value that would not be a valid PlotID
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
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
    HAVING COUNT(*) > 1;

    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 9);
        SET insertCount = insertCount + 1;
        UPDATE forestgeo_testing.coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = vCoreMeasurementID;
        SET updateCount = updateCount + 1;
    END LOOP;
    CLOSE cur;

    SET successMessage = 'Validation completed successfully.';
    SELECT expectedCount  AS ExpectedRows,
           insertCount    AS InsertedRows,
           updateCount    AS UpdatedRows,
           successMessage AS Message;
END;

create
    definer = azureroot@`%` procedure forestgeo_testing.ValidateFindDuplicatedQuadratsByName(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE updateCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR SELECT cm.CoreMeasurementID
                           FROM forestgeo_testing.quadrats q
                                    JOIN forestgeo_testing.coremeasurements cm ON q.QuadratID = cm.QuadratID
                           WHERE cm.IsValidated IS FALSE
                             AND (q.PlotID, q.QuadratName) IN (SELECT PlotID, QuadratName
                                                               FROM forestgeo_testing.quadrats
                                                               GROUP BY PlotID, QuadratName
                                                               HAVING COUNT(*) > 1)
                             AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
                             AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
                           GROUP BY cm.CoreMeasurementID;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- Set default values within the procedure if parameters are NULL
    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1; -- Using -1 or another value that would not be a valid CensusID
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1; -- Using -1 or another value that would not be a valid PlotID
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM forestgeo_testing.quadrats q
             JOIN forestgeo_testing.coremeasurements cm ON q.QuadratID = cm.QuadratID
    WHERE cm.IsValidated IS FALSE
      AND (q.PlotID, q.QuadratName) IN (SELECT PlotID, QuadratName
                                        FROM forestgeo_testing.quadrats
                                        GROUP BY PlotID, QuadratName
                                        HAVING COUNT(*) > 1)
      AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
    GROUP BY cm.CoreMeasurementID;

    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 11);
        SET insertCount = insertCount + 1;
        UPDATE forestgeo_testing.coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = vCoreMeasurementID;
        SET updateCount = updateCount + 1;
    END LOOP;
    CLOSE cur;

    SET successMessage = 'Validation completed successfully.';
    SELECT expectedCount  AS ExpectedRows,
           insertCount    AS InsertedRows,
           updateCount    AS UpdatedRows,
           successMessage AS Message;
END;

create
    definer = azureroot@`%` procedure forestgeo_testing.ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE updateCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR SELECT cm.CoreMeasurementID
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

    -- Set default values within the procedure if parameters are NULL
    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1; -- Using -1 or another value that would not be a valid CensusID
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1; -- Using -1 or another value that would not be a valid PlotID
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
      AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
    GROUP BY q.QuadratID, c.CensusID, c.StartDate, c.EndDate;

    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 8);
        SET insertCount = insertCount + 1;
        UPDATE forestgeo_testing.coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = vCoreMeasurementID;
        SET updateCount = updateCount + 1;
    END LOOP;
    CLOSE cur;

    SET successMessage = 'Validation completed successfully.';
    SELECT expectedCount  AS ExpectedRows,
           insertCount    AS InsertedRows,
           updateCount    AS UpdatedRows,
           successMessage AS Message;
END;

create
    definer = azureroot@`%` procedure forestgeo_testing.ValidateFindStemsInTreeWithDifferentSpecies(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE updateCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR SELECT cm.CoreMeasurementID
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

    -- Set default values within the procedure if parameters are NULL
    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1; -- Using -1 or another value that would not be a valid CensusID
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1; -- Using -1 or another value that would not be a valid PlotID
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
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 7);
        SET insertCount = insertCount + 1;
        UPDATE forestgeo_testing.coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = vCoreMeasurementID;
        SET updateCount = updateCount + 1;
    END LOOP;
    CLOSE cur;

    SET successMessage = 'Validation completed successfully.';
    SELECT insertCount AS InsertedRows, updateCount AS UpdatedRows, successMessage AS Message;
END;

create
    definer = azureroot@`%` procedure forestgeo_testing.ValidateFindStemsOutsidePlots(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE updateCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR SELECT cm.CoreMeasurementID
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

    -- Set default values within the procedure if parameters are NULL
    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1; -- Using -1 or another value that would not be a valid CensusID
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1; -- Using -1 or another value that would not be a valid PlotID
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
      AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
    GROUP BY cm.CoreMeasurementID;

    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 6);
        SET insertCount = insertCount + 1;
        UPDATE forestgeo_testing.coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = vCoreMeasurementID;
        SET updateCount = updateCount + 1;
    END LOOP;
    CLOSE cur;

    SET successMessage = 'Validation completed successfully.';
    SELECT expectedCount  AS ExpectedRows,
           insertCount    AS InsertedRows,
           updateCount    AS UpdatedRows,
           successMessage AS Message;
END;

create
    definer = azureroot@`%` procedure forestgeo_testing.ValidateFindTreeStemsInDifferentQuadrats(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE updateCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR SELECT cm1.CoreMeasurementID
                           FROM forestgeo_testing.stems s1
                                    JOIN forestgeo_testing.stems s2 ON s1.TreeID = s2.TreeID AND s1.StemID != s2.StemID
                                    JOIN forestgeo_testing.coremeasurements cm1 ON s1.StemID = cm1.StemID
                           WHERE s1.QuadratID != s2.QuadratID
                             AND cm1.IsValidated IS FALSE
                             AND (p_CensusID IS NULL OR cm1.CensusID = p_CensusID)
                             AND (p_PlotID IS NULL OR cm1.PlotID = p_PlotID)
                           GROUP BY cm1.CoreMeasurementID;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- Set default values within the procedure if parameters are NULL
    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1; -- Using -1 or another value that would not be a valid CensusID
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1; -- Using -1 or another value that would not be a valid PlotID
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
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 5);
        SET insertCount = insertCount + 1;
        UPDATE forestgeo_testing.coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = vCoreMeasurementID;
        SET updateCount = updateCount + 1;
    END LOOP;
    CLOSE cur;

    SET successMessage = 'Validation completed successfully.';
    SELECT expectedCount  AS ExpectedRows,
           insertCount    AS InsertedRows,
           updateCount    AS UpdatedRows,
           successMessage AS Message;
END;

create
    definer = azureroot@`%` procedure forestgeo_testing.ValidateFindTreesWithMultiplePrimaryStems(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE updateCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR SELECT cm.CoreMeasurementID
                           FROM forestgeo_testing.stems s
                                    JOIN forestgeo_testing.coremeasurements cm ON s.StemID = cm.StemID
                           WHERE cm.IsPrimaryStem = 1
                             AND cm.IsValidated IS FALSE
                             AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
                             AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
                           GROUP BY s.TreeID, cm.CoreMeasurementID
                           HAVING COUNT(*) > 1;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- Set default values within the procedure if parameters are NULL
    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1; -- Using -1 or another value that would not be a valid CensusID
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1; -- Using -1 or another value that would not be a valid PlotID
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM forestgeo_testing.stems s
             JOIN forestgeo_testing.coremeasurements cm ON s.StemID = cm.StemID
    WHERE cm.IsPrimaryStem = 1
      AND cm.IsValidated IS FALSE
      AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)
    GROUP BY s.TreeID, cm.CoreMeasurementID
    HAVING COUNT(*) > 1;

    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 4);
        SET insertCount = insertCount + 1;
        UPDATE forestgeo_testing.coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = vCoreMeasurementID;
        SET updateCount = updateCount + 1;
    END LOOP;
    CLOSE cur;

    SET successMessage = 'Validation completed successfully.';
    SELECT expectedCount  AS ExpectedRows,
           insertCount    AS InsertedRows,
           updateCount    AS UpdatedRows,
           successMessage AS Message;
END;

create
    definer = azureroot@`%` procedure forestgeo_testing.ValidateHOMUpperAndLowerBounds(IN p_CensusID int,
                                                                                       IN p_PlotID int,
                                                                                       IN minHOM decimal(10, 2),
                                                                                       IN maxHOM decimal(10, 2))
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE updateCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR SELECT cm.CoreMeasurementID
                           FROM forestgeo_testing.coremeasurements cm
                           WHERE (MeasuredHOM < minHOM OR MeasuredHOM > maxHOM)
                             AND IsValidated IS FALSE
                             AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
                             AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- Set default values within the procedure if parameters are NULL
    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1; -- Using -1 or another value that would not be a valid CensusID
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1; -- Using -1 or another value that would not be a valid PlotID
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM forestgeo_testing.coremeasurements cm
    WHERE (MeasuredHOM < minHOM OR MeasuredHOM > maxHOM)
      AND IsValidated IS FALSE
      AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);

    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 3);
        SET insertCount = insertCount + 1;
        UPDATE forestgeo_testing.coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = vCoreMeasurementID;
        SET updateCount = updateCount + 1;
    END LOOP;
    CLOSE cur;

    SET successMessage = 'Validation completed successfully.';
    SELECT expectedCount  AS ExpectedRows,
           insertCount    AS InsertedRows,
           updateCount    AS UpdatedRows,
           successMessage AS Message;
END;

create
    definer = azureroot@`%` procedure forestgeo_testing.ValidateScreenMeasuredDiameterMinMax(IN p_CensusID int,
                                                                                             IN p_PlotID int,
                                                                                             IN minDBH decimal(10, 2),
                                                                                             IN maxDBH decimal(10, 2))
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE updateCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR SELECT cm.CoreMeasurementID
                           FROM forestgeo_testing.coremeasurements cm
                           WHERE (MeasuredDBH < minDBH OR MeasuredDBH > maxDBH)
                             AND IsValidated IS FALSE
                             AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
                             AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- Set default values within the procedure if parameters are NULL
    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1; -- Using -1 or another value that would not be a valid CensusID
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1; -- Using -1 or another value that would not be a valid PlotID
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM forestgeo_testing.coremeasurements cm
    WHERE (MeasuredDBH < minDBH OR MeasuredDBH > maxDBH)
      AND IsValidated IS FALSE
      AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);

    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 2);
        SET insertCount = insertCount + 1;
        UPDATE forestgeo_testing.coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = vCoreMeasurementID;
        SET updateCount = updateCount + 1;
    END LOOP;
    CLOSE cur;

    SET successMessage = 'Validation completed successfully.';
    SELECT expectedCount  AS ExpectedRows,
           insertCount    AS InsertedRows,
           updateCount    AS UpdatedRows,
           successMessage AS Message;
END;

create
    definer = azureroot@`%` procedure forestgeo_testing.ValidateScreenStemsWithMeasurementsButDeadAttributes(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE done INT DEFAULT FALSE;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE updateCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);

    DECLARE cur CURSOR FOR
        SELECT cm.CoreMeasurementID
        FROM forestgeo_testing.coremeasurements cm
                 JOIN forestgeo_testing.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
                 JOIN forestgeo_testing.attributes a ON cma.Code = a.Code
        WHERE
            ((cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0))
          AND a.Status IN ('dead', 'stem dead', 'missing', 'broken below', 'omitted')
          AND cm.IsValidated IS FALSE
          AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
          AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- Set default values within the procedure if parameters are NULL
    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1; -- Using -1 or another value that would not be a valid CensusID
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1; -- Using -1 or another value that would not be a valid PlotID
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM forestgeo_testing.coremeasurements cm
             JOIN forestgeo_testing.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
             JOIN forestgeo_testing.attributes a ON cma.Code = a.Code
    WHERE
        ((cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0))
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
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID) VALUES (vCoreMeasurementID, 1);
        SET insertCount = insertCount + 1;
        UPDATE forestgeo_testing.coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = vCoreMeasurementID;
        SET updateCount = updateCount + 1;
    END LOOP;
    CLOSE cur;

    SET successMessage = 'Validation completed successfully.';
    SELECT expectedCount AS ExpectedRows, insertCount AS InsertedRows, updateCount AS UpdatedRows, successMessage AS Message;
END;

