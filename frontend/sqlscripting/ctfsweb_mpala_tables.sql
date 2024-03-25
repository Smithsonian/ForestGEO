create table census
(
    CensusID         int unsigned auto_increment
        primary key,
    PlotID           int unsigned not null,
    PlotCensusNumber char(16)     null,
    StartDate        date         null,
    EndDate          date         null,
    Description      varchar(128) null
)
    charset = latin1;

create index Ref610
    on census (PlotID);

create table censusquadrat
(
    CensusID        int unsigned not null,
    QuadratID       int unsigned not null,
    CensusQuadratID int unsigned auto_increment
        primary key
)
    charset = latin1;

create index QuadratID
    on censusquadrat (QuadratID);

create index Ref534
    on censusquadrat (CensusID);

create table coordinates
(
    CoorID       int unsigned auto_increment
        primary key,
    FeatureID    int unsigned   null,
    PlotID       int unsigned   null,
    QuadratID    int unsigned   null,
    GX           decimal(16, 5) null,
    GY           decimal(16, 5) null,
    GZ           decimal(16, 5) null,
    PX           decimal(16, 5) null,
    PY           decimal(16, 5) null,
    PZ           decimal(16, 5) null,
    QX           decimal(16, 5) null,
    QY           decimal(16, 5) null,
    QZ           decimal(16, 5) null,
    CoordinateNo int unsigned   null
)
    charset = latin1;

create index FeatureID
    on coordinates (FeatureID);

create index PlotID
    on coordinates (PlotID);

create index QuadratID
    on coordinates (QuadratID);

create table country
(
    CountryID   smallint unsigned auto_increment
        primary key,
    CountryName varchar(64) null
)
    charset = latin1;

create table currentobsolete
(
    SpeciesID         int unsigned not null,
    ObsoleteSpeciesID int unsigned not null,
    ChangeDate        datetime     not null,
    ChangeCodeID      int unsigned not null,
    ChangeNote        varchar(128) null,
    primary key (SpeciesID, ObsoleteSpeciesID, ChangeDate)
)
    charset = latin1;

create index Ref32191
    on currentobsolete (ChangeCodeID);

create index Ref92192
    on currentobsolete (SpeciesID);

create index Ref92212
    on currentobsolete (ObsoleteSpeciesID);

create table datacollection
(
    CensusID         int unsigned not null,
    StartDate        date         null,
    EndDate          date         null,
    DataCollectionID int unsigned auto_increment
        primary key,
    PersonnelRoleID  int unsigned not null,
    QuadratID        int unsigned not null
)
    charset = latin1;

create index PersonnelRoleID
    on datacollection (PersonnelRoleID);

create index QuadratID
    on datacollection (QuadratID);

create index Ref1743
    on datacollection (CensusID);

create table dbh
(
    MeasureID   int unsigned not null,
    CensusID    int unsigned not null,
    StemID      int unsigned not null,
    DBH         float        null,
    HOM         char(16)     null,
    PrimaryStem varchar(20)  null,
    ExactDate   date         null,
    DBHID       int unsigned auto_increment
        primary key,
    Comments    varchar(128) null
)
    charset = latin1;

create index Ref1951
    on dbh (StemID);

create index Ref549
    on dbh (CensusID);

create table dbhattributes
(
    TSMID    int unsigned not null,
    DBHID    int unsigned null,
    DBHAttID int unsigned auto_increment
        primary key
)
    charset = latin1;

create index DBHID
    on dbhattributes (DBHID);

create index Ref2053
    on dbhattributes (TSMID);

create table family
(
    FamilyID    int unsigned auto_increment
        primary key,
    Family      char(32)          null,
    ReferenceID smallint unsigned null
)
    charset = latin1;

create index Ref84175
    on family (ReferenceID);

create table features
(
    FeatureID     int unsigned auto_increment
        primary key,
    FeatureTypeID int unsigned not null,
    Name          varchar(32)  not null,
    ShortDescrip  varchar(32)  null,
    LongDescrip   varchar(128) null
)
    charset = latin1;

create index FeatureTypeID
    on features (FeatureTypeID);

create table featuretypes
(
    FeatureTypeID int unsigned auto_increment
        primary key,
    Type          varchar(32) not null
)
    charset = latin1;

create table genus
(
    GenusID     int unsigned auto_increment
        primary key,
    Genus       char(32)          null,
    ReferenceID smallint unsigned null,
    Authority   char(32)          null,
    FamilyID    int unsigned      not null
)
    charset = latin1;

create index Ref2868
    on genus (FamilyID);

create index Ref84176
    on genus (ReferenceID);

create table log
(
    LogID         bigint unsigned auto_increment
        primary key,
    PersonnelID   smallint unsigned                   null,
    ChangedTable  varchar(32)                         not null,
    PrimaryKey    varchar(32)                         not null,
    ChangedColumn varchar(32)                         not null,
    ChangeDate    date                                null,
    ChangeTime    timestamp default CURRENT_TIMESTAMP not null on update CURRENT_TIMESTAMP,
    Description   varchar(256)                        null,
    Action        enum ('I', 'D', 'U')                not null,
    Old           varchar(512)                        not null,
    New           varchar(512)                        not null
)
    charset = latin1;

create index PersonnelID
    on log (PersonnelID);

create table measurement
(
    MeasureID         int unsigned auto_increment
        primary key,
    CensusID          int unsigned not null,
    TreeID            int unsigned not null,
    StemID            int unsigned not null,
    MeasurementTypeID int unsigned not null,
    Measure           varchar(256) not null,
    ExactDate         date         not null,
    Comments          varchar(128) null
)
    charset = latin1;

create index CensusID
    on measurement (CensusID);

create index MeasurementTypeID
    on measurement (MeasurementTypeID);

create index StemID
    on measurement (StemID);

create index TreeID
    on measurement (TreeID);

create table measurementattributes
(
    MAttID    int unsigned auto_increment
        primary key,
    MeasureID int unsigned not null,
    TSMID     int unsigned not null
)
    charset = latin1;

create index MeasureID
    on measurementattributes (MeasureID);

create index TSMID
    on measurementattributes (TSMID);

create table measurementtype
(
    MeasurementTypeID int unsigned auto_increment
        primary key,
    UOM               varchar(32)  not null,
    Type              varchar(256) null
)
    charset = latin1;

create table personnel
(
    PersonnelID smallint unsigned auto_increment
        primary key,
    FirstName   varchar(32) null,
    LastName    varchar(32) not null
)
    charset = latin1;

create table personnelrole
(
    PersonnelRoleID int unsigned auto_increment
        primary key,
    PersonnelID     smallint unsigned not null,
    RoleID          smallint unsigned not null
)
    charset = latin1;

create index PersonnelID
    on personnelrole (PersonnelID);

create index RoleID
    on personnelrole (RoleID);

create table quadrat
(
    PlotID          int unsigned    not null,
    QuadratName     char(8)         null,
    Area            float unsigned  null,
    IsStandardShape enum ('Y', 'N') not null,
    QuadratID       int unsigned auto_increment
        primary key
)
    charset = latin1;

create index Ref69
    on quadrat (PlotID);

create index indQuadName
    on quadrat (QuadratName, PlotID);

create table reference
(
    ReferenceID       smallint unsigned auto_increment
        primary key,
    PublicationTitle  varchar(64)  null,
    FullReference     varchar(256) null,
    DateofPublication date         null
)
    charset = latin1;

create table remeasattribs
(
    TSMID       int unsigned not null,
    RemeasureID int unsigned not null,
    RmAttID     int unsigned auto_increment
        primary key
)
    charset = latin1;

create index Ref2073
    on remeasattribs (TSMID);

create index RemeasureID
    on remeasattribs (RemeasureID);

create table remeasurement
(
    CensusID    int unsigned not null,
    StemID      int unsigned not null,
    DBH         float        null,
    HOM         float        null,
    ExactDate   date         null,
    RemeasureID int unsigned auto_increment
        primary key
)
    charset = latin1;

create index Ref1957
    on remeasurement (StemID);

create index Ref5106
    on remeasurement (CensusID);

create table rolereference
(
    RoleID      smallint unsigned auto_increment
        primary key,
    Description varchar(128) null
)
    charset = latin1;

create table site
(
    PlotID            int unsigned auto_increment
        primary key,
    PlotName          char(64)          null,
    LocationName      varchar(128)      null,
    CountryID         smallint unsigned not null,
    ShapeOfSite       char(32)          null,
    DescriptionOfSite varchar(128)      null,
    Area              float unsigned    not null,
    QDimX             float unsigned    not null,
    QDimY             float unsigned    not null,
    GUOM              varchar(32)       not null,
    GZUOM             varchar(32)       not null,
    PUOM              varchar(32)       not null,
    QUOM              varchar(32)       not null,
    GCoorCollected    varchar(32)       null,
    PCoorCollected    varchar(32)       null,
    QCoorCollected    varchar(32)       null,
    IsStandardSize    enum ('Y', 'N')   null
)
    charset = latin1;

create index Ref87173
    on site (CountryID);

create table species
(
    SpeciesID         int unsigned auto_increment
        primary key,
    CurrentTaxonFlag  smallint                                                                                         null,
    ObsoleteTaxonFlag smallint                                                                                         null,
    GenusID           int unsigned                                                                                     not null,
    ReferenceID       smallint unsigned                                                                                null,
    SpeciesName       char(64)                                                                                         null,
    Mnemonic          char(10)                                                                                         null,
    Authority         varchar(128)                                                                                     null,
    IDLEVEL           enum ('subspecies', 'species', 'superspecies', 'genus', 'family', 'multiple', 'none', 'variety') null,
    FieldFamily       char(32)                                                                                         null,
    Description       varchar(128)                                                                                     null,
    LocalName         varchar(128)                                                                                     null,
    Lifeform          enum ('Emergent Tree', 'Tree', 'Midcanopy Tree', 'Understory Tree', 'Shrub', 'Herb', 'Liana')    null
)
    charset = latin1;

create index Ref26208
    on species (GenusID);

create index Ref84209
    on species (ReferenceID);

create index indMnemonic
    on species (Mnemonic);

create table speciesinventory
(
    SpeciesInvID int unsigned auto_increment
        primary key,
    CensusID     int unsigned not null,
    PlotID       int unsigned not null,
    SpeciesID    int unsigned not null,
    SubSpeciesID int unsigned null
)
    charset = latin1;

create index Ref5222
    on speciesinventory (CensusID);

create index Ref642
    on speciesinventory (PlotID);

create index Ref92198
    on speciesinventory (SpeciesID);

create index Ref93199
    on speciesinventory (SubSpeciesID);

create table specimen
(
    SpecimenID     int unsigned auto_increment
        primary key,
    TreeID         int unsigned      null,
    Collector      char(64)          null,
    SpecimenNumber int unsigned      null,
    SpeciesID      int unsigned      not null,
    SubSpeciesID   int unsigned      null,
    Herbarium      char(32)          null,
    Voucher        smallint unsigned null,
    CollectionDate date              null,
    DeterminedBy   char(64)          null,
    Description    varchar(128)      null
)
    charset = latin1;

create index Ref1171
    on specimen (TreeID);

create index Ref92196
    on specimen (SpeciesID);

create index Ref93194
    on specimen (SubSpeciesID);

create table stem
(
    StemID          int unsigned auto_increment
        primary key,
    TreeID          int unsigned                not null,
    StemTag         varchar(32)                 null,
    StemDescription varchar(128)                null,
    QuadratID       int unsigned                not null,
    StemNumber      int unsigned                not null,
    Moved           enum ('Y', 'N') default 'N' not null,
    GX              decimal(16, 5)              null,
    GY              decimal(16, 5)              null,
    GZ              decimal(16, 5)              null,
    PX              decimal(16, 5)              null,
    PY              decimal(16, 5)              null,
    PZ              decimal(16, 5)              null,
    QX              decimal(16, 5)              null,
    QY              decimal(16, 5)              null,
    QZ              decimal(16, 5)              null
)
    charset = latin1;

create index Ref150
    on stem (TreeID, StemTag);

create table subspecies
(
    SubSpeciesID       int unsigned auto_increment
        primary key,
    SpeciesID          int unsigned not null,
    CurrentTaxonFlag   smallint     null,
    ObsoleteTaxonFlag  smallint     null,
    SubSpeciesName     char(64)     null,
    Mnemonic           char(10)     null,
    Authority          varchar(128) null,
    InfraSpecificLevel char(32)     null
)
    charset = latin1;

create index Ref92193
    on subspecies (SpeciesID);

create table tax2temp
(
    SpeciesID           int                       not null,
    ObsoleteSpeciesID   int                       not null,
    ObsoleteGenusName   char(32)                  null,
    ObsoleteSpeciesName char(64)                  null,
    ObsoleteGenSpeName  char(128)                 null,
    Description         char(128)                 null,
    ChangeDate          date default '0000-00-00' not null,
    Family              char(32)                  null,
    Genus               char(32)                  null,
    SpeciesName         char(64)                  null,
    Authority           char(128)                 null,
    IDLevel             char(8)                   null,
    primary key (SpeciesID, ObsoleteSpeciesID, ChangeDate)
)
    charset = latin1;

create table tax3temp
(
    PlotSpeciesID int auto_increment
        primary key,
    PlotID        int not null,
    SpeciesID     int not null,
    SubSpeciesID  int null
)
    charset = latin1;

create index TAX3Plot
    on tax3temp (PlotID, SpeciesID, SubSpeciesID);

create table tree
(
    TreeID       int unsigned auto_increment
        primary key,
    Tag          char(10)     null,
    SpeciesID    int unsigned not null,
    SubSpeciesID int unsigned null
)
    charset = latin1;

create index Ref92217
    on tree (SpeciesID);

create index Ref93219
    on tree (SubSpeciesID);

create index indTreeTag
    on tree (Tag);

create table treeattributes
(
    CensusID int unsigned not null,
    TreeID   int unsigned not null,
    TSMID    int unsigned not null,
    TAttID   int unsigned auto_increment
        primary key
)
    charset = latin1;

create index Ref163
    on treeattributes (TreeID);

create index Ref2064
    on treeattributes (TSMID);

create index Ref5107
    on treeattributes (CensusID);

create table treetaxchange
(
    ChangeCodeID int unsigned not null
        primary key,
    Description  varchar(128) null
)
    charset = latin1;

create table tsmattributes
(
    TSMID       int unsigned auto_increment
        primary key,
    TSMCode     char(10)     not null,
    Description varchar(128) not null,
    Status      char(32)     null
)
    charset = latin1;

create table viewfulltable
(
    DBHID            int                                                                                       not null
        primary key,
    PlotName         varchar(35)                                                                               null,
    PlotID           int                                                                                       null,
    Family           char(32)                                                                                  null,
    Genus            char(32)                                                                                  null,
    SpeciesName      char(64)                                                                                  null,
    Mnemonic         char(10)                                                                                  null,
    Subspecies       char(64)                                                                                  null,
    SpeciesID        int                                                                                       null,
    SubspeciesID     int                                                                                       null,
    QuadratName      varchar(12)                                                                               null,
    QuadratID        int                                                                                       null,
    PX               decimal(16, 5)                                                                            null,
    PY               decimal(16, 5)                                                                            null,
    QX               decimal(16, 5)                                                                            null,
    QY               decimal(16, 5)                                                                            null,
    TreeID           int                                                                                       null,
    Tag              char(10)                                                                                  null,
    StemID           int                                                                                       null,
    StemNumber       int                                                                                       null,
    StemTag          varchar(32)                                                                               null,
    PrimaryStem      char(20)                                                                                  null,
    CensusID         int                                                                                       null,
    PlotCensusNumber int                                                                                       null,
    DBH              float                                                                                     null,
    HOM              decimal(10, 2)                                                                            null,
    ExactDate        date                                                                                      null,
    Date             int                                                                                       null,
    ListOfTSM        varchar(256)                                                                              null,
    HighHOM          tinyint(1)                                                                                null,
    LargeStem        tinyint(1)                                                                                null,
    Status           enum ('alive', 'dead', 'stem dead', 'broken below', 'omitted', 'missing') default 'alive' null
)
    charset = utf8mb4;

create index CensusID
    on viewfulltable (CensusID);

create index CensusID_2
    on viewfulltable (CensusID);

create index DBH
    on viewfulltable (DBH);

create index Date
    on viewfulltable (Date);

create index Date_2
    on viewfulltable (Date);

create index Genus
    on viewfulltable (Genus, SpeciesName);

create index HighHOM
    on viewfulltable (HighHOM);

create index ListOfTSM
    on viewfulltable (ListOfTSM(250));

create index Mnemonic
    on viewfulltable (Mnemonic);

create index PlotCensusNumber
    on viewfulltable (PlotCensusNumber);

create index QuadratID
    on viewfulltable (QuadratID);

create index SpeciesID
    on viewfulltable (SpeciesID);

create index Status
    on viewfulltable (Status);

create index StemID
    on viewfulltable (StemID);

create index StemTag
    on viewfulltable (StemTag);

create index SubspeciesID
    on viewfulltable (SubspeciesID);

create index Tag
    on viewfulltable (Tag);

create index TreeID
    on viewfulltable (TreeID);

create table viewtaxonomy
(
    ViewID         int auto_increment
        primary key,
    SpeciesID      int                                                  null,
    SubspeciesID   int                                                  null,
    Family         char(32)                                             null,
    Mnemonic       char(10)                                             null,
    Genus          char(32)                                             null,
    SpeciesName    char(64)                                             null,
    `Rank`         char(20)                                             null,
    Subspecies     char(64)                                             null,
    Authority      char(128)                                            null,
    IDLevel        char(12)                                             null,
    subspMnemonic  char(10)                                             null,
    subspAuthority varchar(120)                                         null,
    FieldFamily    char(32)                                             null,
    Lifeform       char(20)                                             null,
    Description    text                                                 null,
    wsg            decimal(10, 6)                                       null,
    wsglevel       enum ('local', 'species', 'genus', 'family', 'none') null,
    ListOfOldNames varchar(255)                                         null,
    Specimens      varchar(255)                                         null,
    Reference      varchar(255)                                         null
)
    charset = utf8mb4;

create index IDLevel
    on viewtaxonomy (IDLevel);

create index SpeciesID
    on viewtaxonomy (SpeciesID);

create index SubspeciesID
    on viewtaxonomy (SubspeciesID);

