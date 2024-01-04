create table Attributes
(
    Code        varchar(10) not null
        constraint Attributes_pk
            primary key,
    Description varchar(max
) ,
    Status      varchar(5)
) go

create table MeasurementTypes
(
    MeasurementTypeID          int not null
        constraint MeasurementTypes_pk
            primary key,
    MeasurementTypeDescription int
)
    go

create table Personnel
(
    PersonnelID int not null
        constraint Personnel_pk
            primary key,
    FirstName   varchar(50),
    LastName    varchar(50),
    Role        varchar(50)
)
    go

create table Plots
(
    PlotID   int not null
        constraint PlotID_PK
            primary key,
    PlotName varchar(max
) ,
    LocationName    varchar(max),
    CountryName     varchar(max),
    Area            float,
    PlotX           float,
    PlotY           float,
    PlotZ           float,
    PlotShape       varchar(max),
    PlotDescription varchar(max)
) go

create table Census
(
    CensusID         int not null
        constraint Census_pk
            primary key,
    PlotID           int
        constraint Census_Plots_PlotID_fk
            references Plots,
    PlotCensusNumber varchar(16),
    StartDate        date,
    EndDate          date,
    Description      varchar(max
)
    ) go

create table Quadrats
(
    QuadratID   int not null
        constraint Quadrats_PK
            primary key,
    PlotID      int
        constraint Quadrats_Plots_FK
            references Plots,
    PersonnelID int
        constraint Quadrats_Personnel_fk
            references Personnel,
    QuadratName varchar(max
) ,
    QuadratX     float,
    QuadratY     float,
    QuadratZ     float,
    DimensionX   int,
    DimensionY   int,
    Area         float,
    QuadratShape varchar(max)
) go

create table Reference
(
    ReferenceID      int not null
        constraint Reference_pk
            primary key,
    PublicationTitle varchar(64),
    FullReference    varchar(max
) ,
    DateOfPublication date
) go

create table Family
(
    FamilyID    int not null
        constraint Family_pk
            primary key,
    Family      varchar(32),
    ReferenceID int
        constraint Family_Reference_ReferenceID_fk
            references Reference
)
    go

create table Genus
(
    GenusID     int not null
        constraint Genus_pk
            primary key,
    FamilyID    int
        constraint Genus_Family_FamilyID_fk
            references Family,
    GenusName   varchar(32),
    ReferenceID int
        constraint Genus_Reference_ReferenceID_fk
            references Reference,
    Authority   varchar(32)
)
    go

create table Species
(
    SpeciesID         int not null
        constraint PK_Species
            primary key,
    GenusID           int
        constraint Species_Genus_GenusID_fk
            references Genus,
    CurrentTaxonFlag  bit,
    ObsoleteTaxonFlag bit,
    SpeciesName       varchar(64),
    SpeciesCode       varchar(64),
    IDLevel           varchar(8),
    Authority         varchar(128),
    FieldFamily       varchar(32),
    Description       varchar(max
) ,
    ReferenceID       int
        constraint Species_Reference_ReferenceID_fk
            references Reference
) go

create table CurrentObsolete
(
    SpeciesID         int  not null
        constraint FK_CurrentObsolete_Species
            references Species,
    ObsoleteSpeciesID int  not null
        constraint FK_CurrentObsolete_Species_Obsolete
            references Species,
    ChangeDate        date not null,
    ChangeCodeID      int,
    ChangeNote        varchar(max
) not null,
    constraint CurrentObsolete_pk
        primary key (SpeciesID, ObsoleteSpeciesID, ChangeDate)
) go

create table SubSpecies
(
    SubSpeciesID       int not null
        constraint PK_SubSpecies
            primary key,
    SpeciesID          int
        constraint FK_SubSpecies_Species
            references Species,
    SubSpeciesName     varchar(64),
    SubSpeciesCode     varchar(64),
    CurrentTaxonFlag   bit,
    ObsoleteTaxonFlag  bit,
    Authority          varchar(128),
    InfraSpecificLevel char(32)
)
    go

create table SpeciesInventory
(
    SpeciesInventoryID int not null
        constraint SpeciesInventory_pk
            primary key,
    CensusID           int
        constraint SpeciesInventory_Census_CensusID_fk
            references Census,
    PlotID             int
        constraint SpeciesInventory_Plots_PlotID_fk
            references Plots,
    SpeciesID          int
        constraint FK_SpeciesInventory_Species
            references Species,
    SubSpeciesID       int
        constraint FK_SpeciesInventory_SubSpecies
            references SubSpecies
)
    go

create table Trees
(
    TreeID    int not null
        constraint PK_Trees
            primary key,
    TreeTag   varchar(10),
    SpeciesID int
        constraint FK_Trees_Species
            references Species
)
    go

create table Stems
(
    StemID          int not null
        constraint PK_Stems
            primary key,
    TreeID          int
        constraint FK_Stems_Trees
            references Trees,
    QuadratID       int
        constraint FK_Stems_Quadrats
            references Quadrats,
    StemNumber      int,
    StemTag         int,
    TreeTag         int,
    StemX           float,
    StemY           float,
    StemZ           float,
    Moved           bit,
    StemDescription varchar(max
)
    ) go

create table CoreMeasurements
(
    CoreMeasurementID int not null
        constraint CoreMeasurements_pk
            primary key,
    CensusID          int
        constraint CoreMeasurements_Census_CensusID_fk
            references Census,
    PlotID            int
        constraint CoreMeasurements_Plots_PlotID_fk
            references Plots,
    QuadratID         int
        constraint CoreMeasurements_Quadrats_QuadratID_fk
            references Quadrats,
    TreeID            int
        constraint FK_CoreMeasurements_Trees
            references Trees,
    StemID            int
        constraint FK_CoreMeasurements_Stems
            references Stems,
    PersonnelID       int
        constraint CoreMeasurements_Personnel_PersonnelID_fk
            references Personnel,
    MeasurementTypeID int
        constraint CoreMeasurements_MeasurementTypes_MeasurementTypeID_fk
            references MeasurementTypes,
    MeasurementDate   date,
    Measurement       varchar(max
) ,
    IsRemeasurement   bit,
    IsCurrent         bit,
    UserDefinedFields varchar(max)
) go

create table CMAttributes
(
    CMAID             int not null
        constraint CMAttributes_pk
            primary key,
    CoreMeasurementID int
        constraint CMAttributes_CoreMeasurements_CoreMeasurementID_fk
            references CoreMeasurements,
    Code              varchar(10)
        constraint CMAttributes_Attributes_Code_fk
            references Attributes
)
    go

create table ValidationErrors
(
    ValidationErrorID          int not null
        constraint ValidationErrors_pk
            primary key,
    ValidationErrorDescription varchar(max
)
    ) go

create table CMVErrors
(
    CMVErrorID        int not null
        constraint CMVErrors_pk
            primary key,
    CoreMeasurementID int
        constraint CMVErrors_CoreMeasurements_CoreMeasurementID_fk
            references CoreMeasurements,
    ValidationErrorID int
        constraint CMVErrors_ValidationErrors_ValidationErrorID_fk
            references ValidationErrors
)
    go


