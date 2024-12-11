CREATE VIEW alltaxonomiesview AS
SELECT s.SpeciesID           AS SpeciesID,
       f.FamilyID            AS FamilyID,
       g.GenusID             AS GenusID,
       s.SpeciesCode         AS SpeciesCode,
       f.Family              AS Family,
       g.Genus               AS Genus,
       g.GenusAuthority      AS GenusAuthority,
       s.SpeciesName         AS SpeciesName,
       s.SubspeciesName      AS SubSpeciesName,
       s.IDLevel             AS SpeciesIDLevel,
       s.SpeciesAuthority    AS SpeciesAuthority,
       s.SubspeciesAuthority AS SubspeciesAuthority,
       s.ValidCode           AS ValidCode,
       s.FieldFamily         AS FieldFamily,
       s.Description         AS SpeciesDescription
FROM family f
         JOIN genus g ON f.FamilyID = g.FamilyID
         JOIN species s ON g.GenusID = s.GenusID;

CREATE VIEW stemtaxonomiesview AS
SELECT s.StemID               AS StemID,
       t.TreeID               AS TreeID,
       q.QuadratID            AS QuadratID,
       f.FamilyID             AS FamilyID,
       g.GenusID              AS GenusID,
       sp.SpeciesID           AS SpeciesID,
       q.QuadratName          AS QuadratName,
       s.StemTag              AS StemTag,
       t.TreeTag              AS TreeTag,
       sp.SpeciesCode         AS SpeciesCode,
       f.Family               AS Family,
       g.Genus                AS Genus,
       sp.SpeciesName         AS SpeciesName,
       sp.SubspeciesName      AS SubspeciesName,
       sp.ValidCode           AS ValidCode,
       g.GenusAuthority       AS GenusAuthority,
       sp.SpeciesAuthority    AS SpeciesAuthority,
       sp.SubspeciesAuthority AS SubspeciesAuthority,
       sp.IDLevel             AS SpeciesIDLevel,
       sp.FieldFamily         AS SpeciesFieldFamily
FROM stems s
         JOIN trees t ON s.TreeID = t.TreeID
         JOIN quadrats q ON s.QuadratID = q.QuadratID
         JOIN censusquadrat cq ON q.QuadratID = cq.QuadratID
         JOIN census c ON cq.CensusID = c.CensusID
         JOIN plots p ON c.PlotID = p.PlotID
         JOIN species sp ON t.SpeciesID = sp.SpeciesID
         JOIN genus g ON sp.GenusID = g.GenusID
         LEFT JOIN family f ON g.FamilyID = f.FamilyID;

CREATE VIEW measurementssummaryview AS
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
           p.DefaultCoordinateUnits                                  AS StemUnits,
           q.QuadratName                                       AS QuadratName,
           cm.MeasurementDate                                  AS MeasurementDate,
           cm.MeasuredDBH                                      AS MeasuredDBH,
           p.DefaultDBHUnits                                          AS DBHUnits,
           cm.MeasuredHOM                                      AS MeasuredHOM,
           p.DefaultHOMUnits                                          AS HOMUnits,
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
             LEFT JOIN census c ON cm.CensusID = c.CensusID
             LEFT JOIN plots p ON p.PlotID = c.PlotID;

CREATE VIEW viewfulltableview AS
SELECT
        cm.CoreMeasurementID AS CoreMeasurementID,
        cm.MeasurementDate AS MeasurementDate,
        cm.MeasuredDBH AS MeasuredDBH,
        p.DefaultDBHUnits AS DBHUnits,
        cm.MeasuredHOM AS MeasuredHOM,
        p.DefaultHOMUnits AS HOMUnits,
        cm.Description AS Description,
        cm.IsValidated AS IsValidated,
        p.PlotID AS PlotID,
        p.PlotName AS PlotName,
        p.LocationName AS LocationName,
        p.CountryName AS CountryName,
        p.DimensionX AS DimensionX,
        p.DimensionY AS DimensionY,
        p.DefaultDimensionUnits AS PlotDimensionUnits,
        p.Area AS PlotArea,
        p.DefaultAreaUnits AS PlotAreaUnits,
        p.GlobalX AS PlotGlobalX,
        p.GlobalY AS PlotGlobalY,
        p.GlobalZ AS PlotGlobalZ,
        p.DefaultCoordinateUnits AS PlotCoordinateUnits,
        p.PlotShape AS PlotShape,
        p.PlotDescription AS PlotDescription,
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
        pr.PersonnelID AS PersonnelID,
        pr.FirstName AS FirstName,
        pr.LastName AS LastName,
        r.RoleName AS PersonnelRoles,
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
        ca.Code AS AttributeCode,
        a.Description AS AttributeDescription,
        a.Status AS AttributeStatus
    FROM coremeasurements cm
    LEFT JOIN stems s ON cm.StemID = s.StemID
    LEFT JOIN trees t ON s.TreeID = t.TreeID
    LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
    LEFT JOIN genus g ON sp.GenusID = g.GenusID
    LEFT JOIN family f ON g.FamilyID = f.FamilyID
    LEFT JOIN plots p ON s.QuadratID = p.PlotID
    LEFT JOIN quadrats q ON s.QuadratID = q.QuadratID
    LEFT JOIN census c ON cm.CensusID = c.CensusID
    LEFT JOIN personnel pr ON pr.CensusID = cm.CensusID
    LEFT JOIN roles r ON pr.RoleID = r.RoleID
    LEFT JOIN cmattributes ca ON ca.CoreMeasurementID = cm.CoreMeasurementID
    LEFT JOIN attributes a ON a.Code = ca.Code;