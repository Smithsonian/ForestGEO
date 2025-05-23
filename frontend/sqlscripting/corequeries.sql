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
         join censusattributes cav_present
              on cav_present.Code = cma_present.Code and cav_present.CensusID = cm_present.CensusID
         join attributesversioning av_present on av_present.AttributesVersioningID = cav_present.AttributesVersioningID
         join cmattributes cma_past on cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
         join censusattributes cav_past on cav_past.Code = cma_past.Code and cav_past.CensusID = cm_past.CensusID
         join attributesversioning av_past on av_past.AttributesVersioningID = cav_past.AttributesVersioningID
         left join cmverrors e on e.CoreMeasurementID = cm_present.CoreMeasurementID and
                                  e.ValidationErrorID = @validationProcedureID
where c_past.PlotCensusNumber >= 1
  and c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1
  and cm_present.IsActive is true
  and av_present.Status not in (''dead'', ''stem dead'', ''broken below'', ''missing'', ''omitted'')
  and av_past.Status not in (''dead'', ''stem dead'', ''broken below'', ''missing'', ''omitted'')
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
         join censusattributes cav_present on cav_present.Code = cma_present.Code and cav_present.CensusID = cm_present.CensusID
         join attributesversioning av_present on av_present.AttributesVersioningID = cav_present.AttributesVersioningID
         join cmattributes cma_past on cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
         join censusattributes cav_past on cav_past.Code = cma_past.Code and cav_past.CensusID = cm_past.CensusID
         join attributesversioning av_past on av_past.AttributesVersioningID = cav_past.AttributesVersioningID
         left join cmverrors e on e.CoreMeasurementID = cm_present.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where c_past.PlotCensusNumber >= 1
  and c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1
  and cm_present.IsActive is true
  and av_present.Status not in (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\')
  and av_past.Status not in (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\')
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
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         left join stems s on cm.StemID = s.StemID and s.IsActive is true
         left join censustrees ct on ct.CensusID = c.CensusID and ct.TreeID = s.TreeID
         left join treesversioning tv on tv.TreesVersioningID = ct.TreesVersioningID
         left join censusspecies cs on cs.SpeciesID = tv.SpeciesID and cs.CensusID = c.CensusID
         left join speciesversioning sv on sv.SpeciesVersioningID = cs.SpeciesVersioningID
         left join cmverrors e on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null and cm.IsActive is true
  and (@p_CensusID is null or c.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID)
  and e.CoreMeasurementID is null
  and (sv.SpeciesVersioningID is null or tv.TreesVersioningID is null or s.StemID is null);', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                     ChangelogDefinition, IsEnabled)
VALUES (4, 'ValidateFindDuplicatedQuadratsByName',
        'Quadrat\'s name matches existing OTHER quadrat (QuadratIDs are different but QuadratNames are the same)',
        'quadratName', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join stems s on cm.StemID = s.StemID and s.IsActive is true
         join censusquadrats cq on cq.QuadratID = s.QuadratID and cq.CensusID = cm.CensusID
         join quadratsversioning qv on qv.QuadratsVersioningID = cq.QuadratsVersioningID
         join (select cq2.CensusID, qv2.QuadratName
               from quadratsversioning qv2
                        join censusquadrats cq2 on qv2.QuadratsVersioningID = cq2.QuadratsVersioningID
               group by cq2.CensusID, qv2.QuadratName
               having count(distinct qv2.QuadratID) > 1) as ambiguous
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
         join stems s on cm.StemID = s.StemID and s.IsActive is true
         join censustrees ct on ct.CensusID = c.CensusID
         join treesversioning tv on tv.TreeID = s.TreeID and tv.TreesVersioningID = ct.TreesVersioningID
         join censusspecies cs on cs.CensusID = c.CensusID
         join speciesversioning sv on sv.SpeciesID = tv.SpeciesID and sv.SpeciesVersioningID = cs.SpeciesVersioningID
         left join cmverrors e
                   on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null
   or e.CoreMeasurementID is null and cm.IsActive is true
    and (@p_CensusID is null or cm.CensusID = @p_CensusID)
    and (@p_PlotID is null or c.PlotID = @p_PlotID)
group by tv.TreeTag
having count(distinct sv.SpeciesCode) > 1;', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                     ChangelogDefinition, IsEnabled)
VALUES (8, 'ValidateFindStemsOutsidePlots', 'Flagged;X outside plot OR;Y outside plot', 'stemTag;stemLocalX;stemLocalY', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
join census c on cm.CensusID = c.CensusID and c.IsActive is true
join censusquadrats cq on c.CensusID = cq.CensusID
join quadratsversioning qv on qv.QuadratID = cq.QuadratID and qv.QuadratsVersioningID = cq.QuadratsVersioningID
join stems s on cm.StemID = s.StemID and s.IsActive is true
join plots p on c.PlotID = p.PlotID
left join cmverrors e on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null and e.CoreMeasurementID is null and cm.IsActive is true
and ((s.LocalX + qv.StartX + p.GlobalX) > (p.GlobalX + p.DimensionX)) or ((s.LocalY + qv.StartY + p.GlobalY) > (p.GlobalY + p.DimensionY))
and (@p_CensusID is null or cm.CensusID = @p_CensusID)
and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                     ChangelogDefinition, IsEnabled)
VALUES (9, 'ValidateFindTreeStemsInDifferentQuadrats', 'Flagged;Flagged;Different quadrats',
        'stemTag;treeTag;quadratName', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join stems s1 on cm.StemID = s1.StemID and s1.IsActive is true
         join censustrees ct on ct.CensusID = c.CensusID
         join treesversioning tv on s1.TreeID = tv.TreeID and tv.TreesVersioningID = ct.TreesVersioningID
         join stems s2 on tv.TreeID = s2.TreeID and s1.StemID <> s2.StemID and s2.IsActive is true
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
         join stems s on cm.StemID = s.StemID and s.IsActive is true
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
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
         join censusattributes ca on ca.CensusID = c.CensusID
         join attributesversioning av on av.AttributesVersioningID = ca.AttributesVersioningID
              and cma.Code = av.Code and av.Status in (\'dead\', \'stem dead\', \'missing\', \'broken below\', \'omitted\')
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
         join censusattributes ca on ca.CensusID = c.CensusID
         join attributesversioning av on av.AttributesVersioningID = ca.AttributesVersioningID
              and cma.Code = av.Code and av.Status not in (\'dead\', \'stem dead\', \'missing\', \'broken below\', \'omitted\') and a.IsActive is true
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
        'select qv.QuadratName, count(distinct cm.CoreMeasurementID) as MeasurementCount
            from ${schema}.coremeasurements cm
            join ${schema}.stems s on s.StemID = cm.StemID and s.IsActive is true
            join ${schema}.census c on c.CensusID = cm.CensusID and c.IsActive is true
            join ${schema}.censusquadrats cq on cq.CensusID = c.CensusID and cq.QuadratID = s.QuadratID
            join ${schema}.quadratsversioning qv on qv.QuadratsVersioningID = cq.QuadratsVersioningID and qv.QuadratID = cq.QuadratID
            where cm.CensusID = ${currentCensusID} and qv.PlotID = ${currentPlotID}
            group by qv.QuadratName;',
        'Calculating the number of total records, organized by quadrat',
        true),
       ('Number of ALL Stem Records',
        'SELECT COUNT(s.StemID) AS TotalStems
           FROM ${schema}.stems s
           JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID and cm.IsActive is true
           JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
           join ${schema}.censusattributes ca ON ca.CensusID = cm.CensusID and ca.Code = cma.Code
           JOIN ${schema}.attributesversioning av ON av.AttributesVersioningID = ca.AttributesVersioningID and av.Code = cma.Code
           JOIN ${schema}.censusquadrats cq ON cq.CensusID = cm.CensusID
           JOIN ${schema}.quadratsversioning qv ON qv.QuadratID = s.QuadratID and qv.QuadratsVersioningID = cq.QuadratsVersioningID
           WHERE cq.CensusID = ${currentCensusID} and s.IsActive is true AND qv.PlotID = ${currentPlotID};',
        'Calculating the number of total stem records for the current site, plot, and census',
        true),
       ('Number of all LIVE stem records',
        'SELECT COUNT(s.StemID) AS LiveStems
FROM ${schema}.stems s
         JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID and cm.IsActive is true
         JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
         join ${schema}.censusattributes ca on ca.CensusID = cm.CensusID
         JOIN ${schema}.attributesversioning av ON av.AttributesVersioningID = ca.AttributesVersioningID and av.Code = cma.Code
         JOIN ${schema}.censusquadrats cq ON cq.CensusID = cm.CensusID
         JOIN ${schema}.quadratsversioning qv ON qv.QuadratID = s.QuadratID and qv.QuadratsVersioningID = cq.QuadratsVersioningID
WHERE av.Status = ''alive''
  AND cm.CensusID = ${currentCensusID}
  AND s.IsActive is true
  AND qv.PlotID = ${currentPlotID};',
        'Calculating the number of all live stem records for the current site, plot, and census', true),
       ('Number of all trees',
        'select count(tv.TreeID) as TotalTrees
from ${schema}.coremeasurements cm
join ${schema}.stems s on s.StemID = cm.StemID and s.IsActive is true
join ${schema}.census c on c.CensusID = cm.CensusID and c.IsActive is true
join ${schema}.censustrees ct on ct.CensusID = c.CensusID and ct.TreeID = s.TreeID
join ${schema}.treesversioning tv on tv.TreesVersioningID = ct.TreesVersioningID
join ${schema}.censusquadrats cq on cq.CensusID = c.CensusID and cq.QuadratID = s.QuadratID
join ${schema}.quadratsversioning qv on qv.QuadratsVersioningID = cq.QuadratsVersioningID
where c.CensusID = ${currentCensusID} and c.PlotID = ${currentPlotID}',
        'Calculating the total number of all trees for the current site, plot, and census', true),
       ('All dead or missing stems and count by census',
        'SELECT cm.CensusID,
           COUNT(s.StemID) AS DeadOrMissingStems,
           GROUP_CONCAT(s.StemTag ORDER BY s.StemTag) AS DeadOrMissingStemList
           FROM ${schema}.stems s
           JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID and cm.IsActive is true
           JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
           join ${schema}.censusattributes ca on ca.CensusID = cm.CensusID
           JOIN ${schema}.attributesversioning av ON av.Code = cma.Code and av.AttributesVersioningID = ca.AttributesVersioningID and av.Code = ca.Code
           WHERE av.Status IN (''dead'', ''missing'') and s.IsActive is true
           GROUP BY cm.CensusID;',
        'Finds and returns a count of, then all dead or missing stems by census', true),
       ('All trees outside plot limits',
        'select tv.TreeTag,
       (s.LocalX + qv.StartX + p.GlobalX) as GlobalStemX,
       (s.LocalY + qv.StartY + p.GlobalY) as GlobalStemY
from ${schema}.coremeasurements cm
         join ${schema}.stems s on s.StemID = cm.StemID
         join ${schema}.census c on c.CensusID = cm.CensusID
         join ${schema}.plots p on p.PlotID = c.PlotID
         join ${schema}.censustrees ct on ct.CensusID = c.CensusID
         join ${schema}.censusquadrats cq on cq.CensusID = c.CensusID
         join ${schema}.treesversioning tv on tv.TreesVersioningID = ct.TreesVersioningID and tv.TreeID = s.TreeID
         join ${schema}.quadratsversioning qv on qv.QuadratsVersioningID = cq.QuadratsVersioningID and qv.QuadratID = s.QuadratID
where (s.LocalX is null or qv.StartX is null or p.GlobalX is null or p.DimensionX is null)
   or (s.LocalY is null or qv.StartY is null or p.GlobalY is null or p.DimensionY is null)
   or (s.LocalX + qv.StartX + p.GlobalX) > (p.GlobalX + p.DimensionX)
   or (s.LocalY + qv.StartY + p.GlobalY) > (p.GlobalY + p.DimensionY)
    and (p.PlotID = ${currentPlotID} and c.CensusID = ${currentCensusID});',
        'Finds and returns any trees outside plot limits', true),
       ('Highest DBH measurement and HOM measurement by species',
        'select sv.SpeciesCode, sv.SpeciesName, max(cm.MeasuredDBH) as LargestDBH, max(cm.MeasuredHOM) as LargestHOM
from ${schema}.coremeasurements cm
         join ${schema}.census c on c.CensusID = cm.CensusID
         join ${schema}.stems s on s.StemID = cm.StemID
         join ${schema}.censustrees ct on ct.CensusID = c.CensusID and ct.TreeID = s.TreeID
         join ${schema}.treesversioning tv on tv.TreesVersioningID = ct.TreesVersioningID
         join ${schema}.censusquadrats cq on cq.CensusID = c.CensusID and cq.QuadratID = s.QuadratID
         join ${schema}.quadratsversioning qv on qv.QuadratsVersioningID = cq.QuadratsVersioningID
         join ${schema}.censusspecies cs on cs.CensusID = c.CensusID and cs.SpeciesID = tv.SpeciesID
         join ${schema}.speciesversioning sv on sv.SpeciesVersioningID = cs.SpeciesVersioningID
where c.CensusID = ${currentCensusID}
  and c.PlotID = ${currentPlotID}
group by sv.SpeciesCode, sv.SpeciesName;',
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
SELECT tv.TreeTag,
       sv.SpeciesCode
FROM previous_census pc
         JOIN ${schema}.censustrees ct_last
              ON ct_last.CensusID = pc.CensusID
         JOIN ${schema}.treesversioning tv
              ON tv.TreesVersioningID = ct_last.TreesVersioningID
         JOIN ${schema}.censusspecies cs
              ON cs.CensusID = pc.CensusID
                  AND cs.SpeciesID = tv.SpeciesID
         JOIN ${schema}.speciesversioning sv
              ON sv.SpeciesVersioningID = cs.SpeciesVersioningID
         LEFT JOIN ${schema}.censustrees ct_cur
                   ON ct_cur.TreeID = tv.TreeID
                       AND ct_cur.CensusID = (SELECT CensusID FROM current_census)
WHERE ct_cur.TreeID IS NULL;',
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
SELECT qv.QuadratName,
       s_current.StemTag,
       tv.TreeTag,
       s_current.LocalX,
       s_current.LocalY
FROM ${schema}.censusquadrats AS cq
         JOIN ${schema}.census AS c_current
              ON c_current.CensusID = cq.CensusID
         JOIN current_census AS cc
              ON cc.PlotID = c_current.PlotID
         JOIN ${schema}.quadratsversioning AS qv
              ON qv.QuadratsVersioningID = cq.QuadratsVersioningID
         JOIN ${schema}.stems AS s_current
              ON s_current.QuadratID = cq.QuadratID
                  AND s_current.IsActive = 1
         JOIN ${schema}.censustrees AS ct
              ON ct.CensusID = cq.CensusID
                  AND ct.TreeID = s_current.TreeID
         JOIN ${schema}.treesversioning AS tv
              ON tv.TreesVersioningID = ct.TreesVersioningID
         JOIN ${schema}.coremeasurements AS cm_current
              ON cm_current.StemID = s_current.StemID
                  AND cm_current.CensusID = cq.CensusID
                  AND cm_current.IsActive = 1
WHERE c_current.IsActive = 1
  AND c_current.PlotID = ${currentPlotID}
  AND NOT EXISTS (SELECT 1
                  FROM ${schema}.coremeasurements AS cm_last
                  WHERE cm_last.StemID = s_current.StemID
                    AND cm_last.CensusID = (SELECT CensusID FROM previous_census)
                    AND cm_last.IsActive = 1)
ORDER BY qv.QuadratName, s_current.StemTag;',
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
     NewStemCounts AS (SELECT qv.QuadratName,
                              COUNT(ns.StemID) AS NewStemCount
                       FROM ${schema}.censusquadrats AS cq
                                JOIN NewStems AS ns
                                     ON ns.QuadratID = cq.QuadratID
                                         AND cq.CensusID = (SELECT currentID FROM current_census)
                                JOIN ${schema}.quadratsversioning AS qv
                                     ON qv.QuadratsVersioningID = cq.QuadratsVersioningID
                       GROUP BY qv.QuadratID, qv.QuadratName),
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
SELECT qv.QuadratName,
       s.StemTag,
       tv.TreeTag,
       s.LocalX,
       s.LocalY,
       av.Code        AS AttributeCode,
       av.Description AS AttributeDescription,
       av.Status      AS AttributeStatus
FROM current_census AS cc
         JOIN ${schema}.censusquadrats AS cq
              ON cq.CensusID = cc.CensusID
         JOIN ${schema}.quadratsversioning AS qv
              ON qv.QuadratsVersioningID = cq.QuadratsVersioningID
         JOIN ${schema}.stems AS s
              ON s.QuadratID = qv.QuadratID
                  AND s.IsActive = 1
         JOIN ${schema}.censustrees AS ct
              ON ct.CensusID = cc.CensusID
                  AND ct.TreeID = s.TreeID
         JOIN ${schema}.treesversioning AS tv
              ON tv.TreesVersioningID = ct.TreesVersioningID
         JOIN ${schema}.coremeasurements AS cm
              ON cm.StemID = s.StemID
                  AND cm.CensusID = cc.CensusID
                  AND cm.IsActive = 1
         JOIN ${schema}.cmattributes AS cma
              ON cma.CoreMeasurementID = cm.CoreMeasurementID
         JOIN ${schema}.censusattributes AS ca
              ON ca.CensusID = cc.CensusID
                  AND ca.Code = cma.Code
         JOIN ${schema}.attributesversioning AS av
              ON av.AttributesVersioningID = ca.AttributesVersioningID
WHERE cc.PlotID = ${currentPlotID}
  AND av.Status = ''dead''
ORDER BY qv.QuadratName;',
        'dead stems by quadrat. also useful for tracking overall changes across plot', true),
       ('Number of dead stems by species',
        'WITH current_census AS (SELECT CensusID, PlotID
                        FROM ${schema}.census
                        WHERE CensusID = ${currentCensusID}
                          AND IsActive = 1)
SELECT sv.SpeciesName,
       sv.SpeciesCode,
       s.StemTag,
       tv.TreeTag,
       qv.QuadratName,
       s.LocalX,
       s.LocalY,
       av.Code        AS AttributeCode,
       av.Description AS AttributeDescription,
       av.Status      AS AttributeStatus
FROM current_census AS cc
         JOIN ${schema}.censusquadrats AS cq
              ON cq.CensusID = cc.CensusID
         JOIN ${schema}.quadratsversioning AS qv
              ON qv.QuadratsVersioningID = cq.QuadratsVersioningID
         JOIN ${schema}.stems AS s
              ON s.QuadratID = qv.QuadratID
                  AND s.IsActive = 1
         JOIN ${schema}.censustrees AS ct
              ON ct.CensusID = cc.CensusID
                  AND ct.TreeID = s.TreeID
         JOIN ${schema}.treesversioning AS tv
              ON tv.TreesVersioningID = ct.TreesVersioningID
         JOIN ${schema}.coremeasurements AS cm
              ON cm.StemID = s.StemID
                  AND cm.CensusID = cc.CensusID
                  AND cm.IsActive = 1
         JOIN ${schema}.cmattributes AS cma
              ON cma.CoreMeasurementID = cm.CoreMeasurementID
         JOIN ${schema}.censusattributes AS ca
              ON ca.CensusID = cc.CensusID
                  AND ca.Code = cma.Code
         JOIN ${schema}.attributesversioning AS av
              ON av.AttributesVersioningID = ca.AttributesVersioningID
         JOIN ${schema}.censusspecies AS cs
              ON cs.CensusID = cc.CensusID
                  AND cs.SpeciesID = tv.SpeciesID
         JOIN ${schema}.speciesversioning AS sv
              ON sv.SpeciesVersioningID = cs.SpeciesVersioningID
WHERE cc.PlotID = ${currentCensusID}
  AND av.Status = ''dead''
ORDER BY sv.SpeciesName, s.StemID;',
        'dead stems by species, organized to determine which species (if any) are struggling', true);

set foreign_key_checks = 1;