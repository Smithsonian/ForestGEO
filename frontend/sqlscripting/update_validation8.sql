UPDATE forestgeo_testing.sitespecificvalidations
SET Definition = 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
join census c on cm.CensusID = c.CensusID and c.IsActive is true
join stems s on cm.StemGUID = s.StemGUID and c.CensusID = s.CensusID and s.IsActive is true
join quadrats q on s.QuadratID = q.QuadratID and q.IsActive is true
join plots p on c.PlotID = p.PlotID
left join cmverrors e on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null
and e.CoreMeasurementID is null
and cm.IsActive is true
and (@p_CensusID is null or cm.CensusID = @p_CensusID)
and (@p_PlotID is null or c.PlotID = @p_PlotID)
-- Skip rows where plot/quadrat metadata is invalid (NULL or negative) - cannot validate stem positions
and q.StartX is not null and q.StartY is not null
and p.GlobalX is not null and p.GlobalY is not null
and p.DimensionX is not null and p.DimensionY is not null
and q.StartX >= 0 and q.StartY >= 0
and p.GlobalX >= 0 and p.GlobalY >= 0
and p.DimensionX > 0 and p.DimensionY > 0
-- Flag if stem coordinates are NULL, negative, or outside boundaries (inclusive boundaries - stems can be on edge)
-- IMPORTANT: Exclude dead stems (DN, DS, DTR) - dead stems do not require coordinates
and (
    s.LocalX is null
    or s.LocalY is null
    or s.LocalX < 0
    or s.LocalY < 0
    or (s.LocalX + q.StartX) < 0
    or (s.LocalX + q.StartX) > p.DimensionX
    or (s.LocalY + q.StartY) < 0
    or (s.LocalY + q.StartY) > p.DimensionY
)
-- Do NOT flag dead stems (status = ''dead'' or ''stem dead'') for missing coordinates
and NOT EXISTS (
    SELECT 1 FROM cmattributes cma
    JOIN attributes a ON cma.Code = a.Code
    WHERE cma.CoreMeasurementID = cm.CoreMeasurementID
    AND a.Status IN (''dead'', ''stem dead'')
);'
WHERE ValidationID = 8;
