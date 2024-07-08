SET foreign_key_checks = 0;

-- stable_sinharaja: old ctfsweb schema
-- forestgeo_scbi: new schema.
-- make sure you replace this for each new schema you pull/push from/to.

# attributes
DROP TRIGGER IF EXISTS after_insert_attributes;
DROP TRIGGER IF EXISTS after_update_attributes;
DROP TRIGGER IF EXISTS after_delete_attributes;

# census
DROP TRIGGER IF EXISTS after_insert_census;
DROP TRIGGER IF EXISTS after_update_census;
DROP TRIGGER IF EXISTS after_delete_census;

# cmattributes
DROP TRIGGER IF EXISTS after_insert_cmattributes;
DROP TRIGGER IF EXISTS after_update_cmattributes;
DROP TRIGGER IF EXISTS after_delete_cmattributes;

# cmverrors
DROP TRIGGER IF EXISTS after_insert_cmverrors;
DROP TRIGGER IF EXISTS after_update_cmverrors;
DROP TRIGGER IF EXISTS after_delete_cmverrors;

# coremeasurements
DROP TRIGGER IF EXISTS after_insert_coremeasurements;
DROP TRIGGER IF EXISTS after_update_coremeasurements;
DROP TRIGGER IF EXISTS after_delete_coremeasurements;

# family
DROP TRIGGER IF EXISTS after_insert_family;
DROP TRIGGER IF EXISTS after_update_family;
DROP TRIGGER IF EXISTS after_delete_family;

# genus
DROP TRIGGER IF EXISTS after_insert_genus;
DROP TRIGGER IF EXISTS after_update_genus;
DROP TRIGGER IF EXISTS after_delete_genus;

# personnel
DROP TRIGGER IF EXISTS after_insert_personnel;
DROP TRIGGER IF EXISTS after_update_personnel;
DROP TRIGGER IF EXISTS after_delete_personnel;

# plots
DROP TRIGGER IF EXISTS after_insert_plots;
DROP TRIGGER IF EXISTS after_update_plots;
DROP TRIGGER IF EXISTS after_delete_plots;

# quadratpersonnel
DROP TRIGGER IF EXISTS after_insert_quadratpersonnel;
DROP TRIGGER IF EXISTS after_update_quadratpersonnel;
DROP TRIGGER IF EXISTS after_delete_quadratpersonnel;

# quadrats
DROP TRIGGER IF EXISTS after_insert_quadrats;
DROP TRIGGER IF EXISTS after_update_quadrats;
DROP TRIGGER IF EXISTS after_delete_quadrats;

# reference
DROP TRIGGER IF EXISTS after_insert_reference;
DROP TRIGGER IF EXISTS after_update_reference;
DROP TRIGGER IF EXISTS after_delete_reference;

# roles
DROP TRIGGER IF EXISTS after_insert_roles;
DROP TRIGGER IF EXISTS after_update_roles;
DROP TRIGGER IF EXISTS after_delete_roles;

# species
DROP TRIGGER IF EXISTS after_insert_species;
DROP TRIGGER IF EXISTS after_update_species;
DROP TRIGGER IF EXISTS after_delete_species;

# specieslimits
DROP TRIGGER IF EXISTS after_insert_specieslimits;
DROP TRIGGER IF EXISTS after_update_specieslimits;
DROP TRIGGER IF EXISTS after_delete_specieslimits;

# specimens
DROP TRIGGER IF EXISTS after_insert_specimens;
DROP TRIGGER IF EXISTS after_update_specimens;
DROP TRIGGER IF EXISTS after_delete_specimens;

# stems
DROP TRIGGER IF EXISTS after_insert_stems;
DROP TRIGGER IF EXISTS after_update_stems;
DROP TRIGGER IF EXISTS after_delete_stems;

# subquadrats
DROP TRIGGER IF EXISTS after_insert_subquadrats;
DROP TRIGGER IF EXISTS after_update_subquadrats;
DROP TRIGGER IF EXISTS after_delete_subquadrats;

# trees
DROP TRIGGER IF EXISTS after_insert_trees;
DROP TRIGGER IF EXISTS after_update_trees;
DROP TRIGGER IF EXISTS after_delete_trees;

# validationchangelog
DROP TRIGGER IF EXISTS after_insert_validationchangelog;
DROP TRIGGER IF EXISTS after_update_validationchangelog;
DROP TRIGGER IF EXISTS after_delete_validationchangelog;

-- Insert into plots with ON DUPLICATE KEY UPDATE
INSERT INTO plots (PlotID, PlotName, LocationName, CountryName, DimensionX, DimensionY, DimensionUnits, Area, AreaUnits, GlobalX, GlobalY, GlobalZ, CoordinateUnits, PlotShape, PlotDescription)
SELECT s.PlotID,LEFT(s.PlotName, 65535),LEFT(s.LocationName, 65535),c.CountryName,s.QDimX,s.QDimY,
       IF(s.PUOM IN ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'), s.PUOM, 'm'),s.Area,'m2',co.GX,co.GY,co.GZ,
       IF(s.GUOM IN ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'), s.GUOM, 'm'),s.ShapeOfSite,LEFT(s.DescriptionOfSite, 65535)
FROM stable_sinharaja.Site s
LEFT JOIN stable_sinharaja.Country c ON s.CountryID = c.CountryID
LEFT JOIN stable_sinharaja.Coordinates co ON s.PlotID = co.PlotID
GROUP BY s.PlotID, s.PlotName, s.LocationName, c.CountryName, s.QDimX, s.QDimY, s.PUOM, s.Area, s.GUOM, co.GX, co.GY, co.GZ, s.ShapeOfSite, s.DescriptionOfSite
ON DUPLICATE KEY UPDATE
    PlotName = IF(VALUES(PlotName) != '', VALUES(PlotName), plots.PlotName),
    LocationName = IF(VALUES(LocationName) != '', VALUES(LocationName), plots.LocationName),
    CountryName = IF(VALUES(CountryName) != '', VALUES(CountryName), plots.CountryName),
    DimensionX = VALUES(DimensionX),
    DimensionY = VALUES(DimensionY),
    DimensionUnits = VALUES(DimensionUnits),
    Area = VALUES(Area),
    AreaUnits = VALUES(AreaUnits),
    GlobalX = VALUES(GlobalX),
    GlobalY = VALUES(GlobalY),
    GlobalZ = VALUES(GlobalZ),
    CoordinateUnits = VALUES(CoordinateUnits),
    PlotShape = VALUES(PlotShape),
    PlotDescription = IF(VALUES(PlotDescription) != '', VALUES(PlotDescription), plots.PlotDescription);

-- Insert into reference with ON DUPLICATE KEY UPDATE and handling '0000-00-00' dates
INSERT INTO reference (ReferenceID, PublicationTitle, FullReference, DateOfPublication, Citation)
SELECT r.ReferenceID, r.PublicationTitle, r.FullReference,
       IF(CAST(r.DateofPublication AS CHAR) = '0000-00-00', NULL, r.DateofPublication) AS DateOfPublication,
       NULL
FROM stable_sinharaja.reference r
ON DUPLICATE KEY UPDATE
    PublicationTitle = IF(VALUES(PublicationTitle) != '', VALUES(PublicationTitle), reference.PublicationTitle),
    FullReference = IF(VALUES(FullReference) != '', VALUES(FullReference), reference.FullReference),
    reference.DateOfPublication = VALUES(DateOfPublication);

-- Insert into family with ON DUPLICATE KEY UPDATE
INSERT INTO family (FamilyID, Family, ReferenceID)
SELECT f.FamilyID, f.Family, f.ReferenceID
FROM stable_sinharaja.family f
ON DUPLICATE KEY UPDATE
    Family = IF(VALUES(Family) != '', VALUES(Family), family.Family),
    ReferenceID = VALUES(ReferenceID);

-- Insert into genus with ON DUPLICATE KEY UPDATE
INSERT INTO genus (GenusID, FamilyID, Genus, ReferenceID, GenusAuthority)
SELECT g.GenusID, g.FamilyID, g.Genus, g.ReferenceID, g.Authority
FROM stable_sinharaja.genus g
ON DUPLICATE KEY UPDATE
    FamilyID = VALUES(FamilyID),
    Genus = IF(VALUES(Genus) != '', VALUES(Genus), genus.Genus),
    ReferenceID = VALUES(ReferenceID),
    GenusAuthority = IF(VALUES(GenusAuthority) != '', VALUES(GenusAuthority), genus.GenusAuthority);

-- Insert into species with ON DUPLICATE KEY UPDATE
INSERT INTO species (SpeciesID, GenusID, SpeciesCode, SpeciesName, SubspeciesName, IDLevel, SpeciesAuthority, SubspeciesAuthority, FieldFamily, Description, ValidCode, ReferenceID)
SELECT sp.SpeciesID, sp.GenusID, sp.Mnemonic, sp.SpeciesName, MIN(subs.SubSpeciesName), sp.IDLevel, sp.Authority, MIN(subs.Authority), sp.FieldFamily, LEFT(sp.Description, 65535), NULL, sp.ReferenceID
FROM stable_sinharaja.species sp
LEFT JOIN stable_sinharaja.subspecies subs ON sp.SpeciesID = subs.SpeciesID
LEFT JOIN stable_sinharaja.reference ref ON sp.ReferenceID = ref.ReferenceID
GROUP BY sp.SpeciesID, sp.GenusID, sp.Mnemonic, sp.IDLevel, sp.Authority, sp.FieldFamily, sp.Description, sp.ReferenceID
ON DUPLICATE KEY UPDATE
    GenusID = VALUES(GenusID),
    SpeciesCode = VALUES(SpeciesCode),
    SpeciesName = VALUES(SpeciesName),
    SubspeciesName = IF(VALUES(SubspeciesName) != '', VALUES(SubspeciesName), species.SubspeciesName),
    IDLevel = VALUES(IDLevel),
    SpeciesAuthority = IF(VALUES(SpeciesAuthority) != '', VALUES(SpeciesAuthority), species.SpeciesAuthority),
    SubspeciesAuthority = IF(VALUES(SubspeciesAuthority) != '', VALUES(SubspeciesAuthority), species.SubspeciesAuthority),
    FieldFamily = VALUES(FieldFamily),
    Description = IF(VALUES(Description) != '', VALUES(Description), species.Description),
    ValidCode = VALUES(ValidCode),
    ReferenceID = VALUES(ReferenceID);

-- Insert into roles table
INSERT INTO roles (RoleID, RoleName, RoleDescription)
SELECT RoleID, Description, NULL
FROM stable_sinharaja.rolereference
ON DUPLICATE KEY UPDATE
    RoleName = VALUES(RoleName),
    RoleDescription = VALUES(RoleDescription);

-- Insert into personnel with ON DUPLICATE KEY UPDATE and handling RoleID
INSERT INTO personnel (PersonnelID, CensusID, FirstName, LastName, RoleID)
SELECT p.PersonnelID, NULL, p.FirstName, p.LastName, pr.RoleID
FROM stable_sinharaja.personnel p
JOIN stable_sinharaja.personnelrole pr ON p.PersonnelID = pr.PersonnelID
ON DUPLICATE KEY UPDATE
    FirstName = IF(VALUES(FirstName) != '', VALUES(FirstName), personnel.FirstName),
    LastName = IF(VALUES(LastName) != '', VALUES(LastName), personnel.LastName),
    RoleID = VALUES(RoleID);

UPDATE stable_sinharaja.census
SET StartDate = NULL
WHERE CAST(StartDate AS CHAR(10)) = '0000-00-00';

-- Insert into census with ON DUPLICATE KEY UPDATE
INSERT INTO census (CensusID, PlotID, StartDate, EndDate, Description, PlotCensusNumber)
SELECT c.CensusID, c.PlotID, c.StartDate, c.EndDate, LEFT(c.Description, 65535), c.PlotCensusNumber
FROM stable_sinharaja.census c
ON DUPLICATE KEY UPDATE
    PlotID = VALUES(PlotID),
    StartDate = VALUES(StartDate),
    EndDate = VALUES(EndDate),
    Description = IF(VALUES(Description) != '', VALUES(Description), census.Description),
    PlotCensusNumber = VALUES(PlotCensusNumber);

-- Insert into quadrats with ON DUPLICATE KEY UPDATE
INSERT INTO quadrats (QuadratID, PlotID, CensusID, QuadratName, StartX, StartY, DimensionX, DimensionY, DimensionUnits, Area, AreaUnits, QuadratShape, CoordinateUnits)
SELECT q.QuadratID,q.PlotID,cq.CensusID,LEFT(q.QuadratName, 65535),MIN(co.PX),MIN(co.PY),s.QDimX,s.QDimY,
       IF(s.QUOM IN ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'), s.QUOM, 'm'),q.Area,
       IF(s.QUOM IN ('km2', 'hm2', 'dam2', 'm2', 'dm2', 'cm2', 'mm2'), s.QUOM, 'm2'),
       IF(q.IsStandardShape = 'Y', 'standard', 'not standard'),
       IF(s.GUOM IN ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'), s.GUOM, 'm')
FROM stable_sinharaja.quadrat q
LEFT JOIN stable_sinharaja.censusquadrat cq ON q.QuadratID = cq.QuadratID
LEFT JOIN stable_sinharaja.Coordinates co ON q.QuadratID = co.QuadratID
LEFT JOIN stable_sinharaja.Site s ON q.PlotID = s.PlotID
GROUP BY q.QuadratID, q.PlotID, cq.CensusID, q.QuadratName, s.QDimX, s.QDimY, s.QUOM, q.Area, q.IsStandardShape, s.GUOM
ON DUPLICATE KEY UPDATE
    PlotID = VALUES(PlotID),
    CensusID = VALUES(CensusID),
    QuadratName = IF(VALUES(QuadratName) != '', VALUES(QuadratName), quadrats.QuadratName),
    StartX = VALUES(StartX),
    StartY = VALUES(StartY),
    DimensionX = VALUES(DimensionX),
    DimensionY = VALUES(DimensionY),
    DimensionUnits = VALUES(DimensionUnits),
    Area = VALUES(Area),
    AreaUnits = VALUES(AreaUnits),
    QuadratShape = VALUES(QuadratShape),
    CoordinateUnits = VALUES(CoordinateUnits);

-- Insert into trees with ON DUPLICATE KEY UPDATE
INSERT INTO trees (TreeID, TreeTag, SpeciesID)
SELECT t.TreeID, t.Tag, t.SpeciesID
FROM stable_sinharaja.tree t
ON DUPLICATE KEY UPDATE
    TreeTag = IF(VALUES(TreeTag) != '', VALUES(TreeTag), trees.TreeTag),
    SpeciesID = VALUES(SpeciesID);

-- Insert into stems with ON DUPLICATE KEY UPDATE
INSERT INTO stems (StemID, TreeID, QuadratID, StemNumber, StemTag, LocalX, LocalY, CoordinateUnits, Moved, StemDescription)
SELECT s.StemID,s.TreeID,s.QuadratID,s.StemNumber,s.StemTag,MIN(s.QX),MIN(s.QY),
       IF(si.QUOM IN ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'), si.QUOM, 'm') AS CoordinateUnits,
       IF(s.Moved = 'Y', 1, 0)                                                 AS Moved,LEFT(s.StemDescription, 65535)
FROM stable_sinharaja.stem s
LEFT JOIN stable_sinharaja.quadrat q ON q.QuadratID = s.QuadratID
LEFT JOIN stable_sinharaja.Site si ON q.PlotID = si.PlotID
GROUP BY s.StemID, s.TreeID, s.QuadratID, s.StemNumber, s.StemTag, s.Moved, s.StemDescription, si.QUOM
ON DUPLICATE KEY UPDATE
    TreeID = VALUES(TreeID),
    QuadratID = VALUES(QuadratID),
    StemNumber = VALUES(StemNumber),
    StemTag = IF(VALUES(StemTag) != '', VALUES(StemTag), stems.StemTag),
    LocalX = VALUES(LocalX),
    LocalY = VALUES(LocalY),
    CoordinateUnits = VALUES(CoordinateUnits),
    Moved = VALUES(Moved),
    StemDescription = IF(VALUES(StemDescription) != '', VALUES(StemDescription), stems.StemDescription);

-- Insert into coremeasurements with ON DUPLICATE KEY UPDATE
INSERT INTO coremeasurements (CoreMeasurementID, StemID, IsValidated, MeasurementDate, MeasuredDBH, DBHUnit, MeasuredHOM, HOMUnit, Description, UserDefinedFields)
SELECT dbh.DBHID, dbh.StemID, NULL, dbh.ExactDate, dbh.DBH, 'cm', dbh.HOM, 'm', LEFT(dbh.Comments, 65535), NULL
FROM stable_sinharaja.dbh dbh
ON DUPLICATE KEY UPDATE
    StemID = VALUES(StemID),
    IsValidated = VALUES(IsValidated),
    MeasurementDate = VALUES(MeasurementDate),
    MeasuredDBH = VALUES(MeasuredDBH),
    DBHUnit = VALUES(DBHUnit),
    MeasuredHOM = VALUES(MeasuredHOM),
    HOMUnit = VALUES(HOMUnit),
    Description = IF(VALUES(Description) != '', VALUES(Description), coremeasurements.Description),
    UserDefinedFields = VALUES(UserDefinedFields);

-- Insert into quadratpersonnel with ON DUPLICATE KEY UPDATE
INSERT INTO quadratpersonnel (QuadratPersonnelID, QuadratID, PersonnelID, CensusID)
SELECT dc.DataCollectionID, dc.QuadratID, pr.PersonnelID, dc.CensusID
FROM stable_sinharaja.datacollection dc
JOIN stable_sinharaja.personnelrole pr ON dc.PersonnelRoleID = pr.PersonnelRoleID
ON DUPLICATE KEY UPDATE
    QuadratID = VALUES(QuadratID),
    PersonnelID = VALUES(PersonnelID),
    CensusID = VALUES(CensusID);

-- Insert into attributes with ON DUPLICATE KEY UPDATE
INSERT INTO attributes (Code, Description, Status)
SELECT ta.TSMCode, LEFT(ta.Description, 65535),
       IF(ta.Status IN ('alive', 'alive-not measured', 'dead', 'stem dead', 'broken below', 'omitted', 'missing'),
          ta.Status, NULL)
FROM stable_sinharaja.tsmattributes ta
GROUP BY ta.TSMCode, ta.Description, ta.Status
ON DUPLICATE KEY UPDATE
    Description = IF(VALUES(Description) != '', VALUES(Description), attributes.Description),
    Status = VALUES(Status);

-- Insert into cmattributes with ON DUPLICATE KEY UPDATE
INSERT INTO cmattributes (CMAID, CoreMeasurementID, Code)
SELECT dbha.DBHAttID, dbha.DBHID, ta.TSMCode
FROM stable_sinharaja.dbhattributes dbha
JOIN stable_sinharaja.tsmattributes ta ON dbha.TSMID = ta.TSMID
ON DUPLICATE KEY UPDATE
    CoreMeasurementID = VALUES(CoreMeasurementID),
    Code = VALUES(Code);

-- Insert into specimens with ON DUPLICATE KEY UPDATE
INSERT INTO specimens (SpecimenID, StemID, PersonnelID, SpecimenNumber, SpeciesID, Herbarium, Voucher, CollectionDate, DeterminedBy, Description)
SELECT sp.SpecimenID, st.StemID, pr.PersonnelID, sp.SpecimenNumber, sp.SpeciesID, sp.Herbarium, sp.Voucher, sp.CollectionDate, sp.DeterminedBy, LEFT(sp.Description, 65535)
FROM stable_sinharaja.specimen sp
LEFT JOIN stable_sinharaja.stem st ON st.TreeID = sp.TreeID
LEFT JOIN stable_sinharaja.personnel pr ON sp.Collector = CONCAT(pr.FirstName, ' ', pr.LastName)
ON DUPLICATE KEY UPDATE
    StemID = VALUES(StemID),
    PersonnelID = VALUES(PersonnelID),
    SpecimenNumber = VALUES(SpecimenNumber),
    SpeciesID = VALUES(SpeciesID),
    Herbarium = VALUES(Herbarium),
    Voucher = VALUES(Voucher),
    CollectionDate = VALUES(CollectionDate),
    DeterminedBy = IF(VALUES(DeterminedBy) != '', VALUES(DeterminedBy), specimens.DeterminedBy),
    Description = IF(VALUES(Description) != '', VALUES(Description), specimens.Description);

SET foreign_key_checks = 1;

# attributes triggers

DELIMITER //

CREATE TRIGGER after_insert_attributes
    AFTER INSERT
    ON attributes
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

    -- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'Code', NEW.Code,
            'Description', NEW.Description,
            'Status', NEW.Status
                   );

    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('attributes',
            NEW.Code,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_attributes
    AFTER UPDATE
    ON attributes
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the new row
    SET old_json = JSON_OBJECT(
            'Code', OLD.Code,
            'Description', OLD.Description,
            'Status', OLD.Status
              );

    -- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'Code', NEW.Code,
            'Description', NEW.Description,
            'Status', NEW.Status
                   );

    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('attributes',
            NEW.Code,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_attributes
    AFTER DELETE
    ON attributes
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

   -- Construct the JSON object for the new row
    SET old_json = JSON_OBJECT(
            'Code', OLD.Code,
            'Description', OLD.Description,
            'Status', OLD.Status
              );

    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('attributes',
            OLD.Code,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# plots triggers
DELIMITER //

CREATE TRIGGER after_insert_plots
    AFTER INSERT
    ON plots
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'PlotID', NEW.PlotID,
            'PlotName', NEW.PlotName,
            'LocationName', NEW.LocationName,
            'CountryName', NEW.CountryName,
            'DimensionX', NEW.DimensionX,
            'DimensionY', NEW.DimensionY,
            'DimensionUnits', NEW.DimensionUnits,
            'Area', NEW.Area,
            'AreaUnits', NEW.AreaUnits,
            'GlobalX', NEW.GlobalX,
            'GlobalY', NEW.GlobalY,
            'GlobalZ', NEW.GlobalZ,
            'CoordinateUnits', NEW.CoordinateUnits,
            'PlotShape', NEW.PlotShape,
            'PlotDescription', NEW.PlotDescription
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('plots',
            NEW.PlotID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_plots
    AFTER UPDATE
    ON plots
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'PlotID', OLD.PlotID,
            'PlotName', OLD.PlotName,
            'LocationName', OLD.LocationName,
            'CountryName', OLD.CountryName,
            'DimensionX', OLD.DimensionX,
            'DimensionY', OLD.DimensionY,
            'DimensionUnits', OLD.DimensionUnits,
            'Area', OLD.Area,
            'AreaUnits', OLD.AreaUnits,
            'GlobalX', OLD.GlobalX,
            'GlobalY', OLD.GlobalY,
            'GlobalZ', OLD.GlobalZ,
            'CoordinateUnits', OLD.CoordinateUnits,
            'PlotShape', OLD.PlotShape,
            'PlotDescription', OLD.PlotDescription
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'PlotID', NEW.PlotID,
            'PlotName', NEW.PlotName,
            'LocationName', NEW.LocationName,
            'CountryName', NEW.CountryName,
            'DimensionX', NEW.DimensionX,
            'DimensionY', NEW.DimensionY,
            'DimensionUnits', NEW.DimensionUnits,
            'Area', NEW.Area,
            'AreaUnits', NEW.AreaUnits,
            'GlobalX', NEW.GlobalX,
            'GlobalY', NEW.GlobalY,
            'GlobalZ', NEW.GlobalZ,
            'CoordinateUnits', NEW.CoordinateUnits,
            'PlotShape', NEW.PlotShape,
            'PlotDescription', NEW.PlotDescription
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('plots',
            NEW.PlotID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_plots
    AFTER DELETE
    ON plots
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'PlotID', OLD.PlotID,
            'PlotName', OLD.PlotName,
            'LocationName', OLD.LocationName,
            'CountryName', OLD.CountryName,
            'DimensionX', OLD.DimensionX,
            'DimensionY', OLD.DimensionY,
            'DimensionUnits', OLD.DimensionUnits,
            'Area', OLD.Area,
            'AreaUnits', OLD.AreaUnits,
            'GlobalX', OLD.GlobalX,
            'GlobalY', OLD.GlobalY,
            'GlobalZ', OLD.GlobalZ,
            'CoordinateUnits', OLD.CoordinateUnits,
            'PlotShape', OLD.PlotShape,
            'PlotDescription', OLD.PlotDescription
                   );

    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('plots',
            OLD.PlotID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# census triggers

DELIMITER //

CREATE TRIGGER after_insert_census
    AFTER INSERT
    ON census
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'CensusID', NEW.CensusID,
            'PlotID', NEW.PlotID,
            'StartDate', NEW.StartDate,
            'EndDate', NEW.EndDate,
            'Description', NEW.Description,
            'PlotCensusNumber', NEW.PlotCensusNumber
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('census',
            NEW.CensusID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_census
    AFTER UPDATE
    ON census
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'CensusID', OLD.CensusID,
            'PlotID', OLD.PlotID,
            'StartDate', OLD.StartDate,
            'EndDate', OLD.EndDate,
            'Description', OLD.Description,
            'PlotCensusNumber', OLD.PlotCensusNumber
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'CensusID', NEW.CensusID,
            'PlotID', NEW.PlotID,
            'StartDate', NEW.StartDate,
            'EndDate', NEW.EndDate,
            'Description', NEW.Description,
            'PlotCensusNumber', NEW.PlotCensusNumber
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('census',
            NEW.CensusID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_census
    AFTER DELETE
    ON census
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'CensusID', OLD.CensusID,
            'PlotID', OLD.PlotID,
            'StartDate', OLD.StartDate,
            'EndDate', OLD.EndDate,
            'Description', OLD.Description,
            'PlotCensusNumber', OLD.PlotCensusNumber
                   );

    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('census',
            OLD.CensusID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# quadrats triggers

DELIMITER //

CREATE TRIGGER after_insert_quadrats
    AFTER INSERT
    ON quadrats
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'QuadratID', NEW.QuadratID,
            'PlotID', NEW.PlotID,
            'CensusID', NEW.CensusID,
            'QuadratName', NEW.QuadratName,
            'StartX', NEW.StartX,
            'StartY', NEW.StartY,
            'CoordinateUnits', NEW.CoordinateUnits,
            'DimensionX', NEW.DimensionX,
            'DimensionY', NEW.DimensionY,
            'DimensionUnits', NEW.DimensionUnits,
            'Area', NEW.Area,
            'AreaUnits', NEW.AreaUnits,
            'QuadratShape', NEW.QuadratShape
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('quadrats',
            NEW.QuadratID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_quadrats
    AFTER UPDATE
    ON quadrats
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'QuadratID', OLD.QuadratID,
            'PlotID', OLD.PlotID,
            'CensusID', OLD.CensusID,
            'QuadratName', OLD.QuadratName,
            'StartX', OLD.StartX,
            'StartY', OLD.StartY,
            'CoordinateUnits', OLD.CoordinateUnits,
            'DimensionX', OLD.DimensionX,
            'DimensionY', OLD.DimensionY,
            'DimensionUnits', OLD.DimensionUnits,
            'Area', OLD.Area,
            'AreaUnits', OLD.AreaUnits,
            'QuadratShape', OLD.QuadratShape
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'QuadratID', NEW.QuadratID,
            'PlotID', NEW.PlotID,
            'CensusID', NEW.CensusID,
            'QuadratName', NEW.QuadratName,
            'StartX', NEW.StartX,
            'StartY', NEW.StartY,
            'CoordinateUnits', NEW.CoordinateUnits,
            'DimensionX', NEW.DimensionX,
            'DimensionY', NEW.DimensionY,
            'DimensionUnits', NEW.DimensionUnits,
            'Area', NEW.Area,
            'AreaUnits', NEW.AreaUnits,
            'QuadratShape', NEW.QuadratShape
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('quadrats',
            NEW.QuadratID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_quadrats
    AFTER DELETE
    ON quadrats
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'QuadratID', OLD.QuadratID,
            'PlotID', OLD.PlotID,
            'CensusID', OLD.CensusID,
            'QuadratName', OLD.QuadratName,
            'StartX', OLD.StartX,
            'StartY', OLD.StartY,
            'CoordinateUnits', OLD.CoordinateUnits,
            'DimensionX', OLD.DimensionX,
            'DimensionY', OLD.DimensionY,
            'DimensionUnits', OLD.DimensionUnits,
            'Area', OLD.Area,
            'AreaUnits', OLD.AreaUnits,
            'QuadratShape', OLD.QuadratShape
                   );

    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('quadrats',
            OLD.QuadratID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# reference triggers

DELIMITER //

CREATE TRIGGER after_insert_reference
    AFTER INSERT
    ON reference
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'ReferenceID', NEW.ReferenceID,
            'PublicationTitle', NEW.PublicationTitle,
            'FullReference', NEW.FullReference,
            'DateOfPublication', NEW.DateOfPublication,
            'Citation', NEW.Citation
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('reference',
            NEW.ReferenceID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_reference
    AFTER UPDATE
    ON reference
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'ReferenceID', OLD.ReferenceID,
            'PublicationTitle', OLD.PublicationTitle,
            'FullReference', OLD.FullReference,
            'DateOfPublication', OLD.DateOfPublication,
            'Citation', OLD.Citation
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'ReferenceID', NEW.ReferenceID,
            'PublicationTitle', NEW.PublicationTitle,
            'FullReference', NEW.FullReference,
            'DateOfPublication', NEW.DateOfPublication,
            'Citation', NEW.Citation
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('reference',
            NEW.ReferenceID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_reference
    AFTER DELETE
    ON reference
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'ReferenceID', OLD.ReferenceID,
            'PublicationTitle', OLD.PublicationTitle,
            'FullReference', OLD.FullReference,
            'DateOfPublication', OLD.DateOfPublication,
            'Citation', OLD.Citation
                   );
    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('reference',
            OLD.ReferenceID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# family triggers

DELIMITER //

CREATE TRIGGER after_insert_family
    AFTER INSERT
    ON family
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'FamilyID', NEW.FamilyID,
            'Family', NEW.Family,
            'ReferenceID', NEW.ReferenceID
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('family',
            NEW.FamilyID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_family
    AFTER UPDATE
    ON family
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'FamilyID', OLD.FamilyID,
            'Family', OLD.Family,
            'ReferenceID', OLD.ReferenceID
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'FamilyID', NEW.FamilyID,
            'Family', NEW.Family,
            'ReferenceID', NEW.ReferenceID
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('family',
            NEW.FamilyID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_family
    AFTER DELETE
    ON family
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'FamilyID', OLD.FamilyID,
            'Family', OLD.Family,
            'ReferenceID', OLD.ReferenceID
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('family',
            OLD.FamilyID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# genus triggers

DELIMITER //

CREATE TRIGGER after_insert_genus
    AFTER INSERT
    ON genus
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'GenusID', NEW.GenusID,
            'FamilyID', NEW.FamilyID,
            'Genus', NEW.Genus,
            'ReferenceID', NEW.ReferenceID,
            'GenusAuthority', NEW.GenusAuthority
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('genus',
            NEW.GenusID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_genus
    AFTER UPDATE
    ON genus
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'GenusID', OLD.GenusID,
            'FamilyID', OLD.FamilyID,
            'Genus', OLD.Genus,
            'ReferenceID', OLD.ReferenceID,
            'GenusAuthority', OLD.GenusAuthority
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'GenusID', NEW.GenusID,
            'FamilyID', NEW.FamilyID,
            'Genus', NEW.Genus,
            'ReferenceID', NEW.ReferenceID,
            'GenusAuthority', NEW.GenusAuthority
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('genus',
            NEW.GenusID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_genus
    AFTER DELETE
    ON genus
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'GenusID', OLD.GenusID,
            'FamilyID', OLD.FamilyID,
            'Genus', OLD.Genus,
            'ReferenceID', OLD.ReferenceID,
            'GenusAuthority', OLD.GenusAuthority
                   );

    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('genus',
            OLD.GenusID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# roles triggers

DELIMITER //

CREATE TRIGGER after_insert_roles
    AFTER INSERT
    ON roles
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'RoleID', NEW.RoleID,
            'RoleName', NEW.RoleName,
            'RoleDescription', NEW.RoleDescription
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('roles',
            NEW.RoleID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_roles
    AFTER UPDATE
    ON roles
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'RoleID', OLD.RoleID,
            'RoleName', OLD.RoleName,
            'RoleDescription', OLD.RoleDescription
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'RoleID', NEW.RoleID,
            'RoleName', NEW.RoleName,
            'RoleDescription', NEW.RoleDescription
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('roles',
            NEW.RoleID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_roles
    AFTER DELETE
    ON roles
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'RoleID', OLD.RoleID,
            'RoleName', OLD.RoleName,
            'RoleDescription', OLD.RoleDescription
                   );

    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('roles',
            OLD.RoleID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# personnel triggers

DELIMITER //

CREATE TRIGGER after_insert_personnel
    AFTER INSERT
    ON personnel
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'PersonnelID', NEW.PersonnelID,
            'CensusID', NEW.CensusID,
            'FirstName', NEW.FirstName,
            'LastName', NEW.LastName,
            'RoleID', NEW.RoleID
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('personnel',
            NEW.PersonnelID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_personnel
    AFTER UPDATE
    ON personnel
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'PersonnelID', OLD.PersonnelID,
            'CensusID', OLD.CensusID,
            'FirstName', OLD.FirstName,
            'LastName', OLD.LastName,
            'RoleID', OLD.RoleID
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'PersonnelID', NEW.PersonnelID,
            'CensusID', NEW.CensusID,
            'FirstName', NEW.FirstName,
            'LastName', NEW.LastName,
            'RoleID', NEW.RoleID
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('personnel',
            NEW.PersonnelID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_personnel
    AFTER DELETE
    ON personnel
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'PersonnelID', OLD.PersonnelID,
            'CensusID', OLD.CensusID,
            'FirstName', OLD.FirstName,
            'LastName', OLD.LastName,
            'RoleID', OLD.RoleID
                   );

    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('personnel',
            OLD.PersonnelID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# quadratpersonnel triggers

DELIMITER //

CREATE TRIGGER after_insert_quadratpersonnel
    AFTER INSERT
    ON quadratpersonnel
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'QuadratPersonnelID', NEW.QuadratPersonnelID,
            'QuadratID', NEW.QuadratID,
            'PersonnelID', NEW.PersonnelID,
            'CensusID', NEW.CensusID
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('quadratpersonnel',
            NEW.QuadratPersonnelID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_quadratpersonnel
    AFTER UPDATE
    ON quadratpersonnel
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'QuadratPersonnelID', OLD.QuadratPersonnelID,
            'QuadratID', OLD.QuadratID,
            'PersonnelID', OLD.PersonnelID,
            'CensusID', OLD.CensusID
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'QuadratPersonnelID', NEW.QuadratPersonnelID,
            'QuadratID', NEW.QuadratID,
            'PersonnelID', NEW.PersonnelID,
            'CensusID', NEW.CensusID
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('quadratpersonnel',
            NEW.QuadratPersonnelID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_quadratpersonnel
    AFTER DELETE
    ON quadratpersonnel
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'QuadratPersonnelID', OLD.QuadratPersonnelID,
            'QuadratID', OLD.QuadratID,
            'PersonnelID', OLD.PersonnelID,
            'CensusID', OLD.CensusID
                   );

    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('quadratpersonnel',
            OLD.QuadratPersonnelID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# species triggers

DELIMITER //

CREATE TRIGGER after_insert_species
    AFTER INSERT
    ON species
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'SpeciesID', NEW.SpeciesID,
            'GenusID', NEW.GenusID,
            'CensusID', NEW.CensusID,
            'SpeciesCode', NEW.SpeciesCode,
            'SpeciesName', NEW.SpeciesName,
            'SubspeciesName', NEW.SubspeciesName,
            'IDLevel', NEW.IDLevel,
            'SpeciesAuthority', NEW.SpeciesAuthority,
            'SubspeciesAuthority', NEW.SubspeciesAuthority,
            'FieldFamily', NEW.FieldFamily,
            'Description', NEW.Description,
            'ValidCode', NEW.ValidCode,
            'ReferenceID', NEW.ReferenceID
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('species',
            NEW.SpeciesID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_species
    AFTER UPDATE
    ON species
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'SpeciesID', OLD.SpeciesID,
            'GenusID', OLD.GenusID,
            'CensusID', OLD.CensusID,
            'SpeciesCode', OLD.SpeciesCode,
            'SpeciesName', OLD.SpeciesName,
            'SubspeciesName', OLD.SubspeciesName,
            'IDLevel', OLD.IDLevel,
            'SpeciesAuthority', OLD.SpeciesAuthority,
            'SubspeciesAuthority', OLD.SubspeciesAuthority,
            'FieldFamily', OLD.FieldFamily,
            'Description', OLD.Description,
            'ValidCode', OLD.ValidCode,
            'ReferenceID', OLD.ReferenceID
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'SpeciesID', NEW.SpeciesID,
            'GenusID', NEW.GenusID,
            'CensusID', NEW.CensusID,
            'SpeciesCode', NEW.SpeciesCode,
            'SpeciesName', NEW.SpeciesName,
            'SubspeciesName', NEW.SubspeciesName,
            'IDLevel', NEW.IDLevel,
            'SpeciesAuthority', NEW.SpeciesAuthority,
            'SubspeciesAuthority', NEW.SubspeciesAuthority,
            'FieldFamily', NEW.FieldFamily,
            'Description', NEW.Description,
            'ValidCode', NEW.ValidCode,
            'ReferenceID', NEW.ReferenceID
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('species',
            NEW.SpeciesID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_species
    AFTER DELETE
    ON species
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'SpeciesID', OLD.SpeciesID,
            'GenusID', OLD.GenusID,
            'CensusID', OLD.CensusID,
            'SpeciesCode', OLD.SpeciesCode,
            'SpeciesName', OLD.SpeciesName,
            'SubspeciesName', OLD.SubspeciesName,
            'IDLevel', OLD.IDLevel,
            'SpeciesAuthority', OLD.SpeciesAuthority,
            'SubspeciesAuthority', OLD.SubspeciesAuthority,
            'FieldFamily', OLD.FieldFamily,
            'Description', OLD.Description,
            'ValidCode', OLD.ValidCode,
            'ReferenceID', OLD.ReferenceID
                   );

    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('species',
            OLD.SpeciesID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# specieslimits triggers

DELIMITER //

CREATE TRIGGER after_insert_specieslimits
    AFTER INSERT
    ON specieslimits
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'SpeciesLimitID', NEW.SpeciesLimitID,
            'SpeciesCode', NEW.SpeciesCode,
            'LimitType', NEW.LimitType,
            'UpperBound', NEW.UpperBound,
            'LowerBound', NEW.LowerBound,
            'Unit', NEW.Unit
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('specieslimits',
            NEW.SpeciesLimitID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_specieslimits
    AFTER UPDATE
    ON specieslimits
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'SpeciesLimitID', OLD.SpeciesLimitID,
            'SpeciesCode', OLD.SpeciesCode,
            'LimitType', OLD.LimitType,
            'UpperBound', OLD.UpperBound,
            'LowerBound', OLD.LowerBound,
            'Unit', OLD.Unit
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'SpeciesLimitID', NEW.SpeciesLimitID,
            'SpeciesCode', NEW.SpeciesCode,
            'LimitType', NEW.LimitType,
            'UpperBound', NEW.UpperBound,
            'LowerBound', NEW.LowerBound,
            'Unit', NEW.Unit
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('specieslimits',
            NEW.SpeciesLimitID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_specieslimits
    AFTER DELETE
    ON specieslimits
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'SpeciesLimitID', OLD.SpeciesLimitID,
            'SpeciesCode', OLD.SpeciesCode,
            'LimitType', OLD.LimitType,
            'UpperBound', OLD.UpperBound,
            'LowerBound', OLD.LowerBound,
            'Unit', OLD.Unit
                   );

    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('specieslimits',
            OLD.SpeciesLimitID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# subquadrats triggers

DELIMITER //

CREATE TRIGGER after_insert_subquadrats
    AFTER INSERT
    ON subquadrats
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'SubquadratID', NEW.SubquadratID,
            'SubquadratName', NEW.SubquadratName,
            'QuadratID', NEW.QuadratID,
            'DimensionX', NEW.DimensionX,
            'DimensionY', NEW.DimensionY,
            'DimensionUnits', NEW.DimensionUnits,
            'X', NEW.X,
            'Y', NEW.Y,
            'CoordinateUnits', NEW.CoordinateUnits,
            'Ordering', NEW.Ordering
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('subquadrats',
            NEW.SubquadratID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_subquadrats
    AFTER UPDATE
    ON subquadrats
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'SubquadratID', OLD.SubquadratID,
            'SubquadratName', OLD.SubquadratName,
            'QuadratID', OLD.QuadratID,
            'DimensionX', OLD.DimensionX,
            'DimensionY', OLD.DimensionY,
            'DimensionUnits', OLD.DimensionUnits,
            'X', OLD.X,
            'Y', OLD.Y,
            'CoordinateUnits', OLD.CoordinateUnits,
            'Ordering', OLD.Ordering
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'SubquadratID', NEW.SubquadratID,
            'SubquadratName', NEW.SubquadratName,
            'QuadratID', NEW.QuadratID,
            'DimensionX', NEW.DimensionX,
            'DimensionY', NEW.DimensionY,
            'DimensionUnits', NEW.DimensionUnits,
            'X', NEW.X,
            'Y', NEW.Y,
            'CoordinateUnits', NEW.CoordinateUnits,
            'Ordering', NEW.Ordering
                   );

    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('subquadrats',
            NEW.SubquadratID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_subquadrats
    AFTER DELETE
    ON subquadrats
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'SubquadratID', OLD.SubquadratID,
            'SubquadratName', OLD.SubquadratName,
            'QuadratID', OLD.QuadratID,
            'DimensionX', OLD.DimensionX,
            'DimensionY', OLD.DimensionY,
            'DimensionUnits', OLD.DimensionUnits,
            'X', OLD.X,
            'Y', OLD.Y,
            'CoordinateUnits', OLD.CoordinateUnits,
            'Ordering', OLD.Ordering
                   );

    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('subquadrats',
            OLD.SubquadratID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# trees triggers

DELIMITER //

CREATE TRIGGER after_insert_trees
    AFTER INSERT
    ON trees
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'TreeID', NEW.TreeID,
            'TreeTag', NEW.TreeTag,
            'SpeciesID', NEW.SpeciesID
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('trees',
            NEW.TreeID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_trees
    AFTER UPDATE
    ON trees
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'TreeID', OLD.TreeID,
            'TreeTag', OLD.TreeTag,
            'SpeciesID', OLD.SpeciesID
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'TreeID', NEW.TreeID,
            'TreeTag', NEW.TreeTag,
            'SpeciesID', NEW.SpeciesID
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('trees',
            NEW.TreeID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_trees
    AFTER DELETE
    ON trees
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'TreeID', OLD.TreeID,
            'TreeTag', OLD.TreeTag,
            'SpeciesID', OLD.SpeciesID
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('trees',
            OLD.TreeID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# stems triggers

DELIMITER //

CREATE TRIGGER after_insert_stems
    AFTER INSERT
    ON stems
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;
-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'StemID', NEW.StemID,
            'TreeID', NEW.TreeID,
            'QuadratID', NEW.QuadratID,
            'StemNumber', NEW.StemNumber,
            'StemTag', NEW.StemTag,
            'LocalX', NEW.LocalX,
            'LocalY', NEW.LocalY,
            'CoordinateUnits', NEW.CoordinateUnits,
            'Moved', NEW.Moved,
            'StemDescription', NEW.StemDescription
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('stems',
            NEW.StemID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_stems
    AFTER UPDATE
    ON stems
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'StemID', OLD.StemID,
            'TreeID', OLD.TreeID,
            'QuadratID', OLD.QuadratID,
            'StemNumber', OLD.StemNumber,
            'StemTag', OLD.StemTag,
            'LocalX', OLD.LocalX,
            'LocalY', OLD.LocalY,
            'CoordinateUnits', OLD.CoordinateUnits,
            'Moved', OLD.Moved,
            'StemDescription', OLD.StemDescription
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'StemID', NEW.StemID,
            'TreeID', NEW.TreeID,
            'QuadratID', NEW.QuadratID,
            'StemNumber', NEW.StemNumber,
            'StemTag', NEW.StemTag,
            'LocalX', NEW.LocalX,
            'LocalY', NEW.LocalY,
            'CoordinateUnits', NEW.CoordinateUnits,
            'Moved', NEW.Moved,
            'StemDescription', NEW.StemDescription
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('stems',
            NEW.StemID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_stems
    AFTER DELETE
    ON stems
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'StemID', OLD.StemID,
            'TreeID', OLD.TreeID,
            'QuadratID', OLD.QuadratID,
            'StemNumber', OLD.StemNumber,
            'StemTag', OLD.StemTag,
            'LocalX', OLD.LocalX,
            'LocalY', OLD.LocalY,
            'CoordinateUnits', OLD.CoordinateUnits,
            'Moved', OLD.Moved,
            'StemDescription', OLD.StemDescription
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('stems',
            OLD.StemID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# coremeasurements triggers

DELIMITER //

CREATE TRIGGER after_insert_coremeasurements
    AFTER INSERT
    ON coremeasurements
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'CoreMeasurementID', NEW.CoreMeasurementID,
            'StemID', NEW.StemID,
            'IsValidated', NEW.IsValidated,
            'MeasurementDate', NEW.MeasurementDate,
            'MeasuredDBH', NEW.MeasuredDBH,
            'DBHUnit', NEW.DBHUnit,
            'MeasuredHOM', NEW.MeasuredHOM,
            'HOMUnit', NEW.HOMUnit,
            'Description', NEW.Description,
            'UserDefinedFields', NEW.UserDefinedFields
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('coremeasurements',
            NEW.CoreMeasurementID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_coremeasurements
    AFTER UPDATE
    ON coremeasurements
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'CoreMeasurementID', OLD.CoreMeasurementID,
            'StemID', OLD.StemID,
            'IsValidated', OLD.IsValidated,
            'MeasurementDate', OLD.MeasurementDate,
            'MeasuredDBH', OLD.MeasuredDBH,
            'DBHUnit', OLD.DBHUnit,
            'MeasuredHOM', OLD.MeasuredHOM,
            'HOMUnit', OLD.HOMUnit,
            'Description', OLD.Description,
            'UserDefinedFields', OLD.UserDefinedFields
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'CoreMeasurementID', NEW.CoreMeasurementID,
            'StemID', NEW.StemID,
            'IsValidated', NEW.IsValidated,
            'MeasurementDate', NEW.MeasurementDate,
            'MeasuredDBH', NEW.MeasuredDBH,
            'DBHUnit', NEW.DBHUnit,
            'MeasuredHOM', NEW.MeasuredHOM,
            'HOMUnit', NEW.HOMUnit,
            'Description', NEW.Description,
            'UserDefinedFields', NEW.UserDefinedFields
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('coremeasurements',
            NEW.CoreMeasurementID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_coremeasurements
    AFTER DELETE
    ON coremeasurements
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'CoreMeasurementID', OLD.CoreMeasurementID,
            'StemID', OLD.StemID,
            'IsValidated', OLD.IsValidated,
            'MeasurementDate', OLD.MeasurementDate,
            'MeasuredDBH', OLD.MeasuredDBH,
            'DBHUnit', OLD.DBHUnit,
            'MeasuredHOM', OLD.MeasuredHOM,
            'HOMUnit', OLD.HOMUnit,
            'Description', OLD.Description,
            'UserDefinedFields', OLD.UserDefinedFields
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('coremeasurements',
            OLD.CoreMeasurementID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# cmattributes triggers

DELIMITER //

CREATE TRIGGER after_insert_cmattributes
    AFTER INSERT
    ON cmattributes
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'CMAID', NEW.CMAID,
            'CoreMeasurementID', NEW.CoreMeasurementID,
            'Code', NEW.Code
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('cmattributes',
            NEW.CMAID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_cmattributes
    AFTER UPDATE
    ON cmattributes
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'CMAID', OLD.CMAID,
            'CoreMeasurementID', OLD.CoreMeasurementID,
            'Code', OLD.Code
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'CMAID', NEW.CMAID,
            'CoreMeasurementID', NEW.CoreMeasurementID,
            'Code', NEW.Code
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('cmattributes',
            NEW.CMAID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_cmattributes
    AFTER DELETE
    ON cmattributes
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'CMAID', OLD.CMAID,
            'CoreMeasurementID', OLD.CoreMeasurementID,
            'Code', OLD.Code
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('cmattributes',
            OLD.CMAID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# cmverrors triggers

DELIMITER //

CREATE TRIGGER after_insert_cmverrors
    AFTER INSERT
    ON cmverrors
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;


-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'CMVErrorID', NEW.CMVErrorID,
            'CoreMeasurementID', NEW.CoreMeasurementID,
            'ValidationErrorID', NEW.ValidationErrorID
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('cmverrors',
            NEW.CMVErrorID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_cmverrors
    AFTER UPDATE
    ON cmverrors
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'CMVErrorID', OLD.CMVErrorID,
            'CoreMeasurementID', OLD.CoreMeasurementID,
            'ValidationErrorID', OLD.ValidationErrorID
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'CMVErrorID', NEW.CMVErrorID,
            'CoreMeasurementID', NEW.CoreMeasurementID,
            'ValidationErrorID', NEW.ValidationErrorID
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('cmverrors',
            NEW.CMVErrorID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_cmverrors
    AFTER DELETE
    ON cmverrors
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'CMVErrorID', OLD.CMVErrorID,
            'CoreMeasurementID', OLD.CoreMeasurementID,
            'ValidationErrorID', OLD.ValidationErrorID
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('cmverrors',
            OLD.CMVErrorID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# specimens triggers

DELIMITER //

CREATE TRIGGER after_insert_specimens
    AFTER INSERT
    ON specimens
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'SpecimenID', NEW.SpecimenID,
            'StemID', NEW.StemID,
            'PersonnelID', NEW.PersonnelID,
            'SpecimenNumber', NEW.SpecimenNumber,
            'SpeciesID', NEW.SpeciesID,
            'Herbarium', NEW.Herbarium,
            'Voucher', NEW.Voucher,
            'CollectionDate', NEW.CollectionDate,
            'DeterminedBy', NEW.DeterminedBy,
            'Description', NEW.Description
                   );

    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('specimens',
            NEW.SpecimenID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_specimens
    AFTER UPDATE
    ON specimens
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'SpecimenID', OLD.SpecimenID,
            'StemID', OLD.StemID,
            'PersonnelID', OLD.PersonnelID,
            'SpecimenNumber', OLD.SpecimenNumber,
            'SpeciesID', OLD.SpeciesID,
            'Herbarium', OLD.Herbarium,
            'Voucher', OLD.Voucher,
            'CollectionDate', OLD.CollectionDate,
            'DeterminedBy', OLD.DeterminedBy,
            'Description', OLD.Description
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'SpecimenID', NEW.SpecimenID,
            'StemID', NEW.StemID,
            'PersonnelID', NEW.PersonnelID,
            'SpecimenNumber', NEW.SpecimenNumber,
            'SpeciesID', NEW.SpeciesID,
            'Herbarium', NEW.Herbarium,
            'Voucher', NEW.Voucher,
            'CollectionDate', NEW.CollectionDate,
            'DeterminedBy', NEW.DeterminedBy,
            'Description', NEW.Description
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('specimens',
            NEW.SpecimenID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_specimens
    AFTER DELETE
    ON specimens
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'SpecimenID', OLD.SpecimenID,
            'StemID', OLD.StemID,
            'PersonnelID', OLD.PersonnelID,
            'SpecimenNumber', OLD.SpecimenNumber,
            'SpeciesID', OLD.SpeciesID,
            'Herbarium', OLD.Herbarium,
            'Voucher', OLD.Voucher,
            'CollectionDate', OLD.CollectionDate,
            'DeterminedBy', OLD.DeterminedBy,
            'Description', OLD.Description
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('specimens',
            OLD.SpecimenID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

# validationchangelog triggers

DELIMITER //

CREATE TRIGGER after_insert_validationchangelog
    AFTER INSERT
    ON validationchangelog
    FOR EACH ROW
BEGIN
    DECLARE new_json JSON;

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'ValidationRunID', NEW.ValidationRunID,
            'ProcedureName', NEW.ProcedureName,
            'RunDateTime', NEW.RunDateTime,
            'TargetRowID', NEW.TargetRowID,
            'ValidationOutcome', NEW.ValidationOutcome,
            'ErrorMessage', NEW.ErrorMessage,
            'ValidationCriteria', NEW.ValidationCriteria,
            'MeasuredValue', NEW.MeasuredValue,
            'ExpectedValueRange', NEW.ExpectedValueRange,
            'AdditionalDetails', NEW.AdditionalDetails
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('validationchangelog',
            NEW.ValidationRunID,
            'INSERT',
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_update_validationchangelog
    AFTER UPDATE
    ON validationchangelog
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;
    DECLARE new_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'ValidationRunID', OLD.ValidationRunID,
            'ProcedureName', OLD.ProcedureName,
            'RunDateTime', OLD.RunDateTime,
            'TargetRowID', OLD.TargetRowID,
            'ValidationOutcome', OLD.ValidationOutcome,
            'ErrorMessage', OLD.ErrorMessage,
            'ValidationCriteria', OLD.ValidationCriteria,
            'MeasuredValue', OLD.MeasuredValue,
            'ExpectedValueRange', OLD.ExpectedValueRange,
            'AdditionalDetails', OLD.AdditionalDetails
                   );

-- Construct the JSON object for the new row
    SET new_json = JSON_OBJECT(
            'ValidationRunID', NEW.ValidationRunID,
            'ProcedureName', NEW.ProcedureName,
            'RunDateTime', NEW.RunDateTime,
            'TargetRowID', NEW.TargetRowID,
            'ValidationOutcome', NEW.ValidationOutcome,
            'ErrorMessage', NEW.ErrorMessage,
            'ValidationCriteria', NEW.ValidationCriteria,
            'MeasuredValue', NEW.MeasuredValue,
            'ExpectedValueRange', NEW.ExpectedValueRange,
            'AdditionalDetails', NEW.AdditionalDetails
                   );


    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, NewRowState, ChangeTimestamp, ChangedBy)
    VALUES ('validationchangelog',
            NEW.ValidationRunID,
            'UPDATE',
            old_json,
            new_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;

DELIMITER //

CREATE TRIGGER after_delete_validationchangelog
    AFTER DELETE
    ON validationchangelog
    FOR EACH ROW
BEGIN
    DECLARE old_json JSON;

    -- Construct the JSON object for the old row
    SET old_json = JSON_OBJECT(
            'ValidationRunID', OLD.ValidationRunID,
            'ProcedureName', OLD.ProcedureName,
            'RunDateTime', OLD.RunDateTime,
            'TargetRowID', OLD.TargetRowID,
            'ValidationOutcome', OLD.ValidationOutcome,
            'ErrorMessage', OLD.ErrorMessage,
            'ValidationCriteria', OLD.ValidationCriteria,
            'MeasuredValue', OLD.MeasuredValue,
            'ExpectedValueRange', OLD.ExpectedValueRange,
            'AdditionalDetails', OLD.AdditionalDetails
                   );

    -- Insert the change log entry into unifiedchangelog
    INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
    VALUES ('validationchangelog',
            OLD.ValidationRunID,
            'DELETE',
            old_json,
            NOW(),
            'User' -- Replace 'User' with the actual username if available
           );
END //

DELIMITER ;
