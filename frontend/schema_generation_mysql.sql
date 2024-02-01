create table forestgeo_bci.attributes
(
    Code        varchar(10)                                                                               not null,
    Description text                                                                                      null,
    Status      enum ('alive', 'dead', 'stem dead', 'broken below', 'omitted', 'missing') default 'alive' null,
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
    GlobalX         float null,
    GlobalY         float null,
    GlobalZ         float null,
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
    Genus       varchar(32) null,
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
    StemPlotX       float       null,
    StemPlotY       float       null,
    StemPlotZ       float       null,
    StemQuadX       float       null,
    StemQuadY       float       null,
    StemQuadZ       float       null,
    IsPrimary       bit         null,
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

create index idx_censusid
    on forestgeo_bci.coremeasurements (CensusID);

create index idx_plotid
    on forestgeo_bci.coremeasurements (PlotID);

create index idx_quadratid
    on forestgeo_bci.coremeasurements (QuadratID);

create index idx_stemid
    on forestgeo_bci.coremeasurements (StemID);

create index idx_treeid
    on forestgeo_bci.coremeasurements (TreeID);

create index idx_stemid
    on forestgeo_bci.stems (StemID);

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

