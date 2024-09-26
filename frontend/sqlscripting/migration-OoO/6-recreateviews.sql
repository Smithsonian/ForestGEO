CREATE VIEW alltaxonomiesview AS
SELECT s.SpeciesID           AS SpeciesID,
       f.FamilyID            AS FamilyID,
       g.GenusID             AS GenusID,
       r.ReferenceID         AS ReferenceID,
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
       s.Description         AS SpeciesDescription,
       r.PublicationTitle    AS PublicationTitle,
       r.FullReference       AS FullReference,
       r.DateOfPublication   AS DateOfPublication,
       r.Citation            AS Citation
FROM family f
         JOIN genus g ON f.FamilyID = g.FamilyID
         JOIN species s ON g.GenusID = s.GenusID
         LEFT JOIN reference r ON s.ReferenceID = r.ReferenceID;


CREATE VIEW measurementssummaryview AS
SELECT cm.CoreMeasurementID                                        AS CoreMeasurementID,
       p.PlotID                                                    AS PlotID,
       cm.CensusID                                                 AS CensusID,
       q.QuadratID                                                 AS QuadratID,
       s.SpeciesID                                                 AS SpeciesID,
       t.TreeID                                                    AS TreeID,
       st.StemID                                                   AS StemID,
       qp.PersonnelID                                              AS PersonnelID,
       p.PlotName                                                  AS PlotName,
       q.QuadratName                                               AS QuadratName,
       s.SpeciesCode                                               AS SpeciesCode,
       t.TreeTag                                                   AS TreeTag,
       st.StemTag                                                  AS StemTag,
       st.LocalX                                                   AS StemLocalX,
       st.LocalY                                                   AS StemLocalY,
       st.CoordinateUnits                                          AS StemUnits,
       COALESCE(CONCAT(pe.FirstName, ' ', pe.LastName), 'Unknown') AS PersonnelName,
       cm.MeasurementDate                                          AS MeasurementDate,
       cm.MeasuredDBH                                              AS MeasuredDBH,
       cm.DBHUnit                                                  AS DBHUnits,
       cm.MeasuredHOM                                              AS MeasuredHOM,
       cm.HOMUnit                                                  AS HOMUnits,
       cm.IsValidated                                              AS IsValidated,
       cm.Description                                              AS Description,
       (SELECT GROUP_CONCAT(ca.Code SEPARATOR '; ')
        FROM cmattributes ca
        WHERE ca.CoreMeasurementID = cm.CoreMeasurementID)         AS Attributes
FROM coremeasurements cm
         LEFT JOIN stems st ON cm.StemID = st.StemID
         LEFT JOIN trees t ON st.TreeID = t.TreeID
         LEFT JOIN species s ON t.SpeciesID = s.SpeciesID
         LEFT JOIN genus g ON s.GenusID = g.GenusID
         LEFT JOIN family f ON g.FamilyID = f.FamilyID
         LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
         LEFT JOIN plots p ON q.PlotID = p.PlotID
         LEFT JOIN census c ON cm.CensusID = c.CensusID
         LEFT JOIN quadratpersonnel qp ON q.QuadratID = qp.QuadratID
         LEFT JOIN personnel pe ON qp.PersonnelID = pe.PersonnelID
GROUP BY cm.CoreMeasurementID, p.PlotID, cm.CensusID, q.QuadratID, s.SpeciesID, t.TreeID, st.StemID, qp.PersonnelID,
         p.PlotName, q.QuadratName, s.SpeciesCode, t.TreeTag, st.StemTag, st.LocalX, st.LocalY, st.CoordinateUnits,
         pe.FirstName, pe.LastName, cm.MeasurementDate, cm.MeasuredDBH, cm.DBHUnit, cm.MeasuredHOM, cm.HOMUnit,
         cm.IsValidated, cm.Description;


CREATE VIEW stemtaxonomiesview AS
SELECT s.StemID               AS StemID,
       t.TreeID               AS TreeID,
       q.QuadratID            AS QuadratID,
       c.CensusID             AS CensusID,
       p.PlotID               AS PlotID,
       f.FamilyID             AS FamilyID,
       g.GenusID              AS GenusID,
       sp.SpeciesID           AS SpeciesID,
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
         JOIN census c ON q.CensusID = c.CensusID
         JOIN plots p ON c.PlotID = p.PlotID
         JOIN species sp ON t.SpeciesID = sp.SpeciesID
         JOIN genus g ON sp.GenusID = g.GenusID
         LEFT JOIN family f ON g.FamilyID = f.FamilyID;


CREATE VIEW viewfulltableview AS
SELECT cm.CoreMeasurementID   AS CoreMeasurementID,
       cm.MeasurementDate     AS MeasurementDate,
       cm.MeasuredDBH         AS MeasuredDBH,
       cm.DBHUnit             AS DBHUnits,
       cm.MeasuredHOM         AS MeasuredHOM,
       cm.HOMUnit             AS HOMUnits,
       cm.Description         AS Description,
       cm.IsValidated         AS IsValidated,
       p.PlotID               AS PlotID,
       p.PlotName             AS PlotName,
       p.LocationName         AS LocationName,
       p.CountryName          AS CountryName,
       p.DimensionX           AS DimensionX,
       p.DimensionY           AS DimensionY,
       p.Area                 AS PlotArea,
       p.GlobalX              AS GlobalX,
       p.GlobalY              AS GlobalY,
       p.GlobalZ              AS GlobalZ,
       p.DimensionUnits       AS PlotUnit,
       p.PlotShape            AS PlotShape,
       p.PlotDescription      AS PlotDescription,
       c.CensusID             AS CensusID,
       c.StartDate            AS CensusStartDate,
       c.EndDate              AS CensusEndDate,
       c.Description          AS CensusDescription,
       c.PlotCensusNumber     AS PlotCensusNumber,
       q.QuadratID            AS QuadratID,
       q.QuadratName          AS QuadratName,
       q.DimensionX           AS QuadratDimensionX,
       q.DimensionY           AS QuadratDimensionY,
       q.Area                 AS QuadratArea,
       q.QuadratShape         AS QuadratShape,
       q.DimensionUnits       AS QuadratUnit,
       sq.SubquadratID        AS SubquadratID,
       sq.SubquadratName      AS SubquadratName,
       sq.DimensionX          AS SubquadratDimensionX,
       sq.DimensionY          AS SubquadratDimensionY,
       sq.QX                  AS QX,
       sq.QY                  AS QY,
       sq.CoordinateUnits     AS SubquadratUnit,
       t.TreeID               AS TreeID,
       t.TreeTag              AS TreeTag,
       s.StemID               AS StemID,
       s.StemTag              AS StemTag,
       s.LocalX               AS StemLocalX,
       s.LocalY               AS StemLocalY,
       s.CoordinateUnits      AS StemUnits,
       per.PersonnelID        AS PersonnelID,
       per.FirstName          AS FirstName,
       per.LastName           AS LastName,
       r.RoleName             AS PersonnelRoles,
       sp.SpeciesID           AS SpeciesID,
       sp.SpeciesCode         AS SpeciesCode,
       sp.SpeciesName         AS SpeciesName,
       sp.SubspeciesName      AS SubspeciesName,
       sp.SubspeciesAuthority AS SubspeciesAuthority,
       sp.IDLevel             AS SpeciesIDLevel,
       g.GenusID              AS GenusID,
       g.Genus                AS Genus,
       g.GenusAuthority       AS GenusAuthority,
       fam.FamilyID           AS FamilyID,
       fam.Family             AS Family,
       attr.Code              AS AttributeCode,
       attr.Description       AS AttributeDescription,
       attr.Status            AS AttributeStatus
FROM coremeasurements cm
         LEFT JOIN stems s ON cm.StemID = s.StemID
         LEFT JOIN trees t ON s.TreeID = t.TreeID
         LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
         LEFT JOIN genus g ON sp.GenusID = g.GenusID
         LEFT JOIN family fam ON g.FamilyID = fam.FamilyID
         LEFT JOIN specieslimits sl ON sp.SpeciesCode = sl.SpeciesCode
         LEFT JOIN quadrats q ON s.QuadratID = q.QuadratID
         LEFT JOIN quadratpersonnel qp ON q.QuadratID = qp.QuadratID
         LEFT JOIN personnel per ON qp.PersonnelID = per.PersonnelID
         LEFT JOIN plots p ON q.PlotID = p.PlotID
         LEFT JOIN subquadrats sq ON q.QuadratID = sq.QuadratID
         LEFT JOIN census c ON cm.CensusID = c.CensusID
         LEFT JOIN roles r ON per.RoleID = r.RoleID
         LEFT JOIN attributes attr ON cm.CoreMeasurementID = attr.Code
         LEFT JOIN cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID AND attr.Code = cma.Code;