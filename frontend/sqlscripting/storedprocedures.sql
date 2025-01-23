drop procedure if exists RefreshMeasurementsSummary;
drop procedure if exists RefreshViewFullTable;

create
    definer = azureroot@`%` procedure RefreshMeasurementsSummary()
BEGIN
    SET foreign_key_checks = 0;
    TRUNCATE TABLE measurementssummary;
    INSERT INTO measurementssummary
    SELECT COALESCE(cm.CoreMeasurementID, 0)                    AS CoreMeasurementID,
           COALESCE(st.StemID, 0)                               AS StemID,
           COALESCE(t.TreeID, 0)                                AS TreeID,
           COALESCE(s.SpeciesID, 0)                             AS SpeciesID,
           COALESCE(q.QuadratID, 0)                             AS QuadratID,
           COALESCE(q.PlotID, 0)                                AS PlotID,
           COALESCE(cm.CensusID, 0)                             AS CensusID,
           s.SpeciesName                                        AS SpeciesName,
           s.SubspeciesName                                     AS SubspeciesName,
           s.SpeciesCode                                        AS SpeciesCode,
           t.TreeTag                                            AS TreeTag,
           st.StemTag                                           AS StemTag,
           st.LocalX                                            AS StemLocalX,
           st.LocalY                                            AS StemLocalY,
           q.QuadratName                                        AS QuadratName,
           cm.MeasurementDate                                   AS MeasurementDate,
           cm.MeasuredDBH                                       AS MeasuredDBH,
           cm.MeasuredHOM                                       AS MeasuredHOM,
           cm.IsValidated                                       AS IsValidated,
           cm.Description                                       AS Description,
           (SELECT GROUP_CONCAT(DISTINCT ca.Code SEPARATOR '; ')
            FROM cmattributes ca
            WHERE ca.CoreMeasurementID = cm.CoreMeasurementID)  AS Attributes,
           cm.UserDefinedFields                                 AS UserDefinedFields,
           (SELECT GROUP_CONCAT(CONCAT(vp.ProcedureName, '->', vp.Description) SEPARATOR ';')
            FROM catalog.validationprocedures vp
                     JOIN cmverrors cmv ON cmv.ValidationErrorID = vp.ValidationID
            WHERE cmv.CoreMeasurementID = cm.CoreMeasurementID) AS Errors
    FROM coremeasurements cm
             LEFT JOIN stems st ON cm.StemID = st.StemID
             LEFT JOIN trees t ON st.TreeID = t.TreeID
             LEFT JOIN species s ON t.SpeciesID = s.SpeciesID
             LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
             LEFT JOIN census c ON cm.CensusID = c.CensusID
             LEFT JOIN plots p ON p.PlotID = c.PlotID;
    SET foreign_key_checks = 1;
END;


create
    definer = azureroot@`%` procedure RefreshViewFullTable()
BEGIN
    SET foreign_key_checks = 0;
    TRUNCATE TABLE viewfulltable;
    INSERT INTO viewfulltable (
        CoreMeasurementID, MeasurementDate, MeasuredDBH, MeasuredHOM, Description, IsValidated,
        PlotID, PlotName, LocationName, CountryName, DimensionX, DimensionY, PlotArea,
        PlotGlobalX, PlotGlobalY, PlotGlobalZ, PlotShape, PlotDescription, PlotDefaultDimensionUnits,
        PlotDefaultCoordinateUnits, PlotDefaultAreaUnits, PlotDefaultDBHUnits, PlotDefaultHOMUnits, CensusID,
        CensusStartDate, CensusEndDate, CensusDescription, PlotCensusNumber, QuadratID, QuadratName, QuadratDimensionX,
        QuadratDimensionY, QuadratArea, QuadratStartX, QuadratStartY, QuadratShape, TreeID, TreeTag, StemID, StemTag,
        StemLocalX, StemLocalY, SpeciesID,SpeciesCode, SpeciesName, SubspeciesName, SubspeciesAuthority, SpeciesIDLevel,
        GenusID, Genus, GenusAuthority, FamilyID, Family, Attributes, UserDefinedFields
    )
    SELECT
        cm.CoreMeasurementID AS CoreMeasurementID,
        cm.MeasurementDate AS MeasurementDate,
        cm.MeasuredDBH AS MeasuredDBH,
        cm.MeasuredHOM AS MeasuredHOM,
        cm.Description AS Description,
        cm.IsValidated AS IsValidated,
        p.PlotID AS PlotID,
        p.PlotName AS PlotName,
        p.LocationName AS LocationName,
        p.CountryName AS CountryName,
        p.DimensionX AS DimensionX,
        p.DimensionY AS DimensionY,
        p.Area AS PlotArea,
        p.GlobalX AS PlotGlobalX,
        p.GlobalY AS PlotGlobalY,
        p.GlobalZ AS PlotGlobalZ,
        p.PlotShape AS PlotShape,
        p.PlotDescription AS PlotDescription,
        p.DefaultDimensionUnits AS PlotDimensionUnits,
        p.DefaultCoordinateUnits AS PlotCoordinateUnits,
        p.DefaultAreaUnits AS PlotAreaUnits,
        p.DefaultDBHUnits AS PlotDefaultDBHUnits,
        p.DefaultHOMUnits AS PlotDefaultHOMUnits,
        c.CensusID AS CensusID,
        c.StartDate AS CensusStartDate,
        c.EndDate AS CensusEndDate,
        c.Description AS CensusDescription,
        c.PlotCensusNumber AS PlotCensusNumber,
        q.QuadratID AS QuadratID,
        q.QuadratName AS QuadratName,
        q.DimensionX AS QuadratDimensionX,
        q.DimensionY AS QuadratDimensionY,
        q.Area AS QuadratArea,
        q.StartX AS QuadratStartX,
        q.StartY AS QuadratStartY,
        q.QuadratShape AS QuadratShape,
        t.TreeID AS TreeID,
        t.TreeTag AS TreeTag,
        s.StemID AS StemID,
        s.StemTag AS StemTag,
        s.LocalX AS StemLocalX,
        s.LocalY AS StemLocalY,
        sp.SpeciesID AS SpeciesID,
        sp.SpeciesCode AS SpeciesCode,
        sp.SpeciesName AS SpeciesName,
        sp.SubspeciesName AS SubspeciesName,
        sp.SubspeciesAuthority AS SubspeciesAuthority,
        sp.IDLevel AS SpeciesIDLevel,
        g.GenusID AS GenusID,
        g.Genus AS Genus,
        g.GenusAuthority AS GenusAuthority,
        f.FamilyID AS FamilyID,
        f.Family AS Family,
        (SELECT GROUP_CONCAT(ca.Code SEPARATOR '; ')
            FROM cmattributes ca
            WHERE ca.CoreMeasurementID = cm.CoreMeasurementID) AS Attributes,
        cm.UserDefinedFields AS UserDefinedFields
    FROM coremeasurements cm
    LEFT JOIN stems s ON cm.StemID = s.StemID
    LEFT JOIN trees t ON s.TreeID = t.TreeID
    LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
    LEFT JOIN genus g ON sp.GenusID = g.GenusID
    LEFT JOIN family f ON g.FamilyID = f.FamilyID
    LEFT JOIN quadrats q ON s.QuadratID = q.QuadratID
    LEFT JOIN plots p ON q.PlotID = p.PlotID
    LEFT JOIN census c ON cm.CensusID = c.CensusID
    LEFT JOIN cmattributes ca ON ca.CoreMeasurementID = cm.CoreMeasurementID
    LEFT JOIN attributes a ON a.Code = ca.Code;
    SET foreign_key_checks = 1;
END;
