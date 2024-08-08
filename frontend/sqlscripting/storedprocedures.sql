create
definer = azureroot@`%` procedure StartBatchProcessing()
BEGIN
INSERT INTO batchprocessingstate (status)
VALUES ('STARTED');
UPDATE batchprocessingflag
SET flag_status   = 'STARTED',
    needs_refresh = FALSE;
END;

create
definer = azureroot@`%` procedure EndBatchProcessing()
BEGIN
INSERT INTO batchprocessingstate (status)
VALUES ('ENDED');
UPDATE batchprocessingflag
SET flag_status = 'ENDED';
END;

create
definer = azureroot@`%` procedure RefreshMeasurementsSummary()
BEGIN
TRUNCATE TABLE measurementssummary;
INSERT INTO measurementssummary
SELECT cm.CoreMeasurementID                                AS CoreMeasurementID,
       st.StemID                                           AS StemID,
       t.TreeID                                            AS TreeID,
       s.SpeciesID                                         AS SpeciesID,
       q.QuadratID                                         AS QuadratID,
       q.PlotID                                            AS PlotID,
       cm.CensusID                                         AS CensusID,
       s.SpeciesName                                       AS SpeciesName,
       s.SubspeciesName                                    AS SubspeciesName,
       s.SpeciesCode                                       AS SpeciesCode,
       t.TreeTag                                           AS TreeTag,
       st.StemTag                                          AS StemTag,
       st.LocalX                                           AS StemLocalX,
       st.LocalY                                           AS StemLocalY,
       st.CoordinateUnits                                  AS StemUnits,
       q.QuadratName                                       AS QuadratName,
       cm.MeasurementDate                                  AS MeasurementDate,
       cm.MeasuredDBH                                      AS MeasuredDBH,
       cm.DBHUnit                                          AS DBHUnits,
       cm.MeasuredHOM                                      AS MeasuredHOM,
       cm.HOMUnit                                          AS HOMUnits,
       cm.IsValidated                                      AS IsValidated,
       cm.Description                                      AS Description,
       (SELECT GROUP_CONCAT(ca.Code SEPARATOR '; ')
        FROM cmattributes ca
        WHERE ca.CoreMeasurementID = cm.CoreMeasurementID) AS Attributes
FROM coremeasurements cm
         LEFT JOIN stems st ON cm.StemID = st.StemID
         LEFT JOIN trees t ON st.TreeID = t.TreeID
         LEFT JOIN species s ON t.SpeciesID = s.SpeciesID
         LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
         LEFT JOIN census c ON cm.CensusID = c.CensusID;
END;

create
definer = azureroot@`%` procedure RefreshViewFullTable()
BEGIN
    -- Truncate the materialized table
TRUNCATE TABLE viewfulltable;

-- Insert data from the view into the materialized table
INSERT INTO viewfulltable
SELECT cm.CoreMeasurementID                                AS CoreMeasurementID,
       t.TreeID                                            AS TreeID,
       s.StemID                                            AS StemID,
       sp.SpeciesID                                        AS SpeciesID,
       g.GenusID                                           AS GenusID,
       f.FamilyID                                          AS FamilyID,
       q.QuadratID                                         AS QuadratID,
       p.PlotID                                            AS PlotID,
       c.CensusID                                          AS CensusID,
       cm.MeasurementDate                                  AS MeasurementDate,
       cm.MeasuredDBH                                      AS MeasuredDBH,
       cm.DBHUnit                                          AS DBHUnits,
       cm.MeasuredHOM                                      AS MeasuredHOM,
       cm.HOMUnit                                          AS HOMUnits,
       cm.Description                                      AS Description,
       cm.IsValidated                                      AS IsValidated,
       p.PlotName                                          AS PlotName,
       p.LocationName                                      AS LocationName,
       p.CountryName                                       AS CountryName,
       p.GlobalX                                           AS GlobalX,
       p.GlobalY                                           AS GlobalY,
       p.GlobalY                                           AS GlobalZ,
       q.QuadratName                                       AS QuadratName,
       q.StartX                                            AS QuadratX,
       q.StartY                                            AS QuadratY,
       c.PlotCensusNumber                                  AS PlotCensusNumber,
       c.StartDate                                         AS StartDate,
       c.EndDate                                           AS EndDate,
       t.TreeTag                                           AS TreeTag,
       s.StemTag                                           AS StemTag,
       s.LocalX                                            AS StemLocalX,
       s.LocalY                                            AS StemLocalY,
       s.CoordinateUnits                                   AS StemUnits,
       sp.SpeciesCode                                      AS SpeciesCode,
       sp.SpeciesName                                      AS SpeciesName,
       sp.SubspeciesName                                   AS SubspeciesName,
       sp.ValidCode                                        AS ValidCode,
       sp.SpeciesAuthority                                 AS SpeciesAuthority,
       sp.SubspeciesAuthority                              AS SubspeciesAuthority,
       sp.IDLevel                                          AS SpeciesIDLevel,
       sp.FieldFamily                                      AS SpeciesFieldFamily,
       g.Genus                                             AS Genus,
       g.GenusAuthority                                    AS GenusAuthority,
       f.Family                                            AS Family,
       (SELECT GROUP_CONCAT(ca.Code SEPARATOR '; ')
        FROM cmattributes ca
        WHERE ca.CoreMeasurementID = cm.CoreMeasurementID) AS Attributes
FROM coremeasurements cm
         LEFT JOIN stems s ON cm.StemID = s.StemID
         LEFT JOIN trees t ON s.TreeID = t.TreeID
         LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
         LEFT JOIN genus g ON sp.GenusID = g.GenusID
         LEFT JOIN family f ON g.FamilyID = f.FamilyID
         LEFT JOIN quadrats q ON s.QuadratID = q.QuadratID
         LEFT JOIN census c ON cm.CensusID = c.CensusID
         LEFT JOIN plots p ON q.PlotID = p.PlotID;
END;

create
definer = azureroot@`%` procedure UpdateValidationStatus(IN p_PlotID int, IN p_CensusID int, OUT RowsValidated int)
BEGIN
    -- Create a temporary table to store CoreMeasurementIDs
    CREATE
TEMPORARY TABLE IF NOT EXISTS TempUpdatedIDs (CoreMeasurementID INT);

    -- Clear the temporary table
TRUNCATE TABLE TempUpdatedIDs;

-- Insert the CoreMeasurementIDs of the rows to be updated into the temporary table
INSERT INTO TempUpdatedIDs (CoreMeasurementID)
SELECT cm.CoreMeasurementID
FROM coremeasurements cm
         LEFT JOIN cmverrors cme ON cm.CoreMeasurementID = cme.CoreMeasurementID
         LEFT JOIN stems s on cm.StemID = s.StemID
         LEFT JOIN quadrats q on s.QuadratID = q.QuadratID
WHERE cm.IsValidated = FALSE
  AND (q.PlotID = p_PlotID OR p_PlotID IS NULL)
  AND (q.CensusID = p_CensusID OR p_CensusID IS NULL)
  AND cme.CoreMeasurementID IS NULL;

-- Update the IsValidated column
UPDATE coremeasurements cm
    INNER JOIN TempUpdatedIDs tmp
ON cm.CoreMeasurementID = tmp.CoreMeasurementID
    SET cm.IsValidated = TRUE;

-- Get the count of rows that have been updated
SET
RowsValidated = ROW_COUNT();

    -- Select the CoreMeasurementIDs from the temporary table
SELECT CoreMeasurementID
FROM TempUpdatedIDs;

-- Optionally, drop the temporary table
DROP
TEMPORARY TABLE IF EXISTS TempUpdatedIDs;
END;

create
definer = azureroot@`%` procedure ValidateDBHGrowthExceedsMax(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE
vCoreMeasurementID INT;
    DECLARE
vPrevDBH DECIMAL(10, 2);
    DECLARE
vCurrDBH DECIMAL(10, 2);
    DECLARE
validationResult BIT;
    DECLARE
errorMessage VARCHAR(255);
    DECLARE
validationCriteria TEXT;
    DECLARE
measuredValue VARCHAR(255);
    DECLARE
expectedValueRange VARCHAR(255);
    DECLARE
additionalDetails TEXT;
    DECLARE
insertCount INT DEFAULT 0;
    DECLARE
expectedCount INT;
    DECLARE
successMessage VARCHAR(255);
    DECLARE
done INT DEFAULT FALSE;
    DECLARE
veID INT;
    DECLARE
cur CURSOR FOR
SELECT cm2.CoreMeasurementID, cm1.MeasuredDBH, cm2.MeasuredDBH
FROM coremeasurements cm1
         JOIN coremeasurements cm2
              ON cm1.StemID = cm2.StemID
                  AND YEAR (cm2.MeasurementDate) = YEAR (cm1.MeasurementDate) + 1
    LEFT JOIN stems st2
ON cm2.StemID = st2.StemID
    LEFT JOIN quadrats q ON st2.QuadratID = q.QuadratID
    LEFT JOIN cmattributes cma
    ON cm1.CoreMeasurementID = cma.CoreMeasurementID
    LEFT JOIN attributes a
    ON cma.Code = a.Code
WHERE (a.Status NOT IN ('dead'
    , 'stem dead'
    , 'broken below'
    , 'missing'
    , 'omitted')
   OR a.Status IS NULL)
  AND cm1.MeasuredDBH IS NOT NULL
  AND cm2.MeasuredDBH IS NOT NULL
  AND (cm2.MeasuredDBH - cm1.MeasuredDBH
    > 65)
  AND cm1.IsValidated IS TRUE
  AND cm2.IsValidated IS FALSE
  AND (p_CensusID IS NULL
   OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL
   OR q.PlotID = p_PlotID);

DECLARE
CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE
TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF
p_CensusID IS NULL THEN
        SET p_CensusID = -1;
END IF;
    IF
p_PlotID IS NULL THEN
        SET p_PlotID = -1;
END IF;

SELECT COUNT(*)
INTO expectedCount
FROM coremeasurements cm1
         JOIN coremeasurements cm2
              ON cm1.StemID = cm2.StemID
                  AND YEAR (cm2.MeasurementDate) = YEAR (cm1.MeasurementDate) + 1
    LEFT JOIN stems st2
ON cm2.StemID = st2.StemID
    LEFT JOIN quadrats q ON st2.QuadratID = q.QuadratID
    LEFT JOIN cmattributes cma
    ON cm1.CoreMeasurementID = cma.CoreMeasurementID
    LEFT JOIN attributes a
    ON cma.Code = a.Code
WHERE (a.Status NOT IN ('dead'
    , 'stem dead'
    , 'broken below'
    , 'missing'
    , 'omitted')
   OR a.Status IS NULL)
  AND cm1.MeasuredDBH IS NOT NULL
  AND cm2.MeasuredDBH IS NOT NULL
  AND (cm2.MeasuredDBH - cm1.MeasuredDBH
    > 65)
  AND cm1.IsValidated IS TRUE
  AND cm2.IsValidated IS FALSE
  AND (p_CensusID = -1
   OR q.CensusID = p_CensusID)
  AND (p_PlotID = -1
   OR q.PlotID = p_PlotID);

-- Fetch the ValidationErrorID for this stored procedure
SELECT ValidationID
INTO veID
FROM catalog.validationprocedures
WHERE ProcedureName = 'ValidateDBHGrowthExceedsMax';

OPEN cur;
loop1
:
    LOOP
        FETCH cur INTO vCoreMeasurementID, vPrevDBH, vCurrDBH;
        IF
done THEN
            LEAVE loop1;
END IF;

        SET
validationCriteria = 'Annual DBH Growth';
        SET
measuredValue = CONCAT('Previous DBH: ', vPrevDBH, ', Current DBH: ', vCurrDBH);
        SET
expectedValueRange = 'Growth <= 65';
        SET
additionalDetails = 'Checked for excessive DBH growth over a year';

        IF
vCurrDBH - vPrevDBH > 65 THEN
            SET validationResult = 0;
            SET
errorMessage = 'Growth exceeds max threshold.';
            IF
NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
END IF;
INSERT INTO FailedValidations (CoreMeasurementID)
VALUES (vCoreMeasurementID);
SET
insertCount = insertCount + 1;
ELSE
            SET validationResult = 1;
            SET
errorMessage = NULL;
END IF;

INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                 ValidationOutcome, ErrorMessage,
                                 ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                 AdditionalDetails)
VALUES ('ValidateDBHGrowthExceedsMax', NOW(), vCoreMeasurementID,
        IF(validationResult, 'Passed', 'Failed'), errorMessage,
        validationCriteria, measuredValue, expectedValueRange,
        additionalDetails);
END LOOP;
CLOSE cur;

SET
successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
SELECT expectedCount  AS TotalRows,
       insertCount    AS FailedRows,
       successMessage AS Message;

SELECT CoreMeasurementID
FROM FailedValidations;

DROP
TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
definer = azureroot@`%` procedure ValidateDBHShrinkageExceedsMax(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE
vCoreMeasurementID INT;
    DECLARE
vPrevDBH DECIMAL(10, 2);
    DECLARE
vCurrDBH DECIMAL(10, 2);
    DECLARE
validationResult BIT;
    DECLARE
errorMessage VARCHAR(255);
    DECLARE
validationCriteria TEXT;
    DECLARE
measuredValue VARCHAR(255);
    DECLARE
expectedValueRange VARCHAR(255);
    DECLARE
additionalDetails TEXT;
    DECLARE
insertCount INT DEFAULT 0;
    DECLARE
expectedCount INT;
    DECLARE
successMessage VARCHAR(255);
    DECLARE
veID INT;
    DECLARE
done INT DEFAULT FALSE;
    DECLARE
cur CURSOR FOR
SELECT cm2.CoreMeasurementID, cm1.MeasuredDBH, cm2.MeasuredDBH
FROM coremeasurements cm1
         JOIN coremeasurements cm2
              ON cm1.StemID = cm2.StemID
                  AND YEAR (cm2.MeasurementDate) = YEAR (cm1.MeasurementDate) + 1
    LEFT JOIN stems st
ON cm2.StemID = st.StemID
    LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
    LEFT JOIN cmattributes cma
    ON cm1.CoreMeasurementID = cma.CoreMeasurementID
    LEFT JOIN attributes a
    ON cma.Code = a.Code
WHERE (a.Status NOT IN ('dead'
    , 'stem dead'
    , 'broken below'
    , 'missing'
    , 'omitted')
   OR a.Status IS NULL)
  AND cm1.MeasuredDBH IS NOT NULL
  AND cm2.MeasuredDBH IS NOT NULL
  AND cm1.IsValidated IS TRUE
  AND cm2.IsValidated IS FALSE
  AND (p_CensusID IS NULL
   OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL
   OR q.PlotID = p_PlotID);

DECLARE
CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE
TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF
p_CensusID IS NULL THEN
        SET p_CensusID = -1;
END IF;
    IF
p_PlotID IS NULL THEN
        SET p_PlotID = -1;
END IF;

SELECT COUNT(*)
INTO expectedCount
FROM coremeasurements cm1
         JOIN coremeasurements cm2
              ON cm1.StemID = cm2.StemID
                  AND YEAR (cm2.MeasurementDate) = YEAR (cm1.MeasurementDate) + 1
    LEFT JOIN stems st
ON cm2.StemID = st.StemID
    LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
    LEFT JOIN cmattributes cma
    ON cm1.CoreMeasurementID = cma.CoreMeasurementID
    LEFT JOIN attributes a
    ON cma.Code = a.Code
WHERE (a.Status NOT IN ('dead'
    , 'stem dead'
    , 'broken below'
    , 'missing'
    , 'omitted')
   OR a.Status IS NULL)
  AND cm1.MeasuredDBH IS NOT NULL
  AND cm2.MeasuredDBH IS NOT NULL
  AND cm1.IsValidated IS TRUE
  AND cm2.IsValidated IS FALSE
  AND (p_CensusID IS NULL
   OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL
   OR q.PlotID = p_PlotID);

SELECT ValidationID
INTO veID
FROM catalog.validationprocedures
WHERE ProcedureName = 'ValidateDBHShrinkageExceedsMax';

OPEN cur;
loop1
:
    LOOP
        FETCH cur INTO vCoreMeasurementID, vPrevDBH, vCurrDBH;
        IF
done THEN
            LEAVE loop1;
END IF;

        SET
validationCriteria = 'Annual DBH Shrinkage';
        SET
measuredValue = CONCAT('Previous DBH: ', vPrevDBH, ', Current DBH: ', vCurrDBH);
        SET
expectedValueRange = 'Shrinkage < 5% of previous DBH';
        SET
additionalDetails = 'Checked for excessive DBH shrinkage over a year';

        IF
vCurrDBH < vPrevDBH * 0.95 THEN
            SET validationResult = 0;
            SET
errorMessage = 'Shrinkage exceeds maximum allowed threshold.';
            -- Check if the error record already exists before inserting
            IF
NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
END IF;
INSERT INTO FailedValidations (CoreMeasurementID)
VALUES (vCoreMeasurementID);
SET
insertCount = insertCount + 1;
ELSE
            SET validationResult = 1;
            SET
errorMessage = NULL;
END IF;

INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                 ValidationOutcome, ErrorMessage,
                                 ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                 AdditionalDetails)
VALUES ('ValidateDBHShrinkageExceedsMax', NOW(), vCoreMeasurementID,
        IF(validationResult, 'Passed', 'Failed'), errorMessage,
        validationCriteria, measuredValue, expectedValueRange,
        additionalDetails);
END LOOP;
CLOSE cur;

SET
successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

SELECT CoreMeasurementID
FROM FailedValidations;

DROP
TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
definer = azureroot@`%` procedure ValidateFindAllInvalidSpeciesCodes(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE
vCoreMeasurementID INT;
    DECLARE
vSpeciesID INT;
    DECLARE
validationResult BIT;
    DECLARE
errorMessage VARCHAR(255);
    DECLARE
validationCriteria TEXT;
    DECLARE
measuredValue VARCHAR(255);
    DECLARE
expectedValueRange VARCHAR(255);
    DECLARE
additionalDetails TEXT;
    DECLARE
insertCount INT DEFAULT 0;
    DECLARE
expectedCount INT;
    DECLARE
successMessage VARCHAR(255);
    DECLARE
veID INT;
    DECLARE
done INT DEFAULT FALSE;
    DECLARE
cur CURSOR FOR
SELECT cm.CoreMeasurementID, sp.SpeciesID
FROM stems s
         JOIN trees t ON s.TreeID = t.TreeID
         LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
         JOIN coremeasurements cm ON s.StemID = cm.StemID
         LEFT JOIN quadrats q ON s.QuadratID = q.QuadratID
WHERE sp.SpeciesID IS NULL
  AND cm.IsValidated IS FALSE
  AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
GROUP BY cm.CoreMeasurementID;

DECLARE
CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE
TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF
p_CensusID IS NULL THEN
        SET p_CensusID = -1;
END IF;
    IF
p_PlotID IS NULL THEN
        SET p_PlotID = -1;
END IF;

SELECT COUNT(*)
INTO expectedCount
FROM stems s
         JOIN trees t ON s.TreeID = t.TreeID
         LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
         JOIN coremeasurements cm ON s.StemID = cm.StemID
         LEFT JOIN quadrats q ON s.QuadratID = q.QuadratID
WHERE sp.SpeciesID IS NULL
  AND cm.IsValidated IS FALSE
  AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
GROUP BY cm.CoreMeasurementID;

SELECT ValidationID
INTO veID
FROM catalog.validationprocedures
WHERE ProcedureName = 'ValidateFindAllInvalidSpeciesCodes';

OPEN cur;
loop1
:
    LOOP
        FETCH cur INTO vCoreMeasurementID, vSpeciesID;
        IF
done THEN
            LEAVE loop1;
END IF;

        SET
validationCriteria = 'Species Code Validation';
        SET
measuredValue = CONCAT('Species ID: ', IFNULL(vSpeciesID, 'NULL'));
        SET
expectedValueRange = 'Non-null and valid Species ID';
        SET
additionalDetails = 'Checking for the existence of valid species codes for each measurement.';

        IF
vSpeciesID IS NULL THEN
            SET validationResult = 0;
            SET
errorMessage = 'Invalid species code detected.';
            -- Check if the error record already exists before inserting
            IF
NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
END IF;
INSERT INTO FailedValidations (CoreMeasurementID)
VALUES (vCoreMeasurementID);
SET
insertCount = insertCount + 1;
ELSE
            SET validationResult = 1;
            SET
errorMessage = NULL;
END IF;

INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                 ValidationOutcome, ErrorMessage,
                                 ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                 AdditionalDetails)
VALUES ('ValidateFindAllInvalidSpeciesCodes', NOW(), vCoreMeasurementID,
        IF(validationResult, 'Passed', 'Failed'), errorMessage,
        validationCriteria, measuredValue, expectedValueRange,
        additionalDetails);
END LOOP;
CLOSE cur;

SET
successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

SELECT CoreMeasurementID
FROM FailedValidations;

DROP
TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
definer = azureroot@`%` procedure ValidateFindDuplicateStemTreeTagCombinationsPerCensus(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE
vCoreMeasurementID INT;
    DECLARE
validationResult BIT;
    DECLARE
errorMessage VARCHAR(255);
    DECLARE
validationCriteria TEXT;
    DECLARE
measuredValue VARCHAR(255);
    DECLARE
expectedValueRange VARCHAR(255);
    DECLARE
additionalDetails TEXT;
    DECLARE
insertCount INT DEFAULT 0;
    DECLARE
expectedCount INT;
    DECLARE
successMessage VARCHAR(255);
    DECLARE
veID INT;
    DECLARE
done INT DEFAULT FALSE;
    DECLARE
cur CURSOR FOR
SELECT SubQuery.CoreMeasurementID
FROM (SELECT cm.CoreMeasurementID
      FROM coremeasurements cm
               INNER JOIN stems s ON cm.StemID = s.StemID
               INNER JOIN trees t ON s.TreeID = t.TreeID
               INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
      WHERE (p_CensusID IS NULL OR q.CensusID = p_CensusID)
        AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
        AND cm.IsValidated = FALSE
      GROUP BY q.CensusID, s.StemTag, t.TreeTag, cm.CoreMeasurementID
      HAVING COUNT(*) > 1) AS SubQuery;

DECLARE
CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE
TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF
p_CensusID IS NULL THEN
        SET p_CensusID = -1;
END IF;
    IF
p_PlotID IS NULL THEN
        SET p_PlotID = -1;
END IF;

SELECT COUNT(*)
INTO expectedCount
FROM (SELECT cm.CoreMeasurementID
      FROM coremeasurements cm
               INNER JOIN stems s ON cm.StemID = s.StemID
               INNER JOIN trees t ON s.TreeID = t.TreeID
               INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
      WHERE (p_CensusID IS NULL OR q.CensusID = p_CensusID)
        AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
        AND cm.IsValidated = FALSE
      GROUP BY q.CensusID, s.StemTag, t.TreeTag, cm.CoreMeasurementID
      HAVING COUNT(*) > 1) AS DuplicationCheck;

SELECT ValidationID
INTO veID
FROM catalog.validationprocedures
WHERE ProcedureName = 'ValidateFindDuplicateStemTreeTagCombinationsPerCensus';


OPEN cur;
loop1
:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF
done THEN
            LEAVE loop1;
END IF;

        SET
validationCriteria = 'Duplicate Stem-Tree Tag Combinations per Census';
        SET
measuredValue = 'N/A';
        SET
expectedValueRange = 'Unique Stem-Tree Tag Combinations';
        SET
additionalDetails = 'Checking for duplicate stem and tree tag combinations in each census.';

        IF
EXISTS (SELECT 1
                   FROM coremeasurements cm
                            INNER JOIN stems s ON cm.StemID = s.StemID
                            INNER JOIN trees t ON s.TreeID = t.TreeID
                            INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
                   WHERE cm.CoreMeasurementID = vCoreMeasurementID
                   GROUP BY q.CensusID, s.StemTag, t.TreeTag
                   HAVING COUNT(cm.CoreMeasurementID) > 1) THEN
            SET validationResult = 0;
            SET
errorMessage = 'Duplicate stem and tree tag combination detected.';
            -- Check if the error record already exists before inserting
            IF
NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
END IF;
INSERT INTO FailedValidations (CoreMeasurementID)
VALUES (vCoreMeasurementID);
SET
insertCount = insertCount + 1;
ELSE
            SET validationResult = 1;
            SET
errorMessage = NULL;
END IF;

INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                 ValidationOutcome, ErrorMessage,
                                 ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                 AdditionalDetails)
VALUES ('ValidateFindDuplicateStemTreeTagCombinationsPerCensus', NOW(), vCoreMeasurementID,
        IF(validationResult, 'Passed', 'Failed'), errorMessage,
        validationCriteria, measuredValue, expectedValueRange,
        additionalDetails);
END LOOP;
CLOSE cur;

SET
successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

SELECT CoreMeasurementID
FROM FailedValidations;

DROP
TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
definer = azureroot@`%` procedure ValidateFindDuplicatedQuadratsByName(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE
vCoreMeasurementID INT;
    DECLARE
validationResult BIT;
    DECLARE
errorMessage VARCHAR(255);
    DECLARE
validationCriteria TEXT;
    DECLARE
measuredValue VARCHAR(255);
    DECLARE
expectedValueRange VARCHAR(255);
    DECLARE
additionalDetails TEXT;
    DECLARE
insertCount INT DEFAULT 0;
    DECLARE
expectedCount INT;
    DECLARE
successMessage VARCHAR(255);
    DECLARE
veID INT;
    DECLARE
done INT DEFAULT FALSE;
    DECLARE
cur CURSOR FOR
SELECT cm.CoreMeasurementID
FROM quadrats q
         LEFT JOIN stems st ON q.QuadratID = st.QuadratID
         JOIN coremeasurements cm ON st.StemID = cm.StemID
WHERE cm.IsValidated IS FALSE
  AND (q.PlotID, q.QuadratName) IN (SELECT PlotID, QuadratName
                                    FROM quadrats
                                    GROUP BY PlotID, QuadratName
                                    HAVING COUNT(*) > 1)
  AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
GROUP BY cm.CoreMeasurementID;

DECLARE
CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE
TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF
p_CensusID IS NULL THEN
        SET p_CensusID = -1;
END IF;
    IF
p_PlotID IS NULL THEN
        SET p_PlotID = -1;
END IF;

SELECT COUNT(*)
INTO expectedCount
FROM quadrats q
         LEFT JOIN stems st ON q.QuadratID = st.QuadratID
         JOIN coremeasurements cm ON st.StemID = cm.StemID
WHERE cm.IsValidated IS FALSE
  AND (q.PlotID, q.QuadratName) IN (SELECT PlotID, QuadratName
                                    FROM quadrats
                                    GROUP BY PlotID, QuadratName
                                    HAVING COUNT(*) > 1)
  AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
GROUP BY cm.CoreMeasurementID;

SELECT ValidationID
INTO veID
FROM catalog.validationprocedures
WHERE ProcedureName = 'ValidateFindDuplicatedQuadratsByName';

OPEN cur;
loop1
:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF
done THEN
            LEAVE loop1;
END IF;

        SET
validationCriteria = 'Quadrat Name Duplication';
        SET
measuredValue = 'N/A';
        SET
expectedValueRange = 'Unique Quadrat Names per Plot';
        SET
additionalDetails = 'Checking for duplicated quadrat names within the same plot.';

        IF
EXISTS (SELECT 1
                   FROM quadrats q
                   WHERE q.QuadratID = vCoreMeasurementID
                     AND (q.PlotID, q.QuadratName) IN (SELECT PlotID, QuadratName
                                                       FROM quadrats
                                                       GROUP BY PlotID, QuadratName
                                                       HAVING COUNT(*) > 1)) THEN
            SET validationResult = 0;
            SET
errorMessage = 'Duplicated quadrat name detected.';
            -- Check if the error record already exists before inserting
            IF
NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
END IF;
INSERT INTO FailedValidations (CoreMeasurementID)
VALUES (vCoreMeasurementID);
SET
insertCount = insertCount + 1;
ELSE
            SET validationResult = 1;
            SET
errorMessage = NULL;
END IF;

INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                 ValidationOutcome, ErrorMessage,
                                 ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                 AdditionalDetails)
VALUES ('ValidateFindDuplicatedQuadratsByName', NOW(), vCoreMeasurementID,
        IF(validationResult, 'Passed', 'Failed'), errorMessage,
        validationCriteria, measuredValue, expectedValueRange,
        additionalDetails);
END LOOP;
CLOSE cur;

SET
successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

SELECT CoreMeasurementID
FROM FailedValidations;

DROP
TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
definer = azureroot@`%` procedure ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE
vCoreMeasurementID INT;
    DECLARE
validationResult BIT;
    DECLARE
errorMessage VARCHAR(255);
    DECLARE
validationCriteria TEXT;
    DECLARE
measuredValue VARCHAR(255);
    DECLARE
expectedValueRange VARCHAR(255);
    DECLARE
additionalDetails TEXT;
    DECLARE
insertCount INT DEFAULT 0;
    DECLARE
expectedCount INT;
    DECLARE
successMessage VARCHAR(255);
    DECLARE
veID INT;
    DECLARE
done INT DEFAULT FALSE;
    DECLARE
cur CURSOR FOR
SELECT MIN(cm.CoreMeasurementID) AS CoreMeasurementID
FROM coremeasurements cm
         JOIN stems st ON cm.StemID = st.StemID
         JOIN quadrats q ON st.QuadratID = q.QuadratID
         JOIN census c ON q.CensusID = c.CensusID
WHERE (cm.MeasurementDate < c.StartDate OR cm.MeasurementDate > c.EndDate)
  AND cm.MeasurementDate IS NOT NULL
  AND cm.IsValidated IS FALSE
  AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL OR c.PlotID = p_PlotID)
GROUP BY q.QuadratID, c.CensusID, c.StartDate, c.EndDate;

DECLARE
CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE
TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF
p_CensusID IS NULL THEN
        SET p_CensusID = -1;
END IF;
    IF
p_PlotID IS NULL THEN
        SET p_PlotID = -1;
END IF;

SELECT COUNT(*)
INTO expectedCount
FROM coremeasurements cm
         JOIN stems st ON cm.StemID = st.StemID
         JOIN quadrats q ON st.QuadratID = q.QuadratID
         JOIN census c ON q.CensusID = c.CensusID
WHERE (cm.MeasurementDate < c.StartDate OR cm.MeasurementDate > c.EndDate)
  AND cm.MeasurementDate IS NOT NULL
  AND cm.IsValidated IS FALSE
  AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL OR c.PlotID = p_PlotID);

SELECT ValidationID
INTO veID
FROM catalog.validationprocedures
WHERE ProcedureName = 'ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat';


OPEN cur;
loop1
:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF
done THEN
            LEAVE loop1;
END IF;

        SET
validationCriteria = 'Measurement Date vs Census Date Bounds';
        SET
measuredValue = 'Measurement Date';
        SET
expectedValueRange = 'Within Census Start and End Dates';
        SET
additionalDetails =
                'Checking if measurement dates fall within the start and end dates of their respective censuses.';

        IF
EXISTS (SELECT 1
                   FROM coremeasurements cm
                            JOIN stems st ON cm.StemID = st.StemID
                            JOIN quadrats q ON st.QuadratID = q.QuadratID
                            JOIN census c ON q.CensusID = c.CensusID
                   WHERE cm.CoreMeasurementID = vCoreMeasurementID
                     AND (cm.MeasurementDate < c.StartDate OR cm.MeasurementDate > c.EndDate)) THEN
            SET validationResult = 0;
            SET
errorMessage = 'Measurement outside census date bounds.';
            -- Check if the error record already exists before inserting
            IF
NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
END IF;
INSERT INTO FailedValidations (CoreMeasurementID)
VALUES (vCoreMeasurementID);
SET
insertCount = insertCount + 1;
ELSE
            SET validationResult = 1;
            SET
errorMessage = NULL;
END IF;

INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                 ValidationOutcome, ErrorMessage,
                                 ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                 AdditionalDetails)
VALUES ('ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat', NOW(), vCoreMeasurementID,
        IF(validationResult, 'Passed', 'Failed'), errorMessage,
        validationCriteria, measuredValue, expectedValueRange,
        additionalDetails);
END LOOP;
CLOSE cur;

SET
successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

SELECT CoreMeasurementID
FROM FailedValidations;

DROP
TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
definer = azureroot@`%` procedure ValidateFindStemsInTreeWithDifferentSpecies(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE
vCoreMeasurementID INT;
    DECLARE
validationResult BIT;
    DECLARE
errorMessage VARCHAR(255);
    DECLARE
validationCriteria TEXT;
    DECLARE
measuredValue VARCHAR(255);
    DECLARE
expectedValueRange VARCHAR(255);
    DECLARE
additionalDetails TEXT;
    DECLARE
insertCount INT DEFAULT 0;
    DECLARE
expectedCount INT;
    DECLARE
successMessage VARCHAR(255);
    DECLARE
veID INT;
    DECLARE
done INT DEFAULT FALSE;

    DECLARE
cur CURSOR FOR
SELECT cm.CoreMeasurementID
FROM coremeasurements cm
         JOIN stems s ON cm.StemID = s.StemID
         JOIN trees t ON s.TreeID = t.TreeID
         JOIN quadrats q ON s.QuadratID = q.QuadratID
WHERE cm.IsValidated = FALSE
  AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
GROUP BY t.TreeID, cm.CoreMeasurementID
HAVING COUNT(DISTINCT t.SpeciesID) > 1;

DECLARE
CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE
TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF
p_CensusID IS NULL THEN
        SET p_CensusID = -1;
END IF;
    IF
p_PlotID IS NULL THEN
        SET p_PlotID = -1;
END IF;

SELECT COUNT(*)
INTO expectedCount
FROM coremeasurements cm
         JOIN stems s ON cm.StemID = s.StemID
         JOIN trees t ON s.TreeID = t.TreeID
         JOIN quadrats q ON s.QuadratID = q.QuadratID
WHERE cm.IsValidated = FALSE
  AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
GROUP BY t.TreeID
HAVING COUNT(DISTINCT t.SpeciesID) > 1;

SELECT ValidationID
INTO veID
FROM catalog.validationprocedures
WHERE ProcedureName = 'ValidateFindStemsInTreeWithDifferentSpecies';


OPEN cur;
loop1
:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF
done THEN
            LEAVE loop1;
END IF;

        SET
validationCriteria = 'Each tree should have a consistent species across all its stems.';
        SET
measuredValue = 'Species consistency across tree stems';
        SET
expectedValueRange = 'One species per tree';
        SET
additionalDetails = 'Checking if stems belonging to the same tree have different species IDs.';

        IF
EXISTS (SELECT 1
                   FROM stems s
                            JOIN trees t ON s.TreeID = t.TreeID
                   WHERE t.TreeID IN (SELECT TreeID
                                      FROM stems
                                      WHERE StemID IN
                                            (SELECT StemID
                                             FROM coremeasurements
                                             WHERE CoreMeasurementID = vCoreMeasurementID))
                   GROUP BY t.TreeID
                   HAVING COUNT(DISTINCT t.SpeciesID) > 1) THEN
            SET validationResult = 0;
            SET
errorMessage = 'Stems in the same tree have different species.';

            -- Check if the error record already exists before inserting
            IF
NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
END IF;
INSERT INTO FailedValidations (CoreMeasurementID)
VALUES (vCoreMeasurementID);
SET
insertCount = insertCount + 1;
ELSE
            SET validationResult = 1;
            SET
errorMessage = NULL;
END IF;

INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                 ValidationOutcome, ErrorMessage,
                                 ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                 AdditionalDetails)
VALUES ('ValidateFindStemsInTreeWithDifferentSpecies', NOW(), vCoreMeasurementID,
        IF(validationResult, 'Passed', 'Failed'), errorMessage,
        validationCriteria, measuredValue, expectedValueRange,
        additionalDetails);
END LOOP;
CLOSE cur;

SET
successMessage = CONCAT('Validation completed. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

SELECT CoreMeasurementID
FROM FailedValidations;

DROP
TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
definer = azureroot@`%` procedure ValidateFindStemsOutsidePlots(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE
vCoreMeasurementID INT;
    DECLARE
validationResult BIT;
    DECLARE
errorMessage VARCHAR(255);
    DECLARE
validationCriteria TEXT;
    DECLARE
measuredValue VARCHAR(255);
    DECLARE
expectedValueRange VARCHAR(255);
    DECLARE
additionalDetails TEXT;
    DECLARE
insertCount INT DEFAULT 0;
    DECLARE
expectedCount INT;
    DECLARE
successMessage VARCHAR(255);
    DECLARE
veID INT;
    DECLARE
done INT DEFAULT FALSE;

    DECLARE
cur CURSOR FOR
SELECT cm.CoreMeasurementID
FROM stems s
         INNER JOIN coremeasurements cm ON s.StemID = cm.StemID
         INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
         INNER JOIN plots p ON q.PlotID = p.PlotID
WHERE (s.LocalX > p.DimensionX OR s.LocalX > p.DimensionY)
  AND s.LocalX IS NOT NULL
  AND s.LocalY IS NOT NULL
  AND (p.DimensionX > 0 AND p.DimensionY > 0)
  AND cm.IsValidated IS FALSE
  AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
GROUP BY cm.CoreMeasurementID;

DECLARE
CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE
TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF
p_CensusID IS NULL THEN
        SET p_CensusID = -1;
END IF;
    IF
p_PlotID IS NULL THEN
        SET p_PlotID = -1;
END IF;

SELECT COUNT(*)
INTO expectedCount
FROM stems s
         INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
         INNER JOIN plots p ON q.PlotID = p.PlotID
         INNER JOIN coremeasurements cm ON s.StemID = cm.StemID
WHERE (s.LocalX > p.DimensionX OR s.LocalX > p.DimensionY)
  AND s.LocalX IS NOT NULL
  AND s.LocalY IS NOT NULL
  AND (p.DimensionX > 0 AND p.DimensionY > 0)
  AND cm.IsValidated IS FALSE
  AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

SELECT ValidationID
INTO veID
FROM catalog.validationprocedures
WHERE ProcedureName = 'ValidateFindStemsOutsidePlots';


OPEN cur;
loop1
:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF
done THEN
            LEAVE loop1;
END IF;

        SET
validationCriteria = 'Stem Placement within Plot Boundaries';
        SET
measuredValue = 'Stem Plot Coordinates';
        SET
expectedValueRange = 'Within Plot Dimensions';
        SET
additionalDetails = 'Validating whether stems are located within the specified plot dimensions.';

        IF
EXISTS (SELECT 1
                   FROM stems s
                            INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
                            INNER JOIN plots p ON q.PlotID = p.PlotID
                   WHERE s.StemID IN
                         (SELECT StemID
                          FROM coremeasurements
                          WHERE CoreMeasurementID = vCoreMeasurementID)
                     AND (s.LocalX > p.DimensionX OR s.LocalY > p.DimensionY)) THEN
            SET validationResult = 0;
            SET
errorMessage = 'Stem is outside plot dimensions.';
            -- Check if the error record already exists before inserting
            IF
NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
END IF;
INSERT INTO FailedValidations (CoreMeasurementID)
VALUES (vCoreMeasurementID);
SET
insertCount = insertCount + 1;
ELSE
            SET validationResult = 1;
            SET
errorMessage = NULL;
END IF;

INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                 ValidationOutcome, ErrorMessage,
                                 ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                 AdditionalDetails)
VALUES ('ValidateFindStemsOutsidePlots', NOW(), vCoreMeasurementID,
        IF(validationResult, 'Passed', 'Failed'), errorMessage,
        validationCriteria, measuredValue, expectedValueRange,
        additionalDetails);
END LOOP;
CLOSE cur;

SET
successMessage = CONCAT('Validation completed. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

SELECT CoreMeasurementID
FROM FailedValidations;

DROP
TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
definer = azureroot@`%` procedure ValidateFindTreeStemsInDifferentQuadrats(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE
vCoreMeasurementID INT;
    DECLARE
validationResult BIT;
    DECLARE
errorMessage VARCHAR(255);
    DECLARE
validationCriteria TEXT;
    DECLARE
measuredValue VARCHAR(255);
    DECLARE
expectedValueRange VARCHAR(255);
    DECLARE
additionalDetails TEXT;
    DECLARE
insertCount INT DEFAULT 0;
    DECLARE
expectedCount INT;
    DECLARE
successMessage VARCHAR(255);
    DECLARE
veID INT;
    DECLARE
done INT DEFAULT FALSE;

    DECLARE
cur CURSOR FOR
SELECT cm1.CoreMeasurementID
FROM stems s1
         JOIN stems s2 ON s1.TreeID = s2.TreeID AND s1.StemID != s2.StemID
                 JOIN quadrats q1
ON s1.QuadratID = q1.QuadratID
    JOIN quadrats q2 ON s2.QuadratID = q2.QuadratID
    JOIN coremeasurements cm1 ON s1.StemID = cm1.StemID
WHERE q1.QuadratID != q2.QuadratID
  AND cm1.IsValidated IS FALSE
  AND (p_CensusID IS NULL
   OR q1.CensusID = p_CensusID)
  AND (p_PlotID IS NULL
   OR q1.PlotID = p_PlotID)
GROUP BY cm1.CoreMeasurementID;

DECLARE
CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE
TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF
p_CensusID IS NULL THEN
        SET p_CensusID = -1;
END IF;
    IF
p_PlotID IS NULL THEN
        SET p_PlotID = -1;
END IF;

SELECT COUNT(*)
INTO expectedCount
FROM stems s1
         JOIN stems s2 ON s1.TreeID = s2.TreeID AND s1.StemID != s2.StemID
             JOIN quadrats q1
ON s1.QuadratID = q1.QuadratID
    JOIN quadrats q2 ON s2.QuadratID = q2.QuadratID
    JOIN coremeasurements cm1 ON s1.StemID = cm1.StemID
WHERE q1.QuadratID != q2.QuadratID
  AND cm1.IsValidated IS FALSE
  AND (p_CensusID IS NULL
   OR q1.CensusID = p_CensusID)
  AND (p_PlotID IS NULL
   OR q1.PlotID = p_PlotID)
GROUP BY cm1.CoreMeasurementID;

SELECT ValidationID
INTO veID
FROM catalog.validationprocedures
WHERE ProcedureName = 'ValidateFindTreeStemsInDifferentQuadrats';


OPEN cur;
loop1
:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF
done THEN
            LEAVE loop1;
END IF;

        SET
validationCriteria = 'Stem Quadrat Consistency within Trees';
        SET
measuredValue = 'Quadrat IDs of Stems';
        SET
expectedValueRange = 'Consistent Quadrat IDs for all Stems in a Tree';
        SET
additionalDetails = 'Validating that all stems within the same tree are located in the same quadrat.';

        IF
EXISTS (SELECT 1
                   FROM stems s1
                            JOIN stems s2 ON s1.TreeID = s2.TreeID AND s1.StemID != s2.StemID
                            JOIN quadrats q1 on q1.QuadratID = s2.QuadratID
                            JOIN quadrats q2 on q2.QuadratID = s2.QuadratID
                   WHERE s1.StemID IN
                         (SELECT StemID
                          FROM coremeasurements
                          WHERE CoreMeasurementID = vCoreMeasurementID)
                     AND q1.QuadratID != q2.QuadratID) THEN
            SET validationResult = 0;
            SET
errorMessage = 'Stems in the same tree are in different quadrats.';
            -- Check if the error record already exists before inserting
            IF
NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
END IF;
INSERT INTO FailedValidations (CoreMeasurementID)
VALUES (vCoreMeasurementID);
SET
insertCount = insertCount + 1;
ELSE
            SET validationResult = 1;
            SET
errorMessage = NULL;
END IF;

INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                 ValidationOutcome, ErrorMessage,
                                 ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                 AdditionalDetails)
VALUES ('ValidateFindTreeStemsInDifferentQuadrats', NOW(), vCoreMeasurementID,
        IF(validationResult, 'Passed', 'Failed'), errorMessage,
        validationCriteria, measuredValue, expectedValueRange,
        additionalDetails);
END LOOP;
CLOSE cur;

SET
successMessage = CONCAT('Validation completed. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

SELECT CoreMeasurementID
FROM FailedValidations;

DROP
TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
definer = azureroot@`%` procedure ValidateHOMUpperAndLowerBounds(IN p_CensusID int, IN p_PlotID int,
                                                                     IN minHOM decimal(10, 2), IN maxHOM decimal(10, 2))
BEGIN
    DECLARE
defaultMinHOM DECIMAL(10, 2);
    DECLARE
defaultMaxHOM DECIMAL(10, 2);
    DECLARE
vCoreMeasurementID INT;
    DECLARE
validationResult BIT;
    DECLARE
errorMessage VARCHAR(255);
    DECLARE
validationCriteria TEXT;
    DECLARE
measuredValue VARCHAR(255);
    DECLARE
expectedValueRange VARCHAR(255);
    DECLARE
additionalDetails TEXT;
    DECLARE
insertCount INT DEFAULT 0;
    DECLARE
expectedCount INT;
    DECLARE
successMessage VARCHAR(255);
    DECLARE
veID INT;
    DECLARE
done INT DEFAULT FALSE;

    DECLARE
cur CURSOR FOR
SELECT cm.CoreMeasurementID
FROM coremeasurements cm
         LEFT JOIN stems st ON cm.StemID = st.StemID
         LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
WHERE (
    (minHOM IS NOT NULL AND MeasuredHOM < minHOM) OR
    (maxHOM IS NOT NULL AND MeasuredHOM > maxHOM) OR
    (minHOM IS NULL AND maxHOM IS NULL)
    )
  AND IsValidated IS FALSE
  AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

DECLARE
CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE
TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

SELECT COUNT(*)
INTO expectedCount
FROM coremeasurements cm
         LEFT JOIN stems st ON cm.StemID = st.StemID
         LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
WHERE (
    (minHOM IS NOT NULL AND MeasuredHOM < minHOM) OR
    (maxHOM IS NOT NULL AND MeasuredHOM > maxHOM) OR
    (minHOM IS NULL AND maxHOM IS NULL)
    )
  AND IsValidated IS FALSE
  AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

SELECT ValidationID
INTO veID
FROM catalog.validationprocedures
WHERE ProcedureName = 'ValidateHOMUpperAndLowerBounds';


OPEN cur;
loop1
:
    LOOP
        FETCH cur INTO vCoreMeasurementID;

        IF
done THEN
            LEAVE loop1;
END IF;

        IF
minHOM IS NULL OR maxHOM IS NULL THEN
SELECT COALESCE(sl.LowerBound, 0)    AS defaultMinHOM,
       COALESCE(sl.UpperBound, 9999) AS defaultMaxHOM
INTO defaultMinHOM, defaultMaxHOM
FROM specieslimits sl
         JOIN species s ON sl.SpeciesCode = s.SpeciesCode
         JOIN trees t ON s.SpeciesID = t.SpeciesID
         JOIN stems st ON t.TreeID = st.TreeID
         JOIN coremeasurements cm ON st.StemID = cm.StemID
WHERE cm.CoreMeasurementID = vCoreMeasurementID
  AND sl.LimitType = 'HOM';

SET
minHOM = COALESCE(minHOM, defaultMinHOM);
            SET
maxHOM = COALESCE(maxHOM, defaultMaxHOM);
END IF;

        SET
validationCriteria = 'HOM Measurement Range Validation';
        SET
measuredValue = CONCAT('Measured HOM: ', (SELECT MeasuredHOM
                                                      FROM coremeasurements
                                                      WHERE CoreMeasurementID = vCoreMeasurementID));
        SET
expectedValueRange = CONCAT('Expected HOM Range: ', minHOM, ' - ', maxHOM);
        SET
additionalDetails = 'Checks if the measured HOM falls within the specified minimum and maximum range.';

        IF
(
SELECT MeasuredHOM
FROM coremeasurements
WHERE CoreMeasurementID = vCoreMeasurementID
  AND (
    (minHOM IS NOT NULL AND MeasuredHOM < minHOM) OR
    (maxHOM IS NOT NULL AND MeasuredHOM > maxHOM) OR
    (minHOM IS NULL AND maxHOM IS NULL)
    )
    ) THEN
SET validationResult = 0;
SET
errorMessage = CONCAT('HOM outside bounds: ', minHOM, ' - ', maxHOM);
INSERT INTO FailedValidations (CoreMeasurementID)
VALUES (vCoreMeasurementID);
SET
insertCount = insertCount + 1;
            -- Check if the error record already exists before inserting
            IF
NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
END IF;
ELSE
            SET validationResult = 1;
            SET
errorMessage = NULL;
END IF;

INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                 ValidationOutcome, ErrorMessage,
                                 ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                 AdditionalDetails)
VALUES ('ValidateHOMUpperAndLowerBounds', NOW(), vCoreMeasurementID,
        IF(validationResult, 'Passed', 'Failed'), errorMessage,
        validationCriteria, measuredValue, expectedValueRange,
        additionalDetails);
END LOOP;
CLOSE cur;

SET
successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

SELECT CoreMeasurementID
FROM FailedValidations;

DROP
TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
definer = azureroot@`%` procedure ValidateScreenMeasuredDiameterMinMax(IN p_CensusID int, IN p_PlotID int,
                                                                           IN minDBH decimal(10, 2),
                                                                           IN maxDBH decimal(10, 2))
BEGIN
    DECLARE
defaultMinDBH DECIMAL(10, 2);
    DECLARE
defaultMaxDBH DECIMAL(10, 2);
    DECLARE
vCoreMeasurementID INT;
    DECLARE
validationResult BIT;
    DECLARE
errorMessage VARCHAR(255);
    DECLARE
validationCriteria TEXT;
    DECLARE
measuredValue VARCHAR(255);
    DECLARE
expectedValueRange VARCHAR(255);
    DECLARE
additionalDetails TEXT;
    DECLARE
insertCount INT DEFAULT 0;
    DECLARE
expectedCount INT;
    DECLARE
successMessage VARCHAR(255);
    DECLARE
veID INT;
    DECLARE
done INT DEFAULT FALSE;

    DECLARE
cur CURSOR FOR
SELECT cm.CoreMeasurementID
FROM coremeasurements cm
         LEFT JOIN stems st ON cm.StemID = st.StemID
         LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
WHERE (
    (MeasuredDBH < 0) OR
    (maxDBH IS NOT NULL AND MeasuredDBH > maxDBH) OR
    (minDBH IS NULL AND maxDBH IS NULL)
    )
  AND IsValidated IS FALSE
  AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

DECLARE
CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE
TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

SELECT COUNT(*)
INTO expectedCount
FROM coremeasurements cm
         LEFT JOIN stems st ON cm.StemID = st.StemID
         LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
WHERE (
    (MeasuredDBH < 0) OR
    (maxDBH IS NOT NULL AND MeasuredDBH > maxDBH) OR
    (minDBH IS NULL AND maxDBH IS NULL)
    )
  AND IsValidated IS FALSE
  AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

SELECT ValidationID
INTO veID
FROM catalog.validationprocedures
WHERE ProcedureName = 'ValidateScreenMeasuredDiameterMinMax';


OPEN cur;
loop1
:
    LOOP
        FETCH cur INTO vCoreMeasurementID;

        IF
done THEN
            LEAVE loop1;
END IF;

        IF
minDBH IS NULL OR maxDBH IS NULL THEN
SELECT COALESCE(sl.LowerBound, 0)    AS defaultMinDBH,
       COALESCE(sl.UpperBound, 9999) AS defaultMaxDBH
INTO defaultMinDBH, defaultMaxDBH
FROM specieslimits sl
         JOIN species s ON sl.SpeciesCode = s.SpeciesCode
         JOIN trees t ON s.SpeciesID = t.SpeciesID
         JOIN stems st ON t.TreeID = st.TreeID
         JOIN coremeasurements cm ON st.StemID = cm.StemID
WHERE cm.CoreMeasurementID = vCoreMeasurementID
  AND sl.LimitType = 'DBH';

SET
minDBH = COALESCE(minDBH, defaultMinDBH);
            SET
maxDBH = COALESCE(maxDBH, defaultMaxDBH);
END IF;

        SET
validationCriteria = 'DBH Measurement Range Validation';
        SET
measuredValue = CONCAT('Measured DBH: ', (SELECT MeasuredDBH
                                                      FROM coremeasurements
                                                      WHERE CoreMeasurementID = vCoreMeasurementID));
        SET
expectedValueRange = CONCAT('Expected DBH Range: ', minDBH, ' - ', maxDBH);
        SET
additionalDetails = 'Checks if the measured DBH falls within the specified minimum and maximum range.';

        IF
(
SELECT MeasuredDBH
FROM coremeasurements
WHERE CoreMeasurementID = vCoreMeasurementID
  AND (
    (MeasuredDBH < 0) OR
    (maxDBH IS NOT NULL AND MeasuredDBH > maxDBH) OR
    (minDBH IS NULL AND maxDBH IS NULL)
    )
    ) THEN
SET validationResult = 0;
SET
errorMessage = CONCAT('DBH outside bounds: ', minDBH, ' - ', maxDBH);
INSERT INTO FailedValidations (CoreMeasurementID)
VALUES (vCoreMeasurementID);
SET
insertCount = insertCount + 1;
            -- Check if the error record already exists before inserting
            IF
NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
END IF;
ELSE
            SET validationResult = 1;
            SET
errorMessage = NULL;
END IF;

INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                 ValidationOutcome, ErrorMessage,
                                 ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                 AdditionalDetails)
VALUES ('ValidateScreenMeasuredDiameterMinMax', NOW(), vCoreMeasurementID,
        IF(validationResult, 'Passed', 'Failed'), errorMessage,
        validationCriteria, measuredValue, expectedValueRange,
        additionalDetails);
END LOOP;
CLOSE cur;

SET
successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

SELECT CoreMeasurementID
FROM FailedValidations;

DROP
TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
definer = azureroot@`%` procedure ValidateScreenStemsWithMeasurementsButDeadAttributes(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE
vCoreMeasurementID INT;
    DECLARE
validationResult BIT;
    DECLARE
errorMessage VARCHAR(255);
    DECLARE
validationCriteria TEXT;
    DECLARE
additionalDetails TEXT;
    DECLARE
insertCount INT DEFAULT 0;
    DECLARE
expectedCount INT;
    DECLARE
successMessage VARCHAR(255);
    DECLARE
done INT DEFAULT FALSE;
    DECLARE
veID INT;
    DECLARE
vExistingErrorID INT;

    DECLARE
cur CURSOR FOR
SELECT cm.CoreMeasurementID
FROM coremeasurements cm
         JOIN cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
         JOIN attributes a ON cma.Code = a.Code
         JOIN stems st ON cm.StemID = st.StemID
         JOIN quadrats q ON st.QuadratID = q.QuadratID
WHERE ((cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR
       (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0))
  AND a.Status IN ('dead', 'stem dead', 'missing', 'broken below', 'omitted')
  AND cm.IsValidated IS FALSE
  AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

DECLARE
CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE
TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

SELECT COUNT(*)
INTO expectedCount
FROM coremeasurements cm
         JOIN cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
         JOIN attributes a ON cma.Code = a.Code
         JOIN stems st ON cm.StemID = st.StemID
         JOIN quadrats q ON st.QuadratID = q.QuadratID
WHERE ((cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR
       (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0))
  AND a.Status IN ('dead', 'stem dead', 'missing', 'broken below', 'omitted')
  AND cm.IsValidated IS FALSE
  AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
  AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

SELECT ValidationID
INTO veID
FROM catalog.validationprocedures
WHERE ProcedureName = 'ValidateScreenStemsWithMeasurementsButDeadAttributes';


OPEN cur;
loop1
:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF
done THEN
            LEAVE loop1;
END IF;

        SET
validationCriteria = 'Stem Measurements with Dead Attributes Validation';
        SET
additionalDetails = 'Verifies that stems marked as dead do not have active measurements.';

        IF
EXISTS (SELECT 1
                   FROM cmattributes cma
                            JOIN attributes a ON cma.Code = a.Code
                            JOIN coremeasurements cm on cma.CoreMeasurementID = cm.CoreMeasurementID
                   WHERE cma.CoreMeasurementID = vCoreMeasurementID
                     AND a.Status IN ('dead', 'stem dead', 'missing', 'broken below', 'omitted')
                     AND ((cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR
                          (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0))) THEN
            SET validationResult = 0;
            SET
errorMessage = 'Stem with measurements but dead attributes detected.';
            -- Check if the error record already exists before inserting
            IF
NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
END IF;
INSERT INTO FailedValidations (CoreMeasurementID)
VALUES (vCoreMeasurementID);
SET
insertCount = insertCount + 1;
ELSE
            SET validationResult = 1;
            SET
errorMessage = NULL;
END IF;

INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                 ValidationOutcome, ErrorMessage,
                                 ValidationCriteria, AdditionalDetails)
VALUES ('ValidateScreenStemsWithMeasurementsButDeadAttributes', NOW(), vCoreMeasurementID,
        IF(validationResult, 'Passed', 'Failed'), errorMessage,
        validationCriteria, additionalDetails);
END LOOP;
CLOSE cur;

SET
successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

SELECT CoreMeasurementID
FROM FailedValidations;

DROP
TEMPORARY TABLE IF EXISTS FailedValidations;
END;

