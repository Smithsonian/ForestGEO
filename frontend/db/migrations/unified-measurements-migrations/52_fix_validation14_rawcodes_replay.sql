-- =====================================================================================
-- Migration Script 52: Fix ValidationID 14 replay to validate RawCodes
-- =====================================================================================
-- Purpose:
--   - Rewrite ValidationID 14 so rerun validations re-parse coremeasurements.RawCodes
--   - Prevent the validation runner from clearing upload-time invalid-code errors and
--     failing to recreate them because invalid codes are intentionally excluded from
--     cmattributes during Stage 9 attribute materialization
-- =====================================================================================

INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled)
VALUES (14, 'ValidateFindInvalidAttributeCodes',
        'Attribute code does not exist in attributes table',
        'attributes',
        'insert into measurement_error_log (MeasurementID, ErrorID)
select distinct cm.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1) as ErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         , json_table(
             IF(cm.RawCodes IS NULL OR cm.RawCodes = '''' OR TRIM(cm.RawCodes) = '''', ''[]'',
                CONCAT(''["'', REPLACE(TRIM(cm.RawCodes), '';'', ''","''), ''"]'')),
             ''$[*]'' columns (code varchar(10) COLLATE utf8mb4_0900_ai_ci path ''$'')
         ) jt
         left join attributes a on a.Code = TRIM(jt.code) and a.IsActive is true
         left join measurement_error_log e on e.MeasurementID = cm.CoreMeasurementID
              and e.ErrorID = (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
where cm.IsValidated is null
  and cm.IsActive is true
  and cm.RawCodes is not null
  and TRIM(cm.RawCodes) != ''''
  and TRIM(jt.code) != ''''
  and a.Code is null
  and e.MeasurementID is null
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID)
on duplicate key update IsResolved = FALSE, ResolvedAt = NULL;',
        '',
        true)
ON DUPLICATE KEY UPDATE
    ProcedureName = VALUES(ProcedureName),
    Description = VALUES(Description),
    Criteria = VALUES(Criteria),
    Definition = VALUES(Definition),
    ChangelogDefinition = VALUES(ChangelogDefinition),
    IsEnabled = VALUES(IsEnabled);

SELECT 'Migration 52 complete: ValidationID 14 now replays from coremeasurements.RawCodes.' AS Status;
