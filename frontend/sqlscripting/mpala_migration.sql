SET foreign_key_checks = 1;
INSERT INTO forestgeo_mpala.attributes (Code, Description, Status)
SELECT DISTINCT TSMCode, Description, Status
FROM ctfsweb_mpala.tsmattributes;

INSERT INTO forestgeo_mpala.reference (ReferenceID, PublicationTitle, FullReference, DateOfPublication, Citation)
SELECT ReferenceID, PublicationTitle, FullReference, DateofPublication, NULL
FROM ctfsweb_mpala.reference;

INSERT INTO forestgeo_mpala.family (FamilyID, Family, ReferenceID)
SELECT FamilyID, Family, ReferenceID
FROM ctfsweb_mpala.family;

INSERT INTO forestgeo_mpala.genus (GenusID, FamilyID, Genus, ReferenceID, Authority)
SELECT GenusID, FamilyID, Genus, ReferenceID, Authority
FROM ctfsweb_mpala.genus;

INSERT INTO forestgeo_mpala.species (SpeciesID, GenusID, SpeciesCode, CurrentTaxonFlag, ObsoleteTaxonFlag, SpeciesName, IDLevel, Authority, FieldFamily, Description, ReferenceID)
SELECT SpeciesID, GenusID, Mnemonic, CurrentTaxonFlag, ObsoleteTaxonFlag, SpeciesName, IDLEVEL, Authority, FieldFamily, Description, ReferenceID
FROM ctfsweb_mpala.species;

INSERT INTO forestgeo_mpala.subspecies (SubSpeciesID, SubSpeciesCode, SpeciesID, CurrentTaxonFlag, ObsoleteTaxonFlag, SubSpeciesName, Authority, InfraSpecificLevel)
SELECT SubSpeciesID, Mnemonic, SpeciesID, CurrentTaxonFlag, ObsoleteTaxonFlag, SubSpeciesName, Authority, InfraSpecificLevel
FROM ctfsweb_mpala.subspecies;

INSERT INTO forestgeo_mpala.currentobsolete (SpeciesID, ObsoleteSpeciesID, ChangeDate, ChangeCodeID, ChangeNote)
SELECT SpeciesID, ObsoleteSpeciesID, ChangeDate, ChangeCodeID, ChangeNote
FROM ctfsweb_mpala.currentobsolete;

INSERT INTO forestgeo_mpala.trees (TreeID, TreeTag, SpeciesID, SubSpeciesID)
SELECT TreeID, Tag, SpeciesID, SubSpeciesID
FROM ctfsweb_mpala.tree;

INSERT INTO forestgeo_mpala.personnel (PersonnelID, FirstName, LastName, Role)
SELECT p.PersonnelID, p.FirstName, p.LastName, GROUP_CONCAT(rr.Description SEPARATOR ', ')
FROM ctfsweb_mpala.personnel p
JOIN ctfsweb_mpala.personnelrole pr ON p.PersonnelID = pr.PersonnelID
JOIN ctfsweb_mpala.rolereference rr ON pr.RoleID = rr.RoleID
GROUP BY p.PersonnelID;

INSERT INTO forestgeo_mpala.plots (PlotID, PlotName, LocationName, CountryName, DimensionX, DimensionY, Area, GlobalX, GlobalY, GlobalZ, PlotX, PlotY, PlotZ, PlotShape, PlotDescription)
SELECT s.PlotID, s.PlotName, s.LocationName, c.CountryName, s.QDimX, s.QDimY, s.Area,
       co.GX, co.GY, co.GZ, co.PX, co.PY, co.PZ, s.ShapeOfSite, s.DescriptionOfSite
FROM ctfsweb_mpala.site s
JOIN ctfsweb_mpala.country c ON s.CountryID = c.CountryID
LEFT JOIN ctfsweb_mpala.coordinates co ON s.PlotID = co.PlotID
ON DUPLICATE KEY UPDATE
PlotName = VALUES(PlotName),
LocationName = VALUES(LocationName),
CountryName = VALUES(CountryName),
DimensionX = VALUES(DimensionX),
DimensionY = VALUES(DimensionY),
Area = VALUES(Area),
GlobalX = VALUES(GlobalX),
GlobalY = VALUES(GlobalY),
GlobalZ = VALUES(GlobalZ),
PlotX = VALUES(PlotX),
PlotY = VALUES(PlotY),
PlotZ = VALUES(PlotZ),
PlotShape = VALUES(PlotShape),
PlotDescription = VALUES(PlotDescription);

INSERT INTO forestgeo_mpala.census (PlotID, PlotCensusNumber, StartDate, EndDate, Description)
VALUES (1, 1, null, '2023-01-19', null);

INSERT INTO forestgeo_mpala.census (PlotID, PlotCensusNumber, StartDate, EndDate, Description)
VALUES (1, 2, '2018-03-14', '2019-01-31', null);


INSERT INTO forestgeo_mpala.quadrats (QuadratID, PlotID, CensusID, QuadratName, DimensionX, DimensionY, Area, QuadratShape)
SELECT q.QuadratID, q.PlotID, cq.CensusID, q.QuadratName, 20, 20, q.Area,
       CASE WHEN q.IsStandardShape = 'Y' THEN 'standard' ELSE 'nonstandard' END
FROM ctfsweb_mpala.quadrat q
JOIN ctfsweb_mpala.censusquadrat cq ON q.QuadratID = cq.QuadratID
ON DUPLICATE KEY UPDATE
    PlotID = VALUES(PlotID),
    CensusID = VALUES(CensusID),
    QuadratName = VALUES(QuadratName),
    DimensionX = VALUES(DimensionX),
    DimensionY = VALUES(DimensionY),
    Area = VALUES(Area),
    QuadratShape = VALUES(QuadratShape);

INSERT INTO forestgeo_mpala.speciesinventory (SpeciesInventoryID, CensusID, PlotID, SpeciesID, SubSpeciesID)
SELECT SpeciesInvID, CensusID, PlotID, SpeciesID, SubSpeciesID
FROM ctfsweb_mpala.speciesinventory;

INSERT INTO forestgeo_mpala.stems (StemID, TreeID, QuadratID, StemNumber, StemTag, StemPlotX, StemPlotY, StemQuadX, StemQuadY, Moved, StemDescription)
SELECT
    s.StemID,
    s.TreeID,
    s.QuadratID,
    s.StemNumber,
    s.StemTag,
    s.PX,
    s.PY,
    s.QX,
    s.QY,
    IF(s.Moved = 'Y', b'1', b'0'),
    s.StemDescription
FROM ctfsweb_mpala.stem s;

INSERT INTO forestgeo_mpala.coremeasurements (CoreMeasurementID, CensusID, PlotID, QuadratID, TreeID, StemID, PersonnelID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description)
SELECT
    d.DBHID,
    d.CensusID,
    q.PlotID,
    s.QuadratID,
    s.TreeID,
    s.StemID,
    NULL,
    TRUE,
    d.ExactDate,
    d.DBH,
    CAST(d.HOM AS DECIMAL(10,2)),
    d.Comments
FROM
    ctfsweb_mpala.dbh d
JOIN
    ctfsweb_mpala.stem s ON d.StemID = s.StemID
JOIN
    ctfsweb_mpala.quadrat q ON s.QuadratID = q.QuadratID;

INSERT INTO forestgeo_mpala.cmattributes (CMAID, CoreMeasurementID, Code)
SELECT dba.DBHAttID, dba.DBHID, ta.TSMCode
FROM ctfsweb_mpala.dbhattributes dba
JOIN ctfsweb_mpala.tsmattributes ta ON dba.TSMID = ta.TSMID;