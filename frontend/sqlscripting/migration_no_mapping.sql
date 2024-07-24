SET foreign_key_checks = 0;

-- stable_mpala: old ctfsweb schema
-- forestgeo_scbi: new schema.
-- make sure you replace this for each new schema you pull/push from/to.

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

DROP VIEW IF EXISTS `alltaxonomiesview`;
DROP VIEW IF EXISTS `measurementssummaryview`;
DROP VIEW IF EXISTS `stemtaxonomiesview`;
DROP VIEW IF EXISTS `viewfulltableview`;

DROP PROCEDURE IF EXISTS `UpdateValidationStatus`;
DROP PROCEDURE IF EXISTS `ValidateDBHGrowthExceedsMax`;
DROP PROCEDURE IF EXISTS `ValidateDBHShrinkageExceedsMax`;
DROP PROCEDURE IF EXISTS `ValidateFindAllInvalidSpeciesCodes`;
DROP PROCEDURE IF EXISTS `ValidateFindDuplicatedQuadratsByName`;
DROP PROCEDURE IF EXISTS `ValidateFindDuplicateStemTreeTagCombinationsPerCensus`;
DROP PROCEDURE IF EXISTS `ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat`;
DROP PROCEDURE IF EXISTS `ValidateFindStemsInTreeWithDifferentSpecies`;
DROP PROCEDURE IF EXISTS `ValidateFindStemsOutsidePlots`;
DROP PROCEDURE IF EXISTS `ValidateFindTreeStemsInDifferentQuadrats`;
DROP PROCEDURE IF EXISTS `ValidateHOMUpperAndLowerBounds`;
DROP PROCEDURE IF EXISTS `ValidateScreenMeasuredDiameterMinMax`;
DROP PROCEDURE IF EXISTS `ValidateScreenStemsWithMeasurementsButDeadAttributes`;

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
FROM stable_mpala.Site s
         LEFT JOIN stable_mpala.Country c ON s.CountryID = c.CountryID
         LEFT JOIN stable_mpala.Coordinates co ON s.PlotID = co.PlotID
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
FROM stable_mpala.reference r
ON DUPLICATE KEY UPDATE PublicationTitle            = IF(VALUES(PublicationTitle) != '', VALUES(PublicationTitle),
                                                         reference.PublicationTitle),
                        FullReference               = IF(VALUES(FullReference) != '', VALUES(FullReference),
                                                         reference.FullReference),
                        reference.DateOfPublication = VALUES(DateOfPublication);

-- Insert into family with ON DUPLICATE KEY UPDATE
INSERT INTO family (FamilyID, Family, ReferenceID)
SELECT f.FamilyID, f.Family, f.ReferenceID
FROM stable_mpala.family f
ON DUPLICATE KEY UPDATE Family      = IF(VALUES(Family) != '', VALUES(Family), family.Family),
                        ReferenceID = VALUES(ReferenceID);

-- Insert into genus with ON DUPLICATE KEY UPDATE
INSERT INTO genus (GenusID, FamilyID, Genus, ReferenceID, GenusAuthority)
SELECT g.GenusID, g.FamilyID, g.Genus, g.ReferenceID, g.Authority
FROM stable_mpala.genus g
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
FROM stable_mpala.species sp
         LEFT JOIN stable_mpala.subspecies subs ON sp.SpeciesID = subs.SpeciesID
         LEFT JOIN stable_mpala.reference ref ON sp.ReferenceID = ref.ReferenceID
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

UPDATE stable_mpala.census
SET StartDate = NULL
WHERE CAST(StartDate AS CHAR(10)) = '0000-00-00';

-- Insert into census with ON DUPLICATE KEY UPDATE
INSERT INTO census (CensusID, PlotID, StartDate, EndDate, Description, PlotCensusNumber)
SELECT
    c.CensusID,
    c.PlotID,
    COALESCE(MIN(d.ExactDate), c.StartDate) AS StartDate,
    COALESCE(MAX(d.ExactDate), c.EndDate) AS EndDate,
    LEFT(c.Description, 65535),
    c.PlotCensusNumber
FROM
    stable_mpala.census c
LEFT JOIN
    stable_mpala.dbh d ON c.CensusID = d.CensusID
GROUP BY
    c.CensusID
ON DUPLICATE KEY UPDATE
    PlotID           = VALUES(PlotID),
    StartDate        = VALUES(StartDate),
    EndDate          = VALUES(EndDate),
    Description      = IF(VALUES(Description) != '', VALUES(Description), census.Description),
    PlotCensusNumber = VALUES(PlotCensusNumber);

-- Insert into roles table
INSERT INTO roles (RoleID, RoleName, RoleDescription)
SELECT RoleID, Description, NULL
FROM stable_mpala.rolereference
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
    stable_mpala.personnel p
CROSS JOIN
    stable_mpala.census c
JOIN
    stable_mpala.personnelrole pr ON p.PersonnelID = pr.PersonnelID;

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

-- Insert into quadrats with ON DUPLICATE KEY UPDATE
INSERT INTO quadrats (QuadratID, PlotID, CensusID, QuadratName, StartX, StartY, DimensionX, DimensionY, DimensionUnits,
                      Area, AreaUnits, QuadratShape, CoordinateUnits)
SELECT q.QuadratID,
       q.PlotID,
       cq.CensusID,
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
FROM stable_mpala.quadrat q
         LEFT JOIN stable_mpala.censusquadrat cq ON q.QuadratID = cq.QuadratID
         LEFT JOIN stable_mpala.Coordinates co ON q.QuadratID = co.QuadratID
         LEFT JOIN stable_mpala.Site s ON q.PlotID = s.PlotID
GROUP BY q.QuadratID, q.PlotID, cq.CensusID, q.QuadratName, s.QDimX, s.QDimY, s.QUOM, q.Area, q.IsStandardShape, s.GUOM
ON DUPLICATE KEY UPDATE PlotID          = VALUES(PlotID),
                        CensusID        = VALUES(CensusID),
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
FROM stable_mpala.tree t
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
FROM stable_mpala.stem s
         LEFT JOIN stable_mpala.quadrat q ON q.QuadratID = s.QuadratID
         LEFT JOIN stable_mpala.Site si ON q.PlotID = si.PlotID
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
SELECT dbh.DBHID,
       dbh.CensusID,
       dbh.StemID,
       NULL,
       dbh.ExactDate,
       CAST(dbh.DBH AS DECIMAL(10, 6)),
       'cm',
       CAST(dbh.HOM AS DECIMAL(10, 6)),
       'm',
       LEFT(dbh.Comments, 65535),
       NULL
FROM stable_mpala.dbh dbh
ON DUPLICATE KEY UPDATE StemID            = VALUES(StemID),
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
FROM stable_mpala.datacollection dc
         JOIN stable_mpala.personnelrole pr ON dc.PersonnelRoleID = pr.PersonnelRoleID
ON DUPLICATE KEY UPDATE QuadratID   = VALUES(QuadratID),
                        PersonnelID = VALUES(PersonnelID),
                        CensusID    = VALUES(CensusID);

-- Insert into attributes with ON DUPLICATE KEY UPDATE
INSERT INTO attributes (Code, Description, Status)
SELECT ta.TSMCode,
       LEFT(ta.Description, 65535),
       IF(ta.Status IN ('alive', 'alive-not measured', 'dead', 'stem dead', 'broken below', 'omitted', 'missing'),
          ta.Status, NULL)
FROM stable_mpala.tsmattributes ta
GROUP BY ta.TSMCode, ta.Description, ta.Status
ON DUPLICATE KEY UPDATE Description = IF(VALUES(Description) != '', VALUES(Description), attributes.Description),
                        Status      = VALUES(Status);

-- Insert into cmattributes with ON DUPLICATE KEY UPDATE
INSERT INTO cmattributes (CMAID, CoreMeasurementID, Code)
SELECT dbha.DBHAttID, dbha.DBHID, ta.TSMCode
FROM stable_mpala.dbhattributes dbha
         JOIN stable_mpala.tsmattributes ta ON dbha.TSMID = ta.TSMID
ON DUPLICATE KEY UPDATE CoreMeasurementID = VALUES(CoreMeasurementID),
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
FROM stable_mpala.specimen sp
         LEFT JOIN stable_mpala.stem st ON st.TreeID = sp.TreeID
         LEFT JOIN stable_mpala.personnel pr ON sp.Collector = CONCAT(pr.FirstName, ' ', pr.LastName)
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
            'QX', NEW.QX,
            'QY', NEW.QY,
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
            'QX', OLD.QX,
            'QY', OLD.QY,
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
            'QX', NEW.QX,
            'QY', NEW.QY,
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
            'QX', OLD.QX,
            'QY', OLD.QY,
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

CREATE VIEW alltaxonomiesview AS
SELECT
    s.SpeciesID AS SpeciesID,
    f.FamilyID AS FamilyID,
    g.GenusID AS GenusID,
    r.ReferenceID AS ReferenceID,
    s.SpeciesCode AS SpeciesCode,
    f.Family AS Family,
    g.Genus AS Genus,
    g.GenusAuthority AS GenusAuthority,
    s.SpeciesName AS SpeciesName,
    s.SubspeciesName AS SubSpeciesName,
    s.IDLevel AS SpeciesIDLevel,
    s.SpeciesAuthority AS SpeciesAuthority,
    s.SubspeciesAuthority AS SubspeciesAuthority,
    s.ValidCode AS ValidCode,
    s.FieldFamily AS FieldFamily,
    s.Description AS SpeciesDescription,
    r.PublicationTitle AS PublicationTitle,
    r.FullReference AS FullReference,
    r.DateOfPublication AS DateOfPublication,
    r.Citation AS Citation
FROM
    family f
    JOIN genus g ON f.FamilyID = g.FamilyID
    JOIN species s ON g.GenusID = s.GenusID
    LEFT JOIN reference r ON s.ReferenceID = r.ReferenceID;


CREATE VIEW measurementssummaryview AS
SELECT
    cm.CoreMeasurementID AS CoreMeasurementID,
    p.PlotID AS PlotID,
    cm.CensusID AS CensusID,
    q.QuadratID AS QuadratID,
    s.SpeciesID AS SpeciesID,
    t.TreeID AS TreeID,
    st.StemID AS StemID,
    qp.PersonnelID AS PersonnelID,
    p.PlotName AS PlotName,
    q.QuadratName AS QuadratName,
    s.SpeciesCode AS SpeciesCode,
    t.TreeTag AS TreeTag,
    st.StemTag AS StemTag,
    st.LocalX AS StemLocalX,
    st.LocalY AS StemLocalY,
    st.CoordinateUnits AS StemUnits,
    COALESCE(CONCAT(pe.FirstName, ' ', pe.LastName), 'Unknown') AS PersonnelName,
    cm.MeasurementDate AS MeasurementDate,
    cm.MeasuredDBH AS MeasuredDBH,
    cm.DBHUnit AS DBHUnits,
    cm.MeasuredHOM AS MeasuredHOM,
    cm.HOMUnit AS HOMUnits,
    cm.IsValidated AS IsValidated,
    cm.Description AS Description,
    (SELECT GROUP_CONCAT(ca.Code SEPARATOR '; ')
     FROM cmattributes ca
     WHERE ca.CoreMeasurementID = cm.CoreMeasurementID) AS Attributes
FROM
    coremeasurements cm
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
GROUP BY
    cm.CoreMeasurementID, p.PlotID, cm.CensusID, q.QuadratID, s.SpeciesID, t.TreeID, st.StemID, qp.PersonnelID,
    p.PlotName, q.QuadratName, s.SpeciesCode, t.TreeTag, st.StemTag, st.LocalX, st.LocalY, st.CoordinateUnits,
    pe.FirstName, pe.LastName, cm.MeasurementDate, cm.MeasuredDBH, cm.DBHUnit, cm.MeasuredHOM, cm.HOMUnit,
    cm.IsValidated, cm.Description;


CREATE VIEW stemtaxonomiesview AS
SELECT
    s.StemID AS StemID,
    t.TreeID AS TreeID,
    q.QuadratID AS QuadratID,
    c.CensusID AS CensusID,
    p.PlotID AS PlotID,
    f.FamilyID AS FamilyID,
    g.GenusID AS GenusID,
    sp.SpeciesID AS SpeciesID,
    s.StemTag AS StemTag,
    t.TreeTag AS TreeTag,
    sp.SpeciesCode AS SpeciesCode,
    f.Family AS Family,
    g.Genus AS Genus,
    sp.SpeciesName AS SpeciesName,
    sp.SubspeciesName AS SubspeciesName,
    sp.ValidCode AS ValidCode,
    g.GenusAuthority AS GenusAuthority,
    sp.SpeciesAuthority AS SpeciesAuthority,
    sp.SubspeciesAuthority AS SubspeciesAuthority,
    sp.IDLevel AS SpeciesIDLevel,
    sp.FieldFamily AS SpeciesFieldFamily
FROM
    stems s
    JOIN trees t ON s.TreeID = t.TreeID
    JOIN quadrats q ON s.QuadratID = q.QuadratID
    JOIN census c ON q.CensusID = c.CensusID
    JOIN plots p ON c.PlotID = p.PlotID
    JOIN species sp ON t.SpeciesID = sp.SpeciesID
    JOIN genus g ON sp.GenusID = g.GenusID
    LEFT JOIN family f ON g.FamilyID = f.FamilyID;


CREATE VIEW viewfulltableview AS
SELECT
    cm.CoreMeasurementID AS CoreMeasurementID,
    cm.MeasurementDate AS MeasurementDate,
    cm.MeasuredDBH AS MeasuredDBH,
    cm.DBHUnit AS DBHUnits,
    cm.MeasuredHOM AS MeasuredHOM,
    cm.HOMUnit AS HOMUnits,
    cm.Description AS Description,
    cm.IsValidated AS IsValidated,
    p.PlotID AS PlotID,
    p.PlotName AS PlotName,
    p.LocationName AS LocationName,
    p.CountryName AS CountryName,
    p.DimensionX AS DimensionX,
    p.DimensionY AS DimensionY,
    p.Area AS PlotArea,
    p.GlobalX AS GlobalX,
    p.GlobalY AS GlobalY,
    p.GlobalZ AS GlobalZ,
    p.DimensionUnits AS PlotUnit,
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
    q.QuadratShape AS QuadratShape,
    q.DimensionUnits AS QuadratUnit,
    sq.SubquadratID AS SubquadratID,
    sq.SubquadratName AS SubquadratName,
    sq.DimensionX AS SubquadratDimensionX,
    sq.DimensionY AS SubquadratDimensionY,
    sq.QX AS QX,
    sq.QY AS QY,
    sq.CoordinateUnits AS SubquadratUnit,
    t.TreeID AS TreeID,
    t.TreeTag AS TreeTag,
    s.StemID AS StemID,
    s.StemTag AS StemTag,
    s.LocalX AS StemLocalX,
    s.LocalY AS StemLocalY,
    s.CoordinateUnits AS StemUnits,
    per.PersonnelID AS PersonnelID,
    per.FirstName AS FirstName,
    per.LastName AS LastName,
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
    fam.FamilyID AS FamilyID,
    fam.Family AS Family,
    attr.Code AS AttributeCode,
    attr.Description AS AttributeDescription,
    attr.Status AS AttributeStatus
FROM
    coremeasurements cm
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

create
    definer = azureroot@`%` procedure UpdateValidationStatus(IN p_PlotID int, IN p_CensusID int, OUT RowsValidated int)
BEGIN
    -- Create a temporary table to store CoreMeasurementIDs
    CREATE TEMPORARY TABLE IF NOT EXISTS TempUpdatedIDs (CoreMeasurementID INT);

    -- Clear the temporary table
    TRUNCATE TABLE TempUpdatedIDs;

    -- Insert the CoreMeasurementIDs of the rows to be updated into the temporary table
    INSERT INTO TempUpdatedIDs (CoreMeasurementID)
    SELECT cm.CoreMeasurementID
    FROM coremeasurements cm
    LEFT JOIN cmverrors cme ON cm.CoreMeasurementID = cme.CoreMeasurementID
    LEFT JOIN stems s on cm.StemID = s.StemID
    LEFT JOIN quadrats q on s.QuadratID = q.QuadratID
    WHERE cm.IsValidated = FALSE
      AND (q.PlotID = p_PlotID OR p_PlotID IS NULL)
      AND (q.CensusID = p_CensusID OR p_CensusID IS NULL)
      AND cme.CoreMeasurementID IS NULL;

    -- Update the IsValidated column
    UPDATE coremeasurements cm
    INNER JOIN TempUpdatedIDs tmp ON cm.CoreMeasurementID = tmp.CoreMeasurementID
    SET cm.IsValidated = TRUE;

    -- Get the count of rows that have been updated
    SET RowsValidated = ROW_COUNT();

    -- Select the CoreMeasurementIDs from the temporary table
    SELECT CoreMeasurementID FROM TempUpdatedIDs;

    -- Optionally, drop the temporary table
    DROP TEMPORARY TABLE IF EXISTS TempUpdatedIDs;
END;

create
    definer = azureroot@`%` procedure ValidateDBHGrowthExceedsMax(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE vPrevDBH DECIMAL(10, 2);
    DECLARE vCurrDBH DECIMAL(10, 2);
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE validationCriteria TEXT;
    DECLARE measuredValue VARCHAR(255);
    DECLARE expectedValueRange VARCHAR(255);
    DECLARE additionalDetails TEXT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE veID INT;
    DECLARE cur CURSOR FOR
        SELECT cm2.CoreMeasurementID, cm1.MeasuredDBH, cm2.MeasuredDBH
        FROM coremeasurements cm1
                 JOIN coremeasurements cm2
                      ON cm1.StemID = cm2.StemID
                          AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
                 LEFT JOIN stems st2 ON cm2.StemID = st2.StemID
                 LEFT JOIN quadrats q ON st2.QuadratID = q.QuadratID
                 LEFT JOIN cmattributes cma
                           ON cm1.CoreMeasurementID = cma.CoreMeasurementID
                 LEFT JOIN attributes a
                           ON cma.Code = a.Code
        WHERE (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR a.Status IS NULL)
          AND cm1.MeasuredDBH IS NOT NULL
          AND cm2.MeasuredDBH IS NOT NULL
          AND (cm2.MeasuredDBH - cm1.MeasuredDBH > 65)
          AND cm1.IsValidated IS TRUE
          AND cm2.IsValidated IS FALSE
          AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
          AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM coremeasurements cm1
             JOIN coremeasurements cm2
                      ON cm1.StemID = cm2.StemID
                          AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
                 LEFT JOIN stems st2 ON cm2.StemID = st2.StemID
                 LEFT JOIN quadrats q ON st2.QuadratID = q.QuadratID
                 LEFT JOIN cmattributes cma
                           ON cm1.CoreMeasurementID = cma.CoreMeasurementID
                 LEFT JOIN attributes a
                           ON cma.Code = a.Code
    WHERE (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR a.Status IS NULL)
      AND cm1.MeasuredDBH IS NOT NULL
      AND cm2.MeasuredDBH IS NOT NULL
      AND (cm2.MeasuredDBH - cm1.MeasuredDBH > 65)
      AND cm1.IsValidated IS TRUE
      AND cm2.IsValidated IS FALSE
      AND (p_CensusID = -1 OR q.CensusID = p_CensusID)
      AND (p_PlotID = -1 OR q.PlotID = p_PlotID);

    -- Fetch the ValidationErrorID for this stored procedure
    SELECT ValidationID
    INTO veID
    FROM catalog.validationprocedures
    WHERE ProcedureName = 'ValidateDBHGrowthExceedsMax';

    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID, vPrevDBH, vCurrDBH;
        IF done THEN
            LEAVE loop1;
        END IF;

        SET validationCriteria = 'Annual DBH Growth';
        SET measuredValue = CONCAT('Previous DBH: ', vPrevDBH, ', Current DBH: ', vCurrDBH);
        SET expectedValueRange = 'Growth <= 65';
        SET additionalDetails = 'Checked for excessive DBH growth over a year';

        IF vCurrDBH - vPrevDBH > 65 THEN
            SET validationResult = 0;
            SET errorMessage = 'Growth exceeds max threshold.';
            IF NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
            END IF;
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                         ValidationOutcome, ErrorMessage,
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                         AdditionalDetails)
        VALUES ('ValidateDBHGrowthExceedsMax', NOW(), vCoreMeasurementID,
                IF(validationResult, 'Passed', 'Failed'), errorMessage,
                validationCriteria, measuredValue, expectedValueRange,
                additionalDetails);
    END LOOP;
    CLOSE cur;

    SET successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount  AS TotalRows,
           insertCount    AS FailedRows,
           successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateDBHShrinkageExceedsMax(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE vPrevDBH DECIMAL(10, 2);
    DECLARE vCurrDBH DECIMAL(10, 2);
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE validationCriteria TEXT;
    DECLARE measuredValue VARCHAR(255);
    DECLARE expectedValueRange VARCHAR(255);
    DECLARE additionalDetails TEXT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE veID INT;
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT cm2.CoreMeasurementID, cm1.MeasuredDBH, cm2.MeasuredDBH
        FROM coremeasurements cm1
                 JOIN coremeasurements cm2
                      ON cm1.StemID = cm2.StemID
                          AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
                 LEFT JOIN stems st ON cm2.StemID = st.StemID
                 LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
                 LEFT JOIN cmattributes cma
                           ON cm1.CoreMeasurementID = cma.CoreMeasurementID
                 LEFT JOIN attributes a
                           ON cma.Code = a.Code
        WHERE (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR a.Status IS NULL)
          AND cm1.MeasuredDBH IS NOT NULL
          AND cm2.MeasuredDBH IS NOT NULL
          AND cm1.IsValidated IS TRUE
          AND cm2.IsValidated IS FALSE
          AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
          AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM coremeasurements cm1
             JOIN coremeasurements cm2
                  ON cm1.StemID = cm2.StemID
                      AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
             LEFT JOIN stems st ON cm2.StemID = st.StemID
             LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
             LEFT JOIN cmattributes cma
                       ON cm1.CoreMeasurementID = cma.CoreMeasurementID
             LEFT JOIN attributes a
                       ON cma.Code = a.Code
    WHERE (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR a.Status IS NULL)
      AND cm1.MeasuredDBH IS NOT NULL
      AND cm2.MeasuredDBH IS NOT NULL
      AND cm1.IsValidated IS TRUE
      AND cm2.IsValidated IS FALSE
      AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

    SELECT ValidationID
    INTO veID
    FROM catalog.validationprocedures
    WHERE ProcedureName = 'ValidateDBHShrinkageExceedsMax';

    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID, vPrevDBH, vCurrDBH;
        IF done THEN
            LEAVE loop1;
        END IF;

        SET validationCriteria = 'Annual DBH Shrinkage';
        SET measuredValue = CONCAT('Previous DBH: ', vPrevDBH, ', Current DBH: ', vCurrDBH);
        SET expectedValueRange = 'Shrinkage < 5% of previous DBH';
        SET additionalDetails = 'Checked for excessive DBH shrinkage over a year';

        IF vCurrDBH < vPrevDBH * 0.95 THEN
            SET validationResult = 0;
            SET errorMessage = 'Shrinkage exceeds maximum allowed threshold.';
            -- Check if the error record already exists before inserting
            IF NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
            END IF;
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                         ValidationOutcome, ErrorMessage,
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                         AdditionalDetails)
        VALUES ('ValidateDBHShrinkageExceedsMax', NOW(), vCoreMeasurementID,
                IF(validationResult, 'Passed', 'Failed'), errorMessage,
                validationCriteria, measuredValue, expectedValueRange,
                additionalDetails);
    END LOOP;
    CLOSE cur;

    SET successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateFindAllInvalidSpeciesCodes(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE vSpeciesID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE validationCriteria TEXT;
    DECLARE measuredValue VARCHAR(255);
    DECLARE expectedValueRange VARCHAR(255);
    DECLARE additionalDetails TEXT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE veID INT;
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT cm.CoreMeasurementID, sp.SpeciesID
        FROM stems s
                 JOIN trees t ON s.TreeID = t.TreeID
                 LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
                 JOIN coremeasurements cm ON s.StemID = cm.StemID
                 LEFT JOIN quadrats q ON s.QuadratID = q.QuadratID
        WHERE sp.SpeciesID IS NULL
          AND cm.IsValidated IS FALSE
          AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
          AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
        GROUP BY cm.CoreMeasurementID;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM stems s
             JOIN trees t ON s.TreeID = t.TreeID
             LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
             JOIN coremeasurements cm ON s.StemID = cm.StemID
             LEFT JOIN quadrats q ON s.QuadratID = q.QuadratID
         WHERE sp.SpeciesID IS NULL
        AND cm.IsValidated IS FALSE
        AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
        AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
    GROUP BY cm.CoreMeasurementID;

    SELECT ValidationID
    INTO veID
    FROM catalog.validationprocedures
    WHERE ProcedureName = 'ValidateFindAllInvalidSpeciesCodes';

    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID, vSpeciesID;
        IF done THEN
            LEAVE loop1;
        END IF;

        SET validationCriteria = 'Species Code Validation';
        SET measuredValue = CONCAT('Species ID: ', IFNULL(vSpeciesID, 'NULL'));
        SET expectedValueRange = 'Non-null and valid Species ID';
        SET additionalDetails = 'Checking for the existence of valid species codes for each measurement.';

        IF vSpeciesID IS NULL THEN
            SET validationResult = 0;
            SET errorMessage = 'Invalid species code detected.';
            -- Check if the error record already exists before inserting
            IF NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
            END IF;
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                         ValidationOutcome, ErrorMessage,
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                         AdditionalDetails)
        VALUES ('ValidateFindAllInvalidSpeciesCodes', NOW(), vCoreMeasurementID,
                IF(validationResult, 'Passed', 'Failed'), errorMessage,
                validationCriteria, measuredValue, expectedValueRange,
                additionalDetails);
    END LOOP;
    CLOSE cur;

    SET successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateFindDuplicateStemTreeTagCombinationsPerCensus(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE validationCriteria TEXT;
    DECLARE measuredValue VARCHAR(255);
    DECLARE expectedValueRange VARCHAR(255);
    DECLARE additionalDetails TEXT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE veID INT;
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT SubQuery.CoreMeasurementID
        FROM (SELECT cm.CoreMeasurementID
              FROM coremeasurements cm
                       INNER JOIN stems s ON cm.StemID = s.StemID
                       INNER JOIN trees t ON s.TreeID = t.TreeID
                       INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
              WHERE (p_CensusID IS NULL OR q.CensusID = p_CensusID)
                AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
                AND cm.IsValidated = FALSE
              GROUP BY q.CensusID, s.StemTag, t.TreeTag, cm.CoreMeasurementID
              HAVING COUNT(*) > 1) AS SubQuery;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM (SELECT cm.CoreMeasurementID
          FROM coremeasurements cm
                   INNER JOIN stems s ON cm.StemID = s.StemID
                   INNER JOIN trees t ON s.TreeID = t.TreeID
                   INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
          WHERE (p_CensusID IS NULL OR q.CensusID = p_CensusID)
            AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
            AND cm.IsValidated = FALSE
          GROUP BY q.CensusID, s.StemTag, t.TreeTag, cm.CoreMeasurementID
          HAVING COUNT(*) > 1) AS DuplicationCheck;

    SELECT ValidationID
    INTO veID
    FROM catalog.validationprocedures
    WHERE ProcedureName = 'ValidateFindDuplicateStemTreeTagCombinationsPerCensus';


    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;

        SET validationCriteria = 'Duplicate Stem-Tree Tag Combinations per Census';
        SET measuredValue = 'N/A';
        SET expectedValueRange = 'Unique Stem-Tree Tag Combinations';
        SET additionalDetails = 'Checking for duplicate stem and tree tag combinations in each census.';

        IF EXISTS (SELECT 1
                   FROM coremeasurements cm
                            INNER JOIN stems s ON cm.StemID = s.StemID
                            INNER JOIN trees t ON s.TreeID = t.TreeID
                            INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
                   WHERE cm.CoreMeasurementID = vCoreMeasurementID
                   GROUP BY q.CensusID, s.StemTag, t.TreeTag
                   HAVING COUNT(cm.CoreMeasurementID) > 1) THEN
            SET validationResult = 0;
            SET errorMessage = 'Duplicate stem and tree tag combination detected.';
            -- Check if the error record already exists before inserting
            IF NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
            END IF;
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                         ValidationOutcome, ErrorMessage,
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                         AdditionalDetails)
        VALUES ('ValidateFindDuplicateStemTreeTagCombinationsPerCensus', NOW(), vCoreMeasurementID,
                IF(validationResult, 'Passed', 'Failed'), errorMessage,
                validationCriteria, measuredValue, expectedValueRange,
                additionalDetails);
    END LOOP;
    CLOSE cur;

    SET successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateFindDuplicatedQuadratsByName(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE validationCriteria TEXT;
    DECLARE measuredValue VARCHAR(255);
    DECLARE expectedValueRange VARCHAR(255);
    DECLARE additionalDetails TEXT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE veID INT;
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT cm.CoreMeasurementID
        FROM quadrats q
                 LEFT JOIN stems st ON q.QuadratID = st.QuadratID
                 JOIN coremeasurements cm ON st.StemID = cm.StemID
        WHERE cm.IsValidated IS FALSE
          AND (q.PlotID, q.QuadratName) IN (SELECT PlotID, QuadratName
                                            FROM quadrats
                                            GROUP BY PlotID, QuadratName
                                            HAVING COUNT(*) > 1)
          AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
          AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
        GROUP BY cm.CoreMeasurementID;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM quadrats q
             LEFT JOIN stems st ON q.QuadratID = st.QuadratID
             JOIN coremeasurements cm ON st.StemID = cm.StemID
    WHERE cm.IsValidated IS FALSE
      AND (q.PlotID, q.QuadratName) IN (SELECT PlotID, QuadratName
                                        FROM quadrats
                                        GROUP BY PlotID, QuadratName
                                        HAVING COUNT(*) > 1)
      AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
    GROUP BY cm.CoreMeasurementID;

    SELECT ValidationID
    INTO veID
    FROM catalog.validationprocedures
    WHERE ProcedureName = 'ValidateFindDuplicatedQuadratsByName';

    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;

        SET validationCriteria = 'Quadrat Name Duplication';
        SET measuredValue = 'N/A';
        SET expectedValueRange = 'Unique Quadrat Names per Plot';
        SET additionalDetails = 'Checking for duplicated quadrat names within the same plot.';

        IF EXISTS (SELECT 1
                   FROM quadrats q
                   WHERE q.QuadratID = vCoreMeasurementID
                     AND (q.PlotID, q.QuadratName) IN (SELECT PlotID, QuadratName
                                                       FROM quadrats
                                                       GROUP BY PlotID, QuadratName
                                                       HAVING COUNT(*) > 1)) THEN
            SET validationResult = 0;
            SET errorMessage = 'Duplicated quadrat name detected.';
            -- Check if the error record already exists before inserting
            IF NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
            END IF;
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                         ValidationOutcome, ErrorMessage,
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                         AdditionalDetails)
        VALUES ('ValidateFindDuplicatedQuadratsByName', NOW(), vCoreMeasurementID,
                IF(validationResult, 'Passed', 'Failed'), errorMessage,
                validationCriteria, measuredValue, expectedValueRange,
                additionalDetails);
    END LOOP;
    CLOSE cur;

    SET successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE validationCriteria TEXT;
    DECLARE measuredValue VARCHAR(255);
    DECLARE expectedValueRange VARCHAR(255);
    DECLARE additionalDetails TEXT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE veID INT;
    DECLARE done INT DEFAULT FALSE;
    DECLARE cur CURSOR FOR
        SELECT MIN(cm.CoreMeasurementID) AS CoreMeasurementID
        FROM coremeasurements cm
                 JOIN stems st ON cm.StemID = st.StemID
                 JOIN quadrats q ON st.QuadratID = q.QuadratID
                 JOIN census c ON q.CensusID = c.CensusID
        WHERE (cm.MeasurementDate < c.StartDate OR cm.MeasurementDate > c.EndDate)
          AND cm.MeasurementDate IS NOT NULL
          AND cm.IsValidated IS FALSE
          AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
          AND (p_PlotID IS NULL OR c.PlotID = p_PlotID)
        GROUP BY q.QuadratID, c.CensusID, c.StartDate, c.EndDate;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM coremeasurements cm
             JOIN stems st ON cm.StemID = st.StemID
             JOIN quadrats q ON st.QuadratID = q.QuadratID
             JOIN census c ON q.CensusID = c.CensusID
    WHERE (cm.MeasurementDate < c.StartDate OR cm.MeasurementDate > c.EndDate)
      AND cm.MeasurementDate IS NOT NULL
      AND cm.IsValidated IS FALSE
      AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR c.PlotID = p_PlotID);

    SELECT ValidationID
    INTO veID
    FROM catalog.validationprocedures
    WHERE ProcedureName = 'ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat';


    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;

        SET validationCriteria = 'Measurement Date vs Census Date Bounds';
        SET measuredValue = 'Measurement Date';
        SET expectedValueRange = 'Within Census Start and End Dates';
        SET additionalDetails =
                'Checking if measurement dates fall within the start and end dates of their respective censuses.';

        IF EXISTS (SELECT 1
                   FROM coremeasurements cm
                            JOIN stems st ON cm.StemID = st.StemID
                            JOIN quadrats q ON st.QuadratID = q.QuadratID
                            JOIN census c ON q.CensusID = c.CensusID
                   WHERE cm.CoreMeasurementID = vCoreMeasurementID
                     AND (cm.MeasurementDate < c.StartDate OR cm.MeasurementDate > c.EndDate)) THEN
            SET validationResult = 0;
            SET errorMessage = 'Measurement outside census date bounds.';
            -- Check if the error record already exists before inserting
            IF NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
            END IF;
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                         ValidationOutcome, ErrorMessage,
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                         AdditionalDetails)
        VALUES ('ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat', NOW(), vCoreMeasurementID,
                IF(validationResult, 'Passed', 'Failed'), errorMessage,
                validationCriteria, measuredValue, expectedValueRange,
                additionalDetails);
    END LOOP;
    CLOSE cur;

    SET successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateFindStemsInTreeWithDifferentSpecies(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE validationCriteria TEXT;
    DECLARE measuredValue VARCHAR(255);
    DECLARE expectedValueRange VARCHAR(255);
    DECLARE additionalDetails TEXT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE veID INT;
    DECLARE done INT DEFAULT FALSE;

    DECLARE cur CURSOR FOR
        SELECT cm.CoreMeasurementID
        FROM coremeasurements cm
                 JOIN stems s ON cm.StemID = s.StemID
                 JOIN trees t ON s.TreeID = t.TreeID
                 JOIN quadrats q ON s.QuadratID = q.QuadratID
        WHERE cm.IsValidated = FALSE
          AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
          AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
        GROUP BY t.TreeID, cm.CoreMeasurementID
        HAVING COUNT(DISTINCT t.SpeciesID) > 1;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM coremeasurements cm
             JOIN stems s ON cm.StemID = s.StemID
             JOIN trees t ON s.TreeID = t.TreeID
             JOIN quadrats q ON s.QuadratID = q.QuadratID
    WHERE cm.IsValidated = FALSE
      AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
    GROUP BY t.TreeID
    HAVING COUNT(DISTINCT t.SpeciesID) > 1;

    SELECT ValidationID
    INTO veID
    FROM catalog.validationprocedures
    WHERE ProcedureName = 'ValidateFindStemsInTreeWithDifferentSpecies';


    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;

        SET validationCriteria = 'Each tree should have a consistent species across all its stems.';
        SET measuredValue = 'Species consistency across tree stems';
        SET expectedValueRange = 'One species per tree';
        SET additionalDetails = 'Checking if stems belonging to the same tree have different species IDs.';

        IF EXISTS (SELECT 1
                   FROM stems s
                            JOIN trees t ON s.TreeID = t.TreeID
                   WHERE t.TreeID IN (SELECT TreeID
                                      FROM stems
                                      WHERE StemID IN
                                            (SELECT StemID
                                             FROM coremeasurements
                                             WHERE CoreMeasurementID = vCoreMeasurementID))
                   GROUP BY t.TreeID
                   HAVING COUNT(DISTINCT t.SpeciesID) > 1) THEN
            SET validationResult = 0;
            SET errorMessage = 'Stems in the same tree have different species.';

            -- Check if the error record already exists before inserting
            IF NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
            END IF;
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                         ValidationOutcome, ErrorMessage,
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                         AdditionalDetails)
        VALUES ('ValidateFindStemsInTreeWithDifferentSpecies', NOW(), vCoreMeasurementID,
                IF(validationResult, 'Passed', 'Failed'), errorMessage,
                validationCriteria, measuredValue, expectedValueRange,
                additionalDetails);
    END LOOP;
    CLOSE cur;

    SET successMessage = CONCAT('Validation completed. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateFindStemsOutsidePlots(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE validationCriteria TEXT;
    DECLARE measuredValue VARCHAR(255);
    DECLARE expectedValueRange VARCHAR(255);
    DECLARE additionalDetails TEXT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE veID INT;
    DECLARE done INT DEFAULT FALSE;

    DECLARE cur CURSOR FOR
        SELECT cm.CoreMeasurementID
        FROM stems s
                 INNER JOIN coremeasurements cm ON s.StemID = cm.StemID
                 INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
                 INNER JOIN plots p ON q.PlotID = p.PlotID
        WHERE (s.LocalX > p.DimensionX OR s.LocalX > p.DimensionY)
          AND s.LocalX IS NOT NULL
          AND s.LocalY IS NOT NULL
          AND (p.DimensionX > 0 AND p.DimensionY > 0)
          AND cm.IsValidated IS FALSE
          AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
          AND (p_PlotID IS NULL OR q.PlotID = p_PlotID)
        GROUP BY cm.CoreMeasurementID;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM stems s
             INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
             INNER JOIN plots p ON q.PlotID = p.PlotID
             INNER JOIN coremeasurements cm ON s.StemID = cm.StemID
    WHERE (s.LocalX > p.DimensionX OR s.LocalX > p.DimensionY)
      AND s.LocalX IS NOT NULL
      AND s.LocalY IS NOT NULL
      AND (p.DimensionX > 0 AND p.DimensionY > 0)
      AND cm.IsValidated IS FALSE
      AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

    SELECT ValidationID
    INTO veID
    FROM catalog.validationprocedures
    WHERE ProcedureName = 'ValidateFindStemsOutsidePlots';


    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;

        SET validationCriteria = 'Stem Placement within Plot Boundaries';
        SET measuredValue = 'Stem Plot Coordinates';
        SET expectedValueRange = 'Within Plot Dimensions';
        SET additionalDetails = 'Validating whether stems are located within the specified plot dimensions.';

        IF EXISTS (SELECT 1
                   FROM stems s
                            INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
                            INNER JOIN plots p ON q.PlotID = p.PlotID
                   WHERE s.StemID IN
                         (SELECT StemID
                          FROM coremeasurements
                          WHERE CoreMeasurementID = vCoreMeasurementID)
                     AND (s.LocalX > p.DimensionX OR s.LocalY > p.DimensionY)) THEN
            SET validationResult = 0;
            SET errorMessage = 'Stem is outside plot dimensions.';
            -- Check if the error record already exists before inserting
            IF NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
            END IF;
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                         ValidationOutcome, ErrorMessage,
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                         AdditionalDetails)
        VALUES ('ValidateFindStemsOutsidePlots', NOW(), vCoreMeasurementID,
                IF(validationResult, 'Passed', 'Failed'), errorMessage,
                validationCriteria, measuredValue, expectedValueRange,
                additionalDetails);
    END LOOP;
    CLOSE cur;

    SET successMessage = CONCAT('Validation completed. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateFindTreeStemsInDifferentQuadrats(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE validationCriteria TEXT;
    DECLARE measuredValue VARCHAR(255);
    DECLARE expectedValueRange VARCHAR(255);
    DECLARE additionalDetails TEXT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE veID INT;
    DECLARE done INT DEFAULT FALSE;

    DECLARE cur CURSOR FOR
        SELECT cm1.CoreMeasurementID
        FROM stems s1
                 JOIN stems s2 ON s1.TreeID = s2.TreeID AND s1.StemID != s2.StemID
                 JOIN quadrats q1 ON s1.QuadratID = q1.QuadratID
                 JOIN quadrats q2 ON s2.QuadratID = q2.QuadratID
                 JOIN coremeasurements cm1 ON s1.StemID = cm1.StemID
        WHERE q1.QuadratID != q2.QuadratID
          AND cm1.IsValidated IS FALSE
          AND (p_CensusID IS NULL OR q1.CensusID = p_CensusID)
          AND (p_PlotID IS NULL OR q1.PlotID = p_PlotID)
        GROUP BY cm1.CoreMeasurementID;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    IF p_CensusID IS NULL THEN
        SET p_CensusID = -1;
    END IF;
    IF p_PlotID IS NULL THEN
        SET p_PlotID = -1;
    END IF;

    SELECT COUNT(*)
    INTO expectedCount
    FROM stems s1
             JOIN stems s2 ON s1.TreeID = s2.TreeID AND s1.StemID != s2.StemID
             JOIN quadrats q1 ON s1.QuadratID = q1.QuadratID
             JOIN quadrats q2 ON s2.QuadratID = q2.QuadratID
             JOIN coremeasurements cm1 ON s1.StemID = cm1.StemID
    WHERE q1.QuadratID != q2.QuadratID
      AND cm1.IsValidated IS FALSE
      AND (p_CensusID IS NULL OR q1.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR q1.PlotID = p_PlotID)
    GROUP BY cm1.CoreMeasurementID;

    SELECT ValidationID
    INTO veID
    FROM catalog.validationprocedures
    WHERE ProcedureName = 'ValidateFindTreeStemsInDifferentQuadrats';


    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;

        SET validationCriteria = 'Stem Quadrat Consistency within Trees';
        SET measuredValue = 'Quadrat IDs of Stems';
        SET expectedValueRange = 'Consistent Quadrat IDs for all Stems in a Tree';
        SET additionalDetails = 'Validating that all stems within the same tree are located in the same quadrat.';

        IF EXISTS (SELECT 1
                   FROM stems s1
                            JOIN stems s2 ON s1.TreeID = s2.TreeID AND s1.StemID != s2.StemID
                            JOIN quadrats q1 on q1.QuadratID = s2.QuadratID
                            JOIN quadrats q2 on q2.QuadratID = s2.QuadratID
                   WHERE s1.StemID IN
                         (SELECT StemID
                          FROM coremeasurements
                          WHERE CoreMeasurementID = vCoreMeasurementID)
                     AND q1.QuadratID != q2.QuadratID) THEN
            SET validationResult = 0;
            SET errorMessage = 'Stems in the same tree are in different quadrats.';
            -- Check if the error record already exists before inserting
            IF NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
            END IF;
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                         ValidationOutcome, ErrorMessage,
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                         AdditionalDetails)
        VALUES ('ValidateFindTreeStemsInDifferentQuadrats', NOW(), vCoreMeasurementID,
                IF(validationResult, 'Passed', 'Failed'), errorMessage,
                validationCriteria, measuredValue, expectedValueRange,
                additionalDetails);
    END LOOP;
    CLOSE cur;

    SET successMessage = CONCAT('Validation completed. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateHOMUpperAndLowerBounds(IN p_CensusID int, IN p_PlotID int,
                                                                     IN minHOM decimal(10, 2), IN maxHOM decimal(10, 2))
BEGIN
    DECLARE defaultMinHOM DECIMAL(10, 2);
    DECLARE defaultMaxHOM DECIMAL(10, 2);
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE validationCriteria TEXT;
    DECLARE measuredValue VARCHAR(255);
    DECLARE expectedValueRange VARCHAR(255);
    DECLARE additionalDetails TEXT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE veID INT;
    DECLARE done INT DEFAULT FALSE;

    DECLARE cur CURSOR FOR
        SELECT cm.CoreMeasurementID
        FROM coremeasurements cm
            LEFT JOIN stems st ON cm.StemID = st.StemID
            LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
        WHERE (
            (minHOM IS NOT NULL AND MeasuredHOM < minHOM) OR
            (maxHOM IS NOT NULL AND MeasuredHOM > maxHOM) OR
            (minHOM IS NULL AND maxHOM IS NULL)
            )
          AND IsValidated IS FALSE
          AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
          AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    SELECT COUNT(*)
    INTO expectedCount
    FROM coremeasurements cm
        LEFT JOIN stems st ON cm.StemID = st.StemID
        LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
    WHERE (
        (minHOM IS NOT NULL AND MeasuredHOM < minHOM) OR
        (maxHOM IS NOT NULL AND MeasuredHOM > maxHOM) OR
        (minHOM IS NULL AND maxHOM IS NULL)
        )
      AND IsValidated IS FALSE
      AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

    SELECT ValidationID
    INTO veID
    FROM catalog.validationprocedures
    WHERE ProcedureName = 'ValidateHOMUpperAndLowerBounds';


    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;

        IF done THEN
            LEAVE loop1;
        END IF;

        IF minHOM IS NULL OR maxHOM IS NULL THEN
            SELECT COALESCE(sl.LowerBound, 0)    AS defaultMinHOM,
                   COALESCE(sl.UpperBound, 9999) AS defaultMaxHOM
            INTO defaultMinHOM, defaultMaxHOM
            FROM specieslimits sl
                     JOIN species s ON sl.SpeciesCode = s.SpeciesCode
                     JOIN trees t ON s.SpeciesID = t.SpeciesID
                     JOIN stems st ON t.TreeID = st.TreeID
                     JOIN coremeasurements cm ON st.StemID = cm.StemID
            WHERE cm.CoreMeasurementID = vCoreMeasurementID
              AND sl.LimitType = 'HOM';

            SET minHOM = COALESCE(minHOM, defaultMinHOM);
            SET maxHOM = COALESCE(maxHOM, defaultMaxHOM);
        END IF;

        SET validationCriteria = 'HOM Measurement Range Validation';
        SET measuredValue = CONCAT('Measured HOM: ', (SELECT MeasuredHOM
                                                      FROM coremeasurements
                                                      WHERE CoreMeasurementID = vCoreMeasurementID));
        SET expectedValueRange = CONCAT('Expected HOM Range: ', minHOM, ' - ', maxHOM);
        SET additionalDetails = 'Checks if the measured HOM falls within the specified minimum and maximum range.';

        IF (SELECT MeasuredHOM
            FROM coremeasurements
            WHERE CoreMeasurementID = vCoreMeasurementID
              AND (
                (minHOM IS NOT NULL AND MeasuredHOM < minHOM) OR
                (maxHOM IS NOT NULL AND MeasuredHOM > maxHOM) OR
                (minHOM IS NULL AND maxHOM IS NULL)
                )) THEN
            SET validationResult = 0;
            SET errorMessage = CONCAT('HOM outside bounds: ', minHOM, ' - ', maxHOM);
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
            -- Check if the error record already exists before inserting
            IF NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
            END IF;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                         ValidationOutcome, ErrorMessage,
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                         AdditionalDetails)
        VALUES ('ValidateHOMUpperAndLowerBounds', NOW(), vCoreMeasurementID,
                IF(validationResult, 'Passed', 'Failed'), errorMessage,
                validationCriteria, measuredValue, expectedValueRange,
                additionalDetails);
    END LOOP;
    CLOSE cur;

    SET successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateScreenMeasuredDiameterMinMax(IN p_CensusID int, IN p_PlotID int,
                                                                           IN minDBH decimal(10, 2),
                                                                           IN maxDBH decimal(10, 2))
BEGIN
    DECLARE defaultMinDBH DECIMAL(10, 2);
    DECLARE defaultMaxDBH DECIMAL(10, 2);
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE validationCriteria TEXT;
    DECLARE measuredValue VARCHAR(255);
    DECLARE expectedValueRange VARCHAR(255);
    DECLARE additionalDetails TEXT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE veID INT;
    DECLARE done INT DEFAULT FALSE;

    DECLARE cur CURSOR FOR
        SELECT cm.CoreMeasurementID
        FROM coremeasurements cm
            LEFT JOIN stems st ON cm.StemID = st.StemID
            LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
        WHERE (
            (MeasuredDBH < 0) OR
            (maxDBH IS NOT NULL AND MeasuredDBH > maxDBH) OR
            (minDBH IS NULL AND maxDBH IS NULL)
            )
          AND IsValidated IS FALSE
          AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
          AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    SELECT COUNT(*)
    INTO expectedCount
    FROM coremeasurements cm
        LEFT JOIN stems st ON cm.StemID = st.StemID
        LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
    WHERE (
        (MeasuredDBH < 0) OR
        (maxDBH IS NOT NULL AND MeasuredDBH > maxDBH) OR
        (minDBH IS NULL AND maxDBH IS NULL)
        )
      AND IsValidated IS FALSE
      AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

    SELECT ValidationID
    INTO veID
    FROM catalog.validationprocedures
    WHERE ProcedureName = 'ValidateScreenMeasuredDiameterMinMax';


    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;

        IF done THEN
            LEAVE loop1;
        END IF;

        IF minDBH IS NULL OR maxDBH IS NULL THEN
            SELECT COALESCE(sl.LowerBound, 0)    AS defaultMinDBH,
                   COALESCE(sl.UpperBound, 9999) AS defaultMaxDBH
            INTO defaultMinDBH, defaultMaxDBH
            FROM specieslimits sl
                     JOIN species s ON sl.SpeciesCode = s.SpeciesCode
                     JOIN trees t ON s.SpeciesID = t.SpeciesID
                     JOIN stems st ON t.TreeID = st.TreeID
                     JOIN coremeasurements cm ON st.StemID = cm.StemID
            WHERE cm.CoreMeasurementID = vCoreMeasurementID
              AND sl.LimitType = 'DBH';

            SET minDBH = COALESCE(minDBH, defaultMinDBH);
            SET maxDBH = COALESCE(maxDBH, defaultMaxDBH);
        END IF;

        SET validationCriteria = 'DBH Measurement Range Validation';
        SET measuredValue = CONCAT('Measured DBH: ', (SELECT MeasuredDBH
                                                      FROM coremeasurements
                                                      WHERE CoreMeasurementID = vCoreMeasurementID));
        SET expectedValueRange = CONCAT('Expected DBH Range: ', minDBH, ' - ', maxDBH);
        SET additionalDetails = 'Checks if the measured DBH falls within the specified minimum and maximum range.';

        IF (SELECT MeasuredDBH
            FROM coremeasurements
            WHERE CoreMeasurementID = vCoreMeasurementID
              AND (
                (MeasuredDBH < 0) OR
                (maxDBH IS NOT NULL AND MeasuredDBH > maxDBH) OR
                (minDBH IS NULL AND maxDBH IS NULL)
                )) THEN
            SET validationResult = 0;
            SET errorMessage = CONCAT('DBH outside bounds: ', minDBH, ' - ', maxDBH);
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
            -- Check if the error record already exists before inserting
            IF NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
            END IF;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                         ValidationOutcome, ErrorMessage,
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,
                                         AdditionalDetails)
        VALUES ('ValidateScreenMeasuredDiameterMinMax', NOW(), vCoreMeasurementID,
                IF(validationResult, 'Passed', 'Failed'), errorMessage,
                validationCriteria, measuredValue, expectedValueRange,
                additionalDetails);
    END LOOP;
    CLOSE cur;

    SET successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

create
    definer = azureroot@`%` procedure ValidateScreenStemsWithMeasurementsButDeadAttributes(IN p_CensusID int, IN p_PlotID int)
BEGIN
    DECLARE vCoreMeasurementID INT;
    DECLARE validationResult BIT;
    DECLARE errorMessage VARCHAR(255);
    DECLARE validationCriteria TEXT;
    DECLARE additionalDetails TEXT;
    DECLARE insertCount INT DEFAULT 0;
    DECLARE expectedCount INT;
    DECLARE successMessage VARCHAR(255);
    DECLARE done INT DEFAULT FALSE;
    DECLARE veID INT;
    DECLARE vExistingErrorID INT;

    DECLARE cur CURSOR FOR
        SELECT cm.CoreMeasurementID
        FROM coremeasurements cm
                 JOIN cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
                 JOIN attributes a ON cma.Code = a.Code
                 JOIN stems st ON cm.StemID = st.StemID
                 JOIN quadrats q ON st.QuadratID = q.QuadratID
        WHERE ((cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR
               (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0))
          AND a.Status IN ('dead', 'stem dead', 'missing', 'broken below', 'omitted')
          AND cm.IsValidated IS FALSE
          AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
          AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations
    (
        CoreMeasurementID INT
    );

    SELECT COUNT(*)
    INTO expectedCount
    FROM coremeasurements cm
             JOIN cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
             JOIN attributes a ON cma.Code = a.Code
             JOIN stems st ON cm.StemID = st.StemID
             JOIN quadrats q ON st.QuadratID = q.QuadratID
    WHERE ((cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR
           (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0))
      AND a.Status IN ('dead', 'stem dead', 'missing', 'broken below', 'omitted')
      AND cm.IsValidated IS FALSE
      AND (p_CensusID IS NULL OR q.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR q.PlotID = p_PlotID);

    SELECT ValidationID
    INTO veID
    FROM catalog.validationprocedures
    WHERE ProcedureName = 'ValidateScreenStemsWithMeasurementsButDeadAttributes';


    OPEN cur;
    loop1:
    LOOP
        FETCH cur INTO vCoreMeasurementID;
        IF done THEN
            LEAVE loop1;
        END IF;

        SET validationCriteria = 'Stem Measurements with Dead Attributes Validation';
        SET additionalDetails = 'Verifies that stems marked as dead do not have active measurements.';

        IF EXISTS (SELECT 1
                   FROM cmattributes cma
                            JOIN attributes a ON cma.Code = a.Code
                            JOIN coremeasurements cm on cma.CoreMeasurementID = cm.CoreMeasurementID
                   WHERE cma.CoreMeasurementID = vCoreMeasurementID
                     AND a.Status IN ('dead', 'stem dead', 'missing', 'broken below', 'omitted')
                     AND ((cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR
                          (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0))) THEN
            SET validationResult = 0;
            SET errorMessage = 'Stem with measurements but dead attributes detected.';
            -- Check if the error record already exists before inserting
            IF NOT EXISTS (SELECT 1
                           FROM cmverrors
                           WHERE CoreMeasurementID = vCoreMeasurementID
                             AND ValidationErrorID = veID) THEN
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                VALUES (vCoreMeasurementID, veID);
            END IF;
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);
            SET insertCount = insertCount + 1;
        ELSE
            SET validationResult = 1;
            SET errorMessage = NULL;
        END IF;

        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,
                                         ValidationOutcome, ErrorMessage,
                                         ValidationCriteria, AdditionalDetails)
        VALUES ('ValidateScreenStemsWithMeasurementsButDeadAttributes', NOW(), vCoreMeasurementID,
                IF(validationResult, 'Passed', 'Failed'), errorMessage,
                validationCriteria, additionalDetails);
    END LOOP;
    CLOSE cur;

    SET successMessage =
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;

    SELECT CoreMeasurementID FROM FailedValidations;

    DROP TEMPORARY TABLE IF EXISTS FailedValidations;
END;

