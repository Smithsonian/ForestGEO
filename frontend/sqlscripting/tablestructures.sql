create table attributes
(
    Code        varchar(10)                                                                                                     not null
        primary key,
    Description varchar(255)                                                                                                    null,
    Status      enum ('alive', 'alive-not measured', 'dead', 'stem dead', 'broken below', 'omitted', 'missing') default 'alive' null
);

create table plots
(
    PlotID          int auto_increment
        primary key,
    PlotName        varchar(255)                                                        null,
    LocationName    longtext                                                            null,
    CountryName     longtext                                                            null,
    DimensionX      int                                                                 null,
    DimensionY      int                                                                 null,
    DimensionUnits  enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'm'  null,
    Area            decimal(10, 6)                                                      null,
    AreaUnits       enum ('km2', 'hm2', 'dam2', 'm2', 'dm2', 'cm2', 'mm2') default 'm2' null,
    GlobalX         decimal(10, 6)                                                      null,
    GlobalY         decimal(10, 6)                                                      null,
    GlobalZ         decimal(10, 6)                                                      null,
    CoordinateUnits enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'm'  null,
    PlotShape       text                                                                null,
    PlotDescription text                                                                null
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
    QuadratID       int auto_increment
        primary key,
    PlotID          int                                                                 null,
    CensusID        int                                                                 null,
    QuadratName     varchar(255)                                                        null,
    StartX          decimal(10, 6)                                                      null,
    StartY          decimal(10, 6)                                                      null,
    CoordinateUnits enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'm'  null,
    DimensionX      int                                                                 null,
    DimensionY      int                                                                 null,
    DimensionUnits  enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'm'  null,
    Area            decimal(10, 6)                                                      null,
    AreaUnits       enum ('km2', 'hm2', 'dam2', 'm2', 'dm2', 'cm2', 'mm2') default 'm2' null,
    QuadratShape    text                                                                null,
    constraint unique_quadrat_name_per_census_plot
        unique (CensusID, PlotID, QuadratName),
    constraint Quadrats_Plots_FK
        foreign key (PlotID) references plots (PlotID),
    constraint quadrats_census_CensusID_fk
        foreign key (CensusID) references census (CensusID)
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
    constraint Family
        unique (Family),
    constraint Family_Reference_ReferenceID_fk
        foreign key (ReferenceID) references reference (ReferenceID)
);

create table genus
(
    GenusID        int auto_increment
        primary key,
    FamilyID       int         null,
    Genus          varchar(32) null,
    ReferenceID    int         null,
    GenusAuthority varchar(32) null,
    constraint Genus
        unique (Genus),
    constraint Genus_Family_FamilyID_fk
        foreign key (FamilyID) references family (FamilyID),
    constraint Genus_Reference_ReferenceID_fk
        foreign key (ReferenceID) references reference (ReferenceID)
);

create table roles
(
    RoleID          int auto_increment
        primary key,
    RoleName        varchar(255) null,
    RoleDescription text         null
);

create table personnel
(
    PersonnelID int auto_increment
        primary key,
    CensusID    int         null,
    FirstName   varchar(50) null,
    LastName    varchar(50) null,
    RoleID      int         null,
    constraint unique_full_name_per_census
        unique (CensusID, FirstName, LastName),
    constraint personnel_census_CensusID_fk
        foreign key (CensusID) references census (CensusID),
    constraint personnel_roles_RoleID_fk
        foreign key (RoleID) references roles (RoleID)
);

create table quadratpersonnel
(
    QuadratPersonnelID int auto_increment
        primary key,
    QuadratID          int not null,
    PersonnelID        int not null,
    CensusID           int null,
    constraint fk_QuadratPersonnel_Personnel
        foreign key (PersonnelID) references personnel (PersonnelID),
    constraint fk_QuadratPersonnel_Quadrats
        foreign key (QuadratID) references quadrats (QuadratID),
    constraint quadratpersonnel_census_CensusID_fk
        foreign key (CensusID) references census (CensusID)
);

create table species
(
    SpeciesID           int auto_increment
        primary key,
    GenusID             int          null,
    CensusID            int          null,
    SpeciesCode         varchar(25)  null,
    SpeciesName         varchar(64)  null,
    SubspeciesName      varchar(255) null,
    IDLevel             varchar(20)  null,
    SpeciesAuthority    varchar(128) null,
    SubspeciesAuthority varchar(255) null,
    FieldFamily         varchar(32)  null,
    Description         text         null,
    ValidCode           longtext     null,
    ReferenceID         int          null,
    constraint SpeciesCode
        unique (SpeciesCode),
    constraint Species_SpeciesCode
        unique (SpeciesCode),
    constraint Species_Genus_GenusID_fk
        foreign key (GenusID) references genus (GenusID),
    constraint Species_Reference_ReferenceID_fk
        foreign key (ReferenceID) references reference (ReferenceID),
    constraint species_census_CensusID_fk
        foreign key (CensusID) references census (CensusID)
);

create table specieslimits
(
    SpeciesLimitID int auto_increment
        primary key,
    SpeciesCode    varchar(25)                                                  null,
    LimitType      enum ('DBH')                                                 null,
    UpperBound     decimal(10, 6)                                               null,
    LowerBound     decimal(10, 6)                                               null,
    Unit           enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'cm' null,
    constraint specieslimits_ibfk_1
        foreign key (SpeciesCode) references species (SpeciesCode)
);

create table subquadrats
(
    SubquadratID    int auto_increment
        primary key,
    SubquadratName  varchar(25)                                                 null,
    QuadratID       int                                                         null,
    DimensionX      int                                             default 5   null,
    DimensionY      int                                             default 5   null,
    DimensionUnits  enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm' null,
    QX              int                                                         null,
    QY              int                                                         null,
    CoordinateUnits enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm' null,
    Ordering        int                                                         null,
    constraint SQName
        unique (SubquadratName),
    constraint subquadrats_ibfk_1
        foreign key (QuadratID) references quadrats (QuadratID)
);

create index QuadratID
    on subquadrats (QuadratID);

create table trees
(
    TreeID    int auto_increment
        primary key,
    TreeTag   varchar(10) null,
    SpeciesID int         null,
    constraint TreeTag
        unique (TreeTag),
    constraint Trees_Species_SpeciesID_fk
        foreign key (SpeciesID) references species (SpeciesID)
);

create table stems
(
    StemID          int auto_increment
        primary key,
    TreeID          int                                                         null,
    QuadratID       int                                                         null,
    StemNumber      int                                                         null,
    StemTag         varchar(10)                                                 null,
    LocalX          decimal(10, 6)                                              null,
    LocalY          decimal(10, 6)                                              null,
    CoordinateUnits enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm' null,
    Moved           bit                                                         null,
    StemDescription text                                                        null,
    constraint FK_Stems_Trees
        foreign key (TreeID) references trees (TreeID),
    constraint stems_quadrats_QuadratID_fk
        foreign key (QuadratID) references quadrats (QuadratID)
);

create table coremeasurements
(
    CoreMeasurementID int auto_increment
        primary key,
    StemID            int                                                          null,
    IsValidated       bit                                             default b'0' null,
    MeasurementDate   date                                                         null,
    MeasuredDBH       decimal(10, 6)                                               null,
    DBHUnit           enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'cm' null,
    MeasuredHOM       decimal(10, 6)                                               null,
    HOMUnit           enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm'  null,
    Description       text                                                         null,
    UserDefinedFields text                                                         null,
    constraint FK_CoreMeasurements_Stems
        foreign key (StemID) references stems (StemID)
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

create table cmverrors
(
    CMVErrorID        int auto_increment
        primary key,
    CoreMeasurementID int null,
    ValidationErrorID int null,
    constraint cmverrors_coremeasurements_CoreMeasurementID_fk
        foreign key (CoreMeasurementID) references coremeasurements (CoreMeasurementID),
    constraint cmverrors_validationprocedures_ValidationID_fk
        foreign key (ValidationErrorID) references catalog.validationprocedures (ValidationID)
);

create index idx_stemid
    on coremeasurements (StemID);

create table specimens
(
    SpecimenID     int auto_increment
        primary key,
    StemID         int               null,
    PersonnelID    int               null,
    SpecimenNumber int               null,
    SpeciesID      int               null,
    Herbarium      varchar(32)       null,
    Voucher        smallint unsigned null,
    CollectionDate date              null,
    DeterminedBy   varchar(64)       null,
    Description    text              null,
    constraint specimens_personnel_PersonnelID_fk
        foreign key (PersonnelID) references personnel (PersonnelID),
    constraint specimens_stems_StemID_fk
        foreign key (StemID) references stems (StemID)
);

create index idx_stemid
    on stems (StemID);

create table unifiedchangelog
(
    ChangeID        int auto_increment,
    TableName       varchar(64)                         not null,
    RecordID        varchar(255)                        not null,
    Operation       enum ('INSERT', 'UPDATE', 'DELETE') not null,
    OldRowState     json                                null,
    NewRowState     json                                null,
    ChangeTimestamp datetime default CURRENT_TIMESTAMP  null,
    ChangedBy       varchar(64)                         null,
    primary key (ChangeID, TableName)
)
    partition by key (`TableName`) partitions 24;

create table validationchangelog
(
    ValidationRunID    int auto_increment
        primary key,
    ProcedureName      varchar(255)                       not null,
    RunDateTime        datetime default CURRENT_TIMESTAMP not null,
    TargetRowID        int                                null,
    ValidationOutcome  enum ('Passed', 'Failed')          null,
    ErrorMessage       text                               null,
    ValidationCriteria text                               null,
    MeasuredValue      varchar(255)                       null,
    ExpectedValueRange varchar(255)                       null,
    AdditionalDetails  text                               null
);

