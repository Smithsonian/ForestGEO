drop procedure if exists RefreshMeasurementsSummary;
drop procedure if exists RefreshViewFullTable;

CREATE
    DEFINER = azureroot@`%`
    PROCEDURE RefreshMeasurementsSummary()
BEGIN
    SET foreign_key_checks = 0;
    TRUNCATE measurementssummary;
    INSERT INTO measurementssummary (CoreMeasurementID,
                                     StemID,
                                     TreeID,
                                     SpeciesID,
                                     QuadratID,
                                     PlotID,
                                     CensusID,
                                     SpeciesName,
                                     SubspeciesName,
                                     SpeciesCode,
                                     TreeTag,
                                     StemTag,
                                     StemLocalX,
                                     StemLocalY,
                                     QuadratName,
                                     MeasurementDate,
                                     MeasuredDBH,
                                     MeasuredHOM,
                                     IsValidated,
                                     Description,
                                     Attributes,
                                     UserDefinedFields,
                                     Errors)
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
             LEFT JOIN plots p ON p.PlotID = c.PlotID
    ON DUPLICATE KEY UPDATE SpeciesName       = VALUES(SpeciesName),
                            SubspeciesName    = VALUES(SubspeciesName),
                            SpeciesCode       = VALUES(SpeciesCode),
                            TreeTag           = VALUES(TreeTag),
                            StemTag           = VALUES(StemTag),
                            StemLocalX        = VALUES(StemLocalX),
                            StemLocalY        = VALUES(StemLocalY),
                            QuadratName       = VALUES(QuadratName),
                            MeasurementDate   = VALUES(MeasurementDate),
                            MeasuredDBH       = VALUES(MeasuredDBH),
                            MeasuredHOM       = VALUES(MeasuredHOM),
                            IsValidated       = VALUES(IsValidated),
                            Description       = VALUES(Description),
                            Attributes        = VALUES(Attributes),
                            UserDefinedFields = VALUES(UserDefinedFields),
                            Errors            = VALUES(Errors);

    -- Re-enable foreign key checks
    SET foreign_key_checks = 1;
END;

CREATE
    DEFINER = azureroot@`%`
    PROCEDURE RefreshViewFullTable()
BEGIN
    -- Disable foreign key checks temporarily
    SET foreign_key_checks = 0;
    TRUNCATE viewfulltable;
    -- Insert data with ON DUPLICATE KEY UPDATE to resolve conflicts
    INSERT INTO viewfulltable (CoreMeasurementID,
                               MeasurementDate,
                               MeasuredDBH,
                               MeasuredHOM,
                               Description,
                               IsValidated,
                               PlotID,
                               PlotName,
                               LocationName,
                               CountryName,
                               DimensionX,
                               DimensionY,
                               PlotArea,
                               PlotGlobalX,
                               PlotGlobalY,
                               PlotGlobalZ,
                               PlotShape,
                               PlotDescription,
                               PlotDefaultDimensionUnits,
                               PlotDefaultCoordinateUnits,
                               PlotDefaultAreaUnits,
                               PlotDefaultDBHUnits,
                               PlotDefaultHOMUnits,
                               CensusID,
                               CensusStartDate,
                               CensusEndDate,
                               CensusDescription,
                               PlotCensusNumber,
                               QuadratID,
                               QuadratName,
                               QuadratDimensionX,
                               QuadratDimensionY,
                               QuadratArea,
                               QuadratStartX,
                               QuadratStartY,
                               QuadratShape,
                               TreeID,
                               TreeTag,
                               StemID,
                               StemTag,
                               StemLocalX,
                               StemLocalY,
                               SpeciesID,
                               SpeciesCode,
                               SpeciesName,
                               SubspeciesName,
                               SubspeciesAuthority,
                               SpeciesIDLevel,
                               GenusID,
                               Genus,
                               GenusAuthority,
                               FamilyID,
                               Family,
                               Attributes,
                               UserDefinedFields)
    SELECT cm.CoreMeasurementID                                AS CoreMeasurementID,
           cm.MeasurementDate                                  AS MeasurementDate,
           cm.MeasuredDBH                                      AS MeasuredDBH,
           cm.MeasuredHOM                                      AS MeasuredHOM,
           cm.Description                                      AS Description,
           cm.IsValidated                                      AS IsValidated,
           p.PlotID                                            AS PlotID,
           p.PlotName                                          AS PlotName,
           p.LocationName                                      AS LocationName,
           p.CountryName                                       AS CountryName,
           p.DimensionX                                        AS DimensionX,
           p.DimensionY                                        AS DimensionY,
           p.Area                                              AS PlotArea,
           p.GlobalX                                           AS PlotGlobalX,
           p.GlobalY                                           AS PlotGlobalY,
           p.GlobalZ                                           AS PlotGlobalZ,
           p.PlotShape                                         AS PlotShape,
           p.PlotDescription                                   AS PlotDescription,
           p.DefaultDimensionUnits                             AS PlotDimensionUnits,
           p.DefaultCoordinateUnits                            AS PlotCoordinateUnits,
           p.DefaultAreaUnits                                  AS PlotAreaUnits,
           p.DefaultDBHUnits                                   AS PlotDefaultDBHUnits,
           p.DefaultHOMUnits                                   AS PlotDefaultHOMUnits,
           c.CensusID                                          AS CensusID,
           c.StartDate                                         AS CensusStartDate,
           c.EndDate                                           AS CensusEndDate,
           c.Description                                       AS CensusDescription,
           c.PlotCensusNumber                                  AS PlotCensusNumber,
           q.QuadratID                                         AS QuadratID,
           q.QuadratName                                       AS QuadratName,
           q.DimensionX                                        AS QuadratDimensionX,
           q.DimensionY                                        AS QuadratDimensionY,
           q.Area                                              AS QuadratArea,
           q.StartX                                            AS QuadratStartX,
           q.StartY                                            AS QuadratStartY,
           q.QuadratShape                                      AS QuadratShape,
           t.TreeID                                            AS TreeID,
           t.TreeTag                                           AS TreeTag,
           s.StemID                                            AS StemID,
           s.StemTag                                           AS StemTag,
           s.LocalX                                            AS StemLocalX,
           s.LocalY                                            AS StemLocalY,
           sp.SpeciesID                                        AS SpeciesID,
           sp.SpeciesCode                                      AS SpeciesCode,
           sp.SpeciesName                                      AS SpeciesName,
           sp.SubspeciesName                                   AS SubspeciesName,
           sp.SubspeciesAuthority                              AS SubspeciesAuthority,
           sp.IDLevel                                          AS SpeciesIDLevel,
           g.GenusID                                           AS GenusID,
           g.Genus                                             AS Genus,
           g.GenusAuthority                                    AS GenusAuthority,
           f.FamilyID                                          AS FamilyID,
           f.Family                                            AS Family,
           (SELECT GROUP_CONCAT(ca.Code SEPARATOR '; ')
            FROM cmattributes ca
            WHERE ca.CoreMeasurementID = cm.CoreMeasurementID) AS Attributes,
           cm.UserDefinedFields                                AS UserDefinedFields
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
             LEFT JOIN attributes a ON a.Code = ca.Code
    ON DUPLICATE KEY UPDATE MeasurementDate            = VALUES(MeasurementDate),
                            MeasuredDBH                = VALUES(MeasuredDBH),
                            MeasuredHOM                = VALUES(MeasuredHOM),
                            Description                = VALUES(Description),
                            IsValidated                = VALUES(IsValidated),
                            PlotID                     = VALUES(PlotID),
                            PlotName                   = VALUES(PlotName),
                            LocationName               = VALUES(LocationName),
                            CountryName                = VALUES(CountryName),
                            DimensionX                 = VALUES(DimensionX),
                            DimensionY                 = VALUES(DimensionY),
                            PlotArea                   = VALUES(PlotArea),
                            PlotGlobalX                = VALUES(PlotGlobalX),
                            PlotGlobalY                = VALUES(PlotGlobalY),
                            PlotGlobalZ                = VALUES(PlotGlobalZ),
                            PlotShape                  = VALUES(PlotShape),
                            PlotDescription            = VALUES(PlotDescription),
                            PlotDefaultDimensionUnits  = VALUES(PlotDefaultDimensionUnits),
                            PlotDefaultCoordinateUnits = VALUES(PlotDefaultCoordinateUnits),
                            PlotDefaultAreaUnits       = VALUES(PlotDefaultAreaUnits),
                            PlotDefaultDBHUnits        = VALUES(PlotDefaultDBHUnits),
                            PlotDefaultHOMUnits        = VALUES(PlotDefaultHOMUnits),
                            CensusID                   = VALUES(CensusID),
                            CensusStartDate            = VALUES(CensusStartDate),
                            CensusEndDate              = VALUES(CensusEndDate),
                            CensusDescription          = VALUES(CensusDescription),
                            PlotCensusNumber           = VALUES(PlotCensusNumber),
                            QuadratID                  = VALUES(QuadratID),
                            QuadratName                = VALUES(QuadratName),
                            QuadratDimensionX          = VALUES(QuadratDimensionX),
                            QuadratDimensionY          = VALUES(QuadratDimensionY),
                            QuadratArea                = VALUES(QuadratArea),
                            QuadratStartX              = VALUES(QuadratStartX),
                            QuadratStartY              = VALUES(QuadratStartY),
                            QuadratShape               = VALUES(QuadratShape),
                            TreeID                     = VALUES(TreeID),
                            TreeTag                    = VALUES(TreeTag),
                            StemID                     = VALUES(StemID),
                            StemTag                    = VALUES(StemTag),
                            StemLocalX                 = VALUES(StemLocalX),
                            StemLocalY                 = VALUES(StemLocalY),
                            SpeciesID                  = VALUES(SpeciesID),
                            SpeciesCode                = VALUES(SpeciesCode),
                            SpeciesName                = VALUES(SpeciesName),
                            SubspeciesName             = VALUES(SubspeciesName),
                            SubspeciesAuthority        = VALUES(SubspeciesAuthority),
                            SpeciesIDLevel             = VALUES(SpeciesIDLevel),
                            GenusID                    = VALUES(GenusID),
                            Genus                      = VALUES(Genus),
                            GenusAuthority             = VALUES(GenusAuthority),
                            FamilyID                   = VALUES(FamilyID),
                            Family                     = VALUES(Family),
                            Attributes                 = VALUES(Attributes),
                            UserDefinedFields          = VALUES(UserDefinedFields);

    -- Re-enable foreign key checks
    SET foreign_key_checks = 1;
END;
