create table forestgeo.Attributes
(
    Code        varchar(10) not null
        constraint Attributes_pk
            primary key,
    Description varchar(max),
    Status      varchar(20)
)
go

create table forestgeo.MeasurementTypes
(
    MeasurementTypeID          int not null
        constraint MeasurementTypes_pk
            primary key,
    MeasurementTypeDescription varchar(255)
)
go

create table forestgeo.Personnel
(
    PersonnelID int not null
        constraint Personnel_pk
            primary key,
    FirstName   varchar(50),
    LastName    varchar(50),
    Role        varchar(150)
)
go

create table forestgeo.Plots
(
    PlotID          int not null
        constraint PlotID_PK
            primary key,
    PlotName        varchar(max),
    LocationName    varchar(max),
    CountryName     varchar(max),
    Area            float,
    PlotX           float,
    PlotY           float,
    PlotZ           float,
    PlotShape       varchar(max),
    PlotDescription varchar(max)
)
go

create table forestgeo.Census
(
    CensusID         int not null
        constraint Census_pk
            primary key,
    PlotID           int
        constraint Census_Plots_PlotID_fk
            references forestgeo.Plots
            on update cascade,
    StartDate        date,
    EndDate          date,
    Description      varchar(max),
    PlotCensusNumber int
)
go

create table forestgeo.Quadrats
(
    QuadratID    int not null
        constraint Quadrats_PK
            primary key,
    PlotID       int
        constraint Quadrats_Plots_FK
            references forestgeo.Plots,
    PersonnelID  int
        constraint Quadrats_Personnel_fk
            references forestgeo.Personnel,
    QuadratName  varchar(max),
    QuadratX     float,
    QuadratY     float,
    QuadratZ     float,
    DimensionX   int,
    DimensionY   int,
    Area         float,
    QuadratShape varchar(max)
)
go

create table forestgeo.Reference
(
    ReferenceID       int not null
        constraint Reference_pk
            primary key,
    PublicationTitle  varchar(64),
    FullReference     varchar(max),
    DateOfPublication date,
    Citation          varchar(50)
)
go

create table forestgeo.Family
(
    FamilyID    int not null
        constraint Family_pk
            primary key,
    Family      varchar(32),
    ReferenceID int
        constraint Family_Reference_ReferenceID_fk
            references forestgeo.Reference
)
go

create table forestgeo.Genus
(
    GenusID     int not null
        constraint Genus_pk
            primary key,
    FamilyID    int
        constraint Genus_Family_FamilyID_fk
            references forestgeo.Family,
    GenusName   varchar(32),
    ReferenceID int
        constraint Genus_Reference_ReferenceID_fk
            references forestgeo.Reference,
    Authority   varchar(32)
)
go

create table forestgeo.Species
(
    SpeciesID         int not null
        constraint Species_pk
            primary key,
    GenusID           int
        constraint Species_Genus_GenusID_fk
            references forestgeo.Genus,
    CurrentTaxonFlag  bit,
    ObsoleteTaxonFlag bit,
    SpeciesName       varchar(64),
    IDLevel           varchar(8),
    Authority         varchar(128),
    FieldFamily       varchar(32),
    Description       varchar(max),
    ReferenceID       int
        constraint Species_Reference_ReferenceID_fk
            references forestgeo.Reference,
    SpeciesCode       varchar(25)
)
go

create table forestgeo.CurrentObsolete
(
    SpeciesID         int  not null
        constraint CurrentObsolete_Species_SpeciesID_fk
            references forestgeo.Species,
    ObsoleteSpeciesID int  not null
        constraint CurrentObsolete_Species_SpeciesID_fk2
            references forestgeo.Species,
    ChangeDate        date not null,
    ChangeCodeID      int,
    ChangeNote        varchar(max),
    constraint CurrentObsolete_pk
        primary key (SpeciesID, ObsoleteSpeciesID, ChangeDate)
)
go

create table forestgeo.SpeciesInventory
(
    SpeciesInventoryID int not null
        constraint SpeciesInventory_pk
            primary key,
    CensusID           int,
    PlotID             int
        constraint SpeciesInventory_Plots_PlotID_fk
            references forestgeo.Plots,
    SpeciesID          int,
    SubSpeciesID       int
)
go

create table forestgeo.SubSpecies
(
    SubSpeciesID       int not null
        constraint SubSpecies_pk
            primary key,
    SubSpeciesCode     varchar(10),
    SpeciesID          int
        constraint SubSpecies_Species_SpeciesID_fk
            references forestgeo.Species
            on update cascade,
    CurrentTaxonFlag   bit,
    ObsoleteTaxonFlag  bit,
    SubSpeciesName     varchar(max),
    Authority          varchar(128),
    InfraSpecificLevel char(32)
)
go

create table forestgeo.Trees
(
    TreeID       int not null
        constraint PK_Trees
            primary key,
    TreeTag      varchar(10),
    SpeciesID    int
        constraint Trees_Species_SpeciesID_fk
            references forestgeo.Species
            on update cascade,
    SubSpeciesID int
        constraint Trees_SubSpecies_SubSpeciesID_fk
            references forestgeo.SubSpecies
)
go

create table forestgeo.Stems
(
    StemID          int not null
        constraint PK_Stems
            primary key,
    TreeID          int
        constraint FK_Stems_Trees
            references forestgeo.Trees
            on update cascade,
    QuadratID       int
        constraint FK_Stems_Quadrats
            references forestgeo.Quadrats
            on update cascade,
    StemNumber      int,
    StemTag         varchar(10),
    TreeTag         varchar(10),
    StemX           float,
    StemY           float,
    StemZ           float,
    Moved           bit,
    StemDescription varchar(max)
)
go

create table forestgeo.CoreMeasurements
(
    CoreMeasurementID int not null
        constraint CoreMeasurements_pk
            primary key,
    CensusID          int
        constraint CoreMeasurements_Census_CensusID_fk
            references forestgeo.Census
            on update cascade,
    PlotID            int
        constraint CoreMeasurements_Plots_PlotID_fk
            references forestgeo.Plots,
    QuadratID         int
        constraint CoreMeasurements_Quadrats_QuadratID_fk
            references forestgeo.Quadrats,
    TreeID            int
        constraint FK_CoreMeasurements_Trees
            references forestgeo.Trees,
    StemID            int
        constraint FK_CoreMeasurements_Stems
            references forestgeo.Stems,
    PersonnelID       int
        constraint CoreMeasurements_Personnel_PersonnelID_fk
            references forestgeo.Personnel
            on update cascade,
    MeasurementTypeID int
        constraint CoreMeasurements_MeasurementTypes_MeasurementTypeID_fk
            references forestgeo.MeasurementTypes
            on update cascade,
    MeasurementDate   date,
    Measurement       varchar(max),
    IsRemeasurement   bit,
    IsCurrent         bit,
    UserDefinedFields varchar(max)
)
go

create table forestgeo.CMAttributes
(
    CMAID             int not null
        constraint CMAttributes_pk
            primary key,
    CoreMeasurementID int
        constraint CMAttributes_CoreMeasurements_CoreMeasurementID_fk
            references forestgeo.CoreMeasurements
            on update cascade,
    Code              varchar(10)
        constraint CMAttributes_Attributes_Code_fk
            references forestgeo.Attributes
            on update cascade
)
go

create table forestgeo.ValidationErrors
(
    ValidationErrorID          int not null
        constraint ValidationErrors_pk
            primary key,
    ValidationErrorDescription varchar(max)
)
go

create table forestgeo.CMVErrors
(
    CMVErrorID        int not null
        constraint CMVErrors_pk
            primary key,
    CoreMeasurementID int
        constraint CMVErrors_CoreMeasurements_CoreMeasurementID_fk
            references forestgeo.CoreMeasurements
            on update cascade,
    ValidationErrorID int
        constraint CMVErrors_ValidationErrors_ValidationErrorID_fk
            references forestgeo.ValidationErrors
            on update cascade
)
go

