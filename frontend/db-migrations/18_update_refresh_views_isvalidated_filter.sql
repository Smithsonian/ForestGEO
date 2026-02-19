-- Migration 18: Hide flagged measurements in refreshed views by default
-- Date: 2026-02-18
-- Purpose:
--   Apply `cm.IsValidated IS NOT FALSE` to RefreshMeasurementsSummary and RefreshViewFullTable.

DROP PROCEDURE IF EXISTS RefreshMeasurementsSummary;
DROP PROCEDURE IF EXISTS RefreshViewFullTable;

DELIMITER $$

CREATE
    DEFINER = azureroot@`%` PROCEDURE RefreshMeasurementsSummary()
BEGIN
    SET foreign_key_checks = 0;
    TRUNCATE measurementssummary;
    INSERT IGNORE INTO measurementssummary (CoreMeasurementID,
                                            StemGUID,
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
    SELECT cm.CoreMeasurementID                                 AS CoreMeasurementID,
           st.StemGUID                                          AS StemGUID,
           t.TreeID                                             AS TreeID,
           sp.SpeciesID                                         AS SpeciesID,
           q.QuadratID                                          AS QuadratID,
           COALESCE(q.PlotID, 0)                                AS PlotID,
           COALESCE(cm.CensusID, 0)                             AS CensusID,
           sp.SpeciesName                                       AS SpeciesName,
           sp.SubspeciesName                                    AS SubspeciesName,
           sp.SpeciesCode                                       AS SpeciesCode,
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
           (SELECT GROUP_CONCAT(DISTINCT a.Code SEPARATOR '; ')
            FROM cmattributes ca
                     LEFT JOIN attributes a ON a.Code = ca.Code
            WHERE ca.CoreMeasurementID = cm.CoreMeasurementID)  AS Attributes,
           cm.UserDefinedFields                                 AS UserDefinedFields,
           (SELECT GROUP_CONCAT(CONCAT(vp.ProcedureName, '->', vp.Description) SEPARATOR ';')
            FROM sitespecificvalidations vp
                     LEFT JOIN cmverrors cmv ON cmv.ValidationErrorID = vp.ValidationID
            WHERE cmv.CoreMeasurementID = cm.CoreMeasurementID) AS Errors
    FROM coremeasurements cm
             JOIN census c ON cm.CensusID = c.CensusID
             JOIN stems st ON cm.StemGUID = st.StemGUID AND st.CensusID = c.CensusID
             JOIN trees t ON t.CensusID = c.CensusID AND t.TreeID = st.TreeID
             JOIN species sp ON t.SpeciesID = sp.SpeciesID
             JOIN quadrats q ON q.QuadratID = st.QuadratID
    WHERE cm.IsValidated IS NOT FALSE;

    SET foreign_key_checks = 1;
END $$

CREATE
    DEFINER = azureroot@`%` PROCEDURE RefreshViewFullTable()
BEGIN
    SET foreign_key_checks = 0;
    TRUNCATE viewfulltable;

    INSERT IGNORE INTO viewfulltable (CoreMeasurementID,
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
                                      StemGUID,
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
           s.StemGUID                                          AS StemGUID,
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
             LEFT JOIN stems s ON cm.StemGUID = s.StemGUID
             LEFT JOIN trees t ON s.TreeID = t.TreeID
             LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
             LEFT JOIN genus g ON sp.GenusID = g.GenusID
             LEFT JOIN family f ON g.FamilyID = f.FamilyID
             LEFT JOIN quadrats q ON s.QuadratID = q.QuadratID
             LEFT JOIN plots p ON q.PlotID = p.PlotID
             LEFT JOIN census c ON cm.CensusID = c.CensusID
             LEFT JOIN cmattributes ca ON ca.CoreMeasurementID = cm.CoreMeasurementID
             LEFT JOIN attributes a ON a.Code = ca.Code
    WHERE cm.IsValidated IS NOT FALSE;

    SET foreign_key_checks = 1;
END $$

DELIMITER ;
