-- =====================================================================================
-- Migration 2026-09-13-01: annual DBH rule text for validations 1 and 2
-- =====================================================================================
-- Existing schemas carry the rule text from whichever corequeries.sql seeded them.
-- Deployments no longer replay corequeries.sql (it truncates every site's validation
-- configuration), so this migration is how existing schemas receive the annual DBH
-- rule Description and Definition. Only those two fields change: IsEnabled, Criteria,
-- and every other rule are site-owned and preserved. Newly provisioned schemas get the
-- same text from corequeries.sql directly; an integration test keeps the two identical.
--
-- A site-authored rule occupying ValidationID 1 or 2, or a DBH procedure name under a
-- different ID, must stop the deployment rather than be overwritten. SIGNAL is not
-- allowed in a prepared statement, so the conflict branch calls a temporary helper
-- procedure (dropped immediately afterwards, and by the runner's failure cleanup).
DROP PROCEDURE IF EXISTS mig_2026_09_13_01_raise_dbh_rule_conflict;
CREATE PROCEDURE mig_2026_09_13_01_raise_dbh_rule_conflict(IN conflict_message VARCHAR(120))
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = conflict_message;
END;

SET @dbh_identity_conflicts := (
  SELECT COUNT(*) FROM sitespecificvalidations
   WHERE (ValidationID = 1 AND ProcedureName <> 'ValidateDBHGrowthExceedsMax')
      OR (ValidationID = 2 AND ProcedureName <> 'ValidateDBHShrinkageExceedsMax')
      OR (ProcedureName = 'ValidateDBHGrowthExceedsMax' AND ValidationID <> 1)
      OR (ProcedureName = 'ValidateDBHShrinkageExceedsMax' AND ValidationID <> 2)
);
SET @msg := LEFT(CONCAT('DBH rule identity conflict in schema ', DATABASE(),
                        ': ValidationID 1/2 or a DBH procedure name is held by a different rule.'), 120);
SET @sql := IF(@dbh_identity_conflicts > 0, CONCAT('CALL mig_2026_09_13_01_raise_dbh_rule_conflict(', QUOTE(@msg), ')'), 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

DROP PROCEDURE IF EXISTS mig_2026_09_13_01_raise_dbh_rule_conflict;

UPDATE sitespecificvalidations
   SET Description = 'DBH growth exceeds 65 mm per year against the prior census, or 65 mm in total when under a year apart or undated (both DBH >= 10 mm, HOM unchanged)',
       Definition = 'CALL RunSharedDBHChangeValidations(@p_CensusID, @p_PlotID, 1, 0);'
 WHERE ValidationID = 1
   AND ProcedureName = 'ValidateDBHGrowthExceedsMax';

UPDATE sitespecificvalidations
   SET Description = 'DBH shrinkage is at least 5 percent per year against the prior census, or over 5 percent in total when under a year apart or undated (both DBH >= 10 mm, HOM unchanged)',
       Definition = 'CALL RunSharedDBHChangeValidations(@p_CensusID, @p_PlotID, 0, 1);'
 WHERE ValidationID = 2
   AND ProcedureName = 'ValidateDBHShrinkageExceedsMax';

SELECT 'Migration 2026-09-13-01 complete: annual DBH rule text applied to validations 1 and 2.' AS Status;
