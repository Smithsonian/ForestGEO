set foreign_key_checks = 0;

truncate sitespecificvalidations;

INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (1, 'ValidateDBHGrowthExceedsMax', 'DBH growth exceeds maximum rate of 65 mm', 'measuredDBH', 'insert ignore into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm_present.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm_present
         join coremeasurements cm_past on cm_present.StemID = cm_past.StemID and cm_present.CensusID <> cm_past.CensusID
         join census c_present on cm_present.CensusID = c_present.CensusID
         join census c_past on cm_past.CensusID = cm_past.CensusID
         join plots p ON c_present.PlotID = p.PlotID and c_past.PlotID = p.PlotID
         join cmattributes cma_present on cma_present.CoreMeasurementID = cm_present.CoreMeasurementID
         join cmattributes cma_past on cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
         join attributes a_present on a_present.Code = cma_present.Code
         join attributes a_past on a_past.Code = cma_past.Code
         left join cmverrors e
                   on e.CoreMeasurementID = cm_present.CoreMeasurementID
                       and e.ValidationErrorID = @validationProcedureID
where c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1
  and a_present.Status not in (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\')
  and a_past.Status not in (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\')
  and (cm_present.IsValidated is null and cm_past.IsValidated is true)
  and (@p_CensusID IS NULL OR cm_present.CensusID = @p_CensusID)
  and (@p_PlotID IS NULL OR c_present.PlotID = @p_PlotID)
  and e.CoreMeasurementID is null
  and (cm_present.MeasuredDBH - cm_past.MeasuredDBH) * (case p.DefaultDBHUnits
                                                            when \'km\' THEN 1000000
                                                            when \'hm\' THEN 100000
                                                            when \'dam\' THEN 10000
                                                            when \'m\' THEN 1000
                                                            when \'dm\' THEN 100
                                                            when \'cm\' THEN 10
                                                            when \'mm\' THEN 1
                                                            else 1 end) > 65;', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (2, 'ValidateDBHShrinkageExceedsMax', 'DBH shrinkage exceeds maximum rate of 5 percent', 'measuredDBH', 'insert ignore into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm_present.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm_present
         join coremeasurements cm_past on cm_present.StemID = cm_past.StemID and cm_present.CensusID <> cm_past.CensusID
         join census c_present on cm_present.CensusID = c_present.CensusID
         join census c_past on cm_past.CensusID = c_past.CensusID
         join plots p ON c_present.PlotID = p.PlotID and c_past.PlotID = p.PlotID
         join cmattributes cma_present on cma_present.CoreMeasurementID = cm_present.CoreMeasurementID
         join cmattributes cma_past on cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
         join attributes a_present on a_present.Code = cma_present.Code
         join attributes a_past on a_past.Code = cma_past.Code
         left join cmverrors e
                   on e.CoreMeasurementID = cm_present.CoreMeasurementID
                       and e.ValidationErrorID = @validationProcedureID
where c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1
  and a_present.Status not in (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\')
  and a_past.Status not in (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\')
  and (cm_present.IsValidated is null and cm_past.IsValidated is true)
  and (@p_CensusID IS NULL OR cm_present.CensusID = @p_CensusID)
  and (@p_PlotID IS NULL OR c_present.PlotID = @p_PlotID)
  and e.CoreMeasurementID is null
  and (cm_present.MeasuredDBH < cm_past.MeasuredDBH * 0.95);', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (3, 'ValidateFindAllInvalidSpeciesCodes', 'Species Code is invalid (not defined in species table)', 'speciesCode', 'insert ignore into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         left join stems s on cm.StemID = s.StemID
         left join trees t on s.TreeID = t.TreeID
         left join species sp on t.SpeciesID = sp.SpeciesID
         join census c on cm.CensusID = c.CensusID
         left join cmverrors e
                   on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null
  and (@p_CensusID is null or c.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID)
  and e.CoreMeasurementID is null
  and (sp.SpeciesID is null or t.TreeID is null or s.StemID is null);', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (4, 'ValidateFindDuplicatedQuadratsByName', 'Quadrat\'s name matches existing OTHER quadrat (QuadratIDs are different but QuadratNames are the same)', 'quadratName', 'insert ignore into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID
         join stems s on cm.StemID = s.StemID
         join quadrats q on s.QuadratID = q.QuadratID
         join (select QuadratName from quadrats group by QuadratName having count(distinct QuadratID) > 1) as ambigious
              on q.QuadratName = ambigious.QuadratName
         left join cmverrors e
                   on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null
  and (@p_CensusID is null or c.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID)
  and e.CoreMeasurementID is null;', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (5, 'ValidateFindDuplicateStemTreeTagCombinationsPerCensus', 'Duplicate tree (and stem) tag found in census;Duplicate stem (and tree) tag found in census', 'stemTag;treeTag', 'insert ignore into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID
         left join cmverrors e
                   on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
         join (select StemID, CensusID, count(*) AS MeasurementCount
               from coremeasurements
               group by StemID, CensusID
               having COUNT(*) > 1) dup on cm.StemID = dup.StemID and cm.CensusID = dup.CensusID
where cm.IsValidated is null
  and e.CoreMeasurementID is null
  and (@p_CensusID is null or c.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (6, 'ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat', 'Outside census date bounds', 'measurementDate', 'insert ignore into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID
         left join cmverrors e
                   on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null
  and e.CoreMeasurementID is null
  and (cm.MeasurementDate < c.StartDate or cm.MeasurementDate > c.EndDate)
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (7, 'ValidateFindStemsInTreeWithDifferentSpecies', 'Flagged;Different species', 'stemTag;speciesCode', 'insert ignore into cmverrors (CoreMeasurementID, ValidationErrorID)
select min(cm.CoreMeasurementID), @validationProcedureID as ValidationErrorID
from coremeasurements cm
join census c on cm.CensusID = c.CensusID
join stems s on cm.StemID = s.StemID
join trees t on s.TreeID = t.TreeID
join species sp on t.SpeciesID = sp.SpeciesID
left join cmverrors e on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null or e.CoreMeasurementID is null
and (@p_CensusID is null or cm.CensusID = @p_CensusID)
and (@p_PlotID is null or c.PlotID = @p_PlotID)
group by t.TreeTag
having count(distinct sp.SpeciesCode) > 1;', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (8, 'ValidateFindStemsOutsidePlots', 'Flagged;X outside plot OR;Y outside plot', 'stemTag;stemLocalX;stemLocalY', 'insert ignore into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
join census c on cm.CensusID = c.CensusID
join censusquadrat cq on c.CensusID = cq.CensusID
join quadrats q on cq.QuadratID = q.QuadratID
join stems s on cm.StemID = s.StemID
join plots p on c.PlotID = p.PlotID
left join cmverrors e on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null and e.CoreMeasurementID is null
and ((s.LocalX + q.StartX + p.GlobalX) > (p.GlobalX + p.DimensionX)) or ((s.LocalY + q.StartY + p.GlobalY) > (p.GlobalY + p.DimensionY))
and (@p_CensusID is null or cm.CensusID = @p_CensusID)
and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (9, 'ValidateFindTreeStemsInDifferentQuadrats', 'Flagged;Flagged;Different quadrats', 'stemTag;treeTag;quadratName', 'insert ignore into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID
         join stems s1 on cm.StemID = s1.StemID
         join trees t on s1.TreeID = t.TreeID
         join stems s2 on t.TreeID = s2.TreeID and s1.StemID <> s2.StemID
         left join cmverrors e
                   on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null
  and e.CoreMeasurementID is null
  and s1.QuadratID <> s2.QuadratID
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (11, 'ValidateScreenMeasuredDiameterMinMax', 'Measured DBH is outside of species-defined bounds', 'measuredDBH', 'insert ignore into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join stems s on cm.StemID = s.StemID
         join census c on cm.CensusID = c.CensusID
         left join cmverrors e
                   on cm.CoreMeasurementID = e.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null
  and e.CoreMeasurementID is null
  and ((@minDBH is not null and cm.MeasuredDBH < @minDBH)
    or (@maxDBH is not null and cm.MeasuredDBH > @maxDBH))
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (12, 'ValidateScreenStemsWithMeasurementsButDeadAttributes', 'Invalid DBH;Invalid HOM;DEAD-state attribute(s)', 'measuredDBH;measuredHOM;attributes', 'insert ignore into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID
         join cmattributes cma on cm.CoreMeasurementID = cma.CoreMeasurementID
         join attributes a
              on cma.Code = a.Code and a.Status in (\'dead\', \'stem dead\', \'missing\', \'broken below\', \'omitted\')
         left join cmverrors e
                   on cm.CoreMeasurementID = e.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null
  and e.CoreMeasurementID is null
  and ((cm.MeasuredDBH is not null and cm.MeasuredDBH <> 0)
    or (cm.MeasuredHOM is not null and cm.MeasuredHOM <> 0))
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);
', '', false);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled) VALUES (13, 'ValidateScreenStemsWithMissingMeasurementsButLiveAttributes', 'Missing DBH;Missing HOM;LIVE-state attribute(s)', 'measuredDBH;measuredHOM;attributes', 'insert ignore into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID
         join cmattributes cma on cm.CoreMeasurementID = cma.CoreMeasurementID
         join attributes a
              on cma.Code = a.Code and a.Status not in (\'dead\', \'stem dead\', \'missing\', \'broken below\', \'omitted\')
         left join cmverrors e
                   on cm.CoreMeasurementID = e.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null
  and e.CoreMeasurementID is null
  and ((cm.MeasuredDBH is null or cm.MeasuredDBH = 0)
    or (cm.MeasuredHOM is null or cm.MeasuredHOM = 0))
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', false);

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