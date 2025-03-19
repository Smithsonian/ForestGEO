set foreign_key_checks = 0;

truncate sitespecificvalidations;

INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (1, 'ValidateDBHGrowthExceedsMax', 'DBH growth exceeds maximum rate of 65 mm', 'measuredDBH', 'INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
SELECT
    cm2.CoreMeasurementID, @validationProcedureID AS ValidationErrorID
FROM coremeasurements cm1
JOIN coremeasurements cm2
    ON cm1.StemID = cm2.StemID
    AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
LEFT JOIN stems st2
    ON cm2.StemID = st2.StemID
LEFT JOIN quadrats q
    ON st2.QuadratID = q.QuadratID
LEFT JOIN plots p ON q.PlotID = p.PlotID
LEFT JOIN cmattributes cma
    ON cm1.CoreMeasurementID = cma.CoreMeasurementID
LEFT JOIN attributes a
    ON cma.Code = a.Code
    LEFT JOIN cmverrors e
  ON e.CoreMeasurementID = cm2.CoreMeasurementID
  AND e.ValidationErrorID = @validationProcedureID
WHERE
    (a.Status NOT IN (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\') OR a.Status IS NULL)
    AND cm1.MeasuredDBH IS NOT NULL
    AND cm2.MeasuredDBH IS NOT NULL
    AND cm1.IsValidated IS TRUE
    AND cm2.IsValidated IS NULL
    AND (@p_CensusID IS NULL OR cm2.CensusID = @p_CensusID)
    AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
    AND (cm2.MeasuredDBH * (CASE p.DefaultDBHUnits
                              WHEN \'km\' THEN 1000000
                              WHEN \'hm\' THEN 100000
                              WHEN \'dam\' THEN 10000
                              WHEN \'m\' THEN 1000
                              WHEN \'dm\' THEN 100
                              WHEN \'cm\' THEN 10
                              WHEN \'mm\' THEN 1
                              ELSE 1 END)
          - cm1.MeasuredDBH * (CASE p.DefaultDBHUnits
                                WHEN \'km\' THEN 1000000
                                WHEN \'hm\' THEN 100000
                                WHEN \'dam\' THEN 10000
                                WHEN \'m\' THEN 1000
                                WHEN \'dm\' THEN 100
                                WHEN \'cm\' THEN 10
                                WHEN \'mm\' THEN 1
                                ELSE 1 END) > 65)
    AND e.CoreMeasurementID IS NULL
ON DUPLICATE KEY UPDATE
    CoreMeasurementID = VALUES(CoreMeasurementID),
    ValidationErrorID = VALUES(ValidationErrorID);', 'INSERT INTO validationchangelog (
    ProcedureName, RunDateTime, TargetRowID, ValidationOutcome,
    ErrorMessage, ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
)
SELECT
    \'ValidateDBHGrowthExceedsMax\' AS ProcedureName,
    NOW() AS RunDateTime,
    cm2.CoreMeasurementID AS TargetRowID,
    CASE
        WHEN (cm2.MeasuredDBH * (CASE p.DefaultDBHUnits
                                    WHEN \'km\' THEN 1000000
                                    WHEN \'hm\' THEN 100000
                                    WHEN \'dam\' THEN 10000
                                    WHEN \'m\' THEN 1000
                                    WHEN \'dm\' THEN 100
                                    WHEN \'cm\' THEN 10
                                    WHEN \'mm\' THEN 1
                                    ELSE 1 END)
              - cm1.MeasuredDBH * (CASE p.DefaultDBHUnits
                                    WHEN \'km\' THEN 1000000
                                    WHEN \'hm\' THEN 100000
                                    WHEN \'dam\' THEN 10000
                                    WHEN \'m\' THEN 1000
                                    WHEN \'dm\' THEN 100
                                    WHEN \'cm\' THEN 10
                                    WHEN \'mm\' THEN 1
                                    ELSE 1 END)) > 65 THEN \'Failed\'
        ELSE \'Passed\'
    END AS ValidationOutcome,
    CASE
        WHEN (cm2.MeasuredDBH * (CASE p.DefaultDBHUnits
                                    WHEN \'km\' THEN 1000000
                                    WHEN \'hm\' THEN 100000
                                    WHEN \'dam\' THEN 10000
                                    WHEN \'m\' THEN 1000
                                    WHEN \'dm\' THEN 100
                                    WHEN \'cm\' THEN 10
                                    WHEN \'mm\' THEN 1
                                    ELSE 1 END)
              - cm1.MeasuredDBH * (CASE p.DefaultDBHUnits
                                    WHEN \'km\' THEN 1000000
                                    WHEN \'hm\' THEN 100000
                                    WHEN \'dam\' THEN 10000
                                    WHEN \'m\' THEN 1000
                                    WHEN \'dm\' THEN 100
                                    WHEN \'cm\' THEN 10
                                    WHEN \'mm\' THEN 1
                                    ELSE 1 END)) > 65 THEN
            \'DBH growth exceeds the maximum allowable rate of 65 mm\'
        ELSE NULL
    END AS ErrorMessage,
    \'DBH growth between consecutive years must not exceed 65 mm\' AS ValidationCriteria,
    CONCAT(\'Current DBH: \', cm2.MeasuredDBH, \', Previous DBH: \', cm1.MeasuredDBH) AS MeasuredValue,
    \'DBH growth should not exceed 65 mm\' AS ExpectedValueRange,
    CONCAT(\'Stem ID: \', st2.StemID, \', Quadrat ID: \', q.QuadratID, \', Census ID: \', cm2.CensusID) AS AdditionalDetails
FROM coremeasurements cm1
JOIN coremeasurements cm2
    ON cm1.StemID = cm2.StemID
    AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
LEFT JOIN stems st2
    ON cm2.StemID = st2.StemID
LEFT JOIN quadrats q
    ON st2.QuadratID = q.QuadratID
LEFT JOIN plots p
    ON q.PlotID = p.PlotID
LEFT JOIN cmattributes cma
    ON cm1.CoreMeasurementID = cma.CoreMeasurementID
LEFT JOIN attributes a
    ON cma.Code = a.Code
LEFT JOIN cmverrors e
    ON e.CoreMeasurementID = cm2.CoreMeasurementID
    AND e.ValidationErrorID = @validationProcedureID
WHERE
    (a.Status NOT IN (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\') OR a.Status IS NULL)
    AND cm1.MeasuredDBH IS NOT NULL
    AND cm2.MeasuredDBH IS NOT NULL
    AND cm1.IsValidated IS TRUE
    AND cm2.IsValidated IS NULL
    AND (@p_CensusID IS NULL OR cm2.CensusID = @p_CensusID)
    AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID);
', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (2, 'ValidateDBHShrinkageExceedsMax', 'DBH shrinkage exceeds maximum rate of 5 percent', 'measuredDBH', 'INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
SELECT
      cm2.CoreMeasurementID, @validationProcedureID AS ValidationErrorID
    FROM coremeasurements cm1
    JOIN coremeasurements cm2
      ON cm1.StemID = cm2.StemID
      AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
    LEFT JOIN stems st
      ON cm2.StemID = st.StemID
    LEFT JOIN quadrats q
      ON st.QuadratID = q.QuadratID
    LEFT JOIN plots p ON q.PlotID = p.PlotID
    LEFT JOIN cmattributes cma
      ON cm1.CoreMeasurementID = cma.CoreMeasurementID
    LEFT JOIN attributes a
      ON cma.Code = a.Code
      LEFT JOIN cmverrors e
  ON e.CoreMeasurementID = cm2.CoreMeasurementID
  AND e.ValidationErrorID = @validationProcedureID
    WHERE
      (a.Status NOT IN (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\') OR a.Status IS NULL)
      AND cm1.MeasuredDBH IS NOT NULL
      AND cm2.MeasuredDBH IS NOT NULL
      AND cm1.IsValidated IS TRUE
      AND cm2.IsValidated IS NULL
      AND (@p_CensusID IS NULL OR cm2.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
      AND (cm2.MeasuredDBH * (CASE p.DefaultDBHUnits
                                WHEN \'km\' THEN 1000000
                                WHEN \'hm\' THEN 100000
                                WHEN \'dam\' THEN 10000
                                WHEN \'m\' THEN 1000
                                WHEN \'dm\' THEN 100
                                WHEN \'cm\' THEN 10
                                WHEN \'mm\' THEN 1
                                ELSE 1 END)
            < cm1.MeasuredDBH * (CASE p.DefaultDBHUnits
                                  WHEN \'km\' THEN 1000000
                                  WHEN \'hm\' THEN 100000
                                  WHEN \'dam\' THEN 10000
                                  WHEN \'m\' THEN 1000
                                  WHEN \'dm\' THEN 100
                                  WHEN \'cm\' THEN 10
                                  WHEN \'mm\' THEN 1
                                  ELSE 1 END) * 0.95)
    AND e.CoreMeasurementID IS NULL
ON DUPLICATE KEY UPDATE
    CoreMeasurementID = VALUES(CoreMeasurementID),
    ValidationErrorID = VALUES(ValidationErrorID);    ', 'INSERT INTO validationchangelog (
    ProcedureName, RunDateTime, TargetRowID, ValidationOutcome,
    ErrorMessage, ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
)
SELECT
    \'ValidateDBHShrinkageExceedsMax\' AS ProcedureName,
    NOW() AS RunDateTime,
    cm2.CoreMeasurementID AS TargetRowID,
    CASE
        WHEN (cm2.MeasuredDBH * (CASE p.DefaultDBHUnits
                                    WHEN \'km\' THEN 1000000
                                    WHEN \'hm\' THEN 100000
                                    WHEN \'dam\' THEN 10000
                                    WHEN \'m\' THEN 1000
                                    WHEN \'dm\' THEN 100
                                    WHEN \'cm\' THEN 10
                                    WHEN \'mm\' THEN 1
                                    ELSE 1 END)
              < cm1.MeasuredDBH * (CASE p.DefaultDBHUnits
                                    WHEN \'km\' THEN 1000000
                                    WHEN \'hm\' THEN 100000
                                    WHEN \'dam\' THEN 10000
                                    WHEN \'m\' THEN 1000
                                    WHEN \'dm\' THEN 100
                                    WHEN \'cm\' THEN 10
                                    WHEN \'mm\' THEN 1
                                    ELSE 1 END) * 0.95) THEN \'Failed\'
        ELSE \'Passed\'
    END AS ValidationOutcome,
    CASE
        WHEN (cm2.MeasuredDBH * (CASE p.DefaultDBHUnits
                                    WHEN \'km\' THEN 1000000
                                    WHEN \'hm\' THEN 100000
                                    WHEN \'dam\' THEN 10000
                                    WHEN \'m\' THEN 1000
                                    WHEN \'dm\' THEN 100
                                    WHEN \'cm\' THEN 10
                                    WHEN \'mm\' THEN 1
                                    ELSE 1 END)
              < cm1.MeasuredDBH * (CASE p.DefaultDBHUnits
                                    WHEN \'km\' THEN 1000000
                                    WHEN \'hm\' THEN 100000
                                    WHEN \'dam\' THEN 10000
                                    WHEN \'m\' THEN 1000
                                    WHEN \'dm\' THEN 100
                                    WHEN \'cm\' THEN 10
                                    WHEN \'mm\' THEN 1
                                    ELSE 1 END) * 0.95) THEN
            \'DBH shrinkage exceeds the maximum allowable rate of 5%\'
        ELSE NULL
    END AS ErrorMessage,
    \'DBH shrinkage between consecutive years must not exceed 5%\' AS ValidationCriteria,
    CONCAT(\'Current DBH: \', cm2.MeasuredDBH, \', Previous DBH: \', cm1.MeasuredDBH) AS MeasuredValue,
    \'DBH should shrink by no more than 5%\' AS ExpectedValueRange,
    CONCAT(\'Stem ID: \', st.StemID, \', Quadrat ID: \', q.QuadratID, \', Census ID: \', cm2.CensusID) AS AdditionalDetails
FROM coremeasurements cm1
JOIN coremeasurements cm2
  ON cm1.StemID = cm2.StemID
  AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
LEFT JOIN stems st
  ON cm2.StemID = st.StemID
LEFT JOIN quadrats q
  ON st.QuadratID = q.QuadratID
LEFT JOIN plots p
  ON q.PlotID = p.PlotID
LEFT JOIN cmattributes cma
  ON cm1.CoreMeasurementID = cma.CoreMeasurementID
LEFT JOIN attributes a
  ON cma.Code = a.Code
LEFT JOIN cmverrors e
  ON e.CoreMeasurementID = cm2.CoreMeasurementID
  AND e.ValidationErrorID = @validationProcedureID
WHERE
    (a.Status NOT IN (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\') OR a.Status IS NULL)
    AND cm1.MeasuredDBH IS NOT NULL
    AND cm2.MeasuredDBH IS NOT NULL
    AND cm1.IsValidated IS TRUE
    AND cm2.IsValidated IS NULL
    AND (@p_CensusID IS NULL OR cm2.CensusID = @p_CensusID)
    AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID);
', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (3, 'ValidateFindAllInvalidSpeciesCodes', 'Species Code is invalid (not defined in species table)', 'speciesCode', 'INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
SELECT cm.CoreMeasurementID, @validationProcedureID AS ValidationErrorID
    FROM stems s
    JOIN trees t ON s.TreeID = t.TreeID
    LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
    JOIN coremeasurements cm ON s.StemID = cm.StemID
    LEFT JOIN quadrats q ON s.QuadratID = q.QuadratID
    LEFT JOIN cmverrors e
  ON e.CoreMeasurementID = cm.CoreMeasurementID
  AND e.ValidationErrorID = @validationProcedureID
    WHERE sp.SpeciesID IS NULL
      AND cm.IsValidated IS NULL
      AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
      AND e.CoreMeasurementID IS NULL
    GROUP BY cm.CoreMeasurementID
ON DUPLICATE KEY UPDATE
    CoreMeasurementID = VALUES(CoreMeasurementID),
    ValidationErrorID = VALUES(ValidationErrorID);', 'INSERT INTO validationchangelog (
    ProcedureName, RunDateTime, TargetRowID, ValidationOutcome,
    ErrorMessage, ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
)
SELECT
    \'ValidateFindAllInvalidSpeciesCodes\' AS ProcedureName,
    NOW() AS RunDateTime,
    cm.CoreMeasurementID AS TargetRowID,
    CASE
        WHEN sp.SpeciesID IS NULL THEN \'Failed\'
        ELSE \'Passed\'
    END AS ValidationOutcome,
    CASE
        WHEN sp.SpeciesID IS NULL THEN \'Invalid species code (not found in species table)\'
        ELSE NULL
    END AS ErrorMessage,
    \'Species code must be valid and defined in the species table\' AS ValidationCriteria,
    CASE
        WHEN sp.SpeciesID IS NULL THEN CONCAT(\'SpeciesID: NULL, TreeID: \', t.TreeID)
        ELSE CONCAT(\'SpeciesID: \', sp.SpeciesID, \', TreeID: \', t.TreeID)
    END AS MeasuredValue,
    \'A valid species code linked to the species table\' AS ExpectedValueRange,
    CONCAT(\'Stem Tag: \', s.StemTag, \', Tree ID: \', t.TreeID, \', Quadrat ID: \', q.QuadratID) AS AdditionalDetails
FROM stems s
JOIN trees t ON s.TreeID = t.TreeID
LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
JOIN coremeasurements cm ON s.StemID = cm.StemID
LEFT JOIN quadrats q ON s.QuadratID = q.QuadratID
LEFT JOIN cmverrors e
  ON e.CoreMeasurementID = cm.CoreMeasurementID
  AND e.ValidationErrorID = @validationProcedureID
WHERE cm.IsValidated IS NULL
  AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID);
', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (4, 'ValidateFindDuplicatedQuadratsByName', 'Quadrat\'s name matches existing OTHER quadrat (QuadratIDs are different but QuadratNames are the same)', 'quadratName', 'INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
SELECT cm.CoreMeasurementID, @validationProcedureID AS ValidationErrorID
    FROM quadrats q
    LEFT JOIN stems st ON q.QuadratID = st.QuadratID
    JOIN coremeasurements cm ON st.StemID = cm.StemID
    LEFT JOIN cmverrors e
  ON e.CoreMeasurementID = cm.CoreMeasurementID
  AND e.ValidationErrorID = @validationProcedureID
    WHERE cm.IsValidated IS NULL
      AND (q.PlotID, q.QuadratName) IN (
          SELECT PlotID, QuadratName
          FROM quadrats
          GROUP BY PlotID, QuadratName
          HAVING COUNT(*) > 1
      )
      AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
      AND e.CoreMeasurementID IS NULL
    GROUP BY cm.CoreMeasurementID
ON DUPLICATE KEY UPDATE
    CoreMeasurementID = VALUES(CoreMeasurementID),
    ValidationErrorID = VALUES(ValidationErrorID);', 'INSERT INTO validationchangelog (
    ProcedureName, RunDateTime, TargetRowID, ValidationOutcome,
    ErrorMessage, ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
)
SELECT
    \'ValidateFindDuplicatedQuadratsByName\' AS ProcedureName,
    NOW() AS RunDateTime,
    cm.CoreMeasurementID AS TargetRowID,
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM quadrats q2
            WHERE q2.PlotID = q.PlotID
              AND q2.QuadratName = q.QuadratName
              AND q2.QuadratID != q.QuadratID
        ) THEN \'Failed\'
        ELSE \'Passed\'
    END AS ValidationOutcome,
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM quadrats q2
            WHERE q2.PlotID = q.PlotID
              AND q2.QuadratName = q.QuadratName
              AND q2.QuadratID != q.QuadratID
        ) THEN \'Duplicate quadrat name found in the same plot\'
        ELSE NULL
    END AS ErrorMessage,
    \'Quadrat names must be unique within the same plot\' AS ValidationCriteria,
    CONCAT(\'Quadrat Name: \', q.QuadratName, \', Plot ID: \', q.PlotID) AS MeasuredValue,
    \'Unique quadrat names within each plot\' AS ExpectedValueRange,
    CONCAT(\'Quadrat ID: \', q.QuadratID, \', Duplicate Quadrat IDs: \',
           GROUP_CONCAT(DISTINCT q2.QuadratID SEPARATOR \', \')) AS AdditionalDetails
FROM quadrats q
LEFT JOIN stems st ON q.QuadratID = st.QuadratID
JOIN coremeasurements cm ON st.StemID = cm.StemID
LEFT JOIN cmverrors e
  ON e.CoreMeasurementID = cm.CoreMeasurementID
  AND e.ValidationErrorID = @validationProcedureID
WHERE cm.IsValidated IS NULL
  AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID);
', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (5, 'ValidateFindDuplicateStemTreeTagCombinationsPerCensus', 'Duplicate tree (and stem) tag found in census;Duplicate stem (and tree) tag found in census', 'stemTag;treeTag', 'INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
SELECT
    cm.CoreMeasurementID, @validationProcedureID AS ValidationErrorID
FROM coremeasurements cm
INNER JOIN stems s ON cm.StemID = s.StemID
INNER JOIN trees t ON s.TreeID = t.TreeID
INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
LEFT JOIN cmverrors e
  ON e.CoreMeasurementID = cm.CoreMeasurementID
  AND e.ValidationErrorID = @validationProcedureID
WHERE (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
  AND cm.IsValidated IS NULL
  AND s.StemTag IS NOT NULL
  AND s.StemTag <> \'\'
  AND (s.StemTag, t.TreeTag) IN (
      SELECT s2.StemTag, t2.TreeTag
      FROM coremeasurements cm2
      INNER JOIN stems s2 ON cm2.StemID = s2.StemID
      INNER JOIN trees t2 ON s2.TreeID = t2.TreeID
      INNER JOIN quadrats q2 ON s2.QuadratID = q2.QuadratID
      WHERE (@p_CensusID IS NULL OR cm2.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q2.PlotID = @p_PlotID)
        AND cm2.IsValidated IS NULL
        AND s2.StemTag IS NOT NULL
        AND s2.StemTag <> \'\'
        AND (s.StemTag = s2.StemTag AND t.TreeTag = t2.TreeTag)
        AND q.QuadratID = q2.QuadratID
        AND cm.MeasurementDate = cm2.MeasurementDate
        AND cm.CensusID = cm2.CensusID
      GROUP BY s2.StemTag, t2.TreeTag, cm2.CensusID
      HAVING COUNT(*) > 1
  ) AND e.CoreMeasurementID IS NULL
ON DUPLICATE KEY UPDATE
    CoreMeasurementID = VALUES(CoreMeasurementID),
    ValidationErrorID = VALUES(ValidationErrorID);', 'INSERT INTO validationchangelog (
    ProcedureName, RunDateTime, TargetRowID, ValidationOutcome,
    ErrorMessage, ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
)
SELECT
    \'ValidateFindDuplicateStemTreeTagCombinationsPerCensus\' AS ProcedureName,
    NOW() AS RunDateTime,
    cm.CoreMeasurementID AS TargetRowID,
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM coremeasurements cm2
            INNER JOIN stems s2 ON cm2.StemID = s2.StemID
            INNER JOIN trees t2 ON s2.TreeID = t2.TreeID
            INNER JOIN quadrats q2 ON s2.QuadratID = q2.QuadratID
            WHERE (@p_CensusID IS NULL OR cm2.CensusID = @p_CensusID)
              AND (@p_PlotID IS NULL OR q2.PlotID = @p_PlotID)
              AND cm2.IsValidated IS NULL
              AND s2.StemTag IS NOT NULL
              AND s2.StemTag <> \'\'
              AND (s.StemTag = s2.StemTag AND t.TreeTag = t2.TreeTag)
              AND q.QuadratID = q2.QuadratID
              AND cm.MeasurementDate = cm2.MeasurementDate
            GROUP BY s2.StemTag, t2.TreeTag, cm2.CensusID
            HAVING COUNT(*) > 1
        ) THEN \'Failed\'
        ELSE \'Passed\'
    END AS ValidationOutcome,
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM coremeasurements cm2
            INNER JOIN stems s2 ON cm2.StemID = s2.StemID
            INNER JOIN trees t2 ON s2.TreeID = t2.TreeID
            INNER JOIN quadrats q2 ON s2.QuadratID = q2.QuadratID
            WHERE (@p_CensusID IS NULL OR cm2.CensusID = @p_CensusID)
              AND (@p_PlotID IS NULL OR q2.PlotID = @p_PlotID)
              AND cm2.IsValidated IS NULL
              AND s2.StemTag IS NOT NULL
              AND s2.StemTag <> \'\'
              AND (s.StemTag = s2.StemTag AND t.TreeTag = t2.TreeTag)
              AND q.QuadratID = q2.QuadratID
              AND cm.MeasurementDate = cm2.MeasurementDate
            GROUP BY s2.StemTag, t2.TreeTag, cm2.CensusID
            HAVING COUNT(*) > 1
        ) THEN \'Duplicate tree and stem tags found in the same census\'
        ELSE NULL
    END AS ErrorMessage,
    \'Tree and stem tags must be unique within the same census\' AS ValidationCriteria,
    CONCAT(\'Stem Tag: \', s.StemTag, \', Tree Tag: \', t.TreeTag) AS MeasuredValue,
    \'Unique combination of tree and stem tags within census\' AS ExpectedValueRange,
    CONCAT(\'Quadrat ID: \', q.QuadratID, \', Census ID: \', cm.CensusID, \', Measurement Date: \', DATE_FORMAT(cm.MeasurementDate, \'%Y-%m-%d\')) AS AdditionalDetails
FROM coremeasurements cm
INNER JOIN stems s ON cm.StemID = s.StemID
INNER JOIN trees t ON s.TreeID = t.TreeID
INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
LEFT JOIN cmverrors e
  ON e.CoreMeasurementID = cm.CoreMeasurementID
  AND e.ValidationErrorID = @validationProcedureID
WHERE cm.IsValidated IS NULL
  AND s.StemTag IS NOT NULL
  AND s.StemTag <> \'\'
  AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID);
', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (6, 'ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat', 'Outside census date bounds', 'measurementDate', 'INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
SELECT MIN(cm.CoreMeasurementID) AS CoreMeasurementID, @validationProcedureID AS ValidationErrorID
    FROM coremeasurements cm
    JOIN stems st ON cm.StemID = st.StemID
    JOIN quadrats q ON st.QuadratID = q.QuadratID
    JOIN census c ON cm.CensusID = c.CensusID
    LEFT JOIN cmverrors e
  ON e.CoreMeasurementID = cm.CoreMeasurementID
  AND e.ValidationErrorID = @validationProcedureID
    WHERE (cm.MeasurementDate < c.StartDate OR cm.MeasurementDate > c.EndDate)
      AND cm.MeasurementDate IS NOT NULL
      AND cm.IsValidated IS NULL
      AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
      AND e.CoreMeasurementID IS NULL
    GROUP BY q.QuadratID, c.CensusID, c.StartDate, c.EndDate
ON DUPLICATE KEY UPDATE
    CoreMeasurementID = VALUES(CoreMeasurementID),
    ValidationErrorID = VALUES(ValidationErrorID);', 'INSERT INTO validationchangelog (
    ProcedureName, RunDateTime, TargetRowID, ValidationOutcome,
    ErrorMessage, ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
)
SELECT
    \'ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat\' AS ProcedureName,
    NOW() AS RunDateTime,
    cm.CoreMeasurementID AS TargetRowID,
    CASE
        WHEN cm.MeasurementDate < c.StartDate OR cm.MeasurementDate > c.EndDate THEN \'Failed\'
        ELSE \'Passed\'
    END AS ValidationOutcome,
    CASE
        WHEN cm.MeasurementDate < c.StartDate OR cm.MeasurementDate > c.EndDate THEN
            \'Measurement date falls outside of the census date bounds\'
        ELSE NULL
    END AS ErrorMessage,
    \'Measurement date should be within the census start and end dates\' AS ValidationCriteria,
    CONCAT(\'Measurement Date: \', DATE_FORMAT(cm.MeasurementDate, \'%Y-%m-%d\')) AS MeasuredValue,
    CONCAT(\'Census Date Range: \', DATE_FORMAT(c.StartDate, \'%Y-%m-%d\'), \' to \', DATE_FORMAT(c.EndDate, \'%Y-%m-%d\')) AS ExpectedValueRange,
    CONCAT(\'Quadrat ID: \', q.QuadratID, \', Census ID: \', c.CensusID, \', Start Date: \', DATE_FORMAT(c.StartDate, \'%Y-%m-%d\'),
           \', End Date: \', DATE_FORMAT(c.EndDate, \'%Y-%m-%d\')) AS AdditionalDetails
FROM coremeasurements cm
JOIN stems st ON cm.StemID = st.StemID
JOIN quadrats q ON st.QuadratID = q.QuadratID
JOIN census c ON cm.CensusID = c.CensusID
LEFT JOIN cmverrors e
  ON e.CoreMeasurementID = cm.CoreMeasurementID
  AND e.ValidationErrorID = @validationProcedureID
WHERE cm.MeasurementDate IS NOT NULL
  AND cm.IsValidated IS NULL
  AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID);
', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (7, 'ValidateFindStemsInTreeWithDifferentSpecies', 'Flagged;Different species', 'stemTag;speciesCode', 'INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
SELECT cm.CoreMeasurementID, @validationProcedureID AS ValidationErrorID
    FROM coremeasurements cm
    JOIN stems s ON cm.StemID = s.StemID
    JOIN trees t ON s.TreeID = t.TreeID
    JOIN quadrats q ON s.QuadratID = q.QuadratID
    LEFT JOIN cmverrors e
  ON e.CoreMeasurementID = cm.CoreMeasurementID
  AND e.ValidationErrorID = @validationProcedureID
    WHERE cm.IsValidated = NULL
      AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
      AND e.CoreMeasurementID IS NULL
    GROUP BY t.TreeID, cm.CoreMeasurementID
    HAVING COUNT(DISTINCT t.SpeciesID) > 1
ON DUPLICATE KEY UPDATE
    CoreMeasurementID = VALUES(CoreMeasurementID),
    ValidationErrorID = VALUES(ValidationErrorID);', 'INSERT INTO validationchangelog (
    ProcedureName, RunDateTime, TargetRowID, ValidationOutcome,
    ErrorMessage, ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
)
SELECT
    \'ValidateFindStemsInTreeWithDifferentSpecies\' AS ProcedureName,
    NOW() AS RunDateTime,
    cm.CoreMeasurementID AS TargetRowID,
    CASE
        WHEN COUNT(DISTINCT t.SpeciesID) > 1 THEN \'Failed\'
        ELSE \'Passed\'
    END AS ValidationOutcome,
    CASE
        WHEN COUNT(DISTINCT t.SpeciesID) > 1 THEN
            \'A tree contains stems with measurements from multiple distinct species\'
        ELSE NULL
    END AS ErrorMessage,
    \'All stems within the same tree must have the same species\' AS ValidationCriteria,
    CONCAT(\'Tree contains \', COUNT(DISTINCT t.SpeciesID), \' distinct species\') AS MeasuredValue,
    \'Tree species count should be 1\' AS ExpectedValueRange,
    CONCAT(\'Tree ID: \', t.TreeID, \', Stem Tag: \', s.StemTag, \', Species IDs: \', GROUP_CONCAT(DISTINCT t.SpeciesID)) AS AdditionalDetails
FROM coremeasurements cm
JOIN stems s ON cm.StemID = s.StemID
JOIN trees t ON s.TreeID = t.TreeID
JOIN quadrats q ON s.QuadratID = q.QuadratID
LEFT JOIN cmverrors e
  ON e.CoreMeasurementID = cm.CoreMeasurementID
  AND e.ValidationErrorID = @validationProcedureID
WHERE cm.IsValidated IS NULL
  AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
GROUP BY t.TreeID, cm.CoreMeasurementID
HAVING COUNT(DISTINCT t.SpeciesID) > 1;
', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (8, 'ValidateFindStemsOutsidePlots', 'Flagged;X outside plot OR;Y outside plot', 'stemTag;stemLocalX;stemLocalY', 'INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
SELECT cm.CoreMeasurementID, @validationProcedureID AS ValidationErrorID
FROM stems s
         INNER JOIN coremeasurements cm ON s.StemID = cm.StemID
         INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
         INNER JOIN plots p ON q.PlotID = p.PlotID
         LEFT JOIN cmverrors e
                   ON e.CoreMeasurementID = cm.CoreMeasurementID
                       AND e.ValidationErrorID = @validationProcedureID
WHERE ((s.LocalX + q.StartX + p.GlobalX) > (p.GlobalX + p.DimensionX) OR
       (s.LocalY + q.StartY + p.GlobalY) > (p.GlobalY + p.DimensionY))
  AND s.LocalX IS NOT NULL
  AND s.LocalY IS NOT NULL
  AND q.StartX IS NOT NULL
  AND q.StartY IS NOT NULL
  AND p.GlobalX IS NOT NULL
  AND p.GlobalY IS NOT NULL
  AND p.DimensionX > 0
  AND p.DimensionY > 0
  AND cm.IsValidated IS NULL
  AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
  AND e.CoreMeasurementID IS NULL
GROUP BY cm.CoreMeasurementID
ON DUPLICATE KEY UPDATE CoreMeasurementID = VALUES(CoreMeasurementID),
                        ValidationErrorID = VALUES(ValidationErrorID);', 'INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, ValidationOutcome,
                                 ErrorMessage, ValidationCriteria, MeasuredValue, ExpectedValueRange)
SELECT \'ValidateFindStemsOutsidePlots\'                                          AS ProcedureName,
       NOW()                                                                    AS RunDateTime,
       cm.CoreMeasurementID                                                     AS TargetRowID,
       CASE
           WHEN ((s.LocalX + q.StartX + p.GlobalX) > (p.GlobalX + p.DimensionX) OR
                 (s.LocalY + q.StartY + p.GlobalY) > (p.GlobalY + p.DimensionY))
               AND s.LocalX IS NOT NULL
               AND s.LocalY IS NOT NULL
               AND q.StartX IS NOT NULL
               AND q.StartY IS NOT NULL
               AND p.GlobalX IS NOT NULL
               AND p.GlobalY IS NOT NULL
               AND p.DimensionX > 0
               AND p.DimensionY > 0 THEN \'Failed\'
           ELSE \'Passed\'
           END                                                                  AS ValidationOutcome,
       CASE
           WHEN ((s.LocalX + q.StartX + p.GlobalX) > (p.GlobalX + p.DimensionX) OR
                 (s.LocalY + q.StartY + p.GlobalY) > (p.GlobalY + p.DimensionY))
               AND s.LocalX IS NOT NULL
               AND s.LocalY IS NOT NULL
               AND q.StartX IS NOT NULL
               AND q.StartY IS NOT NULL
               AND p.GlobalX IS NOT NULL
               AND p.GlobalY IS NOT NULL
               AND p.DimensionX > 0
               AND p.DimensionY > 0 THEN
               \'Stem\\s calculated coordinates are outside plot dimensions\'
           ELSE NULL
           END                                                                  AS ErrorMessage,
       \'Stem global coordinates\'                                                AS ValidationCriteria,
       CASE
           WHEN ((s.LocalX + q.StartX + p.GlobalX) > (p.GlobalX + p.DimensionX) OR
                 (s.LocalY + q.StartY + p.GlobalY) > (p.GlobalY + p.DimensionY))
               AND s.LocalX IS NOT NULL
               AND s.LocalY IS NOT NULL
               AND q.StartX IS NOT NULL
               AND q.StartY IS NOT NULL
               AND p.GlobalX IS NOT NULL
               AND p.GlobalY IS NOT NULL
               AND p.DimensionX > 0
               AND p.DimensionY > 0
               THEN CONCAT(\'Calculated global stem coordinates: (\', (s.LocalX + q.StartX + p.GlobalX), \', \',
                           (s.LocalY + q.StartY + p.GlobalY), \')\')
           ELSE \'Passed\'
           END                                                                  AS MeasuredValue,
       \'Stem coordinates should not land outside plot edges\'                    AS ExpectedValueRange
FROM stems s
         INNER JOIN coremeasurements cm ON s.StemID = cm.StemID
         INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
         INNER JOIN plots p ON q.PlotID = p.PlotID
         LEFT JOIN cmverrors e
                   ON e.CoreMeasurementID = cm.CoreMeasurementID
                       AND e.ValidationErrorID = @validationProcedureID
WHERE ((s.LocalX + q.StartX + p.GlobalX) > (p.GlobalX + p.DimensionX) OR
       (s.LocalY + q.StartY + p.GlobalY) > (p.GlobalY + p.DimensionY))
  AND s.LocalX IS NOT NULL
  AND s.LocalY IS NOT NULL
  AND q.StartX IS NOT NULL
  AND q.StartY IS NOT NULL
  AND p.GlobalX IS NOT NULL
  AND p.GlobalY IS NOT NULL
  AND p.DimensionX > 0
  AND p.DimensionY > 0
  AND cm.IsValidated IS NULL
  AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
  AND e.CoreMeasurementID IS NULL
', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (9, 'ValidateFindTreeStemsInDifferentQuadrats', 'Flagged;Flagged;Different quadrats', 'stemTag;treeTag;quadratName', 'INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
SELECT cm1.CoreMeasurementID, @validationProcedureID AS ValidationErrorID
FROM stems s1
JOIN stems s2 ON s1.TreeID = s2.TreeID AND s1.StemID != s2.StemID
JOIN quadrats q1 ON s1.QuadratID = q1.QuadratID
JOIN quadrats q2 ON s2.QuadratID = q2.QuadratID
JOIN coremeasurements cm1 ON s1.StemID = cm1.StemID
LEFT JOIN cmverrors e
  ON e.CoreMeasurementID = cm1.CoreMeasurementID
  AND e.ValidationErrorID = @validationProcedureID
WHERE q1.QuadratID != q2.QuadratID
  AND cm1.IsValidated IS NULL
  AND (@p_CensusID IS NULL OR cm1.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR q1.PlotID = @p_PlotID)
  AND e.CoreMeasurementID IS NULL
GROUP BY cm1.CoreMeasurementID
ON DUPLICATE KEY UPDATE
    CoreMeasurementID = VALUES(CoreMeasurementID),
    ValidationErrorID = VALUES(ValidationErrorID);', 'INSERT INTO validationchangelog (
    ProcedureName, RunDateTime, TargetRowID, ValidationOutcome,
    ErrorMessage, ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
)
SELECT
    \'ValidateFindTreeStemsInDifferentQuadrats\' AS ProcedureName,
    NOW() AS RunDateTime,
    cm1.CoreMeasurementID AS TargetRowID,
    CASE
        WHEN q1.QuadratID != q2.QuadratID THEN \'Failed\'
        ELSE \'Passed\'
    END AS ValidationOutcome,
    CASE
        WHEN q1.QuadratID != q2.QuadratID THEN
            \'Stem measurements for the same tree are associated with different quadrats\'
        ELSE NULL
    END AS ErrorMessage,
    \'Stems of the same tree should belong to the same quadrat\' AS ValidationCriteria,
    CASE
        WHEN q1.QuadratID != q2.QuadratID THEN \'Stems of same tree are in different quadrats!\'
        ELSE \'Passed\'
    END AS MeasuredValue,
    \'Stems of the same tree should not be in different quadrats!\' AS ExpectedValueRange,
    CONCAT(\'Tree Tag: \', t.TreeTag, \', Stem Tag 1: \', s1.StemTag, \', Stem 1 Quadrat Name: \', q1.QuadratName,
           \', Stem Tag 2: \', s2.StemTag, \', Stem 2 Quadrat Name: \', q2.QuadratName) AS AdditionalDetails
FROM stems s1
JOIN stems s2 ON s1.TreeID = s2.TreeID AND s1.StemID != s2.StemID
JOIN trees t ON s1.TreeID = t.TreeID
JOIN quadrats q1 ON s1.QuadratID = q1.QuadratID
JOIN quadrats q2 ON s2.QuadratID = q2.QuadratID
JOIN coremeasurements cm1 ON s1.StemID = cm1.StemID
WHERE cm1.IsValidated IS NULL
  AND (@p_CensusID IS NULL OR cm1.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR q1.PlotID = @p_PlotID);
', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (11, 'ValidateScreenMeasuredDiameterMinMax', 'Measured DBH is outside of species-defined bounds', 'measuredDBH', 'INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
SELECT cm.CoreMeasurementID, @validationProcedureID AS ValidationErrorID
      FROM coremeasurements cm
      LEFT JOIN stems st ON cm.StemID = st.StemID
      LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
      LEFT JOIN cmverrors e
  ON e.CoreMeasurementID = cm.CoreMeasurementID
  AND e.ValidationErrorID = @validationProcedureID
      WHERE (
            (@minDBH IS NOT NULL AND cm.MeasuredDBH < @minDBH)
            OR
            (@maxDBH IS NOT NULL AND cm.MeasuredDBH > @maxDBH)
            )
      AND cm.IsValidated IS NULL
      AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
      AND e.CoreMeasurementID IS NULL
ON DUPLICATE KEY UPDATE
    CoreMeasurementID = VALUES(CoreMeasurementID),
    ValidationErrorID = VALUES(ValidationErrorID);', 'INSERT INTO validationchangelog (
    ProcedureName, RunDateTime, TargetRowID, ValidationOutcome,
    ErrorMessage, ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
)
SELECT
    \'ValidateScreenMeasuredDiameterMinMax\' AS ProcedureName,
    NOW() AS RunDateTime,
    cm.CoreMeasurementID AS TargetRowID,
    CASE
        WHEN (@minDBH IS NOT NULL AND cm.MeasuredDBH < @minDBH)
          OR (@maxDBH IS NOT NULL AND cm.MeasuredDBH > @maxDBH) THEN \'Failed\'
        ELSE \'Passed\'
    END AS ValidationOutcome,
    CASE
        WHEN (@minDBH IS NOT NULL AND cm.MeasuredDBH < @minDBH)
          OR (@maxDBH IS NOT NULL AND cm.MeasuredDBH > @maxDBH)
        THEN \'MeasuredDBH is out of range\'
        ELSE NULL
    END AS ErrorMessage,
    \'MeasuredDBH should be within @minDBH and @maxDBH\' AS ValidationCriteria,
    cm.MeasuredDBH AS MeasuredValue,
    \'@minDBH - @maxDBH\' AS ExpectedValueRange,
    CONCAT(\'PlotID: \', q.PlotID, \', CensusID: \', cm.CensusID) AS AdditionalDetails
FROM coremeasurements cm
LEFT JOIN stems st ON cm.StemID = st.StemID
LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
WHERE cm.IsValidated IS NULL
  AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID);', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (12, 'ValidateScreenStemsWithMeasurementsButDeadAttributes', 'Invalid DBH;Invalid HOM;DEAD-state attribute(s)', 'measuredDBH;measuredHOM;attributes', 'INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
SELECT cm.CoreMeasurementID, @validationProcedureID AS ValidationErrorID
FROM coremeasurements cm
         JOIN cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
         JOIN attributes a
              ON cma.Code = a.Code and a.Status in (\'dead\', \'stem dead\', \'missing\', \'broken below\', \'omitted\')
         JOIN stems st ON cm.StemID = st.StemID
         JOIN quadrats q ON st.QuadratID = q.QuadratID
         LEFT JOIN cmverrors e
                   ON e.CoreMeasurementID = cm.CoreMeasurementID
                       AND e.ValidationErrorID = @validationProcedureID
WHERE (
    (cm.MeasuredDBH IS NOT NULL) OR
    (cm.MeasuredHOM IS NOT NULL)
    )
  AND cm.IsValidated IS NULL
  AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
  AND e.CoreMeasurementID IS NULL
ON DUPLICATE KEY UPDATE CoreMeasurementID = VALUES(CoreMeasurementID),
                        ValidationErrorID = VALUES(ValidationErrorID);', 'INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, ValidationOutcome,
                                 ErrorMessage, ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails)
SELECT \'ValidateScreenStemsWithMeasurementsButDeadAttributes\'                   AS ProcedureName,
       NOW()                                                                    AS RunDateTime,
       cm.CoreMeasurementID                                                     AS TargetRowID,
       CASE
           WHEN (
                    (cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR
                    (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0)
                    )
               AND (a.Status IN (\'dead\', \'stem dead\', \'missing\', \'broken below\', \'omitted\')) THEN \'Failed\'
           ELSE \'Passed\'
           END                                                                  AS ValidationOutcome,
       CASE
           WHEN (
                    (cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR
                    (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0)
                    )
               AND (a.Status IN (\'dead\', \'stem dead\', \'missing\', \'broken below\', \'omitted\')) THEN
               \'Stem has measurement info but is labeled \\\'DEAD\\\' OR \\\'MISSING\\\'\'
           ELSE NULL
           END                                                                  AS ErrorMessage,
       \'Dead or missing stems should NOT have measurements\'                     AS ValidationCriteria,
       CASE
           WHEN (
                    (cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR
                    (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0)
                    )
               AND (a.Status IN (\'dead\', \'stem dead\', \'missing\', \'broken below\', \'omitted\'))
               THEN CONCAT(\'Recorded DBH: \', cm.MeasuredDBH, \', Recorded HOM: \', cm.MeasuredHOM)
           ELSE \'Passed\'
           END                                                                  AS MeasuredValue,
       \'Dead or missing stems should have NULL or 0 measurement values\'         AS ExpectedValueRange,
       CONCAT(\'Stem Tag: \', st.StemTag, \', Stem Quadrat Name: \', q.QuadratName) AS AdditionalDetails
FROM coremeasurements cm
         JOIN cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
         JOIN attributes a ON cma.Code = a.Code
         JOIN stems st ON cm.StemID = st.StemID
         JOIN quadrats q ON st.QuadratID = q.QuadratID
         LEFT JOIN cmverrors e
                   ON e.CoreMeasurementID = cm.CoreMeasurementID
                       AND e.ValidationErrorID = @validationProcedureID
WHERE (
    (cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR
    (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0)
    )
  AND (a.Status IN (\'dead\', \'stem dead\', \'missing\', \'broken below\', \'omitted\'))
  AND cm.IsValidated IS NULL
  AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
  AND e.CoreMeasurementID IS NULL
', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (13, 'ValidateScreenStemsWithMissingMeasurementsButLiveAttributes', 'Missing DBH;Missing HOM;LIVE-state attribute(s)', 'measuredDBH;measuredHOM;attributes', 'INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
SELECT
    cm.CoreMeasurementID,
    @validationProcedureID AS ValidationErrorID
FROM coremeasurements cm
LEFT JOIN stems st
    ON cm.StemID = st.StemID
LEFT JOIN quadrats q
    ON st.QuadratID = q.QuadratID
LEFT JOIN cmattributes cma
    ON cm.CoreMeasurementID = cma.CoreMeasurementID
LEFT JOIN attributes a
    ON cma.Code = a.Code
LEFT JOIN cmverrors e
    ON e.CoreMeasurementID = cm.CoreMeasurementID
    AND e.ValidationErrorID = @validationProcedureID
WHERE
    (a.Status NOT IN (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\') OR a.Status IS NULL)
    AND (cm.MeasuredDBH IS NULL OR cm.MeasuredHOM IS NULL)
    AND e.CoreMeasurementID IS NULL
    AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
    AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
    AND cm.IsValidated IS NULL
ON DUPLICATE KEY UPDATE
    CoreMeasurementID = VALUES(CoreMeasurementID),
    ValidationErrorID = VALUES(ValidationErrorID);', 'INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, ValidationOutcome,
                                 ErrorMessage, ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails)
SELECT \'ValidateScreenStemsWithMissingMeasurementsButLiveAttributes\'            AS ProcedureName,
       NOW()                                                                    AS RunDateTime,
       cm.CoreMeasurementID                                                     AS TargetRowID,
       CASE
           WHEN ((a.Status NOT IN (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\') OR a.Status IS NULL)
               AND (cm.MeasuredDBH IS NULL OR cm.MeasuredHOM IS NULL)) THEN \'Failed\'
           ELSE \'Passed\'
           END                                                                  AS ValidationOutcome,
       CASE
           WHEN ((a.Status NOT IN (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\') OR a.Status IS NULL)
               AND (cm.MeasuredDBH IS NULL OR cm.MeasuredHOM IS NULL)) THEN
               \'Live stem has no measurements\'
           ELSE NULL
           END                                                                  AS ErrorMessage,
       \'Live stems should have measurements\'                                    AS ValidationCriteria,
       CASE
           WHEN ((a.Status NOT IN (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\') OR a.Status IS NULL)
               AND (cm.MeasuredDBH IS NULL OR cm.MeasuredHOM IS NULL))
               THEN \'Failed\'
           ELSE \'Passed\'
           END                                                                  AS MeasuredValue,
       \'Live stems should have DBH/HOM values\'                                  AS ExpectedValueRange,
       CONCAT(\'Stem Tag: \', st.StemTag, \', Stem Quadrat Name: \', q.QuadratName) AS AdditionalDetails
FROM coremeasurements cm
         LEFT JOIN stems st
                   ON cm.StemID = st.StemID
         LEFT JOIN quadrats q
                   ON st.QuadratID = q.QuadratID
         LEFT JOIN cmattributes cma
                   ON cm.CoreMeasurementID = cma.CoreMeasurementID
         LEFT JOIN attributes a
                   ON cma.Code = a.Code
         LEFT JOIN cmverrors e
                   ON e.CoreMeasurementID = cm.CoreMeasurementID
                       AND e.ValidationErrorID = @validationProcedureID
WHERE (a.Status NOT IN (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\') OR a.Status IS NULL)
  AND (cm.MeasuredDBH IS NULL OR cm.MeasuredHOM IS NULL)
  AND e.CoreMeasurementID IS NULL
  AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
  AND cm.IsValidated IS NULL', true);


truncate postvalidationqueries; -- clear the table if re-running this script on accident
insert into postvalidationqueries
  (QueryName, QueryDefinition, Description, IsEnabled)
values ('Number of Records by Quadrat',
        'SELECT q.QuadratName, COUNT(DISTINCT cm.CoreMeasurementID) AS MeasurementCount
         FROM ${schema}.quadrats q
         JOIN ${schema}.censusquadrat cq ON q.QuadratID = cq.QuadratID
         JOIN ${schema}.stems st ON st.QuadratID = q.QuadratID
         JOIN ${schema}.coremeasurements cm ON cm.StemID = st.StemID
         WHERE cm.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID}
         GROUP BY q.QuadratName;',
        'Calculating the number of total records, organized by quadrat',
        true),
       ('Number of ALL Stem Records',
        'SELECT COUNT(s.StemID) AS TotalStems
           FROM ${schema}.stems s
           JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID
           JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
           JOIN ${schema}.attributes a ON cma.Code = a.Code
           JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID
           JOIN ${schema}.censusquadrat cq ON cq.QuadratID = q.QuadratID
           WHERE cq.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID};',
        'Calculating the number of total stem records for the current site, plot, and census',
        true),
       ('Number of all LIVE stem records',
        'SELECT COUNT(s.StemID) AS LiveStems
           FROM ${schema}.stems s
           JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID
           JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
           JOIN ${schema}.attributes a ON cma.Code = a.Code
           JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID
           JOIN ${schema}.censusquadrat cq ON cq.QuadratID = q.QuadratID
           WHERE a.Status = ''alive''
           AND cq.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID};',
        'Calculating the number of all live stem records for the current site, plot, and census', true),
       ('Number of all trees',
        'SELECT COUNT(t.TreeID) AS TotalTrees
           FROM ${schema}.trees t
           JOIN ${schema}.stems s ON s.TreeID = t.TreeID
           JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID
           JOIN ${schema}.censusquadrat cq ON cq.QuadratID = q.QuadratID
           WHERE cq.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID};',
        'Calculating the total number of all trees for the current site, plot, and census', true),
       ('All dead or missing stems and count by census',
        'SELECT cm.CensusID,
           COUNT(s.StemID) AS DeadOrMissingStems,
           GROUP_CONCAT(s.StemTag ORDER BY s.StemTag) AS DeadOrMissingStemList
           FROM ${schema}.stems s
           JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID
           JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
           JOIN ${schema}.attributes a ON cma.Code = a.Code
           WHERE a.Status IN (''dead'', ''missing'')
           GROUP BY cm.CensusID;',
        'Finds and returns a count of, then all dead or missing stems by census', true),
       ('All trees outside plot limits',
        'SELECT t.TreeTag, (s.LocalX + q.StartX + p.GlobalX) AS LocalX, (s.LocalY + q.StartY + p.GlobalY) AS LocalY
           FROM ${schema}.trees t
           JOIN ${schema}.stems s ON t.TreeID = s.TreeID
           JOIN ${schema}.quadrats q ON s.QuadratID = q.QuadratID
           JOIN ${schema}.censusquadrat cq ON cq.QuadratID = q.QuadratID
           JOIN ${schema}.plots p ON q.PlotID = p.PlotID
               WHERE s.LocalX IS NULL
                   OR s.LocalY IS NULL
                   OR LocalX > (p.GlobalX + p.DimensionX)
                   OR LocalY > (p.GlobalY + p.DimensionY)
                   AND p.PlotID = ${currentPlotID} AND cq.CensusID = ${currentCensusID};',
        'Finds and returns any trees outside plot limits', true),
       ('Highest DBH measurement and HOM measurement by species',
        'SELECT sp.SpeciesCode, sp.SpeciesName, MAX(cm.MeasuredDBH) AS LargestDBH, MAX(cm.MeasuredHOM) AS LargestHOM
           FROM ${schema}.species sp
               JOIN ${schema}.trees t ON sp.SpeciesID = t.SpeciesID
               JOIN ${schema}.stems s ON s.TreeID = t.TreeID
               JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID
               JOIN ${schema}.quadrats q ON s.QuadratID = q.QuadratID
               JOIN ${schema}.censusquadrat cq ON cq.QuadratID = q.QuadratID
               WHERE cq.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID}
           GROUP BY sp.SpeciesCode, sp.SpeciesName;',
        'Finds and returns the largest DBH/HOM measurement and their host species ID', true),
       ('Checks that all trees from the last census are present',
        'SELECT t.TreeTag, sp.SpeciesCode
            FROM ${schema}.trees t
            JOIN ${schema}.species sp ON t.SpeciesID = sp.SpeciesID
            JOIN ${schema}.stems s_last ON t.TreeID = s_last.TreeID
            JOIN ${schema}.coremeasurements cm_last ON s_last.StemID = cm_last.StemID
            JOIN ${schema}.quadrats q_last ON q.QuadratID = s_last.QuadratID
            JOIN ${schema}.censusquadrat cq_last ON cq.QuadratID = q.QuadratID
            WHERE cm_last.CensusID = ${currentCensusID} - 1
           AND cq.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID}
              AND NOT EXISTS (SELECT 1
                              FROM ${schema}.stems s_current
                                       JOIN
                                   ${schema}.coremeasurements cm_current ON s_current.StemID = cm_current.StemID
                              WHERE t.TreeID = s_current.TreeID
                                AND cm_current.CensusID = ${currentCensusID})
            GROUP BY t.TreeTag, sp.SpeciesCode;',
        'Determining whether all trees accounted for in the last census have new measurements in the "next" measurement',
        true),
       ('Number of new stems, grouped by quadrat, and then by census',
        'SELECT
           q.QuadratName,
           s_current.StemTag,
           t_current.TreeTag,
           s_current.LocalX,
           s_current.LocalY,
               FROM ${schema}.quadrats q
                   JOIN ${schema}.stems s_current ON q.QuadratID = s_current.QuadratID
                   JOIN ${schema}.trees t_current ON s_current.TreeID = t_current.TreeID
                   JOIN ${schema}.coremeasurements cm_current ON s_current.StemID = cm_current.StemID
               WHERE cm_current.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID}
                   AND NOT EXISTS (SELECT 1
                       FROM ${schema}.stems s_last
                           JOIN ${schema}.coremeasurements cm_last ON s_last.StemID = cm_last.StemID
                               WHERE s_current.StemID = s_last.StemID
                               AND cm_last.CensusID = ${currentCensusID} - 1)
           ORDER BY q.QuadratName, s_current.StemTag;',
        'Finds new stems by quadrat for the current census', true),
       ('Determining which quadrats have the most and least number of new stems for the current census',
        'WITH NewStems AS (SELECT s_current.QuadratName,
                               s_current.StemID
                        FROM ${schema}.stems s_current
                                 JOIN
                             ${schema}.coremeasurements cm_current ON s_current.StemID = cm_current.StemID
                        WHERE cm_current.CensusID = ${currentCensusID}
                          AND NOT EXISTS (SELECT 1
                                          FROM ${schema}.stems s_last
                                                   JOIN
                                               ${schema}.coremeasurements cm_last ON s_last.StemID = cm_last.StemID
                                          WHERE s_current.StemID = s_last.StemID
                                            AND cm_last.CensusID = ${currentCensusID} - 1)),
           NewStemCounts AS (SELECT q.QuadratID,
                                    q.QuadratName,
                                    COUNT(ns.StemID) AS NewStemCount
                             FROM ${schema}.quadrats q
                                      LEFT JOIN
                                  NewStems ns ON q.QuadratID = ns.QuadratID
                             GROUP BY q.QuadratID, q.QuadratName),
           LeastNewStems AS (SELECT ''Least New Stems'' AS StemType,
                                    QuadratName,
                                    NewStemCount
                             FROM NewStemCounts
                             ORDER BY NewStemCount, QuadratName
                             LIMIT 1),
           MostNewStems AS (SELECT ''Most New Stems'' AS StemType,
                                   QuadratName,
                                   NewStemCount
                            FROM NewStemCounts
                            ORDER BY NewStemCount DESC, QuadratName DESC
                            LIMIT 1)
           SELECT *
           FROM LeastNewStems
           UNION ALL
           SELECT *
           FROM MostNewStems;',
        'Finds quadrats with most and least new stems. Useful for determining overall growth or changes from census to census',
        true),
       ('Number of dead stems per quadrat',
        'SELECT q.QuadratName,
                 s.StemTag,
                 t.TreeTag,
                 s.LocalX,
                 s.LocalY,
                 a.Code        AS AttributeCode,
                 a.Description AS AttributeDescription,
                 a.Status      AS AttributeStatus
          FROM ${schema}.quadrats q
               JOIN ${schema}.stems s ON q.QuadratID = s.QuadratID
               JOIN ${schema}.trees t ON s.TreeID = t.TreeID
               JOIN ${schema}.coremeasurements cm ON s.StemID = cm.StemID
               JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
               JOIN ${schema}.attributes a ON cma.Code = a.Code
          WHERE cm.CensusID = ${currentCensusID}
            AND q.PlotID = ${currentPlotID}
            AND a.Status = ''dead''
          ORDER BY q.QuadratName;',
        'dead stems by quadrat. also useful for tracking overall changes across plot', true),
       ('Number of dead stems by species',
        'SELECT sp.SpeciesName,
                 sp.SpeciesCode,
                 s.StemTag,
                 t.TreeTag,
                 q.QuadratName,
                 s.LocalX,
                 s.LocalY,
                 a.Code        AS AttributeCode,
                 a.Description AS AttributeDescription,
                 a.Status      AS AttributeStatus
          FROM ${schema}.stems s
                   JOIN
               ${schema}.coremeasurements cm ON s.StemID = cm.StemID
                   JOIN
               ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
                   JOIN
               ${schema}.attributes a ON cma.Code = a.Code
                   JOIN
               ${schema}.trees t ON s.TreeID = t.TreeID
                   JOIN
               ${schema}.species sp ON t.SpeciesID = sp.SpeciesID
               JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID
          WHERE cm.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID}
            AND a.Status = ''dead''
          ORDER BY sp.SpeciesName, s.StemID;',
        'dead stems by species, organized to determine which species (if any) are struggling', true);

set foreign_key_checks = 1;