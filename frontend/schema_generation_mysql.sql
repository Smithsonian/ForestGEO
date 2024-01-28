create table forestgeo_bci.attributes
(
    Code        varchar(10) not null,
    Description text        null,
    Status      varchar(20) null,
    primary key (Code)
);

create table forestgeo_bci.measurementtypes
(
    MeasurementTypeID          int auto_increment
        primary key,
    MeasurementTypeDescription varchar(255) null
);

create table forestgeo_bci.personnel
(
    PersonnelID int auto_increment
        primary key,
    FirstName   varchar(50)  null,
    LastName    varchar(50)  null,
    Role        varchar(150) null
);

create table forestgeo_bci.plots
(
    PlotID          int auto_increment
        primary key,
    PlotName        text  null,
    LocationName    text  null,
    CountryName     text  null,
    DimensionX      int   null,
    DimensionY      int   null,
    Area            float null,
    PlotX           float null,
    PlotY           float null,
    PlotZ           float null,
    PlotShape       text  null,
    PlotDescription text  null
);

create table forestgeo_bci.census
(
    CensusID         int auto_increment
        primary key,
    PlotID           int  null,
    StartDate        date null,
    EndDate          date null,
    Description      text null,
    PlotCensusNumber int  null,
    constraint Census_Plots_PlotID_fk
        foreign key (PlotID) references forestgeo_bci.plots (PlotID)
            on update cascade
);

create table forestgeo_bci.quadrats
(
    QuadratID    int auto_increment
        primary key,
    PlotID       int   null,
    PersonnelID  int   null,
    QuadratName  text  null,
    QuadratX     float null,
    QuadratY     float null,
    QuadratZ     float null,
    DimensionX   int   null,
    DimensionY   int   null,
    Area         float null,
    QuadratShape text  null,
    constraint Quadrats_Personnel_fk
        foreign key (PersonnelID) references forestgeo_bci.personnel (PersonnelID),
    constraint Quadrats_Plots_FK
        foreign key (PlotID) references forestgeo_bci.plots (PlotID)
);

create table forestgeo_bci.reference
(
    ReferenceID       int auto_increment
        primary key,
    PublicationTitle  varchar(64) null,
    FullReference     text        null,
    DateOfPublication date        null,
    Citation          varchar(50) null
);

create table forestgeo_bci.family
(
    FamilyID    int auto_increment
        primary key,
    Family      varchar(32) null,
    ReferenceID int         null,
    constraint Family_Reference_ReferenceID_fk
        foreign key (ReferenceID) references forestgeo_bci.reference (ReferenceID)
);

create table forestgeo_bci.genus
(
    GenusID     int auto_increment
        primary key,
    FamilyID    int         null,
    GenusName   varchar(32) null,
    ReferenceID int         null,
    Authority   varchar(32) null,
    constraint Genus_Family_FamilyID_fk
        foreign key (FamilyID) references forestgeo_bci.family (FamilyID),
    constraint Genus_Reference_ReferenceID_fk
        foreign key (ReferenceID) references forestgeo_bci.reference (ReferenceID)
);

create table forestgeo_bci.species
(
    SpeciesID         int auto_increment
        primary key,
    GenusID           int          null,
    CurrentTaxonFlag  bit          null,
    ObsoleteTaxonFlag bit          null,
    SpeciesName       varchar(64)  null,
    IDLevel           varchar(8)   null,
    Authority         varchar(128) null,
    FieldFamily       varchar(32)  null,
    Description       text         null,
    ReferenceID       int          null,
    SpeciesCode       varchar(25)  null,
    constraint Species_Genus_GenusID_fk
        foreign key (GenusID) references forestgeo_bci.genus (GenusID),
    constraint Species_Reference_ReferenceID_fk
        foreign key (ReferenceID) references forestgeo_bci.reference (ReferenceID)
);

create table forestgeo_bci.currentobsolete
(
    SpeciesID         int  not null,
    ObsoleteSpeciesID int  not null,
    ChangeDate        date not null,
    ChangeCodeID      int  null,
    ChangeNote        text null,
    primary key (SpeciesID, ObsoleteSpeciesID, ChangeDate),
    constraint CurrentObsolete_Species_SpeciesID_fk
        foreign key (SpeciesID) references forestgeo_bci.species (SpeciesID),
    constraint CurrentObsolete_Species_SpeciesID_fk2
        foreign key (ObsoleteSpeciesID) references forestgeo_bci.species (SpeciesID)
);

create table forestgeo_bci.speciesinventory
(
    SpeciesInventoryID int auto_increment
        primary key,
    CensusID           int null,
    PlotID             int null,
    SpeciesID          int null,
    SubSpeciesID       int null,
    constraint SpeciesInventory_Plots_PlotID_fk
        foreign key (PlotID) references forestgeo_bci.plots (PlotID)
);

create table forestgeo_bci.subspecies
(
    SubSpeciesID       int auto_increment
        primary key,
    SubSpeciesCode     varchar(10)  null,
    SpeciesID          int          null,
    CurrentTaxonFlag   bit          null,
    ObsoleteTaxonFlag  bit          null,
    SubSpeciesName     text         null,
    Authority          varchar(128) null,
    InfraSpecificLevel char(32)     null,
    constraint SubSpecies_Species_SpeciesID_fk
        foreign key (SpeciesID) references forestgeo_bci.species (SpeciesID)
            on update cascade
);

create table forestgeo_bci.trees
(
    TreeID       int auto_increment
        primary key,
    TreeTag      varchar(10) null,
    SpeciesID    int         null,
    SubSpeciesID int         null,
    constraint Trees_Species_SpeciesID_fk
        foreign key (SpeciesID) references forestgeo_bci.species (SpeciesID)
            on update cascade,
    constraint Trees_SubSpecies_SubSpeciesID_fk
        foreign key (SubSpeciesID) references forestgeo_bci.subspecies (SubSpeciesID)
);

create table forestgeo_bci.stems
(
    StemID          int auto_increment
        primary key,
    TreeID          int         null,
    QuadratID       int         null,
    StemNumber      int         null,
    StemTag         varchar(10) null,
    TreeTag         varchar(10) null,
    StemX           float       null,
    StemY           float       null,
    StemZ           float       null,
    Moved           bit         null,
    StemDescription text        null,
    constraint FK_Stems_Quadrats
        foreign key (QuadratID) references forestgeo_bci.quadrats (QuadratID)
            on update cascade,
    constraint FK_Stems_Trees
        foreign key (TreeID) references forestgeo_bci.trees (TreeID)
            on update cascade
);

create table forestgeo_bci.coremeasurements
(
    CoreMeasurementID int auto_increment
        primary key,
    CensusID          int            null,
    PlotID            int            null,
    QuadratID         int            null,
    TreeID            int            null,
    StemID            int            null,
    PersonnelID       int            null,
    IsRemeasurement   bit            null,
    IsCurrent         bit            null,
    MeasurementDate   date           null,
    MeasuredDBH       decimal(10, 2) null,
    MeasuredHOM       decimal(10, 2) null,
    Description       text           null,
    UserDefinedFields text           null,
    constraint CoreMeasurements_Census_CensusID_fk
        foreign key (CensusID) references forestgeo_bci.census (CensusID)
            on update cascade,
    constraint CoreMeasurements_Personnel_PersonnelID_fk
        foreign key (PersonnelID) references forestgeo_bci.personnel (PersonnelID)
            on update cascade,
    constraint CoreMeasurements_Plots_PlotID_fk
        foreign key (PlotID) references forestgeo_bci.plots (PlotID),
    constraint CoreMeasurements_Quadrats_QuadratID_fk
        foreign key (QuadratID) references forestgeo_bci.quadrats (QuadratID),
    constraint FK_CoreMeasurements_Stems
        foreign key (StemID) references forestgeo_bci.stems (StemID),
    constraint FK_CoreMeasurements_Trees
        foreign key (TreeID) references forestgeo_bci.trees (TreeID)
);

create table forestgeo_bci.cmattributes
(
    CMAID             int auto_increment
        primary key,
    CoreMeasurementID int         null,
    Code              varchar(10) null,
    constraint CMAttributes_Attributes_Code_fk
        foreign key (Code) references forestgeo_bci.attributes (Code),
    constraint CMAttributes_CoreMeasurements_CoreMeasurementID_fk
        foreign key (CoreMeasurementID) references forestgeo_bci.coremeasurements (CoreMeasurementID)
);

create table forestgeo_bci.validationerrors
(
    ValidationErrorID          int auto_increment
        primary key,
    ValidationErrorDescription text null
);

create table forestgeo_bci.cmverrors
(
    CMVErrorID        int auto_increment
        primary key,
    CoreMeasurementID int null,
    ValidationErrorID int null,
    constraint CMVErrors_CoreMeasurements_CoreMeasurementID_fk
        foreign key (CoreMeasurementID) references forestgeo_bci.coremeasurements (CoreMeasurementID)
            on update cascade,
    constraint CMVErrors_ValidationErrors_ValidationErrorID_fk
        foreign key (ValidationErrorID) references forestgeo_bci.validationerrors (ValidationErrorID)
            on update cascade
);

create
    definer = azureroot@`%` procedure forestgeo_bci.MigrateDBHtoCoreMeasurements()
BEGIN
    -- Declare variables
    DECLARE vCensusID INT;
    DECLARE vStemID INT;
    DECLARE vDBH DECIMAL(10, 2); -- Ensure compatibility with the table definition
    DECLARE vHOM DECIMAL(10, 2); -- Ensure compatibility with the table definition
    DECLARE vExactDate DATE;
    DECLARE vComments VARCHAR(128);
    DECLARE vPlotID INT;
    DECLARE vQuadratID INT;
    DECLARE vTreeID INT;
    DECLARE vIsRemeasurement TINYINT(1);
    DECLARE vRowCount INT DEFAULT 0;
    DECLARE vMaxRows INT; -- Variable to store the maximum number of rows to insert
    DECLARE done INT DEFAULT FALSE;

    -- Declare a cursor for a simulated FULL OUTER JOIN result set from dbh and remeasurements
    DECLARE combinedCursor CURSOR FOR
        SELECT d.CensusID, d.StemID, d.DBH, d.HOM, d.ExactDate, d.Comments, 0 AS IsRemeasurement
        FROM ctfsweb.dbh d
        LEFT JOIN ctfsweb.remeasurement r ON d.StemID = r.StemID AND d.CensusID = r.CensusID
        UNION
        SELECT r.CensusID, r.StemID, r.DBH, r.HOM, r.ExactDate, NULL AS Comments, 1 AS IsRemeasurement
        FROM ctfsweb.remeasurement r
        LEFT JOIN ctfsweb.dbh d ON d.StemID = r.StemID AND d.CensusID = r.CensusID
        WHERE d.StemID IS NULL
        ORDER BY StemID, ExactDate;

    -- Declare the continue handler
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- Set the maximum number of rows to insert (e.g., 100)
    SET vMaxRows = 2756583;

    -- Reset auto-increment of CoreMeasurements to 1
    ALTER TABLE forestgeo_bci.CoreMeasurements AUTO_INCREMENT = 1;

    -- Open the combined cursor
    OPEN combinedCursor;

    -- Loop through all rows in the combined result set
    combined_loop:
    LOOP
        -- Check if the row count has reached the maximum limit
        IF vRowCount >= vMaxRows THEN
            LEAVE combined_loop;
        END IF;

        -- Fetch next row from cursor
        FETCH combinedCursor INTO vCensusID, vStemID, vDBH, vHOM, vExactDate, vComments, vIsRemeasurement;
        IF done THEN
            LEAVE combined_loop;
        END IF;

        -- Retrieve PlotID, QuadratID, and TreeID from forestgeo_bci
        SELECT stems.TreeID,
               stems.QuadratID,
               census.PlotID
        INTO vTreeID, vQuadratID, vPlotID
        FROM forestgeo_bci.Stems AS stems
        JOIN forestgeo_bci.Census AS census ON census.CensusID = vCensusID
        WHERE stems.StemID = vStemID;

        -- Insert a row for DBH measurement or remeasurement
        INSERT INTO forestgeo_bci.CoreMeasurements (CensusID, PlotID, QuadratID, TreeID, StemID, MeasuredDBH,
                                                    MeasuredHOM, MeasurementDate, Description, IsRemeasurement, IsCurrent)
        VALUES (vCensusID, vPlotID, vQuadratID, vTreeID, vStemID, CAST(vDBH AS DECIMAL(10, 2)), CAST(vHOM AS DECIMAL(10, 2)), vExactDate, vComments, vIsRemeasurement, FALSE);

        -- Increment the row count
        SET vRowCount = vRowCount + 1;
    END LOOP;

    -- Close the cursor
    CLOSE combinedCursor;

    -- Update the IsCurrent field for the most recent measurement of each stem
    UPDATE forestgeo_bci.CoreMeasurements cm
    INNER JOIN (
        SELECT MAX(CoreMeasurementID) AS LatestMeasurementID, StemID
        FROM forestgeo_bci.CoreMeasurements
        GROUP BY StemID
    ) AS latest ON cm.CoreMeasurementID = latest.LatestMeasurementID
    SET cm.IsCurrent = TRUE;
END;

create
    definer = azureroot@`%` procedure forestgeo_bci.checkDuplicateStemTreeTagCombinations()
BEGIN
    DECLARE done INT DEFAULT FALSE;
    DECLARE vCoreMeasurementID INT;
    DECLARE vStemTag VARCHAR(10);
    DECLARE vTreeTag VARCHAR(10);
    DECLARE vValidationErrorID INT;
    DECLARE vErrorMessage VARCHAR(255) DEFAULT 'Duplicate combination of StemTag and TreeTag';

    -- Cursor for CoreMeasurements
    DECLARE coreMeasurementsCursor CURSOR FOR
        SELECT cm.CoreMeasurementID, s.StemTag, t.TreeTag
        FROM forestgeo_bci.coremeasurements cm
        JOIN forestgeo_bci.stems s ON cm.StemID = s.StemID
        JOIN forestgeo_bci.trees t ON cm.TreeID = t.TreeID;

    -- Continue handler for 'no more rows' condition
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

    -- Insert the validation error description into ValidationErrors
    INSERT INTO forestgeo_bci.validationerrors (ValidationErrorDescription)
    VALUES (vErrorMessage);

    SET vValidationErrorID = LAST_INSERT_ID();

    OPEN coreMeasurementsCursor;

    -- Loop through all rows in CoreMeasurements
    validation_loop: LOOP
        FETCH coreMeasurementsCursor INTO vCoreMeasurementID, vStemTag, vTreeTag;
        IF done THEN
            LEAVE validation_loop;
        END IF;

        -- Check for duplicate combination of StemTag and TreeTag
        IF EXISTS (
            SELECT 1
            FROM forestgeo_bci.coremeasurements cm
            JOIN forestgeo_bci.stems s ON cm.StemID = s.StemID
            JOIN forestgeo_bci.trees t ON cm.TreeID = t.TreeID
            WHERE s.StemTag = vStemTag AND t.TreeTag = vTreeTag
            GROUP BY s.StemTag, t.TreeTag
            HAVING COUNT(*) > 1
        ) THEN
            -- Insert CoreMeasurementID and ValidationErrorID into CMVErrors
            INSERT INTO forestgeo_bci.cmverrors (CoreMeasurementID, ValidationErrorID)
            VALUES (vCoreMeasurementID, vValidationErrorID);
        END IF;

    END LOOP;

    CLOSE coreMeasurementsCursor;
END;

create
    definer = azureroot@`%` procedure forestgeo_bci.updatePlotDimensions()
BEGIN
    DECLARE done INT DEFAULT FALSE;
    DECLARE vPlotID INT;
    DECLARE vPlotShape TEXT;
    DECLARE totalX, totalY INT;
    DECLARE currentIndex, nextIndex INT;
    DECLARE currentDimension TEXT;
    DECLARE cur CURSOR FOR SELECT PlotID, PlotShape FROM forestgeo_bci.plots;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    OPEN cur;

    read_loop: LOOP
        FETCH cur INTO vPlotID, vPlotShape;
        IF done THEN
            LEAVE read_loop;
        END IF;

        -- Initialize total dimensions
        SET totalX = 0;
        SET totalY = 0;

        IF vPlotShape REGEXP '[0-9]+x[0-9]+' THEN
            SET currentIndex = 1;

            -- Find each dimension match
            repeat
                SET nextIndex = LOCATE('x', vPlotShape, currentIndex);
                IF nextIndex = 0 THEN
                    LEAVE read_loop;
                END IF;
                SET currentDimension = SUBSTRING(vPlotShape, currentIndex, nextIndex - currentIndex);
                SET totalX = totalX + CAST(SUBSTRING_INDEX(currentDimension, 'x', 1) AS UNSIGNED);
                SET totalY = totalY + CAST(SUBSTRING_INDEX(currentDimension, 'x', -1) AS UNSIGNED);
                SET currentIndex = nextIndex + 1;
            UNTIL nextIndex = 0 END REPEAT;
            
            -- Update the plot dimensions
            UPDATE forestgeo_bci.plots SET DimensionX = totalX, DimensionY = totalY WHERE PlotID = vPlotID;
        END IF;
    END LOOP;

    CLOSE cur;
END;


