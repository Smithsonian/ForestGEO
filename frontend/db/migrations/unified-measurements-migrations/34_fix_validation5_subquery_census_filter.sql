-- Fix ValidateFindDuplicateStemTreeTagCombinationsPerCensus (ValidationID=5)
-- The inner subquery was scanning ALL censuses instead of filtering by @p_CensusID,
-- causing query timeouts on large sites like SERC.
--
-- Run this against each site schema (e.g. forestgeo_serc, forestgeo_harvard, etc.)

UPDATE sitespecificvalidations
SET Definition = 'insert into measurement_error_log (MeasurementID, ErrorID)
select distinct cm.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1) as ErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join stems s on cm.StemGUID = s.StemGUID and c.CensusID = s.CensusID and s.IsActive is true
         join trees t on s.TreeID = t.TreeID and c.CensusID = t.CensusID and t.IsActive is true
         join (
             select cm2.CensusID, t2.TreeTag, s2.StemTag
             from coremeasurements cm2
             join stems s2 on cm2.StemGUID = s2.StemGUID and cm2.CensusID = s2.CensusID
             join trees t2 on s2.TreeID = t2.TreeID and s2.CensusID = t2.CensusID
             where cm2.IsActive = true and s2.IsActive = true and t2.IsActive = true
               and (@p_CensusID is null or cm2.CensusID = @p_CensusID)
             group by cm2.CensusID, t2.TreeTag, s2.StemTag
             having count(distinct cm2.CoreMeasurementID) > 1
         ) as duplicates ON cm.CensusID = duplicates.CensusID
                        AND t.TreeTag = duplicates.TreeTag
                        AND s.StemTag = duplicates.StemTag
         left join measurement_error_log e
                   on e.MeasurementID = cm.CoreMeasurementID and e.ErrorID = (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
where cm.IsValidated is null and cm.IsActive is true
  and e.MeasurementID is null
  and (@p_CensusID is null or c.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID)
on duplicate key update IsResolved = FALSE, ResolvedAt = NULL;'
WHERE ValidationID = 5;
