create table if not exists attributes
(
    Code        varchar(10)                                                                                                     not null
        primary key,
    Description varchar(255)                                                                                                    null,
    Status      enum ('alive', 'alive-not measured', 'dead', 'stem dead', 'broken below', 'omitted', 'missing') default 'alive' null
);

create index idx_attributes_codes on attributes (Code);
create index idx_attributes_description on attributes (Description);
create index idx_attributes_status on attributes (Status);

create table if not exists measurementssummary
(
    CoreMeasurementID int                                                          not null,
    StemID            int                                                          not null,
    TreeID            int                                                          not null,
    SpeciesID         int                                                          not null,
    QuadratID         int                                                          not null,
    PlotID            int                                                          not null,
    CensusID          int                                                          not null,
    SpeciesName       varchar(64)                                                  null,
    SubspeciesName    varchar(64)                                                  null,
    SpeciesCode       varchar(25)                                                  null,
    TreeTag           varchar(10)                                                  null,
    StemTag           varchar(10)                                                  null,
    StemLocalX        decimal(10, 6)                                               null,
    StemLocalY        decimal(10, 6)                                               null,
    QuadratName       varchar(255)                                                 null,
    MeasurementDate   date                                                         null,
    MeasuredDBH       decimal(10, 6)                                               null,
    MeasuredHOM       decimal(10, 6)                                               null,
    IsValidated       bit                                             default b'0' null,
    Description       varchar(255)                                                 null,
    Attributes        varchar(255)                                                 null,
    UserDefinedFields json                                                         null,
    primary key (CoreMeasurementID, StemID, TreeID, SpeciesID, QuadratID, PlotID, CensusID)
);

CREATE INDEX idx_coremeasurementid ON measurementssummary (CoreMeasurementID);
CREATE INDEX idx_stemid ON measurementssummary (StemID);
CREATE INDEX idx_treeid ON measurementssummary (TreeID);
CREATE INDEX idx_speciesid ON measurementssummary (SpeciesID);
CREATE INDEX idx_quadratid ON measurementssummary (QuadratID);
CREATE INDEX idx_plotid ON measurementssummary (PlotID);
CREATE INDEX idx_censusid ON measurementssummary (CensusID);
CREATE INDEX idx_speciesname ON measurementssummary (SpeciesName);
CREATE INDEX idx_subspeciesname ON measurementssummary (SubspeciesName);
CREATE INDEX idx_speciescode ON measurementssummary (SpeciesCode);
CREATE INDEX idx_treetag ON measurementssummary (TreeTag);
CREATE INDEX idx_stemtag ON measurementssummary (StemTag);
CREATE INDEX idx_stemlocalx ON measurementssummary (StemLocalX);
CREATE INDEX idx_stemlocaly ON measurementssummary (StemLocalY);
CREATE INDEX idx_quadratname ON measurementssummary (QuadratName);
CREATE INDEX idx_measurementdate ON measurementssummary (MeasurementDate);
CREATE INDEX idx_measureddbh ON measurementssummary (MeasuredDBH);
CREATE INDEX idx_measuredhom ON measurementssummary (MeasuredHOM);
CREATE INDEX idx_isvalidated ON measurementssummary (IsValidated);
CREATE INDEX idx_description ON measurementssummary (Description);
CREATE INDEX idx_attributes ON measurementssummary (Attributes);

create table if not exists plots
(
    PlotID                 int auto_increment
        primary key,
    PlotName               varchar(255)                                                        null,
    LocationName           varchar(255)                                                        null,
    CountryName            varchar(255)                                                        null,
    DimensionX             int                                                                 null,
    DimensionY             int                                                                 null,
    Area                   decimal(10, 6)                                                      null,
    GlobalX                decimal(10, 6)                                                      null,
    GlobalY                decimal(10, 6)                                                      null,
    GlobalZ                decimal(10, 6)                                                      null,
    PlotShape              varchar(255)                                                        null,
    PlotDescription        varchar(255)                                                        null,
    DefaultDimensionUnits  enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'm'  not null,
    DefaultCoordinateUnits enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'm'  not null,
    DefaultAreaUnits       enum ('km2', 'hm2', 'dam2', 'm2', 'dm2', 'cm2', 'mm2') default 'm2' not null,
    DefaultDBHUnits        enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'mm' not null,
    DefaultHOMUnits        enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'm'  not null
);

CREATE INDEX idx_plotname ON plots (PlotName);
CREATE INDEX idx_locationname ON plots (LocationName);
CREATE INDEX idx_countryname ON plots (CountryName);
CREATE INDEX idx_dimensionx ON plots (DimensionX);
CREATE INDEX idx_dimensiony ON plots (DimensionY);
CREATE INDEX idx_area ON plots (Area);
CREATE INDEX idx_globalx ON plots (GlobalX);
CREATE INDEX idx_globaly ON plots (GlobalY);
CREATE INDEX idx_globalz ON plots (GlobalZ);
CREATE INDEX idx_plotshape ON plots (PlotShape);
CREATE INDEX idx_plotdescription ON plots (PlotDescription);
CREATE INDEX idx_defaultdimensionunits ON plots (DefaultDimensionUnits);
CREATE INDEX idx_defaultcoordinateunits ON plots (DefaultCoordinateUnits);
CREATE INDEX idx_defaultareaunits ON plots (DefaultAreaUnits);
CREATE INDEX idx_defaultdbhunits ON plots (DefaultDBHUnits);
CREATE INDEX idx_defaulthomunits ON plots (DefaultHOMUNits);


create table if not exists census
(
    CensusID         int auto_increment
        primary key,
    PlotID           int          null,
    StartDate        date         null,
    EndDate          date         null,
    Description      varchar(255) null,
    PlotCensusNumber int          null,
    constraint Census_Plots_PlotID_fk
        foreign key (PlotID) references plots (PlotID)
);

CREATE INDEX idx_plotid ON census (PlotID);
CREATE INDEX idx_startdate ON census (StartDate);
CREATE INDEX idx_enddate ON census (EndDate);
CREATE INDEX idx_description ON census (Description);
CREATE INDEX idx_plotcensusnumber ON census (PlotCensusNumber);

create table if not exists quadrats
(
    QuadratID       int auto_increment
        primary key,
    PlotID          int                                                                 null,
    QuadratName     varchar(255)                                                        null,
    StartX          decimal(10, 6)                                                      null,
    StartY          decimal(10, 6)                                                      null,
    DimensionX      int                                                                 null,
    DimensionY      int                                                                 null,
    Area            decimal(10, 6)                                                      null,
    QuadratShape    varchar(255)                                                        null,
    constraint unique_quadrat_name_per_plot
        unique (PlotID, QuadratName),
    constraint Quadrats_Plots_FK
        foreign key (PlotID) references plots (PlotID)
);

CREATE INDEX idx_plotid ON quadrats (PlotID);
CREATE INDEX idx_quadratname ON quadrats (QuadratName);
CREATE INDEX idx_startx ON quadrats (StartX);
CREATE INDEX idx_starty ON quadrats (StartY);
CREATE INDEX idx_dimensionx ON quadrats (DimensionX);
CREATE INDEX idx_dimensiony ON quadrats (DimensionY);
CREATE INDEX idx_area ON quadrats (Area);
CREATE INDEX idx_quadratshape ON quadrats (QuadratShape);

create table if not exists censusquadrat
(
    CQID int auto_increment primary key ,
    CensusID int null,
    QuadratID int null,
    constraint cq_census_censusid_fk
        foreign key (CensusID) references census (CensusID),
    constraint cq_quadrats_quadratid_fk
        foreign key (QuadratID) references quadrats (QuadratID),
    UNIQUE (CensusID, QuadratID)
);

create table if not exists reference
(
    ReferenceID       int auto_increment
        primary key,
    PublicationTitle  varchar(64)  null,
    FullReference     varchar(255) null,
    DateOfPublication date         null,
    Citation          varchar(50)  null
);

CREATE INDEX idx_publicationtitle ON reference (PublicationTitle);
CREATE INDEX idx_fullreference ON reference (FullReference);
CREATE INDEX idx_dateofpublication ON reference (DateOfPublication);
CREATE INDEX idx_citation ON reference (Citation);

create table if not exists family
(
    FamilyID    int auto_increment
        primary key,
    Family      varchar(32) null,
    ReferenceID int         null,
    constraint unique_families
        unique (Family),
    constraint Family_Reference_ReferenceID_fk
        foreign key (ReferenceID) references reference (ReferenceID)
);

CREATE INDEX idx_family ON family (Family);
CREATE INDEX idx_referenceid ON family (ReferenceID);

create table if not exists genus
(
    GenusID        int auto_increment
        primary key,
    FamilyID       int         null,
    Genus          varchar(32) null,
    ReferenceID    int         null,
    GenusAuthority varchar(32) null,
    constraint unique_genus
        unique (Genus),
    constraint Genus_Family_FamilyID_fk
        foreign key (FamilyID) references family (FamilyID),
    constraint Genus_Reference_ReferenceID_fk
        foreign key (ReferenceID) references reference (ReferenceID)
);

CREATE INDEX idx_familyid ON genus (FamilyID);
CREATE INDEX idx_genus ON genus (Genus);
CREATE INDEX idx_referenceid ON genus (ReferenceID);
CREATE INDEX idx_genusauthority ON genus (GenusAuthority);

create table if not exists roles
(
    RoleID          int auto_increment
        primary key,
    RoleName        varchar(255) null,
    RoleDescription varchar(255) null,
    constraint unique_roles
        unique (RoleName)
);

CREATE INDEX idx_rolename ON roles (RoleName);
CREATE INDEX idx_roledescription ON roles (RoleDescription);

create table if not exists personnel
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

CREATE INDEX idx_censusid ON personnel (CensusID);
CREATE INDEX idx_firstname ON personnel (FirstName);
CREATE INDEX idx_lastname ON personnel (LastName);
CREATE INDEX idx_roleid ON personnel (RoleID);

create table if not exists quadratpersonnel
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

create table if not exists sitespecificvalidations
(
    ValidationProcedureID int auto_increment
        primary key,
    Name                  varchar(255)     not null,
    Definition            text             not null,
    Description           varchar(255)     null,
    Criteria              varchar(255)     null,
    IsEnabled             bit default b'0' not null
);

CREATE INDEX idx_name ON sitespecificvalidations (Name);
CREATE INDEX idx_definition ON sitespecificvalidations (Definition(255));
CREATE INDEX idx_description ON sitespecificvalidations (Description);
CREATE INDEX idx_criteria ON sitespecificvalidations (Criteria);
CREATE INDEX idx_isenabled ON sitespecificvalidations (IsEnabled);

create table if not exists species
(
    SpeciesID           int auto_increment
        primary key,
    GenusID             int          null,
    SpeciesCode         varchar(25)  null,
    SpeciesName         varchar(64)  null,
    SubspeciesName      varchar(64)  null,
    IDLevel             varchar(20)  null,
    SpeciesAuthority    varchar(128) null,
    SubspeciesAuthority varchar(128) null,
    FieldFamily         varchar(32)  null,
    Description         varchar(255) null,
    ValidCode           varchar(255) null,
    ReferenceID         int          null,
    constraint SpeciesCode
        unique (SpeciesCode, SpeciesName, SubspeciesName),
    constraint Species_Genus_GenusID_fk
        foreign key (GenusID) references genus (GenusID),
    constraint Species_Reference_ReferenceID_fk
        foreign key (ReferenceID) references reference (ReferenceID)
);

CREATE INDEX idx_genusid ON species (GenusID);
CREATE INDEX idx_speciescode ON species (SpeciesCode);
CREATE INDEX idx_speciesname ON species (SpeciesName);
CREATE INDEX idx_subspeciesname ON species (SubspeciesName);
CREATE INDEX idx_idlevel ON species (IDLevel);
CREATE INDEX idx_speciesauthority ON species (SpeciesAuthority);
CREATE INDEX idx_subspeciesauthority ON species (SubspeciesAuthority);
CREATE INDEX idx_fieldfamily ON species (FieldFamily);
CREATE INDEX idx_description ON species (Description);
CREATE INDEX idx_validcode ON species (ValidCode);
CREATE INDEX idx_referenceid ON species (ReferenceID);

create table if not exists specieslimits
(
    SpeciesLimitID int auto_increment
        primary key,
    SpeciesID      int            null,
    PlotID         int            null,
    CensusID       int            null,
    LimitType      enum ('DBH')   null,
    UpperBound     decimal(10, 6) null,
    LowerBound     decimal(10, 6) null,
    constraint specieslimits_census_CensusID_fk
        foreign key (CensusID) references census (CensusID),
    constraint specieslimits_plots_PlotID_fk
        foreign key (PlotID) references plots (PlotID),
    constraint specieslimits_species_SpeciesID_fk
        foreign key (SpeciesID) references species (SpeciesID)
);

create index idx_limittype on specieslimits (LimitType);
create index idx_lowerbound on specieslimits (LowerBound);
create index idx_speciesid on specieslimits (SpeciesID);
create index idx_upperbound on specieslimits (UpperBound);

create table if not exists trees
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

CREATE INDEX idx_treetag ON trees (TreeTag);
CREATE INDEX idx_speciesid ON trees (SpeciesID);

create table if not exists stems
(
    StemID          int auto_increment
        primary key,
    TreeID          int                                                         null,
    QuadratID       int                                                         null,
    StemNumber      int                                                         null,
    StemTag         varchar(10)                                                 null,
    LocalX          decimal(10, 6)                                              null,
    LocalY          decimal(10, 6)                                              null,
    Moved           bit                                                         null,
    StemDescription varchar(255)                                                null,
    constraint FK_Stems_Trees
        foreign key (TreeID) references trees (TreeID),
    constraint stems_quadrats_QuadratID_fk
        foreign key (QuadratID) references quadrats (QuadratID),
    constraint unique_stem_per_tree_quadrat
        unique (StemTag, TreeID, QuadratID),
    constraint unique_stem_coordinates
        unique (StemTag, TreeID, QuadratID, LocalX, LocalY)
);

CREATE INDEX idx_treeid ON stems (TreeID);
CREATE INDEX idx_quadratid ON stems (QuadratID);
CREATE INDEX idx_stemnumber ON stems (StemNumber);
CREATE INDEX idx_stemtag ON stems (StemTag);
CREATE INDEX idx_localx ON stems (LocalX);
CREATE INDEX idx_localy ON stems (LocalY);
CREATE INDEX idx_moved ON stems (Moved);
CREATE INDEX idx_stemdescription ON stems (StemDescription);

create table if not exists coremeasurements
(
    CoreMeasurementID int auto_increment
        primary key,
    CensusID          int                                                          null,
    StemID            int                                                          null,
    IsValidated       bit                                             default b'0' null,
    MeasurementDate   date                                                         null,
    MeasuredDBH       decimal(10, 6)                                               null,
    MeasuredHOM       decimal(10, 6)                                               null,
    Description       varchar(255)                                                 null,
    UserDefinedFields json                                                         null,
    constraint FK_CoreMeasurements_Stems
        foreign key (StemID) references stems (StemID),
    constraint coremeasurements_census_CensusID_fk
        foreign key (CensusID) references census (CensusID),
    constraint unique_measurements
        unique (CensusID, StemID, MeasuredDBH, MeasuredHOM)
);

CREATE INDEX idx_censusid ON coremeasurements (CensusID);
CREATE INDEX idx_stemid ON coremeasurements (StemID);
CREATE INDEX idx_isvalidated ON coremeasurements (IsValidated);
CREATE INDEX idx_measurementdate ON coremeasurements (MeasurementDate);
CREATE INDEX idx_measureddbh ON coremeasurements (MeasuredDBH);
CREATE INDEX idx_measuredhom ON coremeasurements (MeasuredHOM);
CREATE INDEX idx_description ON coremeasurements (Description);

create table if not exists cmattributes
(
    CMAID             int auto_increment
        primary key,
    CoreMeasurementID int         null,
    Code              varchar(10) null,
    constraint CMAttributes_Attributes_Code_fk
        foreign key (Code) references attributes (Code),
    constraint CMAttributes_CoreMeasurements_CoreMeasurementID_fk
        foreign key (CoreMeasurementID) references coremeasurements (CoreMeasurementID),
    constraint unique_cm_attribute
        unique (CoreMeasurementID, Code)
);

create table if not exists cmverrors
(
    CMVErrorID        int auto_increment
        primary key,
    CoreMeasurementID int null,
    ValidationErrorID int null,
    constraint cmverrors_coremeasurements_CoreMeasurementID_fk
        foreign key (CoreMeasurementID) references coremeasurements (CoreMeasurementID),
    constraint cmverrors_validationprocedures_ValidationID_fk
        foreign key (ValidationErrorID) references catalog.validationprocedures (ValidationID),
    constraint unique_cmverrors_cm_valerror
        unique (CoreMeasurementID, ValidationErrorID)
);

create table if not exists specimens
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
    Description    varchar(255)      null,
    constraint specimens_personnel_PersonnelID_fk
        foreign key (PersonnelID) references personnel (PersonnelID),
    constraint specimens_stems_StemID_fk
        foreign key (StemID) references stems (StemID)
);

create table if not exists unifiedchangelog
(
    ChangeID        int auto_increment,
    TableName       varchar(64)                         not null,
    RecordID        varchar(255)                        not null,
    Operation       enum ('INSERT', 'UPDATE', 'DELETE') not null,
    OldRowState     json                                null,
    NewRowState     json                                null,
    ChangeTimestamp datetime default CURRENT_TIMESTAMP  null,
    ChangedBy       varchar(64)                         null,
    PlotID          int                                 null,
    CensusID        int                                 null,
    primary key (ChangeID, TableName)
)
    partition by key (`TableName`) partitions 24;

CREATE INDEX idx_tablename ON unifiedchangelog (TableName);
CREATE INDEX idx_recordid ON unifiedchangelog (RecordID);
CREATE INDEX idx_operation ON unifiedchangelog (Operation);
CREATE INDEX idx_changetimestamp ON unifiedchangelog (ChangeTimestamp);
CREATE INDEX idx_changedby ON unifiedchangelog (ChangedBy);
CREATE INDEX idx_plotid ON unifiedchangelog (PlotID);
CREATE INDEX idx_censusid ON unifiedchangelog (CensusID);

create table if not exists validationchangelog
(
    ValidationRunID    int auto_increment
        primary key,
    ProcedureName      varchar(255)                       not null,
    RunDateTime        datetime default CURRENT_TIMESTAMP not null,
    TargetRowID        int                                null,
    ValidationOutcome  enum ('Passed', 'Failed')          null,
    ErrorMessage       varchar(255)                       null,
    ValidationCriteria varchar(255)                       null,
    MeasuredValue      varchar(255)                       null,
    ExpectedValueRange varchar(255)                       null,
    AdditionalDetails  varchar(255)                       null
);

create table if not exists viewfulltable
(
    CoreMeasurementID         int                                                                                                             null,
    MeasurementDate           date                                                                                                            null,
    MeasuredDBH               decimal(10, 6)                                                                                                  null,
    MeasuredHOM               decimal(10, 6)                                                                                                  null,
    Description               varchar(255)                                                                                                    null,
    IsValidated               bit                                                                                             default b'0'    null,
    PlotID                    int                                                                                                             null,
    PlotName                  varchar(255)                                                                                                    null,
    LocationName              varchar(255)                                                                                                    null,
    CountryName               varchar(255)                                                                                                    null,
    DimensionX                int                                                                                                             null,
    DimensionY                int                                                                                                             null,
    PlotArea                  decimal(10, 6)                                                                                                  null,
    PlotGlobalX               decimal(10, 6)                                                                                                  null,
    PlotGlobalY               decimal(10, 6)                                                                                                  null,
    PlotGlobalZ               decimal(10, 6)                                                                                                  null,
    PlotShape                 varchar(255)                                                                                                    null,
    PlotDescription           varchar(255)                                                                                                    null,
    PlotDefaultDimensionUnits  enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'm'  not null,
    PlotDefaultCoordinateUnits enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'm'  not null,
    PlotDefaultAreaUnits       enum ('km2', 'hm2', 'dam2', 'm2', 'dm2', 'cm2', 'mm2') default 'm2' not null,
    PlotDefaultDBHUnits        enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'mm' not null,
    PlotDefaultHOMUnits        enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'm'  not null,
    CensusID                  int                                                                                                             null,
    CensusStartDate           date                                                                                                            null,
    CensusEndDate             date                                                                                                            null,
    CensusDescription         varchar(255)                                                                                                    null,
    PlotCensusNumber          int                                                                                                             null,
    QuadratID                 int                                                                                                             null,
    QuadratName               varchar(255)                                                                                                    null,
    QuadratDimensionX         int                                                                                                             null,
    QuadratDimensionY         int                                                                                                             null,
    QuadratArea               decimal(10, 6)                                                                                                  null,
    QuadratStartX             decimal(10, 6)                                                                                                  null,
    QuadratStartY             decimal(10, 6)                                                                                                  null,
    QuadratShape              varchar(255)                                                                                                    null,
    TreeID                    int                                                                                                             null,
    TreeTag                   varchar(10)                                                                                                     null,
    StemID                    int                                                                                                             null,
    StemTag                   varchar(10)                                                                                                     null,
    StemLocalX                decimal(10, 6)                                                                                                  null,
    StemLocalY                decimal(10, 6)                                                                                                  null,
    SpeciesID                 int                                                                                                             null,
    SpeciesCode               varchar(25)                                                                                                     null,
    SpeciesName               varchar(64)                                                                                                     null,
    SubspeciesName            varchar(64)                                                                                                     null,
    SubspeciesAuthority       varchar(128)                                                                                                    null,
    SpeciesIDLevel            varchar(20)                                                                                                     null,
    GenusID                   int                                                                                                             null,
    Genus                     varchar(32)                                                                                                     null,
    GenusAuthority            varchar(32)                                                                                                     null,
    FamilyID                  int                                                                                                             null,
    Family                    varchar(32)                                                                                                     null,
    Attributes                varchar(255)                                                                                                    null,
    UserDefinedFields json null
);

CREATE INDEX idx_coremeasurementid ON viewfulltable (CoreMeasurementID);
CREATE INDEX idx_measurementdate ON viewfulltable (MeasurementDate);
CREATE INDEX idx_measureddbh ON viewfulltable (MeasuredDBH);
CREATE INDEX idx_measuredhom ON viewfulltable (MeasuredHOM);
CREATE INDEX idx_description ON viewfulltable (Description);
CREATE INDEX idx_isvalidated ON viewfulltable (IsValidated);
CREATE INDEX idx_plotid ON viewfulltable (PlotID);
CREATE INDEX idx_plotname ON viewfulltable (PlotName);
CREATE INDEX idx_locationname ON viewfulltable (LocationName);
CREATE INDEX idx_countryname ON viewfulltable (CountryName);
CREATE INDEX idx_dimensionx ON viewfulltable (DimensionX);
CREATE INDEX idx_dimensiony ON viewfulltable (DimensionY);
CREATE INDEX idx_plotdimensionunits ON viewfulltable (PlotDimensionUnits);
CREATE INDEX idx_plotarea ON viewfulltable (PlotArea);
CREATE INDEX idx_plotareaunits ON viewfulltable (PlotAreaUnits);
CREATE INDEX idx_plotglobalx ON viewfulltable (PlotGlobalX);
CREATE INDEX idx_plotglobaly ON viewfulltable (PlotGlobalY);
CREATE INDEX idx_plotglobalz ON viewfulltable (PlotGlobalZ);
CREATE INDEX idx_plotcoordinateunits ON viewfulltable (PlotCoordinateUnits);
CREATE INDEX idx_plotshape ON viewfulltable (PlotShape);
CREATE INDEX idx_plotdescription ON viewfulltable (PlotDescription);
CREATE INDEX idx_censusid ON viewfulltable (CensusID);
CREATE INDEX idx_censusstartdate ON viewfulltable (CensusStartDate);
CREATE INDEX idx_censusenddate ON viewfulltable (CensusEndDate);
CREATE INDEX idx_censusdescription ON viewfulltable (CensusDescription);
CREATE INDEX idx_plotcensusnumber ON viewfulltable (PlotCensusNumber);
CREATE INDEX idx_quadratid ON viewfulltable (QuadratID);
CREATE INDEX idx_quadratname ON viewfulltable (QuadratName);
CREATE INDEX idx_quadratdimensionx ON viewfulltable (QuadratDimensionX);
CREATE INDEX idx_quadratdimensiony ON viewfulltable (QuadratDimensionY);
CREATE INDEX idx_quadrarea ON viewfulltable (QuadratArea);
CREATE INDEX idx_quadratstartx ON viewfulltable (QuadratStartX);
CREATE INDEX idx_quadratstarty ON viewfulltable (QuadratStartY);
CREATE INDEX idx_quadratshape ON viewfulltable (QuadratShape);
CREATE INDEX idx_treeid ON viewfulltable (TreeID);
CREATE INDEX idx_treetag ON viewfulltable (TreeTag);
CREATE INDEX idx_stemid ON viewfulltable (StemID);
CREATE INDEX idx_stemtag ON viewfulltable (StemTag);
CREATE INDEX idx_stemlocalx ON viewfulltable (StemLocalX);
CREATE INDEX idx_stemlocaly ON viewfulltable (StemLocalY);
CREATE INDEX idx_speciesid ON viewfulltable (SpeciesID);
CREATE INDEX idx_speciescode ON viewfulltable (SpeciesCode);
CREATE INDEX idx_speciesname ON viewfulltable (SpeciesName);
CREATE INDEX idx_subspeciesname ON viewfulltable (SubspeciesName);
CREATE INDEX idx_subspeciesauthority ON viewfulltable (SubspeciesAuthority);
CREATE INDEX idx_speciesidlevel ON viewfulltable (SpeciesIDLevel);
CREATE INDEX idx_genusid ON viewfulltable (GenusID);
CREATE INDEX idx_genus ON viewfulltable (Genus);
CREATE INDEX idx_genusauthority ON viewfulltable (GenusAuthority);
CREATE INDEX idx_familyid ON viewfulltable (FamilyID);
CREATE INDEX idx_family ON viewfulltable (Family);
CREATE INDEX idx_attributes ON viewfulltable (Attributes);

create table if not exists postvalidationqueries
(
    QueryID int auto_increment primary key,
    QueryName varchar(255) null,
    QueryDefinition text null,
    Description text null,
    IsEnabled bit default b'0' not null,
    LastRunAt DATETIME NULL,
    LastRunResult LONGTEXT NULL,
    LastRunStatus ENUM('success', 'failure') NULL
);

CREATE INDEX idx_queryname ON postvalidationqueries (QueryName);
CREATE INDEX idx_querydefinition ON postvalidationqueries (QueryDefinition(255));
CREATE INDEX idx_description ON postvalidationqueries (Description(255));
CREATE INDEX idx_isenabled ON postvalidationqueries (IsEnabled);
CREATE INDEX idx_lastrunat ON postvalidationqueries (LastRunAt);
CREATE INDEX idx_lastrunresult ON postvalidationqueries (LastRunResult(255));
CREATE INDEX idx_lastrunstatus ON postvalidationqueries (LastRunStatus);