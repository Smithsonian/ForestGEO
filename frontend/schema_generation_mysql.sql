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
    CoreMeasurementID   int auto_increment
        primary key,
    CensusID            int  null,
    PlotID              int  null,
    QuadratID           int  null,
    TreeID              int  null,
    StemID              int  null,
    PersonnelID         int  null,
    MeasurementTypeID   int  null,
    MeasurementDate     date null,
    Measurement         text null,
    IsRemeasurement     bit  null,
    IsCurrent           bit  null,
    UserDefinedFields   text null,
    Description         text null,
    MasterMeasurementID int  null,
    constraint CoreMeasurements_Census_CensusID_fk
        foreign key (CensusID) references forestgeo_bci.census (CensusID)
            on update cascade,
    constraint CoreMeasurements_MeasurementTypes_MeasurementTypeID_fk
        foreign key (MeasurementTypeID) references forestgeo_bci.measurementtypes (MeasurementTypeID)
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
        foreign key (TreeID) references forestgeo_bci.trees (TreeID),
    constraint coremeasurements_coremeasurements_CoreMeasurementID_fk
        foreign key (MasterMeasurementID) references forestgeo_bci.coremeasurements (CoreMeasurementID)
);

create table forestgeo_bci.cmattributes
(
    CMAID             int auto_increment
        primary key,
    CoreMeasurementID int         null,
    Code              varchar(10) null,
    constraint CMAttributes_Attributes_Code_fk
        foreign key (Code) references forestgeo_bci.attributes (Code)
            on update cascade,
    constraint CMAttributes_CoreMeasurements_CoreMeasurementID_fk
        foreign key (CoreMeasurementID) references forestgeo_bci.coremeasurements (CoreMeasurementID)
            on update cascade
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
    -- Declare variables to hold data from ctfsweb.dbh
    DECLARE vCensusID INT;
    DECLARE vStemID INT;
    DECLARE vDBH FLOAT;
    DECLARE vHOM FLOAT;
    DECLARE vExactDate DATE;
    DECLARE vComments VARCHAR(128);
    DECLARE vPlotID INT;
    DECLARE vQuadratID INT;
    DECLARE vTreeID INT;
    DECLARE vLastCoreMeasurementID INT;
    DECLARE vRowCount INT DEFAULT 0;
    DECLARE done INT DEFAULT FALSE;

    DECLARE dbhCursor CURSOR FOR
        SELECT CensusID, StemID, DBH, HOM, ExactDate, Comments
        FROM ctfsweb.dbh;

    -- Declare the continue handler
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    -- Reset auto-increment of CoreMeasurements to 1
    ALTER TABLE forestgeo_bci.CoreMeasurements
        AUTO_INCREMENT = 1;

    -- Open the cursor
    OPEN dbhCursor;

    -- Loop through all rows in ctfsweb.dbh
    read_loop:
    LOOP
        -- Fetch next row from cursor
        FETCH dbhCursor INTO vCensusID, vStemID, vDBH, vHOM, vExactDate, vComments;
        IF done OR vRowCount >= 100000 THEN
            LEAVE read_loop;
        END IF;

        -- Retrieve PlotID, QuadratID, and TreeID from forestgeo_bci
        SELECT stems.TreeID,
               stems.QuadratID,
               census.PlotID
        INTO
            vTreeID,
            vQuadratID,
            vPlotID
        FROM forestgeo_bci.Stems AS stems
                 JOIN
             forestgeo_bci.Census AS census ON census.CensusID = vCensusID
        WHERE stems.StemID = vStemID;

        -- Insert a row for DBH measurement
        INSERT INTO forestgeo_bci.CoreMeasurements (CensusID, PlotID, QuadratID, TreeID, StemID, MeasurementTypeID,
                                                    Measurement, MeasurementDate, Description)
        VALUES (vCensusID, vPlotID, vQuadratID, vTreeID, vStemID, 1, CAST(vDBH AS CHAR), vExactDate, vComments);
        SET vLastCoreMeasurementID = LAST_INSERT_ID();

        -- Insert a row for HOM measurement
        INSERT INTO forestgeo_bci.CoreMeasurements (CensusID, PlotID, QuadratID, TreeID, StemID, MeasurementTypeID,
                                                    Measurement, MasterMeasurementID, MeasurementDate, Description)
        VALUES (vCensusID, vPlotID, vQuadratID, vTreeID, vStemID, 2, CAST(vHOM AS CHAR), vLastCoreMeasurementID,
                vExactDate, vComments);

        -- Increment row count
        SET vRowCount = vRowCount + 1;
    END LOOP;

    -- Close the cursor
    CLOSE dbhCursor;
END;

