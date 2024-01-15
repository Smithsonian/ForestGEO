create table forestgeo_id.Attributes
(
    Code        varchar(10) not null
        constraint Attributes_pk
            primary key,
    Description varchar(max),
    Status      varchar(20)
)
    go

create table forestgeo_id.MeasurementTypes
(
    MeasurementTypeID          int identity
        constraint MeasurementTypes_pk
        primary key,
    MeasurementTypeDescription varchar(255)
)
    go

create table forestgeo_id.Personnel
(
    PersonnelID int identity
        constraint Personnel_pk
        primary key,
    FirstName   varchar(50),
    LastName    varchar(50),
    Role        varchar(150)
)
    go

create table forestgeo_id.Plots
(
    PlotID          int identity
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

create table forestgeo_id.Census
(
    CensusID         int identity
        constraint Census_pk
        primary key,
    PlotID           int
        constraint Census_Plots_PlotID_fk
            references forestgeo_id.Plots
            on update cascade,
    StartDate        date,
    EndDate          date,
    Description      varchar(max),
    PlotCensusNumber int
)
    go

create table forestgeo_id.Quadrats
(
    QuadratID    int identity
        constraint Quadrats_PK
        primary key,
    PlotID       int
        constraint Quadrats_Plots_FK
            references forestgeo_id.Plots,
    PersonnelID  int
        constraint Quadrats_Personnel_fk
            references forestgeo_id.Personnel,
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

create table forestgeo_id.Reference
(
    ReferenceID       int identity
        constraint Reference_pk
        primary key,
    PublicationTitle  varchar(64),
    FullReference     varchar(max),
    DateOfPublication date,
    Citation          varchar(50)
)
    go

create table forestgeo_id.Family
(
    FamilyID    int identity
        constraint Family_pk
        primary key,
    Family      varchar(32),
    ReferenceID int
        constraint Family_Reference_ReferenceID_fk
            references forestgeo_id.Reference
)
    go

create table forestgeo_id.Genus
(
    GenusID     int identity
        constraint Genus_pk
        primary key,
    FamilyID    int
        constraint Genus_Family_FamilyID_fk
            references forestgeo_id.Family,
    GenusName   varchar(32),
    ReferenceID int
        constraint Genus_Reference_ReferenceID_fk
            references forestgeo_id.Reference,
    Authority   varchar(32)
)
    go

create table forestgeo_id.Species
(
    SpeciesID         int identity
        constraint Species_pk
        primary key,
    GenusID           int
        constraint Species_Genus_GenusID_fk
            references forestgeo_id.Genus,
    CurrentTaxonFlag  bit,
    ObsoleteTaxonFlag bit,
    SpeciesName       varchar(64),
    IDLevel           varchar(8),
    Authority         varchar(128),
    FieldFamily       varchar(32),
    Description       varchar(max),
    ReferenceID       int
        constraint Species_Reference_ReferenceID_fk
            references forestgeo_id.Reference,
    SpeciesCode       varchar(25)
)
    go

create table forestgeo_id.CurrentObsolete
(
    SpeciesID         int  not null
        constraint CurrentObsolete_Species_SpeciesID_fk
            references forestgeo_id.Species,
    ObsoleteSpeciesID int  not null
        constraint CurrentObsolete_Species_SpeciesID_fk2
            references forestgeo_id.Species,
    ChangeDate        date not null,
    ChangeCodeID      int,
    ChangeNote        varchar(max),
    constraint CurrentObsolete_pk
        primary key (SpeciesID, ObsoleteSpeciesID, ChangeDate)
)
    go

create table forestgeo_id.SpeciesInventory
(
    SpeciesInventoryID int identity
        constraint SpeciesInventory_pk
        primary key,
    CensusID           int,
    PlotID             int
        constraint SpeciesInventory_Plots_PlotID_fk
            references forestgeo_id.Plots,
    SpeciesID          int,
    SubSpeciesID       int
)
    go

create table forestgeo_id.SubSpecies
(
    SubSpeciesID       int identity
        constraint SubSpecies_pk
        primary key,
    SubSpeciesCode     varchar(10),
    SpeciesID          int
        constraint SubSpecies_Species_SpeciesID_fk
            references forestgeo_id.Species
            on update cascade,
    CurrentTaxonFlag   bit,
    ObsoleteTaxonFlag  bit,
    SubSpeciesName     varchar(max),
    Authority          varchar(128),
    InfraSpecificLevel char(32)
)
    go

create table forestgeo_id.Trees
(
    TreeID       int identity
        constraint PK_Trees
        primary key,
    TreeTag      varchar(10),
    SpeciesID    int
        constraint Trees_Species_SpeciesID_fk
            references forestgeo_id.Species
            on update cascade,
    SubSpeciesID int
        constraint Trees_SubSpecies_SubSpeciesID_fk
            references forestgeo_id.SubSpecies
)
    go

create table forestgeo_id.Stems
(
    StemID          int identity
        constraint PK_Stems
        primary key,
    TreeID          int
        constraint FK_Stems_Trees
            references forestgeo_id.Trees
            on update cascade,
    QuadratID       int
        constraint FK_Stems_Quadrats
            references forestgeo_id.Quadrats
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

create table forestgeo_id.CoreMeasurements
(
    CoreMeasurementID   int identity
        constraint CoreMeasurements_pk
        primary key,
    CensusID            int
        constraint CoreMeasurements_Census_CensusID_fk
            references forestgeo_id.Census
            on update cascade,
    PlotID              int
        constraint CoreMeasurements_Plots_PlotID_fk
            references forestgeo_id.Plots,
    QuadratID           int
        constraint CoreMeasurements_Quadrats_QuadratID_fk
            references forestgeo_id.Quadrats,
    TreeID              int
        constraint FK_CoreMeasurements_Trees
            references forestgeo_id.Trees,
    StemID              int
        constraint FK_CoreMeasurements_Stems
            references forestgeo_id.Stems,
    PersonnelID         int
        constraint CoreMeasurements_Personnel_PersonnelID_fk
            references forestgeo_id.Personnel
            on update cascade,
    MeasurementTypeID   int
        constraint CoreMeasurements_MeasurementTypes_MeasurementTypeID_fk
            references forestgeo_id.MeasurementTypes
            on update cascade,
    MeasurementDate     date,
    Measurement         varchar(max),
    IsRemeasurement     bit,
    IsCurrent           bit,
    UserDefinedFields   varchar(max),
    Description         varchar(max),
    MasterMeasurementID int
)
    go

create table forestgeo_id.CMAttributes
(
    CMAID             int identity
        constraint CMAttributes_pk
        primary key,
    CoreMeasurementID int
        constraint CMAttributes_CoreMeasurements_CoreMeasurementID_fk
            references forestgeo_id.CoreMeasurements
            on update cascade,
    Code              varchar(10)
        constraint CMAttributes_Attributes_Code_fk
            references forestgeo_id.Attributes
            on update cascade
)
    go

create table forestgeo_id.ValidationErrors
(
    ValidationErrorID          int identity
        constraint ValidationErrors_pk
        primary key,
    ValidationErrorDescription varchar(max)
    )
    go

create table forestgeo_id.CMVErrors
(
    CMVErrorID        int identity
        constraint CMVErrors_pk
        primary key,
    CoreMeasurementID int
        constraint CMVErrors_CoreMeasurements_CoreMeasurementID_fk
            references forestgeo_id.CoreMeasurements
            on update cascade,
    ValidationErrorID int
        constraint CMVErrors_ValidationErrors_ValidationErrorID_fk
            references forestgeo_id.ValidationErrors
            on update cascade
)
    go

