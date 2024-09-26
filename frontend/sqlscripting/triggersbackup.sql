#
attributes triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
plots triggers
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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
census triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
quadrats triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
reference triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
family triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
genus triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
roles triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
personnel triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
quadratpersonnel triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
species triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
specieslimits triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
subquadrats triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
trees triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
stems triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
coremeasurements triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
cmattributes triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
cmverrors triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
specimens triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

#
validationchangelog triggers

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

DELIMITER;

DELIMITER
//

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

DELIMITER;

DELIMITER
//

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

DELIMITER;
