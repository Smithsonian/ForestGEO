-- intended for internal use, this is a skeleton validation procedure that can be quickly and easily filled out to more easily implement new procedures:

CREATE DEFINER = azureroot@`%` PROCEDURE ValidateSkeleton(
    IN p_CensusID INT,
    IN p_PlotID INT,
    IN minHOM DECIMAL(10, 2) DEFAULT NULL,
    IN maxHOM DECIMAL(10, 2) DEFAULT NULL,
    IN minDBH DECIMAL(10, 2) DEFAULT NULL,
    IN maxDBH DECIMAL(10, 2) DEFAULT NULL
)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE validationCriteria TEXT;
    DECLARE measuredValue VARCHAR(255);
    DECLARE expectedValueRange VARCHAR(255);
    DECLARE additionalDetails TEXT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE veID INT;
    DECLARE done INT DEFAULT FALSE;

    DECLARE cur CURSOR FOR
SELECT /* Columns needed for validation */
FROM /* Relevant tables and joins */
    WHERE /* Validation conditions */
    AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
    AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations (
        CoreMeasurementID INT
    );

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
END IF;

SELECT COUNT(*)
INTO expectedCount
FROM /* Relevant tables and joins */
    WHERE /* Validation conditions */
    AND (p_CensusID = -1 OR q.CensusID = p_CensusID)
    AND (p_PlotID = -1 OR q.PlotID = p_PlotID);

/*SELECT ValidationID
INTO veID
FROM catalog.validationprocedures
WHERE ProcedureName = 'YourProcedureName';*/

OPEN cur;
loop1: LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
END IF;

        SET validationCriteria = 'Your Validation Criteria';
        SET measuredValue = 'Your Measured Value';
        SET expectedValueRange = 'Your Expected Value Range';
        SET additionalDetails = 'Additional Details for Validation';

        IF /* Your validation logic */ THEN
            SET validationResult = 0;
            SET errorMessage = 'Your Error Message';
            IF NOT EXISTS (SELECT 1 FROM cmverrors WHERE CoreMeasurementID = vCoreMeasurementID AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
END IF;
INSERT INTO FailedValidations (CoreMeasurementID)
VALUES (vCoreMeasurementID);
SET insertCount = insertCount + 1;
ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
END IF;

INSERT INTO validationchangelog (
    ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
    ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
) VALUES (
             'YourProcedureName', NOW(), vCoreMeasurementID,
             IF(validationResult, 'Passed', 'Failed'), errorMessage,
             validationCriteria, measuredValue, expectedValueRange, additionalDetails
         );
END LOOP;
CLOSE cur;

SET successMessage = CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

SELECT CoreMeasurementID FROM FailedValidations;

DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;
