create table if not exists attributes
(
    Code        varchar(10)                                                                                     not null,
    Description varchar(255)                                                                                    null,
    Status      enum ('alive', 'alive-not measured', 'dead', 'stem dead', 'broken below', 'omitted', 'missing') null,
    IsActive    tinyint(1) default 1                                                                            not null,
    DeletedAt   datetime                                                                                        null,
    unique_sig  varchar(500) as (concat_ws(_utf8mb4'#', coalesce(`Code`, _utf8mb4''),
                                           coalesce(`Description`, _utf8mb4''), coalesce(`Status`, _utf8mb4''),
                                           coalesce(`IsActive`, _utf8mb4''))) stored,
    primary key (Code, IsActive),
    constraint uq_attributes_full
        unique (unique_sig)
);

create index idx_attributes_codes
    on attributes (Code);

create index idx_attributes_description
    on attributes (Description);

create index idx_attributes_status
    on attributes (Status);

create table if not exists failedmeasurements
(
    FailedMeasurementID int auto_increment
        primary key,
    PlotID              int            null,
    CensusID            int            null,
    Tag                 varchar(20)    null,
    StemTag             varchar(10)    null,
    SpCode              varchar(25)    null,
    Quadrat             varchar(255)   null,
    X                   decimal(12, 6) null,
    Y                   decimal(12, 6) null,
    DBH                 decimal(12, 6) null,
    HOM                 decimal(12, 6) null,
    Date                date           null,
    Codes               varchar(255)   null,
    Comments            varchar(255)   null,
    FailureReasons      text           null,
    hash_id             varchar(32) as (md5(concat_ws(_utf8mb4'|', `PlotID`, `CensusID`, `Tag`, `StemTag`, `SpCode`,
                                                      `Quadrat`, `X`, `Y`, `DBH`, `HOM`, `Date`, `Codes`))) stored,
    constraint unique_required_hash
        unique (hash_id)
);

create table if not exists measurementssummary
(
    CoreMeasurementID int              not null,
    StemID            int              not null,
    TreeID            int              not null,
    SpeciesID         int              not null,
    QuadratID         int              not null,
    PlotID            int              not null,
    CensusID          int              not null,
    SpeciesName       varchar(64)      null,
    SubspeciesName    varchar(64)      null,
    SpeciesCode       varchar(25)      null,
    TreeTag           varchar(20)      null,
    StemTag           varchar(10)      null,
    StemLocalX        decimal(12, 6)   null,
    StemLocalY        decimal(12, 6)   null,
    QuadratName       varchar(255)     null,
    MeasurementDate   date             not null,
    MeasuredDBH       decimal(12, 6)   null,
    MeasuredHOM       decimal(12, 6)   null,
    IsValidated       bit default b'0' null,
    Description       varchar(255)     null,
    Attributes        varchar(255)     null,
    UserDefinedFields json             null,
    Errors            text             null,
    primary key (CoreMeasurementID, StemID, TreeID, SpeciesID, QuadratID, PlotID, CensusID)
);

create index idx_attributes
    on measurementssummary (Attributes);

create index idx_censusid
    on measurementssummary (CensusID);

create index idx_coremeasurementid
    on measurementssummary (CoreMeasurementID);

create index idx_description
    on measurementssummary (Description);

create index idx_isvalidated
    on measurementssummary (IsValidated);

create index idx_measureddbh
    on measurementssummary (MeasuredDBH);

create index idx_measuredhom
    on measurementssummary (MeasuredHOM);

create index idx_measurementdate
    on measurementssummary (MeasurementDate);

create index idx_mss_dup_detect
    on measurementssummary (CensusID, QuadratName, StemID, MeasurementDate, MeasuredDBH, MeasuredHOM, Attributes);

create index idx_plotid
    on measurementssummary (PlotID);

create index idx_quadratid
    on measurementssummary (QuadratID);

create index idx_quadratname
    on measurementssummary (QuadratName);

create index idx_speciescode
    on measurementssummary (SpeciesCode);

create index idx_speciesid
    on measurementssummary (SpeciesID);

create index idx_speciesname
    on measurementssummary (SpeciesName);

create index idx_stemid
    on measurementssummary (StemID);

create index idx_stemlocalx
    on measurementssummary (StemLocalX);

create index idx_stemlocaly
    on measurementssummary (StemLocalY);

create index idx_stemtag
    on measurementssummary (StemTag);

create index idx_subspeciesname
    on measurementssummary (SubspeciesName);

create index idx_treeid
    on measurementssummary (TreeID);

create index idx_treetag
    on measurementssummary (TreeTag);

create table if not exists plots
(
    PlotID                 int auto_increment
        primary key,
    PlotName               varchar(255)                                                        null,
    LocationName           varchar(255)                                                        null,
    CountryName            varchar(255)                                                        null,
    DimensionX             decimal(12, 6)                                                      null,
    DimensionY             decimal(12, 6)                                                      null,
    Area                   decimal(12, 6)                                                      null,
    GlobalX                decimal(12, 6)                                                      null,
    GlobalY                decimal(12, 6)                                                      null,
    GlobalZ                decimal(12, 6)                                                      null,
    PlotShape              varchar(255)                                                        null,
    PlotDescription        varchar(255)                                                        null,
    DefaultDimensionUnits  enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'm'  not null,
    DefaultCoordinateUnits enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'm'  not null,
    DefaultAreaUnits       enum ('km2', 'hm2', 'dam2', 'm2', 'dm2', 'cm2', 'mm2') default 'm2' not null,
    DefaultDBHUnits        enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'mm' not null,
    DefaultHOMUnits        enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'm'  not null
);

create table if not exists census
(
    CensusID         int auto_increment
        primary key,
    PlotID           int                  null,
    StartDate        date                 null,
    EndDate          date                 null,
    Description      varchar(255)         null,
    PlotCensusNumber int                  null,
    IsActive         tinyint(1) default 1 not null,
    DeletedAt        datetime             null,
    constraint Census_Plots_PlotID_fk
        foreign key (PlotID) references plots (PlotID)
            on delete cascade
);

create index idx_description
    on census (Description);

create index idx_enddate
    on census (EndDate);

create index idx_plotcensusnumber
    on census (PlotCensusNumber);

create index idx_plotid
    on census (PlotID);

create index idx_startdate
    on census (StartDate);

create index idx_area
    on plots (Area);

create index idx_countryname
    on plots (CountryName);

create index idx_defaultareaunits
    on plots (DefaultAreaUnits);

create index idx_defaultcoordinateunits
    on plots (DefaultCoordinateUnits);

create index idx_defaultdbhunits
    on plots (DefaultDBHUnits);

create index idx_defaultdimensionunits
    on plots (DefaultDimensionUnits);

create index idx_defaulthomunits
    on plots (DefaultHOMUnits);

create index idx_dimensionx
    on plots (DimensionX);

create index idx_dimensiony
    on plots (DimensionY);

create index idx_globalx
    on plots (GlobalX);

create index idx_globaly
    on plots (GlobalY);

create index idx_globalz
    on plots (GlobalZ);

create index idx_locationname
    on plots (LocationName);

create index idx_plotdescription
    on plots (PlotDescription);

create index idx_plotname
    on plots (PlotName);

create index idx_plotshape
    on plots (PlotShape);

create table if not exists postvalidationqueries
(
    QueryID         int auto_increment
        primary key,
    QueryName       varchar(255)                null,
    QueryDefinition text                        null,
    Description     text                        null,
    IsEnabled       bit default b'0'            not null,
    LastRunAt       datetime                    null,
    LastRunResult   longtext                    null,
    LastRunStatus   enum ('success', 'failure') null
);

create index idx_description
    on postvalidationqueries (Description(255));

create index idx_isenabled
    on postvalidationqueries (IsEnabled);

create index idx_lastrunat
    on postvalidationqueries (LastRunAt);

create index idx_lastrunresult
    on postvalidationqueries (LastRunResult(255));

create index idx_lastrunstatus
    on postvalidationqueries (LastRunStatus);

create index idx_querydefinition
    on postvalidationqueries (QueryDefinition(255));

create index idx_queryname
    on postvalidationqueries (QueryName);

create table if not exists quadrats
(
    QuadratID    int auto_increment
        primary key,
    PlotID       int                  null,
    QuadratName  varchar(255)         null,
    StartX       decimal(12, 6)       null,
    StartY       decimal(12, 6)       null,
    DimensionX   int                  null,
    DimensionY   int                  null,
    Area         decimal(12, 6)       null,
    QuadratShape varchar(255)         null,
    IsActive     tinyint(1) default 1 not null,
    DeletedAt    datetime             null,
    unique_sig   varchar(500) as (concat_ws(_utf8mb4'#', coalesce(`QuadratName`, _utf8mb4''),
                                            coalesce(`StartX`, _utf8mb4''), coalesce(`StartY`, _utf8mb4''),
                                            coalesce(`DimensionX`, _utf8mb4''), coalesce(`DimensionY`, _utf8mb4''),
                                            coalesce(`Area`, _utf8mb4''), coalesce(`QuadratShape`, _utf8mb4''),
                                            coalesce(`IsActive`, _utf8mb4''))) stored,
    constraint unique_full_quadrat
        unique (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, IsActive),
    constraint uq_quadrats_full
        unique (unique_sig),
    constraint Quadrats_Plots_FK
        foreign key (PlotID) references plots (PlotID)
            on delete cascade
);

create index idx_area
    on quadrats (Area);

create index idx_dimensionx
    on quadrats (DimensionX);

create index idx_dimensiony
    on quadrats (DimensionY);

create index idx_plotid
    on quadrats (PlotID);

create index idx_quadratname
    on quadrats (QuadratName);

create index idx_quadratshape
    on quadrats (QuadratShape);

create index idx_startx
    on quadrats (StartX);

create index idx_starty
    on quadrats (StartY);

create table if not exists reference
(
    ReferenceID       int auto_increment
        primary key,
    PublicationTitle  varchar(64)  null,
    FullReference     varchar(255) null,
    DateOfPublication date         null,
    Citation          varchar(50)  null
);

create table if not exists family
(
    FamilyID    int auto_increment
        primary key,
    Family      varchar(32)          null,
    ReferenceID int                  null,
    IsActive    tinyint(1) default 1 not null,
    DeletedAt   datetime             null,
    constraint unique_families
        unique (Family),
    constraint Family_Reference_ReferenceID_fk
        foreign key (ReferenceID) references reference (ReferenceID)
            on delete cascade
);

create index idx_family
    on family (Family);

create index idx_referenceid
    on family (ReferenceID);

create table if not exists genus
(
    GenusID        int auto_increment
        primary key,
    FamilyID       int                  null,
    Genus          varchar(32)          null,
    ReferenceID    int                  null,
    GenusAuthority varchar(32)          null,
    IsActive       tinyint(1) default 1 not null,
    DeletedAt      datetime             null,
    constraint unique_genus
        unique (Genus, IsActive),
    constraint Genus_Family_FamilyID_fk
        foreign key (FamilyID) references family (FamilyID)
            on delete cascade,
    constraint Genus_Reference_ReferenceID_fk
        foreign key (ReferenceID) references reference (ReferenceID)
            on delete cascade
);

create index idx_familyid
    on genus (FamilyID);

create index idx_genus
    on genus (Genus);

create index idx_genusauthority
    on genus (GenusAuthority);

create index idx_referenceid
    on genus (ReferenceID);

create index idx_citation
    on reference (Citation);

create index idx_dateofpublication
    on reference (DateOfPublication);

create index idx_fullreference
    on reference (FullReference);

create index idx_publicationtitle
    on reference (PublicationTitle);

create table if not exists roles
(
    RoleID          int auto_increment
        primary key,
    RoleName        varchar(255)         null,
    RoleDescription varchar(255)         null,
    IsActive        tinyint(1) default 1 not null,
    DeletedAt       datetime             null,
    constraint unique_roles
        unique (RoleName, IsActive)
);

create table if not exists personnel
(
    PersonnelID int auto_increment
        primary key,
    FirstName   varchar(50)          null,
    LastName    varchar(50)          null,
    RoleID      int                  null,
    IsActive    tinyint(1) default 1 not null,
    DeletedAt   datetime             null,
    unique_sig  varchar(500) as (concat_ws(_utf8mb4'#', coalesce(`FirstName`, _utf8mb4''),
                                           coalesce(`LastName`, _utf8mb4''), coalesce(`IsActive`, _utf8mb4''))) stored,
    constraint personnel_FirstName_LastName_RoleID__uindex
        unique (FirstName, LastName, IsActive),
    constraint uq_personnel_full
        unique (unique_sig),
    constraint personnel_roles_RoleID_fk
        foreign key (RoleID) references roles (RoleID)
            on delete cascade
);

create index idx_firstname
    on personnel (FirstName);

create index idx_lastname
    on personnel (LastName);

create index idx_roleid
    on personnel (RoleID);

create index idx_roledescription
    on roles (RoleDescription);

create index idx_rolename
    on roles (RoleName);

create index roles_RoleName_RoleDescription_IsActive_index
    on roles (RoleName, RoleDescription, IsActive);

create table if not exists sitespecificvalidations
(
    ValidationID        int auto_increment
        primary key,
    ProcedureName       varchar(255)     not null,
    Description         text             null,
    Criteria            varchar(255)     null,
    Definition          text             null,
    ChangelogDefinition text             null,
    IsEnabled           bit default b'1' not null
)
    charset = utf8mb3;

create table if not exists species
(
    SpeciesID           int auto_increment
        primary key,
    GenusID             int                  null,
    SpeciesCode         varchar(25)          null,
    SpeciesName         varchar(64)          null,
    SubspeciesName      varchar(64)          null,
    IDLevel             varchar(20)          null,
    SpeciesAuthority    varchar(128)         null,
    SubspeciesAuthority varchar(128)         null,
    FieldFamily         varchar(32)          null,
    Description         varchar(255)         null,
    ValidCode           varchar(255)         null,
    ReferenceID         int                  null,
    IsActive            tinyint(1) default 1 not null,
    DeletedAt           datetime             null,
    unique_sig          varchar(500) as (concat_ws(_utf8mb4'#', coalesce(`SpeciesCode`, _utf8mb4''),
                                                   coalesce(`SpeciesName`, _utf8mb4''),
                                                   coalesce(`SubspeciesName`, _utf8mb4''),
                                                   coalesce(`IDLevel`, _utf8mb4''),
                                                   coalesce(`SpeciesAuthority`, _utf8mb4''),
                                                   coalesce(`SubspeciesAuthority`, _utf8mb4''),
                                                   coalesce(`FieldFamily`, _utf8mb4''),
                                                   coalesce(`Description`, _utf8mb4''))) stored,
    constraint uq_species_sig
        unique (unique_sig),
    constraint Species_Genus_GenusID_fk
        foreign key (GenusID) references genus (GenusID)
            on delete cascade,
    constraint Species_Reference_ReferenceID_fk
        foreign key (ReferenceID) references reference (ReferenceID)
            on delete cascade
);

create index idx_description
    on species (Description);

create index idx_fieldfamily
    on species (FieldFamily);

create index idx_genusid
    on species (GenusID);

create index idx_idlevel
    on species (IDLevel);

create index idx_referenceid
    on species (ReferenceID);

create index idx_speciesauthority
    on species (SpeciesAuthority);

create index idx_speciescode
    on species (SpeciesCode);

create index idx_speciesname
    on species (SpeciesName);

create index idx_subspeciesauthority
    on species (SubspeciesAuthority);

create index idx_subspeciesname
    on species (SubspeciesName);

create index idx_validcode
    on species (ValidCode);

create table if not exists specieslimits
(
    SpeciesLimitID int auto_increment
        primary key,
    SpeciesID      int                  null,
    PlotID         int                  null,
    CensusID       int                  null,
    LimitType      enum ('DBH')         null,
    UpperBound     decimal(12, 6)       null,
    LowerBound     decimal(12, 6)       null,
    IsActive       tinyint(1) default 1 not null,
    DeletedAt      datetime             null,
    constraint specieslimits_census_CensusID_fk
        foreign key (CensusID) references census (CensusID)
            on delete cascade,
    constraint specieslimits_plots_PlotID_fk
        foreign key (PlotID) references plots (PlotID)
            on delete cascade,
    constraint specieslimits_species_SpeciesID_fk
        foreign key (SpeciesID) references species (SpeciesID)
            on delete cascade
);

create index idx_limittype
    on specieslimits (LimitType);

create index idx_lowerbound
    on specieslimits (LowerBound);

create index idx_speciesid
    on specieslimits (SpeciesID);

create index idx_upperbound
    on specieslimits (UpperBound);

create table if not exists temporarymeasurements
(
    id              bigint unsigned auto_increment
        primary key,
    FileID          varchar(36)                         null,
    BatchID         varchar(36)                         not null,
    PlotID          int                                 null,
    CensusID        int                                 null,
    TreeTag         varchar(20)                         null,
    StemTag         varchar(10)                         null,
    SpeciesCode     varchar(25)                         null,
    QuadratName     varchar(255)                        null,
    LocalX          decimal(12, 6)                      null,
    LocalY          decimal(12, 6)                      null,
    DBH             decimal(12, 6)                      null,
    HOM             decimal(12, 6)                      null,
    MeasurementDate date                                null,
    Codes           varchar(255)                        null,
    Comments        varchar(255)                        null,
    UploadedAt      timestamp default CURRENT_TIMESTAMP null
);

create index idx_cid_md_dbh_hom_qn_tt
    on temporarymeasurements (CensusID, MeasurementDate, DBH, HOM, QuadratName, TreeTag);

create index idx_tm_tag_xy_cid
    on temporarymeasurements (StemTag, LocalX, LocalY, CensusID);

create index idx_tmpm_file_batch_census
    on temporarymeasurements (FileID, BatchID, CensusID);

create index ingest_temporarymeasurements_FBPC_index
    on temporarymeasurements (FileID, BatchID, PlotID, CensusID);

create index ingest_temporarymeasurements_batchID_index
    on temporarymeasurements (BatchID);

create index temporarymeasurements_Codes_index
    on temporarymeasurements (Codes);

create index temporarymeasurements_DBH_HOM_MeasurementDate_index
    on temporarymeasurements (DBH, HOM, MeasurementDate);

create index temporarymeasurements_FileID_BatchID_index
    on temporarymeasurements (FileID, BatchID);

create index temporarymeasurements_FileID_index
    on temporarymeasurements (FileID);

create index temporarymeasurements_QuadratName_index
    on temporarymeasurements (QuadratName);

create index temporarymeasurements_StemTag_LocalX_LocalY_index
    on temporarymeasurements (StemTag, LocalX, LocalY);

create index temporarymeasurements_StemTag_index
    on temporarymeasurements (StemTag);

create index temporarymeasurements_TreeTag_SpeciesCode_index
    on temporarymeasurements (TreeTag, SpeciesCode);

create index temporarymeasurements_TreeTag_index
    on temporarymeasurements (TreeTag);

create index temporarymeasurements_id_index
    on temporarymeasurements (id);

create table if not exists trees
(
    TreeID    int auto_increment
        primary key,
    TreeTag   varchar(20)          null,
    SpeciesID int                  null,
    CensusID  int                  null,
    IsActive  tinyint(1) default 1 not null,
    DeletedAt datetime             null,
    constraint ux_trees_treetag_speciesid_censusid
        unique (TreeTag, SpeciesID, CensusID),
    constraint Trees_Species_SpeciesID_fk
        foreign key (SpeciesID) references species (SpeciesID)
            on delete cascade,
    constraint trees_census_CensusID_fk_2
        foreign key (CensusID) references census (CensusID)
            on update cascade on delete cascade
);

create table if not exists stems
(
    StemID          int auto_increment
        primary key,
    TreeID          int                  null,
    QuadratID       int                  null,
    CensusID        int                  null,
    StemNumber      int                  null,
    StemTag         varchar(10)          null,
    LocalX          decimal(12, 6)       null,
    LocalY          decimal(12, 6)       null,
    Moved           bit                  null,
    StemDescription varchar(255)         null,
    IsActive        tinyint(1) default 1 not null,
    DeletedAt       datetime             null,
    constraint ux_stems_coordinate
        unique (StemTag, TreeID, QuadratID, LocalX, LocalY, IsActive, CensusID),
    constraint ux_stems_treeid_stemtag_census
        unique (TreeID, StemTag, CensusID),
    constraint FK_Stems_Trees
        foreign key (TreeID) references trees (TreeID)
            on delete cascade,
    constraint stems_census_CensusID_fk_2
        foreign key (CensusID) references census (CensusID)
            on update cascade on delete cascade,
    constraint stems_quadrats_QuadratID_fk
        foreign key (QuadratID) references quadrats (QuadratID)
            on delete cascade
);

create table if not exists coremeasurements
(
    CoreMeasurementID int auto_increment
        primary key,
    CensusID          int                     null,
    StemID            int                     null,
    IsValidated       bit        default b'0' null,
    MeasurementDate   date                    null,
    MeasuredDBH       decimal(12, 6)          null,
    MeasuredHOM       decimal(12, 6)          null,
    Description       varchar(255)            null,
    UserDefinedFields json                    null,
    IsActive          tinyint(1) default 1    not null,
    DeletedAt         datetime                null,
    constraint ux_measure_unique
        unique (StemID, CensusID, MeasurementDate, MeasuredDBH, MeasuredHOM),
    constraint FK_CoreMeasurements_Stems
        foreign key (StemID) references stems (StemID)
            on delete cascade,
    constraint coremeasurements_census_CensusID_fk
        foreign key (CensusID) references census (CensusID)
            on delete cascade
);

create table if not exists cmattributes
(
    CMAID             int auto_increment
        primary key,
    CoreMeasurementID int         null,
    Code              varchar(10) null,
    constraint unique_cm_attribute
        unique (CoreMeasurementID, Code),
    constraint CMAttributes_Attributes_Code_fk
        foreign key (Code) references attributes (Code)
            on delete cascade,
    constraint CMAttributes_CoreMeasurements_CoreMeasurementID_fk
        foreign key (CoreMeasurementID) references coremeasurements (CoreMeasurementID)
            on delete cascade
);

create table if not exists cmverrors
(
    CMVErrorID        int auto_increment
        primary key,
    CoreMeasurementID int null,
    ValidationErrorID int null,
    constraint unique_cmverrors_cm_valerror
        unique (CoreMeasurementID, ValidationErrorID),
    constraint cmverrors_coremeasurements_CoreMeasurementID_fk
        foreign key (CoreMeasurementID) references coremeasurements (CoreMeasurementID)
            on delete cascade,
    constraint cmverrors_sitespecificvalidations_ValidationID_fk
        foreign key (ValidationErrorID) references sitespecificvalidations (ValidationID)
            on delete cascade
);

create index idx_censusid
    on coremeasurements (CensusID);

create index idx_cm_stem_cid_date_dbh_hom
    on coremeasurements (StemID, CensusID, MeasurementDate, MeasuredDBH, MeasuredHOM);

create index idx_description
    on coremeasurements (Description);

create index idx_isvalidated
    on coremeasurements (IsValidated);

create index idx_measureddbh
    on coremeasurements (MeasuredDBH);

create index idx_measuredhom
    on coremeasurements (MeasuredHOM);

create index idx_measurementdate
    on coremeasurements (MeasurementDate);

create index idx_stemid
    on coremeasurements (StemID);

create index ix_cm_cid_date_dbh_hom
    on coremeasurements (CensusID, MeasurementDate, MeasuredDBH, MeasuredHOM);

create table if not exists specimens
(
    SpecimenID     int auto_increment
        primary key,
    StemID         int                  null,
    PersonnelID    int                  null,
    SpecimenNumber int                  null,
    SpeciesID      int                  null,
    Herbarium      varchar(32)          null,
    Voucher        smallint unsigned    null,
    CollectionDate date                 null,
    DeterminedBy   varchar(64)          null,
    Description    varchar(255)         null,
    IsActive       tinyint(1) default 1 not null,
    DeletedAt      datetime             null,
    constraint specimens_personnel_PersonnelID_fk
        foreign key (PersonnelID) references personnel (PersonnelID)
            on delete cascade,
    constraint specimens_stems_StemID_fk
        foreign key (StemID) references stems (StemID)
            on delete cascade
);

create index idx_localx
    on stems (LocalX);

create index idx_localy
    on stems (LocalY);

create index idx_moved
    on stems (Moved);

create index idx_quadratid
    on stems (QuadratID);

create index idx_s_qid_st
    on stems (QuadratID, StemTag);

create index idx_stemdescription
    on stems (StemDescription);

create index idx_stemnumber
    on stems (StemNumber);

create index idx_stems_stemtag_quadratid
    on stems (StemTag, QuadratID);

create index idx_stemtag
    on stems (StemTag);

create index idx_treeid
    on stems (TreeID);

create index ix_stems_treeid_stemtag_quadratid
    on stems (TreeID, StemTag, QuadratID);

create index idx_speciesid
    on trees (SpeciesID);

create index trees_TreeTag_index
    on trees (TreeTag);

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

create index idx_censusid
    on unifiedchangelog (CensusID);

create index idx_changedby
    on unifiedchangelog (ChangedBy);

create index idx_changetimestamp
    on unifiedchangelog (ChangeTimestamp);

create index idx_operation
    on unifiedchangelog (Operation);

create index idx_plotid
    on unifiedchangelog (PlotID);

create index idx_recordid
    on unifiedchangelog (RecordID);

create index idx_tablename
    on unifiedchangelog (TableName);

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
    CoreMeasurementID          int auto_increment
        primary key,
    MeasurementDate            date                                                                null,
    MeasuredDBH                decimal(10, 6)                                                      null,
    MeasuredHOM                decimal(10, 6)                                                      null,
    Description                varchar(255)                                                        null,
    IsValidated                bit                                                    default b'0' null,
    PlotID                     int                                                                 null,
    PlotName                   varchar(255)                                                        null,
    LocationName               varchar(255)                                                        null,
    CountryName                varchar(255)                                                        null,
    DimensionX                 int                                                                 null,
    DimensionY                 int                                                                 null,
    PlotArea                   decimal(10, 6)                                                      null,
    PlotGlobalX                decimal(10, 6)                                                      null,
    PlotGlobalY                decimal(10, 6)                                                      null,
    PlotGlobalZ                decimal(10, 6)                                                      null,
    PlotShape                  varchar(255)                                                        null,
    PlotDescription            varchar(255)                                                        null,
    PlotDefaultDimensionUnits  enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'm'  not null,
    PlotDefaultCoordinateUnits enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'm'  not null,
    PlotDefaultAreaUnits       enum ('km2', 'hm2', 'dam2', 'm2', 'dm2', 'cm2', 'mm2') default 'm2' not null,
    PlotDefaultDBHUnits        enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'mm' not null,
    PlotDefaultHOMUnits        enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm')        default 'm'  not null,
    CensusID                   int                                                                 null,
    CensusStartDate            date                                                                null,
    CensusEndDate              date                                                                null,
    CensusDescription          varchar(255)                                                        null,
    PlotCensusNumber           int                                                                 null,
    QuadratID                  int                                                                 null,
    QuadratName                varchar(255)                                                        null,
    QuadratDimensionX          int                                                                 null,
    QuadratDimensionY          int                                                                 null,
    QuadratArea                decimal(10, 6)                                                      null,
    QuadratStartX              decimal(10, 6)                                                      null,
    QuadratStartY              decimal(10, 6)                                                      null,
    QuadratShape               varchar(255)                                                        null,
    TreeID                     int                                                                 null,
    TreeTag                    varchar(20)                                                         null,
    StemID                     int                                                                 null,
    StemTag                    varchar(10)                                                         null,
    StemLocalX                 decimal(10, 6)                                                      null,
    StemLocalY                 decimal(10, 6)                                                      null,
    SpeciesID                  int                                                                 null,
    SpeciesCode                varchar(25)                                                         null,
    SpeciesName                varchar(64)                                                         null,
    SubspeciesName             varchar(64)                                                         null,
    SubspeciesAuthority        varchar(128)                                                        null,
    SpeciesIDLevel             varchar(20)                                                         null,
    GenusID                    int                                                                 null,
    Genus                      varchar(32)                                                         null,
    GenusAuthority             varchar(32)                                                         null,
    FamilyID                   int                                                                 null,
    Family                     varchar(32)                                                         null,
    Attributes                 varchar(255)                                                        null,
    UserDefinedFields          json                                                                null
);

