-- Prepared rollback seed patch.  This deliberately touches only DBH rule rows;
-- it does not truncate or reset unrelated site-specific validation configuration.
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled)
VALUES (1, 'ValidateDBHGrowthExceedsMax', 'DBH growth exceeds 65 mm against the prior census', 'measuredDBH',
        'CALL RunSharedDBHChangeValidations(@p_CensusID, @p_PlotID, 1, 0);', '', TRUE)
ON DUPLICATE KEY UPDATE
    ProcedureName = VALUES(ProcedureName), Description = VALUES(Description), Criteria = VALUES(Criteria),
    Definition = VALUES(Definition), ChangelogDefinition = VALUES(ChangelogDefinition);

INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled)
VALUES (2, 'ValidateDBHShrinkageExceedsMax', 'DBH shrinkage exceeds 5 percent against the prior census', 'measuredDBH',
        'CALL RunSharedDBHChangeValidations(@p_CensusID, @p_PlotID, 0, 1);', '', TRUE)
ON DUPLICATE KEY UPDATE
    ProcedureName = VALUES(ProcedureName), Description = VALUES(Description), Criteria = VALUES(Criteria),
    Definition = VALUES(Definition), ChangelogDefinition = VALUES(ChangelogDefinition);
