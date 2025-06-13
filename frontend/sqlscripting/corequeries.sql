set foreign_key_checks = 0;

truncate sitespecificvalidations;

INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                     ChangelogDefinition, IsEnabled)
VALUES (1, 'ValidateDBHGrowthExceedsMax', 'DBH growth exceeds maximum rate of 65 mm', 'measuredDBH', '
insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm_present.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm_present
         join coremeasurements cm_past
              on cm_present.StemID = cm_past.StemID and cm_present.CensusID <> cm_past.CensusID and
                 cm_past.IsActive IS TRUE
         join census c_present on cm_present.CensusID = c_present.CensusID and c_present.IsActive is true
         join census c_past on cm_past.CensusID = c_past.CensusID and c_past.IsActive is true
         join plots p ON c_present.PlotID = p.PlotID and c_past.PlotID = p.PlotID
         join cmattributes cma_present on cma_present.CoreMeasurementID = cm_present.CoreMeasurementID
         join attributes a_present on a_present.Code = cma_present.Code
         join cmattributes cma_past on cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
         join attributes a_past on a_past.Code = cma_past.Code
         left join cmverrors e on e.CoreMeasurementID = cm_present.CoreMeasurementID and
                                  e.ValidationErrorID = @validationProcedureID
where c_past.PlotCensusNumber >= 1
  and c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1
  and cm_present.IsActive is true
  and a_present.Status not in (''dead'', ''stem dead'', ''broken below'', ''missing'', ''omitted'')
  and a_past.Status not in (''dead'', ''stem dead'', ''broken below'', ''missing'', ''omitted'')
  and (cm_present.IsValidated is null and cm_past.IsValidated is true)
  and (@p_CensusID IS NULL OR cm_present.CensusID = @p_CensusID)
  and (@p_PlotID IS NULL OR c_present.PlotID = @p_PlotID)
  and e.CoreMeasurementID is null
  and cm_past.MeasuredDBH > 0
  and (cm_present.MeasuredDBH - cm_past.MeasuredDBH) * (case p.DefaultDBHUnits
                                                            when \'km\' THEN 1000000
                                                            when \'hm\' THEN 100000
                                                            when \'dam\' THEN 10000
                                                            when \'m\' THEN 1000
                                                            when \'dm\' THEN 100
                                                            when \'cm\' THEN 10
                                                            when \'mm\' THEN 1
                                                            else 1 end) > 65;', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                     ChangelogDefinition, IsEnabled)
VALUES (2, 'ValidateDBHShrinkageExceedsMax', 'DBH shrinkage exceeds maximum rate of 5 percent', 'measuredDBH', '
insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm_present.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm_present
         join coremeasurements cm_past on cm_present.StemID = cm_past.StemID and cm_present.CensusID <> cm_past.CensusID and cm_past.IsActive IS TRUE
         join census c_present on cm_present.CensusID = c_present.CensusID and c_present.IsActive is true
         join census c_past on cm_past.CensusID = c_past.CensusID and c_past.IsActive is true
         join plots p ON c_present.PlotID = p.PlotID and c_past.PlotID = p.PlotID
         join cmattributes cma_present on cma_present.CoreMeasurementID = cm_present.CoreMeasurementID
         join attributes a_present on a_present.Code = cma_present.Code
         join cmattributes cma_past on cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
         join attributes a_past on a_past.Code = cma_past.Code
         left join cmverrors e on e.CoreMeasurementID = cm_present.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where c_past.PlotCensusNumber >= 1
  and c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1
  and cm_present.IsActive is true
  and a_present.Status not in (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\')
  and a_past.Status not in (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\')
  and (cm_present.IsValidated is null and cm_past.IsValidated is true)
  and (@p_CensusID IS NULL OR cm_present.CensusID = @p_CensusID)
  and (@p_PlotID IS NULL OR c_present.PlotID = @p_PlotID)
  and e.CoreMeasurementID is null and cm_past.MeasuredDBH > 0
  and (cm_present.MeasuredDBH < (cm_past.MeasuredDBH * 0.95));', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                     ChangelogDefinition, IsEnabled)
VALUES (3, 'ValidateFindAllInvalidSpeciesCodes', 'Species Code is invalid (not defined in species table)',
        'speciesCode', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive = TRUE
         join stems s on cm.StemID = s.StemID and c.CensusID = s.CensusID and s.IsActive = TRUE
         join trees t on s.TreeID = t.TreeID and c.CensusID = t.CensusID and t.IsActive = TRUE
         left join species sp on t.SpeciesID = sp.SpeciesID and sp.IsActive = TRUE
         left join cmverrors e on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null and cm.IsActive is true
  and (@p_CensusID is null or c.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID)
  and e.CoreMeasurementID is null
  and sp.SpeciesID is null;', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                     ChangelogDefinition, IsEnabled)
VALUES (4, 'ValidateFindDuplicatedQuadratsByName',
        'Quadrat\'s name matches existing OTHER quadrat (QuadratIDs are different but QuadratNames are the same)',
        'quadratName', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join stems s on cm.StemID = s.StemID and c.CensusID = s.CensusID and s.IsActive is true
         join quadrats q on s.QuadratID = q.QuadratID and q.IsActive is true
         join (select s2.CensusID, q2.QuadratName
               from quadrats q2
                    join stems s2 on q2.QuadratID = s2.QuadratID
               group by s2.CensusID, q2.QuadratName
               having count(distinct q2.QuadratID) > 1) as ambiguous
         left join cmverrors e
                   on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null
  and cm.IsActive is true
  and (@p_CensusID is null or c.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID)
  and e.CoreMeasurementID is null;', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                     ChangelogDefinition, IsEnabled)
VALUES (5, 'ValidateFindDuplicateStemTreeTagCombinationsPerCensus',
        'Duplicate tree (and stem) tag found in census;Duplicate stem (and tree) tag found in census',
        'stemTag;treeTag', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         left join cmverrors e
                   on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
         join (select StemID, CensusID, count(*) AS MeasurementCount
               from coremeasurements
               group by StemID, CensusID
               having COUNT(*) > 1) dup on cm.StemID = dup.StemID and cm.CensusID = dup.CensusID
where cm.IsValidated is null and cm.IsActive is true
  and e.CoreMeasurementID is null
  and (@p_CensusID is null or c.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                     ChangelogDefinition, IsEnabled)
VALUES (6, 'ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat', 'Outside census date bounds',
        'measurementDate', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         left join cmverrors e
                   on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null and cm.IsActive is true
  and e.CoreMeasurementID is null
  and (cm.MeasurementDate < c.StartDate or cm.MeasurementDate > c.EndDate)
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                     ChangelogDefinition, IsEnabled)
VALUES (7, 'ValidateFindStemsInTreeWithDifferentSpecies', 'Flagged;Different species', 'stemTag;speciesCode', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select min(cm.CoreMeasurementID), @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join stems s on cm.StemID = s.StemID and c.CensusID = s.CensusID and s.IsActive is true
         join trees t on t.TreeID = s.TreeID and t.CensusID = c.CensusID and t.IsActive is true
         join species sp on t.SpeciesID = sp.SpeciesID and sp.IsActive is true
         left join cmverrors e
                   on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null
   or e.CoreMeasurementID is null and cm.IsActive is true
    and (@p_CensusID is null or cm.CensusID = @p_CensusID)
    and (@p_PlotID is null or c.PlotID = @p_PlotID)
group by t.TreeTag
having count(distinct sp.SpeciesCode) > 1;', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                     ChangelogDefinition, IsEnabled)
VALUES (8, 'ValidateFindStemsOutsidePlots', 'Flagged;X outside plot OR;Y outside plot', 'stemTag;stemLocalX;stemLocalY', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
join census c on cm.CensusID = c.CensusID and c.IsActive is true
join stems s on cm.StemID = s.StemID and c.CensusID = s.CensusID and s.IsActive is true
join quadrats q on s.QuadratID = q.QuadratID and q.IsActive is true
join plots p on c.PlotID = p.PlotID
left join cmverrors e on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null and e.CoreMeasurementID is null and cm.IsActive is true
and s.LocalX is not null and s.LocalY is not null
and q.StartX is not null and q.StartY is not null
and p.GlobalX is not null and p.GlobalY is not null
and p.DimensionX is not null and p.DimensionY is not null
and ((s.LocalX + q.StartX + p.GlobalX) > (p.GlobalX + p.DimensionX)) or ((s.LocalY + q.StartY + p.GlobalY) > (p.GlobalY + p.DimensionY))
and (@p_CensusID is null or cm.CensusID = @p_CensusID)
and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                     ChangelogDefinition, IsEnabled)
VALUES (9, 'ValidateFindTreeStemsInDifferentQuadrats', 'Flagged;Flagged;Different quadrats',
        'stemTag;treeTag;quadratName', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join stems s1 on cm.StemID = s1.StemID and c.CensusID = s1.CensusID and s1.IsActive is true
         join trees t on s1.TreeID = t.TreeID and c.CensusID = t.CensusID and t.IsActive is true
         join stems s2 on t.TreeID = s2.TreeID and s1.StemID <> s2.StemID and s2.IsActive is true
         left join cmverrors e
                   on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null and cm.IsActive is true
  and e.CoreMeasurementID is null
  and s1.QuadratID <> s2.QuadratID
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                     ChangelogDefinition, IsEnabled)
VALUES (11, 'ValidateScreenMeasuredDiameterMinMax', 'Measured DBH is outside of species-defined bounds', 'measuredDBH', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join stems s on cm.StemID = s.StemID and c.CensusID = s.CensusID and s.IsActive is true
         left join cmverrors e
                   on cm.CoreMeasurementID = e.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null and cm.IsActive is true
  and e.CoreMeasurementID is null
  and ((@minDBH is not null and cm.MeasuredDBH < @minDBH)
    or (@maxDBH is not null and cm.MeasuredDBH > @maxDBH))
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                     ChangelogDefinition, IsEnabled)
VALUES (12, 'ValidateScreenStemsWithMeasurementsButDeadAttributes', 'Invalid DBH;Invalid HOM;DEAD-state attribute(s)',
        'measuredDBH;measuredHOM;attributes', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join cmattributes cma on cm.CoreMeasurementID = cma.CoreMeasurementID
         join attributes a on cma.Code = a.Code and a.IsActive is true
              and cma.Code = a.Code and a.Status in (\'dead\', \'stem dead\', \'missing\', \'broken below\', \'omitted\')
         left join cmverrors e
                   on cm.CoreMeasurementID = e.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null and cm.IsActive is true
  and e.CoreMeasurementID is null
  and ((cm.MeasuredDBH is not null and cm.MeasuredDBH <> 0)
    or (cm.MeasuredHOM is not null and cm.MeasuredHOM <> 0))
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);
', '', false);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                     ChangelogDefinition, IsEnabled)
VALUES (13, 'ValidateScreenStemsWithMissingMeasurementsButLiveAttributes',
        'Missing DBH;Missing HOM;LIVE-state attribute(s)', 'measuredDBH;measuredHOM;attributes', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join cmattributes cma on cm.CoreMeasurementID = cma.CoreMeasurementID
         join attributes a on cma.Code = a.Code and a.IsActive is true
              and cma.Code = a.Code and a.Status not in (\'dead\', \'stem dead\', \'missing\', \'broken below\', \'omitted\') and a.IsActive is true
         left join cmverrors e
                   on cm.CoreMeasurementID = e.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null and cm.IsActive is true
  and e.CoreMeasurementID is null
  and ((cm.MeasuredDBH is null or cm.MeasuredDBH = 0)
    or (cm.MeasuredHOM is null or cm.MeasuredHOM = 0))
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', false);

truncate postvalidationqueries; -- clear the table if re-running this script on accident
insert into postvalidationqueries
    (QueryName, QueryDefinition, Description, IsEnabled)
values ('Number of Records by Quadrat',
        'select q.QuadratName, count(distinct cm.CoreMeasurementID) as MeasurementCount
            from ${schema}.coremeasurements cm
            join ${schema}.census c on c.CensusID = cm.CensusID and c.IsActive is true
            join ${schema}.stems s on s.StemID = cm.StemID and s.CensusID = c.CensusID and s.IsActive is true
            join ${schema}.quadrats q on q.QuadratID = s.QuadratID and q.IsActive is true
            where cm.CensusID = ${currentCensusID} and q.PlotID = ${currentPlotID}
            group by q.QuadratName;',
        'Calculating the number of total records, organized by quadrat',
        true),
       ('Number of ALL Stem Records',
        'SELECT COUNT(s.StemID) AS TotalStems
           FROM ${schema}.stems s
           JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID and cm.IsActive is true
           JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
           JOIN ${schema}.attributes a ON cma.Code = a.Code and a.IsActive is true
           JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID and q.IsActive is true
           WHERE s.CensusID = ${currentCensusID} and s.IsActive is true AND q.PlotID = ${currentPlotID};',
        'Calculating the number of total stem records for the current site, plot, and census',
        true),
       ('Number of all LIVE stem records',
        'SELECT COUNT(s.StemID) AS LiveStems
FROM ${schema}.stems s
         JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID and cm.IsActive is true
         JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
         JOIN ${schema}.attributes a ON cma.Code = a.Code
         JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID and q.IsActive is true
WHERE a.Status = ''alive''
  AND s.CensusID = ${currentCensusID}
  AND s.IsActive is true
  AND q.PlotID = ${currentPlotID};',
        'Calculating the number of all live stem records for the current site, plot, and census', true),
       ('Number of all trees',
        'select count(t.TreeID) as TotalTrees
from ${schema}.coremeasurements cm
join ${schema}.stems s on s.StemID = cm.StemID and s.IsActive is true
join ${schema}.census c on c.CensusID = cm.CensusID and c.IsActive is true
join ${schema}.trees t on t.CensusID = c.CensusID and t.IsActive is true
join ${schema}.quadrats q on q.QuadratID = s.QuadratID and q.IsActive is true
where c.CensusID = ${currentCensusID} and c.PlotID = ${currentPlotID}',
        'Calculating the total number of all trees for the current site, plot, and census', true),
       ('All dead or missing stems and count by census',
        'SELECT cm.CensusID,
           COUNT(s.StemID) AS DeadOrMissingStems,
           GROUP_CONCAT(s.StemTag ORDER BY s.StemTag) AS DeadOrMissingStemList
           FROM ${schema}.stems s
           JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID and cm.IsActive is true
           JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
           JOIN ${schema}.attributes a ON a.Code = cma.Code and a.IsActive is true
           WHERE a.Status IN (''dead'', ''missing'') and s.IsActive is true
           GROUP BY cm.CensusID;',
        'Finds and returns a count of, then all dead or missing stems by census', true),
       ('All trees outside plot limits',
        'select t.TreeTag,
       (s.LocalX + q.StartX + p.GlobalX) as GlobalStemX,
       (s.LocalY + q.StartY + p.GlobalY) as GlobalStemY
from ${schema}.coremeasurements cm
         join ${schema}.stems s on s.StemID = cm.StemID
         join ${schema}.census c on c.CensusID = cm.CensusID
         join ${schema}.plots p on p.PlotID = c.PlotID
         join ${schema}.trees t on t.CensusID = c.CensusID and t.TreeID = s.TreeID and t.IsActive is true
         join ${schema}.quadrats q on q.QuadratID = s.QuadratID and q.IsActive is true
where (s.LocalX is null or q.StartX is null or p.GlobalX is null or p.DimensionX is null)
   or (s.LocalY is null or q.StartY is null or p.GlobalY is null or p.DimensionY is null)
   or (s.LocalX + q.StartX + p.GlobalX) > (p.GlobalX + p.DimensionX)
   or (s.LocalY + q.StartY + p.GlobalY) > (p.GlobalY + p.DimensionY)
    and (p.PlotID = ${currentPlotID} and c.CensusID = ${currentCensusID});',
        'Finds and returns any trees outside plot limits', true),
       ('Highest DBH measurement and HOM measurement by species',
        'select sp.SpeciesCode, sp.SpeciesName, max(cm.MeasuredDBH) as LargestDBH, max(cm.MeasuredHOM) as LargestHOM
from ${schema}.coremeasurements cm
         join ${schema}.census c on c.CensusID = cm.CensusID
         join ${schema}.stems s on s.StemID = cm.StemID and s.CensusID = c.CensusID and s.IsActive is true
         join ${schema}.trees t on t.CensusID = c.CensusID and t.TreeID = s.TreeID and t.IsActive is true
         join ${schema}.quadrats q on q.QuadratID = s.QuadratID and q.IsActive is true
         join ${schema}.species sp on sp.SpeciesID = t.SpeciesID and sp.IsActive is true
where c.CensusID = ${currentCensusID}
  and c.PlotID = ${currentPlotID}
group by sp.SpeciesCode, sp.SpeciesName;',
        'Finds and returns the largest DBH/HOM measurement and their host species ID', true),
       ('Checks that all trees from the last census are present',
        'WITH current_census AS (SELECT *
                        FROM ${schema}.census
                        WHERE CensusID = ${currentCensusID}
                          AND IsActive = 1),
     previous_census AS (SELECT c2.*
                         FROM ${schema}.census c2
                                  JOIN current_census cc
                                       ON c2.PlotID = cc.PlotID
                                           AND c2.PlotCensusNumber = cc.PlotCensusNumber - 1
                                           AND c2.IsActive = 1)
SELECT t.TreeTag,
       sp.SpeciesCode
FROM previous_census pc
         JOIN ${schema}.trees t
              ON t.CensusID = pc.CensusID
         JOIN ${schema}.species s
              ON s.SpeciesID = t.SpeciesID
         LEFT JOIN ${schema}.trees t_cur
                   ON t_cur.TreeTag = t.TreeTag and t_cur.CensusID = (SELECT CensusID FROM current_census)
WHERE t_cur.TreeID IS NULL;',
        'Determining whether all trees accounted for in the last census have new measurements in the "next" measurement',
        true),
       ('Number of new stems, grouped by quadrat, and then by census',
        'WITH current_census AS (SELECT PlotID, PlotCensusNumber
                        FROM ${schema}.census
                        WHERE CensusID = ${currentCensusID}
                          AND IsActive = 1),
     previous_census AS (SELECT c2.CensusID
                         FROM ${schema}.census AS c2
                                  JOIN current_census AS cc
                                       ON c2.PlotID = cc.PlotID
                                           AND c2.PlotCensusNumber = cc.PlotCensusNumber - 1
                                           AND c2.IsActive = 1)
SELECT q.QuadratName,
       s_current.StemTag,
       t.TreeTag,
       s_current.LocalX,
       s_current.LocalY
FROM ${schema}.census c_current
         JOIN current_census AS cc
              ON cc.PlotID = c_current.PlotID
         JOIN ${schema}.stems AS s_current
              ON s_current.CensusID = c_current.CensusID
                  AND s_current.IsActive = 1
         JOIN ${schema}.quadrats q
              ON q.QuadratID = s_current.QuadratID
         JOIN ${schema}.trees t
              ON t.TreeID = s_current.TreeID and t.CensusID = c_current.CensusID
         JOIN ${schema}.coremeasurements cm_current
              ON cm_current.StemID = s_current.StemID
                  AND cm_current.CensusID = s_current.CensusID
                  AND cm_current.IsActive = 1
WHERE c_current.IsActive = 1
  AND c_current.PlotID = ${currentPlotID}
  AND NOT EXISTS (SELECT 1
                  FROM ${schema}.coremeasurements AS cm_last
                  WHERE cm_last.StemID = s_current.StemID
                    AND cm_last.CensusID = (SELECT CensusID FROM previous_census)
                    AND cm_last.IsActive = 1)
ORDER BY q.QuadratName, s_current.StemTag;',
        'Finds new stems by quadrat for the current census', true),
       ('Determining which quadrats have the most and least number of new stems for the current census',
        'WITH current_census AS (SELECT CensusID AS currentID,
                               PlotID,
                               PlotCensusNumber
                        FROM ${schema}.census
                        WHERE CensusID = ${currentCensusID}
                          AND PlotID = ${currentPlotID}
                          AND IsActive = 1),
     previous_census AS (SELECT c2.CensusID AS previousID
                         FROM ${schema}.census AS c2
                                  JOIN current_census AS cc
                                       ON c2.PlotID = cc.PlotID
                                           AND c2.PlotCensusNumber = cc.PlotCensusNumber - 1
                                           AND c2.IsActive = 1),
     NewStems AS (SELECT s_current.QuadratID,
                         s_current.StemID
                  FROM ${schema}.stems AS s_current
                           JOIN ${schema}.coremeasurements AS cm_current
                                ON cm_current.StemID = s_current.StemID
                                    AND cm_current.CensusID = (SELECT currentID FROM current_census)
                                    AND cm_current.IsActive = 1
                  WHERE s_current.IsActive = 1
                    AND NOT EXISTS (SELECT 1
                                    FROM ${schema}.coremeasurements AS cm_last
                                    WHERE cm_last.StemID = s_current.StemID
                                      AND cm_last.CensusID = (SELECT previousID FROM previous_census)
                                      AND cm_last.IsActive = 1)),
     NewStemCounts AS (SELECT q.QuadratName,
                              COUNT(ns.StemID) AS NewStemCount
                       FROM ${schema}.stems s
                                JOIN NewStems AS ns
                                     ON ns.QuadratID = s.QuadratID
                                         AND s.CensusID = (SELECT currentID FROM current_census)
                                JOIN ${schema}.quadrats q on q.QuadratID = s.QuadratID
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
        'WITH current_census AS (SELECT CensusID, PlotID
                        FROM census
                        WHERE CensusID = ${currentCensusID}
                          AND IsActive = 1)
SELECT q.QuadratName,
       s.StemTag,
       t.TreeTag,
       s.LocalX,
       s.LocalY,
       a.Code        AS AttributeCode,
       a.Description AS AttributeDescription,
       a.Status      AS AttributeStatus
FROM current_census AS cc
         JOIN ${schema}.stems s on cc.CensusID = s.CensusID AND s.IsActive = 1
         JOIN ${schema}.quadrats q on q.QuadratID = s.QuadratID
         JOIN ${schema}.trees t on t.TreeID = s.TreeID and t.CensusID = cc.CensusID
         JOIN ${schema}.coremeasurements AS cm
              ON cm.StemID = s.StemID
                  AND cm.CensusID = cc.CensusID
                  AND cm.IsActive = 1
         JOIN ${schema}.cmattributes AS cma
              ON cma.CoreMeasurementID = cm.CoreMeasurementID
         JOIN ${schema}.attributes a on a.Code = cma.Code
WHERE cc.PlotID = ${currentPlotID}
  AND a.Status = ''dead''
ORDER BY q.QuadratName;',
        'dead stems by quadrat. also useful for tracking overall changes across plot', true),
       ('Number of dead stems by species',
        'WITH current_census AS (SELECT CensusID, PlotID
                        FROM ${schema}.census
                        WHERE CensusID = ${currentCensusID}
                          AND IsActive = 1)
SELECT sp.SpeciesName,
       sp.SpeciesCode,
       s.StemTag,
       t.TreeTag,
       q.QuadratName,
       s.LocalX,
       s.LocalY,
       a.Code        AS AttributeCode,
       a.Description AS AttributeDescription,
       a.Status      AS AttributeStatus
FROM current_census AS cc
         JOIN ${schema}.stems s on cc.CensusID = s.CensusID AND s.IsActive = 1
         JOIN ${schema}.quadrats q on q.QuadratID = s.QuadratID
         JOIN ${schema}.trees t on t.TreeID = s.TreeID and t.CensusID = cc.CensusID
         JOIN ${schema}.coremeasurements AS cm
              ON cm.StemID = s.StemID
                  AND cm.CensusID = cc.CensusID
                  AND cm.IsActive = 1
         JOIN ${schema}.cmattributes AS cma
              ON cma.CoreMeasurementID = cm.CoreMeasurementID
         JOIN ${schema}.attributes a on a.Code = cma.Code
         JOIN ${schema}.species sp on sp.SpeciesID = t.SpeciesID
WHERE cc.PlotID = ${currentCensusID}
  AND a.Status = ''dead''
ORDER BY sp.SpeciesName, s.StemID;',
        'dead stems by species, organized to determine which species (if any) are struggling', true);

set foreign_key_checks = 1;