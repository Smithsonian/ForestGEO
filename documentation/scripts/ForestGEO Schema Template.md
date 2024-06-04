###### SQL:
```SQL
drop table if exists attributes;  
drop table if exists census;  
drop table if exists cmattributes;  
drop table if exists cmverrors;  
drop table if exists coremeasurements;  
drop table if exists family;  
drop table if exists genus;  
drop table if exists personnel;  
drop table if exists plots;  
drop table if exists quadratpersonnel;  
drop table if exists quadrats;  
drop table if exists reference;  
drop table if exists species;  
drop table if exists specieslimits;  
drop table if exists stems;  
drop table if exists subquadrats;  
drop table if exists trees;  
drop table if exists validationchangelog;  
drop table if exists validationerrors;  
drop view if exists alltaxonomiesview;  
drop view if exists measurementssummaryview;  
drop view if exists stemdimensionsview;  
drop view if exists stemtaxonomiesview;  
drop view if exists viewfulltable;  
drop procedure if exists ValidateDBHGrowthExceedsMax;  
drop procedure if exists ValidateDBHShrinkageExceedsMax;  
drop procedure if exists ValidateFindAllInvalidSpeciesCodes;  
drop procedure if exists ValidateFindDuplicatedQuadratsByName;  
drop procedure if exists ValidateFindDuplicateStemTreeTagCombinationsPerCensus;  
drop procedure if exists ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat;  
drop procedure if exists ValidateFindStemsInTreeWithDifferentSpecies;  
drop procedure if exists ValidateFindStemsOutsidePlots;  
drop procedure if exists ValidateFindTreeStemsInDifferentQuadrats;  
drop procedure if exists ValidateHOMUpperAndLowerBounds;  
drop procedure if exists ValidateScreenMeasuredDiameterMinMax;  
drop procedure if exists ValidateScreenStemsWithMeasurementsButDeadAttributes;  
create table attributes  
(  
    Code        varchar(10)                                                                                                     not null  
        primary key,  
    Description text                                                                                                            null,  
    Status      enum ('alive', 'alive-not measured', 'dead', 'stem dead', 'broken below', 'omitted', 'missing') default 'alive' null  
);  
  
create table personnel  
(  
    PersonnelID int auto_increment  
        primary key,  
    FirstName   varchar(50)  null,  
    LastName    varchar(50)  null,  
    Role        varchar(150) null comment 'semicolon-separated, like attributes in coremeasurements'  
);  
  
create table plots  
(  
    PlotID          int auto_increment  
        primary key,  
    PlotName        text                                                         null,  
    LocationName    text                                                         null,  
    CountryName     text                                                         null,  
    DimensionX      int                                                          null,  
    DimensionY      int                                                          null,  
    Area            decimal(10, 6)                                               null,  
    GlobalX         decimal(10, 6)                                               null,  
    GlobalY         decimal(10, 6)                                               null,  
    GlobalZ         decimal(10, 6)                                               null,  
    Unit            enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm'  null,  
    UsesSubquadrats bit                                             default b'0' null,  
    PlotShape       text                                                         null,  
    PlotDescription text                                                         null  
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
    PlotID       int                                                         null,  
    CensusID     int                                                         null,  
    QuadratName  text                                                        null,  
    StartX       decimal(10, 6)                                              null,  
    StartY       decimal(10, 6)                                              null,  
    DimensionX   int                                                         null,  
    DimensionY   int                                                         null,  
    Area         decimal(10, 6)                                              null,  
    QuadratShape text                                                        null,  
    Unit         enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm' null,  
    constraint Quadrats_Plots_FK  
        foreign key (PlotID) references plots (PlotID),  
    constraint quadrats_census_CensusID_fk  
        foreign key (CensusID) references census (CensusID)  
);  
  
create table quadratpersonnel  
(  
    QuadratPersonnelID int auto_increment  
        primary key,  
    QuadratID          int  not null,  
    PersonnelID        int  not null,  
    AssignedDate       date null,  
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
  
create table species  
(  
    SpeciesID           int auto_increment  
        primary key,  
    GenusID             int          null,  
    SpeciesCode         varchar(25)  null,  
    CurrentTaxonFlag    bit          null,  
    ObsoleteTaxonFlag   bit          null,  
    SpeciesName         varchar(64)  null,  
    SubspeciesName      varchar(255) null,  
    IDLevel             varchar(20)  null,  
    SpeciesAuthority    varchar(128) null,  
    SubspeciesAuthority varchar(255) null,  
    FieldFamily         varchar(32)  null,  
    Description         text         null,  
    ReferenceID         int          null,  
    constraint SpeciesCode  
        unique (SpeciesCode),  
    constraint Species_SpeciesCode  
        unique (SpeciesCode),  
    constraint Species_Genus_GenusID_fk  
        foreign key (GenusID) references genus (GenusID),  
    constraint Species_Reference_ReferenceID_fk  
        foreign key (ReferenceID) references reference (ReferenceID)  
);  
  
create table specieslimits  
(  
    SpeciesLimitID int auto_increment  
        primary key,  
    SpeciesCode    varchar(25)                                                 null,  
    LimitType      enum ('DBH', 'HOM')                                         null,  
    UpperBound     decimal(10, 6)                                              null,  
    LowerBound     decimal(10, 6)                                              null,  
    Unit           enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm' null,  
    constraint specieslimits_ibfk_1  
        foreign key (SpeciesCode) references species (SpeciesCode)  
);  
  
create table subquadrats  
(  
    SubquadratID   int auto_increment  
        primary key,  
    SubquadratName varchar(25)                                                 null,  
    QuadratID      int                                                         null,  
    DimensionX     int                                             default 5   null,  
    DimensionY     int                                             default 5   null,  
    X              int                                                         null comment 'corner x index value (standardized)',  
    Y              int                                                         null comment 'corner y index value (standardized)',  
    Unit           enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm' null,  
    Ordering       int                                                         null comment 'SQindex should tell you in which order the subquads are surveyed. This will be useful later.',  
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
    SubquadratID    int                                                         null,  
    StemNumber      int                                                         null,  
    StemTag         varchar(10)                                                 null,  
    LocalX          decimal(10, 6)                                              null,  
    LocalY          decimal(10, 6)                                              null,  
    Unit            enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm' null,  
    Moved           bit                                                         null,  
    StemDescription text                                                        null,  
    constraint FK_Stems_Trees  
        foreign key (TreeID) references trees (TreeID),  
    constraint stems_quadrats_QuadratID_fk  
        foreign key (QuadratID) references quadrats (QuadratID),  
    constraint stems_subquadrats_SQID_fk  
        foreign key (SubquadratID) references subquadrats (SubquadratID)  
);  
  
create table coremeasurements  
(  
    CoreMeasurementID int auto_increment  
        primary key,  
    CensusID          int                                                          null,  
    PlotID            int                                                          null,  
    QuadratID         int                                                          null,  
    SubQuadratID      int                                                          null,  
    TreeID            int                                                          null,  
    StemID            int                                                          null,  
    PersonnelID       int                                                          null,  
    IsValidated       bit                                             default b'0' null,  
    MeasurementDate   date                                                         null,  
    MeasuredDBH       decimal(10, 6)                                               null,  
    DBHUnit           enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm'  null,  
    MeasuredHOM       decimal(10, 6)                                               null,  
    HOMUnit           enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm'  null,  
    Description       text                                                         null,  
    UserDefinedFields text                                                         null,  
    constraint CoreMeasurements_Census_CensusID_fk  
        foreign key (CensusID) references census (CensusID),  
    constraint CoreMeasurements_Personnel_PersonnelID_fk  
        foreign key (PersonnelID) references personnel (PersonnelID),  
    constraint FK_CoreMeasurements_Stems  
        foreign key (StemID) references stems (StemID),  
    constraint FK_CoreMeasurements_Trees  
        foreign key (TreeID) references trees (TreeID),  
    constraint coremeasurements_plots_PlotID_fk  
        foreign key (PlotID) references plots (PlotID),  
    constraint coremeasurements_quadrats_QuadratID_fk  
        foreign key (QuadratID) references quadrats (QuadratID),  
    constraint coremeasurements_subquadrats_SQID_fk  
        foreign key (SubQuadratID) references subquadrats (SubquadratID)  
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
  
create index idx_quadratid  
    on coremeasurements (SubQuadratID);  
  
create index idx_stemid  
    on coremeasurements (StemID);  
  
create index idx_treeid  
    on coremeasurements (TreeID);  
  
create index idx_stemid  
    on stems (StemID);  
  
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
  
create definer = azureroot@`%` view alltaxonomiesview as  
select `s`.`SpeciesID`           AS `SpeciesID`,  
       `f`.`FamilyID`            AS `FamilyID`,  
       `g`.`GenusID`             AS `GenusID`,  
       `r`.`ReferenceID`         AS `ReferenceID`,  
       `s`.`SpeciesCode`         AS `SpeciesCode`,  
       `f`.`Family`              AS `Family`,  
       `g`.`Genus`               AS `Genus`,  
       `g`.`GenusAuthority`      AS `GenusAuthority`,  
       `s`.`SpeciesName`         AS `SpeciesName`,  
       `s`.`SubspeciesName`      AS `SubSpeciesName`,  
       `s`.`IDLevel`             AS `SpeciesIDLevel`,  
       `s`.`SpeciesAuthority`    AS `SpeciesAuthority`,  
       `s`.`SubspeciesAuthority` AS `SubspeciesAuthority`,  
       `s`.`CurrentTaxonFlag`    AS `CurrentTaxonFlag`,  
       `s`.`ObsoleteTaxonFlag`   AS `ObsoleteTaxonFlag`,  
       `s`.`FieldFamily`         AS `FieldFamily`,  
       `s`.`Description`         AS `SpeciesDescription`,  
       `r`.`PublicationTitle`    AS `PublicationTitle`,  
       `r`.`FullReference`       AS `FullReference`,  
       `r`.`DateOfPublication`   AS `DateOfPublication`,  
       `r`.`Citation`            AS `Citation`  
from (((`family` `f` join `genus` `g`  
        on ((`f`.`FamilyID` = `g`.`FamilyID`))) join `species` `s`  
       on ((`g`.`GenusID` = `s`.`GenusID`))) left join `reference` `r`  
      on ((`s`.`ReferenceID` = `r`.`ReferenceID`)));  
  
create definer = azureroot@`%` view measurementssummaryview as  
SELECT cm.CoreMeasurementID                                        AS CoreMeasurementID,  
       p.PlotID                                                    AS PlotID,  
       c.CensusID                                                  AS CensusID,  
       q.QuadratID                                                 AS QuadratID,  
       sq.SubquadratID                                             AS SubquadratID,  
       s.SpeciesID                                                 AS SpeciesID,  
       t.TreeID                                                    AS TreeID,  
       st.StemID                                                   AS StemID,  
       cm.PersonnelID                                              AS PersonnelID,  
       p.PlotName                                                  AS PlotName,  
       q.QuadratName                                               AS QuadratName,  
       sq.SubquadratName                                           AS SubQuadratName,  
       s.SpeciesCode                                               AS SpeciesCode,  
       t.TreeTag                                                   AS TreeTag,  
       st.StemTag                                                  AS StemTag,  
       st.LocalX                                                   AS StemLocalX,  
       st.LocalY                                                   AS StemLocalY,  
       st.Unit                                                     AS StemUnits,  
       COALESCE(concat(pe.FirstName, ' ', pe.LastName), 'Unknown') AS PersonnelName,  
       cm.MeasurementDate                                          AS MeasurementDate,  
       cm.MeasuredDBH                                              AS MeasuredDBH,  
       cm.DBHUnit                                                  AS DBHUnits,  
       cm.MeasuredHOM                                              AS MeasuredHOM,  
       cm.HOMUnit                                                  AS HOMUnits,  
       cm.IsValidated                                              AS IsValidated,  
       cm.Description                                              AS Description,  
       (SELECT group_concat(ca.Code SEPARATOR '; ')  
        FROM cmattributes ca  
        WHERE ca.CoreMeasurementID = cm.CoreMeasurementID)         AS Attributes  
FROM coremeasurements cm  
         LEFT JOIN plots p ON cm.PlotID = p.PlotID  
         LEFT JOIN quadrats q ON cm.QuadratID = q.QuadratID  
         LEFT JOIN subquadrats sq ON cm.SubQuadratID = sq.SubquadratID  
         LEFT JOIN census c ON cm.CensusID = c.CensusID  
         LEFT JOIN trees t ON cm.TreeID = t.TreeID  
         LEFT JOIN stems st ON cm.StemID = st.StemID  
         LEFT JOIN species s ON t.SpeciesID = s.SpeciesID  
         LEFT JOIN genus g ON s.GenusID = g.GenusID  
         LEFT JOIN family f ON g.FamilyID = f.FamilyID  
         LEFT JOIN personnel pe ON cm.PersonnelID = pe.PersonnelID  
ORDER BY cm.CoreMeasurementID;  
  
  
create definer = azureroot@`%` view stemdimensionsview as  
select `s`.`StemID`           AS `StemID`,  
       `t`.`TreeID`           AS `TreeID`,  
       `sq`.`SubquadratID`    AS `SubquadratID`,  
       `q`.`QuadratID`        AS `QuadratID`,  
       `c`.`CensusID`         AS `CensusID`,  
       `p`.`PlotID`           AS `PlotID`,  
       `s`.`StemTag`          AS `StemTag`,  
       `t`.`TreeTag`          AS `TreeTag`,  
       `s`.`LocalX`           AS `StemLocalX`,  
       `s`.`LocalY`           AS `StemLocalY`,  
       `s`.`Unit`             AS `StemUnits`,  
       `sq`.`SubquadratName`  AS `SubquadratName`,  
       `sq`.`DimensionX`      AS `SubquadratDimensionX`,  
       `sq`.`DimensionY`      AS `SubquadratDimensionY`,  
       `sq`.`X`               AS `SubquadratX`,  
       `sq`.`Y`               AS `SubquadratY`,  
       `sq`.`Unit`            AS `SubquadratUnits`,  
       `sq`.`Ordering`        AS `SubquadratOrderPosition`,  
       `q`.`QuadratName`      AS `QuadratName`,  
       `q`.`DimensionX`       AS `QuadratDimensionX`,  
       `q`.`DimensionY`       AS `QuadratDimensionY`,  
       `q`.`Unit`             AS `QuadratUnits`,  
       `c`.`PlotCensusNumber` AS `PlotCensusNumber`,  
       `c`.`StartDate`        AS `StartDate`,  
       `c`.`EndDate`          AS `EndDate`,  
       `p`.`PlotName`         AS `PlotName`,  
       `p`.`LocationName`     AS `LocationName`,  
       `p`.`CountryName`      AS `CountryName`,  
       `p`.`DimensionX`       AS `PlotDimensionX`,  
       `p`.`DimensionY`       AS `PlotDimensionY`,  
       `p`.`GlobalX`          AS `PlotGlobalX`,  
       `p`.`GlobalY`          AS `PlotGlobalY`,  
       `p`.`GlobalZ`          AS `PlotGlobalZ`,  
       `p`.`Unit`             AS `PlotUnits`  
from (((((`stems` `s` join `trees` `t`  
          on ((`s`.`TreeID` = `t`.`TreeID`))) left join `subquadrats` `sq`  
         on ((`s`.`SubquadratID` = `sq`.`SubquadratID`))) join `quadrats` `q`  
        on ((`sq`.`QuadratID` = `q`.`QuadratID`))) join `plots` `p`  
       on ((`q`.`PlotID` = `p`.`PlotID`))) join `census` `c` on ((`c`.`CensusID` = `q`.`CensusID`)));  
  
-- comment on column stemdimensionsview.SubquadratX not supported: corner x index value (standardized)  
  
-- comment on column stemdimensionsview.SubquadratY not supported: corner y index value (standardized)  
  
-- comment on column stemdimensionsview.SubquadratOrderPosition not supported: SQindex should tell you in which order the subquads are surveyed. This will be useful later.  
  
create definer = azureroot@`%` view stemtaxonomiesview as  
select `s`.`StemID`               AS `StemID`,  
       `t`.`TreeID`               AS `TreeID`,  
       `f`.`FamilyID`             AS `FamilyID`,  
       `g`.`GenusID`              AS `GenusID`,  
       `sp`.`SpeciesID`           AS `SpeciesID`,  
       `s`.`StemTag`              AS `StemTag`,  
       `t`.`TreeTag`              AS `TreeTag`,  
       `sp`.`SpeciesCode`         AS `SpeciesCode`,  
       `f`.`Family`               AS `Family`,  
       `g`.`Genus`                AS `Genus`,  
       `sp`.`SpeciesName`         AS `SpeciesName`,  
       `sp`.`SubspeciesName`      AS `SubspeciesName`,  
       `sp`.`CurrentTaxonFlag`    AS `CurrentTaxonFlag`,  
       `sp`.`ObsoleteTaxonFlag`   AS `ObsoleteTaxonFlag`,  
       `g`.`GenusAuthority`       AS `GenusAuthority`,  
       `sp`.`SpeciesAuthority`    AS `SpeciesAuthority`,  
       `sp`.`SubspeciesAuthority` AS `SubspeciesAuthority`,  
       `sp`.`IDLevel`             AS `SpeciesIDLevel`,  
       `sp`.`FieldFamily`         AS `SpeciesFieldFamily`  
from ((((`stems` `s` join `trees` `t`  
         on ((`s`.`TreeID` = `t`.`TreeID`))) join `species` `sp`  
        on ((`t`.`SpeciesID` = `sp`.`SpeciesID`))) join `genus` `g`  
       on ((`sp`.`GenusID` = `g`.`GenusID`))) left join `family` `f`  
      on ((`g`.`FamilyID` = `f`.`FamilyID`)));  
  
create definer = azureroot@`%` view viewfulltable as  
select `cm`.`CoreMeasurementID`          AS `CoreMeasurementID`,  
       `cm`.`MeasurementDate`            AS `MeasurementDate`,  
       `cm`.`MeasuredDBH`                AS `MeasuredDBH`,  
       `cm`.`DBHUnit`                    AS `DBHUnit`,  
       `cm`.`MeasuredHOM`                AS `MeasuredHOM`,  
       `cm`.`HOMUnit`                    AS `HOMUnit`,  
       `cm`.`Description`                AS `CoreMeasurementDescription`,  
       `cm`.`IsValidated`                AS `IsValidated`,  
       `cm`.`UserDefinedFields`          AS `UserDefinedFields`,  
       `p`.`PlotID`                      AS `PlotID`,  
       `p`.`PlotName`                    AS `PlotName`,  
       `p`.`LocationName`                AS `LocationName`,  
       `p`.`CountryName`                 AS `CountryName`,  
       `p`.`DimensionX`                  AS `DimensionX`,  
       `p`.`DimensionY`                  AS `DimensionY`,  
       `p`.`Area`                        AS `PlotArea`,  
       `p`.`GlobalX`                     AS `GlobalX`,  
       `p`.`GlobalY`                     AS `GlobalY`,  
       `p`.`GlobalZ`                     AS `GlobalZ`,  
       `p`.`Unit`                        AS `PlotUnit`,  
       `p`.`PlotShape`                   AS `PlotShape`,  
       `p`.`PlotDescription`             AS `PlotDescription`,  
       `c`.`CensusID`                    AS `CensusID`,  
       `c`.`StartDate`                   AS `CensusStartDate`,  
       `c`.`EndDate`                     AS `CensusEndDate`,  
       `c`.`Description`                 AS `CensusDescription`,  
       `c`.`PlotCensusNumber`            AS `PlotCensusNumber`,  
       `q`.`QuadratID`                   AS `QuadratID`,  
       `q`.`QuadratName`                 AS `QuadratName`,  
       `q`.`DimensionX`                  AS `QuadratDimensionX`,  
       `q`.`DimensionY`                  AS `QuadratDimensionY`,  
       `q`.`Area`                        AS `QuadratArea`,  
       `q`.`QuadratShape`                AS `QuadratShape`,  
       `q`.`Unit`                        AS `QuadratUnit`,  
       `sq`.`SubquadratID`               AS `SubquadratID`,  
       `sq`.`SubquadratName`             AS `SubquadratName`,  
       `sq`.`DimensionX`                 AS `SubquadratDimensionX`,  
       `sq`.`DimensionY`                 AS `SubquadratDimensionY`,  
       `sq`.`X`                          AS `X`,  
       `sq`.`Y`                          AS `Y`,  
       `sq`.`Unit`                       AS `SubquadratUnit`,  
       `t`.`TreeID`                      AS `TreeID`,  
       `t`.`TreeTag`                     AS `TreeTag`,  
       `s`.`StemID`                      AS `StemID`,  
       `s`.`StemTag`                     AS `StemTag`,  
       `s`.`LocalX`                      AS `LocalX`,  
       `s`.`LocalY`                      AS `LocalY`,  
       `s`.`Unit`                        AS `StemUnit`,  
       `per`.`PersonnelID`               AS `PersonnelID`,  
       `per`.`FirstName`                 AS `FirstName`,  
       `per`.`LastName`                  AS `LastName`,  
       `per`.`Role`                      AS `PersonnelRoles`,  
       `quadp`.`QuadratPersonnelID`      AS `QuadratPersonnelID`,  
       `quadp`.`AssignedDate`            AS `QuadratPersonnelAssignedDate`,  
       `sp`.`SpeciesID`                  AS `SpeciesID`,  
       `sp`.`SpeciesCode`                AS `SpeciesCode`,  
       `sp`.`SpeciesName`                AS `SpeciesName`,  
       `sp`.`SubspeciesName`             AS `SubspeciesName`,  
       `sp`.`SubspeciesAuthority`        AS `SubspeciesAuthority`,  
       `sp`.`IDLevel`                    AS `IDLevel`,  
       `sl`.`SpeciesLimitID`             AS `SpeciesLimitID`,  
       `sl`.`LimitType`                  AS `LimitType`,  
       `sl`.`UpperBound`                 AS `UpperBound`,  
       `sl`.`LowerBound`                 AS `LowerBound`,  
       `sl`.`Unit`                       AS `SpeciesLimitUnit`,  
       `g`.`GenusID`                     AS `GenusID`,  
       `g`.`Genus`                       AS `Genus`,  
       `g`.`GenusAuthority`              AS `GenusAuthority`,  
       `fam`.`FamilyID`                  AS `FamilyID`,  
       `fam`.`Family`                    AS `Family`,  
       `ref`.`ReferenceID`               AS `ReferenceID`,  
       `ref`.`PublicationTitle`          AS `PublicationTitle`,  
       `ref`.`FullReference`             AS `FullReference`,  
       `ref`.`DateOfPublication`         AS `DateOfPublication`,  
       `ref`.`Citation`                  AS `Citation`,  
       `attr`.`Code`                     AS `AttributeCode`,  
       `attr`.`Description`              AS `AttributeDescription`,  
       `attr`.`Status`                   AS `AttributeStatus`,  
       `cmv`.`CMVErrorID`                AS `CMVErrorID`,  
       `cmv`.`ValidationErrorID`         AS `ValidationErrorID`,  
       `ve`.`ValidationErrorDescription` AS `ValidationErrorDescription`,  
       `vl`.`ValidationRunID`            AS `ValidationRunID`,  
       `vl`.`ProcedureName`              AS `ProcedureName`,  
       `vl`.`RunDateTime`                AS `RunDateTime`,  
       `vl`.`TargetRowID`                AS `TargetRowID`,  
       `vl`.`ValidationOutcome`          AS `ValidationOutcome`,  
       `vl`.`ErrorMessage`               AS `ErrorMessage`,  
       `vl`.`ValidationCriteria`         AS `ValidationCriteria`,  
       `vl`.`MeasuredValue`              AS `MeasuredValue`,  
       `vl`.`ExpectedValueRange`         AS `ExpectedValueRange`,  
       `vl`.`AdditionalDetails`          AS `AdditionalDetails`  
from ((((((((((((((((((`coremeasurements` `cm` left join `plots` `p`  
                       on ((`cm`.`PlotID` = `p`.`PlotID`))) left join `census` `c`  
                      on ((`cm`.`CensusID` = `c`.`CensusID`))) left join `quadrats` `q`  
                     on ((`cm`.`QuadratID` = `q`.`QuadratID`))) left join `subquadrats` `sq`  
                    on ((`cm`.`SubQuadratID` = `sq`.`SubquadratID`))) left join `trees` `t`  
                   on ((`cm`.`TreeID` = `t`.`TreeID`))) left join `stems` `s`  
                  on ((`cm`.`StemID` = `s`.`StemID`))) left join `species` `sp`  
                 on ((`t`.`SpeciesID` = `sp`.`SpeciesID`))) left join `specieslimits` `sl`  
                on ((`sp`.`SpeciesCode` = `sl`.`SpeciesCode`))) left join `genus` `g`  
               on ((`sp`.`GenusID` = `g`.`GenusID`))) left join `family` `fam`  
              on ((`g`.`FamilyID` = `fam`.`FamilyID`))) left join `reference` `ref`  
             on ((`fam`.`ReferenceID` = `ref`.`ReferenceID`))) left join `personnel` `per`  
            on ((`cm`.`PersonnelID` = `per`.`PersonnelID`))) left join `quadratpersonnel` `quadp`  
           on ((`q`.`QuadratID` = `quadp`.`QuadratID`))) left join `attributes` `attr`  
          on (`cm`.`CoreMeasurementID` in (select `cmattributes`.`CoreMeasurementID`  
                                           from `cmattributes`))) left join `cmattributes` `cma`  
         on ((`cm`.`CoreMeasurementID` = `cma`.`CoreMeasurementID`))) left join `cmverrors` `cmv`  
        on ((`cm`.`CoreMeasurementID` = `cmv`.`CoreMeasurementID`))) left join `validationerrors` `ve`  
       on ((`cmv`.`ValidationErrorID` = `ve`.`ValidationErrorID`))) left join `validationchangelog` `vl`  
      on ((`vl`.`TargetRowID` = `cm`.`CoreMeasurementID`)));  
  
-- comment on column viewfulltable.X not supported: corner x index value (standardized)  
  
-- comment on column viewfulltable.Y not supported: corner y index value (standardized)  
  
-- comment on column viewfulltable.PersonnelRoles not supported: semicolon-separated, like attributes in coremeasurements  
  
  
create  
    definer = azureroot@`%` procedure ValidateDBHGrowthExceedsMax(IN p_CensusID int, IN p_PlotID int)  
BEGIN  
    DECLARE vCoreMeasurementID INT;  
    DECLARE vPrevDBH DECIMAL(10, 2);  
    DECLARE vCurrDBH DECIMAL(10, 2);  
    DECLARE validationResult BIT;  
    DECLARE errorMessage VARCHAR(255);  
    DECLARE validationCriteria TEXT;  
    DECLARE measuredValue VARCHAR(255);  
    DECLARE expectedValueRange VARCHAR(255);  
    DECLARE additionalDetails TEXT;  
    DECLARE insertCount INT DEFAULT 0;  
    DECLARE expectedCount INT;  
    DECLARE successMessage VARCHAR(255);  
    DECLARE done INT DEFAULT FALSE;  
    DECLARE veID INT;  
    DECLARE cur CURSOR FOR  
        SELECT cm2.CoreMeasurementID, cm1.MeasuredDBH, cm2.MeasuredDBH  
        FROM coremeasurements cm1  
                 JOIN coremeasurements cm2  
                      ON cm1.StemID = cm2.StemID  
                          AND cm1.TreeID = cm2.TreeID  
                          AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1  
                 LEFT JOIN cmattributes cma  
                           ON cm1.CoreMeasurementID = cma.CoreMeasurementID  
                 LEFT JOIN attributes a  
                           ON cma.Code = a.Code  
        WHERE (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR a.Status IS NULL)  
          AND cm1.MeasuredDBH IS NOT NULL  
          AND cm2.MeasuredDBH IS NOT NULL  
          AND (cm2.MeasuredDBH - cm1.MeasuredDBH > 65)  
          AND cm1.IsValidated IS TRUE  
          AND cm2.IsValidated IS FALSE  
          AND (p_CensusID IS NULL OR cm2.CensusID = p_CensusID)  
          AND (p_PlotID IS NULL OR cm2.PlotID = p_PlotID);  
  
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;  
  
    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations  
    (  
        CoreMeasurementID INT  
    );  
  
    IF p_CensusID IS NULL THEN  
        SET p_CensusID = -1;  
    END IF;  
    IF p_PlotID IS NULL THEN  
        SET p_PlotID = -1;  
    END IF;  
  
    SELECT COUNT(*)  
    INTO expectedCount  
    FROM coremeasurements cm1  
             JOIN coremeasurements cm2  
                  ON cm1.StemID = cm2.StemID  
                      AND cm1.TreeID = cm2.TreeID  
                      AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1  
             LEFT JOIN cmattributes cma  
                       ON cm1.CoreMeasurementID = cma.CoreMeasurementID  
             LEFT JOIN attributes a  
                       ON cma.Code = a.Code  
    WHERE (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR a.Status IS NULL)  
      AND cm1.MeasuredDBH IS NOT NULL  
      AND cm2.MeasuredDBH IS NOT NULL  
      AND (cm2.MeasuredDBH - cm1.MeasuredDBH > 65)  
      AND cm1.IsValidated IS TRUE  
      AND cm2.IsValidated IS FALSE  
      AND (p_CensusID = -1 OR cm2.CensusID = p_CensusID)  
      AND (p_PlotID = -1 OR cm2.PlotID = p_PlotID);  
  
    -- Fetch the ValidationErrorID for this stored procedure  
    SELECT ValidationID  
    INTO veID  
    FROM catalog.validationprocedures  
    WHERE ProcedureName = 'ValidateDBHGrowthExceedsMax';  
  
    OPEN cur;  
    loop1:  
    LOOP  
        FETCH cur INTO vCoreMeasurementID, vPrevDBH, vCurrDBH;  
        IF done THEN  
            LEAVE loop1;  
        END IF;  
  
        SET validationCriteria = 'Annual DBH Growth';  
        SET measuredValue = CONCAT('Previous DBH: ', vPrevDBH, ', Current DBH: ', vCurrDBH);  
        SET expectedValueRange = 'Growth <= 65';  
        SET additionalDetails = 'Checked for excessive DBH growth over a year';  
  
        IF vCurrDBH - vPrevDBH > 65 THEN  
            SET validationResult = 0;  
            SET errorMessage = 'Growth exceeds max threshold.';  
            IF NOT EXISTS (SELECT 1  
                           FROM cmverrors  
                           WHERE CoreMeasurementID = vCoreMeasurementID  
                             AND ValidationErrorID = veID) THEN  
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)  
                VALUES (vCoreMeasurementID, veID);  
            END IF;  
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);  
            SET insertCount = insertCount + 1;  
        ELSE  
            SET validationResult = 1;  
            SET errorMessage = NULL;  
        END IF;  
  
        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,  
                                         ValidationOutcome, ErrorMessage,  
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,  
                                         AdditionalDetails)  
        VALUES ('ValidateDBHGrowthExceedsMax', NOW(), vCoreMeasurementID,  
                IF(validationResult, 'Passed', 'Failed'), errorMessage,  
                validationCriteria, measuredValue, expectedValueRange,  
                additionalDetails);  
    END LOOP;  
    CLOSE cur;  
  
    SET successMessage =  
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);  
    SELECT expectedCount  AS TotalRows,  
           insertCount    AS FailedRows,  
           successMessage AS Message;  
  
    SELECT CoreMeasurementID FROM FailedValidations;  
  
    DROP TEMPORARY TABLE IF EXISTS FailedValidations;  
END;  
  
create  
    definer = azureroot@`%` procedure ValidateDBHShrinkageExceedsMax(IN p_CensusID int, IN p_PlotID int)  
BEGIN  
    DECLARE vCoreMeasurementID INT;  
    DECLARE vPrevDBH DECIMAL(10, 2);  
    DECLARE vCurrDBH DECIMAL(10, 2);  
    DECLARE validationResult BIT;  
    DECLARE errorMessage VARCHAR(255);  
    DECLARE validationCriteria TEXT;  
    DECLARE measuredValue VARCHAR(255);  
    DECLARE expectedValueRange VARCHAR(255);  
    DECLARE additionalDetails TEXT;  
    DECLARE insertCount INT DEFAULT 0;  
    DECLARE expectedCount INT;  
    DECLARE successMessage VARCHAR(255);  
    DECLARE veID INT;  
    DECLARE done INT DEFAULT FALSE;  
    DECLARE cur CURSOR FOR  
        SELECT cm2.CoreMeasurementID, cm1.MeasuredDBH, cm2.MeasuredDBH  
        FROM coremeasurements cm1  
                 JOIN coremeasurements cm2  
                      ON cm1.StemID = cm2.StemID  
                          AND cm1.TreeID = cm2.TreeID  
                          AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1  
                 LEFT JOIN cmattributes cma  
                           ON cm1.CoreMeasurementID = cma.CoreMeasurementID  
                 LEFT JOIN attributes a  
                           ON cma.Code = a.Code  
        WHERE (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR a.Status IS NULL)  
          AND cm1.MeasuredDBH IS NOT NULL  
          AND cm2.MeasuredDBH IS NOT NULL  
          AND cm1.IsValidated IS TRUE  
          AND cm2.IsValidated IS FALSE  
          AND (p_CensusID IS NULL OR cm2.CensusID = p_CensusID)  
          AND (p_PlotID IS NULL OR cm2.PlotID = p_PlotID);  
  
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;  
  
    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations  
    (  
        CoreMeasurementID INT  
    );  
  
    IF p_CensusID IS NULL THEN  
        SET p_CensusID = -1;  
    END IF;  
    IF p_PlotID IS NULL THEN  
        SET p_PlotID = -1;  
    END IF;  
  
    SELECT COUNT(*)  
    INTO expectedCount  
    FROM coremeasurements cm1  
             JOIN coremeasurements cm2  
                  ON cm1.StemID = cm2.StemID  
                      AND cm1.TreeID = cm2.TreeID  
                      AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1  
             LEFT JOIN cmattributes cma  
                       ON cm1.CoreMeasurementID = cma.CoreMeasurementID  
             LEFT JOIN attributes a  
                       ON cma.Code = a.Code  
    WHERE (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR a.Status IS NULL)  
      AND cm1.MeasuredDBH IS NOT NULL  
      AND cm2.MeasuredDBH IS NOT NULL  
      AND cm1.IsValidated IS TRUE  
      AND cm2.IsValidated IS FALSE  
      AND (p_CensusID IS NULL OR cm2.CensusID = p_CensusID)  
      AND (p_PlotID IS NULL OR cm2.PlotID = p_PlotID);  
  
    SELECT ValidationID  
    INTO veID  
    FROM catalog.validationprocedures  
    WHERE ProcedureName = 'ValidateDBHShrinkageExceedsMax';  
  
    OPEN cur;  
    loop1:  
    LOOP  
        FETCH cur INTO vCoreMeasurementID, vPrevDBH, vCurrDBH;  
        IF done THEN  
            LEAVE loop1;  
        END IF;  
  
        SET validationCriteria = 'Annual DBH Shrinkage';  
        SET measuredValue = CONCAT('Previous DBH: ', vPrevDBH, ', Current DBH: ', vCurrDBH);  
        SET expectedValueRange = 'Shrinkage < 5% of previous DBH';  
        SET additionalDetails = 'Checked for excessive DBH shrinkage over a year';  
  
        IF vCurrDBH < vPrevDBH * 0.95 THEN  
            SET validationResult = 0;  
            SET errorMessage = 'Shrinkage exceeds maximum allowed threshold.';  
            -- Check if the error record already exists before inserting  
            IF NOT EXISTS (SELECT 1  
                           FROM cmverrors  
                           WHERE CoreMeasurementID = vCoreMeasurementID  
                             AND ValidationErrorID = veID) THEN  
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)  
                VALUES (vCoreMeasurementID, veID);  
            END IF;  
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);  
            SET insertCount = insertCount + 1;  
        ELSE  
            SET validationResult = 1;  
            SET errorMessage = NULL;  
        END IF;  
  
        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,  
                                         ValidationOutcome, ErrorMessage,  
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,  
                                         AdditionalDetails)  
        VALUES ('ValidateDBHShrinkageExceedsMax', NOW(), vCoreMeasurementID,  
                IF(validationResult, 'Passed', 'Failed'), errorMessage,  
                validationCriteria, measuredValue, expectedValueRange,  
                additionalDetails);  
    END LOOP;  
    CLOSE cur;  
  
    SET successMessage =  
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);  
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;  
  
    SELECT CoreMeasurementID FROM FailedValidations;  
  
    DROP TEMPORARY TABLE IF EXISTS FailedValidations;  
END;  
  
create  
    definer = azureroot@`%` procedure ValidateFindAllInvalidSpeciesCodes(IN p_CensusID int, IN p_PlotID int)  
BEGIN  
    DECLARE vCoreMeasurementID INT;  
    DECLARE vSpeciesID INT;  
    DECLARE validationResult BIT;  
    DECLARE errorMessage VARCHAR(255);  
    DECLARE validationCriteria TEXT;  
    DECLARE measuredValue VARCHAR(255);  
    DECLARE expectedValueRange VARCHAR(255);  
    DECLARE additionalDetails TEXT;  
    DECLARE insertCount INT DEFAULT 0;  
    DECLARE expectedCount INT;  
    DECLARE successMessage VARCHAR(255);  
    DECLARE veID INT;  
    DECLARE done INT DEFAULT FALSE;  
    DECLARE cur CURSOR FOR  
        SELECT cm.CoreMeasurementID, sp.SpeciesID  
        FROM stems s  
                 JOIN trees t ON s.TreeID = t.TreeID  
                 LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID  
                 JOIN coremeasurements cm ON s.StemID = cm.StemID  
        WHERE sp.SpeciesID IS NULL  
          AND cm.IsValidated IS FALSE  
          AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
          AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)  
        GROUP BY cm.CoreMeasurementID;  
  
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;  
  
    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations  
    (  
        CoreMeasurementID INT  
    );  
  
    IF p_CensusID IS NULL THEN  
        SET p_CensusID = -1;  
    END IF;  
    IF p_PlotID IS NULL THEN  
        SET p_PlotID = -1;  
    END IF;  
  
    SELECT COUNT(*)  
    INTO expectedCount  
    FROM stems s  
             JOIN trees t ON s.TreeID = t.TreeID  
             LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID  
             JOIN coremeasurements cm ON s.StemID = cm.StemID  
    WHERE sp.SpeciesID IS NULL  
      AND cm.IsValidated IS FALSE  
      AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
      AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)  
    GROUP BY cm.CoreMeasurementID;  
  
    SELECT ValidationID  
    INTO veID  
    FROM catalog.validationprocedures  
    WHERE ProcedureName = 'ValidateFindAllInvalidSpeciesCodes';  
  
    OPEN cur;  
    loop1:  
    LOOP  
        FETCH cur INTO vCoreMeasurementID, vSpeciesID;  
        IF done THEN  
            LEAVE loop1;  
        END IF;  
  
        SET validationCriteria = 'Species Code Validation';  
        SET measuredValue = CONCAT('Species ID: ', IFNULL(vSpeciesID, 'NULL'));  
        SET expectedValueRange = 'Non-null and valid Species ID';  
        SET additionalDetails = 'Checking for the existence of valid species codes for each measurement.';  
  
        IF vSpeciesID IS NULL THEN  
            SET validationResult = 0;  
            SET errorMessage = 'Invalid species code detected.';  
            -- Check if the error record already exists before inserting  
            IF NOT EXISTS (SELECT 1  
                           FROM cmverrors  
                           WHERE CoreMeasurementID = vCoreMeasurementID  
                             AND ValidationErrorID = veID) THEN  
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)  
                VALUES (vCoreMeasurementID, veID);  
            END IF;  
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);  
            SET insertCount = insertCount + 1;  
        ELSE  
            SET validationResult = 1;  
            SET errorMessage = NULL;  
        END IF;  
  
        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,  
                                         ValidationOutcome, ErrorMessage,  
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,  
                                         AdditionalDetails)  
        VALUES ('ValidateFindAllInvalidSpeciesCodes', NOW(), vCoreMeasurementID,  
                IF(validationResult, 'Passed', 'Failed'), errorMessage,  
                validationCriteria, measuredValue, expectedValueRange,  
                additionalDetails);  
    END LOOP;  
    CLOSE cur;  
  
    SET successMessage =  
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);  
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;  
  
    SELECT CoreMeasurementID FROM FailedValidations;  
  
    DROP TEMPORARY TABLE IF EXISTS FailedValidations;  
END;  
  
create  
    definer = azureroot@`%` procedure ValidateFindDuplicateStemTreeTagCombinationsPerCensus(IN p_CensusID int, IN p_PlotID int)  
BEGIN  
    DECLARE vCoreMeasurementID INT;  
    DECLARE validationResult BIT;  
    DECLARE errorMessage VARCHAR(255);  
    DECLARE validationCriteria TEXT;  
    DECLARE measuredValue VARCHAR(255);  
    DECLARE expectedValueRange VARCHAR(255);  
    DECLARE additionalDetails TEXT;  
    DECLARE insertCount INT DEFAULT 0;  
    DECLARE expectedCount INT;  
    DECLARE successMessage VARCHAR(255);  
    DECLARE veID INT;  
    DECLARE done INT DEFAULT FALSE;  
    DECLARE cur CURSOR FOR  
        SELECT SubQuery.CoreMeasurementID  
        FROM (SELECT cm.CoreMeasurementID  
              FROM coremeasurements cm  
                       INNER JOIN stems s ON cm.StemID = s.StemID  
                       INNER JOIN trees t ON cm.TreeID = t.TreeID  
              WHERE (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
                AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)  
                AND cm.IsValidated = FALSE  
              GROUP BY cm.CensusID, s.StemTag, t.TreeTag, cm.CoreMeasurementID  
              HAVING COUNT(*) > 1) AS SubQuery;  
  
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;  
  
    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations  
    (  
        CoreMeasurementID INT  
    );  
  
    IF p_CensusID IS NULL THEN  
        SET p_CensusID = -1;  
    END IF;  
    IF p_PlotID IS NULL THEN  
        SET p_PlotID = -1;  
    END IF;  
  
    SELECT COUNT(*)  
    INTO expectedCount  
    FROM (SELECT cm.CoreMeasurementID  
          FROM coremeasurements cm  
                   INNER JOIN stems s ON cm.StemID = s.StemID  
                   INNER JOIN trees t ON cm.TreeID = t.TreeID  
          WHERE (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
            AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)  
            AND cm.IsValidated = FALSE  
          GROUP BY cm.CensusID, s.StemTag, t.TreeTag, cm.CoreMeasurementID  
          HAVING COUNT(*) > 1) AS DuplicationCheck;  
  
    SELECT ValidationID  
    INTO veID  
    FROM catalog.validationprocedures  
    WHERE ProcedureName = 'ValidateFindDuplicateStemTreeTagCombinationsPerCensus';  
  
  
    OPEN cur;  
    loop1:  
    LOOP  
        FETCH cur INTO vCoreMeasurementID;  
        IF done THEN  
            LEAVE loop1;  
        END IF;  
  
        SET validationCriteria = 'Duplicate Stem-Tree Tag Combinations per Census';  
        SET measuredValue = 'N/A';  
        SET expectedValueRange = 'Unique Stem-Tree Tag Combinations';  
        SET additionalDetails = 'Checking for duplicate stem and tree tag combinations in each census.';  
  
        IF EXISTS (SELECT 1  
                   FROM coremeasurements cm  
                            JOIN stems s ON cm.StemID = s.StemID  
                            JOIN trees t ON cm.TreeID = t.TreeID  
                   WHERE cm.CoreMeasurementID = vCoreMeasurementID  
                   GROUP BY cm.CensusID, s.StemTag, t.TreeTag  
                   HAVING COUNT(cm.CoreMeasurementID) > 1) THEN  
            SET validationResult = 0;  
            SET errorMessage = 'Duplicate stem and tree tag combination detected.';  
            -- Check if the error record already exists before inserting  
            IF NOT EXISTS (SELECT 1  
                           FROM cmverrors  
                           WHERE CoreMeasurementID = vCoreMeasurementID  
                             AND ValidationErrorID = veID) THEN  
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)  
                VALUES (vCoreMeasurementID, veID);  
            END IF;  
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);  
            SET insertCount = insertCount + 1;  
        ELSE  
            SET validationResult = 1;  
            SET errorMessage = NULL;  
        END IF;  
  
        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,  
                                         ValidationOutcome, ErrorMessage,  
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,  
                                         AdditionalDetails)  
        VALUES ('ValidateFindDuplicateStemTreeTagCombinationsPerCensus', NOW(), vCoreMeasurementID,  
                IF(validationResult, 'Passed', 'Failed'), errorMessage,  
                validationCriteria, measuredValue, expectedValueRange,  
                additionalDetails);  
    END LOOP;  
    CLOSE cur;  
  
    SET successMessage =  
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);  
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;  
  
    SELECT CoreMeasurementID FROM FailedValidations;  
  
    DROP TEMPORARY TABLE IF EXISTS FailedValidations;  
END;  
  
create  
    definer = azureroot@`%` procedure ValidateFindDuplicatedQuadratsByName(IN p_CensusID int, IN p_PlotID int)  
BEGIN  
    DECLARE vCoreMeasurementID INT;  
    DECLARE validationResult BIT;  
    DECLARE errorMessage VARCHAR(255);  
    DECLARE validationCriteria TEXT;  
    DECLARE measuredValue VARCHAR(255);  
    DECLARE expectedValueRange VARCHAR(255);  
    DECLARE additionalDetails TEXT;  
    DECLARE insertCount INT DEFAULT 0;  
    DECLARE expectedCount INT;  
    DECLARE successMessage VARCHAR(255);  
    DECLARE veID INT;  
    DECLARE done INT DEFAULT FALSE;  
    DECLARE cur CURSOR FOR  
        SELECT cm.CoreMeasurementID  
        FROM quadrats q  
                 JOIN coremeasurements cm ON q.QuadratID = cm.QuadratID  
        WHERE cm.IsValidated IS FALSE  
          AND (q.PlotID, q.QuadratName) IN (SELECT PlotID, QuadratName  
                                            FROM quadrats  
                                            GROUP BY PlotID, QuadratName  
                                            HAVING COUNT(*) > 1)  
          AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
          AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)  
        GROUP BY cm.CoreMeasurementID;  
  
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;  
  
    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations  
    (  
        CoreMeasurementID INT  
    );  
  
    IF p_CensusID IS NULL THEN  
        SET p_CensusID = -1;  
    END IF;  
    IF p_PlotID IS NULL THEN  
        SET p_PlotID = -1;  
    END IF;  
  
    SELECT COUNT(*)  
    INTO expectedCount  
    FROM quadrats q  
             JOIN coremeasurements cm ON q.QuadratID = cm.QuadratID  
    WHERE cm.IsValidated IS FALSE  
      AND (q.PlotID, q.QuadratName) IN (SELECT PlotID, QuadratName  
                                        FROM quadrats  
                                        GROUP BY PlotID, QuadratName  
                                        HAVING COUNT(*) > 1)  
      AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
      AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)  
    GROUP BY cm.CoreMeasurementID;  
  
    SELECT ValidationID  
    INTO veID  
    FROM catalog.validationprocedures  
    WHERE ProcedureName = 'ValidateFindDuplicatedQuadratsByName';  
  
    OPEN cur;  
    loop1:  
    LOOP  
        FETCH cur INTO vCoreMeasurementID;  
        IF done THEN  
            LEAVE loop1;  
        END IF;  
  
        SET validationCriteria = 'Quadrat Name Duplication';  
        SET measuredValue = 'N/A';  
        SET expectedValueRange = 'Unique Quadrat Names per Plot';  
        SET additionalDetails = 'Checking for duplicated quadrat names within the same plot.';  
  
        IF EXISTS (SELECT 1  
                   FROM quadrats q  
                   WHERE q.QuadratID = vCoreMeasurementID  
                     AND (q.PlotID, q.QuadratName) IN (SELECT PlotID, QuadratName  
                                                       FROM quadrats  
                                                       GROUP BY PlotID, QuadratName  
                                                       HAVING COUNT(*) > 1)) THEN  
            SET validationResult = 0;  
            SET errorMessage = 'Duplicated quadrat name detected.';  
            -- Check if the error record already exists before inserting  
            IF NOT EXISTS (SELECT 1  
                           FROM cmverrors  
                           WHERE CoreMeasurementID = vCoreMeasurementID  
                             AND ValidationErrorID = veID) THEN  
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)  
                VALUES (vCoreMeasurementID, veID);  
            END IF;  
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);  
            SET insertCount = insertCount + 1;  
        ELSE  
            SET validationResult = 1;  
            SET errorMessage = NULL;  
        END IF;  
  
        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,  
                                         ValidationOutcome, ErrorMessage,  
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,  
                                         AdditionalDetails)  
        VALUES ('ValidateFindDuplicatedQuadratsByName', NOW(), vCoreMeasurementID,  
                IF(validationResult, 'Passed', 'Failed'), errorMessage,  
                validationCriteria, measuredValue, expectedValueRange,  
                additionalDetails);  
    END LOOP;  
    CLOSE cur;  
  
    SET successMessage =  
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);  
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;  
  
    SELECT CoreMeasurementID FROM FailedValidations;  
  
    DROP TEMPORARY TABLE IF EXISTS FailedValidations;  
END;  
  
create  
    definer = azureroot@`%` procedure ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat(IN p_CensusID int, IN p_PlotID int)  
BEGIN  
    DECLARE vCoreMeasurementID INT;  
    DECLARE validationResult BIT;  
    DECLARE errorMessage VARCHAR(255);  
    DECLARE validationCriteria TEXT;  
    DECLARE measuredValue VARCHAR(255);  
    DECLARE expectedValueRange VARCHAR(255);  
    DECLARE additionalDetails TEXT;  
    DECLARE insertCount INT DEFAULT 0;  
    DECLARE expectedCount INT;  
    DECLARE successMessage VARCHAR(255);  
    DECLARE veID INT;  
    DECLARE done INT DEFAULT FALSE;  
    DECLARE cur CURSOR FOR  
        SELECT MIN(cm.CoreMeasurementID) AS CoreMeasurementID  
        FROM coremeasurements cm  
                 JOIN census c ON cm.CensusID = c.CensusID  
        WHERE (cm.MeasurementDate < c.StartDate OR cm.MeasurementDate > c.EndDate)  
          AND cm.MeasurementDate IS NOT NULL  
          AND cm.IsValidated IS FALSE  
          AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
          AND (p_PlotID IS NULL OR c.PlotID = p_PlotID)  
        GROUP BY cm.QuadratID, c.CensusID, c.StartDate, c.EndDate;  
  
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;  
  
    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations  
    (  
        CoreMeasurementID INT  
    );  
  
    IF p_CensusID IS NULL THEN  
        SET p_CensusID = -1;  
    END IF;  
    IF p_PlotID IS NULL THEN  
        SET p_PlotID = -1;  
    END IF;  
  
    SELECT COUNT(*)  
    INTO expectedCount  
    FROM coremeasurements cm  
             JOIN census c ON cm.CensusID = c.CensusID  
    WHERE (cm.MeasurementDate < c.StartDate OR cm.MeasurementDate > c.EndDate)  
      AND cm.MeasurementDate IS NOT NULL  
      AND cm.IsValidated IS FALSE  
      AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
      AND (p_PlotID IS NULL OR c.PlotID = p_PlotID);  
  
    SELECT ValidationID  
    INTO veID  
    FROM catalog.validationprocedures  
    WHERE ProcedureName = 'ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat';  
  
  
    OPEN cur;  
    loop1:  
    LOOP  
        FETCH cur INTO vCoreMeasurementID;  
        IF done THEN  
            LEAVE loop1;  
        END IF;  
  
        SET validationCriteria = 'Measurement Date vs Census Date Bounds';  
        SET measuredValue = 'Measurement Date';  
        SET expectedValueRange = 'Within Census Start and End Dates';  
        SET additionalDetails =  
                'Checking if measurement dates fall within the start and end dates of their respective censuses.';  
  
        IF EXISTS (SELECT 1  
                   FROM coremeasurements cm  
                            JOIN census c ON cm.CensusID = c.CensusID  
                   WHERE cm.CoreMeasurementID = vCoreMeasurementID  
                     AND (cm.MeasurementDate < c.StartDate OR cm.MeasurementDate > c.EndDate)) THEN  
            SET validationResult = 0;  
            SET errorMessage = 'Measurement outside census date bounds.';  
            -- Check if the error record already exists before inserting  
            IF NOT EXISTS (SELECT 1  
                           FROM cmverrors  
                           WHERE CoreMeasurementID = vCoreMeasurementID  
                             AND ValidationErrorID = veID) THEN  
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)  
                VALUES (vCoreMeasurementID, veID);  
            END IF;  
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);  
            SET insertCount = insertCount + 1;  
        ELSE  
            SET validationResult = 1;  
            SET errorMessage = NULL;  
        END IF;  
  
        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,  
                                         ValidationOutcome, ErrorMessage,  
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,  
                                         AdditionalDetails)  
        VALUES ('ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat', NOW(), vCoreMeasurementID,  
                IF(validationResult, 'Passed', 'Failed'), errorMessage,  
                validationCriteria, measuredValue, expectedValueRange,  
                additionalDetails);  
    END LOOP;  
    CLOSE cur;  
  
    SET successMessage =  
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);  
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;  
  
    SELECT CoreMeasurementID FROM FailedValidations;  
  
    DROP TEMPORARY TABLE IF EXISTS FailedValidations;  
END;  
  
create  
    definer = azureroot@`%` procedure ValidateFindStemsInTreeWithDifferentSpecies(IN p_CensusID int, IN p_PlotID int)  
BEGIN  
    DECLARE vCoreMeasurementID INT;  
    DECLARE validationResult BIT;  
    DECLARE errorMessage VARCHAR(255);  
    DECLARE validationCriteria TEXT;  
    DECLARE measuredValue VARCHAR(255);  
    DECLARE expectedValueRange VARCHAR(255);  
    DECLARE additionalDetails TEXT;  
    DECLARE insertCount INT DEFAULT 0;  
    DECLARE expectedCount INT;  
    DECLARE successMessage VARCHAR(255);  
    DECLARE veID INT;  
    DECLARE done INT DEFAULT FALSE;  
  
    DECLARE cur CURSOR FOR  
        SELECT cm.CoreMeasurementID  
        FROM coremeasurements cm  
                 JOIN stems s ON cm.StemID = s.StemID  
                 JOIN trees t ON s.TreeID = t.TreeID  
        WHERE cm.IsValidated = FALSE  
          AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
          AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)  
        GROUP BY t.TreeID, cm.CoreMeasurementID  
        HAVING COUNT(DISTINCT t.SpeciesID) > 1;  
  
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;  
  
    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations  
    (  
        CoreMeasurementID INT  
    );  
  
    IF p_CensusID IS NULL THEN  
        SET p_CensusID = -1;  
    END IF;  
    IF p_PlotID IS NULL THEN  
        SET p_PlotID = -1;  
    END IF;  
  
    SELECT COUNT(*)  
    INTO expectedCount  
    FROM coremeasurements cm  
             JOIN stems s ON cm.StemID = s.StemID  
             JOIN trees t ON s.TreeID = t.TreeID  
    WHERE cm.IsValidated = FALSE  
      AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
      AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)  
    GROUP BY t.TreeID  
    HAVING COUNT(DISTINCT t.SpeciesID) > 1;  
  
    SELECT ValidationID  
    INTO veID  
    FROM catalog.validationprocedures  
    WHERE ProcedureName = 'ValidateFindStemsInTreeWithDifferentSpecies';  
  
  
    OPEN cur;  
    loop1:  
    LOOP  
        FETCH cur INTO vCoreMeasurementID;  
        IF done THEN  
            LEAVE loop1;  
        END IF;  
  
        SET validationCriteria = 'Each tree should have a consistent species across all its stems.';  
        SET measuredValue = 'Species consistency across tree stems';  
        SET expectedValueRange = 'One species per tree';  
        SET additionalDetails = 'Checking if stems belonging to the same tree have different species IDs.';  
  
        IF EXISTS (SELECT 1  
                   FROM stems s  
                            JOIN trees t ON s.TreeID = t.TreeID  
                   WHERE t.TreeID IN (SELECT TreeID  
                                      FROM stems  
                                      WHERE StemID IN  
                                            (SELECT StemID  
                                             FROM coremeasurements  
                                             WHERE CoreMeasurementID = vCoreMeasurementID))  
                   GROUP BY t.TreeID  
                   HAVING COUNT(DISTINCT t.SpeciesID) > 1) THEN  
            SET validationResult = 0;  
            SET errorMessage = 'Stems in the same tree have different species.';  
  
            -- Check if the error record already exists before inserting  
            IF NOT EXISTS (SELECT 1  
                           FROM cmverrors  
                           WHERE CoreMeasurementID = vCoreMeasurementID  
                             AND ValidationErrorID = veID) THEN  
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)  
                VALUES (vCoreMeasurementID, veID);  
            END IF;  
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);  
            SET insertCount = insertCount + 1;  
        ELSE  
            SET validationResult = 1;  
            SET errorMessage = NULL;  
        END IF;  
  
        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,  
                                         ValidationOutcome, ErrorMessage,  
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,  
                                         AdditionalDetails)  
        VALUES ('ValidateFindStemsInTreeWithDifferentSpecies', NOW(), vCoreMeasurementID,  
                IF(validationResult, 'Passed', 'Failed'), errorMessage,  
                validationCriteria, measuredValue, expectedValueRange,  
                additionalDetails);  
    END LOOP;  
    CLOSE cur;  
  
    SET successMessage = CONCAT('Validation completed. Total rows: ', expectedCount, ', Failed rows: ', insertCount);  
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;  
  
    SELECT CoreMeasurementID FROM FailedValidations;  
  
    DROP TEMPORARY TABLE IF EXISTS FailedValidations;  
END;  
  
create  
    definer = azureroot@`%` procedure ValidateFindStemsOutsidePlots(IN p_CensusID int, IN p_PlotID int)  
BEGIN  
    DECLARE vCoreMeasurementID INT;  
    DECLARE validationResult BIT;  
    DECLARE errorMessage VARCHAR(255);  
    DECLARE validationCriteria TEXT;  
    DECLARE measuredValue VARCHAR(255);  
    DECLARE expectedValueRange VARCHAR(255);  
    DECLARE additionalDetails TEXT;  
    DECLARE insertCount INT DEFAULT 0;  
    DECLARE expectedCount INT;  
    DECLARE successMessage VARCHAR(255);  
    DECLARE veID INT;  
    DECLARE done INT DEFAULT FALSE;  
  
    DECLARE cur CURSOR FOR  
        SELECT cm.CoreMeasurementID  
        FROM stems s  
                 INNER JOIN subquadrats s2 on s.SubQuadratID = s2.SubquadratID  
                 INNER JOIN quadrats q ON s2.QuadratID = q.QuadratID  
                 INNER JOIN plots p ON q.PlotID = p.PlotID  
                 INNER JOIN coremeasurements cm ON s.StemID = cm.StemID  
        WHERE (s.LocalX > p.DimensionX OR s.LocalX > p.DimensionY)  
          AND s.LocalX IS NOT NULL  
          AND s.LocalY IS NOT NULL  
          AND (p.DimensionX > 0 AND p.DimensionY > 0)  
          AND cm.IsValidated IS FALSE  
          AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
          AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID)  
        GROUP BY cm.CoreMeasurementID;  
  
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;  
  
    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations  
    (  
        CoreMeasurementID INT  
    );  
  
    IF p_CensusID IS NULL THEN  
        SET p_CensusID = -1;  
    END IF;  
    IF p_PlotID IS NULL THEN  
        SET p_PlotID = -1;  
    END IF;  
  
    SELECT COUNT(*)  
    INTO expectedCount  
    FROM stems s  
             INNER JOIN subquadrats s2 on s.SubQuadratID = s2.SubquadratID  
             INNER JOIN quadrats q ON s2.QuadratID = q.QuadratID  
             INNER JOIN plots p ON q.PlotID = p.PlotID  
             INNER JOIN coremeasurements cm ON s.StemID = cm.StemID  
    WHERE (s.LocalX > p.DimensionX OR s.LocalX > p.DimensionY)  
      AND s.LocalX IS NOT NULL  
      AND s.LocalY IS NOT NULL  
      AND (p.DimensionX > 0 AND p.DimensionY > 0)  
      AND cm.IsValidated IS FALSE  
      AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
      AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);  
  
    SELECT ValidationID  
    INTO veID  
    FROM catalog.validationprocedures  
    WHERE ProcedureName = 'ValidateFindStemsOutsidePlots';  
  
  
    OPEN cur;  
    loop1:  
    LOOP  
        FETCH cur INTO vCoreMeasurementID;  
        IF done THEN  
            LEAVE loop1;  
        END IF;  
  
        SET validationCriteria = 'Stem Placement within Plot Boundaries';  
        SET measuredValue = 'Stem Plot Coordinates';  
        SET expectedValueRange = 'Within Plot Dimensions';  
        SET additionalDetails = 'Validating whether stems are located within the specified plot dimensions.';  
  
        IF EXISTS (SELECT 1  
                   FROM stems s  
                            INNER JOIN subquadrats sq ON s.SubQuadratID = sq.SubquadratID  
                            INNER JOIN quadrats q ON sq.QuadratID = q.QuadratID  
                            INNER JOIN plots p ON q.PlotID = p.PlotID  
                   WHERE s.StemID IN  
                         (SELECT StemID  
                          FROM coremeasurements  
                          WHERE CoreMeasurementID = vCoreMeasurementID)  
                     AND (s.LocalX > p.DimensionX OR s.LocalY > p.DimensionY)) THEN  
            SET validationResult = 0;  
            SET errorMessage = 'Stem is outside plot dimensions.';  
            -- Check if the error record already exists before inserting  
            IF NOT EXISTS (SELECT 1  
                           FROM cmverrors  
                           WHERE CoreMeasurementID = vCoreMeasurementID  
                             AND ValidationErrorID = veID) THEN  
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)  
                VALUES (vCoreMeasurementID, veID);  
            END IF;  
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);  
            SET insertCount = insertCount + 1;  
        ELSE  
            SET validationResult = 1;  
            SET errorMessage = NULL;  
        END IF;  
  
        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,  
                                         ValidationOutcome, ErrorMessage,  
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,  
                                         AdditionalDetails)  
        VALUES ('ValidateFindStemsOutsidePlots', NOW(), vCoreMeasurementID,  
                IF(validationResult, 'Passed', 'Failed'), errorMessage,  
                validationCriteria, measuredValue, expectedValueRange,  
                additionalDetails);  
    END LOOP;  
    CLOSE cur;  
  
    SET successMessage = CONCAT('Validation completed. Total rows: ', expectedCount, ', Failed rows: ', insertCount);  
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;  
  
    SELECT CoreMeasurementID FROM FailedValidations;  
  
    DROP TEMPORARY TABLE IF EXISTS FailedValidations;  
END;  
  
create  
    definer = azureroot@`%` procedure ValidateFindTreeStemsInDifferentQuadrats(IN p_CensusID int, IN p_PlotID int)  
BEGIN  
    DECLARE vCoreMeasurementID INT;  
    DECLARE validationResult BIT;  
    DECLARE errorMessage VARCHAR(255);  
    DECLARE validationCriteria TEXT;  
    DECLARE measuredValue VARCHAR(255);  
    DECLARE expectedValueRange VARCHAR(255);  
    DECLARE additionalDetails TEXT;  
    DECLARE insertCount INT DEFAULT 0;  
    DECLARE expectedCount INT;  
    DECLARE successMessage VARCHAR(255);  
    DECLARE veID INT;  
    DECLARE done INT DEFAULT FALSE;  
  
    DECLARE cur CURSOR FOR  
        SELECT cm1.CoreMeasurementID  
        FROM stems s1  
                 JOIN stems s2 ON s1.TreeID = s2.TreeID AND s1.StemID != s2.StemID  
                 JOIN subquadrats sq1 ON s1.SubQuadratID = sq1.SubquadratID  
                 JOIN subquadrats sq2 ON s2.SubQuadratID = sq2.SubquadratID  
                 JOIN quadrats q1 ON sq1.QuadratID = q1.QuadratID  
                 JOIN quadrats q2 ON sq2.QuadratID = q2.QuadratID  
                 JOIN coremeasurements cm1 ON s1.StemID = cm1.StemID  
        WHERE q1.QuadratID != q2.QuadratID  
          AND cm1.IsValidated IS FALSE  
          AND (p_CensusID IS NULL OR cm1.CensusID = p_CensusID)  
          AND (p_PlotID IS NULL OR cm1.PlotID = p_PlotID)  
        GROUP BY cm1.CoreMeasurementID;  
  
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;  
  
    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations  
    (  
        CoreMeasurementID INT  
    );  
  
    IF p_CensusID IS NULL THEN  
        SET p_CensusID = -1;  
    END IF;  
    IF p_PlotID IS NULL THEN  
        SET p_PlotID = -1;  
    END IF;  
  
    SELECT COUNT(*)  
    INTO expectedCount  
    FROM stems s1  
             JOIN stems s2 ON s1.TreeID = s2.TreeID AND s1.StemID != s2.StemID  
             JOIN subquadrats sq1 ON s1.SubQuadratID = sq1.SubquadratID  
             JOIN subquadrats sq2 ON s2.SubQuadratID = sq2.SubquadratID  
             JOIN quadrats q1 ON sq1.QuadratID = q1.QuadratID  
             JOIN quadrats q2 ON sq2.QuadratID = q2.QuadratID  
             JOIN coremeasurements cm1 ON s1.StemID = cm1.StemID  
    WHERE q1.QuadratID != q2.QuadratID  
      AND cm1.IsValidated IS FALSE  
      AND (p_CensusID IS NULL OR cm1.CensusID = p_CensusID)  
      AND (p_PlotID IS NULL OR cm1.PlotID = p_PlotID)  
    GROUP BY cm1.CoreMeasurementID;  
  
    SELECT ValidationID  
    INTO veID  
    FROM catalog.validationprocedures  
    WHERE ProcedureName = 'ValidateFindTreeStemsInDifferentQuadrats';  
  
  
    OPEN cur;  
    loop1:  
    LOOP  
        FETCH cur INTO vCoreMeasurementID;  
        IF done THEN  
            LEAVE loop1;  
        END IF;  
  
        SET validationCriteria = 'Stem Quadrat Consistency within Trees';  
        SET measuredValue = 'Quadrat IDs of Stems';  
        SET expectedValueRange = 'Consistent Quadrat IDs for all Stems in a Tree';  
        SET additionalDetails = 'Validating that all stems within the same tree are located in the same quadrat.';  
  
        IF EXISTS (SELECT 1  
                   FROM stems s1  
                            JOIN stems s2 ON s1.TreeID = s2.TreeID AND s1.StemID != s2.StemID  
                            JOIN subquadrats sq1 on s1.SubQuadratID = sq1.SubquadratID  
                            JOIN subquadrats sq2 ON s2.SubQuadratID = sq2.SubquadratID  
                            JOIN quadrats q1 on q1.QuadratID = sq2.QuadratID  
                            JOIN quadrats q2 on q2.QuadratID = sq2.QuadratID  
                   WHERE s1.StemID IN  
                         (SELECT StemID  
                          FROM coremeasurements  
                          WHERE CoreMeasurementID = vCoreMeasurementID)  
                     AND q1.QuadratID != q2.QuadratID) THEN  
            SET validationResult = 0;  
            SET errorMessage = 'Stems in the same tree are in different quadrats.';  
            -- Check if the error record already exists before inserting  
            IF NOT EXISTS (SELECT 1  
                           FROM cmverrors  
                           WHERE CoreMeasurementID = vCoreMeasurementID  
                             AND ValidationErrorID = veID) THEN  
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)  
                VALUES (vCoreMeasurementID, veID);  
            END IF;  
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);  
            SET insertCount = insertCount + 1;  
        ELSE  
            SET validationResult = 1;  
            SET errorMessage = NULL;  
        END IF;  
  
        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,  
                                         ValidationOutcome, ErrorMessage,  
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,  
                                         AdditionalDetails)  
        VALUES ('ValidateFindTreeStemsInDifferentQuadrats', NOW(), vCoreMeasurementID,  
                IF(validationResult, 'Passed', 'Failed'), errorMessage,  
                validationCriteria, measuredValue, expectedValueRange,  
                additionalDetails);  
    END LOOP;  
    CLOSE cur;  
  
    SET successMessage = CONCAT('Validation completed. Total rows: ', expectedCount, ', Failed rows: ', insertCount);  
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;  
  
    SELECT CoreMeasurementID FROM FailedValidations;  
  
    DROP TEMPORARY TABLE IF EXISTS FailedValidations;  
END;  
  
create  
    definer = azureroot@`%` procedure ValidateHOMUpperAndLowerBounds(IN p_CensusID int, IN p_PlotID int,  
                                                                     IN minHOM decimal(10, 2), IN maxHOM decimal(10, 2))  
BEGIN  
    DECLARE defaultMinHOM DECIMAL(10, 2);  
    DECLARE defaultMaxHOM DECIMAL(10, 2);  
    DECLARE vCoreMeasurementID INT;  
    DECLARE validationResult BIT;  
    DECLARE errorMessage VARCHAR(255);  
    DECLARE validationCriteria TEXT;  
    DECLARE measuredValue VARCHAR(255);  
    DECLARE expectedValueRange VARCHAR(255);  
    DECLARE additionalDetails TEXT;  
    DECLARE insertCount INT DEFAULT 0;  
    DECLARE expectedCount INT;  
    DECLARE successMessage VARCHAR(255);  
    DECLARE veID INT;  
    DECLARE done INT DEFAULT FALSE;  
  
    DECLARE cur CURSOR FOR  
        SELECT cm.CoreMeasurementID  
        FROM coremeasurements cm  
        WHERE (  
            (minHOM IS NOT NULL AND MeasuredHOM < minHOM) OR  
            (maxHOM IS NOT NULL AND MeasuredHOM > maxHOM) OR  
            (minHOM IS NULL AND maxHOM IS NULL)  
            )  
          AND IsValidated IS FALSE  
          AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
          AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);  
  
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;  
  
    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations  
    (  
        CoreMeasurementID INT  
    );  
  
    SELECT COUNT(*)  
    INTO expectedCount  
    FROM coremeasurements cm  
    WHERE (  
        (minHOM IS NOT NULL AND MeasuredHOM < minHOM) OR  
        (maxHOM IS NOT NULL AND MeasuredHOM > maxHOM) OR  
        (minHOM IS NULL AND maxHOM IS NULL)  
        )  
      AND IsValidated IS FALSE  
      AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
      AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);  
  
    SELECT ValidationID  
    INTO veID  
    FROM catalog.validationprocedures  
    WHERE ProcedureName = 'ValidateHOMUpperAndLowerBounds';  
  
  
    OPEN cur;  
    loop1:  
    LOOP  
        FETCH cur INTO vCoreMeasurementID;  
  
        IF done THEN  
            LEAVE loop1;  
        END IF;  
  
        IF minHOM IS NULL OR maxHOM IS NULL THEN  
            SELECT COALESCE(sl.LowerBound, 0)    AS defaultMinHOM,  
                   COALESCE(sl.UpperBound, 9999) AS defaultMaxHOM  
            INTO defaultMinHOM, defaultMaxHOM  
            FROM specieslimits sl  
                     JOIN species s ON sl.SpeciesCode = s.SpeciesCode  
                     JOIN trees t ON s.SpeciesID = t.SpeciesID  
                     JOIN coremeasurements cm ON t.TreeID = cm.TreeID  
            WHERE cm.CoreMeasurementID = vCoreMeasurementID  
              AND sl.LimitType = 'HOM';  
  
            SET minHOM = COALESCE(minHOM, defaultMinHOM);  
            SET maxHOM = COALESCE(maxHOM, defaultMaxHOM);  
        END IF;  
  
        SET validationCriteria = 'HOM Measurement Range Validation';  
        SET measuredValue = CONCAT('Measured HOM: ', (SELECT MeasuredHOM  
                                                      FROM coremeasurements  
                                                      WHERE CoreMeasurementID = vCoreMeasurementID));  
        SET expectedValueRange = CONCAT('Expected HOM Range: ', minHOM, ' - ', maxHOM);  
        SET additionalDetails = 'Checks if the measured HOM falls within the specified minimum and maximum range.';  
  
        IF (SELECT MeasuredHOM  
            FROM coremeasurements  
            WHERE CoreMeasurementID = vCoreMeasurementID  
              AND (  
                (minHOM IS NOT NULL AND MeasuredHOM < minHOM) OR  
                (maxHOM IS NOT NULL AND MeasuredHOM > maxHOM) OR  
                (minHOM IS NULL AND maxHOM IS NULL)  
                )) THEN  
            SET validationResult = 0;  
            SET errorMessage = CONCAT('HOM outside bounds: ', minHOM, ' - ', maxHOM);  
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);  
            SET insertCount = insertCount + 1;  
            -- Check if the error record already exists before inserting  
            IF NOT EXISTS (SELECT 1  
                           FROM cmverrors  
                           WHERE CoreMeasurementID = vCoreMeasurementID  
                             AND ValidationErrorID = veID) THEN  
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)  
                VALUES (vCoreMeasurementID, veID);  
            END IF;  
        ELSE  
            SET validationResult = 1;  
            SET errorMessage = NULL;  
        END IF;  
  
        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,  
                                         ValidationOutcome, ErrorMessage,  
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,  
                                         AdditionalDetails)  
        VALUES ('ValidateHOMUpperAndLowerBounds', NOW(), vCoreMeasurementID,  
                IF(validationResult, 'Passed', 'Failed'), errorMessage,  
                validationCriteria, measuredValue, expectedValueRange,  
                additionalDetails);  
    END LOOP;  
    CLOSE cur;  
  
    SET successMessage =  
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);  
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;  
  
    SELECT CoreMeasurementID FROM FailedValidations;  
  
    DROP TEMPORARY TABLE IF EXISTS FailedValidations;  
END;  
  
create  
    definer = azureroot@`%` procedure ValidateScreenMeasuredDiameterMinMax(IN p_CensusID int, IN p_PlotID int,  
                                                                           IN minDBH decimal(10, 2),  
                                                                           IN maxDBH decimal(10, 2))  
BEGIN  
    DECLARE defaultMinDBH DECIMAL(10, 2);  
    DECLARE defaultMaxDBH DECIMAL(10, 2);  
    DECLARE vCoreMeasurementID INT;  
    DECLARE validationResult BIT;  
    DECLARE errorMessage VARCHAR(255);  
    DECLARE validationCriteria TEXT;  
    DECLARE measuredValue VARCHAR(255);  
    DECLARE expectedValueRange VARCHAR(255);  
    DECLARE additionalDetails TEXT;  
    DECLARE insertCount INT DEFAULT 0;  
    DECLARE expectedCount INT;  
    DECLARE successMessage VARCHAR(255);  
    DECLARE veID INT;  
    DECLARE done INT DEFAULT FALSE;  
  
    DECLARE cur CURSOR FOR  
        SELECT cm.CoreMeasurementID  
        FROM coremeasurements cm  
        WHERE (  
            (MeasuredDBH < 0) OR  
            (maxDBH IS NOT NULL AND MeasuredDBH > maxDBH) OR  
            (minDBH IS NULL AND maxDBH IS NULL)  
            )  
          AND IsValidated IS FALSE  
          AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
          AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);  
  
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;  
  
    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations  
    (  
        CoreMeasurementID INT  
    );  
  
    SELECT COUNT(*)  
    INTO expectedCount  
    FROM coremeasurements cm  
    WHERE (  
        (MeasuredDBH < 0) OR  
        (maxDBH IS NOT NULL AND MeasuredDBH > maxDBH) OR  
        (minDBH IS NULL AND maxDBH IS NULL)  
        )  
      AND IsValidated IS FALSE  
      AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
      AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);  
  
    SELECT ValidationID  
    INTO veID  
    FROM catalog.validationprocedures  
    WHERE ProcedureName = 'ValidateScreenMeasuredDiameterMinMax';  
  
  
    OPEN cur;  
    loop1:  
    LOOP  
        FETCH cur INTO vCoreMeasurementID;  
  
        IF done THEN  
            LEAVE loop1;  
        END IF;  
  
        IF minDBH IS NULL OR maxDBH IS NULL THEN  
            SELECT COALESCE(sl.LowerBound, 0)    AS defaultMinDBH,  
                   COALESCE(sl.UpperBound, 9999) AS defaultMaxDBH  
            INTO defaultMinDBH, defaultMaxDBH  
            FROM specieslimits sl  
                     JOIN species s ON sl.SpeciesCode = s.SpeciesCode  
                     JOIN trees t ON s.SpeciesID = t.SpeciesID  
                     JOIN coremeasurements cm ON t.TreeID = cm.TreeID  
            WHERE cm.CoreMeasurementID = vCoreMeasurementID  
              AND sl.LimitType = 'DBH';  
  
            SET minDBH = COALESCE(minDBH, defaultMinDBH);  
            SET maxDBH = COALESCE(maxDBH, defaultMaxDBH);  
        END IF;  
  
        SET validationCriteria = 'DBH Measurement Range Validation';  
        SET measuredValue = CONCAT('Measured DBH: ', (SELECT MeasuredDBH  
                                                      FROM coremeasurements  
                                                      WHERE CoreMeasurementID = vCoreMeasurementID));  
        SET expectedValueRange = CONCAT('Expected DBH Range: ', minDBH, ' - ', maxDBH);  
        SET additionalDetails = 'Checks if the measured DBH falls within the specified minimum and maximum range.';  
  
        IF (SELECT MeasuredDBH  
            FROM coremeasurements  
            WHERE CoreMeasurementID = vCoreMeasurementID  
              AND (  
                (MeasuredDBH < 0) OR  
                (maxDBH IS NOT NULL AND MeasuredDBH > maxDBH) OR  
                (minDBH IS NULL AND maxDBH IS NULL)  
                )) THEN  
            SET validationResult = 0;  
            SET errorMessage = CONCAT('DBH outside bounds: ', minDBH, ' - ', maxDBH);  
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);  
            SET insertCount = insertCount + 1;  
            -- Check if the error record already exists before inserting  
            IF NOT EXISTS (SELECT 1  
                           FROM cmverrors  
                           WHERE CoreMeasurementID = vCoreMeasurementID  
                             AND ValidationErrorID = veID) THEN  
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)  
                VALUES (vCoreMeasurementID, veID);  
            END IF;  
        ELSE  
            SET validationResult = 1;  
            SET errorMessage = NULL;  
        END IF;  
  
        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,  
                                         ValidationOutcome, ErrorMessage,  
                                         ValidationCriteria, MeasuredValue, ExpectedValueRange,  
                                         AdditionalDetails)  
        VALUES ('ValidateScreenMeasuredDiameterMinMax', NOW(), vCoreMeasurementID,  
                IF(validationResult, 'Passed', 'Failed'), errorMessage,  
                validationCriteria, measuredValue, expectedValueRange,  
                additionalDetails);  
    END LOOP;  
    CLOSE cur;  
  
    SET successMessage =  
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);  
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;  
  
    SELECT CoreMeasurementID FROM FailedValidations;  
  
    DROP TEMPORARY TABLE IF EXISTS FailedValidations;  
END;  
  
create  
    definer = azureroot@`%` procedure ValidateScreenStemsWithMeasurementsButDeadAttributes(IN p_CensusID int, IN p_PlotID int)  
BEGIN  
    DECLARE vCoreMeasurementID INT;  
    DECLARE validationResult BIT;  
    DECLARE errorMessage VARCHAR(255);  
    DECLARE validationCriteria TEXT;  
    DECLARE additionalDetails TEXT;  
    DECLARE insertCount INT DEFAULT 0;  
    DECLARE expectedCount INT;  
    DECLARE successMessage VARCHAR(255);  
    DECLARE done INT DEFAULT FALSE;  
    DECLARE veID INT;  
    DECLARE vExistingErrorID INT;  
  
    DECLARE cur CURSOR FOR  
        SELECT cm.CoreMeasurementID  
        FROM coremeasurements cm  
                 JOIN cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID  
                 JOIN attributes a ON cma.Code = a.Code  
        WHERE ((cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR  
               (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0))  
          AND a.Status IN ('dead', 'stem dead', 'missing', 'broken below', 'omitted')  
          AND cm.IsValidated IS FALSE  
          AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
          AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);  
  
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;  
  
    CREATE TEMPORARY TABLE IF NOT EXISTS FailedValidations  
    (  
        CoreMeasurementID INT  
    );  
  
    SELECT COUNT(*)  
    INTO expectedCount  
    FROM coremeasurements cm  
             JOIN cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID  
             JOIN attributes a ON cma.Code = a.Code  
    WHERE ((cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR  
           (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0))  
      AND a.Status IN ('dead', 'stem dead', 'missing', 'broken below', 'omitted')  
      AND cm.IsValidated IS FALSE  
      AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)  
      AND (p_PlotID IS NULL OR cm.PlotID = p_PlotID);  
  
    SELECT ValidationID  
    INTO veID  
    FROM catalog.validationprocedures  
    WHERE ProcedureName = 'ValidateScreenStemsWithMeasurementsButDeadAttributes';  
  
  
    OPEN cur;  
    loop1:  
    LOOP  
        FETCH cur INTO vCoreMeasurementID;  
        IF done THEN  
            LEAVE loop1;  
        END IF;  
  
        SET validationCriteria = 'Stem Measurements with Dead Attributes Validation';  
        SET additionalDetails = 'Verifies that stems marked as dead do not have active measurements.';  
  
        IF EXISTS (SELECT 1  
                   FROM cmattributes cma  
                            JOIN attributes a ON cma.Code = a.Code  
                            JOIN coremeasurements cm on cma.CoreMeasurementID = cm.CoreMeasurementID  
                   WHERE cma.CoreMeasurementID = vCoreMeasurementID  
                     AND a.Status IN ('dead', 'stem dead', 'missing', 'broken below', 'omitted')  
                     AND ((cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR  
                          (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0))) THEN  
            SET validationResult = 0;  
            SET errorMessage = 'Stem with measurements but dead attributes detected.';  
            -- Check if the error record already exists before inserting  
            IF NOT EXISTS (SELECT 1  
                           FROM cmverrors  
                           WHERE CoreMeasurementID = vCoreMeasurementID  
                             AND ValidationErrorID = veID) THEN  
                INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)  
                VALUES (vCoreMeasurementID, veID);  
            END IF;  
            INSERT INTO FailedValidations (CoreMeasurementID) VALUES (vCoreMeasurementID);  
            SET insertCount = insertCount + 1;  
        ELSE  
            SET validationResult = 1;  
            SET errorMessage = NULL;  
        END IF;  
  
        INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID,  
                                         ValidationOutcome, ErrorMessage,  
                                         ValidationCriteria, AdditionalDetails)  
        VALUES ('ValidateScreenStemsWithMeasurementsButDeadAttributes', NOW(), vCoreMeasurementID,  
                IF(validationResult, 'Passed', 'Failed'), errorMessage,  
                validationCriteria, additionalDetails);  
    END LOOP;  
    CLOSE cur;  
  
    SET successMessage =  
            CONCAT('Validation completed successfully. Total rows: ', expectedCount, ', Failed rows: ', insertCount);  
    SELECT expectedCount AS TotalRows, insertCount AS FailedRows, successMessage AS Message;  
  
    SELECT CoreMeasurementID FROM FailedValidations;  
  
    DROP TEMPORARY TABLE IF EXISTS FailedValidations;  
END;
```