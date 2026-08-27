-- =====================================================================================
-- Migration 2026-08-27-02: seed validation 19 (ValidatePlotCoordinateConsistency)
-- =====================================================================================
-- sitespecificvalidations.ValidationID is AUTO_INCREMENT for admin-created rules, so the
-- repository defaults ending at 18 do NOT prove 19 is free on every site. A collision must
-- stop the deployment with an actionable message rather than be concealed by INSERT IGNORE.
--
-- MySQL rejects SIGNAL inside a prepared statement ("This command is not supported in
-- the prepared statement protocol yet"), and whether a conflict exists can only be
-- decided at runtime by scanning the table, which outside a stored program requires
-- dynamic SQL. So the conflict branch below routes through CALL to this temporary
-- helper procedure, which performs the SIGNAL natively; it is dropped again immediately
-- after the preflight. SIGNAL MESSAGE_TEXT is capped at 128 characters by MySQL itself
-- (a longer value fails with its own unrelated "Data too long" error instead of the
-- intended message), so the composed message is defensively trimmed to 120.
DROP PROCEDURE IF EXISTS mig_2026_08_27_02_raise_validation_conflict;
CREATE PROCEDURE mig_2026_08_27_02_raise_validation_conflict(IN conflict_message VARCHAR(120))
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = conflict_message;
END;

SET @id_conflict := (SELECT COUNT(*) FROM sitespecificvalidations
                     WHERE ValidationID = 19 AND ProcedureName <> 'ValidatePlotCoordinateConsistency');
SET @name_conflict := (SELECT COUNT(*) FROM sitespecificvalidations
                       WHERE ProcedureName = 'ValidatePlotCoordinateConsistency' AND ValidationID <> 19);
SET @enabled_without_helper := (
  SELECT COUNT(*) FROM sitespecificvalidations
   WHERE ValidationID = 19
     AND ProcedureName = 'ValidatePlotCoordinateConsistency'
     AND IsEnabled = TRUE
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = DATABASE()
          AND ROUTINE_TYPE = 'PROCEDURE'
          AND ROUTINE_NAME = 'RunPlotCoordinateConsistencyValidation'
     )
);
SET @msg := LEFT(CASE
  WHEN @id_conflict > 0 OR @name_conflict > 0 THEN
    CONCAT('Validation identity conflict in schema ', DATABASE(),
           ': ValidationID 19 or ValidatePlotCoordinateConsistency is held by a different rule.')
  ELSE
    CONCAT('Validation 19 is enabled in schema ', DATABASE(),
           ' but RunPlotCoordinateConsistencyValidation is missing; disable it before migration.')
END, 120);
SET @sql := CASE
  WHEN @id_conflict > 0 OR @name_conflict > 0 OR @enabled_without_helper > 0 THEN
    CONCAT('CALL mig_2026_08_27_02_raise_validation_conflict(', QUOTE(@msg), ')')
  ELSE
    'DO 0'
END;
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

DROP PROCEDURE IF EXISTS mig_2026_08_27_02_raise_validation_conflict;

-- IsEnabled = FALSE is deliberate: at migration time RunPlotCoordinateConsistencyValidation
-- may not exist yet on this schema. A later activation step turns it on only after
-- verifying the helper procedure and this error row are both present.
INSERT INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
SELECT 'validation', '19', 'Validation ValidatePlotCoordinateConsistency'
WHERE NOT EXISTS (
  SELECT 1 FROM measurement_errors WHERE ErrorSource = 'validation' AND ErrorCode = '19'
);

UPDATE measurement_errors
   SET ErrorMessage = 'Validation ValidatePlotCoordinateConsistency'
 WHERE ErrorSource = 'validation' AND ErrorCode = '19';

INSERT INTO sitespecificvalidations
  (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled)
SELECT 19,
       'ValidatePlotCoordinateConsistency',
       'Plot coordinate disagrees with the quadrat''s own median offset',
       'stemPlotX;stemPlotY;stemLocalX;stemLocalY;quadratName;treeTag;stemTag',
       'CALL RunPlotCoordinateConsistencyValidation(@p_CensusID, @p_PlotID);',
       '',
       FALSE
WHERE NOT EXISTS (SELECT 1 FROM sitespecificvalidations WHERE ValidationID = 19);

-- An exact pre-existing identity may be a partial/manual seed. Repair every
-- repository-owned field while deliberately preserving IsEnabled. The preflight
-- above rejects the unsafe enabled-without-helper state.
UPDATE sitespecificvalidations
   SET Description = 'Plot coordinate disagrees with the quadrat''s own median offset',
       Criteria = 'stemPlotX;stemPlotY;stemLocalX;stemLocalY;quadratName;treeTag;stemTag',
       Definition = 'CALL RunPlotCoordinateConsistencyValidation(@p_CensusID, @p_PlotID);',
       ChangelogDefinition = ''
 WHERE ValidationID = 19
   AND ProcedureName = 'ValidatePlotCoordinateConsistency';

SELECT 'Migration 2026-08-27-02 complete: validation 19 (ValidatePlotCoordinateConsistency) seeded disabled.' AS Status;
