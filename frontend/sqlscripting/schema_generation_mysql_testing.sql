create table attributes
(
    Code        varchar(10)                                                                               not null
        primary key,
    Description text                                                                                      null,
    Status      enum ('alive', 'dead', 'stem dead', 'broken below', 'omitted', 'missing') default 'alive' null
);

create table currentuser
(
    id       int          not null
        primary key,
    username varchar(255) null
);

create table personnel
(
    PersonnelID int auto_increment
        primary key,
    FirstName   varchar(50)  null,
    LastName    varchar(50)  null,
    Role        varchar(150) null
);

create table plots
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

create table census
(
    CensusID         int auto_increment
        primary key,
    PlotID           int  null,
    StartDate        date null,
    EndDate          date null,
    Description      text null,
    PlotCensusNumber int  null,
    constraint Census_Plots_PlotID_fk
        foreign key (PlotID) references plots (PlotID)
);

create table quadrats
(
    QuadratID    int auto_increment
        primary key,
    PlotID       int   null,
    CensusID     int   null,
    QuadratName  text  null,
    DimensionX   int   null,
    DimensionY   int   null,
    Area         float null,
    QuadratShape text  null,
    constraint Quadrats_Plots_FK
        foreign key (PlotID) references plots (PlotID),
    constraint quadrats_census_CensusID_fk
        foreign key (CensusID) references census (CensusID)
);

create table quadratpersonnel
(
    QuadratPersonnelID int auto_increment
        primary key,
    QuadratID          int          null,
    PersonnelID        int          null,
    AssignedDate       date         null,
    Role               varchar(150) null,
    constraint fk_QuadratPersonnel_Personnel
        foreign key (PersonnelID) references personnel (PersonnelID),
    constraint fk_QuadratPersonnel_Quadrats
        foreign key (QuadratID) references quadrats (QuadratID)
);

create table reference
(
    ReferenceID       int auto_increment
        primary key,
    PublicationTitle  varchar(64) null,
    FullReference     text        null,
    DateOfPublication date        null,
    Citation          varchar(50) null
);

create table family
(
    FamilyID    int auto_increment
        primary key,
    Family      varchar(32) null,
    ReferenceID int         null,
    constraint Family_Reference_ReferenceID_fk
        foreign key (ReferenceID) references reference (ReferenceID)
);

create table genus
(
    GenusID     int auto_increment
        primary key,
    FamilyID    int         null,
    Genus       varchar(32) null,
    ReferenceID int         null,
    Authority   varchar(32) null,
    constraint Genus_Family_FamilyID_fk
        foreign key (FamilyID) references family (FamilyID),
    constraint Genus_Reference_ReferenceID_fk
        foreign key (ReferenceID) references reference (ReferenceID)
);

create table schemachangelog
(
    ChangeLogID    int auto_increment
        primary key,
    TableName      varchar(255)                       not null,
    RowID          int                                not null,
    ChangeType     enum ('INSERT', 'UPDATE')          not null,
    ChangeDateTime datetime default CURRENT_TIMESTAMP not null,
    ChangedBy      varchar(255)                       not null
);

create table species
(
    SpeciesID         int auto_increment
        primary key,
    GenusID           int          null,
    SpeciesCode       varchar(25)  null,
    CurrentTaxonFlag  bit          null,
    ObsoleteTaxonFlag bit          null,
    SpeciesName       varchar(64)  null,
    IDLevel           varchar(8)   null,
    Authority         varchar(128) null,
    FieldFamily       varchar(32)  null,
    Description       text         null,
    ReferenceID       int          null,
    constraint Species_Genus_GenusID_fk
        foreign key (GenusID) references genus (GenusID),
    constraint Species_Reference_ReferenceID_fk
        foreign key (ReferenceID) references reference (ReferenceID)
);

create table currentobsolete
(
    SpeciesID         int  not null,
    ObsoleteSpeciesID int  not null,
    ChangeDate        date not null,
    ChangeCodeID      int  null,
    ChangeNote        text null,
    primary key (SpeciesID, ObsoleteSpeciesID, ChangeDate),
    constraint CurrentObsolete_Species_SpeciesID_fk
        foreign key (SpeciesID) references species (SpeciesID),
    constraint CurrentObsolete_Species_SpeciesID_fk2
        foreign key (ObsoleteSpeciesID) references species (SpeciesID)
);

create table speciesinventory
(
    SpeciesInventoryID int auto_increment
        primary key,
    CensusID           int null,
    PlotID             int null,
    SpeciesID          int null,
    SubSpeciesID       int null,
    constraint SpeciesInventory_Plots_PlotID_fk
        foreign key (PlotID) references plots (PlotID)
);

create table subspecies
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
        foreign key (SpeciesID) references species (SpeciesID)
);

create table trees
(
    TreeID       int auto_increment
        primary key,
    TreeTag      varchar(10) null,
    SpeciesID    int         null,
    SubSpeciesID int         null,
    constraint Trees_Species_SpeciesID_fk
        foreign key (SpeciesID) references species (SpeciesID),
    constraint Trees_SubSpecies_SubSpeciesID_fk
        foreign key (SubSpeciesID) references subspecies (SubSpeciesID)
);

create table stems
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
    Moved           bit         null,
    StemDescription text        null,
    constraint FK_Stems_Quadrats
        foreign key (QuadratID) references quadrats (QuadratID),
    constraint FK_Stems_Trees
        foreign key (TreeID) references trees (TreeID)
);

create table coremeasurements
(
    CoreMeasurementID int auto_increment
        primary key,
    CensusID          int              null,
    PlotID            int              null,
    QuadratID         int              null,
    TreeID            int              null,
    StemID            int              null,
    PersonnelID       int              null,
    IsValidated       bit default b'0' null,
    MeasurementDate   date             null,
    MeasuredDBH       decimal(10, 2)   null,
    MeasuredHOM       decimal(10, 2)   null,
    Description       text             null,
    UserDefinedFields text             null,
    constraint CoreMeasurements_Census_CensusID_fk
        foreign key (CensusID) references census (CensusID),
    constraint CoreMeasurements_Personnel_PersonnelID_fk
        foreign key (PersonnelID) references personnel (PersonnelID),
    constraint CoreMeasurements_Plots_PlotID_fk
        foreign key (PlotID) references plots (PlotID),
    constraint CoreMeasurements_Quadrats_QuadratID_fk
        foreign key (QuadratID) references quadrats (QuadratID),
    constraint FK_CoreMeasurements_Stems
        foreign key (StemID) references stems (StemID),
    constraint FK_CoreMeasurements_Trees
        foreign key (TreeID) references trees (TreeID)
);

create table cmattributes
(
    CMAID             int auto_increment
        primary key,
    CoreMeasurementID int         null,
    Code              varchar(10) null,
    constraint CMAttributes_Attributes_Code_fk
        foreign key (Code) references attributes (Code),
    constraint CMAttributes_CoreMeasurements_CoreMeasurementID_fk
        foreign key (CoreMeasurementID) references coremeasurements (CoreMeasurementID)
);

create index idx_censusid
    on coremeasurements (CensusID);

create index idx_plotid
    on coremeasurements (PlotID);

create index idx_quadratid
    on coremeasurements (QuadratID);

create index idx_stemid
    on coremeasurements (StemID);

create index idx_treeid
    on coremeasurements (TreeID);

create index idx_stemid
    on stems (StemID);

create table validationchangelog
(
    ValidationRunID int auto_increment
        primary key,
    ProcedureName   varchar(255)                       not null,
    RunDateTime     datetime default CURRENT_TIMESTAMP not null,
    TargetRowID     int                                null,
    IsSuccessful    bit                                null,
    ErrorMessage    varchar(255)                       null
);

create table validationerrors
(
    ValidationErrorID          int auto_increment
        primary key,
    ValidationErrorDescription text null
);

create table cmverrors
(
    CMVErrorID        int auto_increment
        primary key,
    CoreMeasurementID int null,
    ValidationErrorID int null,
    constraint CMVErrors_CoreMeasurements_CoreMeasurementID_fk
        foreign key (CoreMeasurementID) references coremeasurements (CoreMeasurementID),
    constraint cmverrors_validationerrors_ValidationErrorID_fk
        foreign key (ValidationErrorID) references validationerrors (ValidationErrorID)
);

