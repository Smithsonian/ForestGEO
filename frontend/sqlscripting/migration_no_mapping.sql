SET foreign_key_checks = 0;
truncate attributes;
truncate census;
truncate cmattributes;
truncate cmverrors;
truncate coremeasurements;
truncate family;
truncate genus;
truncate personnel;
truncate plots;
truncate quadratpersonnel;
truncate quadrats;
truncate reference;
truncate roles;
truncate species;
truncate specieslimits;
truncate specimens;
truncate stems;
truncate subquadrats;
truncate unifiedchangelog;
truncate validationchangelog;

-- Insert into plots with ON DUPLICATE KEY UPDATE
INSERT INTO plots (PlotID, PlotName, LocationName, CountryName, DimensionX, DimensionY, DimensionUnits, Area, AreaUnits,
                   GlobalX, GlobalY, GlobalZ, CoordinateUnits, PlotShape, PlotDescription)
SELECT s.PlotID,
       LEFT(s.PlotName, 65535),
       LEFT(s.LocationName, 65535),
       c.CountryName,
       s.QDimX,
       s.QDimY,
       IF(s.PUOM IN ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'), s.PUOM, 'm'),
       s.Area,
       'm2',
       co.GX,
       co.GY,
       co.GZ,
       IF(s.GUOM IN ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'), s.GUOM, 'm'),
       s.ShapeOfSite,
       LEFT(s.DescriptionOfSite, 65535)
FROM stable_panama.Site s
         LEFT JOIN stable_panama.Country c ON s.CountryID = c.CountryID
         LEFT JOIN stable_panama.Coordinates co ON s.PlotID = co.PlotID
GROUP BY s.PlotID, s.PlotName, s.LocationName, c.CountryName, s.QDimX, s.QDimY, s.PUOM, s.Area, s.GUOM, co.GX, co.GY,
         co.GZ, s.ShapeOfSite, s.DescriptionOfSite
ON DUPLICATE KEY UPDATE PlotName        = IF(VALUES(PlotName) != '', VALUES(PlotName), plots.PlotName),
                        LocationName    = IF(VALUES(LocationName) != '', VALUES(LocationName), plots.LocationName),
                        CountryName     = IF(VALUES(CountryName) != '', VALUES(CountryName), plots.CountryName),
                        DimensionX      = VALUES(DimensionX),
                        DimensionY      = VALUES(DimensionY),
                        DimensionUnits  = VALUES(DimensionUnits),
                        Area            = VALUES(Area),
                        AreaUnits       = VALUES(AreaUnits),
                        GlobalX         = VALUES(GlobalX),
                        GlobalY         = VALUES(GlobalY),
                        GlobalZ         = VALUES(GlobalZ),
                        CoordinateUnits = VALUES(CoordinateUnits),
                        PlotShape       = VALUES(PlotShape),
                        PlotDescription = IF(VALUES(PlotDescription) != '', VALUES(PlotDescription),
                                             plots.PlotDescription);

-- Insert into reference with ON DUPLICATE KEY UPDATE and handling '0000-00-00' dates
INSERT INTO reference (ReferenceID, PublicationTitle, FullReference, DateOfPublication, Citation)
SELECT r.ReferenceID,
       r.PublicationTitle,
       r.FullReference,
       IF(CAST(r.DateofPublication AS CHAR) = '0000-00-00', NULL, r.DateofPublication) AS DateOfPublication,
       NULL
FROM stable_panama.reference r
ON DUPLICATE KEY UPDATE PublicationTitle            = IF(VALUES(PublicationTitle) != '', VALUES(PublicationTitle),
                                                         reference.PublicationTitle),
                        FullReference               = IF(VALUES(FullReference) != '', VALUES(FullReference),
                                                         reference.FullReference),
                        reference.DateOfPublication = VALUES(DateOfPublication);

-- Insert into family with ON DUPLICATE KEY UPDATE
INSERT INTO family (FamilyID, Family, ReferenceID)
SELECT f.FamilyID, f.Family, f.ReferenceID
FROM stable_panama.family f
ON DUPLICATE KEY UPDATE Family      = IF(VALUES(Family) != '', VALUES(Family), family.Family),
                        ReferenceID = VALUES(ReferenceID);

-- Insert into genus with ON DUPLICATE KEY UPDATE
INSERT INTO genus (GenusID, FamilyID, Genus, ReferenceID, GenusAuthority)
SELECT g.GenusID, g.FamilyID, g.Genus, g.ReferenceID, g.Authority
FROM stable_panama.genus g
ON DUPLICATE KEY UPDATE FamilyID       = VALUES(FamilyID),
                        Genus          = IF(VALUES(Genus) != '', VALUES(Genus), genus.Genus),
                        ReferenceID    = VALUES(ReferenceID),
                        GenusAuthority = IF(VALUES(GenusAuthority) != '', VALUES(GenusAuthority), genus.GenusAuthority);

-- Insert into species with ON DUPLICATE KEY UPDATE
INSERT INTO species (SpeciesID, GenusID, SpeciesCode, SpeciesName, SubspeciesName, IDLevel, SpeciesAuthority,
                     SubspeciesAuthority, FieldFamily, Description, ValidCode, ReferenceID)
SELECT sp.SpeciesID,
       sp.GenusID,
       sp.Mnemonic,
       sp.SpeciesName,
       MIN(subs.SubSpeciesName),
       sp.IDLevel,
       sp.Authority,
       MIN(subs.Authority),
       sp.FieldFamily,
       LEFT(sp.Description, 65535),
       NULL,
       sp.ReferenceID
FROM stable_panama.species sp
         LEFT JOIN stable_panama.subspecies subs ON sp.SpeciesID = subs.SpeciesID
         LEFT JOIN stable_panama.reference ref ON sp.ReferenceID = ref.ReferenceID
GROUP BY sp.SpeciesID, sp.GenusID, sp.Mnemonic, sp.IDLevel, sp.Authority, sp.FieldFamily, sp.Description, sp.ReferenceID
ON DUPLICATE KEY UPDATE GenusID             = VALUES(GenusID),
                        SpeciesCode         = VALUES(SpeciesCode),
                        SpeciesName         = VALUES(SpeciesName),
                        SubspeciesName      = IF(VALUES(SubspeciesName) != '', VALUES(SubspeciesName),
                                                 species.SubspeciesName),
                        IDLevel             = VALUES(IDLevel),
                        SpeciesAuthority    = IF(VALUES(SpeciesAuthority) != '', VALUES(SpeciesAuthority),
                                                 species.SpeciesAuthority),
                        SubspeciesAuthority = IF(VALUES(SubspeciesAuthority) != '', VALUES(SubspeciesAuthority),
                                                 species.SubspeciesAuthority),
                        FieldFamily         = VALUES(FieldFamily),
                        Description         = IF(VALUES(Description) != '', VALUES(Description), species.Description),
                        ValidCode           = VALUES(ValidCode),
                        ReferenceID         = VALUES(ReferenceID);

-- First, update the census table for any invalid StartDate entries
UPDATE stable_panama.census
SET StartDate = NULL
WHERE CAST(StartDate AS CHAR(10)) = '0000-00-00';

-- Insert into census with ON DUPLICATE KEY UPDATE, using UNION between census and censusbackup
INSERT INTO census (CensusID, PlotID, StartDate, EndDate, Description, PlotCensusNumber)
SELECT
    c.CensusID,
    c.PlotID,
    COALESCE(MIN(d.ExactDate), c.StartDate) AS StartDate,
    COALESCE(MAX(d.ExactDate), c.EndDate) AS EndDate,
    LEFT(c.Description, 65535) AS Description,
    c.PlotCensusNumber
FROM (
    -- Combine census and censusbackup using UNION
    SELECT
        CensusID, PlotID, StartDate, EndDate, Description, PlotCensusNumber
    FROM stable_panama.census
) c
LEFT JOIN stable_panama.dbh d ON c.CensusID = d.CensusID
GROUP BY
    c.CensusID,
    c.PlotID,
    c.StartDate,
    c.EndDate,
    c.Description,
    c.PlotCensusNumber
ON DUPLICATE KEY UPDATE
    PlotID           = VALUES(PlotID),
    StartDate        = VALUES(StartDate),
    EndDate          = VALUES(EndDate),
    Description      = IF(VALUES(Description) != '', VALUES(Description), census.Description),
    PlotCensusNumber = VALUES(PlotCensusNumber);

-- Insert into roles table
INSERT INTO roles (RoleID, RoleName, RoleDescription)
SELECT RoleID, Description, NULL
FROM stable_panama.rolereference
ON DUPLICATE KEY UPDATE RoleName        = VALUES(RoleName),
                        RoleDescription = VALUES(RoleDescription);

-- Insert into personnel, ensuring each personnel is re-added for each CensusID with new PersonnelID
-- Step 1: Create a temporary table to hold the intermediate results
CREATE TEMPORARY TABLE tmp_personnel
SELECT
    c.CensusID,
    p.FirstName,
    p.LastName,
    pr.RoleID
FROM
    stable_panama.personnel p
CROSS JOIN
    stable_panama.census c
JOIN
    stable_panama.personnelrole pr ON p.PersonnelID = pr.PersonnelID;

-- Step 2: Insert into personnel from the temporary table, handling duplicates
INSERT INTO personnel (CensusID, FirstName, LastName, RoleID)
SELECT
    CensusID,
    FirstName,
    LastName,
    RoleID
FROM
    tmp_personnel
ON DUPLICATE KEY UPDATE
    RoleID = VALUES(RoleID);

-- Step 3: Drop the temporary table
DROP TEMPORARY TABLE tmp_personnel;

-- Insert into censusquadrat with ON DUPLICATE KEY UPDATE
INSERT INTO censusquadrat (CensusID, QuadratID)
SELECT CensusID, QuadratID
FROM stable_panama.censusquadrat
ON DUPLICATE KEY UPDATE CensusID = VALUES(CensusID),
                        QuadratID = VALUES (QuadratID);

-- Insert into quadrats with ON DUPLICATE KEY UPDATE
INSERT INTO quadrats (QuadratID, PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, DimensionUnits,
                      Area, AreaUnits, QuadratShape, CoordinateUnits)
SELECT q.QuadratID,
       q.PlotID,
       LEFT(q.QuadratName, 65535),
       MIN(co.PX),
       MIN(co.PY),
       s.QDimX,
       s.QDimY,
       IF(s.QUOM IN ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'), s.QUOM, 'm'),
       q.Area,
       IF(s.QUOM IN ('km2', 'hm2', 'dam2', 'm2', 'dm2', 'cm2', 'mm2'), s.QUOM, 'm2'),
       IF(q.IsStandardShape = 'Y', 'standard', 'not standard'),
       IF(s.GUOM IN ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'), s.GUOM, 'm')
FROM stable_panama.quadrat q
         LEFT JOIN stable_panama.censusquadrat cq ON q.QuadratID = cq.QuadratID
         LEFT JOIN stable_panama.Coordinates co ON q.QuadratID = co.QuadratID
         LEFT JOIN stable_panama.Site s ON q.PlotID = s.PlotID
GROUP BY q.QuadratID, q.PlotID, q.QuadratName, s.QDimX, s.QDimY, s.QUOM, q.Area, q.IsStandardShape, s.GUOM
ON DUPLICATE KEY UPDATE PlotID          = VALUES(PlotID),
                        QuadratName     = IF(VALUES(QuadratName) != '', VALUES(QuadratName), quadrats.QuadratName),
                        StartX          = VALUES(StartX),
                        StartY          = VALUES(StartY),
                        DimensionX      = VALUES(DimensionX),
                        DimensionY      = VALUES(DimensionY),
                        DimensionUnits  = VALUES(DimensionUnits),
                        Area            = VALUES(Area),
                        AreaUnits       = VALUES(AreaUnits),
                        QuadratShape    = VALUES(QuadratShape),
                        CoordinateUnits = VALUES(CoordinateUnits);

-- Insert into trees with ON DUPLICATE KEY UPDATE
INSERT INTO trees (TreeID, TreeTag, SpeciesID)
SELECT t.TreeID, t.Tag, t.SpeciesID
FROM stable_panama.tree t
ON DUPLICATE KEY UPDATE TreeTag   = IF(VALUES(TreeTag) != '', VALUES(TreeTag), trees.TreeTag),
                        SpeciesID = VALUES(SpeciesID);

-- Insert into stems with ON DUPLICATE KEY UPDATE
INSERT INTO stems (StemID, TreeID, QuadratID, StemNumber, StemTag, LocalX, LocalY, CoordinateUnits, Moved,
                   StemDescription)
SELECT s.StemID,
       s.TreeID,
       s.QuadratID,
       s.StemNumber,
       s.StemTag,
       MIN(s.QX),
       MIN(s.QY),
       IF(si.QUOM IN ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'), si.QUOM, 'm') AS CoordinateUnits,
       IF(s.Moved = 'Y', 1, 0)                                                 AS Moved,
       LEFT(s.StemDescription, 65535)
FROM stable_panama.stem s
         LEFT JOIN stable_panama.quadrat q ON q.QuadratID = s.QuadratID
         LEFT JOIN stable_panama.Site si ON q.PlotID = si.PlotID
GROUP BY s.StemID, s.TreeID, s.QuadratID, s.StemNumber, s.StemTag, s.Moved, s.StemDescription, si.QUOM
ON DUPLICATE KEY UPDATE TreeID          = VALUES(TreeID),
                        QuadratID       = VALUES(QuadratID),
                        StemNumber      = VALUES(StemNumber),
                        StemTag         = IF(VALUES(StemTag) != '', VALUES(StemTag), stems.StemTag),
                        LocalX          = VALUES(LocalX),
                        LocalY          = VALUES(LocalY),
                        CoordinateUnits = VALUES(CoordinateUnits),
                        Moved           = VALUES(Moved),
                        StemDescription = IF(VALUES(StemDescription) != '', VALUES(StemDescription),
                                             stems.StemDescription);

-- Insert into coremeasurements with ON DUPLICATE KEY UPDATE
INSERT INTO coremeasurements (CoreMeasurementID, CensusID, StemID, IsValidated, MeasurementDate, MeasuredDBH, DBHUnit,
                              MeasuredHOM, HOMUnit, Description, UserDefinedFields)
SELECT
    dbh.DBHID,
    dbh.CensusID,
    dbh.StemID,
    NULL,  -- Placeholder for IsValidated
    dbh.ExactDate,
    CAST(dbh.DBH AS DECIMAL(10, 6)),
    'cm',  -- DBHUnit
    CAST(dbh.HOM AS DECIMAL(10, 6)),
    'm',   -- HOMUnit
    LEFT(dbh.Comments, 65535),
    NULL   -- Placeholder for UserDefinedFields
FROM (
    -- Combine dbh and dbhbackup using UNION
    SELECT
        DBHID, CensusID, StemID, DBH, HOM, ExactDate, Comments
    FROM stable_panama.dbh
) dbh
ON DUPLICATE KEY UPDATE
    StemID            = VALUES(StemID),
    IsValidated       = VALUES(IsValidated),
    MeasurementDate   = VALUES(MeasurementDate),
    MeasuredDBH       = VALUES(MeasuredDBH),
    DBHUnit           = VALUES(DBHUnit),
    MeasuredHOM       = VALUES(MeasuredHOM),
    HOMUnit           = VALUES(HOMUnit),
    Description       = IF(VALUES(Description) != '', VALUES(Description),
                           coremeasurements.Description),
    UserDefinedFields = VALUES(UserDefinedFields);


-- Insert into quadratpersonnel with ON DUPLICATE KEY UPDATE
INSERT INTO quadratpersonnel (QuadratPersonnelID, QuadratID, PersonnelID, CensusID)
SELECT dc.DataCollectionID, dc.QuadratID, pr.PersonnelID, dc.CensusID
FROM stable_panama.datacollection dc
         JOIN stable_panama.personnelrole pr ON dc.PersonnelRoleID = pr.PersonnelRoleID
ON DUPLICATE KEY UPDATE QuadratID   = VALUES(QuadratID),
                        PersonnelID = VALUES(PersonnelID),
                        CensusID    = VALUES(CensusID);

-- Insert into attributes with ON DUPLICATE KEY UPDATE
INSERT INTO attributes (Code, Description, Status)
SELECT ta.TSMCode,
       LEFT(ta.Description, 65535),
       IF(ta.Status IN ('alive', 'alive-not measured', 'dead', 'stem dead', 'broken below', 'omitted', 'missing'),
          ta.Status, NULL)
FROM stable_panama.tsmattributes ta
GROUP BY ta.TSMCode, ta.Description, ta.Status
ON DUPLICATE KEY UPDATE Description = IF(VALUES(Description) != '', VALUES(Description), attributes.Description),
                        Status      = VALUES(Status);

-- Insert into cmattributes with ON DUPLICATE KEY UPDATE
INSERT INTO cmattributes (CMAID, CoreMeasurementID, Code)
SELECT
    dbha.DBHAttID,
    dbha.DBHID,
    ta.TSMCode
FROM (
    -- Combine dbhattributes and dbhattributes_backup using UNION
    SELECT
        DBHAttID, DBHID, TSMID
    FROM stable_panama.dbhattributes
) dbha
JOIN stable_panama.tsmattributes ta ON dbha.TSMID = ta.TSMID
ON DUPLICATE KEY UPDATE
    CoreMeasurementID = VALUES(CoreMeasurementID),
    Code              = VALUES(Code);

-- Insert into specimens with ON DUPLICATE KEY UPDATE
INSERT INTO specimens (SpecimenID, StemID, PersonnelID, SpecimenNumber, SpeciesID, Herbarium, Voucher, CollectionDate,
                       DeterminedBy, Description)
SELECT sp.SpecimenID,
       st.StemID,
       pr.PersonnelID,
       sp.SpecimenNumber,
       sp.SpeciesID,
       sp.Herbarium,
       sp.Voucher,
       sp.CollectionDate,
       sp.DeterminedBy,
       LEFT(sp.Description, 65535)
FROM stable_panama.specimen sp
         LEFT JOIN stable_panama.stem st ON st.TreeID = sp.TreeID
         LEFT JOIN stable_panama.personnel pr ON sp.Collector = CONCAT(pr.FirstName, ' ', pr.LastName)
ON DUPLICATE KEY UPDATE StemID         = VALUES(StemID),
                        PersonnelID    = VALUES(PersonnelID),
                        SpecimenNumber = VALUES(SpecimenNumber),
                        SpeciesID      = VALUES(SpeciesID),
                        Herbarium      = VALUES(Herbarium),
                        Voucher        = VALUES(Voucher),
                        CollectionDate = VALUES(CollectionDate),
                        DeterminedBy   = IF(VALUES(DeterminedBy) != '', VALUES(DeterminedBy), specimens.DeterminedBy),
                        Description    = IF(VALUES(Description) != '', VALUES(Description), specimens.Description);

SET foreign_key_checks = 1;
