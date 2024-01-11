-- USE forestgeo;
-- GO

-- Attributes Table
CREATE TABLE forestgeo.Attributes
(
    Code        VARCHAR(10) NOT NULL
        CONSTRAINT Attributes_pk
            PRIMARY KEY,
    Description VARCHAR(MAX),
    Status      VARCHAR(20)
);
GO

-- MeasurementTypes Table
CREATE TABLE forestgeo.MeasurementTypes
(
    MeasurementTypeID          INT IDENTITY (1,1) PRIMARY KEY NOT NULL,
    MeasurementTypeDescription VARCHAR(255)
);
GO

-- Personnel Table
CREATE TABLE forestgeo.Personnel
(
    PersonnelID INT IDENTITY (1,1) PRIMARY KEY NOT NULL,
    FirstName   VARCHAR(50),
    LastName    VARCHAR(50),
    Role        VARCHAR(150)
);
GO

-- Plots Table
CREATE TABLE forestgeo.Plots
(
    PlotID          INT IDENTITY (1,1) PRIMARY KEY NOT NULL,
    PlotName        VARCHAR(MAX),
    LocationName    VARCHAR(MAX),
    CountryName     VARCHAR(MAX),
    Area            FLOAT,
    PlotX           FLOAT,
    PlotY           FLOAT,
    PlotZ           FLOAT,
    PlotShape       VARCHAR(MAX),
    PlotDescription VARCHAR(MAX)
);
GO

-- Census Table
CREATE TABLE forestgeo.Census
(
    CensusID         INT IDENTITY (1,1) PRIMARY KEY NOT NULL,
    PlotID           INT
        CONSTRAINT Census_Plots_PlotID_fk
            REFERENCES forestgeo.Plots (PlotID)
            ON UPDATE CASCADE,
    StartDate        DATE,
    EndDate          DATE,
    Description      VARCHAR(MAX),
    PlotCensusNumber INT
);
GO

-- Quadrats Table
CREATE TABLE forestgeo.Quadrats
(
    QuadratID    INT IDENTITY (1,1) PRIMARY KEY NOT NULL,
    PlotID       INT
        CONSTRAINT Quadrats_Plots_FK
            REFERENCES forestgeo.Plots (PlotID),
    PersonnelID  INT
        CONSTRAINT Quadrats_Personnel_fk
            REFERENCES forestgeo.Personnel (PersonnelID),
    QuadratName  VARCHAR(MAX),
    QuadratX     FLOAT,
    QuadratY     FLOAT,
    QuadratZ     FLOAT,
    DimensionX   INT,
    DimensionY   INT,
    Area         FLOAT,
    QuadratShape VARCHAR(MAX)
);
GO

-- Reference Table
CREATE TABLE forestgeo.Reference
(
    ReferenceID       INT IDENTITY (1,1) PRIMARY KEY NOT NULL,
    PublicationTitle  VARCHAR(64),
    FullReference     VARCHAR(MAX),
    DateOfPublication DATE,
    Citation          VARCHAR(50)
);
GO

-- Family Table
CREATE TABLE forestgeo.Family
(
    FamilyID    INT IDENTITY (1,1) PRIMARY KEY NOT NULL,
    Family      VARCHAR(32),
    ReferenceID INT
        CONSTRAINT Family_Reference_ReferenceID_fk
            REFERENCES forestgeo.Reference (ReferenceID)
);
GO

-- Genus Table
CREATE TABLE forestgeo.Genus
(
    GenusID     INT IDENTITY (1,1) PRIMARY KEY NOT NULL,
    FamilyID    INT
        CONSTRAINT Genus_Family_FamilyID_fk
            REFERENCES forestgeo.Family (FamilyID),
    GenusName   VARCHAR(32),
    ReferenceID INT
        CONSTRAINT Genus_Reference_ReferenceID_fk
            REFERENCES forestgeo.Reference (ReferenceID),
    Authority   VARCHAR(32)
);
GO

-- Species Table
CREATE TABLE forestgeo.Species
(
    SpeciesID         INT IDENTITY (1,1) PRIMARY KEY NOT NULL,
    GenusID           INT
        CONSTRAINT Species_Genus_GenusID_fk
            REFERENCES forestgeo.Genus (GenusID),
    CurrentTaxonFlag  BIT,
    ObsoleteTaxonFlag BIT,
    SpeciesName       VARCHAR(64),
    IDLevel           VARCHAR(8),
    Authority         VARCHAR(128),
    FieldFamily       VARCHAR(32),
    Description       VARCHAR(MAX),
    ReferenceID       INT
        CONSTRAINT Species_Reference_ReferenceID_fk
            REFERENCES forestgeo.Reference (ReferenceID),
    SpeciesCode       VARCHAR(25)
);
GO

-- CurrentObsolete Table
CREATE TABLE forestgeo.CurrentObsolete
(
    SpeciesID         INT  NOT NULL
        CONSTRAINT CurrentObsolete_Species_SpeciesID_fk
            REFERENCES forestgeo.Species (SpeciesID),
    ObsoleteSpeciesID INT  NOT NULL
        CONSTRAINT CurrentObsolete_Species_SpeciesID_fk2
            REFERENCES forestgeo.Species (SpeciesID),
    ChangeDate        DATE NOT NULL,
    ChangeCodeID      INT,
    ChangeNote        VARCHAR(MAX),
    CONSTRAINT CurrentObsolete_pk
        PRIMARY KEY (SpeciesID, ObsoleteSpeciesID, ChangeDate)
);
GO

-- SpeciesInventory Table
CREATE TABLE forestgeo.SpeciesInventory
(
    SpeciesInventoryID INT IDENTITY (1,1) PRIMARY KEY NOT NULL,
    CensusID           INT,
    PlotID             INT
        CONSTRAINT SpeciesInventory_Plots_PlotID_fk
            REFERENCES forestgeo.Plots (PlotID),
    SpeciesID          INT,
    SubSpeciesID       INT
);
GO

-- SubSpecies Table
CREATE TABLE forestgeo.SubSpecies
(
    SubSpeciesID       INT IDENTITY (1,1) PRIMARY KEY NOT NULL,
    SubSpeciesCode     VARCHAR(10),
    SpeciesID          INT
        CONSTRAINT SubSpecies_Species_SpeciesID_fk
            REFERENCES forestgeo.Species (SpeciesID)
            ON UPDATE CASCADE,
    CurrentTaxonFlag   BIT,
    ObsoleteTaxonFlag  BIT,
    SubSpeciesName     VARCHAR(MAX),
    Authority          VARCHAR(128),
    InfraSpecificLevel CHAR(32)
);
GO

-- Trees Table
CREATE TABLE forestgeo.Trees
(
    TreeID       INT IDENTITY (1,1) PRIMARY KEY NOT NULL,
    TreeTag      VARCHAR(10),
    SpeciesID    INT
        CONSTRAINT Trees_Species_SpeciesID_fk
            REFERENCES forestgeo.Species (SpeciesID)
            ON UPDATE CASCADE,
    SubSpeciesID INT
        CONSTRAINT Trees_SubSpecies_SubSpeciesID_fk
            REFERENCES forestgeo.SubSpecies (SubSpeciesID)
);
GO

-- Stems Table
CREATE TABLE forestgeo.Stems
(
    StemID          INT IDENTITY (1,1) PRIMARY KEY NOT NULL,
    TreeID          INT
        CONSTRAINT FK_Stems_Trees
            REFERENCES forestgeo.Trees (TreeID)
            ON UPDATE CASCADE,
    QuadratID       INT
        CONSTRAINT FK_Stems_Quadrats
            REFERENCES forestgeo.Quadrats (QuadratID)
            ON UPDATE CASCADE,
    StemNumber      INT,
    StemTag         VARCHAR(10),
    TreeTag         VARCHAR(10),
    StemX           FLOAT,
    StemY           FLOAT,
    StemZ           FLOAT,
    Moved           BIT,
    StemDescription VARCHAR(MAX)
);
GO

-- CoreMeasurements Table
CREATE TABLE forestgeo.CoreMeasurements
(
    CoreMeasurementID INT IDENTITY (1,1) PRIMARY KEY NOT NULL,
    CensusID          INT
        CONSTRAINT CoreMeasurements_Census_CensusID_fk
            REFERENCES forestgeo.Census (CensusID)
            ON UPDATE CASCADE,
    PlotID            INT
        CONSTRAINT CoreMeasurements_Plots_PlotID_fk
            REFERENCES forestgeo.Plots (PlotID),
    QuadratID         INT
        CONSTRAINT CoreMeasurements_Quadrats_QuadratID_fk
            REFERENCES forestgeo.Quadrats (QuadratID),
    TreeID            INT
        CONSTRAINT FK_CoreMeasurements_Trees
            REFERENCES forestgeo.Trees (TreeID),
    StemID            INT
        CONSTRAINT FK_CoreMeasurements_Stems
            REFERENCES forestgeo.Stems (StemID),
    PersonnelID       INT
        CONSTRAINT CoreMeasurements_Personnel_PersonnelID_fk
            REFERENCES forestgeo.Personnel (PersonnelID)
            ON UPDATE CASCADE,
    MeasurementTypeID INT
        CONSTRAINT CoreMeasurements_MeasurementTypes_MeasurementTypeID_fk
            REFERENCES forestgeo.MeasurementTypes (MeasurementTypeID)
            ON UPDATE CASCADE,
    MeasurementDate   DATE,
    Measurement       VARCHAR(MAX),
    IsRemeasurement   BIT,
    IsCurrent         BIT,
    UserDefinedFields VARCHAR(MAX)
);
GO

-- CMAttributes Table
CREATE TABLE forestgeo.CMAttributes
(
    CMAID             INT IDENTITY (1,1) PRIMARY KEY NOT NULL,
    CoreMeasurementID INT
        CONSTRAINT CMAttributes_CoreMeasurements_CoreMeasurementID_fk
            REFERENCES forestgeo.CoreMeasurements (CoreMeasurementID)
            ON UPDATE CASCADE,
    Code              VARCHAR(10)
        CONSTRAINT CMAttributes_Attributes_Code_fk
            REFERENCES forestgeo.Attributes (Code)
            ON UPDATE CASCADE
);
GO

-- ValidationErrors Table
CREATE TABLE forestgeo.ValidationErrors
(
    ValidationErrorID          INT IDENTITY (1,1) PRIMARY KEY NOT NULL,
    ValidationErrorDescription VARCHAR(MAX)
);
GO

-- CMVErrors Table
CREATE TABLE forestgeo.CMVErrors
(
    CMVErrorID        INT IDENTITY (1,1) PRIMARY KEY NOT NULL,
    CoreMeasurementID INT
        CONSTRAINT CMVErrors_CoreMeasurements_CoreMeasurementID_fk
            REFERENCES forestgeo.CoreMeasurements (CoreMeasurementID)
            ON UPDATE CASCADE,
    ValidationErrorID INT
        CONSTRAINT CMVErrors_ValidationErrors_ValidationErrorID_fk
            REFERENCES forestgeo.ValidationErrors (ValidationErrorID)
            ON UPDATE CASCADE
);
GO
