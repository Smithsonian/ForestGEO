create
    definer = azureroot@`%` procedure RefreshMeasurementsSummary()
BEGIN
    TRUNCATE TABLE measurementssummary;
    INSERT INTO measurementssummary
    SELECT cm.CoreMeasurementID                                AS CoreMeasurementID,
           st.StemID                                           AS StemID,
           t.TreeID                                            AS TreeID,
           s.SpeciesID                                         AS SpeciesID,
           q.QuadratID                                         AS QuadratID,
           q.PlotID                                            AS PlotID,
           cm.CensusID                                         AS CensusID,
           s.SpeciesName                                       AS SpeciesName,
           s.SubspeciesName                                    AS SubspeciesName,
           s.SpeciesCode                                       AS SpeciesCode,
           t.TreeTag                                           AS TreeTag,
           st.StemTag                                          AS StemTag,
           st.LocalX                                           AS StemLocalX,
           st.LocalY                                           AS StemLocalY,
           st.CoordinateUnits                                  AS StemUnits,
           q.QuadratName                                       AS QuadratName,
           cm.MeasurementDate                                  AS MeasurementDate,
           cm.MeasuredDBH                                      AS MeasuredDBH,
           cm.DBHUnit                                          AS DBHUnits,
           cm.MeasuredHOM                                      AS MeasuredHOM,
           cm.HOMUnit                                          AS HOMUnits,
           cm.IsValidated                                      AS IsValidated,
           cm.Description                                      AS Description,
           (SELECT GROUP_CONCAT(ca.Code SEPARATOR '; ')
            FROM cmattributes ca
            WHERE ca.CoreMeasurementID = cm.CoreMeasurementID) AS Attributes
    FROM coremeasurements cm
             LEFT JOIN stems st ON cm.StemID = st.StemID
             LEFT JOIN trees t ON st.TreeID = t.TreeID
             LEFT JOIN species s ON t.SpeciesID = s.SpeciesID
             LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
             LEFT JOIN census c ON cm.CensusID = c.CensusID;
END;

create
    definer = azureroot@`%` procedure RefreshViewFullTable()
BEGIN
    -- Truncate the materialized table
    TRUNCATE TABLE viewfulltable;

-- Insert data from the view into the materialized table
    INSERT INTO viewfulltable
    SELECT cm.CoreMeasurementID                                AS CoreMeasurementID,
           t.TreeID                                            AS TreeID,
           s.StemID                                            AS StemID,
           sp.SpeciesID                                        AS SpeciesID,
           g.GenusID                                           AS GenusID,
           f.FamilyID                                          AS FamilyID,
           q.QuadratID                                         AS QuadratID,
           p.PlotID                                            AS PlotID,
           c.CensusID                                          AS CensusID,
           cm.MeasurementDate                                  AS MeasurementDate,
           cm.MeasuredDBH                                      AS MeasuredDBH,
           cm.DBHUnit                                          AS DBHUnits,
           cm.MeasuredHOM                                      AS MeasuredHOM,
           cm.HOMUnit                                          AS HOMUnits,
           cm.Description                                      AS Description,
           cm.IsValidated                                      AS IsValidated,
           p.PlotName                                          AS PlotName,
           p.LocationName                                      AS LocationName,
           p.CountryName                                       AS CountryName,
           p.GlobalX                                           AS GlobalX,
           p.GlobalY                                           AS GlobalY,
           p.GlobalY                                           AS GlobalZ,
           q.QuadratName                                       AS QuadratName,
           q.StartX                                            AS QuadratX,
           q.StartY                                            AS QuadratY,
           c.PlotCensusNumber                                  AS PlotCensusNumber,
           c.StartDate                                         AS StartDate,
           c.EndDate                                           AS EndDate,
           t.TreeTag                                           AS TreeTag,
           s.StemTag                                           AS StemTag,
           s.LocalX                                            AS StemLocalX,
           s.LocalY                                            AS StemLocalY,
           s.CoordinateUnits                                   AS StemUnits,
           sp.SpeciesCode                                      AS SpeciesCode,
           sp.SpeciesName                                      AS SpeciesName,
           sp.SubspeciesName                                   AS SubspeciesName,
           sp.ValidCode                                        AS ValidCode,
           sp.SpeciesAuthority                                 AS SpeciesAuthority,
           sp.SubspeciesAuthority                              AS SubspeciesAuthority,
           sp.IDLevel                                          AS SpeciesIDLevel,
           sp.FieldFamily                                      AS SpeciesFieldFamily,
           g.Genus                                             AS Genus,
           g.GenusAuthority                                    AS GenusAuthority,
           f.Family                                            AS Family,
           (SELECT GROUP_CONCAT(ca.Code SEPARATOR '; ')
            FROM cmattributes ca
            WHERE ca.CoreMeasurementID = cm.CoreMeasurementID) AS Attributes
    FROM coremeasurements cm
             LEFT JOIN stems s ON cm.StemID = s.StemID
             LEFT JOIN trees t ON s.TreeID = t.TreeID
             LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
             LEFT JOIN genus g ON sp.GenusID = g.GenusID
             LEFT JOIN family f ON g.FamilyID = f.FamilyID
             LEFT JOIN quadrats q ON s.QuadratID = q.QuadratID
             LEFT JOIN census c ON cm.CensusID = c.CensusID
             LEFT JOIN plots p ON q.PlotID = p.PlotID;
END;