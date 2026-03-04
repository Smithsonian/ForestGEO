-- =====================================================================================
-- Migration Script 21: Retarget site validations to measurement_error_log
-- =====================================================================================
-- Purpose:
--   - Rewrite validation definitions from cmverrors -> measurement_error_log
--   - Apply cross-census fixes for validations 1 and 2 (TreeTag/StemTag-based joins)
--   - Add validation IDs 17 and 18 for quadrat mismatch and coordinate drift checks
-- =====================================================================================

SET @schema = DATABASE();

SELECT COUNT(*) INTO @has_validations
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'sitespecificvalidations';

SET @sql = IF(
    @has_validations = 1,
    'UPDATE sitespecificvalidations
     SET Definition = REPLACE(
         REPLACE(
             REPLACE(
                 REPLACE(
                     REPLACE(
                         REPLACE(COALESCE(Definition, ''''),
                                 ''INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)'',
                                 ''INSERT INTO measurement_error_log (MeasurementID, ErrorID)''),
                         ''insert into cmverrors (CoreMeasurementID, ValidationErrorID)'',
                         ''insert into measurement_error_log (MeasurementID, ErrorID)''),
                     ''LEFT JOIN cmverrors e'',
                     ''LEFT JOIN measurement_error_log e''),
                 ''left join cmverrors e'',
                 ''left join measurement_error_log e''),
             ''e.CoreMeasurementID'', ''e.MeasurementID''),
         ''e.ValidationErrorID'', ''e.ErrorID''),
         ChangelogDefinition = REPLACE(
             REPLACE(
                 REPLACE(
                     REPLACE(
                         REPLACE(
                             REPLACE(COALESCE(ChangelogDefinition, ''''),
                                     ''INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)'',
                                     ''INSERT INTO measurement_error_log (MeasurementID, ErrorID)''),
                             ''insert into cmverrors (CoreMeasurementID, ValidationErrorID)'',
                             ''insert into measurement_error_log (MeasurementID, ErrorID)''),
                         ''LEFT JOIN cmverrors e'',
                         ''LEFT JOIN measurement_error_log e''),
                     ''left join cmverrors e'',
                     ''left join measurement_error_log e''),
                 ''e.CoreMeasurementID'', ''e.MeasurementID''),
             ''e.ValidationErrorID'', ''e.ErrorID'')',
    'SELECT ''sitespecificvalidations not found; skipped validation-definition rewrite'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    @has_validations = 1,
    'UPDATE sitespecificvalidations
     SET Definition = ''INSERT INTO measurement_error_log (MeasurementID, ErrorID)
SELECT DISTINCT cm_present.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''''validation'''' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1) AS ErrorID
FROM coremeasurements cm_present
JOIN census c_present ON cm_present.CensusID = c_present.CensusID AND c_present.IsActive = 1
JOIN stems s_present ON s_present.StemGUID = cm_present.StemGUID AND s_present.CensusID = cm_present.CensusID AND s_present.IsActive = 1
JOIN trees t_present ON t_present.TreeID = s_present.TreeID AND t_present.CensusID = s_present.CensusID AND t_present.IsActive = 1
JOIN coremeasurements cm_past ON cm_past.CensusID <> cm_present.CensusID AND cm_past.IsActive = 1
JOIN census c_past ON c_past.CensusID = cm_past.CensusID AND c_past.IsActive = 1
JOIN stems s_past ON s_past.StemGUID = cm_past.StemGUID AND s_past.CensusID = cm_past.CensusID AND s_past.IsActive = 1
JOIN trees t_past ON t_past.TreeID = s_past.TreeID AND t_past.CensusID = s_past.CensusID AND t_past.IsActive = 1
JOIN plots p ON c_present.PlotID = p.PlotID AND c_past.PlotID = p.PlotID
JOIN cmattributes cma_present ON cma_present.CoreMeasurementID = cm_present.CoreMeasurementID
JOIN attributes a_present ON a_present.Code = cma_present.Code
JOIN cmattributes cma_past ON cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
JOIN attributes a_past ON a_past.Code = cma_past.Code
LEFT JOIN measurement_error_log e ON e.MeasurementID = cm_present.CoreMeasurementID
    AND e.ErrorID = (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''''validation'''' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
WHERE c_past.PlotCensusNumber >= 1
  AND c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1
  AND t_past.TreeTag = t_present.TreeTag
  AND s_past.StemTag = s_present.StemTag
  AND cm_present.IsActive = 1
  AND a_present.Status NOT IN (''''dead'''', ''''stem dead'''', ''''broken below'''', ''''missing'''', ''''omitted'''')
  AND a_past.Status NOT IN (''''dead'''', ''''stem dead'''', ''''broken below'''', ''''missing'''', ''''omitted'''')
  AND cm_present.IsValidated IS NULL
  AND cm_past.IsValidated = 1
  AND (@p_CensusID IS NULL OR cm_present.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR c_present.PlotID = @p_PlotID)
  AND e.MeasurementID IS NULL
  AND cm_past.MeasuredDBH > 0
  AND (cm_present.MeasuredDBH - cm_past.MeasuredDBH) *
      (CASE p.DefaultDBHUnits
           WHEN ''''km'''' THEN 1000000
           WHEN ''''hm'''' THEN 100000
           WHEN ''''dam'''' THEN 10000
           WHEN ''''m'''' THEN 1000
           WHEN ''''dm'''' THEN 100
           WHEN ''''cm'''' THEN 10
           WHEN ''''mm'''' THEN 1
           ELSE 1 END) > 65
ON DUPLICATE KEY UPDATE IsResolved = FALSE, ResolvedAt = NULL;''
     WHERE ValidationID = 1',
    'SELECT ''sitespecificvalidations not found; skipped ValidationID 1 rewrite'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    @has_validations = 1,
    'UPDATE sitespecificvalidations
     SET Definition = ''INSERT INTO measurement_error_log (MeasurementID, ErrorID)
SELECT DISTINCT cm_present.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''''validation'''' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1) AS ErrorID
FROM coremeasurements cm_present
JOIN census c_present ON cm_present.CensusID = c_present.CensusID AND c_present.IsActive = 1
JOIN stems s_present ON s_present.StemGUID = cm_present.StemGUID AND s_present.CensusID = cm_present.CensusID AND s_present.IsActive = 1
JOIN trees t_present ON t_present.TreeID = s_present.TreeID AND t_present.CensusID = s_present.CensusID AND t_present.IsActive = 1
JOIN coremeasurements cm_past ON cm_past.CensusID <> cm_present.CensusID AND cm_past.IsActive = 1
JOIN census c_past ON c_past.CensusID = cm_past.CensusID AND c_past.IsActive = 1
JOIN stems s_past ON s_past.StemGUID = cm_past.StemGUID AND s_past.CensusID = cm_past.CensusID AND s_past.IsActive = 1
JOIN trees t_past ON t_past.TreeID = s_past.TreeID AND t_past.CensusID = s_past.CensusID AND t_past.IsActive = 1
JOIN cmattributes cma_present ON cma_present.CoreMeasurementID = cm_present.CoreMeasurementID
JOIN attributes a_present ON a_present.Code = cma_present.Code
JOIN cmattributes cma_past ON cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
JOIN attributes a_past ON a_past.Code = cma_past.Code
LEFT JOIN measurement_error_log e ON e.MeasurementID = cm_present.CoreMeasurementID
    AND e.ErrorID = (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''''validation'''' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
WHERE c_past.PlotCensusNumber >= 1
  AND c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1
  AND t_past.TreeTag = t_present.TreeTag
  AND s_past.StemTag = s_present.StemTag
  AND cm_present.IsActive = 1
  AND a_present.Status NOT IN (''''dead'''', ''''stem dead'''', ''''broken below'''', ''''missing'''', ''''omitted'''')
  AND a_past.Status NOT IN (''''dead'''', ''''stem dead'''', ''''broken below'''', ''''missing'''', ''''omitted'''')
  AND cm_present.IsValidated IS NULL
  AND cm_past.IsValidated = 1
  AND (@p_CensusID IS NULL OR cm_present.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR c_present.PlotID = @p_PlotID)
  AND e.MeasurementID IS NULL
  AND cm_past.MeasuredDBH > 0
  AND cm_present.MeasuredDBH < (cm_past.MeasuredDBH * 0.95)
ON DUPLICATE KEY UPDATE IsResolved = FALSE, ResolvedAt = NULL;''
     WHERE ValidationID = 2',
    'SELECT ''sitespecificvalidations not found; skipped ValidationID 2 rewrite'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    @has_validations = 1,
    'INSERT INTO sitespecificvalidations
        (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled)
     VALUES
        (17,
         ''ValidateQuadratMismatchAcrossCensuses'',
         ''Quadrat mismatch with previous census for same TreeTag/StemTag'',
         ''quadratName;treeTag;stemTag'',
         ''INSERT INTO measurement_error_log (MeasurementID, ErrorID)
SELECT DISTINCT cm.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''''validation'''' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
FROM coremeasurements cm
JOIN census c ON c.CensusID = cm.CensusID AND c.IsActive = 1
JOIN stems s ON s.StemGUID = cm.StemGUID AND s.CensusID = cm.CensusID AND s.IsActive = 1
JOIN trees t ON t.TreeID = s.TreeID AND t.CensusID = s.CensusID AND t.IsActive = 1
JOIN quadrats q_cur ON q_cur.QuadratID = s.QuadratID AND q_cur.IsActive = 1
JOIN census c_prev ON c_prev.PlotID = c.PlotID AND c_prev.PlotCensusNumber = c.PlotCensusNumber - 1 AND c_prev.IsActive = 1
JOIN trees t_prev ON t_prev.TreeTag = t.TreeTag AND t_prev.CensusID = c_prev.CensusID AND t_prev.IsActive = 1
JOIN stems s_prev ON s_prev.TreeID = t_prev.TreeID AND s_prev.StemTag = s.StemTag AND s_prev.CensusID = c_prev.CensusID AND s_prev.IsActive = 1
JOIN quadrats q_prev ON q_prev.QuadratID = s_prev.QuadratID AND q_prev.IsActive = 1
LEFT JOIN measurement_error_log e ON e.MeasurementID = cm.CoreMeasurementID AND e.ErrorID = (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''''validation'''' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
WHERE cm.IsActive = 1
  AND cm.StemGUID IS NOT NULL
  AND q_prev.QuadratName <> q_cur.QuadratName
  AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR c.PlotID = @p_PlotID)
  AND e.MeasurementID IS NULL
ON DUPLICATE KEY UPDATE IsResolved = FALSE, ResolvedAt = NULL;'',
         '''',
         1),
        (18,
         ''ValidateCoordinateDriftAcrossCensuses'',
         ''Coordinate drift exceeds 10m versus previous census for same TreeTag/StemTag'',
         ''stemLocalX;stemLocalY;treeTag;stemTag'',
         ''INSERT INTO measurement_error_log (MeasurementID, ErrorID)
SELECT DISTINCT cm.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''''validation'''' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
FROM coremeasurements cm
JOIN census c ON c.CensusID = cm.CensusID AND c.IsActive = 1
JOIN stems s ON s.StemGUID = cm.StemGUID AND s.CensusID = cm.CensusID AND s.IsActive = 1
JOIN trees t ON t.TreeID = s.TreeID AND t.CensusID = s.CensusID AND t.IsActive = 1
JOIN census c_prev ON c_prev.PlotID = c.PlotID AND c_prev.PlotCensusNumber = c.PlotCensusNumber - 1 AND c_prev.IsActive = 1
JOIN trees t_prev ON t_prev.TreeTag = t.TreeTag AND t_prev.CensusID = c_prev.CensusID AND t_prev.IsActive = 1
JOIN stems s_prev ON s_prev.TreeID = t_prev.TreeID AND s_prev.StemTag = s.StemTag AND s_prev.CensusID = c_prev.CensusID AND s_prev.IsActive = 1
LEFT JOIN measurement_error_log e ON e.MeasurementID = cm.CoreMeasurementID AND e.ErrorID = (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''''validation'''' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
WHERE cm.IsActive = 1
  AND cm.StemGUID IS NOT NULL
  AND s.LocalX IS NOT NULL AND s.LocalY IS NOT NULL
  AND s_prev.LocalX IS NOT NULL AND s_prev.LocalY IS NOT NULL
  AND SQRT(POW(s.LocalX - s_prev.LocalX, 2) + POW(s.LocalY - s_prev.LocalY, 2)) > 10
  AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR c.PlotID = @p_PlotID)
  AND e.MeasurementID IS NULL
ON DUPLICATE KEY UPDATE IsResolved = FALSE, ResolvedAt = NULL;'',
         '''',
         1)
     ON DUPLICATE KEY UPDATE
       ProcedureName = VALUES(ProcedureName),
       Description = VALUES(Description),
       Criteria = VALUES(Criteria),
       Definition = VALUES(Definition),
       ChangelogDefinition = VALUES(ChangelogDefinition),
       IsEnabled = VALUES(IsEnabled)',
    'SELECT ''sitespecificvalidations not found; skipped ValidationID 17/18 upsert'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
VALUES ('validation', '17', 'Quadrat mismatch with previous census for the same TreeTag/StemTag'),
       ('validation', '18', 'Coordinate drift exceeds 10m versus previous census for the same TreeTag/StemTag')
ON DUPLICATE KEY UPDATE ErrorMessage = VALUES(ErrorMessage);

SELECT 'Migration 21 complete: validation definitions target measurement_error_log.' AS Status;
